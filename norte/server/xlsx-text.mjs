/** Minimal, dependency-free XLSX reader.
 *
 * Norte only needs the literal cell text of an official spreadsheet so the
 * extraction pipeline can read it. A full spreadsheet library is a large
 * attack surface for that, so this module reads only the ZIP entries it needs
 * (shared strings and worksheets), never evaluates formulas, never follows
 * relationships outside the archive, and never writes to disk.
 *
 * Every limit below is a hard bound: a malformed or hostile archive fails with
 * an error instead of allocating unbounded memory.
 */
import { inflateRawSync } from "node:zlib";

const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_INFLATED_BYTES = 24 * 1024 * 1024;
const MAX_SHEETS = 16;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 256;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function fail(message) {
  return Object.assign(new Error(message), { code: "XLSX_INVALID" });
}

/** Read the ZIP central directory. Only entry names we ask for are inflated. */
function readArchive(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) throw fail("Not a ZIP/XLSX archive.");
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 22 - 65_535; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) { eocd = offset; break; }
  }
  if (eocd < 0) throw fail("XLSX central directory was not found.");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw fail("XLSX archive has too many entries.");
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw fail("XLSX central directory is malformed.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entries, name, budget) {
  const entry = entries.get(name);
  if (!entry) return "";
  if (budget.remaining < entry.uncompressedSize) throw fail("XLSX archive expands beyond the supported total size.");
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw fail(`XLSX entry ${name} exceeds the supported size.`);
  const header = entry.localOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) throw fail("XLSX local header is malformed.");
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw fail(`XLSX entry ${name} is truncated.`);
  const raw = buffer.subarray(start, end);
  if (entry.method !== 0 && entry.method !== 8) throw fail(`XLSX entry ${name} uses an unsupported compression method.`);
  const inflated = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, budget.remaining) });
  budget.remaining -= inflated.length;
  return inflated.toString("utf8");
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gu, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? match;
  });
}

/** Concatenate the <t> runs of one shared-string or inline-string element. */
function elementText(xml) {
  let text = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/gu)) text += decodeXmlText(match[1] ?? "");
  return text;
}

function sharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/gu)].map((match) => elementText(match[1] ?? ""));
}

function columnIndex(reference) {
  let index = 0;
  for (const character of reference.replace(/\d+$/u, "")) index = index * 26 + (character.toUpperCase().charCodeAt(0) - 64);
  return index - 1;
}

function sheetRows(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row\s[^>]*\/>/gu)) {
    if (rows.length >= MAX_ROWS) throw fail("XLSX worksheet exceeds the supported row count.");
    const cells = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const type = /\bt="([^"]+)"/u.exec(attributes)?.[1] ?? "n";
      const reference = /\br="([A-Z]+\d+)"/u.exec(attributes)?.[1];
      const at = reference ? columnIndex(reference) : cells.length;
      if (at < 0 || at >= MAX_COLUMNS) continue;
      const value = type === "s" ? strings[Number(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(body)?.[1] ?? -1)] ?? ""
        : type === "inlineStr" ? elementText(body)
          : decodeXmlText(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(body)?.[1] ?? "");
      while (cells.length < at) cells.push("");
      cells[at] = value.replace(/[\r\n]+/gu, " ").trim();
    }
    while (cells.length && cells.at(-1) === "") cells.pop();
    rows.push(cells);
  }
  while (rows.length && rows.at(-1).length === 0) rows.pop();
  return rows;
}

function csvField(value) {
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Sheet names in workbook order, paired with their worksheet part. */
function workbookSheets(buffer, entries, budget) {
  const workbook = readEntry(buffer, entries, "xl/workbook.xml", budget);
  const relationships = readEntry(buffer, entries, "xl/_rels/workbook.xml.rels", budget);
  const targets = new Map([...relationships.matchAll(/<Relationship\s([^>]*)\/>/gu)].map((match) => [
    /\bId="([^"]+)"/u.exec(match[1])?.[1] ?? "",
    (/\bTarget="([^"]+)"/u.exec(match[1])?.[1] ?? "").replace(/^\/?xl\//u, "").replace(/^\.\//u, "")
  ]));
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\s([^>]*?)\/>/gu)) {
    const name = decodeXmlText(/\bname="([^"]*)"/u.exec(match[1])?.[1] ?? `Sheet${sheets.length + 1}`);
    const target = targets.get(/\br:id="([^"]+)"/u.exec(match[1])?.[1] ?? "");
    if (!target || target.includes("..")) continue;
    sheets.push({ name, part: `xl/${target}` });
    if (sheets.length >= MAX_SHEETS) break;
  }
  return sheets;
}

/** Read every worksheet of an XLSX buffer as literal cell text. */
export function readXlsxSheets(buffer) {
  const entries = readArchive(buffer);
  const budget = { remaining: MAX_TOTAL_INFLATED_BYTES };
  const strings = sharedStrings(readEntry(buffer, entries, "xl/sharedStrings.xml", budget));
  const sheets = workbookSheets(buffer, entries, budget);
  if (!sheets.length) throw fail("XLSX workbook declares no worksheet.");
  return sheets.map((sheet) => ({ name: sheet.name, rows: sheetRows(readEntry(buffer, entries, sheet.part, budget), strings) }));
}

/** CSV rendering of the sheets, used to make an official spreadsheet readable. */
export function xlsxToCsv(buffer, { sheetName } = {}) {
  const sheets = readXlsxSheets(buffer);
  const selected = sheetName ? sheets.filter((sheet) => sheet.name === sheetName) : sheets;
  if (!selected.length) throw fail(`XLSX worksheet ${sheetName} was not found.`);
  return selected.map((sheet) => ({
    name: sheet.name,
    csv: sheet.rows.map((row) => row.map(csvField).join(",")).join("\n")
  }));
}
