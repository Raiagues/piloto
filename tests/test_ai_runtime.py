import dataclasses
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import ai_runtime as A
import auth
import config
import server


def event(id='e1', session='meeting1', **changes):
    return {'id': id, 'session_id': session, 'kind': 'intent', 'text': 'bota o simulador na tela',
            'status': 'unrecognized', 'source': 'microphone', 'latency_ms': 23, **changes}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.store = auth.Store()
        self.user = self.store.create_user('tester', 'test-password')['id']
        self.other = self.store.create_user('other', 'test-password')['id']
        self.runtime = A.Runtime(self.store, config.Settings())

    def tearDown(self):
        self.runtime.stop(); self.store.close()

    def ingest(self, *events): return self.runtime.ingest(self.user, {'events': list(events)})

    def test_ingest_is_idempotent_and_human_labels_are_separate(self):
        self.assertEqual(self.ingest(event())['accepted'], 1)
        self.assertEqual(self.ingest(event())['accepted'], 0)
        m = self.runtime.metrics()
        self.assertEqual(m['decisions'], 1); self.assertIsNone(m['accuracy'])
        with self.assertRaises(ValueError): self.ingest(event('spoof', correct=True))
        self.ingest(event('feedback1', kind='feedback', correct=False, expected_intent='open_simulation'))
        m = self.runtime.metrics()
        self.assertEqual(m['accuracy'], 0); self.assertEqual(m['decisions'], 1)

    def test_invalid_batch_writes_nothing(self):
        with self.assertRaises(ValueError): self.ingest(event(), event('bad', latency_ms=float('nan')))
        self.assertEqual(self.runtime.metrics()['events'], 0)

    def test_repeated_feedback_labels_one_source_once_and_latest_wins(self):
        self.ingest(event('one', kind='feedback', correct=False, details={'event_id': 'meeting:e1'}))
        self.ingest(event('two', kind='feedback', correct=True, details={'event_id': 'meeting:e1'}))
        self.assertEqual(self.runtime.metrics()['labeled'], 1)
        self.assertEqual(self.runtime.metrics()['accuracy'], 1)

    def test_late_events_enqueue_new_audit_after_first_job_finishes(self):
        self.ingest(event())
        self.assertTrue(self.runtime.run_once())
        self.ingest(event('e2'))
        self.assertTrue(self.runtime.run_once())
        self.assertFalse(self.runtime.run_once())

    def test_memory_query_cannot_cross_accounts(self):
        key = 'norte.meeting-room.session.v2.same-id'
        self.store.put_record(self.user, key, json.dumps({'id': 'same-id', 'meeting_events': [{'event_id': 'E1', 'text': 'viga de aço'}]}))
        self.store.put_record(self.other, key, json.dumps({'id': 'same-id', 'meeting_events': [{'event_id': 'E2', 'text': 'viga secreta outro usuário'}]}))
        data = self.runtime.memory.query(self.user, 'viga')
        self.assertEqual([h['event_id'] for h in data['hits']], ['E1'])
        self.assertFalse(data['digital_twin_connected'])
        self.assertEqual(self.runtime.memory.query(self.user, 'secreta')['hits'], [])

    def test_replay_tests_negation_and_holdout_without_polluting_accuracy(self):
        report = self.runtime.evaluate(self.user)
        self.assertEqual(report['passed'], report['total'])
        self.assertGreaterEqual(report['total'], 20)
        self.assertIn('holdout', [r['split'] for r in report['cases']])
        self.assertIsNone(self.runtime.metrics()['accuracy'])
        self.assertEqual(self.runtime.metrics()['automatic_accuracy'], 1)

    def test_human_evidence_two_sessions_publishes_exact_account_alias(self):
        self.ingest(event('f1', 's1', kind='feedback', correct=False, expected_intent=A.INTENT))
        self.runtime.audit(self.user)
        self.assertEqual(self.runtime.aliases(self.user)['aliases'], [])
        self.ingest(event('f2', 's2', kind='feedback', correct=False, expected_intent=A.INTENT))
        self.runtime.audit(self.user)
        aliases = self.runtime.aliases(self.user)['aliases']
        self.assertEqual(len(aliases), 1)
        self.assertEqual(self.runtime.resolve(self.user, {'text': event()['text']})['source'], 'learned_alias')
        self.assertIsNone(self.runtime.resolve(self.other, {'text': event()['text']})['intent'])
        self.assertIsNone(self.runtime.resolve(self.user, {'text': 'não ' + event()['text']})['intent'])
        self.assertIsNone(self.runtime.resolve(self.user, {'text': event()['text'] + ' e altere a força p1'})['intent'])
        self.runtime.rollback(aliases[0]['id'])
        self.runtime.audit(self.user)
        self.assertEqual(self.runtime.aliases(self.user)['aliases'], [])

    def test_negative_feedback_cannot_train_unsafe_alias(self):
        self.ingest(*(event(f'f{i}', f's{i}', kind='feedback', correct=False, expected_intent=A.INTENT, text='não abra a simulação') for i in range(3)))
        self.runtime.audit(self.user)
        self.assertEqual(self.runtime.aliases(self.user)['aliases'], [])

    def test_implicit_recovery_publishes_only_after_independent_evidence_and_review(self):
        for session in ('s1', 's2'):
            self.ingest(event(session + 'a', session), event(session + 'b', session),
                        event(session + 'c', session, text='Abrir simulação', status='success', source='ui', intent=A.INTENT))
        with patch.object(self.runtime, 'ask_model', return_value={'intent': A.INTENT, 'confidence': .99}):
            report = self.runtime.audit(self.user)
        self.assertGreater(report['recoveries_detected'], 0)
        self.assertEqual(len(self.runtime.aliases(self.user)['aliases']), 1)
        self.assertIsNone(self.runtime.metrics()['accuracy'])
        self.assertTrue(self.runtime.overview()['proposals'][0]['evaluation']['automatic'])

    def test_recovery_without_external_optin_is_proposal_only(self):
        for session in ('s1', 's2'):
            self.ingest(event(session + 'a', session), event(session + 'b', session),
                        event(session + 'c', session, status='success', source='ui', intent=A.INTENT))
        with patch.object(A.AI_HTTP, 'open') as request:
            self.runtime.audit(self.user)
        request.assert_not_called()
        self.assertEqual(self.runtime.overview()['proposals'][0]['status'], 'proposed')

    def test_queue_recovers_expired_lease_and_bounds_retries(self):
        job = self.runtime.enqueue(self.user, 'replay')['job_id']
        claimed = self.runtime.claim()
        self.assertEqual(claimed[0], job)
        self.store._run('UPDATE ai_jobs SET lease_until=0 WHERE id=%s', (job,))
        self.assertTrue(self.runtime.run_once())
        self.assertEqual(self.store._run('SELECT status,attempts FROM ai_jobs WHERE id=%s', (job,), 'one'), ('done', 2))
        job = self.runtime.enqueue(self.user, 'audit')['job_id']
        with patch.object(self.runtime, 'audit', side_effect=RuntimeError('no secret body')):
            for _ in range(3):
                self.store._run('UPDATE ai_jobs SET available_at=0 WHERE id=%s', (job,)); self.runtime.run_once()
        self.assertEqual(self.store._run('SELECT status,attempts FROM ai_jobs WHERE id=%s', (job,), 'one'), ('error', 3))
        self.assertFalse(self.runtime.run_once())

    def test_atomic_budget_enforces_concurrent_daily_limit(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, ai_daily_budget_usd=.02, ai_daily_call_limit=2)
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.runtime.reserve_budget(.01))) for _ in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(sum(r is not None for r in results), 2)

    def test_usage_never_invents_missing_tokens_or_wrong_model_price(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, ai_gemini_input_usd_per_million=.3, ai_gemini_output_usd_per_million=2.5)
        self.runtime.record_usage(self.user, 'jev', 'jev-latest', 'classify', {}, 40)
        response = {'usageMetadata': {'promptTokenCount': 100, 'candidatesTokenCount': 10, 'thoughtsTokenCount': 5}}
        price = self.runtime.record_usage(self.user, 'gemini', 'gemini-2.5-flash', 'agent', response, 90)
        self.assertAlmostEqual(price, (100 * .3 + 15 * 2.5) / 1000000)
        self.assertIsNone(self.runtime.record_usage(self.user, 'gemini', 'gemini-3.1-pro-preview', 'minutes', response, 90))
        self.assertEqual(self.runtime.metrics()['unknown_cost_calls'], 2)
        self.assertEqual(self.runtime.metrics()['output_tokens'], 30)

    def test_free_output_tariff_can_price_measured_input_without_inventing_output_tokens(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, jev_input_usd_per_million=.042, jev_output_usd_per_million=0)
        cost = self.runtime.record_usage(self.user, 'jev', 'jev-latest', 'classify', {'usage': {'input_tokens': 1000}}, 40)
        self.assertAlmostEqual(cost, .000042)
        self.assertEqual(self.store._run('SELECT output_tokens FROM ai_usage', fetch='one')[0], None)

    def test_feedback_errors_are_visible_to_auditor(self):
        self.ingest(event('feedback', kind='feedback', status='success', correct=False))
        self.assertEqual(self.runtime.audit(self.user)['unresolved_examples'][0]['event_id'], 'feedback')

    def test_external_egress_rejects_memory_accounts_and_physical_state(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, ai_external_review_enabled=True,
            gemini_api_key='fake-test-key', ai_gemini_input_usd_per_million=.3, ai_gemini_output_usd_per_million=2.5)
        with patch.object(A.AI_HTTP, 'open') as request:
            for key in ('beam_state_before', 'details', 'account_id', 'memory', 'events', 'source'):
                evidence = {'task': 'review_alias', 'text': event()['text'], key: 'must never leave server'}
                self.assertIsNone(self.runtime.ask_model(self.user, evidence))
            request.assert_not_called()
        self.assertEqual(self.runtime.overview()['settings']['daily_calls_used'], 0)

    def test_openai_explicit_provider_uses_structured_response_usage_and_no_storage(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, ai_external_review_enabled=True,
            ai_agent_provider='openai', openai_api_key='private-fixture', ai_openai_input_usd_per_million=.4, ai_openai_output_usd_per_million=1.6)
        verdict = {'intent': A.INTENT, 'confidence': .99, 'reason': 'Pedido explícito.'}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit):
                return json.dumps({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(verdict)}]}],
                                   'usage': {'input_tokens': 100, 'output_tokens': 20}}).encode()
        with patch.object(A.AI_HTTP, 'open', return_value=Response()) as request:
            result = self.runtime.ask_model(self.user, {'task': 'review_alias', 'text': event()['text'], 'observed_recoveries': 4})
        self.assertEqual(result, verdict)
        req = request.call_args.args[0]
        self.assertEqual(req.full_url, 'https://api.openai.com/v1/responses')
        payload = json.loads(req.data)
        self.assertIs(payload['store'], False)
        self.assertIs(payload['text']['format']['strict'], True)
        self.assertEqual(set(json.loads(payload['input'])), {'task', 'text', 'observed_recoveries'})
        self.assertNotIn('private-fixture', repr(self.runtime.settings))
        self.assertAlmostEqual(self.runtime.metrics()['estimated_cost_usd'], .000072)
        self.assertTrue(self.runtime.provider_status()['verified'])

    def test_provider_error_is_sanitized_and_does_not_fallback(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, ai_external_review_enabled=True,
            gemini_api_key='private-fixture', ai_gemini_input_usd_per_million=.3, ai_gemini_output_usd_per_million=2.5,
            openai_api_key='unused-fallback-key')
        with patch.object(A.AI_HTTP, 'open', side_effect=HTTPError('https://provider.invalid', 403, 'secret body must not leak', {}, None)) as request:
            self.assertIsNone(self.runtime.ask_model(self.user, {'task': 'review_alias', 'text': event()['text']}))
        self.assertEqual(request.call_count, 1)
        status = self.runtime.provider_status()
        self.assertFalse(status['verified']); self.assertEqual(status['last_error']['http_status'], 403)
        self.assertNotIn('secret body', json.dumps(self.runtime.overview()))

    def test_schema_and_queue_survive_reopening_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'accounts.db'
            first = auth.Store(sqlite_path=path)
            user = first.create_user('persisted', 'test-password')['id']
            runtime = A.Runtime(first, config.Settings())
            job = runtime.enqueue(user, 'replay')['job_id']; first.close()
            second = auth.Store(sqlite_path=path)
            try:
                restarted = A.Runtime(second, config.Settings())
                self.assertTrue(restarted.run_once())
                self.assertEqual(second._run('SELECT status FROM ai_jobs WHERE id=%s', (job,), 'one')[0], 'done')
            finally: second.close()

    def test_environment_validation_and_external_review_optin(self):
        s = config.load_settings('/nonexistent', {'AI_DAILY_BUDGET_USD': '.15', 'AI_EXTERNAL_REVIEW_ENABLED': 'true'})
        self.assertEqual(s.ai_daily_budget_usd, .15); self.assertTrue(s.ai_external_review_enabled)
        self.assertFalse(config.Settings().ai_external_review_enabled)
        for key, value in [('AI_DAILY_BUDGET_USD', 'nan'), ('AI_RETENTION_DAYS', '0'), ('AI_AUTO_PUBLISH', 'perhaps')]:
            with self.assertRaises(ValueError): config.load_settings('/nonexistent', {key: value})


