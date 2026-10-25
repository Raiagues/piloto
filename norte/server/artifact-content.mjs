/** Read the literal content stored for a document.
 * The artifacts API publishes this result so the interface and the engineering
 * analysis agree on which files are readable. External links remain metadata.
 */
import { xlsxToCsv } from "./xlsx-text.mjs";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const MAX_FILE_BYTES = 48 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const MAX_TEXT_CHARACTERS = 5_000_000;
export const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "text/javascript", "application/javascript", "text/x-python", "text/x-c", "text/typescript"]);
export const SPREADSHEET_MIMES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const OPAQUE_OFFICE_FILE = /\.(docx?|xls|od[st]|rtf)$/iu;
const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;
const runFile = promisify(execFile);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_READER = `import io,json,sys,zipfile,xml.etree.ElementTree as E
b=sys.stdin.buffer.read(50331649)
if len(b)>50331648: raise ValueError('Document too large')
z=zipfile.ZipFile(io.BytesIO(b)); entries=z.infolist()
if len(entries)>2048 or sum(x.file_size for x in entries)>67108864: raise ValueError('Archive expansion limit')
names=[x.filename for x in entries]
if len(set(names))!=len(names): raise ValueError('Duplicate archive entries')
if any(x.startswith('/') or '..' in x.split('/') for x in names): raise ValueError('Unsafe archive path')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}; out=[]
for name in names:
 if name not in ['word/document.xml','word/footnotes.xml','word/endnotes.xml'] and not (name.startswith('word/header') or name.startswith('word/footer')): continue
 if not name.endswith('.xml'): continue
 with z.open(name) as f: raw=f.read(20971521)
 if len(raw)>20971520 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('Unsafe XML')
 root=E.fromstring(raw)
 for p in root.findall('.//w:p',ns):
  text=''.join((n.text or '') if n.tag.endswith('}t') else '\\t' if n.tag.endswith('}tab') else '\\n' if n.tag.endswith('}br') else '' for n in p.iter())
  if text: out.append(text)
text='\\n'.join(out)
if not text.strip() or len(text)>5000000: raise ValueError('Unsupported document text')
sys.stdout.write(text)
`;
const docxCache = new Map();

function docxText(bytes) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (docxCache.has(hash)) return docxCache.get(hash);
  const text = execFileSync("python3", ["-c", DOCX_READER], { input: bytes, encoding: "utf8", timeout: 10_000, maxBuffer: 21_000_000, stdio: ["pipe", "pipe", "pipe"] });
  if (docxCache.size >= 4) docxCache.delete(docxCache.keys().next().value);
  docxCache.set(hash, text);
  return text;
}

export const ARTIFACT_STATUS_REASONS = {
  metadata_only: "External links are metadata only; their contents have not been fetched.",
  invalid: "File content is invalid or exceeds the document processing limit.",
  budget: "The selected documents exceed the total document processing limit; this file was not read.",
  pdf: "PDF será lido por página; esquemas e páginas sem texto precisam de revisão visual ou OCR.",
  text: "Codificação inválida ou texto acima de 5 milhões de caracteres; nenhuma parte foi truncada.",
  spreadsheet: "The spreadsheet could not be read. Export it as CSV or PDF.",
  unsupported: "Not parsed yet. Export this document or spreadsheet as PDF, CSV, or UTF-8 text."
};

/**
 * Classify one stored artifact.
 *
 * `remainingBytes` applies the shared parsing budget while preparing a whole
 * project; the artifacts API omits it so each file is judged on its own.
 */
