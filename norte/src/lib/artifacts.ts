import { API_ORIGIN } from './auth';
import type { ArtifactStatus, ConnectedArtifact } from './team';

/** Where to open or download this source: the stored file, or its link. */
export function artifactHref(artifact: Pick<ConnectedArtifact, 'url' | 'contentPath'>): string {
  return artifact.contentPath ? `${API_ORIGIN}/api${artifact.contentPath}` : artifact.url;
}

export function artifactStatus(artifact: Pick<ConnectedArtifact, 'readability'>): ArtifactStatus {
  return artifact.readability?.status ?? 'unknown';
}