class RuntimeHttpTests(unittest.TestCase):
    def setUp(self):
        self.store = auth.Store()
        self.users = {role: self.store.create_user(role + 'tester', 'test-password', role) for role in ('user', 'admin')}
        self.cookies = {role: 'norte_session=' + self.store.create_session(user['id']) for role, user in self.users.items()}
        self.runtime = A.Runtime(self.store, config.Settings())
        for name, value in [('STORE', self.store), ('AI_RUNTIME', self.runtime), ('SETTINGS', config.Settings())]:
            patcher = patch.object(server, name, value); patcher.start(); self.addCleanup(patcher.stop)
        server.AI_THROTTLE.hits.clear(); server.AI_ADMIN_THROTTLE.hits.clear()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join(); self.store.close()

    def call(self, path, body=None, role='user', extra=None):
        headers = {'Content-Type': 'application/json', **({'Cookie': self.cookies[role]} if role else {}), **(extra or {})}
        request = Request(f'http://127.0.0.1:{self.http.server_port}' + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(request) as response: return response.status, json.load(response)
        except HTTPError as error:
            with error: return error.code, json.load(error)

    def test_auth_roles_and_csrf_cover_new_routes(self):
        self.assertEqual(self.call('/api/ai/aliases', role=None)[0], 401)
        self.assertEqual(self.call('/api/admin/ai/overview')[0], 403)
        self.assertEqual(self.call('/api/admin/ai/replay', {})[0], 403)
        self.assertEqual(self.call('/api/ai/events', {'events': [event()]}, extra={'Origin': 'https://attacker.example'})[0], 403)
        self.assertEqual(self.call('/api/admin/ai/overview', role='admin')[0], 200)

    def test_contract_round_trip(self):
        self.assertEqual(self.call('/api/ai/events', {'events': [event()]})[1]['accepted'], 1)
        self.assertEqual(self.call('/api/ai/resolve', {'text': 'simula a viga'})[1]['intent'], A.INTENT)
        self.assertEqual(self.call('/api/ai/resolve', {'text': 'não simula a viga'})[1]['intent'], None)
        self.assertEqual(self.call('/api/ai/memory/query', {'query': 'viga', 'user_id': self.users['admin']['id']})[0], 400)
        self.assertEqual(self.call('/api/admin/ai/replay', {}, role='admin')[0], 200)
        while self.runtime.run_once(): pass
        overview = self.call('/api/admin/ai/overview', role='admin')[1]
        self.assertEqual(overview['metrics']['events'], 1)
        self.assertEqual(overview['evaluations'][0]['passed'], overview['evaluations'][0]['total'])
        self.assertEqual(self.call('/api/admin/ai/replay', {'cases': [{'text': 'something', 'expected_intent': 'delete_everything'}]}, role='admin')[0], 400)


if __name__ == '__main__': unittest.main()
