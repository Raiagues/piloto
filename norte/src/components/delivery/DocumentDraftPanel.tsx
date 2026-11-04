import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Columns2,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Save,
} from 'lucide-react';
import { API_ORIGIN, useAuth } from '../../lib/auth';
import type { DeliveryDocument, DeliveryPerson } from '../../lib/projectDelivery';
import { exampleReview } from '../../lib/documentReviewExample';
import { sendLatexToOverleaf } from '../../lib/overleaf';
import { PdfPreview } from './PdfPreview';
import { DocumentBasis } from './DocumentBasis';
import { DocumentReviewPanel } from './DocumentReviewPanel';
import '../../styles/document-library.css';

export type Mark = { id: string; quote: string };
type Mode = 'split' | 'code' | 'read' | 'pdf';

/** Highlights the first mark found in a piece of text; whole-line marks cover text whose Markdown prefix was stripped. */
function marked(text: string, raw: string, marks: Mark[]): ReactNode {
  for (const mark of marks) {
    const quote = mark.quote.trim();
    if (!quote) continue;
    const at = text.indexOf(quote);
    if (at >= 0)
      return (
        <>
          {text.slice(0, at)}
          <mark data-suggestion={mark.id}>{quote}</mark>
          {text.slice(at + quote.length)}
        </>
      );
    if (raw.trim() && (raw.includes(quote) || (quote.includes('\n') && quote.includes(raw.trim()))))
      return <mark data-suggestion={mark.id}>{text}</mark>;
  }
  return text;
}

