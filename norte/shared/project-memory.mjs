/** The single definition of Project Memory readiness.
 *
 * The client footer and the server's conception guard must never disagree, so
 * both import this module. Content classification itself is server-only (it
 * needs to decode the stored bytes); the server publishes its verdict on each
 * artifact as `readability`, and every readiness decision reads that verdict.
 */

/** Statuses whose content actually reaches the extraction model. */
export const READABLE_ARTIFACT_STATUSES = Object.freeze(["parsed", "pdf"]);

/** Every status `classifyArtifactSource` can return, in reporting order. */
export const ARTIFACT_STATUSES = Object.freeze(["parsed", "pdf", "not_parsed", "metadata_only"]);

export function isReadableStatus(status) {
  return READABLE_ARTIFACT_STATUSES.includes(status);
}

/** The server's verdict, or an explicit unknown when it has not published one. */
export function artifactReadability(artifact) {
  const status = artifact?.readability?.status;
  return ARTIFACT_STATUSES.includes(status)
    ? { status, reason: artifact.readability.reason || "" }
    : { status: "unknown", reason: "" };
}

/** Artifacts this project actually owns or has linked from its team. */
export function linkedProjectArtifacts(project, artifacts) {
  const teamIds = new Set(project?.context?.teamArtifactIds || []);
  const projectIds = new Set(project?.context?.projectArtifactIds || []);
  return (artifacts || []).filter((artifact) =>
    (teamIds.has(artifact.id) && artifact.scope === "team" && artifact.ownerId === project?.context?.teamId)
    || (projectIds.has(artifact.id) && artifact.scope === "project" && artifact.ownerId === project?.id));
}

/**
 * Two separate facts, never merged into one optimistic "ready".
 *
 * `basicProjectReady` covers the identity a project needs to exist at all.
 * `engineeringMemoryReadable` is the condition the extraction service enforces:
 * at least one linked artifact whose content can be read. `missing` lists
 * stable codes so each interface writes its own wording.
 */
export function projectMemoryReadiness(project, artifacts) {
  const linked = linkedProjectArtifacts(project, artifacts);
  const readable = linked.filter((artifact) => isReadableStatus(artifactReadability(artifact).status));
  const missing = [];
  if (!String(project?.name || "").trim()) missing.push("name");
  if (!project?.context?.teamId) missing.push("team");
  const basicProjectReady = missing.length === 0;
  const engineeringMemoryReadable = readable.length > 0;
  if (!engineeringMemoryReadable) missing.push("readable-artifact");
  return {
    basicProjectReady,
    engineeringMemoryReadable,
    ready: basicProjectReady && engineeringMemoryReadable,
    linkedCount: linked.length,
    readableCount: readable.length,
    readableArtifactIds: readable.map((artifact) => artifact.id),
    missing
  };
}
