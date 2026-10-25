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
from meetings.engine import gemini_minutes as G
from config import load_settings, Settings


def source():
    return {'events':[{'event_id':'E1','thread_id':'T1','type':'hypothesis','text':'A rigidez pode causar deformação.'},{'event_id':'E2','thread_id':'T1','type':'test_proposal','text':'Testar sob 20 N.'},{'event_id':'E3','thread_id':'T1','type':'test_result','text':'Excedeu o limite.'}], 'relations':[{'source_event_id':'E3','target_event_id':'E2','relation_type':'result_of','configuration_match':'exact','review_state':'confirmed','relation_probability':.99,'match_probability':.99}], 'run_status':'done','relation_status':'done'}
def document():
    return {'title':'Tópicos discutidos','topics':[{'thread_id':'T1','title':'Deformação do suporte','summary':{'text':'Foi discutida a deformação.','event_ids':['E1']},'points':[{'id':'P1','text':'A rigidez pode causar deformação.','event_ids':['E1']}],'tests':[{'id':'X1','parent_id':'P1','text':'Testar sob 20 N.','result':'Excedeu o limite.','owner':'','due':'','event_ids':['E2','E3']}],'actions':[]}],'warnings':[]}

def compact_document(s=None):
    s=s or source()
    tids=list(dict.fromkeys(e['thread_id'] for e in s['events']))
    return {'title':'Ata','topics':[{'thread_id':tid,'title':'Título do modelo',
        'entries':[{'event_id':e['event_id'],'text':e['text']} for e in s['events'] if e['thread_id']==tid],
        'tables':[]} for tid in tids],'warnings':[]}