export function DocumentText({ body, marks = [] }: { body: string; marks?: Mark[] }) {
  const lines = body.split('\n'),
    rows: ReactNode[] = [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(value => value.trim());
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      key = index;
    if (line.trim().startsWith('|') && /^\|?\s*:?-+/.test(lines[index + 1]?.trim() || '')) {
      const head = cells(line),
        content: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        content.push(cells(lines[index]));
        index++;
      }
      index--;
      rows.push(
        <div className="document-table-scroll" key={key}>
          <table>
            <thead>
              <tr>
                {head.map((cell, i) => (
                  <th key={i}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.map((row, i) => (
                <tr key={i}>
                  {head.map((_, j) => (
                    <td key={j}>{marked(row[j] || '', row[j] || '', marks)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^(\s*)[-*]\s+/.exec(line);
    if (line.startsWith('# ')) rows.push(<h1 key={key}>{marked(line.slice(2), line, marks)}</h1>);
    else if (line.startsWith('## ')) rows.push(<h2 key={key}>{marked(line.slice(3), line, marks)}</h2>);
    else if (line.startsWith('### ')) rows.push(<h3 key={key}>{marked(line.slice(4), line, marks)}</h3>);
    else if (/^>\s?/.test(line))
      rows.push(
        <p className="document-guide" key={key}>
          {marked(line.replace(/^>\s?/, ''), line, marks)}
        </p>,
      );
    else if (/^https:\/\//.test(line))
      rows.push(
        <p key={key}>
          <a href={line} target="_blank" rel="noreferrer">
            {line}
          </a>
        </p>,
      );
    else if (bullet)
      rows.push(
        <p
          className="document-bullet"
          style={{ marginLeft: Math.min(3, Math.floor(bullet[1].length / 2)) * 16 }}
          key={key}
        >
          {marked(line.slice(bullet[0].length), line, marks)}
        </p>,
      );
    else
      rows.push(
        line.trim() ? <p key={key}>{marked(line, line, marks)}</p> : <div key={key} className="document-line-gap" />,
      );
  }
  return <div className="document-reading">{rows}</div>;
}

/** Editor, reading view and PDF of one document, with the review panel beside them. */
export function DocumentPanes({
  body,
  onChange,
  editable,
  mode,
  pdfSource,
  pdfKey,
  title,
  pt,
  marks,
  panel,
  onSelection,
  focus,
}: {
  body: string;
  onChange: (body: string) => void;
  editable: boolean;
  mode: Mode;
  pdfSource: string;
  pdfKey: string | number;
  title: string;
  pt: boolean;
  marks: Mark[];
  panel: ReactNode;
  onSelection: (text: string) => void;
  focus: { id: string; at: number };
}) {
  const area = useRef<HTMLTextAreaElement>(null),
    main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus.id) return;
    const mark = main.current?.querySelector<HTMLElement>(`[data-suggestion="${CSS.escape(focus.id)}"]`);
    mark?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    mark?.classList.add('is-focused');
    const timer = window.setTimeout(() => mark?.classList.remove('is-focused'), 1600);
    const quote = marks.find(item => item.id === focus.id)?.quote,
      at = quote ? body.indexOf(quote) : -1;
    if (area.current && at >= 0 && mode === 'code') {
      area.current.focus({ preventScroll: true });
      area.current.setSelectionRange(at, at + quote!.length);
    }
    return () => window.clearTimeout(timer);
  }, [focus.at]);
  const capture = () => {
    const field = area.current;
    if (field && window.document.activeElement === field && field.selectionEnd > field.selectionStart) {
      onSelection(field.value.slice(field.selectionStart, field.selectionEnd).trim());
      return;
    }
    const text = window.getSelection()?.toString().trim() || '';
    onSelection(text.length <= 2000 ? text : '');
  };
  return (
    <div className={`document-editor-body${panel ? ' with-panel' : ''}`}>
      <div ref={main} className="document-editor-main" onMouseUp={capture} onKeyUp={capture}>
        {mode === 'pdf' ? (
          <div className="document-pdf-preview">
            <PdfPreview key={pdfKey} title={title} pt={pt} source={pdfSource} />
          </div>
        ) : (
          <div className={`document-edit-panes mode-${mode}`}>
            {(mode === 'split' || mode === 'code') && (
              <section className="document-code-pane">
                <header>{pt ? 'Código Markdown' : 'Markdown source'}</header>
                <textarea
                  ref={area}
                  className="delivery-document-editor"
                  aria-label={pt ? 'Conteúdo do documento' : 'Document content'}
                  value={body}
                  readOnly={!editable}
                  spellCheck={false}
                  maxLength={150000}
                  onChange={event => onChange(event.target.value)}
                />
              </section>
            )}
            {(mode === 'split' || mode === 'read') && (
              <section className="document-preview-pane">
                <header>{pt ? 'Prévia' : 'Preview'}</header>
                <DocumentText body={body} marks={marks} />
              </section>
            )}
          </div>
        )}
      </div>
      {panel}
    </div>
  );
}

export function DocumentModes({
  mode,
  setMode,
  editable,
  pt,
  panelOpen,
  onPanel,
  pdfLabel,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  editable: boolean;
  pt: boolean;
  panelOpen: boolean;
  onPanel: () => void;
  pdfLabel: string;
}) {
  return (
    <div>
      {editable && (
        <>
          <button aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
            <Columns2 size={15} />
            {pt ? 'Editor e prévia' : 'Editor and preview'}
          </button>
          <button aria-pressed={mode === 'code'} onClick={() => setMode('code')}>
            <Code2 size={15} />
            {pt ? 'Editor' : 'Editor'}
          </button>
        </>
      )}
      <button aria-pressed={mode === 'read'} onClick={() => setMode('read')}>
        <FileText size={15} />
        {pt ? 'Leitura' : 'Read'}
      </button>
      <button aria-pressed={mode === 'pdf'} onClick={() => setMode('pdf')}>
        <Eye size={15} />
        {pdfLabel}
      </button>
      <button
        aria-pressed={panelOpen}
        onClick={onPanel}
        title={panelOpen ? (pt ? 'Ocultar revisão' : 'Hide review') : pt ? 'Mostrar revisão' : 'Show review'}
      >
        {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        {pt ? 'Revisão' : 'Review'}
      </button>
    </div>
  );
}

export function DocumentExports({
  endpoint,
  pt,
  disabled,
  note,
}: {
  endpoint: string;
  pt: boolean;
  disabled: boolean;
  note: string;
}) {
  const [sending, setSending] = useState(false),
    [failure, setFailure] = useState('');
  return (
    <div className="document-exports">
      <a href={`${endpoint}?format=md`} download>
        <Code2 size={15} />
        .md
      </a>
      <a href={`${endpoint}?format=pdf`}>
        <Download size={15} />
        PDF
      </a>
      <a href={`${endpoint}?format=latex`}>
        <Download size={15} />
        LaTeX ZIP
      </a>
      <button
        type="button"
        disabled={sending || disabled}
        title={note}
        onClick={async () => {
          setSending(true);
          setFailure('');
          try {
            await sendLatexToOverleaf(`${endpoint}?format=latex`, pt);
          } catch (reason) {
            setFailure(reason instanceof Error ? reason.message : 'Export failed.');
          } finally {
            setSending(false);
          }
        }}
      >
        <ExternalLink size={15} />
        {sending ? (pt ? 'Preparando…' : 'Preparing…') : 'Overleaf'}
      </button>
      {failure && <small role="alert">{failure}</small>}
    </div>
  );
}

type Draft = { body: string; baseBody: string; baseVersion: number };
function readDraft(key: string, document: DeliveryDocument): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      value &&
      typeof value.body === 'string' &&
      typeof value.baseBody === 'string' &&
      Number.isInteger(value.baseVersion)
    )
      return value;
  } catch {
    /* Optional tab storage. */
  }
  return { body: document.body, baseBody: document.body, baseVersion: document.version };
}
export function DocumentDraftPanel({
  document,
  projectId,
  canEdit,
  busy,
  error,
  pt,
  onClose,
  onSave,
  members = [],
  mutate,
  reviewTitle = '',
  readOnlyVersion = false,
}: {
  document: DeliveryDocument;
  projectId: string;
  canEdit: boolean;
  busy: boolean;
  error: string;
  pt: boolean;
  onClose: () => void;
  onSave: (body: string) => Promise<boolean>;
  members?: DeliveryPerson[];
  mutate?: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
  reviewTitle?: string;
  readOnlyVersion?: boolean;
}) {
  const { user } = useAuth();
  const draftKey = `norte:document-draft:${user?.id || 'anonymous'}:${projectId}:${document.id}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey, document)),
    [storageError, setStorageError] = useState(false);
  const [mode, setMode] = useState<Mode>(canEdit ? 'split' : 'read'),
    [panelOpen, setPanelOpen] = useState(true);
  const [example, setExample] = useState(false),
    [selection, setSelection] = useState(''),
    [focus, setFocus] = useState({ id: '', at: 0 });
  const body = draft.body,
    changed = body !== draft.baseBody,
    stale = document.version !== draft.baseVersion;
  const endpoint = `${API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/delivery/documents/${encodeURIComponent(document.id)}/export`;
  function update(next: Draft) {
    setDraft(next);
    try {
      if (next.body === next.baseBody) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  // A new saved version (another tab, an applied suggestion) replaces the text only when nothing local would be lost.
  useEffect(() => {
    if (!changed && stale) update({ body: document.body, baseBody: document.body, baseVersion: document.version });
  }, [document.version, document.body]);
  async function save() {
    if (await onSave(body)) update({ body, baseBody: body, baseVersion: document.version + 1 });
  }
  const sample = useMemo(() => (example ? exampleReview(draft.baseBody, pt) : null), [example, draft.baseBody, pt]);
  const marks: Mark[] = sample
    ? sample.suggestions.map(item => ({ id: item.id, quote: item.quote }))
    : (document.suggestions || [])
        .filter(item => item.status === 'open')
        .map(item => ({ id: item.id, quote: item.quote }));
  const status =
    document.status === 'approved'
      ? pt
        ? 'Aprovado'
        : 'Approved'
      : document.status === 'in_review'
        ? pt
          ? 'Em revisão'
          : 'In review'
        : document.status === 'changes_requested'
          ? pt
            ? 'Alterações pedidas'
            : 'Changes requested'
          : pt
            ? 'Rascunho'
            : 'Draft';
  return (
    <section
      className="document-editor-workspace"
      aria-label={pt ? 'Área de trabalho do documento' : 'Document workspace'}
    >
      <header className="document-editor-heading">
        <button onClick={onClose} aria-label={pt ? 'Voltar aos documentos' : 'Back to documents'}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2>
            {document.code && <b className="document-code">{document.code}</b>}
            {document.title}
          </h2>
          <div className="document-draft-meta">
            <span>
              v{document.version}
              {document.authorName ? ` · ${document.authorName}` : ''}
            </span>
            <span className={`delivery-badge ${document.status}`}>{status}</span>
            {document.maturity && <span>{document.maturity}</span>}
            {changed && (
              <small>
                {storageError
                  ? pt
                    ? 'Rascunho somente nesta tela'
                    : 'Draft only on this screen'
                  : pt
                    ? 'Alterações locais nesta aba'
                    : 'Local changes in this tab'}
              </small>
            )}
          </div>
        </div>
        {canEdit ? (
          <button className="primary" disabled={busy || stale || !changed || !body.trim()} onClick={() => void save()}>
            <Save size={15} />
            {pt ? 'Salvar versão' : 'Save version'}
          </button>
        ) : changed ? (
          <button
            onClick={() => update({ body: document.body, baseBody: document.body, baseVersion: document.version })}
          >
            {pt ? 'Descartar alterações locais' : 'Discard local changes'}
          </button>
        ) : null}
      </header>
      <div className="document-view-toolbar">
        <DocumentModes
          mode={mode}
          setMode={setMode}
          editable={canEdit}
          pt={pt}
          panelOpen={panelOpen}
          onPanel={() => setPanelOpen(value => !value)}
          pdfLabel={pt ? 'PDF salvo' : 'Saved PDF'}
        />
        <DocumentExports
          endpoint={endpoint}
          pt={pt}
          disabled={changed || stale}
          note={
            changed
              ? pt
                ? 'Salve sua versão para enviar ao Overleaf.'
                : 'Save your version before sending to Overleaf.'
              : pt
                ? 'Envia uma cópia da versão salva ao overleaf.com; alterações feitas lá não voltam ao Norte.'
                : 'Sends a copy of the saved version to overleaf.com; changes made there do not return to Norte.'
          }
        />
      </div>
      {changed && (
        <p className="document-export-note">
          {pt ? 'Exportações e Overleaf usam a versão salva.' : 'Exports and Overleaf use the saved version.'}
        </p>
      )}
      {stale && (
        <div className="delivery-error" role="alert">
          <span>
            {pt
              ? 'O documento tem uma versão mais recente. Seu rascunho foi preservado; copie o que deseja manter antes de carregar a versão atual.'
              : 'A newer version exists. Your draft is preserved; copy what you need before loading the current version.'}
          </span>
          <button
            onClick={() => update({ body: document.body, baseBody: document.body, baseVersion: document.version })}
          >
            {pt ? 'Usar versão atual' : 'Use current version'}
          </button>
        </div>
      )}
      {storageError && changed && (
        <p role="alert">
          {pt
            ? 'O navegador não conseguiu preservar o rascunho. Salve antes de sair desta tela.'
            : 'The browser could not preserve this draft. Save before leaving this screen.'}
        </p>
      )}
      <DocumentPanes
        body={body}
        onChange={value => update({ ...draft, body: value })}
        editable={canEdit}
        mode={mode}
        pdfSource={`${endpoint}?format=pdf&inline=1`}
        pdfKey={document.version}
        title={document.title}
        pt={pt}
        marks={marks}
        onSelection={setSelection}
        focus={focus}
        panel={
          panelOpen ? (
            <DocumentReviewPanel
              pt={pt}
              busy={busy}
              document={document}
              body={body}
              canEdit={canEdit}
              changed={changed}
              stale={stale}
              members={members}
              mutate={mutate}
              selection={selection}
              example={sample}
              onExample={setExample}
              onApplyLocal={next => update({ ...draft, body: next })}
              onFocus={id => {
                if (mode === 'pdf') setMode(canEdit ? 'split' : 'read');
                setFocus({ id, at: Date.now() });
              }}
              readOnlyVersion={readOnlyVersion}
            />
          ) : null
        }
      />
      <DocumentBasis document={document} reviewTitle={reviewTitle} pt={pt} />
      {error && (
        <p role="alert" className="delivery-inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
