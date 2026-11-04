import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { reviewDocuments } from '../../../shared/delivery-lifecycle.mjs';
import type { DeliveryState, DeliveryTask, DeliveryDocumentOption, DeliveryDocument } from '../../lib/projectDelivery';
import { deliveryStatus } from '../../lib/projectDelivery';
import { useAuth } from '../../lib/auth';
import { useEngineeringAssistant } from '../../lib/engineeringAssistant';
import { DocumentText } from './DocumentDraftPanel';
import { openDocumentPage, openTemplatePage } from './DocumentWorkspace';
import { DocumentBasis } from './DocumentBasis';
import '../../styles/document-library.css';

const stateOf = (saved?: DeliveryDocument) =>
  !saved ? 'missing' : ['approved', 'in_review', 'changes_requested'].includes(saved.status) ? saved.status : 'draft';
const updated = (value: string, pt: boolean) => {
  const at = Date.parse(value);
  return Number.isFinite(at)
    ? new Date(at).toLocaleDateString(pt ? 'pt-BR' : 'en', { day: '2-digit', month: 'short' }).replace('.', '')
    : '';
};

/** The review's document package: what is planned, what exists, its state and the reference it follows. */
export function ReviewDocuments({
  projectId,
  data,
  task,
  busy,
  mutate,
  pt,
  error = '',
  onOpenDocument,
  onOpenTemplate,
}: {
  projectId: string;
  data: DeliveryState;
  task: DeliveryTask;
  busy: boolean;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
  pt: boolean;
  error?: string;
  onOpenDocument?: (id: string) => void;
  onOpenTemplate?: (taskId: string, templateId: string) => void;
}) {
  const { user } = useAuth(),
    draftKey = `norte:document-generation:${user?.id || 'anonymous'}:${projectId}:${task.id}`;
  const [restored] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) || 'null') as {
        open?: boolean;
        profile?: string;
        templateId?: string;
        body?: string;
        title?: string;
        suggestionRunId?: string;
      } | null;
    } catch {
      return null;
    }
  });
  const [generating, setGenerating] = useState(Boolean(restored?.open)),
    [profile, setProfile] = useState(restored?.profile || task.lifecycleProfile || data.lifecycle?.profile || 'nasa'),
    [templateId, setTemplateId] = useState(restored?.templateId || ''),
    [body, setBody] = useState(restored?.body || ''),
    [title, setTitle] = useState(restored?.title || ''),
    [suggestionRunId, setSuggestionRunId] = useState(restored?.suggestionRunId || '');
  useEffect(() => {
    try {
      if (body || generating)
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ open: generating, profile, templateId, body, title, suggestionRunId }),
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* The generated text stays available to copy on this screen. */
    }
  }, [draftKey, generating, profile, templateId, body, title, suggestionRunId]);
  const [pendingTemplate, setPendingTemplate] = useState('');
  const assistant = useEngineeringAssistant(projectId);
  const options = reviewDocuments(profile, task.reviewCode || '') as DeliveryDocumentOption[];
  const open = (id: string) => (onOpenDocument ? onOpenDocument(id) : openDocumentPage(projectId, id));
  const openTemplate = (id: string) =>
    onOpenTemplate ? onOpenTemplate(task.id, id) : openTemplatePage(projectId, task.id, id);
  const prepared = data.documents.filter(item => item.taskId === task.id);
  useEffect(() => {
    const created = prepared.find(item => item.templateId === pendingTemplate);
    if (created) {
      setPendingTemplate('');
      if (onOpenDocument) onOpenDocument(created.id);
      else openDocumentPage(projectId, created.id);
    }
  }, [pendingTemplate, prepared, onOpenDocument, projectId]);
  useEffect(() => {
    const draft = assistant.run?.result?.documentDraft;
    if (draft) {
      setBody(draft.body);
      setTitle(draft.title);
      setSuggestionRunId(assistant.run?.id || '');
    }
  }, [assistant.run?.id, assistant.run?.result]);
  function openGenerator(option?: DeliveryDocumentOption) {
    setTemplateId(option?.id || options[0]?.id || '');
    setBody('');
    setTitle('');
    setSuggestionRunId('');
    assistant.clear();
    setGenerating(true);
  }
  const planned = task.documentOptions || [],
    extras = prepared.filter(item => !planned.some(option => option.id === item.templateId));
  const counts = { approved: 0, in_review: 0, changes_requested: 0, draft: 0, missing: 0 };
  for (const option of planned)
    counts[stateOf(prepared.find(item => item.templateId === option.id)) as keyof typeof counts]++;
  const ready = planned.length - counts.missing;
  // The whole row opens: a saved document in its editor, a planned one as its filled template.
  const row = (option: DeliveryDocumentOption | null, saved?: DeliveryDocument) => {
    const state = stateOf(saved),
      code = option?.code || saved?.code || '',
      name = option?.title || saved?.title || '';
    const open_ = saved?.suggestions?.filter(item => item.status === 'open').length || 0,
      reviewers = saved?.reviewers?.length || 0;
    return (
      <li key={option?.id || saved?.id}>
        <button
          type="button"
          className={`review-doc state-${state}`}
          onClick={() => (saved ? open(saved.id) : option && openTemplate(option.id))}
        >
          <i className="review-doc-state" aria-hidden="true" />
          <b className="review-doc-code">{code || '—'}</b>
          <span className="review-doc-copy">
            <strong>{saved && saved.title !== name ? saved.title : name}</strong>
            <small>
              {saved ? (
                <>
                  <span className={`review-doc-status ${state}`}>{deliveryStatus(saved.status, pt)}</span>
                  <span>v{saved.version}</span>
                  {saved.authorName && <span>{saved.authorName}</span>}
                  {reviewers > 0 && (
                    <span>
                      {pt
                        ? `${reviewers} ${reviewers === 1 ? 'revisor' : 'revisores'}`
                        : `${reviewers} ${reviewers === 1 ? 'reviewer' : 'reviewers'}`}
                    </span>
                  )}
                  {open_ > 0 && (
                    <span className="review-doc-status changes_requested">
                      {pt
                        ? `${open_} ${open_ === 1 ? 'sugestão aberta' : 'sugestões abertas'}`
                        : `${open_} open ${open_ === 1 ? 'suggestion' : 'suggestions'}`}
                    </span>
                  )}
                  {updated(saved.updatedAt, pt) && <span>{updated(saved.updatedAt, pt)}</span>}
                </>
              ) : (
                <>
                  <span>{pt ? 'Modelo pronto para rascunho' : 'Template ready to draft'}</span>
                  {option?.maturity && <span>{option.maturity}</span>}
                </>
              )}
              {(option?.reference || saved?.reference) && (
                <span className="review-doc-source">{(option?.reference || saved?.reference)!.section}</span>
              )}
            </small>
          </span>
          <span className="review-doc-action">
            {saved ? (pt ? 'Abrir' : 'Open') : pt ? 'Ver modelo' : 'View template'}
            <ArrowRight size={13} aria-hidden="true" />
          </span>
        </button>
      </li>
    );
  };
  const segments: [keyof typeof counts, string][] = [
    ['approved', pt ? 'aprovados' : 'approved'],
    ['in_review', pt ? 'em revisão' : 'in review'],
    ['changes_requested', pt ? 'com alterações' : 'changes requested'],
    ['draft', pt ? 'rascunhos' : 'drafts'],
    ['missing', pt ? 'a preparar' : 'to prepare'],
  ];
  return (
    <section className="review-documents" aria-label={pt ? 'Documentos da revisão' : 'Review documents'}>
      <header className="review-documents-head">
        <div>
          <h3>{pt ? 'Documentos' : 'Documents'}</h3>
          <p>
            {planned.length
              ? pt
                ? `${ready} de ${planned.length} preparados · ${counts.approved} aprovados`
                : `${ready} of ${planned.length} prepared · ${counts.approved} approved`
              : pt
                ? 'Nenhum documento previsto'
                : 'No documents planned'}
          </p>
        </div>
        {task.canEdit && (
          <button type="button" className="review-documents-ai" onClick={() => openGenerator()}>
            <Sparkles size={14} aria-hidden="true" />
            {pt ? 'Rascunho com IA' : 'AI draft'}
          </button>
        )}
      </header>
      {planned.length > 0 && (
        <div
          className="review-documents-bar"
          role="img"
          aria-label={segments
            .filter(([key]) => counts[key])
            .map(([key, label]) => `${counts[key]} ${label}`)
            .join(', ')}
        >
          {segments.map(([key]) =>
            counts[key] ? <i key={key} className={key} style={{ flexGrow: counts[key] }} /> : null,
          )}
        </div>
      )}
      {planned.length > 0 && (
        <ul className="review-doc-list">
          {planned.map(option =>
            row(
              option,
              prepared.find(item => item.templateId === option.id),
            ),
          )}
        </ul>
      )}
      {extras.length > 0 && (
        <div className="review-documents-group">
          <h4>
            {pt ? 'Outros documentos' : 'Other documents'}
            <small>{extras.length}</small>
          </h4>
          <ul className="review-doc-list">{extras.map(saved => row(null, saved))}</ul>
        </div>
      )}

      {generating && (
        <section
          className="document-generation document-draft-content"
          aria-label={pt ? 'Preparar documento com IA' : 'Prepare document with AI'}
        >
          <p>{task.title}</p>
          <div className="delivery-form-grid">
            <label>
              {pt ? 'Formato de referência' : 'Reference format'}
              <select
                disabled={assistant.running}
                value={profile}
                onChange={event => {
                  setProfile(event.target.value);
                  setTemplateId('');
                  setBody('');
                }}
              >
                <option value="nasa">NASA</option>
                <option value="ecss">ECSS</option>
                <option value="custom">{pt ? 'Personalizado' : 'Custom'}</option>
              </select>
            </label>
            <label>
              {pt ? 'Documento' : 'Document'}
              <select
                disabled={assistant.running}
                value={templateId}
                onChange={event => {
                  setTemplateId(event.target.value);
                  setBody('');
                }}
              >
                <option value="">{pt ? 'Selecionar modelo' : 'Choose template'}</option>
                {options.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {options.find(option => option.id === templateId) && (
            <DocumentBasis
              document={options.find(option => option.id === templateId)!}
              reviewTitle={task.title}
              pt={pt}
            />
          )}
          <button
            data-usage-action="documents.generate"
            className="primary"
            disabled={assistant.running || !templateId}
            onClick={() => {
              setBody('');
              void assistant.start('document', { taskId: task.id, templateId, profile });
            }}
          >
            <Sparkles size={15} />
            {assistant.running
              ? pt
                ? 'Preparando…'
                : 'Preparing…'
              : pt
                ? 'Gerar rascunho com IA'
                : 'Generate AI draft'}
          </button>
          {assistant.run && (
            <ol
              className="document-run-log"
              aria-label={pt ? 'Atividade da análise' : 'Analysis activity'}
              aria-live="polite"
            >
              {assistant.run.events.map((event, index) => (
                <li key={index}>
                  <time>
                    {new Date(event.at).toLocaleTimeString(pt ? 'pt-BR' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <span>{event.message}</span>
                </li>
              ))}
            </ol>
          )}
          {(assistant.error || assistant.run?.error) && (
            <p role="alert" className="delivery-inline-error">
              {assistant.error || assistant.run?.error}
            </p>
          )}
          {body && (
            <>
              <label>
                {pt ? 'Título' : 'Title'}
                <input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} />
              </label>
              <div className="document-edit-panes mode-split">
                <section className="document-code-pane">
                  <header>{pt ? 'Código Markdown' : 'Markdown source'}</header>
                  <textarea
                    className="delivery-document-editor"
                    aria-label={pt ? 'Revisar rascunho' : 'Review draft'}
                    value={body}
                    maxLength={150000}
                    onChange={event => setBody(event.target.value)}
                  />
                </section>
                <section className="document-preview-pane">
                  <header>{pt ? 'Prévia do rascunho' : 'Draft preview'}</header>
                  <DocumentText body={body} />
                </section>
              </div>
              <p className="delivery-note">
                {pt
                  ? 'Revise o conteúdo antes de salvar. A aprovação é feita por outra pessoa da equipe.'
                  : 'Review the content before saving. Approval belongs to another team member.'}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="delivery-inline-error">
              {error}
            </p>
          )}
          <footer>
            <button onClick={() => setGenerating(false)}>{pt ? 'Fechar' : 'Close'}</button>
            {body && (
              <button
                className="primary"
                disabled={busy || assistant.running || !body.trim()}
                onClick={async () => {
                  if (
                    await mutate('document.save', {
                      suggestionRunId: suggestionRunId || undefined,
                      item: { taskId: task.id, templateId, profile, body, title },
                    })
                  ) {
                    setPendingTemplate(templateId);
                    setBody('');
                    setTitle('');
                    setSuggestionRunId('');
                    setGenerating(false);
                  }
                }}
              >
                {pt ? 'Salvar rascunho' : 'Save draft'}
              </button>
            )}
          </footer>
        </section>
      )}
    </section>
  );
}
