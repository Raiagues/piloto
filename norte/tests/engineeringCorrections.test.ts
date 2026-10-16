import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEngineeringValidationModel } from "../examples/engineering-validation.mjs";
import { ENGINEERING_LIMITS, validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { AuthProvider } from "../src/lib/auth";
import { recordEngineeringCorrections, serializeEngineeringCorrections } from "../src/lib/engineeringCorrections";
import type { EngineeringCorrection, EngineeringEntity, EngineeringRelation, EngineeringSystemModel } from "../src/lib/engineeringSystem";
import { correctEngineeringEntity, correctEngineeringRelation, correctEngineeringRequirement, removeEngineeringRelation } from "../src/lib/engineeringUi";
import { EngineeringCorrectionHistory, EngineeringRelationInfo } from "../src/components/EngineeringDetails";

const firstTime = "2026-09-08T00:00:00.000Z";
const secondTime = "2026-09-08T01:00:00.000Z";
const project = { projectId: "project", projectName: "Engineering review", projectType: "Explicit test context" };
const noop = () => undefined;
const relation = (model: EngineeringSystemModel) => model.relations.find((item) => item.id === "regulator-radio")!;
const radio = (model: EngineeringSystemModel) => model.entities.find((item) => item.id === "radio")!;

function inferredBaseline() {
  const baseline = createEngineeringValidationModel();
  baseline.relations = baseline.relations.map((item) => item.id === "regulator-radio" ? { ...item, source: "inferred", confidence: .55 } : item);
  return baseline;
}

describe("auditable expert engineering corrections", () => {
  it("preserves legacy models and ignores no-op edits without inventing a revision", () => {
    const baseline = createEngineeringValidationModel();
    expect(validateEngineeringSystem(baseline)).toBe(true);
    const unchanged = recordEngineeringCorrections(baseline, structuredClone(baseline));
    expect(unchanged.revision).toBeUndefined();
    expect(unchanged.corrections).toBeUndefined();
  });

  it("retains the suggested relation, corrected source/target/type, evidence and relevant context", () => {
    const baseline = inferredBaseline();
    const original = JSON.stringify(baseline);
    const before = relation(baseline);
    const corrected = correctEngineeringRelation(baseline, before, { ...before, from: "battery", to: "base-load", kind: "connects_to", evidenceRefs: ["battery"] }, firstTime, { project });
    expect(validateEngineeringSystem(corrected)).toBe(true);
    expect(corrected.revision).toBe(1);
    const audit = corrected.corrections![0];
    expect(audit.suggested).toEqual({ relation: before });
    expect(audit.previous).toEqual({ relation: before });
    expect(audit.corrected).toMatchObject({ relation: { from: "battery", to: "base-load", kind: "connects_to", source: "user" } });
    expect(audit.suggestedEvidence.some((source) => source.id === "architecture")).toBe(true);
    expect(audit.correctedEvidence.some((source) => source.id === "battery")).toBe(true);
    expect(audit.correctedEvidence.some((source) => source.kind === "user")).toBe(true);
    expect(audit.context).toMatchObject({ ...project, baselineId: baseline.id, baselineRevision: 0, generatedFromRevision: baseline.generatedFromRevision, entitiesTruncated: false });
    expect(audit.context.entities.map((entity) => entity.id)).toEqual(expect.arrayContaining(["regulator", "radio", "battery", "base-load"]));
    expect(audit.createdAt).toBe(firstTime);
    expect(JSON.stringify(baseline)).toBe(original);
  });

  it("keeps the first AI suggestion across repeated corrections while recording the immediately previous expert value", () => {
    const baseline = inferredBaseline();
    const first = correctEngineeringRelation(baseline, relation(baseline), { ...relation(baseline), from: "battery" }, firstTime);
    const second = correctEngineeringRelation(first, relation(first), { ...relation(first), kind: "connects_to" }, secondTime);
    const latest = second.corrections!.at(-1)!;
    expect(latest.suggested).toMatchObject({ relation: { from: "regulator", kind: "powers", source: "inferred", confidence: .55 } });
    expect(latest.previous).toMatchObject({ relation: { from: "battery", kind: "powers", source: "user" } });
    expect(latest.corrected).toMatchObject({ relation: { from: "battery", kind: "connects_to" } });
    expect(latest.context.baselineRevision).toBe(1);
    expect(second.revision).toBe(2);
    expect(latest.context.projectType).toBeUndefined();
    expect(validateEngineeringSystem(second)).toBe(true);
  });

  it("audits relation deletion and trace cleanup without resolving historical IDs against the live model", () => {
    const baseline = inferredBaseline();
    baseline.requirements[0].relatedRelationIds = ["regulator-radio"];
    const corrected = removeEngineeringRelation(baseline, "regulator-radio", { project }, firstTime);
    expect(corrected.relations.some((item) => item.id === "regulator-radio")).toBe(false);
    expect(corrected.requirements[0].relatedRelationIds).toEqual([]);
    expect(corrected.corrections).toHaveLength(2);
    expect(corrected.corrections!.find((item) => item.objectKind === "relation")).toMatchObject({ operation: "delete", corrected: null, suggested: { relation: relation(baseline) } });
    expect(new Set(corrected.corrections!.map((item) => item.transactionId)).size).toBe(1);
    expect(validateEngineeringSystem(JSON.parse(JSON.stringify(corrected)))).toBe(true);
  });

  it("audits property corrections and subsystem reassignment together with their containment changes", () => {
    const baseline = createEngineeringValidationModel();
    baseline.relations.push({ id: "parent-radio", from: "communication", to: "radio", kind: "contains", label: "", source: "documented", evidenceRefs: ["architecture"], confidence: 1 });
    const before = radio(baseline);
    const corrected = correctEngineeringEntity(baseline, before, { ...before, parentId: "power", properties: before.properties.map((property) => property.key === "peak_current" ? { ...property, value: 1200 } : property) }, firstTime, { project, evidenceRefs: ["regulator"] });
    const audit = corrected.corrections!.find((item) => item.objectKind === "entity")!;
    expect(audit.suggested).toMatchObject({ entity: { parentId: "communication", properties: expect.arrayContaining([expect.objectContaining({ key: "peak_current", value: 400, source: "documented" })]) } });
    expect(audit.corrected).toMatchObject({ entity: { parentId: "power", properties: expect.arrayContaining([expect.objectContaining({ key: "peak_current", value: 1200, source: "user" })]) } });
    expect(corrected.corrections!.filter((item) => item.objectKind === "relation").map((item) => item.operation).sort()).toEqual(["create", "delete"]);
    expect(audit.correctedEvidence.some((source) => source.id === "regulator")).toBe(true);
    expect(validateEngineeringSystem(corrected)).toBe(true);
  });

  it("preserves requirement statement, classification, value and replaced source references as a review record", () => {
    const baseline = createEngineeringValidationModel();
    const before = baseline.requirements[0];
    const corrected = correctEngineeringRequirement(baseline, before, { ...before, statement: "Autonomy ≥ 120 min", sourceRefs: ["power-formula"], reviewTags: ["CDR"], properties: before.properties.map((property) => ({ ...property, value: 120 })) }, firstTime, { project });
    const audit = corrected.corrections![0];
    expect(audit.suggested).toEqual({ requirement: before });
    expect(audit.corrected).toMatchObject({ requirement: { statement: "Autonomy ≥ 120 min", sourceRefs: ["power-formula"], originalSourceRefs: before.sourceRefs, reviewTags: ["CDR"] } });
    expect(audit.suggestedEvidence.some((source) => source.id === "req-duration")).toBe(true);
    expect(audit.correctedEvidence.some((source) => source.id === "power-formula")).toBe(true);
    expect(validateEngineeringSystem(corrected)).toBe(true);
  });

  it("records manual creation without pretending that Norte suggested it", () => {
    const baseline = createEngineeringValidationModel();
    const draft: EngineeringRelation = { id: "", from: "battery", to: "regulator", kind: "powers", label: "Reviewed supply connection", source: "user", confidence: 1, evidenceRefs: ["architecture"] };
    const created = correctEngineeringRelation(baseline, null, draft, firstTime);
    expect(created.corrections![0]).toMatchObject({ operation: "create", suggested: null, previous: null, corrected: { relation: { from: "battery", to: "regulator" } } });
    expect(validateEngineeringSystem(created)).toBe(true);
  });

  it("supports historical entity and requirement deletion records after those objects are gone", () => {
    const baseline = createEngineeringValidationModel();
    const after = { ...baseline, entities: baseline.entities.filter((entity) => entity.id !== "radio"), relations: baseline.relations.filter((relation) => relation.from !== "radio" && relation.to !== "radio"), requirements: baseline.requirements.filter((requirement) => requirement.id !== "REQ-07") };
    const corrected = recordEngineeringCorrections(baseline, after, { project }, firstTime);
    expect(corrected.corrections!.some((item) => item.objectKind === "entity" && item.operation === "delete" && item.targetId === "radio")).toBe(true);
    expect(corrected.corrections!.some((item) => item.objectKind === "requirement" && item.operation === "delete" && item.targetId === "REQ-07")).toBe(true);
    expect(validateEngineeringSystem(corrected)).toBe(true);
  });

  it("rejects missing historical evidence and malformed correction snapshots at the persistence boundary", () => {
    const baseline = inferredBaseline();
    const corrected = correctEngineeringRelation(baseline, relation(baseline), { ...relation(baseline), from: "battery" }, firstTime);
    const missingEvidence = structuredClone(corrected);
    missingEvidence.corrections![0].suggestedEvidence = [];
    expect(validateEngineeringSystem(missingEvidence)).toBe(false);
    const malformed = structuredClone(corrected);
    malformed.corrections![0].previous = null;
    expect(validateEngineeringSystem(malformed)).toBe(false);
    const unsupportedTrace = structuredClone(corrected);
    Reflect.set(unsupportedTrace.corrections![0], "privateReasoning", "not part of the audit schema");
    expect(validateEngineeringSystem(unsupportedTrace)).toBe(false);
  });

  it("exports immutable snapshots with evidence and context instead of live references", () => {
    const baseline = createEngineeringValidationModel();
    const before = radio(baseline);
    const corrected = correctEngineeringEntity(baseline, before, { ...before, name: "Reviewed radio" }, firstTime, { project });
    const snapshot = structuredClone(corrected.corrections![0]);
    radio(corrected).name = "Another later label";
    const exported = JSON.parse(serializeEngineeringCorrections(corrected));
    expect(exported).toMatchObject({ schemaVersion: 1, baselineId: baseline.id, baselineRevision: 1 });
    expect(exported.corrections[0]).toEqual(snapshot);
    expect(exported.corrections[0].corrected.entity.name).toBe("Reviewed radio");
    expect(exported.corrections[0].suggested.entity.name).toBe("Radio R1");
  });

  it("bounds contextual neighbors explicitly without truncating the original correction", () => {
    const baseline = createEngineeringValidationModel();
    const before = baseline.entities.find((entity) => entity.id === "system")!;
    baseline.relations.push(...baseline.entities.filter((entity) => entity.id !== before.id).map((entity): EngineeringRelation => ({ id: `context-${entity.id}`, from: before.id, to: entity.id, kind: "affects", label: "", source: "inferred", confidence: .4, evidenceRefs: ["architecture"] })));
    const corrected = correctEngineeringEntity(baseline, before, { ...before, name: "Reviewed rig" }, firstTime);
    expect(corrected.corrections![0].context.entities).toHaveLength(8);
    expect(corrected.corrections![0].context.entitiesTruncated).toBe(true);
    expect(corrected.corrections![0].suggested).toEqual({ entity: before });
    expect(validateEngineeringSystem(corrected)).toBe(true);
  });

  it("never silently discards existing expert corrections when its bounded history is full", () => {
    const baseline = createEngineeringValidationModel();
    const once = correctEngineeringEntity(baseline, radio(baseline), { ...radio(baseline), name: "Reviewed" }, firstTime);
    const full = { ...once, corrections: Array.from({ length: 1000 }, (_, index) => ({ ...once.corrections![0], id: `history-${index}` })) as EngineeringCorrection[] };
    expect(() => correctEngineeringEntity(full, radio(full), { ...radio(full), name: "Another correction" }, secondTime)).toThrow(/history limit/u);
    expect(full.corrections).toHaveLength(1000);
  });

  it("keeps the baseline intact when correction evidence would exceed the persistence limits", () => {
    const baseline = createEngineeringValidationModel();
    while (baseline.evidence.length < ENGINEERING_LIMITS.references) baseline.evidence.push({ ...baseline.evidence[0], id: `source-${baseline.evidence.length}` });
    const refs = baseline.evidence.map((source) => source.id);
    const before = { ...relation(baseline), evidenceRefs: refs };
    baseline.relations = baseline.relations.map((item) => item.id === before.id ? before : item);
    expect(validateEngineeringSystem(baseline)).toBe(true);
    const original = JSON.stringify(baseline);
    expect(() => correctEngineeringRelation(baseline, before, { ...before, from: "battery" }, firstTime)).toThrow(/evidence limit/u);
    expect(JSON.stringify(baseline)).toBe(original);
    const full = createEngineeringValidationModel();
    while (full.evidence.length < ENGINEERING_LIMITS.evidence) full.evidence.push({ ...full.evidence[0], id: `extra-${full.evidence.length}` });
    expect(validateEngineeringSystem(full)).toBe(true);
    expect(() => correctEngineeringRelation(full, relation(full), { ...relation(full), from: "battery" }, firstTime)).toThrow(/evidence limit/u);
    expect(full.evidence).toHaveLength(ENGINEERING_LIMITS.evidence);
  });

  it("allows review of a long-document map and preserves all citation snapshots", () => {
    const baseline = createEngineeringValidationModel();
    while (baseline.evidence.length < 900) baseline.evidence.push({ ...baseline.evidence[0], id: `long-source-${baseline.evidence.length}` });
    const before = radio(baseline);
    before.evidenceRefs = baseline.evidence.slice(0,700).map((source)=>source.id);
    const original = JSON.stringify(baseline);
    const corrected = correctEngineeringEntity(baseline,before,{...before,name:"Reviewed long-document radio"},firstTime);
    expect(validateEngineeringSystem(corrected)).toBe(true);
    expect(corrected.corrections![0].suggestedEvidence.length).toBeGreaterThanOrEqual(700);
    expect(corrected.corrections![0].correctedEvidence.length).toBeGreaterThanOrEqual(700);
    expect(corrected.corrections![0].suggested).toMatchObject({entity:{evidenceRefs:before.evidenceRefs}});
    expect(JSON.stringify(baseline)).toBe(original);
  });

  it("exposes source and target correction in one contextual edit, and export inside correction history", () => {
    const baseline = createEngineeringValidationModel();
    const edit = renderToStaticMarkup(createElement(AuthProvider, { children: createElement(EngineeringRelationInfo, { language: "en", model: baseline, relation: { ...relation(baseline), id: "" }, onClose: noop, onModelChange: noop }) }));
    expect(edit).toContain("Source element");
    expect(edit).toContain("Target element");
    expect(edit).toContain("Sources used for this correction");
    const corrected = correctEngineeringEntity(baseline, radio(baseline), { ...radio(baseline), name: "Reviewed radio" } as EngineeringEntity, firstTime);
    const history = renderToStaticMarkup(createElement(AuthProvider, { children: createElement(EngineeringCorrectionHistory, { language: "en", model: corrected }) }));
    expect(history).toContain("Original suggestion");
    expect(history).toContain("Export corrections (JSON)");
  });
});
