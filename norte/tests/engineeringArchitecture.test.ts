import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { architectureAliasCandidates, mergeArchitectureAliases } from "../shared/engineering-architecture.mjs";
import { architectureBoundaryInterfaces, architectureInterfaces, architectureIssues, architectureScope, createManualEngineeringSystem, addEngineeringEntity, mergeEngineeringAliases } from "../src/lib/engineeringArchitecture";
import { EngineeringArchitectureView } from "../src/components/EngineeringArchitectureView";
import { analyzeImpact } from "../src/lib/impactEngine";
import { correctEngineeringEntity, projectEngineeringScenario } from "../src/lib/engineeringUi";
import type { EngineeringSystemModel, EngineeringEntity } from "../src/lib/engineeringSystem";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";

const entity = (id: string, name: string, kind: EngineeringEntity["kind"], parentId?: string): EngineeringEntity => ({ id, name, kind, ...(parentId ? { parentId } : {}), description: "", properties: [], evidenceRefs: ["source"], source: "documented", confidence: 1 });
const fixture = (): EngineeringSystemModel => ({ schemaVersion: 1, id: "baseline", name: "Spacecraft", generatedAt: "2026-10-15T00:00:00Z", generatedFromRevision: 0, entities: [entity("root", "Spacecraft", "system"), entity("eps", "Electrical Power System (EPS)", "subsystem", "root"), entity("alias", "Electrical Power System", "subsystem", "root"), entity("radio", "Communications", "subsystem", "root"), entity("reg", "Regulator U2", "component", "alias"), entity("tx", "Transmitter", "component", "radio")], relations: [{ id: "power", from: "reg", to: "tx", kind: "powers", label: "3.3 V", source: "documented", confidence: 1, evidenceRefs: ["source"] }], requirements: [{ id: "req", title: "Power", statement: "Supply radio", status: "unreviewed", sourceRefs: ["source"], relatedEntityIds: ["alias"], relatedRelationIds: ["power"], subsystemTags: [], reviewTags: [], properties: [] }], evidence: [{ id: "source", artifactId: "icd", artifactLabel: "ICD", excerpt: "EPS supplies the radio", kind: "fact" }], artifactSources: [] });

describe("conservative engineering identity", () => {
  it("consolidates acronym aliases without losing evidence, references or history", () => {
    const original = fixture(); original.entities[1].evidenceRefs.push("source2"); original.evidence.push({ ...original.evidence[0], id: "source2", excerpt: "Electrical Power System (EPS)" });
    const before = JSON.stringify(original), merged = mergeEngineeringAliases(original, ["eps", "alias"]);
    expect(merged.entities).toHaveLength(5); expect(merged.entities.find(e => e.id === "reg")?.parentId).toBe("eps");
    expect(merged.requirements[0].relatedEntityIds).toEqual(["eps"]); expect(merged.entities.find(e => e.id === "eps")?.evidenceRefs).toEqual(["source", "source2"]);
    expect(merged.corrections?.some(item => item.operation === "delete" && item.targetId === "alias")).toBe(true);
    expect(merged.relations).toEqual(original.relations); expect(merged.evidence).toEqual(original.evidence); expect(JSON.stringify(original)).toBe(before); expect(validateEngineeringSystem(merged)).toBe(true);
  });
  it("keeps old scenarios interpretable when an alias disappears from the current baseline", () => {
    const model = fixture(); const scenario = analyzeImpact(model, { id: "scenario-change", targetEntityId: "alias", kind: "parameter", oldValues: [], newValues: [{ key: "mass", name: "Mass", value: 2, unit: "kg", source: "user", evidenceRefs: [] }], description: "Legacy mass study", createdAt: "2026-10-15T00:00:00Z" }, "en");
    delete scenario.baseline; model.scenarios = [scenario]; const merged = mergeArchitectureAliases(model, ["eps", "alias"]);
    expect(merged.scenarios![0].baseline?.entities.some(entity => entity.id === "alias")).toBe(true);
    expect(projectEngineeringScenario(merged, merged.scenarios![0]).entities.some(entity => entity.id === "alias")).toBe(true);
  });
  it("never collapses physical components or siblings with different placement", () => {
    const model = fixture(); model.entities.push(entity("chip2", "Regulator U2", "component", "alias"), entity("different-place", "Electrical Power System", "subsystem", "radio"));
    expect(architectureAliasCandidates(model)).toHaveLength(1); expect(architectureAliasCandidates(model)[0].entityIds).not.toContain("different-place");
  });
  it("preserves conflicting values for explicit review", () => {
    const model = fixture(); model.entities[1].properties = [{ key: "voltage", name: "Voltage", value: 3.3, unit: "V", source: "documented", evidenceRefs: ["source"] }]; model.entities[2].properties = [{ ...model.entities[1].properties[0], value: 5 }];
    expect(architectureAliasCandidates(model)[0].conflicts).toEqual(["voltage"]); expect(() => mergeArchitectureAliases(model, ["eps", "alias"])).toThrow(/conflicting/);
  });
  it("refuses a merge that would erase a relationship between distinct records", () => {
    const model = fixture(); model.relations.push({ ...model.relations[0], id: "independent", from: "eps", to: "alias" });
    expect(() => mergeArchitectureAliases(model, ["eps", "alias"])).toThrow(/erase a relationship/);
  });
  it("rewrites property requirements and retains original relation IDs", () => {
    const model = fixture(); model.entities[2].properties.push({ key: "mass", name: "Mass", value: 3, unit: "kg", source: "documented", evidenceRefs: ["source"] });
    model.requirements[0].relatedPropertyRefs = [{ entityId: "alias", propertyKey: "mass" }]; model.relations[0].from = "alias"; model.entities[1].evidenceRefs.push("source");
    const next = mergeArchitectureAliases(model, ["eps", "alias"]);
    expect(next.relations[0]).toMatchObject({ id: "power", from: "eps" }); expect(next.requirements[0].relatedPropertyRefs).toEqual([{ entityId: "eps", propertyKey: "mass" }]); expect(validateEngineeringSystem(next)).toBe(true);
  });
});

