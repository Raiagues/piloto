import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "vite";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { architectureAliasCandidates } from "../shared/engineering-architecture.mjs";
import { technicalHierarchyError } from "../shared/technical-hierarchy.mjs";

// Review artifact only: never mutates the live datastore or calls a provider.
const sourcePath = resolve(process.env.NORTE_CLEANUP_SOURCE || "../.runtime/norte-data.json");
const projectId = process.env.NORTE_CLEANUP_PROJECT || "demo-f41bbb8fc5-quetzal-1";
const output = resolve(process.env.NORTE_CLEANUP_OUTPUT || "../.runtime/validation/quetzal-architecture-cleanup");
const data = JSON.parse(await readFile(sourcePath, "utf8")), record = data.workspace.projects[projectId], before = record?.document?.engineeringSystem;
assert(before && /quetzal/iu.test(before.name), "Expected the existing Quetzal engineering baseline");
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { mergeEngineeringAliases } = await vite.ssrLoadModule("/src/lib/engineeringArchitecture.ts");
  const { recordEngineeringCorrections } = await vite.ssrLoadModule("/src/lib/engineeringCorrections.ts");
  let after = structuredClone(before); const actions = [], options = { project: { projectId, projectName: record.document.name } };
  for (const group of architectureAliasCandidates(after)) {
    if (group.conflicts.length || !group.descriptionFits || !group.entityIds.every(id => after.entities.find(entity => entity.id === id)?.source === "documented")) continue;
    const names = group.entityIds.map(id => after.entities.find(entity => entity.id === id).name);
    after = mergeEngineeringAliases(after, group.entityIds, options); actions.push({ operation: "consolidate_aliases", names, canonicalId: group.canonicalId, preservedEvidence: after.entities.find(entity => entity.id === group.canonicalId).evidenceRefs.length });
  }
  const panel = after.entities.find(entity => /^Z- Solar Panel$/iu.test(entity.name));
  const adm = after.entities.find(entity => entity.kind === "subsystem" && /^Antenna Deployment Mechanism(?: \(ADM\))?$/u.test(entity.name));
  const proof = after.evidence.find(evidence => evidence.excerpt.includes("PCB containing both the `Z-` solar panel and the ADM"));
  if (panel?.kind === "subsystem" && adm && proof) {
    const children = after.entities.filter(entity => entity.parentId === panel.id);
    const placementIds = new Set([panel.id, ...children.map(entity => entity.id)]);
    const inferenceId = `placement-${randomUUID()}`;
    const rationale = "Proposed allocation: the source places the Z− solar panel and ADM on the same PCB. Assigning the panel and its parts under ADM is an architectural interpretation for review, not a documented functional allocation. No electrical or mechanical connection is inferred.";
    const next = { ...after,
      evidence: [...after.evidence, { id: inferenceId, artifactId: "architecture-review", artifactLabel: "Architecture placement proposal", kind: "inference", excerpt: rationale }],
      entities: after.entities.map(entity => placementIds.has(entity.id) ? { ...entity, kind: "component", parentId: adm.id, source: "inferred", confidence: .6, evidenceRefs: [...new Set([...entity.evidenceRefs, proof.id, inferenceId])] } : entity),
      relations: [...after.relations.filter(relation => relation.kind !== "contains" || !placementIds.has(relation.to)), ...[panel, ...children].map(entity => ({ id: `placement-${randomUUID()}`, from: adm.id, to: entity.id, kind: "contains", label: "Proposed allocation · review", source: "inferred", confidence: .6, evidenceRefs: [proof.id, inferenceId] }))]
    };
    after = recordEngineeringCorrections(after, next, { ...options, evidenceRefs: [proof.id, inferenceId] });
    for (const entity of [panel, ...children]) actions.push({ operation: entity.id === panel.id ? "classify_component" : "propose_component_allocation", name: entity.name, previousKind: entity.kind, previousParent: entity.parentId, kind: "component", parent: adm.name, source: "inferred", needsReview: true, evidenceRefs: [proof.id, inferenceId], rationale });
  }
  assert(validateEngineeringSystem(after), "Invalid proposed engineering model"); assert.equal(technicalHierarchyError(after), null);
  assert.deepEqual(after.artifactSources, before.artifactSources); assert(before.evidence.every(evidence => after.evidence.some(item => JSON.stringify(item) === JSON.stringify(evidence))), "Keep every original source unchanged");
  const report = { projectId, baselineId: before.id, sourceSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"), proposedSha256: createHash("sha256").update(JSON.stringify(after)).digest("hex"), before: { entities: before.entities.length, relations: before.relations.length, evidence: before.evidence.length }, after: { entities: after.entities.length, relations: after.relations.length, evidence: after.evidence.length }, actions, unresolved: ["OBC remains a functional subsystem. Mapping it into CDHS requires explicit project evidence.", "Part-number aliases with designators U2/U4/U17 etc. remain distinct; equal part numbers do not prove the same physical instance."], applied: false };
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const [name, value] of [["before.json", before], ["proposed.json", after], ["report.json", report], ["audit-delta.json", (after.corrections || []).slice((before.corrections || []).length)]]) await writeFile(resolve(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ report: resolve(output, "report.json"), entities: `${before.entities.length} → ${after.entities.length}`, actions: actions.length, valid: true, applied: false }));
} finally { await vite.close(); }
