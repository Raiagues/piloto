import { createEngineeringValidationModel } from "../examples/engineering-validation.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialData } from "./data-store.mjs";
import { attachQuetzalArchitectureSources } from "./quetzal-source-extension.mjs";

function fixture(realSource = true) {
  let data = createInitialData();
  const project = data.workspace.projects["quetzal1-eps-comms"].document;
  project.context.programId = "obsat";
  project.engineeringSystem = createEngineeringValidationModel();
  project.phaseProgress.highestUnlockedStep = 2;
  if (realSource) data.artifacts.push({ id: "existing-eps", ownerId: project.id, provenance: { sourceId: "quetzal-eps-hardware-readme" } });
  const store = { read: () => structuredClone(data), update: async (mutate) => { const next = structuredClone(data); const result = mutate(next); data = next; return result; } };
  return store;
}
test("adds readable sources once, preserving OBSAT, existing model, progress and later user unlinks", async () => {
  const store = fixture(), before = store.read().workspace.projects["quetzal1-eps-comms"].document;
  assert.equal((await attachQuetzalArchitectureSources(store)).added, 4);
  const data = store.read(), project = data.workspace.projects[before.id].document;
  assert.equal(project.context.programId, "obsat");
  assert.ok(project.engineeringSystem.entities.length > before.engineeringSystem.entities.length);
  for (const entity of before.engineeringSystem.entities) assert.deepEqual(project.engineeringSystem.entities.find((item) => item.id === entity.id).properties, entity.properties);
  for (const name of ["ADCS", "Antenna Deployment Mechanism", "On-Board Computer", "Payload", "Structure"]) assert.ok(project.engineeringSystem.entities.some((item) => item.name === name));
  assert.equal(project.engineeringSystem.entities.filter((item) => item.name === "Antenna Deployment Mechanism").length, 1);
  assert.equal(project.engineeringSystem.entities.find((item) => item.name === "Antenna Deployment Mechanism").kind, "subsystem");
  assert.deepEqual(project.sourceExtensionHistory[0].baseline, before.engineeringSystem);
  assert.deepEqual(project.phaseProgress, before.phaseProgress);
  assert.equal(project.memoryRevision, before.memoryRevision + 1);
  for (const id of project.context.projectArtifactIds) {
    const artifact = data.artifacts.find((item) => item.id === id);
    const text = Buffer.from(artifact.url.split(",")[1], "base64").toString();
    assert.ok(text.includes("Quetzal-1") && text.includes("Source:"));
    assert.equal(Buffer.byteLength(text), artifact.size);
  }
  await store.update((next) => { next.workspace.projects[before.id].document.context.projectArtifactIds = []; });
  assert.equal((await attachQuetzalArchitectureSources(store)).added, 0);
  assert.deepEqual(store.read().workspace.projects[before.id].document.context.projectArtifactIds, []);
});
test("does not touch empty or synthetic projects", async () => {
  const store = fixture(false), before = store.read();
  assert.equal((await attachQuetzalArchitectureSources(store)).added, 0);
  assert.deepEqual(store.read(), before);
});
test("source ID conflicts abort without partially adding artifacts or changing the project", async () => {
  const store = fixture();
  await store.update((data) => { data.artifacts.push({ id: "quetzal-source-extension-adm-hardware", ownerId: "another-project" }); });
  const before = store.read();
  await assert.rejects(attachQuetzalArchitectureSources(store), /source ID conflict/u);
  assert.deepEqual(store.read(), before);
});