describe("engineering views preserve semantic direction", () => {
  it("rolls up a component interface while preserving its real endpoints and evidence", () => {
    const model = fixture(), before = JSON.stringify(model), links = architectureInterfaces(model, "root");
    expect(links).toHaveLength(1); expect(links[0]).toMatchObject({ from: "alias", to: "radio", aggregated: true }); expect(links[0].relations[0]).toEqual(model.relations[0]); expect(JSON.stringify(model)).toBe(before);
  });
  it("does not turn containment, internal connections, or missing evidence into interfaces", () => {
    const model = fixture(); model.relations = [{ ...model.relations[0], kind: "contains", from: "root", to: "radio" }]; expect(architectureInterfaces(model, "root")).toEqual([]);
    model.relations = [{ ...fixture().relations[0], to: "alias" }]; expect(architectureInterfaces(model, "root")).toEqual([]);
  });
  it("exposes external interfaces without changing their endpoints or direction", () => {
    const model = fixture(); expect(architectureBoundaryInterfaces(model, "alias")).toEqual(model.relations); expect(architectureBoundaryInterfaces(model, "root")).toEqual([]);
  });
  it("keeps one composition level and exposes all descendants through inventory", () => {
    const scope = architectureScope(fixture(), "root"); expect(scope.children.map(item => item.id)).toEqual(["eps", "alias", "radio"]); expect(scope.descendants).toHaveLength(5);
    const html = renderToStaticMarkup(createElement(EngineeringArchitectureView, { model: fixture(), language: "en", scopeId: "root", onScope() {}, onInfo() {}, onRelation() {} }));
    expect(html).toContain("PRODUCT ARCHITECTURE"); expect(html).toContain("Open subsystem Communications"); expect(html).toContain('role="tablist"'); expect(html).not.toContain('data-entity-id="reg"'); expect(html).not.toContain("scale(");
  });
  it("flags suspicious subsystem classification without silently changing it", () => {
    const model = fixture(); model.entities.push(entity("panel", "Z- Solar Panel", "subsystem", "root"), entity("orphan", "Orphan component", "component", "root")); const before = JSON.stringify(model);
    expect(architectureIssues(model).map(item => item.id)).toEqual(["panel", "orphan"]); expect(JSON.stringify(model)).toBe(before);
  });
});

describe("manual engineering architecture", () => {
  it("creates an evidence-honest empty baseline without documents and audits subsequent edits", () => {
    let model = createManualEngineeringSystem("New satellite"); expect(model.entities[0].source).toBe("user"); expect(model.evidence).toEqual([]); expect(model.requirements).toEqual([]);
    model = addEngineeringEntity(model, "Avionics", "subsystem", model.entities[0].id); model = addEngineeringEntity(model, "Flight computer", "component", model.entities[1].id);
    expect(model.entities).toHaveLength(3); expect(model.corrections).toHaveLength(2); expect(validateEngineeringSystem(model)).toBe(true);
  });
  it("renames manual properties and removes dangling property links when a parameter is removed", () => {
    const model = fixture(), original = model.entities[4]; original.properties = [{ key: "power", name: "Power", value: 2, unit: "W", source: "documented", evidenceRefs: ["source"] }]; model.requirements[0].relatedPropertyRefs = [{ entityId: original.id, propertyKey: "power" }];
    const renamed = correctEngineeringEntity(model, original, { ...original, properties: [{ ...original.properties[0], name: "Peak power" }] });
    expect(renamed.entities[4].properties[0].name).toBe("Peak power"); expect(renamed.entities[4].properties[0].source).toBe("user");
    const removed = correctEngineeringEntity(model, original, { ...original, properties: [] }); expect(removed.requirements[0].relatedPropertyRefs).toEqual([]); expect(validateEngineeringSystem(removed)).toBe(true); expect(removed.corrections?.some(item => item.objectKind === "requirement")).toBe(true);
  });
  it("requires components to belong to a subsystem and prevents containment cycles", () => {
    const model = fixture(); expect(() => addEngineeringEntity(model, "A board", "component", "root")).toThrow(/inside a subsystem/);
    expect(() => correctEngineeringEntity(model, model.entities[2], { ...model.entities[2], parentId: "reg" })).toThrow(/descendants/);
    expect(() => correctEngineeringEntity(model, model.entities[2], { ...model.entities[2], kind: "component", parentId: "root" })).toThrow(/inside a subsystem/);
  });
});
