/** The production conception flow must be driven by documents, never by fixtures.
 *
 * Test A supplies real document content and proves it reaches the provider.
 * Test B keeps identical project metadata but removes the content, and proves
 * generation fails visibly instead of falling back to Quetzal knowledge held in
 * this repository, in the prompt, or in the model's memory of the mission.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSystemAiService, projectMemoryStatus } from "./system-ai.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const dataUrl = (text, mimeType = "text/markdown") => `data:${mimeType};base64,${Buffer.from(text, "utf8").toString("base64")}`;

// Deliberately not Quetzal: if extraction can only work on documents, a project
// named after Quetzal-1 carrying an unrelated document must produce that
// document's system, and never Quetzal's.
const documentText = [
  "# Bench supply rig",
  "The Rig contains an electrical subsystem with a Bench Supply and a Load Board.",
  "The Bench Supply powers the Load Board.",
  "Load Board operating power is 4 W."
].join("\n");

const project = {
  id: "quetzal1-eps-comms",
  name: "Quetzal-1",
  memoryRevision: 4,
  context: { teamId: "team-norte-validation", teamArtifactIds: [], projectArtifactIds: ["memory-source"] }
};

const artifact = {
  id: "memory-source", label: "Bench rig notes", scope: "project", ownerId: project.id,
  fileName: "rig.md", mimeType: "text/markdown", url: dataUrl(documentText)
};

const emptyArtifact = { ...artifact, url: "https://example.test/rig.md", fileName: "", mimeType: "" };

function extractionModel(text) {
  const evidence = { id: "e1", artifactId: "memory-source", artifactLabel: "Bench rig notes", excerpt: text, kind: "fact" };
  const entity = (id, name, kind, parentId) => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", source: "documented", evidenceRefs: ["e1"], confidence: 1, properties: [] });
  return {
    entities: [entity("rig", "Rig", "system"), entity("supply", "Bench Supply", "component", "electrical"), entity("load", "Load Board", "component", "electrical"), entity("electrical", "Electrical", "subsystem", "rig")],
    relations: [{ id: "r1", from: "supply", to: "load", kind: "powers", label: "powers", source: "documented", evidenceRefs: ["e1"], confidence: 1 }],
    requirements: [],
    evidence: [evidence]
  };
}

test("A: real document content reaches the provider and drives the extracted system", async () => {
  let sent = null;
  const service = createSystemAiService({ apiKey: "test-key", fetch: async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(extractionModel("The Bench Supply powers the Load Board.")) }] } }] }), { status: 200 });
  } });

  const model = await service.generate(project, [artifact]);
  const prompt = sent.contents[0].parts.map((part) => part.text || "").join("\n");
  assert.ok(prompt.includes("The Bench Supply powers the Load Board."), "the document text must be supplied to the provider");
  assert.deepEqual(model.artifactSources, [{ artifactId: "memory-source", artifactLabel: "Bench rig notes", status: "parsed" }]);
  assert.deepEqual(model.entities.map((entity) => entity.name), ["Rig", "Bench Supply", "Load Board", "Electrical"]);
  assert.equal(model.generatedFromRevision, 4);

  // No web retrieval: the model may read only what Norte imported.
  assert.equal(sent.tools, undefined);
  assert.equal(sent.toolConfig, undefined);
  assert.doesNotMatch(JSON.stringify(sent.generationConfig), /googleSearch|retrieval|browse/iu);
});

test("B: identical project metadata without readable content fails visibly instead of using a fixture", async () => {
  let called = false;
  const service = createSystemAiService({ apiKey: "test-key", fetch: async () => { called = true; return new Response("{}", { status: 200 }); } });

  const readiness = projectMemoryStatus(project, [emptyArtifact]);
  assert.equal(readiness.engineeringMemoryReadable, false);
  assert.ok(readiness.missing.includes("readable-artifact"));

  await assert.rejects(() => service.generate(project, [emptyArtifact]), (error) => {
    assert.equal(error.code, "SYSTEM_MEMORY_INSUFFICIENT");
    assert.equal(error.statusCode, 422);
    return true;
  });
  assert.equal(called, false, "no provider request may be made without readable memory");

  // The same project with no artifacts at all must fail the same way.
  await assert.rejects(() => service.generate({ ...project, context: { ...project.context, projectArtifactIds: [] } }, []), /readable text or PDF/u);
});

// The browser-only preview keeps a clearly labelled curated model behind an
// explicit confirmation string; its generate path refuses to extract and is
// covered by tests/demoApi.test.ts. Nothing else may reference a Quetzal model.
const PREVIEW_ONLY_FILE = join("src", "lib", "demoApi.ts");

async function productionFiles() {
  const roots = ["server", "src", "shared"];
  const files = [];
  for (const root of roots) {
    const entries = await readdir(join(repositoryRoot, root), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath ?? entry.path, entry.name);
      if (/\.(test|spec)\.[a-z]+$/u.test(entry.name)) continue;
      if (!/\.(mjs|js|ts|tsx)$/u.test(entry.name)) continue;
      if (relative(repositoryRoot, path) === PREVIEW_ONLY_FILE) continue;
      files.push(path);
    }
  }
  return files;
}

test("no production module carries Quetzal engineering constants or a project-name fallback", async () => {
  // Entity names, part numbers and design figures belong in the documents.
  // Their presence in runtime code would mean the graph could be produced
  // without reading anything.
  const forbidden = [
    /\bAX100\b/u, /\bINA260\b/u, /\bINA169\b/u, /\bTPS2551\b/u, /\bTPS63070\b/u, /\bTMP100\b/u,
    /\bBQ277?41\b/u, /\bATMEGA328P\b/iu, /\b3G30A\b/u, /\bSPV1040\b/u,
    /2640\s*mW/u, /1\.58\s*W/u, /\bquetzalFixture\b/u, /createQuetzalDesignModel/u
  ];
  const offenders = [];
  for (const path of await productionFiles()) {
    const source = await readFile(path, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) offenders.push(`${relative(repositoryRoot, path)} matches ${pattern}`);
    }
    // A name-based branch would let any project called "Quetzal" skip extraction.
    assert.doesNotMatch(source, /name[^\n]{0,40}(?:includes|match|===)[^\n]{0,20}Quetzal/iu, `${relative(repositoryRoot, path)} branches on the project name`);
  }
  assert.deepEqual(offenders, [], `production code must not hardcode Quetzal engineering facts:\n${offenders.join("\n")}`);
});
