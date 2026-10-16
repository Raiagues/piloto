/** Controlled retrieval of the official validation documents.
 *
 * This is not, and must never become, a URL-fetching endpoint. It is reachable
 * only from the guarded seed command, every host is on an explicit allowlist
 * taken from the source manifest, redirects are followed manually and
 * re-validated at each hop, and resolved addresses are rejected when they point
 * anywhere private. Bytes are stored only after size, type and hash checks.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;
const ACCEPTED_CONTENT_TYPES = new Map([
  ["application/pdf", ["application/pdf", "application/octet-stream", "binary/octet-stream"]],
  ["text/markdown", ["text/markdown", "text/plain", "text/x-markdown", "application/octet-stream"]],
  ["text/plain", ["text/plain", "application/octet-stream"]],
  ["text/csv", ["text/csv", "text/plain", "application/octet-stream"]],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", "binary/octet-stream", "application/zip"]]
]);
const FILE_SIGNATURES = new Map([
  ["application/pdf", (bytes) => bytes.subarray(0, 5).toString("ascii") === "%PDF-"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (bytes) => bytes.subarray(0, 2).toString("ascii") === "PK"]
]);

export function importError(message) {
  return Object.assign(new Error(message), { code: "SOURCE_IMPORT_REFUSED" });
}

/** Loopback, private, link-local, unique-local and unspecified ranges. */
export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (family !== 6) return true;
  const value = address.toLowerCase().replace(/^\[|\]$/gu, "").split("%")[0];
  if (["::", "::1"].includes(value)) return true;
  if (/^(?:fe[89ab]|f[cd])/u.test(value)) return true;
  // IPv4-mapped addresses inherit the IPv4 verdict.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(value);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

/** Every hop must be HTTPS, credential-free and on the manifest's allowlist. */
export async function assertReachableUrl(rawUrl, allowedHosts, { resolveHost = lookup } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw importError(`Refused: ${rawUrl} is not a valid URL.`); }
  if (url.protocol !== "https:") throw importError(`Refused: ${url.href} does not use HTTPS.`);
  if (url.username || url.password) throw importError(`Refused: ${url.host} carries embedded credentials.`);
  if (!allowedHosts.includes(url.hostname)) throw importError(`Refused: ${url.hostname} is not an allowed source host.`);
  const addresses = await resolveHost(url.hostname, { all: true }).catch(() => { throw importError(`Refused: ${url.hostname} could not be resolved.`); });
  const list = Array.isArray(addresses) ? addresses : [addresses];
  if (!list.length) throw importError(`Refused: ${url.hostname} resolved to no address.`);
  for (const entry of list) {
    if (isPrivateAddress(entry.address)) throw importError(`Refused: ${url.hostname} resolves to the non-public address ${entry.address}.`);
  }
  return url;
}

function acceptableContentType(header, expectedMimeType) {
  if (!header) return true;
  const value = header.split(";")[0].trim().toLowerCase();
  return (ACCEPTED_CONTENT_TYPES.get(expectedMimeType) ?? [expectedMimeType]).includes(value);
}

/**
 * Fetch one manifest source and return verified bytes plus provenance.
 * Nothing is written anywhere; the caller decides what to persist.
 */
export async function fetchManifestSource(source, { allowedHosts, fetchImpl = fetch, resolveHost = lookup } = {}) {
  if (source.role === "evaluation_reference") throw importError(`Refused: ${source.id} is evaluator-only and must never enter project memory.`);
  let target = await assertReachableUrl(source.sourceUrl, allowedHosts, { resolveHost });
  let response;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    response = await fetchImpl(target.href, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: "*/*" } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw importError(`Refused: ${source.id} returned a redirect without a destination.`);
    if (hop === MAX_REDIRECTS) throw importError(`Refused: ${source.id} exceeded the redirect limit.`);
    target = await assertReachableUrl(new URL(location, target).href, allowedHosts, { resolveHost });
  }
  if (!response.ok) throw importError(`Refused: ${source.id} returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type");
  if (!acceptableContentType(contentType, source.expectedMimeType)) {
    throw importError(`Refused: ${source.id} served content-type ${contentType}, not ${source.expectedMimeType}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw importError(`Refused: ${source.id} declares ${declaredLength} bytes, above the ${MAX_SOURCE_BYTES} byte limit.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw importError(`Refused: ${source.id} returned an empty body.`);
  if (bytes.length > MAX_SOURCE_BYTES) throw importError(`Refused: ${source.id} is ${bytes.length} bytes, above the ${MAX_SOURCE_BYTES} byte limit.`);
  const signature = FILE_SIGNATURES.get(source.expectedMimeType);
  if (signature && !signature(bytes)) throw importError(`Refused: ${source.id} does not carry a valid ${source.expectedMimeType} file signature.`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // A pinned revision is immutable, so a hash mismatch is a hard failure.
  // Publisher-hosted files may be re-issued: report the change, do not refuse.
  if (source.sha256 && source.sha256 !== sha256) {
    throw importError(`Refused: ${source.id} hash ${sha256} does not match the pinned ${source.sha256}.`);
  }
  return {
    sourceId: source.id,
    bytes,
    sha256,
    size: bytes.length,
    mimeType: source.storedMimeType,
    finalUrl: target.href,
    contentType: contentType || "",
    retrievedAt: new Date().toISOString(),
    hashChanged: Boolean(source.knownSha256 && source.knownSha256 !== sha256),
    knownSha256: source.knownSha256 ?? null
  };
}

/** The provenance kept on the stored artifact, so its origin stays auditable. */
export function sourceProvenance(source, retrieval) {
  return {
    sourceId: source.id,
    publisher: source.publisher,
    sourceUrl: source.sourceUrl,
    retrievedFrom: retrieval.finalUrl,
    repository: source.repository ?? null,
    revision: source.revision ?? null,
    path: source.path ?? null,
    originalFileName: source.fileName,
    retrievedAt: retrieval.retrievedAt,
    sha256: retrieval.sha256,
    mimeType: retrieval.mimeType,
    size: retrieval.size,
    license: source.license ?? null,
    role: source.role,
    contextPolicy: source.contextPolicy ?? null
  };
}

/** Base64 data URL: the representation `prepareProjectArtifacts` already reads. */
export function artifactContentUrl(retrieval) {
  return `data:${retrieval.mimeType};base64,${retrieval.bytes.toString("base64")}`;
}
