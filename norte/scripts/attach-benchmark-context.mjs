/** Attach the deterministic benchmark documents to a project over the real API.
 *
 * Application startup deliberately seeds no documents: the validation project's
 * real sources come from scripts/seed-quetzal-validation.mjs. Browser and
 * diagnostic runs that need a fixed, offline context therefore attach the
 * benchmark documents themselves, so a fixture can never be mistaken for the
 * product's own seeded memory.
 */
import { createQuetzalArtifacts } from "../benchmark/quetzal1/context/design-context.mjs";

export async function attachBenchmarkContext(app, headers, projectId) {
  const project = (await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers })).json().project;
  const ids = [];
  for (const artifact of createQuetzalArtifacts(projectId)) {
    const response = await app.inject({ method: "POST", url: "/api/artifacts", headers, payload: {
      kind: "document", label: artifact.label, url: artifact.url, description: artifact.description,
      fileName: artifact.fileName, mimeType: artifact.mimeType, size: artifact.size,
      tags: artifact.tags, scope: "project", ownerId: projectId
    } });
    if (response.statusCode !== 201) throw new Error(`Benchmark context upload failed: ${response.statusCode} ${response.body}`);
    ids.push(response.json().artifact.id);
  }
  const next = { ...project, context: { ...project.context, projectArtifactIds: ids } };
  const saved = await app.inject({ method: "PUT", url: `/api/projects/${projectId}`, headers, payload: next });
  if (saved.statusCode !== 200) throw new Error(`Benchmark context link failed: ${saved.statusCode} ${saved.body}`);
  return ids;
}

/** The same fixture as an in-memory project, for scripts that never touch the API. */
export function benchmarkProjectWithContext(project) {
  const artifacts = createQuetzalArtifacts(project.id);
  return { project: { ...project, context: { ...project.context, projectArtifactIds: artifacts.map((artifact) => artifact.id) } }, artifacts };
}
