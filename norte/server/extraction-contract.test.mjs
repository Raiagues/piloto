/** The extraction contract: one name for citations, exact violation reporting,
 * and quotation matching that tolerates line wrapping but nothing else. */
import assert from "node:assert/strict";
import test from "node:test";
import { requirementEvidenceField, restoreRequirementSourceRefs } from "./extraction-contract.mjs";
import { createSystemAiService, hydrateExtraction, locateExcerpt, readableProjection, validateExtractedSystem, prepareProjectArtifacts } from "./system-ai.mjs";
import { describeEngineeringSystemViolation, requirementSchema } from "../shared/engineering-schema.mjs";

const dataUrl = (text) => `data:text/markdown;base64,${Buffer.from(text, "utf8").toString("base64")}`;

const sourceText = [
  "# Power",
  "Power includes a distribution subsystem containing the Bus and Radio.",
  "",
  "The Bus powers the Radio. The Radio must remain within",
  "its documented supply range during every pass.",
  ""
].join("\n");

const project = {
  id: "p1", name: "Quetzal-1", memoryRevision: 2,
  context: { teamId: "t1", teamArtifactIds: [], projectArtifactIds: ["doc"] }
};
const artifact = { id: "doc", label: "Power notes", scope: "project", ownerId: "p1", fileName: "power.md", mimeType: "text/markdown", url: dataUrl(sourceText) };

function extraction({ requirementRefs }) {
  const entity = (id, name, kind, parentId) => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", source: "documented", evidenceRefs: ["ev-1"], confidence: 1, properties: [] });
  return {
    entities: [entity("sys", "Power", "system"), entity("bus", "Bus", "component", "distribution"), entity("radio", "Radio", "component", "distribution"), entity("distribution", "Distribution", "subsystem", "sys")],
    relations: [{ id: "r1", from: "bus", to: "radio", kind: "powers", label: "powers", source: "documented", evidenceRefs: ["ev-1"], confidence: 1 }],
    requirements: [{ id: "REQ-1", title: "Supply range", statement: "The Radio must remain within its documented supply range during every pass.", category: "", subsystemTags: [], reviewTags: [], evidenceRefs: requirementRefs, relatedEntityIds: ["radio"], relatedRelationIds: [], properties: [] }],
    evidence: [{ id: "ev-1", artifactId: "doc", artifactLabel: "Power notes", excerpt: "The Bus powers the Radio.", kind: "fact" }]
  };
}

test("the provider contract names a requirement's citations like every other object's", () => {
  const schema = requirementEvidenceField(requirementSchema);
  assert.equal(Object.hasOwn(schema.properties, "sourceRefs"), false, "sourceRefs invites an artifactId answer");
  assert.ok(Object.hasOwn(schema.properties, "evidenceRefs"));
  assert.ok(schema.required.includes("evidenceRefs"));
  assert.equal(schema.required.includes("sourceRefs"), false);
  // Renaming is reversible and touches nothing else.
  assert.deepEqual(restoreRequirementSourceRefs({ id: "REQ-1", title: "t", evidenceRefs: ["ev-1"] }), { id: "REQ-1", title: "t", sourceRefs: ["ev-1"] });
  assert.deepEqual(restoreRequirementSourceRefs({ id: "REQ-1", sourceRefs: ["ev-1"] }), { id: "REQ-1", sourceRefs: ["ev-1"] });
});

test("the generated schema sent to the provider carries no sourceRefs field", async () => {
  let sent = null;
  const service = createSystemAiService({ apiKey: "test-key", fetch: async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(extraction({ requirementRefs: ["ev-1"] })) }] } }] }), { status: 200 });
  } });
  await service.generate(project, [artifact]);
  const requirements = sent.generationConfig.responseJsonSchema.properties.requirements.items;
  assert.equal(Object.hasOwn(requirements.properties, "sourceRefs"), false);
  assert.ok(Object.hasOwn(requirements.properties, "evidenceRefs"));
  const prompt = sent.contents[0].parts.map((part) => part.text || "").join("\n");
  assert.match(prompt, /NEVER an artifactId/u);
});

