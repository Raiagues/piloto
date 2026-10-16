export type ArtifactStatus = "parsed" | "pdf" | "not_parsed" | "metadata_only" | "unknown";
export type ArtifactReadability = { status: ArtifactStatus; reason: string };
export type ReadinessArtifact = {
  id: string;
  scope?: string;
  ownerId?: string | null;
  readability?: { status?: string; reason?: string } | null;
};
export type ReadinessProject = {
  id: string;
  name: string;
  context?: { teamId?: string | null; teamArtifactIds?: string[]; projectArtifactIds?: string[] } | null;
};
export type ProjectMemoryReadiness = {
  basicProjectReady: boolean;
  engineeringMemoryReadable: boolean;
  ready: boolean;
  linkedCount: number;
  readableCount: number;
  readableArtifactIds: string[];
  missing: Array<"name" | "team" | "readable-artifact">;
};
export const READABLE_ARTIFACT_STATUSES: readonly string[];
export const ARTIFACT_STATUSES: readonly string[];
export function isReadableStatus(status: string | undefined): boolean;
export function artifactReadability(artifact: ReadinessArtifact | null | undefined): ArtifactReadability;
export function linkedProjectArtifacts<T extends ReadinessArtifact>(project: ReadinessProject, artifacts: T[]): T[];
export function projectMemoryReadiness(project: ReadinessProject, artifacts: ReadinessArtifact[]): ProjectMemoryReadiness;
