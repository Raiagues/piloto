import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const pending = 'PENDENTE';
const list = values => (values || []).filter(Boolean).join(', ') || pending;
const cell = value => String(value ?? pending).replace(/\|/gu, '/').replace(/\r?\n/gu, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)];

export function draftDeliveryDocument(definition, project, requirements, tests, task) {
 const activeRequirements=requirements.filter(requirement=>!requirement.archived), activeTests=tests.filter(test=>!test.archived);
 const lines=[`# ${definition.title}`,`Projeto: ${project.name}`,'Emissão inicial: RASCUNHO PARA REVISÃO DA EQUIPE',task?`Revisão planejada: ${task.title} · ${task.dueDate || 'data a definir'}`:'', 'A situação vigente e as aprovações constam no controle de versão do documento.',''];
 if(definition.reference) lines.push('## Referência de estrutura',`${definition.reference.title} · ${definition.reference.section}`,definition.reference.url,'');
 lines.push('## Objetivo e escopo',task?.description||'PENDENTE — registrar objetivo, limites e configuração abrangida.','');
 if(['traceability','verification-matrix'].includes(definition.content)) {
   lines.push('## Matriz de rastreabilidade',...table(['Requisito / versão','Origem / requisito superior','Método','Verificações / situação'],activeRequirements.map(requirement=>[`${requirement.id} · v${requirement.version}`,list([...(requirement.sourceRefs||[]),...(requirement.artifactIds||[]),...(requirement.parentIds||[])]),requirement.method||pending,list(activeTests.filter(test=>test.requirementIds?.includes(requirement.id)).map(test=>`${test.id}: ${test.status||'planned'}`))])), '');
 }
 if(['requirements','traceability','analysis','verification-matrix'].includes(definition.content)) {
   if(!activeRequirements.length)lines.push('PENDENTE — nenhum requisito registrado para este escopo.','');
   for(const requirement of activeRequirements)lines.push(`## ${requirement.id} · ${requirement.title} · v${requirement.version}`,requirement.statement,`Situação de revisão: ${requirement.status}`,`Método: ${requirement.method || 'a definir'}`,`Condição: ${requirement.condition || pending}`,`Critério: ${requirement.acceptanceCriteria || 'PENDENTE — definir critério de aceitação'}`,`Origem: ${list([...(requirement.sourceRefs||[]),...(requirement.artifactIds||[])])}`,`Requisito superior: ${list(requirement.parentIds)}`,`Localização na fonte: ${requirement.sourceLocator || pending}`,'');
 } else if(['verification-plan','verification-results'].includes(definition.content)) {
   if(!activeTests.length)lines.push('PENDENTE — nenhuma verificação planejada para este escopo.','');
   for(const test of activeTests)lines.push(`## ${test.id} · ${test.title}`,`Requisitos: ${list(test.requirementIds)}`,`Método: ${test.method || pending}`,`Responsável: ${test.ownerId || pending}`,`Configuração / condições: ${test.conditions || pending}`,`Procedimento: ${test.procedure || pending}`,`Critério: ${test.acceptanceCriteria || pending}`,`Execuções registradas: ${test.runs?.length || 0}`,...(test.runs||[]).map(run=>`${run.createdAt}: ${run.outcome} — ${run.result}. Evidências: ${list(run.artifactIds)} ${run.evidenceUrl||''}`),'');
 } else if(['architecture','preliminary','detailed'].includes(definition.content)) {
   for(const entity of project.engineeringSystem?.entities||[])lines.push(`## ${entity.id} · ${entity.name}`,`${entity.kind}; origem: ${list(entity.evidenceRefs)}`,entity.description||'', '');
 } else {
   lines.push('## Base documental',...(project.engineeringSystem?.artifactSources||[]).map(source=>`- ${source.artifactLabel||source.artifactId||source.id}`),'', '## Critérios de entrada','PENDENTE — identificar versões, responsáveis e critérios verificáveis.','','## Decisões, evidências e ações','PENDENTE — preencher após revisão humana; não há execução presumida.');
 }
 lines.push('','## Preparação e aprovação','- Confirmar aplicabilidade e edição das referências.','- Conferir os documentos de origem e completar campos pendentes.','- Registrar a revisão independente e as decisões nesta versão.');
 return lines.join('\n');
}

