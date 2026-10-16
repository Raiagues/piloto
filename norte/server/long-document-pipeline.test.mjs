import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setImmediate } from "node:timers";
import PDFDocument from "pdfkit";
import { classifyArtifactSource, parseArtifactDocument } from "./artifact-content.mjs";
import { createLongDocumentJobs, documentChunks, sourceCoverage } from "./long-document-pipeline.mjs";
import { createSystemAiService, hydrateExtraction, validateExtractedSystem, locateExcerpt, prepareProjectArtifactsAsync } from "./system-ai.mjs";
import { mergeChunkModels } from "./merge-source-models.mjs";

const project = { id: "long-project", name: "Mission Aurora", memoryRevision: 1, context: { projectArtifactIds: ["source"] } };
const dataUrl = (bytes, mime = "text/plain") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const artifact = (bytes, mime, filename = "source.txt") => ({ id: "source", label: "Mission design", scope: "project", ownerId: project.id, url: dataUrl(bytes,mime), fileName: filename });
const source = (text) => ({ source: { artifactId: "source", artifactLabel: "Mission design", status: "parsed" }, text });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
async function settled(service, id, scopeKey) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const job = service.job(id,{ scopeKey });
    if (!["queued","preparing","running"].includes(job.status)) return job;
    await sleep(10);
  }
  throw new Error("Test extraction did not settle");
}
function rawModel(text, value) {
  const excerpt = value === undefined ? /Mission Aurora[^.\n]*\./u.exec(text)?.[0] : `Mission Aurora final mass is ${value} kg.`;
  return { entities: [{ id: "mission", name: "Mission Aurora", kind: "system", description: "Documented mission", source: "documented", confidence: 1, evidenceRefs: ["e"], properties: value === undefined ? [] : [{ key: "mass", name: "Mass", value, unit: "kg", source: "documented", evidenceRefs: ["e"] }] }], relations: [], requirements: [], evidence: [{ id: "e", artifactId: "source", artifactLabel: "Mission design", excerpt, kind: "fact" }] };
}
function verifiedModel(text, value) {
  return validateExtractedSystem(hydrateExtraction(rawModel(text,value),project),project,[source(text)],"test");
}
async function makePdf(pages = 40, blank = false) {
  const doc = new PDFDocument({ autoFirstPage: false, compress: true });
  const buffers = [], done = new Promise((resolve,reject) => { doc.on("data",(buffer) => buffers.push(buffer)); doc.on("end",() => resolve(Buffer.concat(buffers))); doc.on("error",reject); });
  for (let page = 0; page < pages; page += 1) {
    doc.addPage({ size: "A4", margin: 35 });
    if (blank) continue;
    doc.fontSize(7);
    for (let line = 0; line < 48; line += 1) doc.text(`Mission Aurora design record ${page+1}-${line+1}. The documented subsystem requires inspection before flight.`,35,35+line*13,{lineBreak:false});
    if (page === pages-1) doc.text("Mission Aurora final mass is 7 kg.",35,700);
  }
  doc.end();
  return done;
}

test("long chunks cover the complete source, including final paragraphs, with stable identities", () => {
  const text = "Mission Aurora technical design.\n".repeat(6000) + "Mission Aurora final mass is 7 kg.";
  const chunks = documentChunks([source(text)]);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 32_000));
  assert.equal(chunks.at(-1).end,text.length);
  assert.match(chunks.at(-1).text,/final mass is 7 kg/u);
  assert.deepEqual(chunks.map((c) => c.id),documentChunks([source(text)]).map((c) => c.id));
  const coverage = sourceCoverage([source(text)],chunks,new Set(chunks.map((c) => c.id)))[0];
  assert.equal(coverage.coveredCharacters,text.length);
  assert.equal(coverage.complete,true);
  assert.equal(sourceCoverage([source(text)],chunks,new Set([chunks[0].id]))[0].complete,false);
});

