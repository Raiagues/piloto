"""Grounded Gemini minutes. Secrets and provider transport stay on the server."""
import copy
import hashlib
import json
import os
import re
import socket
import threading
import time
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent
PROMPT_VERSION = 'minutes-2026-10-15-v3'
REQUEST_TIMEOUT_SECONDS = 180
RETRY_DELAY_SECONDS = 1
class ProviderSlots:
    """Bounded provider requests across all accounts; locked() means one is in flight."""
    def __init__(self, size):
        self._lock = threading.Lock(); self._size = max(1, size); self._active = 0
    def acquire(self, blocking=False):
        with self._lock:
            if self._active >= self._size: return False
            self._active += 1; return True
    def release(self):
        with self._lock:
            if self._active <= 0: raise ValueError('ProviderSlots released too many times')
            self._active -= 1
    def locked(self): return self._active > 0
PROVIDER_BUSY = ProviderSlots(int(os.environ.get('MINUTES_CONCURRENCY', '3') or 3))
class MinutesError(Exception):
    def __init__(self, message, status=502, code='unavailable', retryable=True, retry_after_seconds=None):
        super().__init__(message)
        self.status=status; self.code=code; self.retryable=retryable; self.retry_after_seconds=retry_after_seconds
    def response(self):
        result={'error':str(self),'code':self.code,'retryable':self.retryable}
        if self.retry_after_seconds is not None: result['retry_after_seconds']=self.retry_after_seconds
        return result
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
HTTP = build_opener(NoRedirect())