class ConciseMinutesTests(unittest.TestCase):
    def test_preserves_titles_source_order_and_original_state_without_duplicate_narrative(self):
        s=source();s['threads']=[{'thread_id':'T1','title':'Suporte principal'}]
        d=compact_document(s);d['topics'][0]['entries'].reverse()
        before_source=copy.deepcopy(s);before_document=copy.deepcopy(d)
        result=G.finalize(d,s)
        self.assertEqual(result['topics'][0]['title'],'Suporte principal')
        self.assertEqual([e['event_id'] for e in result['topics'][0]['entries']],['E1','E2','E3'])
        self.assertEqual(set(result['topics'][0]),{'thread_id','title','entries','tables'})
        self.assertTrue(all(len(e['text'])<=180 for e in result['topics'][0]['entries']))
        self.assertEqual(result['prompt_version'],G.PROMPT_VERSION)
        self.assertEqual(s,before_source);self.assertEqual(d,before_document)

    def test_exact_coverage_and_thread_isolation(self):
        s=source();s['events'].append({'event_id':'E4','thread_id':'T2','type':'observation','text':'A tampa está frouxa.'})
        for mode in ['missing','duplicate','unknown','cross_thread','missing_topic','duplicate_topic']:
            with self.subTest(mode=mode):
                d=compact_document(s);entries=d['topics'][0]['entries']
                if mode=='missing':entries.pop()
                if mode=='duplicate':entries.append(copy.deepcopy(entries[0]))
                if mode=='unknown':entries[0]['event_id']='inventado'
                if mode=='cross_thread':entries[0]['event_id']='E4'
                if mode=='missing_topic':d['topics'].pop()
                if mode=='duplicate_topic':d['topics'].append(copy.deepcopy(d['topics'][0]))
                with self.assertRaises(ValueError):G.finalize(d,s)

    def test_rejects_invented_values_units_assertions_and_hypothesis_as_fact(self):
        for index,text in [(0,'A rigidez causa deformação.'),(1,'Testar sob 30 N.'),
                           (1,'Testar sob 20 kg.'),(1,'Testar sob -20 N.'),
                           (1,'Teste aprovado sob 20 N.'),(2,'Não excedeu o limite.'),
                           (2,'O resultado está dentro do limite.'),(0,'x'*181)]:
            with self.subTest(text=text):
                d=compact_document();d['topics'][0]['entries'][index]['text']=text
                with self.assertRaises(ValueError):G.finalize(d,source())

    def test_does_not_remove_negation_scope_or_conditions(self):
        for original,summary in [
            ('O teste não foi aprovado.','O teste foi aprovado.'),
            ('O teste não foi aprovado.','Não houve falha no teste.'),
            ('Testar somente se a bancada estiver travada.','Testar a bancada.'),
            ('Testar sob 20 N, caso a bancada esteja travada.','Testar sob 20 N.')]:
            with self.subTest(original=original):
                s=source();s['events'][1]['text']=original;d=compact_document(s)
                d['topics'][0]['entries'][1]['text']=summary
                with self.assertRaises(ValueError):G.finalize(d,s)
                d['topics'][0]['entries'][1]['text']=original
                G.finalize(d,s)

    def test_short_summary_can_leave_detailed_calculations_in_source(self):
        s=source();s['events'][2]['text']='Simulação calculada: carga de 20 N; deslocamento 3 mm; tensão 12 MPa; seção 4 cm.'
        d=compact_document(s);d['topics'][0]['entries'][2]['text']='Simulação calculada sob carga de 20 N.'
        d['topics'][0]['tables']=[{'title':'Medidas do ensaio','columns':['Medida','Valor'],
            'rows':[{'event_id':'E3','cells':['deslocamento','3 mm']},{'event_id':'E3','cells':['tensão','12 MPa']}]}]
        result=G.finalize(d,s)
        self.assertEqual(result['topics'][0]['entries'][2]['text'],'Simulação calculada sob carga de 20 N.')
        self.assertEqual(len(result['topics'][0]['tables'][0]['rows']),2)

    def test_table_cells_are_literal_citations_of_the_same_event(self):
        s=source();s['events'][1]['text']='Testar sob   20\nN.'
        s['events'].append({'event_id':'E4','thread_id':'T2','type':'test_result','text':'Deformação 7 mm.'})
        d=compact_document(s);d['topics'][0]['entries'][1]['text']='Testar sob 20 N.'
        table={'title':'Condições do ensaio','columns':['Condição','Valor'],
            'rows':[{'event_id':'E2','cells':['Testar sob','20 N']}]}
        d['topics'][0]['tables']=[table];G.finalize(d,s)
        for mode in ['new_value','other_event','other_thread','calculation','missing_column','duplicate','empty','heading']:
            with self.subTest(mode=mode):
                changed=copy.deepcopy(d);t=changed['topics'][0]['tables'][0];row=t['rows'][0]
                if mode=='new_value':row['cells'][1]='30 N'
                if mode=='other_event':row['cells'][1]='Excedeu o limite.'
                if mode=='other_thread':row['event_id']='E4';row['cells']=['Deformação','7 mm']
                if mode=='calculation':row['cells'][1]='0,02 kN'
                if mode=='missing_column':row['cells'].append('')
                if mode=='duplicate':t['rows'].append(copy.deepcopy(row))
                if mode=='empty':row['cells']=['','']
                if mode=='heading':t['columns'][1]='Limite 30 N'
                with self.assertRaises(ValueError):G.finalize(changed,s)

    def test_table_cannot_quote_positive_fragment_from_negated_outcome(self):
        s=source();s['events'][2]['text']='O ensaio não foi aprovado.'
        d=compact_document(s);d['topics'][0]['tables']=[{'title':'Ensaios','columns':['Item','Resultado'],
            'rows':[{'event_id':'E3','cells':['ensaio','aprovado']}]}]
        with self.assertRaises(ValueError):G.finalize(d,s)
        d['topics'][0]['tables'][0]['rows'][0]['cells'][1]='não foi aprovado'
        G.finalize(d,s)

    def test_table_cannot_cut_tokens_negation_or_conditions(self):
        for original,cells in [
            ('Carga 180 N.',['Carga','80 N']),
            ('Carga 20 kN.',['Carga','N']),
            ('Carga 20,5 N.',['Carga','20']),
            ('O ensaio não excedeu o limite.',['ensaio','excedeu o limite']),
            ('Configuração incompatível.',['Configuração','compatível']),
            ('Aprovar somente se a tensão estiver abaixo de 20 MPa.',['Aprovar','20 MPa'])]:
            with self.subTest(original=original):
                s=source();s['events'][2]['text']=original;d=compact_document(s)
                d['topics'][0]['tables']=[{'title':'Ensaio','columns':['Item','Valor'],
                    'rows':[{'event_id':'E3','cells':cells}]}]
                with self.assertRaises(ValueError):G.finalize(d,s)

    def test_limits_keep_comparison_tables_compact(self):
        base={'title':'Ensaios','columns':['Condição','Valor'], 'rows':[{'event_id':'E2','cells':['Testar sob','20 N']}]}
        for mode in ['tables','rows','columns','cell']:
            with self.subTest(mode=mode):
                d=compact_document();d['topics'][0]['tables']=[copy.deepcopy(base)]
                t=d['topics'][0]['tables'][0]
                if mode=='tables':d['topics'][0]['tables']*=4
                if mode=='rows':t['rows']*=17
                if mode=='columns':t['columns']=['A','B','C','D','E','F']
                if mode=='cell':t['rows'][0]['cells'][0]='x'*121
                with self.assertRaises(ValueError):G.finalize(d,source())

    def test_generated_diagnostics_cannot_mix_topics_or_invent_numbers(self):
        s=source();s['events'].append({'event_id':'E4','thread_id':'T2','type':'observation','text':'A tampa está frouxa.'})
        for warning in [
            {'target_id':'E1','message':'Conferir registro.','event_ids':['E4']},
            {'target_id':'T1','message':'Conferir registro.','event_ids':['E1','E4']},
            {'target_id':'T1','message':'Limite de 30 N.','event_ids':['E2']},
            {'target_id':'','message':'Conferir registro.','event_ids':[]}]:
            with self.subTest(warning=warning):
                d=compact_document(s);d['warnings']=[warning]
                with self.assertRaises(ValueError):G.finalize(d,s)

    def test_new_provider_contract_and_concise_prompt(self):
        result={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(compact_document())}]}}]}
        with patch.object(G,'_request',return_value=result) as send:
            generated=G.generate(source(),Settings(gemini_api_key='private-key'))
        payload=json.loads(send.call_args.args[0].data)
        self.assertEqual(payload['generationConfig']['responseJsonSchema'],G.response_schema(source()))
        self.assertNotIn('maxItems',json.dumps(G.response_schema(source())))
        self.assertIn('maxItems',json.dumps(G.SCHEMA))
        self.assertIn('entries',payload['generationConfig']['responseJsonSchema']['properties']['topics']['items']['properties'])
        self.assertNotIn('summary',payload['generationConfig']['responseJsonSchema']['properties']['topics']['items']['properties'])
        self.assertIn('Não escreva histórico da discussão',payload['systemInstruction']['parts'][0]['text'])
        self.assertEqual(len(generated['topics'][0]['entries']),3)

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
            self.assertIn('gemini-3.8-flash:generateContent', req.full_url)
            self.assertEqual(json.loads(req.data)['generationConfig']['thinkingConfig'], {'thinkingLevel': 'medium'})
        with self.assertRaises(G.MinutesError):G.generate(source(),Settings())