const printable = value => [...String(value ?? '')].filter(character=>character.codePointAt(0)>=32||'\n\r\t'.includes(character)).join('');
const parseRow = line => line.trim().replace(/^\|/u,'').replace(/\|$/u,'').split('|').map(value=>value.trim());
export async function deliveryPdf(document) {
 const pdf=new PDFDocument({size:'A4',margins:{top:62,bottom:60,left:48,right:48},bufferPages:true,info:{Title:document.title||'Documento de engenharia',Author:document.authorName||'Norte',Subject:`${document.id||''} · versão ${document.version||1}`}}), chunks=[];
 pdf.on('data',chunk=>chunks.push(chunk));const completed=new Promise((resolve,reject)=>{pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
 pdf.registerFont('Body',fileURLToPath(new URL('./fonts/DejaVuSans.ttf',import.meta.url)));
 pdf.registerFont('Strong',fileURLToPath(new URL('./fonts/DejaVuSans-Bold.ttf',import.meta.url)));
 const width=pdf.page.width-96, bottom=()=>pdf.page.height-60;
 const room=height=>{if(pdf.y+height>bottom())pdf.addPage();};
 function paragraph(text,{size=10,bold=false,color='#293541',gap=7}={}){
   const value=printable(text);pdf.font(bold?'Strong':'Body').fontSize(size);room(Math.min(140,pdf.heightOfString(value,{width,lineGap:3})+gap));
   pdf.fillColor(color).text(value,48,pdf.y,{width,lineGap:3,...(/^https:\/\//u.test(value)?{link:value,underline:true}:{})});pdf.y+=gap;
 }
 const status=document.status==='approved'?'APROVADO':document.status==='in_review'?'EM REVISÃO':'RASCUNHO';
 paragraph(document.title||'Documento de engenharia',{size:21,bold:true,gap:14});
 paragraph(`${document.id||'Documento'}  /  v${document.version||1}  /  ${status}`,{size:9,bold:true,color:'#785636'});
 paragraph(`Estrutura: ${(document.profile||'custom').toUpperCase()}${document.taskId?`  ·  Revisão: ${document.taskId}`:''}`,{size:9,color:'#5d6b77'});
 if(document.authorName)paragraph(`Autor: ${document.authorName}`,{size:9,color:'#5d6b77'});
 if(document.updatedAt)paragraph(`Atualizado: ${String(document.updatedAt).slice(0,10)}`,{size:9,color:'#5d6b77'});
 pdf.moveDown(.5);
 const lines=String(document.body||'').split('\n');
 for(let index=0;index<lines.length;index++){
   const line=lines[index];
   if(index===0&&line===`# ${document.title}`)continue;
   if(line.trim().startsWith('|')&&/^\|?\s*:?-+/u.test(lines[index+1]?.trim()||'')){
     const head=parseRow(line),rows=[];index+=2;while(index<lines.length&&lines[index].trim().startsWith('|')){rows.push(parseRow(lines[index]));index++;}index--;
     const columns=head.length,colWidth=width/columns;
     const drawRow=(row,header=false)=>{
       pdf.font(header?'Strong':'Body').fontSize(8);
       const height=Math.max(27,...head.map((_,i)=>pdf.heightOfString(printable(row[i]||''),{width:colWidth-14,lineGap:2})+14));
       // A single oversized cell becomes labelled paragraphs, retaining its full text.
       if(height>bottom()-110){for(let i=0;i<head.length;i++)paragraph(`${head[i]}: ${row[i]||''}`,{size:9});return;}
       const newPage=pdf.y+height>bottom();room(height);if(newPage&&!header)drawRow(head,true);
       const y=pdf.y;
       for(let column=0;column<columns;column++){
         const x=48+column*colWidth;
         pdf.rect(x,y,colWidth,height).fillAndStroke(header?'#eef0ef':'#ffffff','#d5dcdF');
         pdf.font(header?'Strong':'Body').fontSize(8).fillColor('#293541').text(printable(row[column]||''),x+7,y+7,{width:colWidth-14,lineGap:2});
       }
       pdf.y=y+height;pdf.x=48;
     };
     room(60);drawRow(head,true);for(const row of rows)drawRow(row);pdf.y+=12;continue;
   }
   if(!line.trim()){pdf.y+=5;continue;}
   const heading=/^(#{1,3})\s+(.+)/u.exec(line);
   if(heading){room(65);paragraph(heading[2],{size:heading[1].length===1?18:heading[1].length===2?13:11,bold:true,gap:10});}
   else paragraph(line);
 }
 if(document.decisions?.length){paragraph('Controle de aprovação',{size:13,bold:true});for(const decision of document.decisions)paragraph(`${decision.authorName} · v${decision.version||document.version} · ${decision.decision==='approve'?'Aprovado':'Alterações solicitadas'}${decision.comment?`\n${decision.comment}`:''}`,{size:9});}
 const range=pdf.bufferedPageRange();
 for(let index=range.start;index<range.start+range.count;index++){
   pdf.switchToPage(index);pdf.page.margins.bottom=0;
   pdf.font('Strong').fontSize(8).fillColor('#785636').text('NORTE  /  ENGENHARIA DE SISTEMAS',48,31,{width,lineBreak:false});
   pdf.moveTo(48,48).lineTo(pdf.page.width-48,48).lineWidth(.5).strokeColor('#d5dcdf').stroke();
   pdf.font('Body').fontSize(8).fillColor('#5d6b77').text(`${document.id||'Documento'} · v${document.version||1} · ${status}`,48,pdf.page.height-35,{width:width-80,lineBreak:false});
   pdf.text(`${index+1} / ${range.count}`,pdf.page.width-105,pdf.page.height-35,{width:57,align:'right',lineBreak:false});
 }
 pdf.end();return completed;
}