def obj(**props): return {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
def arr(items,**limits): return {'type':'array','items':items,**limits}
STR={'type':'string'}
REFS=arr(STR)
POINT=obj(id=STR,text=STR,event_ids=REFS)
TASK=obj(id=STR,parent_id=STR,text=STR,result=STR,owner=STR,due=STR,event_ids=REFS)
LEGACY_SCHEMA=obj(title=STR,topics=arr(obj(thread_id=STR,title=STR,summary=obj(text=STR,event_ids=REFS),points=arr(POINT),tests=arr(TASK),actions=arr(TASK))),warnings=arr(obj(target_id=STR,message=STR,event_ids=REFS)))
SHORT={'type':'string','minLength':1,'maxLength':180}
CELL={'type':'string','maxLength':120}
LABEL={'type':'string','minLength':1,'maxLength':80}
TABLE=obj(title=LABEL,columns=arr({'type':'string','minLength':1,'maxLength':60},minItems=2,maxItems=5),rows=arr(obj(event_id=STR,cells=arr(CELL,minItems=2,maxItems=5)),minItems=1,maxItems=16))
SCHEMA=obj(title=STR,topics=arr(obj(thread_id=STR,title=STR,entries=arr(obj(event_id=STR,text=SHORT),minItems=1,maxItems=3000),tables=arr(TABLE,maxItems=3)),minItems=1,maxItems=3000),warnings=arr(obj(target_id=STR,message=SHORT,event_ids=REFS),maxItems=100))

def validate_source(body):
    if not isinstance(body,dict) or set(body)!={'source'}: raise ValueError('Envie a fonte da reunião.')
    source=body['source']
    if not isinstance(source,dict): raise ValueError('Fonte inválida.')
    events=source.get('events')
    if not isinstance(events,list) or not 1<=len(events)<=3000: raise ValueError('Use entre 1 e 3000 eventos por ata.')
    ids=set()
    for e in events:
        if not isinstance(e,dict) or not isinstance(e.get('event_id'),str) or not e['event_id'] or e['event_id'] in ids: raise ValueError('IDs de evento inválidos.')
        if not isinstance(e.get('text'),str) or not e['text'].strip() or len(e['text'])>30000: raise ValueError('Texto de evento inválido.')
        if not isinstance(e.get('type'),str) or not (e.get('thread_id') is None or isinstance(e['thread_id'],str)): raise ValueError('Classificação inválida.')
        ids.add(e['event_id'])
    if not isinstance(source.get('relations',[]),list): raise ValueError('Relações inválidas.')
    for r in source.get('relations',[]):
        if not isinstance(r,dict) or r.get('source_event_id') not in ids or r.get('target_event_id') not in ids: raise ValueError('Referência de relação inválida.')
    return source

def check_schema(value,schema):
    typ=schema['type']
    if typ=='string':
        if not isinstance(value,str) or not schema.get('minLength',0)<=len(value)<=schema.get('maxLength',30000): raise ValueError('Texto gerado inválido.')
    elif typ=='array':
        if not isinstance(value,list) or not schema.get('minItems',0)<=len(value)<=schema.get('maxItems',12000): raise ValueError('Lista gerada inválida.')
        for v in value: check_schema(v,schema['items'])
    else:
        if not isinstance(value,dict) or set(value)!=set(schema['properties']): raise ValueError('Estrutura gerada inválida.')
        for key,part in schema['properties'].items(): check_schema(value[key],part)

def confirmed(r):
    return r.get('review_state')=='confirmed' and all(isinstance(r.get(k),(int,float)) and r[k]>=.8 for k in ('relation_probability','match_probability'))

def _finalize_legacy(document,source):
    """Read the previous format while old clients/cached fixtures transition."""
    check_schema(document,LEGACY_SCHEMA)
    doc=copy.deepcopy(document);doc['title']='Tópicos discutidos'
    events={e['event_id']:e for e in source['events']};relations=source.get('relations',[])
    retired={r['target_event_id'] for r in relations if confirmed(r) and r.get('relation_type')=='supersedes' and (r.get('configuration_applicable') is False or r.get('configuration_match') in ('exact','partial','mismatch'))}
    completed={r['target_event_id'] for r in relations if confirmed(r) and r.get('relation_type')=='result_of' and r.get('configuration_match')=='exact' and r['source_event_id'] not in retired and events[r['source_event_id']]['type']=='test_result'}
    seen=set();covered=set();thread_ids=set();targets=set();warnings=doc['warnings']
    def warn(target,message,refs): warnings.append({'target_id':target,'message':message,'event_ids':refs})
    def refs(item,thread):
        ids=item['event_ids']
        if not ids or any(i not in events or (events[i].get('thread_id') or '')!=thread for i in ids): raise ValueError('A ata contém evidência ausente ou de outro assunto.')
        covered.update(ids)
    for topic in doc['topics']:
        tid=topic['thread_id'];targets.add(tid)
        if tid in thread_ids: raise ValueError('Assunto duplicado.')
        thread_ids.add(tid);refs(topic['summary'],tid)
        points={p['id']:p for p in topic['points']}
        for item in topic['points']+topic['tests']+topic['actions']:
            if not item['id'] or item['id'] in seen or item['id'] in {e.get('thread_id') for e in events.values()}: raise ValueError('ID gerado duplicado ou inválido.')
            seen.add(item['id']);targets.add(item['id']);refs(item,tid)
            if 'parent_id' not in item: continue
            parent=item['parent_id']
            if parent and parent not in points: raise ValueError('Pai do teste/ação não existe neste assunto.')
            es=[events[i] for i in item['event_ids']]
            proposals=[e['event_id'] for e in es if e['type']=='test_proposal']
            results=[e['event_id'] for e in es if e['type']=='test_result' and e['event_id'] not in retired]
            item['status']='superseded' if all(e['event_id'] in retired for e in es) else 'done' if (proposals and all(i in completed and i not in retired for i in proposals)) or (not proposals and results) else 'pending'
            if parent and not any(confirmed(r) and r.get('relation_type') in ('tests','addresses','supports','contradicts','explains') and ((r['source_event_id'] in item['event_ids'] and r['target_event_id'] in points[parent]['event_ids']) or (r['target_event_id'] in item['event_ids'] and r['source_event_id'] in points[parent]['event_ids'])) for r in relations):
                warn(item['id'],'Confira a ligação deste teste/ação com o ponto acima; não há vínculo direto confirmado na extração.',item['event_ids'])
    if thread_ids!={(e.get('thread_id') or '') for e in events.values()}: raise ValueError('A ata não cobre todos os assuntos.')
    order=list(dict.fromkeys(e.get('thread_id') or '' for e in source['events']))
    doc['topics'].sort(key=lambda t:order.index(t['thread_id']))
    # Titles are user-controlled metadata, never newly inferred by the writer.
    titles={t.get('thread_id'):t.get('title') for t in source.get('threads',[]) if isinstance(t,dict)}
    for topic in doc['topics']:
        title=titles.get(topic['thread_id'])
        topic['title']=title.strip() if isinstance(title,str) and title.strip() else 'Assunto sem título'
    if covered!=set(events): raise ValueError('A ata omitiu eventos; gere novamente para obter a cobertura completa.')
    for w in warnings:
        if w['target_id'] and w['target_id'] not in targets: raise ValueError('Aviso sem destino válido.')
        if any(i not in events for i in w['event_ids']): raise ValueError('Aviso com evidência desconhecida.')
    # Uncertainties from extraction cannot be suppressed by the writer.
    for r in relations:
        if not confirmed(r) or r.get('configuration_match') in ('mismatch','ambiguous','partial'):
            ids=[r['source_event_id'],r['target_event_id']]
            target=next((i['id'] for t in doc['topics'] for i in t['tests']+t['actions']+t['points'] if any(e in i['event_ids'] for e in ids)),events[ids[0]].get('thread_id') or '')
            warn(target,'Revisar vínculo entre registros: '+r.get('relation_type','relação')+'; configuração '+str(r.get('configuration_match','não informada'))+'.',ids)
    for w in source.get('extraction_warnings',[]):
        if isinstance(w,dict) and isinstance(w.get('text'),str):
            ids=[i for i in w.get('event_ids',[]) if i in events]
            target=events[ids[0]].get('thread_id') or '' if ids else ''
            warn(target,w['text'],ids)
    if source.get('run_status')!='done' or source.get('relation_status')!='done': warn('','A extração está incompleta; confira os assuntos e vínculos antes de validar.',[])
    warn('','Confira a síntese da ata com os registros de origem antes de validar o documento.',[])
    unique={}
    for w in warnings: unique.setdefault(json.dumps(w,sort_keys=True,ensure_ascii=False),w)
    doc['warnings']=[dict(w,id='W'+str(n+1)) for n,w in enumerate(unique.values())]
    doc['prompt_version']=PROMPT_VERSION
    return doc

def _plain(text):
    return ' '.join(text.split())

NUMBER=re.compile(r'(?<!\w)[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?')
QUANTITY=re.compile(r'(?<!\w)([+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?)\s*([a-zA-Zµμ°%][a-zA-Zµμ°%²³]*(?:[·*/][a-zA-Zµμ²³]+)?)')
NEGATION=re.compile(r'\b(?:não|nunca|jamais|sem|nem|nenhum\w*|incompat[ií]ve[li]s?|reprovad\w*|falh\w*|excede\w*|excedi\w*|insuficiente\w*)\b',re.I)
NEGATED_CLAUSE=re.compile(r'\b(?:não|nunca|jamais|sem|nem)\s+[^,;.!?]+',re.I)
UNCERTAINTY=re.compile(r'\b(?:pode|podem|poderia\w*|talvez|poss[ií]ve[li]s?|suspeit\w*|hipótese\w*|prováve[li]s?|aparente\w*|incert\w*|a confirmar)\b',re.I)
ASSERTION=re.compile(r'\b(?:aprovad\w*|validad\w*|confirmad\w*|comprovad\w*|garantid\w*|conforme|atende\w*|atendid\w*|segur[oa]s?|resolvid\w*|concluíd\w*|finalizad\w*|sucesso|corrigid\w*)\b',re.I)
CONDITION=re.compile(r'\b(?:somente se|apenas se|desde que|somente|apenas|caso|exceto|quando|se)\s+([^.;!?]+)',re.I)

def _check_entry_text(text,event):
    """Conservative, deterministic guards; this is not a semantic proof.

    The model only supplies a display overlay. Classification, completion and
    evidence always come from the meeting state, never from generated prose.
    Detailed values may be omitted from the short overlay, but not invented or
    moved to another unit. The complete source remains available by reference.
    """
    original=_plain(event['text']);candidate=_plain(text)
    if not candidate or len(candidate)>180:
        raise ValueError('Cada registro deve ter uma síntese curta.')
    if not set(NUMBER.findall(candidate))<=set(NUMBER.findall(original)):
        raise ValueError('A síntese introduziu um número ausente no registro.')
    # Preserve units as written; case is meaningful in technical quantities.
    if not set(QUANTITY.findall(candidate))<=set(QUANTITY.findall(original)):
        raise ValueError('A síntese alterou uma quantidade ou unidade.')
    source_negative=bool(NEGATION.search(original));candidate_negative=bool(NEGATION.search(candidate))
    if source_negative!=candidate_negative:
        raise ValueError('A síntese alterou uma negação ou resultado negativo.')
    for clause in NEGATED_CLAUSE.finditer(original):
        if clause.group(0).casefold() not in candidate.casefold():
            raise ValueError('A síntese omitiu o alcance de uma negação.')
    if bool(NEGATED_CLAUSE.search(original))!=bool(NEGATED_CLAUSE.search(candidate)):
        raise ValueError('A síntese acrescentou uma negação.')
    if (UNCERTAINTY.search(original) or event.get('type')=='hypothesis') and not UNCERTAINTY.search(candidate):
        raise ValueError('Uma hipótese ou incerteza virou afirmação na síntese.')
    original_claims={word.casefold() for word in ASSERTION.findall(original)}
    if any(word.casefold() not in original_claims for word in ASSERTION.findall(candidate)):
        raise ValueError('A síntese acrescentou uma aprovação ou certeza.')
    # A condition is not optional context: keep its exact short clause. This
    # deliberately prefers the original document over an unsafe abbreviation.
    folded=candidate.casefold()
    for condition in CONDITION.finditer(original):
        if condition.group(0).casefold() not in folded:
            raise ValueError('A síntese omitiu uma condição do registro.')
    return candidate

def _quoted_cell(cell,original,quoted_row):
    if not cell: return True
    # A cell cannot turn 180 into 80, kN into N, or incompatível into compatível
    # merely by selecting a substring in the middle of a token.
    prefix=r'(?<!\w)' if cell[0].isalnum() else ''
    suffix=r'(?!\w)' if cell[-1].isalnum() else ''
    protected=[*NEGATED_CLAUSE.finditer(original),*CONDITION.finditer(original)]
    for match in re.finditer(prefix+re.escape(cell)+suffix,original):
        if all(not (match.start()<clause.end() and match.end()>clause.start()) or
               clause.group(0) in quoted_row for clause in protected):
            return True
    return False

def _finalize_entries(document,source):
    check_schema(document,SCHEMA)
    doc=copy.deepcopy(document);doc['title']='Tópicos discutidos'
    events={e['event_id']:e for e in source['events']}
    expected_threads={e.get('thread_id') or '' for e in events.values()}
    titles={t.get('thread_id') or '':t.get('title') for t in source.get('threads',[]) if isinstance(t,dict)}
    covered=set();thread_ids=set();targets=set(events)|expected_threads
    for topic in doc['topics']:
        tid=topic['thread_id']
        if tid not in expected_threads or tid in thread_ids:
            raise ValueError('Assunto ausente ou duplicado na ata.')
        thread_ids.add(tid)
        title=titles.get(tid)
        topic['title']=title.strip() if isinstance(title,str) and title.strip() else 'Assunto sem título'
        for entry in topic['entries']:
            eid=entry['event_id'];event=events.get(eid)
            if not event or (event.get('thread_id') or '')!=tid or eid in covered:
                raise ValueError('A síntese contém evidência duplicada, ausente ou de outro assunto.')
            entry['text']=_check_entry_text(entry['text'],event);covered.add(eid)
        for table in topic['tables']:
            table['title']=_plain(table['title']);table['columns']=[_plain(c) for c in table['columns']]
            labels=[table['title'],*table['columns']]
            if any(not label or NUMBER.search(label) for label in labels):
                raise ValueError('Use títulos e colunas genéricos, sem valores calculados.')
            if len(set(c.casefold() for c in table['columns']))!=len(table['columns']):
                raise ValueError('A tabela tem colunas duplicadas.')
            if any(ASSERTION.search(label) or NEGATION.search(label) for label in labels):
                raise ValueError('O cabeçalho da tabela não pode atribuir resultados aos registros.')
            rows_seen=set()
            for row in table['rows']:
                eid=row['event_id'];event=events.get(eid)
                if not event or (event.get('thread_id') or '')!=tid or len(row['cells'])!=len(table['columns']):
                    raise ValueError('A tabela contém evidência de outro assunto ou colunas inconsistentes.')
                original=_plain(event['text'])
                row['cells']=[_plain(cell) for cell in row['cells']]
                quoted=' '.join(row['cells'])
                if not any(row['cells']) or any(not _quoted_cell(cell,original,quoted) for cell in row['cells']):
                    raise ValueError('Cada célula precisa citar o registro da própria linha.')
                if not set(NUMBER.findall(quoted))<=set(NUMBER.findall(original)) or not set(QUANTITY.findall(quoted))<=set(QUANTITY.findall(original)):
                    raise ValueError('A tabela recortou ou alterou uma quantidade.')
                # A positive fragment such as "aprovado" cannot be cut out of
                # "não aprovado"; quotations must retain the stated polarity.
                if NEGATION.search(original) and ASSERTION.search(quoted) and not NEGATION.search(quoted):
                    raise ValueError('A tabela suprimiu uma negação do resultado.')
                key=(eid,tuple(row['cells']))
                if key in rows_seen: raise ValueError('A tabela repetiu a mesma linha.')
                rows_seen.add(key)
        # Source order makes long and interleaved meetings deterministic.
        event_order={eid:n for n,eid in enumerate(events)}
        topic['entries'].sort(key=lambda entry:event_order[entry['event_id']])
    if thread_ids!=expected_threads or covered!=set(events):
        raise ValueError('A ata omitiu registros ou assuntos atuais.')
    order=list(dict.fromkeys(e.get('thread_id') or '' for e in source['events']))
    doc['topics'].sort(key=lambda topic:order.index(topic['thread_id']))
    warnings=doc['warnings']
    for warning in warnings:
        ids=warning['event_ids'];target=warning['target_id']
        if (target and target not in targets) or not ids or any(eid not in events for eid in ids):
            raise ValueError('Aviso sem evidência ou destino válido.')
        threads={events[eid].get('thread_id') or '' for eid in ids}
        target_thread=events[target].get('thread_id') or '' if target in events else target
        if len(threads)!=1 or target and target_thread not in threads:
            raise ValueError('O aviso misturou evidências de assuntos diferentes.')
        if not set(NUMBER.findall(warning['message']))<=set(NUMBER.findall(' '.join(events[eid]['text'] for eid in ids))):
            raise ValueError('O aviso acrescentou números sem evidência.')
    # These diagnostics are non-editorial: relation/state rules remain the
    # authority even if a generated entry sounds confident.
    for relation in source.get('relations',[]):
        if not confirmed(relation) or relation.get('configuration_match') in ('mismatch','ambiguous','partial'):
            ids=[relation['source_event_id'],relation['target_event_id']]
            warnings.append({'target_id':ids[0],'message':'Conferir compatibilidade entre os registros.','event_ids':ids})
    for warning in source.get('extraction_warnings',[]):
        if isinstance(warning,dict) and isinstance(warning.get('text'),str):
            ids=[eid for eid in warning.get('event_ids',[]) if eid in events]
            warnings.append({'target_id':ids[0] if ids else '', 'message':warning['text'],'event_ids':ids})
    if source.get('run_status')!='done' or source.get('relation_status')!='done':
        warnings.append({'target_id':'','message':'A reunião ainda tem registros em processamento.','event_ids':[]})
    unique={}
    for warning in warnings: unique.setdefault(json.dumps(warning,sort_keys=True,ensure_ascii=False),warning)
    doc['warnings']=[dict(w,id='W'+str(n+1)) for n,w in enumerate(unique.values())]
    doc['prompt_version']=PROMPT_VERSION
    return doc

def finalize(document,source):
    topics=document.get('topics') if isinstance(document,dict) else None
    if isinstance(topics,list) and topics and all(isinstance(t,dict) and 'entries' in t for t in topics):
        return _finalize_entries(document,source)
    return _finalize_legacy(document,source)

def _request(req,timeout):
    """Bound wall-clock waiting even if a socket trickles data without timing out.

    A timed-out transport retains its lane until it actually exits, so retries
    cannot accumulate unbounded provider requests or background workers.
    """
    slots=PROVIDER_BUSY  # Release exactly the slot acquired here, even from the worker thread.
    if not slots.acquire(blocking=False):
        raise MinutesError('Há uma organização em andamento. Aguarde um momento e tente novamente.',429,'busy',True,5)
    finished=threading.Event();outcome={}
    def send():
        try:
            with HTTP.open(req,timeout=timeout) as response:
                raw=response.read(4_000_001)
                if len(raw)>4_000_000: raise ValueError('Resposta muito grande.')
                outcome['result']=json.loads(raw)
        except Exception as error: outcome['error']=error
        finally:
            slots.release();finished.set()
    worker=threading.Thread(target=send,name='minutes-provider',daemon=True)
    try: worker.start()
    except Exception:
        slots.release();raise
    if not finished.wait(timeout):
        raise MinutesError('A organização excedeu o tempo de espera. O documento atual foi preservado; tente novamente em alguns instantes.',504,'timeout',True,5)
    if 'error' in outcome: raise outcome['error']
    return outcome['result']


def generate(source,settings):
    if not settings.gemini_api_key:
        raise MinutesError('A organização do documento ainda não está configurada no servidor.',503,'configuration',False)
    if not re.fullmatch(r'gemini-[a-z0-9.\-]+',settings.gemini_model):
        raise MinutesError('A configuração do serviço de organização precisa ser revisada.',503,'configuration',False)
    payload={'systemInstruction':{'parts':[{'text':(ROOT/'minutes_prompt.txt').read_text()}]},'contents':[{'role':'user','parts':[{'text':json.dumps(source,ensure_ascii=False)}]}], 'generationConfig':{'responseMimeType':'application/json','responseJsonSchema':SCHEMA,'maxOutputTokens':32768, **({'thinkingConfig':{'thinkingLevel':'medium'}} if settings.gemini_model.startswith(('gemini-3.', 'gemini-3-flash')) else {})}}
    req=Request('https://generativelanguage.googleapis.com/v1beta/models/'+settings.gemini_model+':generateContent',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','x-goog-api-key':settings.gemini_api_key},method='POST')
    started=time.monotonic();deadline=started+REQUEST_TIMEOUT_SECONDS
    try:
        for attempt in range(2):
            remaining=deadline-time.monotonic()
            if remaining<=0: raise TimeoutError()
            try:
                result=_request(req,remaining)
                break
            except HTTPError as error:
                code=error.code;error.close()
                # Only a transient capacity response is retried, once, on the same model.
                if code==503 and attempt==0 and deadline-time.monotonic()>RETRY_DELAY_SECONDS+1:
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                if code==429: raise MinutesError('O serviço atingiu o limite de uso. Aguarde alguns minutos e tente novamente.',429,'quota',True,30) from None
                if code in (502,503,504): raise MinutesError('O serviço de organização está temporariamente indisponível. Seu documento atual continua disponível; tente novamente em alguns minutos.',503,'unavailable',True,15) from None
                if code in (400,401,403,404): raise MinutesError('Não foi possível acessar o serviço de organização. A configuração do servidor precisa ser revisada.',503,'configuration',False) from None
                raise MinutesError('Não foi possível organizar o documento agora. Seu documento atual continua disponível.',502,'unavailable',True) from None
        candidate=(result.get('candidates') or [{}])[0]
        if candidate.get('finishReason')!='STOP':
            reason=candidate.get('finishReason')
            raise MinutesError('A organização não foi concluída. Nenhum documento parcial substituiu a versão atual.',502,'incomplete_document',reason!='MAX_TOKENS')
        text=''.join(part.get('text','') for part in candidate.get('content',{}).get('parts',[]) if not part.get('thought'))
        doc=finalize(json.loads(text),source)
    except (TimeoutError,socket.timeout):
        raise MinutesError('A organização excedeu o tempo de espera. O documento atual foi preservado; tente novamente em alguns instantes.',504,'timeout',True,5) from None
    except (URLError,OSError):
        raise MinutesError('Não foi possível conectar ao serviço de organização. Confira a conexão e tente novamente.',502,'connection',True) from None
    except (ValueError,TypeError,KeyError,IndexError,AttributeError):
        raise MinutesError('A versão organizada não passou na conferência dos registros. Seu documento atual foi preservado; tente organizar novamente.',502,'invalid_document',True) from None
    doc['model']=result.get('modelVersion',settings.gemini_model)
    doc['generation_ms']=round((time.monotonic()-started)*1000)
    # Provider-measured usage only. Missing usage stays unknown in observability.
    doc['usage_metadata']=result.get('usageMetadata',{})
    doc['source_fingerprint']=hashlib.sha256(json.dumps(source,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return doc
