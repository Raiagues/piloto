import { prepareProjectArtifacts, validateExtractedSystem } from "./system-ai.mjs";
import { mergeSourceModels } from "./merge-source-models.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const projectId = "quetzal1-eps-comms";
const packageId = "quetzal-mission-sources-v1";
const directory = new URL("../examples/quetzal1/architecture-sources/", import.meta.url);

// One-time, additive migration requested for the existing real-source project.
// It preserves technical values/program selection and archives the original model.
export async function attachQuetzalArchitectureSources(store) {
  const snapshot = store.read();
  const eligible = (data) => {
    const project = data.workspace.projects?.[projectId]?.document;
    return project && !project.sourcePackages?.includes(packageId) && data.artifacts.some((artifact) => artifact.ownerId === projectId && artifact.provenance?.sourceId === "quetzal-eps-hardware-readme");
  };
  if (!eligible(snapshot)) return { added: 0 };
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  const artifacts = [];
  const timestamp = new Date().toISOString();
  for (const source of manifest.sources) {
    if (source.classification !== "design-context" || !/^(?:(ADCS|ADM)-(hardware|software)|MISSION-overview)\.txt$/u.test(source.file)) throw new Error("Invalid Quetzal source package.");
    const bytes = await readFile(new URL(source.file, directory));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== source.bytes || sha256 !== source.sha256) throw new Error(`Quetzal source integrity mismatch: ${source.id}`);
    artifacts.push({ id: `quetzal-source-extension-${source.id.toLowerCase()}`, kind: "document", label: `Quetzal-1 ${source.id.replace("-", " ")}`, description: "Official design documentation excerpt. Attribution, pinned revision and adaptation recorded in the file.", scope: "project", ownerId: projectId, fileName: source.file, mimeType: "text/plain", size: bytes.length, url: `data:text/plain;base64,${bytes.toString("base64")}`, tags: ["quetzal1", "project-source"], official: false, createdBy: null, connectedAt: timestamp, updatedAt: timestamp,
      provenance: { sourceId: source.id, publisher: manifest.author, sourceUrl: source.sourceUrl, revision: source.sourceRevision, path: source.sourcePath, retrievedAt: manifest.retrievedAt, sha256, mimeType: "text/plain", size: bytes.length, license: source.license, role: "project_context", contextPolicy: "Attributed design-only excerpt; no flight outcomes or evaluator content.", originalSha256: source.originalSha256 } });
  }
  const validationProject = { ...snapshot.workspace.projects[projectId].document, context: { ...snapshot.workspace.projects[projectId].document.context, projectArtifactIds: artifacts.map((item) => item.id), teamArtifactIds: [] } };
  const parsed = prepareProjectArtifacts(validationProject, artifacts);
  const fragments = [];
  for (const source of manifest.sources) {
    const model = JSON.parse(await readFile(new URL(`../examples/quetzal1/architecture-extraction/norte-extra-${source.id}.json`, import.meta.url), "utf8"));
    // Archived outputs retain their original hierarchy; new live extractions are strict.
    // Recheck recorded provider output against the exact bytes being attached.
    fragments.push({ id: source.id, model: validateExtractedSystem(model, validationProject, parsed, model.model, { legacyHierarchy: true }) });
  }
  return store.update((data) => {
    if (!eligible(data)) return { added: 0 };
    const record = data.workspace.projects[projectId], project = record.document;
    let added = 0;
    const linked = new Set(project.context.projectArtifactIds || []);
    for (const artifact of artifacts) {
      const existing = data.artifacts.find((item) => item.id === artifact.id);
      if (existing && (existing.ownerId !== projectId || existing.provenance?.sha256 !== artifact.provenance.sha256)) throw new Error(`Quetzal source ID conflict: ${artifact.id}`);
      if (!existing) { data.artifacts.push(artifact); added++; }
      linked.add(artifact.id);
    }
    const expanded = project.engineeringSystem ? mergeSourceModels(project.engineeringSystem, fragments) : undefined;
    record.document = { ...project, ...(expanded ? { engineeringSystem: expanded, navigation: { ...project.navigation, systemLayouts: { ...project.navigation.systemLayouts, architecture: {} } }, sourceExtensionHistory: [...(project.sourceExtensionHistory || []), { packageId, timestamp, baseline: project.engineeringSystem, layouts: project.navigation.systemLayouts ?? {} }] } : {}), context: { ...project.context, projectArtifactIds: [...linked] }, sourcePackages: [...(project.sourcePackages || []), packageId], memoryRevision: (project.memoryRevision || 0) + 1, updatedAt: timestamp };
    record.revision = (record.revision || 0) + 1;
    record.updatedAt = timestamp;
    if (data.workspace.project?.document?.id === projectId) data.workspace.project = record;
    return { added };
  });
}