test("a requirement citing evidence is accepted and persists under the stored field name", () => {
  const parsed = prepareProjectArtifacts(project, [artifact]);
  const model = validateExtractedSystem(hydrateExtraction(extraction({ requirementRefs: ["ev-1"] }), project), project, parsed, "test-model");
  assert.deepEqual(model.requirements[0].sourceRefs, ["ev-1"]);
  assert.deepEqual(model.requirements[0].originalSourceRefs, ["ev-1"]);
  assert.equal(Object.hasOwn(model.requirements[0], "evidenceRefs"), false);
});

test("a requirement citing an artifactId is still rejected, and the error names the defect", () => {
  const parsed = prepareProjectArtifacts(project, [artifact]);
  // This is exactly what the provider returned in five of six live runs.
  const broken = hydrateExtraction(extraction({ requirementRefs: ["doc"] }), project);
  assert.equal(describeEngineeringSystemViolation(broken), "requirement REQ-1 cites doc in sourceRefs, which is not an evidence id");
  assert.throws(() => validateExtractedSystem(broken, project, parsed, "test-model"), (error) => {
    assert.equal(error.code, "SYSTEM_RESPONSE_INVALID");
    assert.match(error.message, /requirement REQ-1 cites doc in sourceRefs/u);
    return true;
  });
});

test("violation reporting names the object and field for each broken reference", () => {
  const base = () => hydrateExtraction(extraction({ requirementRefs: ["ev-1"] }), project);
  const cases = [
    [(model) => { model.entities[1].evidenceRefs = ["ghost"]; }, /entity bus cites ghost, which is not an evidence id/u],
    [(model) => { model.entities[1].parentId = "nowhere"; }, /entity bus has parentId nowhere, which does not exist/u],
    [(model) => { model.relations[0].to = "nowhere"; }, /relation r1 ends at nowhere, which does not exist/u],
    [(model) => { model.relations[0].to = model.relations[0].from; }, /relation r1 connects bus to itself/u],
    [(model) => { model.requirements[0].relatedEntityIds = ["nowhere"]; }, /requirement REQ-1 links to entity nowhere/u],
    [(model) => { model.entities.push({ ...model.entities[0] }); }, /duplicate entity id/u]
  ];
  for (const [mutate, expected] of cases) {
    const model = base();
    mutate(model);
    assert.match(describeEngineeringSystemViolation(model) ?? "", expected);
  }
  assert.equal(describeEngineeringSystemViolation(base()), null);
});

test("quotation matching tolerates how whitespace was wrapped and nothing else", () => {
  // The source wraps this sentence across two lines; a model quoting it writes one space.
  const wrapped = "The Radio must remain within its documented supply range during every pass.";
  assert.equal(sourceText.includes(wrapped), false, "the fixture must actually be wrapped");
  const at = locateExcerpt(sourceText, wrapped);
  assert.ok(at >= 0);
  assert.equal(sourceText.slice(0, at).split("\n").length, 4, "the locator must still point at the real line");

  assert.equal(locateExcerpt(sourceText, "The Bus powers the Radio."), sourceText.indexOf("The Bus powers the Radio."));
  for (const invented of [
    "The Radio must stay within its documented supply range",   // paraphrase
    "The Radio must remain within supply range during every pass.", // words removed
    "The Bus powers the Radio!",                                 // punctuation changed
    "   "
  ]) {
    assert.equal(locateExcerpt(sourceText, invented), -1, `must reject: ${invented}`);
  }
});

test("a wrapped quotation now verifies end to end and keeps its real line locator", () => {
  const parsed = prepareProjectArtifacts(project, [artifact]);
  const raw = extraction({ requirementRefs: ["ev-1"] });
  raw.evidence[0].excerpt = "The Radio must remain within its documented supply range during every pass.";
  const model = validateExtractedSystem(hydrateExtraction(raw, project), project, parsed, "test-model");
  assert.match(model.evidence[0].locator, /^L4; chars \d+–\d+$/u);
});

// A Markdown source as the mission team actually publishes it.
const markdownSource = [
  "## Sensors",
  "",
  "The EPS carried the following I<sup>2</sup>C sensors on its",
  "power grid:",
  "",
  "1. 3X [Texas Instruments, Cat. No. INA260](https://www.ti.com/product/INA260) - Precision Digital Current and Power Monitors",
  "2. 1X [Texas Instruments, Cat. No. BQ27741-G1](https://www.ti.com/product/BQ27741-G1) - Single-Cell Li-Ion Battery Fuel Gauge",
  "",
  "The EPS &mu;C was connected as a slave with the address `0x99`.",
  "",
  "__FPB switches__ had active-high enable pins.",
  ""
].join("\n");

