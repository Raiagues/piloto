import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { LIFE_DURATIONS, lifecycleMilestones, lifecycleRanges, shiftDate } from '../../../shared/delivery-lifecycle.mjs';
import type { LifecyclePhase } from '../../../shared/delivery-lifecycle.mjs';
import type { DeliveryLifecycle, DeliveryState } from '../../lib/projectDelivery';
import { previewScheduleTasks } from '../../lib/schedulePlanning';
import '../../styles/lifecycle-settings.css';

const DAY = 86400000;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPhaseDates = (phase: LifecyclePhase) => validDate(phase.start) && validDate(phase.end) && phase.end >= phase.start;

type LifecycleSettingsProps = {
  data: DeliveryState;
  busy: boolean;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  pt: boolean;
  error: string;
  onPreview?: (draft: DeliveryLifecycle) => void;
  focusPhase?: string;
};

export function LifecycleSettings({ data, busy, mutate, onClose, pt, error, onPreview, focusPhase }: LifecycleSettingsProps) {
  const [draft, setDraft] = useState<DeliveryLifecycle>(() => {
    const initial = data.lifecycle || { profile: 'nasa', startDate: new Date().toISOString().slice(0, 10), durations: LIFE_DURATIONS.nasa, selectedReviews: [] };
    return { ...initial, durations: [...initial.durations], phases: lifecycleRanges(initial), selectedReviews: [...(data.lifecycle?.selectedReviews || lifecycleMilestones(initial).filter(review => review.active).map(review => review.id))] };
  });
  const [section, setSection] = useState<'phases' | 'reviews'>('phases');
  const [expandedPhase, setExpandedPhase] = useState(focusPhase || '');
  const [focusRequest, setFocusRequest] = useState(focusPhase || '');
  const [dateError, setDateError] = useState('');
  const profileDrafts = useRef(new Map<string, DeliveryLifecycle>());
  const lastProjectStart = useRef(draft.startDate);
  const panel = useRef<HTMLElement>(null);
  const phases = draft.phases || [];
  const datesValid = validDate(draft.startDate) && phases.every(validPhaseDates);
  const invalidPhase = phases.find(phase => !phase.code.trim() || !phase.name.trim() || !validPhaseDates(phase));
  const definitions = useMemo(() => datesValid ? lifecycleMilestones(draft) : [], [draft, datesValid]);
  const previewReviews = useMemo(() => datesValid ? previewScheduleTasks(data, { ...draft, selectedReviews: definitions.map(review => review.id) }) : [], [data, draft, datesValid, definitions]);
  const includedCount = draft.selectedReviews.filter(id => definitions.some(review => review.id === id)).length;
  const canEdit = data.permissions.manage;
  const disabled = busy || !canEdit;
  const valid = datesValid && !invalidPhase && !dateError;

  useEffect(() => { if (datesValid) onPreview?.(draft); }, [draft, datesValid, onPreview]);
  useEffect(() => {
    if (!focusPhase) return;
    setSection('phases');
    setExpandedPhase(focusPhase);
    setFocusRequest(focusPhase);
  }, [focusPhase]);
  useEffect(() => {
    if (!focusRequest || section !== 'phases' || expandedPhase !== focusRequest) return;
    const input = panel.current?.querySelector<HTMLInputElement>(`[id="phase-name-${CSS.escape(focusRequest)}"]`);
    if (input) { input.focus(); setFocusRequest(''); }
  }, [focusRequest, expandedPhase, section]);

  const patchPhase = (id: string, patch: Partial<LifecyclePhase>) => {
    setDateError('');
    setDraft(value => ({ ...value, phases: value.phases?.map(phase => phase.id === id ? { ...phase, ...patch } : phase) }));
  };
  const choose = (profile: string) => {
    profileDrafts.current.set(draft.profile, draft);
    const previousDraft = profileDrafts.current.get(profile);
    const initial = { version: draft.version || 0, profile, startDate: validDate(draft.startDate) ? draft.startDate : lastProjectStart.current, durations: [...LIFE_DURATIONS[profile]], selectedReviews: [] as string[] };
    let next = previousDraft;
    if (!next) {
      try {
        const nextPhases = lifecycleRanges(initial);
        if (!nextPhases.every(validPhaseDates)) throw new RangeError('Invalid phase dates');
        next = { ...initial, phases: nextPhases, selectedReviews: lifecycleMilestones(initial).filter(review => review.active).map(review => review.id) };
      } catch {
        setDateError(pt ? 'Antecipe o início para que todas as fases terminem até o ano 9999.' : 'Choose an earlier start so all phases finish by the year 9999.');
        return;
      }
    }
    setDraft(next);
    lastProjectStart.current = next.startDate;
    setExpandedPhase('');
    setDateError('');
  };
  const changeStart = (startDate: string) => {
    setDateError('');
    if (!validDate(startDate)) { setDraft(value => ({ ...value, startDate })); return; }
    const delta = Math.round((Date.parse(startDate) - Date.parse(lastProjectStart.current)) / DAY);
    const shifted = phases.map(phase => ({ ...phase, start: validDate(phase.start) ? shiftDate(phase.start, delta) : phase.start, end: validDate(phase.end) ? shiftDate(phase.end, delta) : phase.end }));
    if (shifted.some((phase, index) => (validDate(phases[index].start) && !validDate(phase.start)) || (validDate(phases[index].end) && !validDate(phase.end)))) {
      setDateError(pt ? 'Escolha um início que mantenha as fases entre os anos 0001 e 9999.' : 'Choose a start that keeps phases between years 0001 and 9999.');
      return;
    }
    lastProjectStart.current = startDate;
    setDraft(value => ({ ...value, startDate, phases: shifted }));
  };
  const addPhase = () => {
    const start = phases.at(-1)?.end || draft.startDate;
    if (!validDate(start)) return;
    const end = shiftDate(start, 28);
    if (!validDate(end)) { setDateError(pt ? 'A data final da nova fase ultrapassa o ano 9999.' : 'The new phase ends after the year 9999.'); return; }
    const id = crypto.randomUUID();
    setDraft(value => ({ ...value, phases: [...(value.phases || []), { id, code: `P${phases.length + 1}`, name: pt ? 'Nova fase' : 'New phase', start, end }] }));
    setExpandedPhase(id);
    setFocusRequest(id);
  };
  const formatDate = (value: string) => validDate(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
  const validationMessage = dateError || (!validDate(draft.startDate) ? (pt ? 'Informe uma data de início válida.' : 'Enter a valid project start date.') : invalidPhase ? (pt ? `Confira o nome, o código e as datas da fase ${invalidPhase.code || 'sem código'}.` : `Check the name, code and dates for phase ${invalidPhase.code || 'without a code'}.`) : '');

  return <aside ref={panel} className="planning-settings planning-settings-panel" aria-label={pt ? 'Modelo de ciclo de vida' : 'Lifecycle template'} aria-busy={busy}>
    <header className="planning-settings-heading">
      <div><strong>{pt ? 'Ajustar planejamento' : 'Adjust schedule'}</strong><small>{pt ? 'Veja as mudanças no cronograma.' : 'Preview your changes on the timeline.'}</small></div>
      <button type="button" disabled={busy} onClick={onClose} aria-label={pt ? 'Fechar configuração' : 'Close configuration'}><X size={17} /></button>
    </header>
    <form noValidate onSubmit={async event => {
      event.preventDefault();
      if (disabled || !valid) return;
      if (await mutate('lifecycle.configure', { ...draft, expectedLifecycleVersion: draft.version || 0, selectedReviews: draft.selectedReviews.filter(id => definitions.some(review => review.id === id)) })) onClose();
    }}>
      <div className="planning-settings-scroll">
        <fieldset className="planning-settings-basics" disabled={disabled}>
          <label>{pt ? 'Referência de planejamento' : 'Planning reference'}<select value={draft.profile} onChange={event => choose(event.target.value)}><option value="nasa">NASA</option><option value="ecss">ECSS</option><option value="custom">{pt ? 'Personalizado' : 'Custom'}</option><option value="none">{pt ? 'Sem modelo' : 'No template'}</option></select></label>
          <label>{pt ? 'Início do projeto' : 'Project start'}<input required type="date" min="0001-01-01" max="9999-12-31" value={draft.startDate} onChange={event => changeStart(event.target.value)} /></label>
        </fieldset>
        <div className="planning-settings-tabs" aria-label={pt ? 'Opções do planejamento' : 'Schedule options'}>
          <button type="button" aria-pressed={section === 'phases'} onClick={() => setSection('phases')}>{pt ? 'Fases' : 'Phases'}<span>{phases.length}</span></button>
          <button type="button" aria-pressed={section === 'reviews'} disabled={!datesValid} onClick={() => setSection('reviews')}>{pt ? 'Revisões' : 'Reviews'}<span>{includedCount}</span></button>
        </div>
        {section === 'phases' ? <fieldset className="planning-settings-fields" disabled={disabled}>
          <div className="planning-settings-phase-list">
            {phases.map(phase => {
              const expanded = expandedPhase === phase.id;
              return <section className={`planning-settings-phase${expanded ? ' is-expanded' : ''}`} key={phase.id}>
                <button type="button" className="planning-settings-phase-toggle" aria-expanded={expanded} aria-controls={`phase-editor-${phase.id}`} aria-label={`${pt ? 'Editar fase' : 'Edit phase'} ${phase.code}: ${phase.name}`} onClick={() => setExpandedPhase(expanded ? '' : phase.id)}>
                  <span className="planning-settings-phase-code">{phase.code || '—'}</span>
                  <span className="planning-settings-phase-summary"><strong>{phase.name || (pt ? 'Nome da fase' : 'Phase name')}</strong><small>{formatDate(phase.start)} — {formatDate(phase.end)}</small></span>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {expanded && <div id={`phase-editor-${phase.id}`} className="planning-settings-phase-fields">
                  <div className="planning-settings-phase-name"><label>{pt ? 'Código' : 'Code'}<input aria-label={`${pt ? 'Código da fase' : 'Phase code'} ${phase.code}`} required maxLength={30} value={phase.code} onChange={event => patchPhase(phase.id, { code: event.target.value })} /></label><label>{pt ? 'Nome da fase' : 'Phase name'}<input id={`phase-name-${phase.id}`} aria-label={`${pt ? 'Nome da fase' : 'Phase name'} ${phase.code}`} required maxLength={100} value={phase.name} onChange={event => patchPhase(phase.id, { name: event.target.value })} /></label></div>
                  <div className="planning-settings-dates"><label>{pt ? 'Início' : 'Start'}<input aria-label={`${pt ? 'Início da fase' : 'Phase start'} ${phase.code}`} required type="date" min="0001-01-01" max={validDate(phase.end) ? phase.end : '9999-12-31'} value={phase.start} onChange={event => patchPhase(phase.id, { start: event.target.value })} /></label><label>{pt ? 'Fim' : 'End'}<input aria-label={`${pt ? 'Fim da fase' : 'Phase end'} ${phase.code}`} required type="date" min={validDate(phase.start) ? phase.start : '0001-01-01'} max="9999-12-31" value={phase.end} onChange={event => patchPhase(phase.id, { end: event.target.value })} /></label></div>
                  <button className="planning-settings-remove" type="button" aria-label={`${pt ? 'Remover fase' : 'Remove phase'} ${phase.code}`} onClick={() => { setDraft(value => ({ ...value, phases: value.phases?.filter(current => current.id !== phase.id) })); setExpandedPhase(''); setDateError(''); }}><Trash2 size={13} />{pt ? 'Remover fase' : 'Remove phase'}</button>
                </div>}
              </section>;
            })}
            {!phases.length && <p className="planning-settings-empty">{pt ? 'Crie as etapas que sua equipe precisa acompanhar.' : 'Create the stages your team needs to track.'}</p>}
          </div>
          <button className="planning-settings-add" type="button" disabled={phases.length >= 30 || !datesValid} onClick={addPhase}><Plus size={14} />{pt ? 'Adicionar fase' : 'Add phase'}</button>
          <small className="planning-settings-hint">{pt ? 'Remover uma fase mantém suas atividades e documentos.' : 'Removing a phase keeps its activities and documents.'}</small>
        </fieldset> : <fieldset className="planning-settings-fields" disabled={disabled}>
          <p className="planning-settings-hint">{pt ? 'Escolha as revisões que aparecem no cronograma.' : 'Choose the reviews shown on the timeline.'}</p>
          <div className="planning-settings-reviews">
            {definitions.map(review => <label key={review.id} className="planning-settings-review"><input type="checkbox" checked={draft.selectedReviews.includes(review.id)} onChange={event => setDraft(value => ({ ...value, selectedReviews: event.target.checked ? [...new Set([...value.selectedReviews, review.id])] : value.selectedReviews.filter(id => id !== review.id) }))} /><span><strong>{review.id}<span>{formatDate(previewReviews.find(task => task.reviewCode === review.id && task.lifecycleProfile === draft.profile)?.dueDate || review.date)}</span></strong><span>{pt ? review.title : review.english || review.title}</span></span></label>)}
            {!definitions.length && <p className="planning-settings-empty">{pt ? 'Este planejamento não tem revisões de referência. Você pode criar suas próprias atividades.' : 'This schedule has no template reviews. You can create your own activities.'}</p>}
          </div>
        </fieldset>}
      </div>
      <footer className="planning-settings-footer">
        {(error || validationMessage) && <p role="alert" className="planning-settings-error">{error || validationMessage}</p>}
        {!canEdit && <p className="planning-settings-hint">{pt ? 'A equipe responsável pode alterar o planejamento.' : 'The project managers can update this schedule.'}</p>}
        <div className="planning-settings-actions"><button type="button" disabled={busy} onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button><button type="submit" className="primary" disabled={disabled || !valid}><Check size={14} />{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar ciclo de vida' : 'Save lifecycle')}</button></div>
      </footer>
    </form>
  </aside>;
}
