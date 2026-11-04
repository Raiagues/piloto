import { useEffect, useState } from 'react';
import { Check, MessageSquarePlus, UsersRound, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { DeliveryDocument, DeliveryPerson, DeliverySuggestion } from '../../lib/projectDelivery';
import { applySuggestion } from '../../lib/documentReviewExample';
import type { ExampleReview } from '../../lib/documentReviewExample';
import { DeliverySelect } from './DeliveryShared';

type Mutate = (action: string, payload: Record<string, unknown>) => Promise<boolean>;
type Props = {
  pt: boolean;
  busy: boolean;
  document?: DeliveryDocument;
  body: string;
  canEdit: boolean;
  changed: boolean;
  stale: boolean;
  members: DeliveryPerson[];
  mutate?: Mutate;
  selection: string;
  example: ExampleReview | null;
  onExample: (on: boolean) => void;
  onApplyLocal: (body: string) => void;
  onFocus: (id: string) => void;
  readOnlyVersion: boolean;
};
const decisionLabel = (decision: string, pt: boolean) =>
  decision === 'approve'
    ? pt
      ? 'Aprovou'
      : 'Approved'
    : decision === 'request_changes'
      ? pt
        ? 'Pediu alterações'
        : 'Requested changes'
      : pt
        ? 'Aguardando parecer'
        : 'Awaiting decision';
const unique = (body: string, quote: string) => Boolean(quote) && body.split(quote).length === 2;

function Change({ quote, replacement, pt }: { quote: string; replacement: string; pt: boolean }) {
  return (
    <div className="review-change">
      <del>{quote}</del>
      {replacement ? <ins>{replacement}</ins> : <small>{pt ? '(remover o trecho)' : '(remove the text)'}</small>}
    </div>
  );
}

/** Who reviews this version, what they decided and the text changes they propose. */
export function DocumentReviewPanel({
  pt,
  busy,
  document,
  body,
  canEdit,
  changed,
  stale,
  members,
  mutate,
  selection,
  example,
  onExample,
  onApplyLocal,
  onFocus,
  readOnlyVersion,
}: Props) {
  const { user } = useAuth();
  const [reviewers, setReviewers] = useState<string[]>([]),
    [comment, setComment] = useState('');
  const [quote, setQuote] = useState(''),
    [replacement, setReplacement] = useState(''),
    [note, setNote] = useState(''),
    [composing, setComposing] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);
  useEffect(() => {
    if (composing && selection) setQuote(selection);
  }, [selection, composing]);
  const name = (id: string) => members.find(member => member.id === id)?.name || (pt ? 'Participante' : 'Participant');
  const suggestions = [...(document?.suggestions || [])].sort(
    (a, b) => Number(b.status === 'open') - Number(a.status === 'open'),
  );
  const open = suggestions.filter(item => item.status === 'open').length;
  const quiet = changed || stale;

  if (example)
    return (
      <aside className="document-review-panel is-example" aria-label={pt ? 'Exemplo de revisão' : 'Review example'}>
        <header>
          <h3>
            <UsersRound size={15} aria-hidden="true" />
            {pt ? 'Exemplo de revisão' : 'Review example'}
          </h3>
          <button type="button" onClick={() => onExample(false)}>
            {pt ? 'Sair do exemplo' : 'Leave example'}
          </button>
        </header>
        <p className="review-example-note">
          {pt
            ? 'Perfis fictícios para mostrar como a revisão funciona. Nada é salvo, enviado ou contado como aprovação. As sugestões vêm do próprio texto e usam marcadores entre colchetes, sem inventar valores.'
            : 'Fictional profiles showing how a review works. Nothing is saved, sent or counted as approval. Suggestions come from the text itself and use bracketed placeholders, never invented values.'}
        </p>
        <section>
          <h4>{pt ? 'Revisão solicitada a' : 'Review requested from'}</h4>
          <ul className="review-people">
            {example.reviewers.map(reviewer => (
              <li key={reviewer.id} className={`decision-${reviewer.decision}`}>
                <i aria-hidden="true">{reviewer.role.slice(0, 1)}</i>
                <span>
                  <strong>{reviewer.name}</strong>
                  <small>{reviewer.role}</small>
                </span>
                <em>
                  {decisionLabel(reviewer.decision, pt)}
                  <small>{reviewer.comment}</small>
                </em>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>
            {pt ? 'Sugestões de correção' : 'Suggested corrections'}
            <small>{example.suggestions.length}</small>
          </h4>
          {example.suggestions.length ? (
            <ol className="review-suggestions">
              {example.suggestions.map(item => {
                const applied = !body.includes(item.quote) && (!item.replacement || body.includes(item.replacement)),
                  dismissed = ignored.includes(item.id),
                  reviewer = example.reviewers.find(person => person.id === item.reviewerId);
                return (
                  <li key={item.id} className={applied ? 'is-accepted' : dismissed ? 'is-dismissed' : ''}>
                    <button type="button" className="review-suggestion-anchor" onClick={() => onFocus(item.id)}>
                      <strong>{reviewer?.name}</strong>
                      <span>{item.comment}</span>
                    </button>
                    <Change quote={item.quote} replacement={item.replacement} pt={pt} />
                    {applied ? (
                      <small className="review-suggestion-state">
                        <Check size={12} aria-hidden="true" />
                        {pt ? 'Aplicada ao rascunho local' : 'Applied to the local draft'}
                      </small>
                    ) : dismissed ? (
                      <small className="review-suggestion-state">{pt ? 'Ignorada' : 'Ignored'}</small>
                    ) : (
                      <div className="review-suggestion-actions">
                        <button
                          type="button"
                          disabled={!unique(body, item.quote)}
                          onClick={() => {
                            const next = applySuggestion(body, item.quote, item.replacement);
                            if (next !== null) onApplyLocal(next);
                          }}
                        >
                          {pt ? 'Aplicar ao rascunho' : 'Apply to draft'}
                        </button>
                        <button type="button" onClick={() => setIgnored(list => [...list, item.id])}>
                          {pt ? 'Ignorar' : 'Ignore'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="review-empty">
              {pt
                ? 'O texto não tem pendências que o exemplo saiba apontar.'
                : 'The text has nothing the example can point out.'}
            </p>
          )}
        </section>
        <p className="review-example-note">
          {canEdit
            ? pt
              ? 'O que você aplicar fica no rascunho desta aba; salve uma versão se quiser manter.'
              : 'What you apply stays in this tab’s draft; save a version to keep it.'
            : pt
              ? 'Somente prévia local: esta versão não grava alterações.'
              : 'Local preview only: this version does not store changes.'}
        </p>
      </aside>
    );

  return (
    <aside className="document-review-panel" aria-label={pt ? 'Revisão do documento' : 'Document review'}>
      <header>
        <h3>
          <UsersRound size={15} aria-hidden="true" />
          {pt ? 'Revisão' : 'Review'}
        </h3>
        <button type="button" onClick={() => onExample(true)}>
          {pt ? 'Ver exemplo' : 'See example'}
        </button>
      </header>
      {!document ? (
        <p className="review-empty">
          {readOnlyVersion
            ? pt
              ? 'Nesta versão de teste não é possível criar rascunhos nem pedir revisões. Use “Ver exemplo” para ver como revisores comentam e sugerem correções.'
              : 'This test version cannot create drafts or request reviews. Use “See example” to see how reviewers comment and suggest corrections.'
            : pt
              ? 'A revisão da equipe começa depois que o rascunho é criado.'
              : 'The team review starts once the draft is created.'}
        </p>
      ) : (
        <>
          <section>
            <h4>
              {pt ? 'Revisores desta versão' : 'Reviewers of this version'}
              <small>v{document.version}</small>
            </h4>
            {document.reviewers?.length ? (
              <ul className="review-people">
                {document.reviewers.map(id => {
                  const decision = document.decisions?.find(
                    item => item.userId === id && item.version === document.version,
                  );
                  return (
                    <li key={id} className={`decision-${decision?.decision || 'pending'}`}>
                      <i aria-hidden="true">{name(id).slice(0, 1)}</i>
                      <span>
                        <strong>{name(id)}</strong>
                      </span>
                      <em>
                        {decisionLabel(decision?.decision || '', pt)}
                        {decision?.comment && <small>{decision.comment}</small>}
                      </em>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="review-empty">
                {pt ? 'Nenhuma revisão solicitada para esta versão.' : 'No review requested for this version.'}
              </p>
            )}
            {mutate && canEdit && !quiet && document.status !== 'approved' && (
              <div className="review-request">
                <DeliverySelect
                  label={pt ? 'Pedir revisão a' : 'Ask for review from'}
                  choices={members
                    .filter(
                      member =>
                        member.canReview &&
                        !member.isFictionalProfile &&
                        member.id !== document.authorId &&
                        member.id !== user?.id,
                    )
                    .map(member => ({ id: member.id, label: member.name }))}
                  selected={reviewers}
                  onChange={setReviewers}
                />
                <button
                  type="button"
                  disabled={busy || !reviewers.length}
                  onClick={async () => {
                    if (await mutate('document.request_review', { id: document.id, reviewers })) setReviewers([]);
                  }}
                >
                  {pt ? 'Solicitar revisão' : 'Request review'}
                </button>
              </div>
            )}
            {canEdit && changed && (
              <p className="review-empty">
                {pt ? 'Salve a versão antes de pedir revisão.' : 'Save the version before asking for review.'}
              </p>
            )}
          </section>
          {mutate && document.canReview && !quiet && (
            <section>
              <h4>{pt ? 'Seu parecer' : 'Your decision'}</h4>
              <label className="review-field">
                {pt ? 'Comentário' : 'Comment'}
                <textarea value={comment} maxLength={2000} onChange={event => setComment(event.target.value)} />
              </label>
              <div className="review-suggestion-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void mutate('document.review', {
                      id: document.id,
                      decision: 'approve',
                      comment,
                      version: document.version,
                    })
                  }
                >
                  {pt ? 'Aprovar versão' : 'Approve version'}
                </button>
                <button
                  type="button"
                  disabled={busy || !comment.trim()}
                  onClick={() =>
                    void mutate('document.review', {
                      id: document.id,
                      decision: 'request_changes',
                      comment,
                      version: document.version,
                    })
                  }
                >
                  {pt ? 'Pedir alterações' : 'Request changes'}
                </button>
              </div>
            </section>
          )}
          <section>
            <h4>
              {pt ? 'Sugestões de correção' : 'Suggested corrections'}
              <small>{open ? (pt ? `${open} abertas` : `${open} open`) : suggestions.length}</small>
            </h4>
            {mutate &&
              document.canSuggest &&
              !quiet &&
              (composing ? (
                <form
                  className="review-compose"
                  onSubmit={async event => {
                    event.preventDefault();
                    if (
                      await mutate('document.suggest', {
                        id: document.id,
                        version: document.version,
                        quote,
                        replacement,
                        comment: note,
                      })
                    ) {
                      setComposing(false);
                      setQuote('');
                      setReplacement('');
                      setNote('');
                    }
                  }}
                >
                  <label className="review-field">
                    {pt ? 'Trecho citado' : 'Quoted text'}
                    <textarea
                      required
                      value={quote}
                      maxLength={2000}
                      onChange={event => setQuote(event.target.value)}
                      placeholder={pt ? 'Selecione um trecho no documento' : 'Select text in the document'}
                    />
                  </label>
                  {quote && !unique(document.body, quote) && (
                    <small className="review-warning">
                      {pt
                        ? 'O trecho precisa aparecer exatamente uma vez na versão salva.'
                        : 'The text must appear exactly once in the saved version.'}
                    </small>
                  )}
                  <label className="review-field">
                    {pt ? 'Texto sugerido (vazio para só comentar)' : 'Suggested text (empty to comment only)'}
                    <textarea
                      value={replacement}
                      maxLength={4000}
                      onChange={event => setReplacement(event.target.value)}
                    />
                  </label>
                  <label className="review-field">
                    {pt ? 'Motivo' : 'Reason'}
                    <textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
                  </label>
                  <div className="review-suggestion-actions">
                    <button
                      type="submit"
                      className="primary"
                      disabled={busy || !unique(document.body, quote) || (!replacement && !note.trim())}
                    >
                      {pt ? 'Enviar sugestão' : 'Send suggestion'}
                    </button>
                    <button type="button" onClick={() => setComposing(false)}>
                      {pt ? 'Cancelar' : 'Cancel'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="review-compose-open"
                  onClick={() => {
                    setComposing(true);
                    setQuote(selection);
                  }}
                >
                  <MessageSquarePlus size={14} aria-hidden="true" />
                  {selection
                    ? pt
                      ? 'Sugerir correção no trecho selecionado'
                      : 'Suggest a correction to the selection'
                    : pt
                      ? 'Sugerir correção'
                      : 'Suggest a correction'}
                </button>
              ))}
            {suggestions.length ? (
              <ol className="review-suggestions">
                {suggestions.map((item: DeliverySuggestion) => (
                  <li key={item.id} className={`is-${item.status}`}>
                    <button type="button" className="review-suggestion-anchor" onClick={() => onFocus(item.id)}>
                      <strong>{item.authorName}</strong>
                      <span>{item.comment || (pt ? 'Alteração de texto' : 'Text change')}</span>
                      <small>v{item.version}</small>
                    </button>
                    <Change quote={item.quote} replacement={item.replacement} pt={pt} />
                    {item.status !== 'open' ? (
                      <small className="review-suggestion-state">
                        {item.status === 'accepted' ? (
                          <Check size={12} aria-hidden="true" />
                        ) : (
                          <X size={12} aria-hidden="true" />
                        )}
                        {item.status === 'accepted' ? (pt ? 'Aplicada' : 'Applied') : pt ? 'Descartada' : 'Dismissed'}
                        {item.resolvedByName && ` · ${item.resolvedByName}`}
                      </small>
                    ) : mutate && canEdit && !quiet ? (
                      <div className="review-suggestion-actions">
                        {item.replacement && (
                          <button
                            type="button"
                            disabled={busy || !unique(document.body, item.quote)}
                            onClick={() =>
                              void mutate('document.resolve_suggestion', {
                                id: document.id,
                                suggestionId: item.id,
                                decision: 'accept',
                                version: document.version,
                              })
                            }
                          >
                            {pt ? 'Aplicar como nova versão' : 'Apply as new version'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void mutate('document.resolve_suggestion', {
                              id: document.id,
                              suggestionId: item.id,
                              decision: 'dismiss',
                              version: document.version,
                            })
                          }
                        >
                          {item.replacement
                            ? pt
                              ? 'Descartar'
                              : 'Dismiss'
                            : pt
                              ? 'Marcar como resolvida'
                              : 'Mark resolved'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="review-empty">
                {pt
                  ? 'Revisores atribuídos selecionam um trecho e propõem o texto corrigido; quem edita aplica ou descarta.'
                  : 'Assigned reviewers select text and propose a correction; editors apply or dismiss it.'}
              </p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
