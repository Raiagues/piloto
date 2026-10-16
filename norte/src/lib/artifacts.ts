import { API_ORIGIN } from "./auth";
import type { ArtifactStatus, ConnectedArtifact } from "./team";
import type { Language } from "./types";

/** Where to open or download this source: the stored file, or its link. */
export function artifactHref(artifact: Pick<ConnectedArtifact, "url" | "contentPath">): string {
  return artifact.contentPath ? `${API_ORIGIN}/api${artifact.contentPath}` : artifact.url;
}

export function artifactIsStoredFile(artifact: Pick<ConnectedArtifact, "url" | "contentPath">): boolean {
  return Boolean(artifact.contentPath) || artifact.url.startsWith("data:");
}

export function artifactStatus(artifact: Pick<ConnectedArtifact, "readability">): ArtifactStatus {
  return artifact.readability?.status ?? "unknown";
}

export function artifactIsReadable(artifact: Pick<ConnectedArtifact, "readability">): boolean {
  return ["parsed", "pdf"].includes(artifactStatus(artifact));
}

/**
 * Plain wording for the artifact card. It answers one question — can Norte use
 * this source? — without exposing how the file is decoded.
 */
export function artifactStatusLabel(artifact: Pick<ConnectedArtifact, "readability">, language: Language): { text: string; usable: boolean } {
  const pt = language === "pt";
  switch (artifactStatus(artifact)) {
    case "parsed":
    case "pdf":
      return { text: pt ? "Fonte conectada" : "Source connected", usable: true };
    case "metadata_only":
      return { text: pt ? "Somente link · conteúdo não lido" : "Link only · content not read", usable: false };
    case "not_parsed":
      return { text: pt ? "Ainda não legível pelo Norte" : "Not yet readable by Norte", usable: false };
    default:
      return { text: pt ? "Verificando" : "Checking", usable: false };
  }
}

export function formatArtifactSize(size: number | undefined): string {
  if (!size) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
