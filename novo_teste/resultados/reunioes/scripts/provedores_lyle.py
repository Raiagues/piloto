"""Explicit evaluation worker: real providers, no database or credential output."""
import sys,json,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[4]))
import server
from config import load_settings
from meetings.engine import gemini_minutes
settings=load_settings()
from urllib.error import HTTPError
_original_request=gemini_minutes._request
def diagnostic_request(req,timeout):
    if os.environ.get('LYLE_DIAGNOSTIC_SIMPLE_SCHEMA')=='1':
        def simplify(value):
            if isinstance(value,dict):return {k:simplify(v) for k,v in value.items() if k not in ('additionalProperties','minLength','maxLength','minItems','maxItems')}
            if isinstance(value,list):return [simplify(v) for v in value]
            return value
        payload=json.loads(req.data);payload['generationConfig']['responseJsonSchema']=simplify(payload['generationConfig']['responseJsonSchema']);req.data=json.dumps(payload).encode()
    if os.environ.get('LYLE_DIAGNOSTIC_NO_THINKING')=='1':
        payload=json.loads(req.data);payload['generationConfig'].pop('thinkingConfig',None)
        req.data=json.dumps(payload).encode()
    try:
        result=_original_request(req,timeout)
        source=json.loads(json.loads(req.data)['contents'][0]['parts'][0]['text'])
        artifact=Path(__file__).resolve().parent.parent/'artefatos'/(str(source.get('run_id','LYLE'))+'-gemini-response.json')
        artifact.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        return result
    except HTTPError as error:
        try:
            message=json.loads(error.read(10000)).get('error',{}).get('message','')
            message=message.replace(settings.gemini_api_key,'[redacted]') if settings.gemini_api_key else message
            print(json.dumps({'provider_status':error.code,'message':message[:1500]}),file=sys.stderr,flush=True)
        except Exception: print('Provider error body unavailable',file=sys.stderr)
        raise
gemini_minutes._request=diagnostic_request
_original_finalize=gemini_minutes.finalize
def diagnostic_finalize(document,source):
    artifact=Path(__file__).resolve().parent.parent/'artefatos'/(str(source.get('run_id','LYLE'))+'-gemini-candidate.json')
    artifact.write_text(json.dumps({'source':source,'candidate':document},ensure_ascii=False,indent=2))
    try:return _original_finalize(document,source)
    except Exception as error:
        print(json.dumps({'validation_error':str(error)}),file=sys.stderr,flush=True)
        raise
gemini_minutes.finalize=diagnostic_finalize
for raw in sys.stdin:
    job=json.loads(raw)
    try:
        if job['kind']=='minutes':
            source=gemini_minutes.validate_source({'source':job['request']})
            result=gemini_minutes.generate(source,settings)
        else:
            server.validate_request(job['request'])
            result=server.classify(job['request'],settings)
        print(json.dumps({'id':job['id'],'result':result}),flush=True)
    except Exception as error:
        print(json.dumps({'id':job['id'],'error':str(error),'code':getattr(error,'code',None)}),flush=True)
