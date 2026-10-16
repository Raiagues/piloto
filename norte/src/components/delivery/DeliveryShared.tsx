import { X, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DeliveryState } from '../../lib/projectDelivery';
import '../../styles/delivery.css';
export function DeliveryModal({ title, children, onClose, drawer = false }: { title: string; children: ReactNode; onClose: () => void; drawer?: boolean }) {
  const dialog = useRef<HTMLElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]';
    dialog.current?.querySelector<HTMLElement>('[autofocus], input, textarea, button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role=dialog]')].at(-1) !== dialog.current) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>(selector) || [])].filter(item => item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className={`delivery-overlay${drawer ? ' delivery-drawer-overlay' : ''}`} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialog} className={`delivery-dialog${drawer ? ' delivery-drawer' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close / Fechar"><X size={19} /></button></header>{children}</section></div>;
}
export function DeliveryAlert({ error, refresh, pt }: { error: string; refresh: () => unknown; pt: boolean }) { return error ? <div className="delivery-error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}><RefreshCw size={14} />{pt ? 'Atualizar' : 'Refresh'}</button></div> : null; }
export function DeliverySelect({ label, choices, selected, onChange, disabled = false }: { label: string; choices: { id: string; label: string }[]; selected: string[]; onChange: (value: string[]) => void; disabled?: boolean }) { return <fieldset className="delivery-multiselect" disabled={disabled}><legend>{label}</legend>{choices.length ? <div>{choices.map(choice => <label key={choice.id}><input type="checkbox" checked={selected.includes(choice.id)} onChange={event => onChange(event.target.checked ? [...selected, choice.id] : selected.filter(id => id !== choice.id))} /><span>{choice.label}</span></label>)}</div> : <small>—</small>}</fieldset>; }
export function DeliverySector({ data, value, onChange, pt }: { data: DeliveryState; value: string; onChange: (value: string) => void; pt: boolean }) { return <label>{pt ? 'Setor responsável' : 'Responsible sector'}<select value={value} onChange={event => onChange(event.target.value)}>{data.permissions.manage && <option value="">{pt ? 'Projeto' : 'Project'}</option>}{data.sectors.filter(s => data.permissions.manage || data.permissions.editableSectorIds.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>; }
export function DeliveryOwner({ data, value, onChange, pt }: { data: DeliveryState; value: string; onChange: (value: string) => void; pt: boolean }) { return <label>{pt ? 'Responsável' : 'Owner'}<select value={value} onChange={event => onChange(event.target.value)}><option value="">{pt ? 'A definir' : 'Unassigned'}</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>; }
export function DeliveryStandards({ data, busy, mutate, pt }: { data: DeliveryState; busy: boolean; mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>; pt: boolean }) {
  const [query, setQuery] = useState(''), [group, setGroup] = useState('');
  const options = data.standardOptions.filter(s => (!group || s.group === group) && `${s.name} ${s.subtitle || ''} ${s.edition || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <details className="delivery-standards"><summary>{pt ? 'Referências normativas' : 'Standard references'} · {data.standards.length ? `${data.standards.length} ${pt ? 'selecionadas' : 'selected'}` : pt ? 'Nenhuma selecionada' : 'None selected'}</summary>
    <p>{pt ? 'Opcional. Selecione referências para a equipe consultar. A seleção não declara conformidade nem torna documentos obrigatórios; confirme a edição e a aplicabilidade no projeto.' : 'Optional. Select references for your team. Selection does not declare compliance or make documents mandatory; confirm the edition and applicability for your project.'}</p>
    <div className="delivery-toolbar"><input type="search" aria-label={pt ? 'Buscar referência normativa' : 'Search standard reference'} placeholder={pt ? 'Buscar norma, guia ou edição' : 'Search standard, guide or edition'} value={query} onChange={e => setQuery(e.target.value)} /><select aria-label={pt ? 'Grupo de referências' : 'Reference group'} value={group} onChange={e => setGroup(e.target.value)}><option value="">{pt ? 'Todos os grupos' : 'All groups'}</option>{data.standardGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>{data.permissions.manage && data.standards.length > 0 && <button disabled={busy} onClick={() => void mutate('standards.set', { standards: [] })}>{pt ? 'Continuar sem norma' : 'Continue without standards'}</button>}</div>
    <div className="delivery-standard-list">{options.map(s => <div className="delivery-standard-card" key={s.id}><label><input type="checkbox" disabled={!data.permissions.manage || busy} checked={data.standards.includes(s.id)} onChange={e => void mutate('standards.set', { standards: e.target.checked ? [...data.standards, s.id] : data.standards.filter(id => id !== s.id) })} /><span><strong>{s.name}</strong><small>{s.edition} · {s.subtitle}</small></span><a href={s.url} target="_blank" rel="noreferrer">{pt ? 'Fonte oficial' : 'Official source'}</a></label><details><summary>{pt ? 'Escopo e produtos relacionados' : 'Scope and related products'}</summary><p>{s.scope}</p>{s.docs && <ul>{s.docs.map((doc, index) => <li key={`${doc.title}-${index}`}>{doc.title}<small>{doc.basis}</small></li>)}</ul>}<p>{s.note}</p></details></div>)}</div>
    <p>{pt ? 'Catálogo adaptado das referências do projeto' : 'Catalogue adapted from references in'} <a href="https://github.com/Raiagues/testes_requisitos/tree/692739d7" target="_blank" rel="noreferrer">testes_requisitos</a>. {pt ? 'Os textos completos permanecem nas fontes oficiais.' : 'Full texts remain with their official sources.'}</p>
  </details>;
}
