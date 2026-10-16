import PDFDocument from 'pdfkit';
export function draftDeliveryDocument(definition, project, requirements, tests, task) {
 const lines=[`# ${definition.title}`,`Projeto: ${project.name}`,`Situação: RASCUNHO PARA REVISÃO DA EQUIPE`,task?`Revisão planejada: ${task.title} · ${task.dueDate || 'data a definir'}`:'', 'Este documento compila registros atuais. Não comprova ensaio, aprovação ou certificação. As datas do planejamento são definidas pela equipe.', ''];
 if(definition.reference) lines.push(`Referência: ${definition.reference.title} · ${definition.reference.section}`,definition.reference.url,'');
 if(['requirements','traceability','analysis','verification-matrix'].includes(definition.content)) for(const r of requirements.filter(r=>!r.archived)) lines.push(`## ${r.id} · ${r.title} · v${r.version}`,r.statement,`Situação de revisão: ${r.status}`,`Método: ${r.method || 'a definir'}`,`Critério: ${r.acceptanceCriteria || 'PENDENTE — definir critério de aceitação'}`,`Origem: ${(r.sourceRefs||[]).join(', ') || 'PENDENTE — vincular fonte'}`,'');
 else if(['verification-plan','verification-results'].includes(definition.content)) for(const test of tests.filter(t=>!t.archived)) lines.push(`## ${test.id} · ${test.title}`,`Requisitos: ${test.requirementIds.join(', ')}`,`Procedimento: ${test.procedure || 'PENDENTE'}`,`Critério: ${test.acceptanceCriteria || 'PENDENTE'}`,`Execuções registradas: ${test.runs.length}`,...test.runs.map(run=>`${run.createdAt}: ${run.outcome} — ${run.result}. Evidências: ${run.artifactIds.join(', ')} ${run.evidenceUrl}`),'');
 else if(['architecture','preliminary','detailed'].includes(definition.content)) for(const entity of project.engineeringSystem?.entities||[]) lines.push(`## ${entity.id} · ${entity.name}`,`${entity.kind}; origem: ${(entity.evidenceRefs||[]).join(', ') || 'a confirmar'}`,entity.description||'', '');
 else lines.push('## Objetivo e escopo',task?.description||'PENDENTE — registrar objetivo e limites do documento.','', '## Base documental',...(project.engineeringSystem?.artifactSources||[]).map(a=>`- ${a.artifactLabel||a.artifactId||a.id}`),'', '## Critérios de entrada','PENDENTE — identificar versões, responsáveis e critérios verificáveis.','','## Decisões, evidências e ações','PENDENTE — preencher após revisão humana; não há execução presumida.');
 lines.push('','## Pendências de preparação','- Confirmar aplicabilidade e edição das referências.','- Conferir os documentos de origem e completar campos pendentes.','- Identificar autor, revisor e autoridade da revisão.');
 return lines.join('\n');
}
export async function deliveryPdf(document) {
 const pdf=new PDFDocument({size:'A4',margin:48}), chunks=[];
 pdf.on('data',chunk=>chunks.push(chunk));const completed=new Promise((resolve,reject)=>{pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
 pdf.font('Helvetica').fontSize(9).fillColor('#785636').text('NORTE / RASCUNHO DE ENGENHARIA');pdf.moveDown();
 for(const line of document.body.split('\n')) {const heading=line.startsWith('#');pdf.font(heading?'Helvetica-Bold':'Helvetica').fontSize(line.startsWith('# ')?18:heading?12:10).fillColor('#252c30').text(line.replace(/^#+\s*/,''),{lineGap:3,...(/^https:\/\//.test(line)?{link:line,underline:true}:{})});if(heading)pdf.moveDown(.4);}
 pdf.end();return completed;
}
