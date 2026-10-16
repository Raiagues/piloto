import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, LockKeyhole, Pencil, Search, X } from 'lucide-react';
import { folderPath } from '../../shared/project-organization.mjs';
import { MemoryFolders } from './MemoryFolders';
import { DocumentPresence } from './DocumentPresence';
import { API_ORIGIN } from '../lib/auth';
import { artifactHref } from '../lib/artifacts';
import { memoryFolderChain, memoryFolderIncludes } from '../lib/memoryNavigation';
import type { ConnectedArtifact } from '../lib/team';
import type { MissionProject } from '../lib/projectStore';
import type { Language } from '../lib/types';
export function ArtifactPermission({ artifact, language }: { artifact: ConnectedArtifact; language: Language }) {
  const pt = language === 'pt', edit = artifact.scope !== 'team' && artifact.canEdit;
  return <span className={`artifact-permission ${edit ? 'editable' : 'readonly'}`} title={edit ? (pt ? 'Você pode editar este documento.' : 'You can edit this document.') : artifact.editReason || (pt ? 'Edição restrita aos responsáveis pelo setor.' : 'Editing is restricted to sector participants.')}>
    {edit ? <Pencil size={13} /> : <LockKeyhole size={13} />}{edit ? (pt ? 'Pode editar' : 'Can edit') : (pt ? 'Somente leitura' : 'Read only')}
  </span>;
}
export function MemoryWorkspace({ project, artifacts, language, selectedId, onSelect, folderId, onFolder, onSave, onEdit, onMove, onClose }: { project: MissionProject; artifacts: ConnectedArtifact[]; language: Language; selectedId: string | null; onSelect: (id: string) => void; folderId: string; onFolder: (id: string) => void; onSave: (next: MissionProject) => Promise<void>; onEdit: (artifact: ConnectedArtifact) => void; onMove?: (id: string, folderId: string) => Promise<void>; onClose: () => void }) {
  const pt = language === 'pt', artifact = artifacts.find(a => a.id === selectedId), [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  const [text, setText] = useState(''), [error, setError] = useState('');
  const visible = artifacts.filter(a => memoryFolderIncludes(project, a, folderId) && `${a.label} ${a.fileName || ''} ${folderPath(project, a.folderId)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const currentIndex = visible.findIndex(a => a.id === selectedId);
  const source = artifact ? artifact.documentText !== undefined ? `${API_ORIGIN}/api/artifacts/${artifact.id}/pdf` : artifactHref(artifact) : '';
  const pdf = artifact?.documentText !== undefined || artifact?.mimeType === 'application/pdf';
  const textPreview = artifact?.mimeType?.startsWith('text/') && artifact.documentText === undefined;
  useEffect(() => {
    setText(''); setError(''); if (!artifact?.contentPath || !textPreview) return;
    const controller = new AbortController();
    void fetch(source, { credentials: 'include', signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(pt ? 'Documento indisponível.' : 'Document unavailable.'); const value = await r.text(); if (!controller.signal.aborted) setText(value); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [source, artifact?.contentPath, textPreview, pt]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; dialogRef.current?.querySelector<HTMLButtonElement>('header button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); } if (e.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, iframe') || []).filter(el => el.getClientRects().length), first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  function chooseFolder(id: string) { onFolder(id); setQuery(''); const first = artifacts.find(a => memoryFolderIncludes(project, a, id)); onSelect(first?.id || ''); }
  return <div className="memory-reader-backdrop"><section ref={dialogRef} className="memory-workspace memory-reader-modal" role="dialog" aria-modal="true" aria-label={pt ? 'Documentos do projeto' : 'Project documents'}>
    <header><div><small>{project.name}</small><strong>{pt ? 'Documentos' : 'Documents'}</strong></div><div className="memory-reader-pager"><button type="button" aria-label={pt ? 'Documento anterior' : 'Previous document'} disabled={currentIndex <= 0} onClick={() => onSelect(visible[currentIndex - 1].id)}><ChevronLeft size={17} /></button><span>{currentIndex >= 0 ? currentIndex + 1 : '—'} / {visible.length}</span><button type="button" aria-label={pt ? 'Próximo documento' : 'Next document'} disabled={currentIndex < 0 || currentIndex >= visible.length - 1} onClick={() => onSelect(visible[currentIndex + 1].id)}><ChevronRight size={17} /></button><button type="button" onClick={onClose} aria-label={pt ? 'Fechar documento' : 'Close document'}><X size={18} /></button></div></header>
    <div className="memory-workspace-body"><aside className="memory-reader-directory"><label className="pm-document-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={pt ? 'Buscar no leitor' : 'Search in reader'} placeholder={pt ? 'Buscar documento ou pasta' : 'Find document or folder'} /></label><MemoryFolders project={project} language={language} artifacts={artifacts} selected={folderId} onSelect={chooseFolder} onSave={onSave} activeArtifactId={selectedId} onOpenArtifact={onSelect} onMove={onMove} /><nav className="memory-reader-results" aria-label={pt ? 'Documentos da pasta' : 'Folder documents'}>{visible.map(item => <button key={item.id} type="button" aria-current={item.id === selectedId ? 'true' : undefined} onClick={() => onSelect(item.id)}><FileText size={15} /><span>{item.label}<small>{folderPath(project, item.folderId) || (pt ? 'Sem pasta' : 'Unfiled')}</small></span></button>)}</nav></aside>
      <div className="memory-preview">{artifact ? <><div className="memory-preview-heading"><nav className="memory-breadcrumb" aria-label={pt ? 'Local do documento' : 'Document location'}><button type="button" onClick={() => chooseFolder('all')}>{project.name}</button>{memoryFolderChain(project, artifact.folderId).map(folder => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => chooseFolder(folder.id)}>{folder.name}</button></span>)}<ChevronRight size={12} /><span>{artifact.label}</span></nav><div className="memory-reader-title"><div><h2>{artifact.label}</h2><ArtifactPermission artifact={artifact} language={language} /></div><div className="memory-preview-actions">{artifact.canEdit && artifact.scope !== 'team' && <button type="button" onClick={() => onEdit(artifact)}><Pencil size={15} />{pt ? 'Editar documento' : 'Edit document'}</button>}<a href={pdf ? `${source}?download=1` : `${source}${artifact.contentPath ? '?download=1' : ''}`} download={artifact.contentPath ? artifact.fileName || artifact.label : undefined} target={artifact.contentPath ? undefined : '_blank'} rel="noreferrer"><Download size={15} />{artifact.documentText !== undefined ? (pt ? 'Baixar PDF' : 'Download PDF') : (pt ? 'Baixar / abrir original' : 'Download / open original')}</a></div></div><DocumentPresence key={artifact.id} artifactId={artifact.id} language={language} /></div>
      {error ? <p role="alert">{error}</p> : pdf && artifact.contentPath ? <iframe key={artifact.id} title={artifact.label} src={source} /> : artifact.contentPath && artifact.mimeType?.startsWith('image/') ? <img className="memory-image" src={source} alt={artifact.label} /> : textPreview && artifact.contentPath ? <pre className="memory-text-preview">{text}</pre> : <div className="memory-preview-fallback"><FileText /><p>{pt ? 'Abra este formato no aplicativo de origem.' : 'Open this format in its original application.'}</p><a href={source} target="_blank" rel="noreferrer"><ExternalLink size={16} />{pt ? 'Abrir artefato' : 'Open artifact'}</a></div>}
      </> : <div className="memory-preview-fallback"><FileText /><p>{pt ? 'Selecione um documento.' : 'Select a document.'}</p></div>}</div>
    </div>
  </section></div>;
}