test("PDF reader preserves >120k characters and exact last-page source locators; scanned PDFs require OCR", async () => {
  const parsed = await parseArtifactDocument(artifact(await makePdf(),"application/pdf","mission.pdf"));
  assert.equal(parsed.status,"parsed");
  assert.equal(parsed.pages.length,40);
  assert.ok(parsed.text.length > 120_000);
  assert.deepEqual(parsed.missingPages,[]);
  assert.match(parsed.text,/final mass is 7 kg/u);
  const model = validateExtractedSystem(hydrateExtraction(rawModel(parsed.text,7),project),project,[{ ...source(parsed.text),pages:parsed.pages }],"test");
  assert.match(model.evidence[0].locator,/^p\. 40; L\d+; chars/u);
  const scan = await parseArtifactDocument(artifact(await makePdf(2,true),"application/pdf","scan.pdf"));
  assert.equal(scan.status,"not_parsed"); assert.match(scan.reason,/OCR/u); assert.equal(scan.pages.length,2);
});

test("DOCX reader traverses all paragraphs and refuses entity expansion and archive traversal", () => {
  const zip = (xml,path="word/document.xml") => execFileSync("python3",["-c","import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED); z.writestr(sys.argv[1],sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())",path],{input:xml});
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const text = "<w:p><w:r><w:t>Mission Aurora engineering specification.</w:t></w:r></w:p>".repeat(5000);
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text}<w:p><w:r><w:t>LAST DOCUMENT PARAGRAPH</w:t></w:r></w:p></w:body></w:document>`;
  const parsed = classifyArtifactSource(artifact(zip(xml),mime,"mission.docx"));
  assert.equal(parsed.status,"parsed"); assert.ok(parsed.text.length > 120_000); assert.match(parsed.text,/LAST DOCUMENT PARAGRAPH$/u);
  assert.equal(classifyArtifactSource(artifact(zip('<!DOCTYPE x [<!ENTITY a "expanded">]>'+xml),mime,"attack.docx")).status,"not_parsed");
  assert.equal(classifyArtifactSource(artifact(zip(xml,"../word/document.xml"),mime,"attack.docx")).status,"not_parsed");
});

test("bounded jobs resume, reuse scoped checkpoints after restart, and invalidate feedback changes", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(),"norte-extraction-test-"));
  const services = [];
  const text = "Mission Aurora documented design.\n".repeat(3000);
  let calls = 0, feedbackRevision = 1;
  const options = { model:"test",cacheDirectory,concurrency:2,maxChunksPerRun:2,prepare:async()=>[source(text)],feedbackContext:()=>({revision:feedbackRevision}),
    extractChunk:async(_project,chunk)=>{calls++;return verifiedModel(chunk.text);},validateCached:(model)=>model,validateFinal:(model)=>model };
  try {
    const service = createLongDocumentJobs(options);
    services.push(service);
    const initial = await service.start(project,[],"en",{scopeKey:"account-one"});
    let job = await settled(service,initial.jobId,"account-one");
    assert.equal(job.status,"paused"); assert.equal(job.progress.completedChunks,2); assert.equal(job.result,undefined);
    assert.throws(()=>service.job(job.jobId,{scopeKey:"account-two"}),{code:"EXTRACTION_JOB_NOT_FOUND"});
    while(job.status === "paused") { await service.resume(job.jobId,{scopeKey:"account-one"}); job=await settled(service,job.jobId,"account-one"); }
    assert.equal(job.status,"completed"); assert.equal(job.report.complete,true); assert.equal(calls,job.progress.totalChunks);
    const paidCalls = calls;
    const restarted = createLongDocumentJobs({...options,maxChunksPerRun:200});
    services.push(restarted);
    const replay = await restarted.start(project,[],"en",{scopeKey:"account-one"});
    const replayed = await settled(restarted,replay.jobId,"account-one");
    assert.equal(replayed.status,"completed"); assert.equal(calls,paidCalls); assert.equal(replayed.progress.cachedChunks,replayed.progress.totalChunks);
    feedbackRevision++;
    const corrected = await restarted.start(project,[],"en",{scopeKey:"account-one"});
    await settled(restarted,corrected.jobId,"account-one"); assert.ok(calls > paidCalls);
  } finally { await Promise.all(services.map(service => service.close())); await rm(cacheDirectory,{recursive:true,force:true}); }
});

test("one failed fragment retains verified work and never yields a partial published map", async () => {
  const text = "Mission Aurora documented design.\n".repeat(3000);
  let fail = true;
  const service = createLongDocumentJobs({model:"test",maxChunksPerRun:200,prepare:async()=>[source(text)],validateCached:(m)=>m,validateFinal:(m)=>m,
    extractChunk:async(_p,chunk)=>{if(chunk.start>0&&fail)throw Object.assign(new Error("Provider unavailable"),{code:"PROVIDER_DOWN"});return verifiedModel(chunk.text);} });
  const start = await service.start(project,[],"en",{scopeKey:"account"});
  let job = await settled(service,start.jobId,"account");
  assert.equal(job.status,"failed"); assert.equal(job.progress.completedChunks,1); assert.equal(job.result,undefined);
  fail=false; await service.resume(job.jobId,{scopeKey:"account"}); job=await settled(service,job.jobId,"account");
  assert.equal(job.status,"completed"); assert.equal(job.progress.coverage,1);
});

test("source merging reports contradictory values and retains both sources", () => {
  const merged = mergeChunkModels(project,[{id:"a",model:verifiedModel("Mission Aurora final mass is 7 kg.",7)},{id:"b",model:verifiedModel("Mission Aurora final mass is 8 kg.",8)}]);
  assert.equal(merged.model.entities.length,1); assert.equal(merged.model.entities[0].properties[0].value,7);
  assert.equal(merged.conflicts.length,1); assert.equal(merged.conflicts[0].candidate.value,8); assert.equal(merged.model.evidence.length,2);
});

test("merge reconciles explicit subsystem acronyms under the same parent without merging separate components", () => {
  const fragment = (label,mass) => {
    const model = verifiedModel(`Mission Aurora final mass is ${mass} kg.`,mass);
    const root = model.entities[0]; root.properties = [];
    model.entities.push({...root,id:"eps",name:label,kind:"subsystem",parentId:root.id,properties:[{key:"mass",name:"Mass",value:mass,unit:"kg",source:"documented",evidenceRefs:["e"]}]});
    model.entities.push({...root,id:"controller",name:label === "EPS" ? "PC" : "Power Controller (PC)",kind:"component",parentId:"eps"});
    return model;
  };
  const first=fragment("EPS",7),second=fragment("Electrical Power System (EPS)",8),third=fragment("Sistema de Energia Elétrica (EPS)",7);
  const other=fragment("EPS",7); other.entities[0].name="Mission Borealis";
  const merged=mergeChunkModels(project,[{id:"a",model:first},{id:"b",model:second},{id:"c",model:third},{id:"d",model:other}]);
  const originalRoot=merged.model.entities.find((entity)=>entity.name==="Mission Aurora");
  const subsystems=merged.model.entities.filter((entity)=>entity.kind==="subsystem");
  assert.equal(subsystems.length,2);
  const eps=subsystems.find((entity)=>entity.parentId===originalRoot.id);
  assert.equal(eps.evidenceRefs.length,2);
  assert.equal(merged.model.entities.filter((entity)=>entity.kind==="component"&&entity.parentId===eps.id).length,2);
  assert.equal(merged.conflicts.length,1);
  assert.equal(merged.conflicts[0].candidate.value,8);
  assert.deepEqual(first.entities.map((entity)=>entity.name),["Mission Aurora","EPS","PC"]);
});

test("flattened schematics retain numerical proof checks and mark visual associations as inferred", () => {
  const text="Mission Aurora final mass is 7 kg.";
  const parsed={...source(text),sparseLayout:true};
  const model=validateExtractedSystem(hydrateExtraction(rawModel(text,7),project),project,[parsed],"test");
  assert.equal(model.entities[0].source,"inferred");
  assert.equal(model.entities[0].confidence,0.6);
  assert.equal(model.entities[0].properties[0].source,"documented");
  assert.throws(()=>validateExtractedSystem(hydrateExtraction(rawModel(text,8),project),project,[parsed],"test"),{code:"SYSTEM_EVIDENCE_INVALID"});
});

test("absolute damage limits cannot become operating properties across fragment or section boundaries", () => {
  const text="Mission Aurora is a satellite.\n30.1 Absolute Maximum Ratings*\nMaximum Operating Voltage 6.0 V\n30.2 DC Characteristics\nRecommended maximum operating voltage 5.5 V\n";
  const candidate=(key,value,excerpt)=>{
    const model=rawModel(text);
    model.evidence.push({id:"rating",artifactId:"source",artifactLabel:"Mission design",excerpt,kind:"fact"});
    model.entities[0].properties.push({key,name:key,value,unit:"V",source:"documented",evidenceRefs:["rating"]});
    return hydrateExtraction(model,project);
  };
  const wrong=candidate("maximum_operating_voltage",6,"Maximum Operating Voltage 6.0 V");
  assert.throws(()=>validateExtractedSystem(wrong,project,[source(text)],"test"),(error)=>error.code==="SYSTEM_EVIDENCE_INVALID"&&error.grounding.kind==="property"&&/stress\/damage/u.test(error.message));
  const mislabeledKey=candidate("maximum_voltage",6,"Maximum Operating Voltage 6.0 V");
  mislabeledKey.entities[0].properties[0].name="Tensão máxima absoluta";
  assert.throws(()=>validateExtractedSystem(mislabeledKey,project,[source(text)],"test"),{code:"SYSTEM_EVIDENCE_INVALID"});
  assert.throws(()=>validateExtractedSystem(wrong,project,[{...source("Mission Aurora is a satellite.\nMaximum Operating Voltage 6.0 V"),fullText:text}],"test"),{code:"SYSTEM_EVIDENCE_INVALID"});
  const absolute=validateExtractedSystem(candidate("absolute_maximum_voltage",6,"Maximum Operating Voltage 6.0 V"),project,[source(text)],"test");
  assert.equal(absolute.entities[0].properties[0].value,6);
  const operating=validateExtractedSystem(candidate("maximum_operating_voltage",5.5,"Recommended maximum operating voltage 5.5 V"),project,[source(text)],"test");
  assert.equal(operating.entities[0].properties[0].value,5.5);
  const mentions="Mission Aurora is a satellite.\nConsult the Absolute Maximum Ratings section before use.\nMaximum Operating Voltage 6.0 V\n";
  assert.doesNotThrow(()=>validateExtractedSystem(wrong,project,[source(mentions)],"test"));
});

test("long-document merge preserves more than forty properties and two hundred source references", () => {
  const fragments = Array.from({length:240},(_,index)=>{
    const model = verifiedModel(`Mission Aurora final mass is ${index+1} kg.`,index+1);
    model.entities[0].properties[0].key = `test_mass_${index+1}`;
    return {id:`fragment-${index}`,model};
  });
  const merged = mergeChunkModels(project,fragments);
  assert.equal(merged.model.entities.length,1);
  assert.equal(merged.model.entities[0].properties.length,240);
  assert.equal(merged.model.entities[0].evidenceRefs.length,240);
  assert.equal(merged.model.evidence.length,240);
  assert.equal(merged.conflicts.length,0);
});

test("short mission documents establish context before schematics and manufacturer sources", async () => {
  const documents = [
    {...artifact("Mission Aurora description. ".repeat(100)),id:"long"},
    {...artifact("Reference."),id:"reference",provenance:{role:"supporting_datasheet"}},
    {...artifact("Mission Aurora."),id:"overview"}
  ];
  const selected = {...project,context:{projectArtifactIds:documents.map((item)=>item.id)}};
  assert.deepEqual((await prepareProjectArtifactsAsync(selected,documents)).map((item)=>item.source.artifactId),["overview","long","reference"]);
});

test("uploaded source roles override legacy provenance and keep references after mission documents", async () => {
  const documents = [
    {...artifact("Component reference."),id:"reference",sourceRole:"supporting_datasheet",provenance:{role:"project_context"}},
    {...artifact("Mission Aurora verified implementation."),id:"mission",sourceRole:"project_context",provenance:{role:"supporting_datasheet"}},
    {...artifact("Legacy reference."),id:"legacy",provenance:{role:"supporting_datasheet"}}
  ];
  const selected = {...project,context:{projectArtifactIds:documents.map((item)=>item.id)}};
  const parsed = await prepareProjectArtifactsAsync(selected,documents);
  assert.deepEqual(parsed.map((item)=>[item.source.artifactId,item.role]),[["mission","project_context"],["legacy","supporting_datasheet"],["reference","supporting_datasheet"]]);
});

test("micro typography and aligned MIN/MAX tables verify without accepting changed words, units or columns", () => {
  assert.equal(locateExcerpt("The EPS &mu;C has 2 V.","The EPS µC has 2 V."),0);
  assert.equal(locateExcerpt("The EPS &mu;C has 2 V.","The EPS µC has 3 V."),-1);
  const header="                          MIN        NOM        MAX    UNIT";
  const row="VS  Operating voltage     2.7                   5.5    V";
  const text=`Mission Aurora is a satellite.\n${header}\n${row}`;
  const candidate=rawModel(text);
  candidate.evidence.push({id:"table",artifactId:"source",artifactLabel:"Mission design",excerpt:row,kind:"fact"});
  candidate.entities[0].properties=[{key:"minimum_voltage",name:"Minimum voltage",value:2.7,unit:"V",source:"documented",evidenceRefs:["table"]}];
  const valid=()=>validateExtractedSystem(hydrateExtraction(candidate,project),project,[source(text)],"test");
  assert.equal(valid().entities[0].properties[0].value,2.7);
  candidate.entities[0].properties[0].key="maximum_voltage";
  assert.throws(valid,{code:"SYSTEM_EVIDENCE_INVALID"});
  candidate.entities[0].properties[0].key="minimum_voltage";
  candidate.entities[0].properties[0].unit="A";
  assert.throws(valid,{code:"SYSTEM_EVIDENCE_INVALID"});
});

test("long literal quotes split without rewriting facts and count labels remain dimensionless", () => {
  const text="Mission Aurora has 12 photodiodes. " + "The photodiodes are documented engineering components. ".repeat(18);
  const candidate=rawModel(text);
  candidate.evidence[0].excerpt=text;
  candidate.entities[0].properties=[{key:"count",name:"Photodiode count",value:12,unit:"un",source:"documented",evidenceRefs:["e"]}];
  const checked=validateExtractedSystem(hydrateExtraction(candidate,project),project,[source(text)],"test");
  assert.ok(checked.evidence.length>1);
  assert.ok(checked.evidence.every((e)=>e.excerpt.length<=600&&text.includes(e.excerpt)));
  assert.equal(checked.entities[0].properties[0].value,12);
  assert.equal(checked.entities[0].properties[0].evidenceRefs.length,checked.evidence.length);
  assert.equal(candidate.evidence.length,1,"Original provider response remains unchanged");
  candidate.entities[0].properties[0].value=13;
  assert.throws(()=>validateExtractedSystem(hydrateExtraction(candidate,project),project,[source(text)],"test"),{code:"SYSTEM_EVIDENCE_INVALID"});
});

test("literal component counts recognize NX notation without inferring a different quantity", () => {
  const text = "Mission Aurora lists 2X TMP100 temperature sensors.";
  const candidate = rawModel(text);
  candidate.entities[0].properties=[{key:"component_count",name:"Component count",value:2,unit:"1",source:"documented",evidenceRefs:["e"]}];
  assert.equal(validateExtractedSystem(hydrateExtraction(candidate,project),project,[source(text)],"test").entities[0].properties[0].value,2);
  candidate.entities[0].properties[0].value=3;
  assert.throws(()=>validateExtractedSystem(hydrateExtraction(candidate,project),project,[source(text)],"test"),{code:"SYSTEM_EVIDENCE_INVALID"});
});

test("manufacturer fragments receive mission-only context and cannot masquerade as project design", async () => {
  const text="Mission Aurora is a satellite.";let prompt;
  const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxContractAttempts:1,fetch:async(_url,init)=>{
    prompt=JSON.parse(init.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(rawModel(text))}]}}]}));
  }});
  const start=await service.start(project,[{...artifact(text),provenance:{role:"supporting_datasheet"}}],"en",{scopeKey:"account"});
  const job=await settled(service,start.jobId,"account");
  assert.equal(job.status,"failed");
  assert.equal(job.error.code,"SYSTEM_SOURCE_SCOPE_INVALID");
  assert.match(prompt,/manufacturer's component reference, NOT mission implementation evidence/u);
  assert.match(prompt,/Application examples are not satellite hardware/u);
});

test("schematic text never implies verified visual connectivity and reports its limitation", async () => {
  const text="Mission Aurora is a satellite.\n"+" ".repeat(6000)+"\nR1          C1\n";
  let prompt;
  const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxContractAttempts:1,fetch:async(_url,init)=>{
    prompt=JSON.parse(init.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(rawModel(text))}]}}]}));
  }});
  const start=await service.start(project,[artifact(text)],"en",{scopeKey:"account"});
  const job=await settled(service,start.jobId,"account");
  assert.equal(job.status,"completed",JSON.stringify(job.error));
  assert.match(prompt,/Never infer wires, interfaces or a network/u);
  assert.match(job.report.documents[0].limitations[0],/revisão visual/u);
  assert.equal(job.report.documents[0].coveredCharacters,text.length);
});

test("service chunks a long real PDF and verifies a final-page fact end to end", async () => {
  let calls=0;
  const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxChunksPerRun:200,maxContractAttempts:1,fetch:async(_url,init)=>{
    calls++;
    const prompt=JSON.parse(init.body).contents[0].parts[0].text;
    const payload=JSON.parse(prompt.split("\n").find((line)=>line.startsWith('{"project":')));
    const text=payload.artifacts.find((item)=>item.artifactId==="source").text;
    const value=text.includes("Mission Aurora final mass is 7 kg.")?7:undefined;
    return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(rawModel(text,value))}]}}]}));
  }});
  const start=await service.start(project,[artifact(await makePdf(),"application/pdf","mission.pdf")],"en",{scopeKey:"account"});
  const job=await settled(service,start.jobId,"account");
  assert.equal(job.status,"completed",JSON.stringify(job.error)); assert.ok(calls>4);
  assert.equal(job.progress.coverage,1); assert.equal(job.report.documents[0].totalPages,40);
  assert.equal(job.result.entities[0].properties[0].value,7); assert.ok(job.result.evidence.some((e)=>e.locator.startsWith("p. 40;")));
});

test("background jobs finish every bounded batch without a resume request and publish per-document activity", async () => {
  const text = "Mission Aurora documented design.\n".repeat(3000);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const service = createLongDocumentJobs({ model: "test", maxChunksPerRun: 2, prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => model,
    extractChunk: async (_project, chunk) => { calls++; if (calls <= 2) await gate; return verifiedModel(chunk.text); } });
  const initial = await service.start(project, [artifact(text)], "en", { scopeKey: "background-account", autoRun: true });
  assert.equal(initial.report.documents[0].label, "Mission design");
  assert.equal(initial.report.documents[0].stage, "queued");
  for (let attempt = 0; attempt < 100 && calls < 2; attempt++) await sleep(5);
  const reading = service.job(initial.jobId, { scopeKey: "background-account", summary: true });
  assert.equal(reading.report.documents[0].stage, "reading");
  assert.equal(reading.report.documents[0].activeChunks, 2);
  const duplicate = await service.start({ ...project, navigation: { lastRoute: "meeting" }, updatedAt: "later" }, [artifact(text)], "en", { scopeKey: "background-account", autoRun: true });
  assert.equal(duplicate.jobId, initial.jobId, "navigation does not restart or duplicate extraction");
  release();
  const completed = await settled(service, initial.jobId, "background-account");
  assert.equal(completed.status, "completed");
  assert.ok(calls > 2, "the previous two-chunk boundary is crossed automatically");
  assert.equal(completed.progress.coverage, 1);
  assert.equal(completed.report.documents[0].stage, "completed");
  const summary = service.job(initial.jobId, { scopeKey: "background-account", summary: true });
  assert.equal(summary.result, undefined);
  assert.equal(summary.report.omissionCount, 0);
  assert.ok(completed.result.entities.length);
});

test("all background projects share the two-call concurrency limit", async () => {
  let active = 0, maximum = 0;
  const text = "Mission Aurora documented design.\n".repeat(3000);
  const service = createLongDocumentJobs({ model: "test", maxChunksPerRun: 2, prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => model,
    extractChunk: async (_project, chunk) => { active++; maximum = Math.max(maximum, active); await sleep(10); active--; return verifiedModel(chunk.text); } });
  const starts = await Promise.all(["one", "two", "three"].map(scopeKey => service.start(project, [], "en", { scopeKey, autoRun: true })));
  const completed = await Promise.all(starts.map((job, index) => settled(service, job.jobId, ["one", "two", "three"][index])));
  assert.ok(completed.every(job => job.status === "completed"));
  assert.equal(maximum, 2);
});

test("durable background recovery retains job identity, revalidates completed chunks and never repeats paid work", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "norte-job-recovery-"));
  const services = [];
  const text = "Mission Aurora documented design.\n".repeat(3000);
  let calls = 0, validations = 0;
  const options = { model: "test", cacheDirectory, maxChunksPerRun: 2, prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => { validations++; return model; },
    extractChunk: async (_project, chunk) => { calls++; return verifiedModel(chunk.text); } };
  try {
    const service = createLongDocumentJobs(options);
    services.push(service);
    const initial = await service.start(project, [artifact(text)], "en", { scopeKey: "owner" });
    const paused = await settled(service, initial.jobId, "owner");
    assert.equal(paused.status, "paused");
    assert.equal(calls, 2);
    await service.close();
    const restarted = createLongDocumentJobs(options);
    services.push(restarted);
    assert.equal(await restarted.restore(initial.jobId, project, [artifact(text)], "en", { scopeKey: "other" }), null);
    assert.equal(await restarted.restore(initial.jobId, { ...project, memoryRevision: 2 }, [artifact(text)], "en", { scopeKey: "owner" }), null);
    const restored = await restarted.restore(initial.jobId, project, [artifact(text)], "en", { scopeKey: "owner", autoRun: true });
    assert.equal(restored.jobId, initial.jobId);
    const completed = await settled(restarted, initial.jobId, "owner");
    assert.equal(completed.status, "completed");
    assert.equal(completed.progress.cachedChunks, 2);
    assert.equal(calls, completed.progress.totalChunks, "cached reads survive restart without another paid request");
    await restarted.close();
    const completedRestart = createLongDocumentJobs(options);
    services.push(completedRestart);
    const alreadyFinished = await completedRestart.restore(initial.jobId, project, [artifact(text)], "en", { scopeKey: "owner", autoRun: true });
    assert.equal(alreadyFinished.status, "completed");
    assert.deepEqual(alreadyFinished.result, completed.result);
    assert.equal(validations, 2, "completed checkpoints revalidate against sources without provider calls");
    assert.equal(calls, completed.progress.totalChunks);
    await completedRestart.close();
  } finally { await Promise.all(services.map(service => service.close())); await rm(cacheDirectory, { recursive: true, force: true }); }
});

test("closing waits for the terminal checkpoint before allowing cache cleanup and rejects new extraction", { timeout: 10_000 }, async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "norte-job-close-"));
  const text = "Mission Aurora documented design.";
  let reached, release, closed = false;
  const entered = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const service = createLongDocumentJobs({ model: "test", cacheDirectory, prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => model,
    extractChunk: async (_project, chunk) => verifiedModel(chunk.text),
    onProgress: async job => { if (job.status === "completed") { reached(); await gate; } } });
  try {
    const initial = await service.start(project, [artifact(text)], "en", { scopeKey: "owner", autoRun: true });
    await entered;
    assert.equal(service.job(initial.jobId, { scopeKey: "owner" }).status, "completed", "terminal progress alone does not prove the final write finished");
    const closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, "shutdown must await the pending checkpoint callback and file write");
    await assert.rejects(service.start(project, [], "en", { scopeKey: "new" }), { code: "EXTRACTION_INTERRUPTED" });
    release();
    await closing;
    const files = await readdir(join(cacheDirectory, "jobs"));
    assert.equal(files.length, 1, "no atomic-write temporary files remain after shutdown");
    const saved = JSON.parse(await readFile(join(cacheDirectory, "jobs", files[0]), "utf8"));
    assert.equal(saved.status, "completed");
    assert.equal(saved.jobId, initial.jobId);
    assert.equal(saved.report.complete, true);
  } finally { release(); await service.close(); await rm(cacheDirectory, { recursive: true, force: true }); }
});

test("background authorization is checked again before spending on another batch", async () => {
  const text = "Mission Aurora documented design.\n".repeat(3000);
  let authorized = true, calls = 0;
  const service = createLongDocumentJobs({ model: "test", prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => model,
    extractChunk: async (_project, chunk) => { calls++; const model = verifiedModel(chunk.text); authorized = false; return model; } });
  const initial = await service.start(project, [artifact(text)], "en", { scopeKey: "owner", autoRun: true, assertAuthorized: async () => {
    if (!authorized) throw Object.assign(new Error("Access revoked"), { code: "FORBIDDEN" });
  } });
  const result = await settled(service, initial.jobId, "owner");
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "FORBIDDEN");
  assert.equal(result.result, undefined);
  assert.ok(calls <= 2, "revocation blocks every subsequent provider batch");
});

test("closing during the final authorization check cannot start another provider request", { timeout: 10_000 }, async () => {
  let authorizationChecks = 0, calls = 0, reached, release;
  const entered = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const text = "Mission Aurora documented design.";
  const service = createLongDocumentJobs({ model: "test", prepare: async () => [source(text)], validateCached: model => model, validateFinal: model => model,
    extractChunk: async (_project, chunk) => { calls++; return verifiedModel(chunk.text); } });
  try {
    const initial = await service.start(project, [artifact(text)], "en", { scopeKey: "owner", autoRun: true,
      assertAuthorized: async () => { if (++authorizationChecks === 3) { reached(); await gate; } } });
    await entered;
    const closing = service.close();
    release();
    await closing;
    assert.equal(calls, 0);
    const stopped = service.job(initial.jobId, { scopeKey: "owner" });
    assert.equal(stopped.status, "paused");
    assert.equal(stopped.error.code, "EXTRACTION_INTERRUPTED");
  } finally { release(); await service.close(); }
});
