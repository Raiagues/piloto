import { readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../project-documents/quetzal-1');
export const VALIDATION_DOCUMENTS_MISSING_MESSAGE = 'Os documentos da conta de teste ainda não foram disponibilizados neste ambiente. Peça ao administrador para provisionar o corpus Quetzal-1 e tente novamente.';
let cached;
function missingDocuments() {
  return Object.assign(new Error(VALIDATION_DOCUMENTS_MISSING_MESSAGE), { statusCode: 503, code: 'VALIDATION_DOCUMENTS_MISSING' });
}
function readCorpusFile(path, encoding) {
  try { return readFileSync(path, encoding); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    // A deployment may contain the public manifest but omit local reference
    // files. Do not leak a filesystem path or silently seed a partial project.
    throw missingDocuments();
  }
}
/** Explicit local corpus import. Never fetch remote links or benchmark answers. */
export function validationDocuments(directory = process.env.NORTE_VALIDATION_DOCUMENTS || defaultDirectory) {
  if (cached?.directory === directory) return cached.documents;
  const manifestPath = resolve(directory, 'manifest.json');
  const manifest = JSON.parse(readCorpusFile(manifestPath, 'utf8'));
  const documents = [];
  for (const source of manifest.sources || []) {
    if (!['project_context', 'supporting_datasheet'].includes(source.role)) continue;
    if (typeof source.text_path !== 'string' || !source.text_path.trim()) throw missingDocuments();
    const path = resolve(directory, source.text_path);
    if (!path.startsWith(resolve(directory) + sep) || /evaluation_reference|benchmark/iu.test(source.text_path)) throw new Error('Fonte de avaliação não permitida na memória do projeto.');
    const bytes = readCorpusFile(path), hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== source.text_sha256) throw new Error(`A fonte local ${source.id} foi alterada; confira o manifesto antes de importar.`);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    documents.push({ id: source.id, title: source.title, text, fileName: `${source.id}.txt`, description: `${source.description} Texto integral da fonte; original preservado localmente.`,
      provenance: { sourceId: source.id, sourceUrl: source.source_url, publisher: source.publisher, license: source.license, role: source.role,
        sha256: hash, originalSha256: source.sha256, originalPath: source.path, originalPages: source.pages, originalFileName: source.filename, retrievedAt: source.retrieved_at, extractionMethod: source.extraction_method } });
  }
  if (documents.length === 0) throw missingDocuments();
  cached = { directory, documents };
  return documents;
}
