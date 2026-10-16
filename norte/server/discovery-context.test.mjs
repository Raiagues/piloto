import assert from "node:assert/strict";
import test from "node:test";
import { selectDiscoveryContext } from "./discovery-context.mjs";
import { interpretationPrompt, interpretationRequestSchema, resolveInterpretation } from "./discovery-interpretation.mjs";
import { matchesSchema, changeSchema } from "../shared/engineering-schema.mjs";
import { createEngineeringValidationModel } from "../examples/engineering-validation.mjs";
import { createSystemAiService } from "./system-ai.mjs";

test("Discovery includes directed relations, source uncertainty, ancestors and relevant evidence only", () => {
  const model = createEngineeringValidationModel();
  model.entities.push({ id: "unrelated", name: "Antenna housing", kind: "component", parentId: "structure-system", description: "Separate enclosure", properties: [{ key: "secret", value: "UNRELATED_PROPERTY" }], evidenceRefs: ["private"] });
  model.evidence.push({ id: "private", excerpt: "UNRELATED_DOCUMENT" });
  model.relations[0].source = "inferred"; model.relations[0].confidence = .6;
  const context = selectDiscoveryContext(model, "radio 1.2 A", { project: { name: "Mission", projectType: "satellite", setup: { statement: "Study signal reception" }, context: { assignments: "PRIVATE_PEOPLE" } } });
  assert.ok(context.entities.some((entity) => entity.id === "radio"));
  assert.ok(context.entities.some((entity) => entity.id === "communication"));
  assert.ok(context.entities.some((entity) => entity.id === "system"));
  assert.deepEqual(context.relations.find((relation) => relation.id === "regulator-radio"), model.relations[0]);
  assert.ok(context.evidence.some((item) => item.id === "architecture"));
  assert.equal(context.project.purpose, "Study signal reception");
  assert.doesNotMatch(JSON.stringify(context), /UNRELATED_PROPERTY|UNRELATED_DOCUMENT|PRIVATE_PEOPLE/);
  assert.ok(context.selection.omittedObjects > 0);
});

test("linked cards resolve references without promoting hypotheses to evidence or including disconnected cards", () => {
  const model = createEngineeringValidationModel();
  const context = { nodeId: "current", relatedCards: [{ id: "prior", text: "Rádio R1 é o transmissor em discussão", description: "Rádio R1 é o transmissor em discussão. Avaliar desempenho." }, { id: "unlinked", text: "DO_NOT_SEND" }], links: [{ from: "prior", to: "current" }], clarifications: [{ question: "Qual rádio?", answer: "O Rádio R1." }] };
  const selected = selectDiscoveryContext(model, "Aumentar sua corrente para 1.2 A", context);
  assert.equal(selected.relatedCards.length, 1);
  assert.equal(selected.relatedCards[0].source, "user_hypothesis_not_evidence");
  assert.deepEqual(selected.clarifications, context.clarifications);
  assert.deepEqual(selected.cardLinks, context.links);
  assert.ok(selected.entities.some((entity) => entity.id === "radio"));
  assert.doesNotMatch(interpretationPrompt(model, "Aumentar sua corrente para 1.2 A", "pt", context), /DO_NOT_SEND/);
});

test("context has an aggregate budget and states omissions instead of silently truncating source quotes", () => {
  const model = createEngineeringValidationModel();
  model.entities = Array.from({ length: 200 }, (_, index) => ({ ...model.entities[6], id: `radio-${index}`, name: `Radio ${index}`, properties: Array.from({ length: 40 }, (_, key) => ({ key: `p${key}`, name: "description", value: "x".repeat(500), source: "documented", evidenceRefs: [] })) }));
  const selected = selectDiscoveryContext(model, "radio");
  assert.ok(JSON.stringify(selected).length < 102000);
  assert.ok(selected.selection.budgetOmissions.entities > 0);
  assert.ok(selected.targetIndex.length > 0);
});

test("long hypotheses and old requests both remain valid through saved impact proposals", () => {
  const text = `radio 1.2 A. ${"Detailed experimental assumptions. ".repeat(80)}`;
  assert.ok(matchesSchema({ projectId: "p", text }, interpretationRequestSchema));
  assert.ok(matchesSchema({ projectId: "p", text: "radio 1.2 A" }, interpretationRequestSchema));
  assert.equal(matchesSchema({ projectId: "p", text: "x".repeat(6001) }, interpretationRequestSchema), false);
  const result = resolveInterpretation(createEngineeringValidationModel(), text, candidate());
  assert.equal(result.status, "resolved");
  assert.equal(result.change.description, text);
  assert.ok(matchesSchema(result.change, changeSchema));
});

const candidate = () => ({ kind: "parameter", targetId: "radio", replacementName: "", question: "", confirmation: "", summary: "Radio current becomes 1.2 A", updates: [{ propertyKey: "peak_current", operation: "set", value: 1.2, unit: "A", quote: "radio 1.2 A" }] });

test("a rejected update preserves independently validated details without issuing a partial change or repeating questions", async () => {
  const output = candidate();
  output.updates.push({ propertyKey: "mass", operation: "set", value: 9, unit: "kg", quote: "INVENTED_SECRET" });
  const logs = [];
  const service = createSystemAiService({ apiKey: "test", onRejection: (record) => logs.push(record), fetch: async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(output) }] } }] })) });
  const result = await service.interpret(createEngineeringValidationModel(), "radio 1.2 A. PRIVATE_USER_TEXT", "pt");
  assert.equal(result.status, "error");
  assert.equal(result.reason, "ungrounded_quote");
  assert.equal(result.question, undefined);
  assert.equal(result.change, undefined);
  assert.equal(result.understood.targetName, "Radio R1");
  assert.equal(result.understood.updates[0].value, 1.2);
  assert.equal(logs[0].acceptedUpdateCount, 1);
  assert.deepEqual(logs[0].reasons, ["ungrounded_quote"]);
  assert.doesNotMatch(JSON.stringify(logs), /INVENTED_SECRET|PRIVATE_USER_TEXT|Radio R1|1\.2/);
});

test("clear but unsupported operations stay distinct from real missing intent and technical failures", () => {
  const model = createEngineeringValidationModel();
  const unsupported = resolveInterpretation(model, "Add a second radio", { ...candidate(), kind: "unsupported", updates: [], summary: "Adicionar um rádio é uma mudança estrutural ainda não suportada." }, "pt");
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.question, undefined);
  const ambiguous = resolveInterpretation(model, "Change the radio", { ...candidate(), kind: "clarification", question: "Qual característica do rádio você quer mudar?", updates: [] });
  assert.equal(ambiguous.status, "clarification");
  assert.equal(ambiguous.change, undefined);
  const technical = resolveInterpretation(model, "radio 1.2 A", { ...candidate(), targetId: "invented" });
  assert.equal(technical.status, "error");
  assert.equal(technical.reason, "unknown_target");
  assert.equal(technical.question, undefined);
});

test("previous clarification answers authorize values, while neighboring cards alone never do", () => {
  const model = createEngineeringValidationModel();
  const output = candidate();
  output.updates[0].quote = "1.2 A";
  const text = "Mudar a corrente do rádio";
  assert.equal(resolveInterpretation(model, text, output, "pt", { clarifications: [{ question: "Qual corrente?", answer: "1.2 A" }] }).status, "resolved");
  const rejected = resolveInterpretation(model, text, output, "pt", { relatedCards: [{ id: "neighbor", text: "1.2 A" }] });
  assert.equal(rejected.reason, "ungrounded_quote");
  assert.equal(rejected.change, undefined);
});