export function classifyArtifactSource(artifact, { remainingBytes = Number.POSITIVE_INFINITY } = {}) {
  const fileName = artifact?.fileName || "";
  if ((artifact?.url?.length || 0) > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 256) return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.invalid, byteLength: 0 };
  const match = DATA_URL.exec(artifact?.url || "");
  if (!match) return { status: "metadata_only", reason: ARTIFACT_STATUS_REASONS.metadata_only, byteLength: 0 };
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2] || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.invalid, byteLength: 0 };
  }
  if (bytes.length > remainingBytes) return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.budget, byteLength: 0 };
  const mimeType = match[1];
  if (mimeType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { status: "pdf", reason: ARTIFACT_STATUS_REASONS.pdf, byteLength: bytes.length, inlineData: { mimeType: "application/pdf", data: match[2] } };
  }
  if (mimeType === DOCX_MIME) {
    try { return { status: "parsed", reason: "", byteLength: bytes.length, text: docxText(bytes) }; }
    catch { return { status: "not_parsed", reason: "DOCX inválido, protegido ou acima dos limites de leitura segura; exporte como PDF ou texto.", byteLength: 0 }; }
  }
  if (TEXT_MIMES.has(mimeType) && !OPAQUE_OFFICE_FILE.test(fileName)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0") || text.length > MAX_TEXT_CHARACTERS) throw new Error("Unsupported text.");
      return { status: "parsed", reason: "", byteLength: bytes.length, text };
    } catch {
      return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.text, byteLength: 0 };
    }
  }
  if (SPREADSHEET_MIMES.has(mimeType)) {
    try {
      // Literal cell text only: no formula evaluation and no external references.
      const text = xlsxToCsv(bytes).map((sheet) => `# ${sheet.name}\n${sheet.csv}`).join("\n\n");
      if (!text.trim() || text.length > MAX_TEXT_CHARACTERS) throw new Error("Unsupported spreadsheet.");
      return { status: "parsed", reason: "", byteLength: bytes.length, text };
    } catch {
      return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.spreadsheet, byteLength: 0 };
    }
  }
  return { status: "not_parsed", reason: ARTIFACT_STATUS_REASONS.unsupported, byteLength: 0 };
}

/** The verdict published to clients: no file bytes, only whether it is usable. */
export function artifactReadabilityRecord(artifact) {
  const { status, reason } = classifyArtifactSource(artifact);
  return { status, reason };
}

/** Parse all PDF pages locally. Never trust client-provided extracted text. */
export async function parseArtifactDocument(artifact, options = {}) {
  const classified = classifyArtifactSource(artifact, options);
  if (classified.status !== "pdf") return { ...classified, pages: [] };
  const directory = await mkdtemp(join(tmpdir(), "norte-document-"));
  try {
    const path = join(directory, "source.pdf");
    await writeFile(path, Buffer.from(classified.inlineData.data, "base64"), { mode: 0o600 });
    const info = await runFile("pdfinfo", [path], { timeout: 30_000, maxBuffer: 128_000 });
    const pageCount = Number(/^Pages:\s+(\d+)/mu.exec(info.stdout)?.[1]);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5000) throw new Error("PDF page limit");
    const output = await runFile("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], { timeout: 90_000, maxBuffer: MAX_TEXT_CHARACTERS * 4 + 1 });
    const parts = output.stdout.split("\f");
    if (parts.length === pageCount + 1 && !parts.at(-1).trim()) parts.pop();
    if (parts.length !== pageCount || output.stdout.length > MAX_TEXT_CHARACTERS) throw new Error("PDF text limit or page mismatch");
    const pages = [], missingPages = [];
    let text = "";
    for (const [index, part] of parts.entries()) {
      const start = text.length;
      text += part + "\f";
      pages.push({ page: index + 1, start, end: start + part.length });
      if (part.trim().length < 20) missingPages.push(index + 1);
    }
    if (!text.replaceAll("\f", "").trim()) return { status: "not_parsed", reason: "PDF sem texto extraível. É necessário OCR antes de gerar o mapa.", byteLength: classified.byteLength, pages, pageCount, missingPages };
    return { status: "parsed", reason: missingPages.length ? `Páginas sem texto suficiente: ${missingPages.join(", ")}. Revise o original ou aplique OCR.` : "", byteLength: classified.byteLength, text, pages, pageCount, missingPages, format: "pdf" };
  } catch (error) {
    return { status: "not_parsed", reason: error.code === "ENOENT" ? "Leitor PDF indisponível no servidor. Instale poppler-utils." : "Não foi possível ler todas as páginas deste PDF. Verifique proteção, integridade e limites; nenhum trecho foi omitido silenciosamente.", byteLength: classified.byteLength, pages: [] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
