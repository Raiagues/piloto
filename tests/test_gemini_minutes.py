import copy
import json
import tempfile
import threading
import time
from io import BytesIO
from urllib.error import HTTPError
import unittest
from pathlib import Path
from unittest.mock import patch
import gemini_minutes as G
from config import load_settings, Settings


def source():
    return {'events':[{'event_id':'E1','thread_id':'T1','type':'hypothesis','text':'A rigidez pode causar deformação.'},{'event_id':'E2','thread_id':'T1','type':'test_proposal','text':'Testar sob 20 N.'},{'event_id':'E3','thread_id':'T1','type':'test_result','text':'Excedeu o limite.'}], 'relations':[{'source_event_id':'E3','target_event_id':'E2','relation_type':'result_of','configuration_match':'exact','review_state':'confirmed','relation_probability':.99,'match_probability':.99}], 'run_status':'done','relation_status':'done'}
def document():
    return {'title':'Tópicos discutidos','topics':[{'thread_id':'T1','title':'Deformação do suporte','summary':{'text':'Foi discutida a deformação.','event_ids':['E1']},'points':[{'id':'P1','text':'A rigidez pode causar deformação.','event_ids':['E1']}],'tests':[{'id':'X1','parent_id':'P1','text':'Testar sob 20 N.','result':'Excedeu o limite.','owner':'','due':'','event_ids':['E2','E3']}],'actions':[]}],'warnings':[]}
