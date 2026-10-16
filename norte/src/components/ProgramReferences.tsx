import { useState } from 'react';
import { BookOpenCheck, FilePlus2, FolderOpen, Link2 } from 'lucide-react';
import { ensureProgramReferenceFolder } from '../../shared/workspace-templates.mjs';
import { isProjectAdmin } from '../../shared/project-organization.mjs';
import { useAuth } from '../lib/auth';
import { EditorPopup } from './EditorPopup';
import type { MissionProject } from '../lib/projectStore';
import type { ConnectedArtifact } from '../lib/team';
import type { Language } from '../lib/types';

type Props = { project: MissionProject; artifacts: ConnectedArtifact[]; language: Language; programName?: string; onSave: (next: MissionProject) => Promise<void>; onFolder: (id: string) => void; onUpload: () => void };
export function ProgramReferences({ project, artifacts, language, programName, onSave, onFolder, onUpload }: Props) {
  const { user } = useAuth(), admin = isProjectAdmin(project, user), pt = language === 'pt';
  const [editing, setEditing] = useState(false), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const referenceIds = new Set(project.context.programArtifactIds || []);
  const references = artifacts.filter(item => referenceIds.has(item.id) || Boolean(project.context.programFolderId && item.folderId === project.context.programFolderId));
  async function folder(upload = false) {
    setBusy(true); setError('');
    try { const next = ensureProgramReferenceFolder(project, language); if (next !== project) await onSave(next); onFolder(next.context.programFolderId!); if (upload) onUpload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha'); } finally { setBusy(false); }
  }
  return <><section className="pm-reference-strip"><BookOpenCheck size={17} /><div><strong>{programName || (pt ? 'Edital e referências' : 'Program and references')}</strong><span>{references.length ? `${references.length} ${pt ? 'documentos de referência' : 'reference documents'}` : (pt ? 'Vincule o edital, normas ou documentos que orientam o projeto.' : 'Link the program brief, standards or documents that guide the project.')}</span></div><div className="pm-reference-actions">{(admin || project.context.programFolderId) && <button type="button" disabled={busy} onClick={() => void folder()}><FolderOpen size={15} />{pt ? 'Abrir pasta' : 'Open folder'}</button>}{admin && <><button type="button" disabled={busy} onClick={() => { setSelected([...referenceIds]); setError(''); setEditing(true); }}><Link2 size={15} />{pt ? 'Vincular existente' : 'Link existing'}</button><button type="button" disabled={busy} onClick={() => void folder(true)}><FilePlus2 size={15} />{pt ? 'Adicionar arquivo' : 'Add file'}</button></>}</div></section>{error && !editing && <p role="alert">{error}</p>}
    {editing && <EditorPopup title={pt ? 'Vincular referências do projeto' : 'Link project references'} closeLabel={pt ? 'Fechar' : 'Close'} onClose={() => setEditing(false)}><div className="editor-popup-body pm-reference-picker"><p>{pt ? 'Selecione arquivos já presentes na memória. São atalhos para os documentos originais, sem cópias.' : 'Select files already in project memory. These are shortcuts to originals, without copies.'}</p>{artifacts.map(artifact => <label key={artifact.id}><input type="checkbox" checked={selected.includes(artifact.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, artifact.id] : ids.filter(id => id !== artifact.id))} /><span>{artifact.label}<small>{artifact.fileName || (pt ? 'Documento vinculado' : 'Linked document')}</small></span></label>)}{!artifacts.length && <p>{pt ? 'Adicione um arquivo à memória para vinculá-lo aqui.' : 'Add a file to project memory to link it here.'}</p>}{error && <p role="alert">{error}</p>}</div><footer><button type="button" onClick={() => setEditing(false)}>{pt ? 'Cancelar' : 'Cancel'}</button><button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const next = ensureProgramReferenceFolder(project, language); await onSave({ ...next, context: { ...next.context, programArtifactIds: [...new Set(selected)] } }); onFolder(next.context.programFolderId!); setEditing(false); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha'); } finally { setBusy(false); } }}>{pt ? 'Salvar vínculos' : 'Save links'}</button></footer></EditorPopup>}
  </>;
}
