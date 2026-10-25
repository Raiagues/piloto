import { useState } from 'react';
import { ArrowRight, Flag } from 'lucide-react';
import { REQUIREMENT_RULES } from '../../shared/requirement-quality.mjs';
import { RequirementHighlights } from './delivery/RequirementHighlights';
import { DeliveryModal } from './delivery/DeliveryShared';
import type { RequirementFinding } from './delivery/RequirementHighlights';
import type { Language } from '../lib/types';
const examples = [
  {
    id: 'REQ-001', title: 'Transmissão de telemetria',
    statement: 'O sistema deve transmitir os dados de telemetria rapidamente.',
    affectedText: 'rapidamente', ruleId: 'nasa-verifiable', sectionText: 'Verifiability/Testability',
    findingTitle: 'Falta um limite verificável',
    explanation: '“Rapidamente” não define o tempo nem as condições que permitem verificar o atendimento.',
    suggestion: 'Defina o tempo máximo e a condição de transmissão com a equipe, a partir da necessidade de origem.',
  },
  {
    id: 'REQ-002', title: 'Interface de aquisição',
    statement: 'A interface entre a unidade de aquisição e o computador deve seguir o documento de interface aprovado.',
    affectedText: 'documento de interface aprovado', ruleId: 'nasa-clear', sectionText: 'Clarity',
    findingTitle: 'A referência precisa ser identificada',
    explanation: 'O texto não identifica o documento nem sua revisão. Versões diferentes podem descrever interfaces diferentes.',
    suggestion: 'Vincule o documento de interface e registre seu identificador e a revisão aprovada.',
  },
  {
    id: 'REQ-003', title: 'Condição de operação',
    statement: 'O equipamento deve operar na faixa de temperatura a definir.',
    affectedText: 'a definir', ruleId: 'nasa-complete', sectionText: 'Completeness',
    findingTitle: 'A condição ainda está pendente',
    explanation: 'A faixa de temperatura permanece em aberto; esta versão ainda não permite concluir a verificação.',
    suggestion: 'Registre a pendência, seu responsável e o prazo para definir a faixa com base nas condições de uso.',
  },
].map(example => {
  const rule = REQUIREMENT_RULES.find(item => item.id === example.ruleId)!;
  const start = example.statement.indexOf(example.affectedText);
  const finding: RequirementFinding = {
    id: `${example.id}-example`, ruleId: rule.id, severity: 'warning', origin: 'illustrative',
    title: example.findingTitle, explanation: example.explanation, suggestion: example.suggestion,
    start, end: start + example.affectedText.length, affectedText: example.affectedText,
    reference: { ...rule, url: `${rule.url}#:~:text=${encodeURIComponent(example.sectionText)}` },
  };
  return { ...example, findings: [finding] };
});
/** Static, cited example. Opening the landing page never starts an AI analysis. */
export function LandingRequirements({language}:{language:Language}) {
  const pt=language==='pt', [selected,setSelected]=useState<number|null>(null),[finding,setFinding]=useState('');
  const rows=examples;
  const open=(index:number,id?:string)=>{setSelected(index);setFinding(id||rows[index].findings[0]?.id||'');};
  const row=selected===null?null:rows[selected];
  return <section className="landing-requirements" aria-label={pt?'Exemplo interativo de requisitos':'Interactive requirement example'}>
    <header><strong>{pt?'Exemplo ilustrativo':'Illustrative example'}</strong><span>{pt?'Revisão de requisitos':'Requirement review'}</span></header>
    <div className="landing-requirements-title"><h2>{pt?'Do requisito à fonte':'From requirement to source'}</h2><small>{pt?'Explore os destaques':'Explore highlights'}</small></div>
    <div className="landing-requirements-columns"><span>ID</span><span>{pt?'REQUISITO':'REQUIREMENT'}</span><span>{pt?'ANÁLISE':'ANALYSIS'}</span></div>
    {rows.map((item,i)=><div className="landing-requirement-row" key={item.id}>
      <button className="landing-requirement-id" onClick={()=>open(i)}>{item.id}</button>
      <RequirementHighlights compact statement={item.statement} findings={item.findings} language={language} onSelect={f=>open(i,f.id)}/>
      <button aria-label={`${pt?'Abrir análise':'Open analysis'} ${item.id}`} className="landing-review-dot warning" onClick={()=>open(i)}/>
    </div>)}
    <footer><Flag size={19}/><div><strong>{pt?'Trecho, motivo e referência no mesmo lugar':'Text, explanation and reference together'}</strong><p>{pt?'Clique em um destaque para conferir o apontamento e abrir a fonte oficial.':'Select a highlight to review the finding and open its official source.'}</p><button onClick={()=>open(0)}>{pt?'Ver análise de exemplo':'View example review'} <ArrowRight size={14}/></button></div></footer>
    {row&&<DeliveryModal drawer title={`${row.id} · ${row.title}`} onClose={()=>setSelected(null)}><div className="delivery-detail"><RequirementHighlights key={`${row.id}:${finding}`} statement={row.statement} findings={row.findings} initialFinding={finding} language={language}/><small>{pt?'Exemplo ilustrativo, sem vínculo com um projeto real.':'Illustrative example, unrelated to a real project.'}</small></div></DeliveryModal>}
  </section>;
}
