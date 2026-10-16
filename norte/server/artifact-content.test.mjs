import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { classifyArtifactSource, artifactReadabilityRecord } from "./artifact-content.mjs";
import { readXlsxSheets, xlsxToCsv } from "./xlsx-text.mjs";
import { projectMemoryReadiness } from "../shared/project-memory.mjs";

const dataUrl = (bytes, mimeType) => `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

/** Minimal, valid XLSX built here so the reader is tested, not a vendor file. */
function buildXlsx(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

const workbook = buildXlsx([
  ["[Content_Types].xml", "<Types/>"],
  ["xl/workbook.xml", '<workbook><sheets><sheet name="Part List" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
  ["xl/sharedStrings.xml", "<sst><si><t>Designator</t></si><si><t>Comment</t></si><si><t>U1</t></si><si><t>Say &quot;hi&quot;, please</t></si></sst>"],
  ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><v>42</v></c></row></sheetData></worksheet>']
]);

test("the spreadsheet reader returns literal cell text with sheet names and CSV quoting", () => {
  const sheets = readXlsxSheets(workbook);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Part List"]);
  assert.deepEqual(sheets[0].rows, [["Designator", "Comment"], ["U1", 'Say "hi", please', "", "42"]]);
  assert.equal(xlsxToCsv(workbook)[0].csv, 'Designator,Comment\nU1,"Say ""hi"", please",,42');
});

test("the spreadsheet reader refuses archives it cannot safely read", () => {
  assert.throws(() => readXlsxSheets(Buffer.from("not a zip")), /XLSX|ZIP/u);
  assert.throws(() => readXlsxSheets(buildXlsx([["xl/workbook.xml", "<workbook><sheets/></workbook>"]])), /no worksheet/u);
  // A worksheet target must stay inside the archive.
  assert.throws(() => readXlsxSheets(buildXlsx([
    ["xl/workbook.xml", '<workbook><sheets><sheet name="Escape" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="../../etc/passwd"/></Relationships>']
  ])), /no worksheet/u);
});

test("classification decides exactly what reaches the extraction model", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
  assert.equal(classifyArtifactSource({ url: dataUrl(pdf, "application/pdf") }).status, "pdf");
  assert.equal(classifyArtifactSource({ url: dataUrl("# Notes", "text/markdown") }).text, "# Notes");
  assert.equal(classifyArtifactSource({ url: dataUrl(workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }).status, "parsed");

  // A link is metadata: its contents were never fetched.
  assert.equal(classifyArtifactSource({ url: "https://github.com/example/repo" }).status, "metadata_only");
  assert.equal(classifyArtifactSource({ url: "https://www.ti.com/lit/ds/symlink/ina260.pdf" }).status, "metadata_only");

  // Declared-but-wrong content, unsupported types and budget exhaustion all fail closed.
  assert.equal(classifyArtifactSource({ url: dataUrl("plain text", "application/pdf") }).status, "not_parsed");
  assert.equal(classifyArtifactSource({ url: dataUrl(Buffer.from([0xff, 0xfe, 0x00]), "text/plain") }).status, "not_parsed");
  assert.equal(classifyArtifactSource({ url: dataUrl("word file", "application/msword") }).status, "not_parsed");
  assert.equal(classifyArtifactSource({ url: dataUrl("# Notes", "text/markdown"), fileName: "sheet.xls" }).status, "not_parsed");
  assert.equal(classifyArtifactSource({ url: dataUrl("# Notes", "text/markdown") }, { remainingBytes: 2 }).status, "not_parsed");
  assert.match(classifyArtifactSource({ url: dataUrl("# Notes", "text/markdown") }, { remainingBytes: 2 }).reason, /total document processing limit/u);

  // The published record carries the verdict and never the file bytes.
  const record = artifactReadabilityRecord({ url: dataUrl(pdf, "application/pdf") });
  assert.deepEqual(Object.keys(record).sort(), ["reason", "status"]);
});

test("readiness follows the server's verdict, so the page cannot promise unusable memory", () => {
  const project = { id: "p1", name: "Project", context: { teamId: "t1", teamArtifactIds: [], projectArtifactIds: ["a1"] } };
  const linked = { id: "a1", scope: "project", ownerId: "p1" };

  const blocked = projectMemoryReadiness(project, [{ ...linked, readability: { status: "metadata_only", reason: "" } }]);
  assert.equal(blocked.basicProjectReady, true);
  assert.equal(blocked.engineeringMemoryReadable, false);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.missing, ["readable-artifact"]);

  const ready = projectMemoryReadiness(project, [{ ...linked, readability: { status: "pdf", reason: "" } }]);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.readableArtifactIds, ["a1"]);

  // An artifact the project does not own is never counted, however readable.
  const foreign = projectMemoryReadiness(project, [{ id: "a1", scope: "project", ownerId: "other", readability: { status: "parsed", reason: "" } }]);
  assert.equal(foreign.linkedCount, 0);
  assert.equal(foreign.ready, false);

  // Without a name or a team the project is not ready either.
  assert.deepEqual(projectMemoryReadiness({ ...project, name: " ", context: { ...project.context, teamId: null } }, []).missing, ["name", "team", "readable-artifact"]);
});
