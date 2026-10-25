import { useState } from 'react';
import { segmentHighlights } from '../../../shared/evidence-anchors.mjs';
import '../../styles/delivery.css';
export type RequirementFinding = { id: string; severity: string; title: string; explanation: string; suggestion: string; start: number | null; end: number | null; affectedText: string; origin: string; ruleId?: string | null; reference?: { title: string; source?: string; section: string; page?: number | null; url: string; guidance?: string } | null };
const rank = (severity: string) => ({ critical: 3, warning: 2, info: 1 } as Record<string, number>)[severity] || 0;
/** Pure client presentation: accepts already validated offsets, never generates a finding.
 * Overlapping findings are combined visually; every finding covering a span stays selectable. */
export function RequirementHighlights({ statement, findings, language = 'pt', onSelect, compact = false, initialFinding = '' }: { statement: string; findings: RequirementFinding[]; language?: 'pt' | 'en'; onSelect?: (finding: RequirementFinding) => void; compact?: boolean; initialFinding?: string }) {
  const [active, setActive] = useState(initialFinding), [stack, setStack] = useState<string[]>([]), pt = language === 'pt';
  const valid = findings.filter(f => f.start !== null && f.end !== null && f.end! <= statement.length && f.start! < f.end! && statement.slice(f.start!, f.end!) === f.affectedText);
  const segments = segmentHighlights(statement.length, valid.map(f => ({ id: f.id, start: f.start!, end: f.end! })));
  const selected = findings.find(f => f.id === active);
  const choose = (finding: RequirementFinding) => { setActive(finding.id); onSelect?.(finding); };
  return <div className={`requirement-reading${compact ? ' compact' : ''}`}><p className="requirement-reading-text">{segments.map(segment => {
    const text = statement.slice(segment.start, segment.end);
    if (!segment.ids.length) return <span key={segment.start}>{text}</span>;
    const covering = valid.filter(f => segment.ids.includes(f.id)).sort((a, b) => rank(b.severity) - rank(a.severity));
    const top = covering[0];
    return <mark role="button" tabIndex={0} key={segment.start} className={`requirement-highlight ${top.severity}${covering.length > 1 ? ' overlapping' : ''}`} aria-pressed={covering.some(f => f.id === active)}
      aria-label={`${text}: ${covering.map(f => f.title).join('; ')}`} title={covering.length > 1 ? `${covering.length} ${pt ? 'apontamentos neste trecho' : 'findings on this span'}` : top.title}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setStack(covering.map(f=>f.id));choose(covering.find(f=>f.id!==active)||top);}}} onClick={event => { event.stopPropagation(); setStack(covering.map(f => f.id)); choose(covering.find(f => f.id !== active) || top); }}>{text}{covering.length > 1 && <sup aria-hidden="true">{covering.length}</sup>}</mark>;
  })}</p>
  {!compact && stack.length > 1 && <div className="requirement-findings" aria-label={pt ? 'Apontamentos sobrepostos neste trecho' : 'Overlapping findings on this span'}>{stack.map(id => findings.find(f => f.id === id)).filter(Boolean).map(f => <button key={f!.id} className={`requirement-finding-choice ${f!.severity}`} aria-pressed={active === f!.id} onClick={() => choose(f!)}><span className="requirement-severity-dot" /><span>{f!.title}</span></button>)}</div>}
  {!compact && findings.length > 0 && <div className="requirement-findings" aria-label={pt ? 'Apontamentos da revisão' : 'Review findings'}>{findings.map(f => <button key={f.id} className={`requirement-finding-choice ${f.severity}`} aria-pressed={active === f.id} onClick={() => choose(f)}><span className="requirement-severity-dot" /><span>{f.title}</span></button>)}</div>}
  {!compact && selected && <article className={`requirement-finding-detail ${selected.severity}`}><span className="delivery-id">{selected.severity === 'critical' ? (pt ? 'PENDÊNCIA CRÍTICA' : 'CRITICAL FINDING') : selected.severity === 'warning' ? (pt ? 'REVISAR' : 'REVIEW') : (pt ? 'SUGESTÃO' : 'SUGGESTION')}</span><h3>{selected.title}</h3><p>{selected.explanation}</p><p><strong>{pt ? 'Próximo passo: ' : 'Next step: '}</strong>{selected.suggestion}</p>{selected.reference ? <a href={selected.reference.url} target="_blank" rel="noreferrer">{selected.reference.source || selected.reference.title} · {selected.reference.section}{selected.reference.page ? ` · p. ${selected.reference.page}` : ''} ↗</a> : <small>{pt ? 'Checklist editorial local · sem atribuição normativa' : 'Local editorial checklist · no standards attribution'}</small>}<small>{selected.origin === 'model_suggestion' ? (pt ? 'Sugestão de IA com referência conferida; revisar interpretação.' : 'AI suggestion with checked reference; review the interpretation.') : (pt ? 'Triagem de texto; a aplicabilidade precisa de revisão humana.' : 'Text screening; applicability requires human review.')}</small></article>}</div>;
}