if __name__=='__main__':unittest.main()

class MinutesRouteTests(unittest.TestCase):
    def test_daily_limit_blocks_provider_and_does_not_count_a_paid_call(self):
        from meetings.engine import ai_runtime
        import server
        from urllib.request import Request, urlopen
        from http.server import ThreadingHTTPServer
        from support import signed_in
        _, headers = signed_in(self)
        settings = Settings(minutes_daily_call_limit=1, gemini_api_key='private-test')
        runtime = ai_runtime.Runtime(server.STORE, settings)
        with patch.object(server, 'AI_RUNTIME', runtime), patch.object(server, 'SETTINGS', settings):
            http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            worker = threading.Thread(target=http.serve_forever, daemon=True); worker.start()
            try:
                req = Request(f'http://127.0.0.1:{http.server_port}/api/minutes',
                    data=json.dumps({'source': source()}).encode(), headers={'Content-Type': 'application/json', **headers})
                with patch.object(G, 'generate', side_effect=G.MinutesError('Falha sintética.', 503, 'unavailable')) as generate:
                    with self.assertRaises(HTTPError) as first: urlopen(req)
                    self.assertEqual(first.exception.code, 503)
                    with self.assertRaises(HTTPError) as second: urlopen(req)
                    self.assertEqual(second.exception.code, 429)
                    self.assertEqual(json.load(second.exception)['code'], 'daily_limit')
                    self.assertEqual(generate.call_count, 1)
                    self.assertIs(generate.call_args.args[1], settings)
                    self.assertEqual(server.STORE._run('SELECT calls FROM ai_minutes_budget', fetch='one')[0], 1)
                    self.assertEqual(server.STORE._run('SELECT COUNT(*) FROM ai_usage', fetch='one')[0], 1)
            finally:
                http.shutdown(); http.server_close(); worker.join(); runtime.stop()

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
