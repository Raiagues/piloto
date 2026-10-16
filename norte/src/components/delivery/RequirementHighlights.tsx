import { useState } from 'react';
import '../../styles/delivery.css';
export type RequirementFinding = { id: string; severity: string; title: string; explanation: string; suggestion: string; start: number | null; end: number | null; affectedText: string; origin: string; ruleId?: string | null; reference?: { title: string; source?: string; section: string; page?: number | null; url: string; guidance?: string } | null };
/** Pure client presentation: accepts already validated offsets, never generates a finding. */
export function RequirementHighlights({ statement, findings, language = 'pt', onSelect }: { statement: string; findings: RequirementFinding[]; language?: 'pt' | 'en'; onSelect?: (finding: RequirementFinding) => void }) {
  const [active, setActive] = useState(''), selected = findings.find(f => f.id === active), pt = language === 'pt';
  let cursor = 0;
  const pieces: React.ReactNode[] = [];
  for (const finding of [...findings].filter(f => f.start !== null && f.end !== null).sort((a,b) => a.start! - b.start!)) {
    if (finding.start! < cursor || finding.end! > statement.length || statement.slice(finding.start!,finding.end!) !== finding.affectedText) continue;
    pieces.push(statement.slice(cursor,finding.start!));
    pieces.push(<button className={`requirement-highlight ${finding.severity}`} key={finding.id} aria-pressed={active === finding.id} aria-label={`${finding.affectedText}: ${finding.title}`} onClick={() => { setActive(finding.id); onSelect?.(finding); }}>{finding.affectedText}</button>);
    cursor = finding.end!;
  }
  pieces.push(statement.slice(cursor));
  return <div className="requirement-reading"><p className="requirement-reading-text">{pieces}</p>{findings.length > 0 && <div className="requirement-findings" aria-label={pt ? 'Apontamentos da revisão' : 'Review findings'}>{findings.map(f => <button key={f.id} className={`requirement-finding-choice ${f.severity}`} aria-pressed={active === f.id} onClick={() => { setActive(f.id); onSelect?.(f); }}><span className="requirement-severity-dot" /><span>{f.title}</span></button>)}</div>}{selected && <article className={`requirement-finding-detail ${selected.severity}`}><span className="delivery-id">{selected.severity === 'critical' ? (pt ? 'PENDÊNCIA CRÍTICA' : 'CRITICAL FINDING') : selected.severity === 'warning' ? (pt ? 'REVISAR' : 'REVIEW') : (pt ? 'SUGESTÃO' : 'SUGGESTION')}</span><h3>{selected.title}</h3><p>{selected.explanation}</p><p><strong>{pt ? 'Próximo passo: ' : 'Next step: '}</strong>{selected.suggestion}</p>{selected.reference ? <a href={selected.reference.url} target="_blank" rel="noreferrer">{selected.reference.source || selected.reference.title} · {selected.reference.section}{selected.reference.page ? ` · p. ${selected.reference.page}` : ''} ↗</a> : <small>{pt ? 'Checklist editorial local · sem atribuição normativa' : 'Local editorial checklist · no standards attribution'}</small>}<small>{selected.origin === 'model_suggestion' ? (pt ? 'Sugestão de IA com referência conferida; revisar interpretação.' : 'AI suggestion with checked reference; review the interpretation.') : (pt ? 'Triagem de texto; a aplicabilidade precisa de revisão humana.' : 'Text screening; applicability requires human review.')}</small></article>}</div>;
}