test("a quotation is verified against the document as it reads, not its markup", () => {
  // Every one of these is a faithful quote of the rendered document, and each
  // was rejected before: they are the real defects measured on live extractions.
  const faithful = [
    ["1X [Texas Instruments, Cat. No. BQ27741-G1] - Single-Cell Li-Ion Battery Fuel Gauge", 7],
    ["3X Texas Instruments, Cat. No. INA260 - Precision Digital Current and Power Monitors", 6],
    ["The EPS carried the following I2C sensors on its power grid:", 3],
    ["The EPS \u03bcC was connected as a slave with the address 0x99.", 9],
    ["FPB switches had active-high enable pins.", 11]
  ];
  for (const [excerpt, line] of faithful) {
    const at = locateExcerpt(markdownSource, excerpt);
    assert.ok(at >= 0, `must verify: ${excerpt}`);
    assert.equal(markdownSource.slice(0, at).split("\n").length, line, `wrong locator for: ${excerpt}`);
  }
});

test("removing markup never lets an invented or altered quotation through", () => {
  for (const invented of [
    "1X [Texas Instruments, Cat. No. BQ27441-G1] - Single-Cell Li-Ion Battery Fuel Gauge", // wrong part number
    "3X Texas Instruments - Precision Digital Current and Power Monitors",                  // words removed
    "The EPS carried the following I2C sensors on its power bus:",                          // word changed
    "FPB switches had active-low enable pins.",                                             // meaning inverted
    "The EPS carried I2C sensors. FPB switches had active-high enable pins."                // spliced sentences
  ]) {
    assert.equal(locateExcerpt(markdownSource, invented), -1, `must reject: ${invented}`);
  }
});

test("the readable projection drops only markup and maps every character home", () => {
  const { text, offsets } = readableProjection("a [label](https://x.test/a_(b)) and <sup>2</sup> and &mu; and `code`");
  assert.equal(text, "a label and 2 and \u03bc and code");
  assert.equal(offsets.length, text.length);
  // Every projected character points at a real position, in order.
  assert.ok(offsets.every((offset, index) => offset >= 0 && (index === 0 || offset >= offsets[index - 1])));
  // An unknown entity is left alone rather than silently deleted.
  assert.equal(readableProjection("5 &notreal; V").text, "5 &notreal; V");
});

test("a contract violation is retried once, and the follow-up only states what was violated", async () => {
  const bodies = [];
  const service = createSystemAiService({ apiKey: "test-key", fetch: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    // First answer breaks the contract exactly as the live provider did; second is valid.
    const payload = extraction({ requirementRefs: bodies.length === 1 ? ["doc"] : ["ev-1"] });
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });
  } });
  const model = await service.generate(project, [artifact]);
  assert.equal(bodies.length, 2, "the rejected answer must be retried once");
  assert.deepEqual(model.requirements[0].sourceRefs, ["ev-1"]);

  const followUp = bodies[1].contents[0].parts[0].text;
  assert.match(followUp, /Your previous answer was rejected by the server/u);
  assert.match(followUp, /requirement REQ-1 cites doc in sourceRefs/u);
  // Corrective feedback names the violation; it never supplies engineering content.
  assert.equal(/\b(?:should be|use the value|the answer is)\b/iu.test(followUp.split("Your previous answer")[1]), false);
});

test("the retry is bounded, and never fires for a provider fault", async () => {
  let calls = 0;
  const always = createSystemAiService({ apiKey: "test-key", fetch: async () => {
    calls += 1;
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(extraction({ requirementRefs: ["doc"] })) }] } }] }), { status: 200 });
  } });
  await assert.rejects(() => always.generate(project, [artifact]), /SYSTEM_RESPONSE_INVALID|invalid fields/u);
  assert.equal(calls, 2, "a persistent contract violation stops after the bounded retry");

  // The deterministic benchmark scores a single answer.
  calls = 0;
  const single = createSystemAiService({ apiKey: "test-key", maxContractAttempts: 1, fetch: async () => {
    calls += 1;
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(extraction({ requirementRefs: ["doc"] })) }] } }] }), { status: 200 });
  } });
  await assert.rejects(() => single.generate(project, [artifact]));
  assert.equal(calls, 1);
});
