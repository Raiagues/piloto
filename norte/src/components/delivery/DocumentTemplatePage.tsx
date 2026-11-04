import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, FilePlus2, Lock } from 'lucide-react';
import { API_ORIGIN, useAuth } from '../../lib/auth';
import type { DeliveryDocumentOption, DeliveryState, DeliveryTask } from '../../lib/projectDelivery';
import { exampleReview } from '../../lib/documentReviewExample';
import { DocumentBasis } from './DocumentBasis';
import { DocumentExports, DocumentModes, DocumentPanes } from './DocumentDraftPanel';
import type { Mark } from './DocumentDraftPanel';
import { DocumentReviewPanel } from './DocumentReviewPanel';
import '../../styles/document-library.css';

type Mutate = (action: string, payload: Record<string, unknown>) => Promise<boolean>;
type Preview = {
  template: DeliveryDocumentOption;
  draft: { title: string; body: string; code: string };
  prepared: string;
  canPrepare: boolean;
};

/** A planned document that does not exist yet: the standard's outline filled with the project's records, ready to become draft v1. */
export function DocumentTemplatePage({
  projectId,
  data,
  task,
  templateId,
  busy,
  error,
  mutate,
  pt,
  onClose,
  onOpenDocument,
}: {
  projectId: string;
  data: DeliveryState;
  task: DeliveryTask;
  templateId: string;
  busy: boolean;
  error: string;
  mutate: Mutate;
  pt: boolean;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
}) {
  const { api, user } = useAuth();
  const option = task.documentOptions.find(item => item.id === templateId);
  const storageKey = `norte:template-draft:${user?.id || 'anonymous'}:${projectId}:${task.id}:${templateId}`;
  const [preview, setPreview] = useState<Preview | null>(null),
    [loadError, setLoadError] = useState('');
  const [body, setBody] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) || '';
    } catch {
      return '';
    }
  });
  const [mode, setMode] = useState<'split' | 'code' | 'read' | 'pdf'>(task.canEdit ? 'split' : 'read'),
    [panelOpen, setPanelOpen] = useState(true);
  const [example, setExample] = useState(false),
    [selection, setSelection] = useState(''),
    [focus, setFocus] = useState({ id: '', at: 0 }),
    [creating, setCreating] = useState(false);
  const endpoint = `${API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/delivery/templates/${encodeURIComponent(task.id)}/${encodeURIComponent(templateId)}`;
  const prepared = data.documents.find(item => item.taskId === task.id && item.templateId === templateId);
  // The outline is recomputed from current records; local edits are kept apart until they become a saved version.
  useEffect(() => {
    let live = true;
    api<Preview>(
      `/projects/${encodeURIComponent(projectId)}/delivery/templates/${encodeURIComponent(task.id)}/${encodeURIComponent(templateId)}`,
    )
      .then(result => {
        if (live) {
          setPreview(result);
          setLoadError('');
        }
      })
      .catch(reason => {
        if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível carregar o modelo.');
      });
    return () => {
      live = false;
    };
  }, [api, projectId, task.id, templateId, data.revision]);
  const base = preview?.draft.body || '',
    text = body || base,
    changed = Boolean(body) && body !== base;
  const write = (value: string) => {
    setBody(value === base ? '' : value);
    try {
      if (value === base) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, value);
    } catch {
      /* The draft stays on this screen. */
    }
  };
  useEffect(() => {
    if (creating && prepared) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional. */
      }
      onOpenDocument(prepared.id);
    }
  }, [creating, prepared?.id]);
  const sample = useMemo(() => (example && base ? exampleReview(base, pt) : null), [example, base, pt]);
  const marks: Mark[] = sample ? sample.suggestions.map(item => ({ id: item.id, quote: item.quote })) : [];
  const editable = task.canEdit && !prepared,
    readOnly = Boolean(data.permissions.readOnly);

  if (!option)
    return (
      <div className="document-empty">
        <h3>{pt ? 'Modelo indisponível para esta revisão' : 'Template unavailable for this review'}</h3>
        <button onClick={onClose}>{pt ? 'Voltar aos documentos' : 'Back to documents'}</button>
      </div>
    );
  return (
    <section
      className="document-editor-workspace is-template"
      aria-label={pt ? 'Modelo do documento' : 'Document template'}
    >
      <header className="document-editor-heading">
        <button onClick={onClose} aria-label={pt ? 'Voltar aos documentos' : 'Back to documents'}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2>
            <b className="document-code">{option.code}</b>
            {option.title}
          </h2>
          <div className="document-draft-meta">
            <span>{task.title}</span>
            <span className="delivery-badge planned">
              {pt ? 'Modelo · ainda não criado' : 'Template · not created yet'}
            </span>
            {option.maturity && <span>{option.maturity}</span>}
            {changed && <small>{pt ? 'Alterações locais nesta aba' : 'Local changes in this tab'}</small>}
          </div>
        </div>
        {prepared ? (
          <button className="primary" onClick={() => onOpenDocument(prepared.id)}>
            {pt ? `Abrir versão salva (v${prepared.version})` : `Open saved version (v${prepared.version})`}
            <ArrowRight size={15} />
          </button>
        ) : editable ? (
          <button
            className="primary"
            disabled={busy || !preview || !text.trim()}
            onClick={async () => {
              if (
                await mutate('document.save', {
                  item: { taskId: task.id, templateId, profile: option.profile, title: option.title, body: text },
                })
              )
                setCreating(true);
            }}
          >
            <FilePlus2 size={15} />
            {pt ? 'Criar rascunho v1' : 'Create draft v1'}
          </button>
        ) : changed ? (
          <button onClick={() => write(base)}>{pt ? 'Descartar alterações locais' : 'Discard local changes'}</button>
        ) : null}
      </header>
      {readOnly ? (
        <p className="delivery-readonly" role="note">
          <Lock size={14} aria-hidden="true" />
          <span>
            <strong>{pt ? 'Somente leitura nesta versão de teste.' : 'Read only in this test version.'}</strong>{' '}
            {pt
              ? 'Leia o modelo, baixe em PDF ou LaTeX e envie ao Overleaf. Criar o rascunho e pedir revisões fica desabilitado; o exemplo de revisão mostra como funcionaria.'
              : 'Read the template, download it as PDF or LaTeX and send it to Overleaf. Creating the draft and requesting reviews is disabled; the review example shows how it would work.'}
          </span>
        </p>
      ) : !task.canEdit && !prepared ? (
        <p className="document-export-note">
          {pt
            ? 'Somente quem edita o setor desta revisão cria o rascunho.'
            : 'Only editors of this review’s sector can create the draft.'}
        </p>
      ) : null}
      {prepared && (
        <p className="document-export-note">
          {pt
            ? 'Este documento já foi criado. O modelo abaixo reflete os registros atuais e serve para comparar.'
            : 'This document already exists. The template below reflects current records for comparison.'}
        </p>
      )}
      <div className="document-view-toolbar">
        <DocumentModes
          mode={mode}
          setMode={setMode}
          editable={editable}
          pt={pt}
          panelOpen={panelOpen}
          onPanel={() => setPanelOpen(value => !value)}
          pdfLabel={pt ? 'PDF do modelo' : 'Template PDF'}
        />
        <DocumentExports
          endpoint={endpoint}
          pt={pt}
          disabled={!preview}
          note={
            pt
              ? 'Envia uma cópia do modelo preenchido ao overleaf.com.'
              : 'Sends a copy of the filled template to overleaf.com.'
          }
        />
      </div>
      {changed && (
        <p className="document-export-note">
          {pt
            ? 'Exportações usam o modelo gerado; suas edições entram ao criar o rascunho.'
            : 'Exports use the generated template; your edits are included once you create the draft.'}
        </p>
      )}
      {loadError && (
        <p role="alert" className="delivery-inline-error">
          {loadError}
        </p>
      )}
      {!preview && !loadError ? (
        <p className="delivery-loading">{pt ? 'Montando o modelo…' : 'Building the template…'}</p>
      ) : (
        <DocumentPanes
          body={text}
          onChange={write}
          editable={editable}
          mode={mode}
          pdfSource={`${endpoint}?format=pdf&inline=1`}
          pdfKey={data.revision}
          title={option.title}
          pt={pt}
          marks={marks}
          onSelection={setSelection}
          focus={focus}
          panel={
            panelOpen ? (
              <DocumentReviewPanel
                pt={pt}
                busy={busy}
                body={text}
                canEdit={editable}
                changed={changed}
                stale={false}
                members={data.members}
                selection={selection}
                example={sample}
                onExample={setExample}
                onApplyLocal={write}
                onFocus={id => {
                  if (mode === 'pdf') setMode(editable ? 'split' : 'read');
                  setFocus({ id, at: Date.now() });
                }}
                readOnlyVersion={readOnly}
              />
            ) : null
          }
        />
      )}
      <DocumentBasis document={option} reviewTitle={task.title} pt={pt} />
      {error && (
        <p role="alert" className="delivery-inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