class MinutesTests(unittest.TestCase):
    def test_configuration_secret_repr_and_alias(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'.env';path.write_text('GOOGLE_API_KEY=private-test-key\nGEMINI_MODEL=gemini-3.1-pro-preview\n')
            s=load_settings(path,{})
            self.assertEqual(s.gemini_api_key,'private-test-key');self.assertNotIn('private-test-key',repr(s))
    def test_evidence_controls_completion_without_changing_result(self):
        s=source();d=G.finalize(document(),s)
        self.assertEqual(d['topics'][0]['tests'][0]['status'],'done')
        self.assertEqual(d['topics'][0]['tests'][0]['result'],'Excedeu o limite.')
        s['relations'][0]['configuration_match']='mismatch'
        d=G.finalize(document(),s);self.assertEqual(d['topics'][0]['tests'][0]['status'],'pending')
        self.assertTrue(any('configuração mismatch' in w['message'] for w in d['warnings']))
    def test_unconfirmed_parent_and_general_review_cannot_be_silenced(self):
        d=G.finalize(document(),source())
        self.assertTrue(any(w['target_id']=='X1' for w in d['warnings']))
        self.assertTrue(any(w['target_id']=='' for w in d['warnings']))
    def test_unknown_reference_cross_thread_or_missing_coverage_rejected(self):
        for mode in ['unknown','cross','coverage','parent']:
            d=document();s=source()
            if mode=='unknown':d['topics'][0]['tests'][0]['event_ids']=['FAKE']
            if mode=='cross':s['events'][2]['thread_id']='T2'
            if mode=='coverage':d['topics'][0]['tests'][0]['event_ids']=['E2']
            if mode=='parent':d['topics'][0]['tests'][0]['parent_id']='FAKE'
            with self.assertRaises(ValueError):G.finalize(d,s)
    def test_input_validation_and_no_source_mutation(self):
        s=source();before=copy.deepcopy(s);G.validate_source({'source':s});G.finalize(document(),s);self.assertEqual(s,before)
        s['events'].append(s['events'][0])
        with self.assertRaises(ValueError):G.validate_source({'source':s})
    def test_titles_are_preserved_from_user_metadata_only(self):
        s=source();s['threads']=[{'thread_id':'T1','title':'Título escolhido pela equipe'}]
        self.assertEqual(G.finalize(document(),s)['topics'][0]['title'],'Título escolhido pela equipe')
        s['threads']=[]
        self.assertEqual(G.finalize(document(),s)['topics'][0]['title'],'Assunto sem título')

    def test_transient_unavailable_retries_once_on_same_model(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,n):return json.dumps({'modelVersion':'gemini-test','candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(document())}]}}]}).encode()
        error=HTTPError('https://generativelanguage.googleapis.com',503,'Unavailable',{},BytesIO())
        with patch.object(G.HTTP,'open',side_effect=[error,Response()]) as send,patch.object(G,'RETRY_DELAY_SECONDS',0):
            result=G.generate(source(),Settings(gemini_api_key='private-key'))
        self.assertEqual(send.call_count,2)
        self.assertIs(send.call_args_list[0].args[0],send.call_args_list[1].args[0])
        self.assertEqual(result['model'],'gemini-test')
        self.assertGreaterEqual(result['generation_ms'],0)

    def test_overload_quota_and_incomplete_response_are_safe_actionable_errors(self):
        for status,expected in [(503,'unavailable'),(429,'quota'),(403,'configuration')]:
            with self.subTest(status=status):
                errors=[HTTPError('https://generativelanguage.googleapis.com',status,'private-key',{},BytesIO()) for _ in range(2)]
                with patch.object(G.HTTP,'open',side_effect=errors) as send,patch.object(G,'RETRY_DELAY_SECONDS',0):
                    with self.assertRaises(G.MinutesError) as caught:G.generate(source(),Settings(gemini_api_key='private-key'))
                self.assertEqual(caught.exception.code,expected)
                self.assertEqual(send.call_count,2 if status==503 else 1)
                self.assertNotIn('private-key',json.dumps(caught.exception.response()))
                self.assertNotIn('Gemini',str(caught.exception))
        with patch.object(G,'_request',return_value={'candidates':[{'finishReason':'MAX_TOKENS'}]}):
            with self.assertRaises(G.MinutesError) as caught:G.generate(source(),Settings(gemini_api_key='private-key'))
        self.assertEqual(caught.exception.code,'incomplete_document');self.assertFalse(caught.exception.retryable)

    def test_absolute_deadline_exits_even_if_transport_ignores_socket_timeout(self):
        release=threading.Event();slots=G.ProviderSlots(1)
        class SlowResponse:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,n):release.wait(2);return b'{}'
        try:
            with patch.object(G.HTTP,'open',return_value=SlowResponse()) as send,patch.object(G,'REQUEST_TIMEOUT_SECONDS',.04),patch.object(G,'PROVIDER_BUSY',slots):
                started=time.monotonic()
                with self.assertRaises(G.MinutesError) as caught:G.generate(source(),Settings(gemini_api_key='private-key'))
                self.assertEqual(caught.exception.code,'timeout');self.assertEqual(caught.exception.status,504)
                self.assertLess(time.monotonic()-started,.5)
                with self.assertRaises(G.MinutesError) as busy:G.generate(source(),Settings(gemini_api_key='private-key'))
                self.assertEqual(busy.exception.code,'busy');self.assertEqual(send.call_count,1)
        finally:
            release.set()
            for _ in range(100):
                if not slots.locked():break
                time.sleep(.005)
        self.assertFalse(slots.locked())

    def test_provider_transport_and_safe_invalid_response(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,n):return json.dumps({'modelVersion':'gemini-test','candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(document())}]}}]}).encode()
        with patch.object(G.HTTP,'open',return_value=Response()) as send:
            d=G.generate(source(),Settings(gemini_api_key='private-key'))
            req=send.call_args.args[0]
            self.assertNotIn('private-key',req.full_url);self.assertEqual(req.headers['X-goog-api-key'],'private-key');self.assertEqual(d['model'],'gemini-test')
        with self.assertRaises(G.MinutesError):G.generate(source(),Settings())
if __name__=='__main__':unittest.main()

class MinutesRouteTests(unittest.TestCase):
    def test_route_private_files_and_origin(self):
        import server
        import threading
        from urllib.request import Request,urlopen
        from urllib.error import HTTPError
        from http.server import ThreadingHTTPServer
        from support import signed_in
        user_id,auth_headers=signed_in(self)
        http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        worker=threading.Thread(target=http.serve_forever,daemon=True);worker.start()
        url='http://127.0.0.1:'+str(http.server_port)
        try:
            with patch.object(server.gemini_minutes,'generate',return_value=G.finalize(document(),source())) as generate:
                req=Request(url+'/api/minutes',data=json.dumps({'source':source()}).encode(),headers={'Content-Type':'application/json',**auth_headers})
                with urlopen(req) as response:self.assertEqual(json.load(response)['title'],'Tópicos discutidos')
                self.assertEqual(generate.call_count,1)
                req.add_header('Origin','https://outside.example')
                with self.assertRaises(HTTPError) as caught:urlopen(req)
                self.assertEqual(caught.exception.code,403);self.assertEqual(generate.call_count,1)
            with patch.object(server.gemini_minutes,'generate',side_effect=G.MinutesError('Serviço indisponível.',503,'unavailable',True,15)):
                req=Request(url+'/api/minutes',data=json.dumps({'source':source()}).encode(),headers={'Content-Type':'application/json',**auth_headers})
                with self.assertRaises(HTTPError) as caught:urlopen(req)
                self.assertEqual(caught.exception.code,503)
                self.assertEqual(json.load(caught.exception),{'error':'Serviço indisponível.','code':'unavailable','retryable':True,'retry_after_seconds':15})
            lane=server.lanes_for(user_id)['minutes'];lane.acquire()
            try:
                with self.assertRaises(HTTPError) as caught:urlopen(req)
                self.assertEqual(caught.exception.code,429);self.assertEqual(json.load(caught.exception)['code'],'busy')
            finally:lane.release()
            for name in ['.env','config.py','gemini_minutes.py','minutes_prompt.txt']:
                with self.assertRaises(HTTPError) as caught:urlopen(url+'/'+name)
                self.assertEqual(caught.exception.code,404)
        finally:http.shutdown();http.server_close();worker.join()
