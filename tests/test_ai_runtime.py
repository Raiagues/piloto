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

from meetings.engine import ai_runtime as A
import auth
import config
import server


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.store = auth.Store()
        self.user = self.store.create_user('tester', 'test-password')['id']
        self.other = self.store.create_user('other', 'test-password')['id']
        self.runtime = A.Runtime(self.store, config.Settings())

    def tearDown(self):
        self.runtime.stop(); self.store.close()


    def test_external_context_retrieval_is_not_available(self):
        self.assertFalse(hasattr(self.runtime, 'memory'))


    def test_queue_recovers_expired_lease_and_bounds_retries(self):
        job = self.runtime.enqueue(self.user, 'blocks')['job_id']
        claimed = self.runtime.claim()
        self.assertEqual(claimed[0], job)
        self.store._run('UPDATE ai_jobs SET lease_until=0 WHERE id=%s', (job,))
        with patch.object(self.runtime.blocks, 'process', return_value={'status': 'ready'}): self.assertTrue(self.runtime.run_once())
        self.assertEqual(self.store._run('SELECT status,attempts FROM ai_jobs WHERE id=%s', (job,), 'one'), ('done', 2))
        job = self.runtime.enqueue(self.user, 'blocks')['job_id']
        with patch.object(self.runtime.blocks, 'process', side_effect=RuntimeError('no secret body')):
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
        price = self.runtime.record_usage(self.user, 'gemini', self.runtime.settings.ai_agent_model, 'blocks', response, 90)
        self.assertAlmostEqual(price, (100 * .3 + 15 * 2.5) / 1000000)
        self.assertIsNone(self.runtime.record_usage(self.user, 'gemini', 'gemini-3.1-pro-preview', 'minutes', response, 90))
        self.assertEqual(self.store._run('SELECT COUNT(*) FROM ai_usage WHERE cost_usd IS NULL', fetch='one')[0], 2)
        self.assertEqual(self.store._run('SELECT SUM(output_tokens) FROM ai_usage', fetch='one')[0], 30)

    def test_free_output_tariff_can_price_measured_input_without_inventing_output_tokens(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, jev_input_usd_per_million=.042, jev_output_usd_per_million=0)
        cost = self.runtime.record_usage(self.user, 'jev', 'jev-latest', 'classify', {'usage': {'input_tokens': 1000}}, 40)
        self.assertAlmostEqual(cost, .000042)
        self.assertEqual(self.store._run('SELECT output_tokens FROM ai_usage', fetch='one')[0], None)

    def test_minutes_price_is_independent_of_agent_price_even_for_same_model(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings,
            gemini_model=self.runtime.settings.ai_agent_model,
            minutes_input_usd_per_million=.75, minutes_output_usd_per_million=3.75,
            ai_gemini_input_usd_per_million=.3, ai_gemini_output_usd_per_million=2.5)
        response = {'usageMetadata': {'promptTokenCount': 20000, 'candidatesTokenCount': 4000, 'thoughtsTokenCount': 1000}}
        cost = self.runtime.record_usage(self.user, 'gemini', self.runtime.settings.gemini_model, 'minutes', response, 30)
        self.assertAlmostEqual(cost, .03375)
        unknown = self.runtime.record_usage(self.user, 'gemini', 'gemini-other-model', 'minutes', response, 30)
        self.assertIsNone(unknown)

    def test_minutes_limit_is_atomic_separate_from_agents_and_resets_next_utc_day(self):
        self.runtime.settings = dataclasses.replace(self.runtime.settings, minutes_daily_call_limit=2)
        results = []
        with patch.object(A.time, 'strftime', return_value='2026-10-15'):
            threads = [threading.Thread(target=lambda: results.append(self.runtime.reserve_minutes_call())) for _ in range(8)]
            for thread in threads: thread.start()
            for thread in threads: thread.join()
            self.assertEqual(sum(results), 2)
            self.assertIsNotNone(self.runtime.reserve_budget(.01))
            restarted = A.Runtime(self.store, self.runtime.settings)
            self.assertFalse(restarted.reserve_minutes_call())
        with patch.object(A.time, 'strftime', return_value='2026-10-16'):
            self.assertTrue(self.runtime.reserve_minutes_call())
        self.runtime.settings = dataclasses.replace(self.runtime.settings, minutes_daily_call_limit=0)
        self.assertFalse(self.runtime.reserve_minutes_call())


    def test_schema_and_queue_survive_reopening_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'accounts.db'
            first = auth.Store(sqlite_path=path)
            user = first.create_user('persisted', 'test-password')['id']
            runtime = A.Runtime(first, config.Settings())
            job = runtime.enqueue(user, 'blocks')['job_id']; first.close()
            second = auth.Store(sqlite_path=path)
            try:
                restarted = A.Runtime(second, config.Settings())
                with patch.object(restarted.blocks, 'process', return_value={'status': 'ready'}): self.assertTrue(restarted.run_once())
                self.assertEqual(second._run('SELECT status FROM ai_jobs WHERE id=%s', (job,), 'one')[0], 'done')
            finally: second.close()

    def test_environment_validation_and_external_review_optin(self):
        s = config.load_settings('/nonexistent', {'AI_DAILY_BUDGET_USD': '.15', 'AI_EXTERNAL_REVIEW_ENABLED': 'true'})
        self.assertEqual(s.ai_daily_budget_usd, .15); self.assertTrue(s.ai_external_review_enabled)
        self.assertFalse(config.Settings().ai_external_review_enabled)
        for key, value in [('AI_DAILY_BUDGET_USD', 'nan'), ('AI_RETENTION_DAYS', '0'), ('AI_AUTO_PUBLISH', 'perhaps'),
                           ('MINUTES_DAILY_CALL_LIMIT', '-1'), ('MINUTES_DAILY_CALL_LIMIT', '1.5'),
                           ('MINUTES_INPUT_USD_PER_MILLION', 'nan'), ('MINUTES_OUTPUT_USD_PER_MILLION', '-1')]:
            with self.assertRaises(ValueError): config.load_settings('/nonexistent', {key: value})

    def test_retired_jobs_and_historical_tables_are_left_untouched(self):
        self.store._run('CREATE TABLE ai_aliases (id TEXT PRIMARY KEY, evidence TEXT)')
        self.store._run("INSERT INTO ai_aliases VALUES ('legacy','original evidence')")
        job = self.runtime.enqueue(self.user, 'blocks')['job_id']
        self.store._run("UPDATE ai_jobs SET kind='audit', updated_at=1 WHERE id=%s", (job,))
        with patch.object(A.AI_HTTP, 'open') as provider:
            restarted = A.Runtime(self.store, self.runtime.settings)
            self.assertFalse(restarted.run_once()); restarted.prune()
            provider.assert_not_called()
        self.assertEqual(self.store._run('SELECT evidence FROM ai_aliases', fetch='one')[0], 'original evidence')
        self.assertEqual(self.store._run('SELECT kind,status,attempts FROM ai_jobs WHERE id=%s', (job,), 'one'), ('audit', 'queued', 0))
        for kind in ('audit', 'replay', 'metrics'):
            with self.assertRaises(ValueError): self.runtime.enqueue(self.user, kind)
        for name in ('resolve', 'aliases', 'audit', 'ask_model', 'evaluate', 'memory'):
            self.assertFalse(hasattr(self.runtime, name))


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
            with error:
                raw = error.read()
                try: body = json.loads(raw)
                except ValueError: body = {}
                return error.code, body

    def test_auth_roles_and_csrf_cover_active_routes(self):
        self.assertEqual(self.call('/api/ai/blocks/review', {'session_id': 's1'}, role=None)[0], 401)
        self.assertEqual(self.call('/api/ai/blocks/feedback', {}, extra={'Origin': 'https://attacker.example'})[0], 403)
        self.assertEqual(self.call('/api/ai/blocks/review', {'session_id': 's1', 'user_id': 2})[0], 400)

    def test_retired_navigation_and_external_context_routes_are_unavailable(self):
        with patch.object(A.AI_HTTP, 'open') as provider:
            for path, body in [('/api/ai/aliases', None), ('/api/admin/ai/overview', None), ('/api/ai/events', {}),
                               ('/api/ai/resolve', {}), ('/api/ai/memory/query', {}), ('/api/admin/ai/replay', {}),
                               ('/api/admin/ai/run', {}), ('/api/admin/ai/aliases', {}), ('/api/admin/ai/blocks/memory', {})]:
                with self.subTest(path=path): self.assertEqual(self.call(path, body, role='admin')[0], 404)
            provider.assert_not_called()

    def test_blocks_read_only_own_saved_meeting(self):
        run = {'meeting_events': [{'event_id': 'E1', 'thread_id': 'T1', 'text': 'Um registro.', 'type': 'decision'}], 'meeting_threads': [{'thread_id': 'T1'}]}
        self.store.put_record(self.users['user']['id'], 'norte.meeting-room.session.v2.s1', json.dumps(run))
        status, result = self.call('/api/ai/blocks/review', {'session_id': 's1'})
        self.assertEqual(status, 200); self.assertEqual(result['status'], 'disabled')
        self.assertEqual(self.call('/api/ai/blocks/review', {'session_id': 's1'}, role='admin')[0], 400)


if __name__ == '__main__': unittest.main()
