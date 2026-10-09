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
PROMPT_VERSION = 'minutes-2026-10-07-v2'
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
def arr(items): return {'type':'array','items':items}
STR={'type':'string'}
REFS=arr(STR)
POINT=obj(id=STR,text=STR,event_ids=REFS)
TASK=obj(id=STR,parent_id=STR,text=STR,result=STR,owner=STR,due=STR,event_ids=REFS)
SCHEMA=obj(title=STR,topics=arr(obj(thread_id=STR,title=STR,summary=obj(text=STR,event_ids=REFS),points=arr(POINT),tests=arr(TASK),actions=arr(TASK))),warnings=arr(obj(target_id=STR,message=STR,event_ids=REFS)))

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
        if not isinstance(value,str) or len(value)>30000: raise ValueError('Texto gerado inválido.')
    elif typ=='array':
        if not isinstance(value,list) or len(value)>12000: raise ValueError('Lista gerada inválida.')
        for v in value: check_schema(v,schema['items'])
    else:
        if not isinstance(value,dict) or set(value)!=set(schema['properties']): raise ValueError('Estrutura gerada inválida.')
        for key,part in schema['properties'].items(): check_schema(value[key],part)

def confirmed(r):
    return r.get('review_state')=='confirmed' and all(isinstance(r.get(k),(int,float)) and r[k]>=.8 for k in ('relation_probability','match_probability'))

def finalize(document,source):
    check_schema(document,SCHEMA)
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
    payload={'systemInstruction':{'parts':[{'text':(ROOT/'minutes_prompt.txt').read_text()}]},'contents':[{'role':'user','parts':[{'text':json.dumps(source,ensure_ascii=False)}]}], 'generationConfig':{'responseMimeType':'application/json','responseJsonSchema':SCHEMA,'maxOutputTokens':32768, **({'thinkingConfig':{'thinkingLevel':'medium'}} if settings.gemini_model.startswith(('gemini-3.1','gemini-3-flash')) else {})}}
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
