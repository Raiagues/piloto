"""Accounts, roles and per-account meeting records. No network beyond 127.0.0.1.

Set TEST_DATABASE_URL to also run the store contract against a real Postgres.
"""
import gzip
import json
import os
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

import auth
import config
import server


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


HTTP = build_opener(NoRedirect())


class StoreContract:
    def make_store(self): raise NotImplementedError

    def setUp(self):
        self.store = self.make_store()
        self.addCleanup(self.store.close)

    def test_passwords_sessions_and_admin_bootstrap(self):
        user = self.store.create_user('ana', 'senha-segura-1')
        with self.assertRaises(auth.AuthError) as error: self.store.create_user('ana', 'outra-senha-2')
        self.assertEqual(error.exception.status, 409)
        self.assertNotIn('senha-segura-1', self.store.find_user('ana')['password_hash'])
        self.assertIsNone(self.store.authenticate('ana', 'errada-123'))
        self.assertIsNone(self.store.authenticate('ninguem', 'senha-segura-1'))
        self.assertEqual(self.store.authenticate('ana', 'senha-segura-1')['id'], user['id'])
        token = self.store.create_session(user['id'])
        self.assertEqual(self.store.session_user(token)['username'], 'ana')
        self.assertIsNone(self.store.session_user(token + 'x'))
        self.store.delete_session(token)
        self.assertIsNone(self.store.session_user(token))

        admin_id = self.store.ensure_admin('chefe', 'admin-senha-1')
        admin_token = self.store.create_session(admin_id)
        self.assertEqual(self.store.session_user(admin_token)['role'], 'admin')
        self.store.ensure_admin('chefe', 'admin-senha-1')
        self.assertIsNotNone(self.store.session_user(admin_token), 'unchanged password keeps sessions')
        self.store.ensure_admin('chefe', 'admin-senha-2')
        self.assertIsNone(self.store.session_user(admin_token), 'a new password ends old admin sessions')
        self.assertIsNotNone(self.store.authenticate('chefe', 'admin-senha-2'))
        self.store.ensure_admin('ana', 'senha-segura-1')
        self.assertEqual(self.store.find_user('ana')['role'], 'admin')
        self.assertEqual(self.store.find_user('chefe')['role'], 'user', 'only the configured admin keeps the role')

    def test_records_are_private_and_versioned(self):
        a, b = self.store.create_user('ana', 'senha-segura-1'), self.store.create_user('bia', 'senha-segura-1')
        key = 'norte.meeting-room.index.v2'
        self.assertEqual(self.store.get_record(a['id'], key), (None, 0))
        self.assertEqual(self.store.put_record(a['id'], key, '[1]', 0), 1)
        self.assertIsNone(self.store.put_record(a['id'], key, '[2]', 0), 'create-if-absent fails when present')
        self.assertIsNone(self.store.put_record(a['id'], key, '[2]', 7))
        self.assertEqual(self.store.put_record(a['id'], key, '[2]', 1), 2)
        self.assertEqual(self.store.put_record(a['id'], key, '[3]'), 3)
        self.assertEqual(self.store.get_record(a['id'], key), ('[3]', 3))
        self.assertEqual(self.store.get_record(b['id'], key), (None, 0), 'another account never sees it')
        self.assertIsNone(self.store.put_record(a['id'], key, None, 1))
        self.assertEqual(self.store.put_record(a['id'], key, None, 3), 0)
        self.assertEqual(self.store.get_record(a['id'], key), (None, 0))


class SqliteStoreTests(StoreContract, unittest.TestCase):
    def make_store(self): return auth.Store()


@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'TEST_DATABASE_URL not set')
class PostgresStoreTests(StoreContract, unittest.TestCase):
    def make_store(self):
        store = auth.Store(os.environ['TEST_DATABASE_URL'])
        for table in ('norte_records', 'norte_sessions', 'norte_users'): store._run(f'DELETE FROM {table}')
        return store


class AccountHttpTests(unittest.TestCase):
    def setUp(self):
        self.store = auth.Store()
        self.store.ensure_admin('admin', 'admin-senha-1')
        for target, value in (('STORE', self.store), ('SETTINGS', config.Settings(api_key='fixture-only', allowed_hosts=('norte.example',)))):
            patcher = patch.object(server, target, value); patcher.start(); self.addCleanup(patcher.stop)
        for throttle in (server.LOGIN_THROTTLE, server.NETWORK_THROTTLE, server.SIGNUP_THROTTLE): throttle.hits.clear()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join(); self.store.close()

    def call(self, path, body=None, headers=None, method=None, raw=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        request = Request(self.base + path, data=data, method=method, headers={**({'Content-Type': 'application/json'} if data else {}), **(headers or {})})
        try:
            with HTTP.open(request) as response: return response.status, response.headers, response.read()
        except HTTPError as error:
            with error: return error.code, error.headers, error.read()

    def sign(self, action, username, password, **extra):
        status, headers, body = self.call('/api/auth/' + action, {'username': username, 'password': password, **extra})
        cookie = headers.get('Set-Cookie', '')
        return status, json.loads(body), {'Cookie': cookie.split(';')[0]} if cookie else {}

    def test_pages_require_an_account(self):
        status, headers, _ = self.call('/')
        self.assertEqual((status, headers['Location']), (302, '/login'))
        self.assertEqual(self.call('/lab.js')[0], 401)
        self.assertEqual(self.call('/api/auth/me')[0], 401)
        self.assertEqual(self.call('/api/classify', {'model': 'jev-latest'})[0], 401)
        status, _, body = self.call('/login')
        self.assertEqual(status, 200); self.assertIn(b'auth.js', body)
        self.assertEqual(json.loads(self.call('/api/health')[2]), {'app': 'norte', 'pid': os.getpid()})
        self.assertEqual(self.call('/healthz')[2], b'ok')

    def test_signup_login_logout_and_cookie_flags(self):
        status, body, session = self.sign('signup', ' Maria.Silva ', 'uma-senha-boa')
        self.assertEqual((status, body['user']), (200, {'username': 'maria.silva', 'role': 'user'}))
        self.assertEqual(self.sign('signup', 'maria.silva', 'uma-senha-boa')[0], 409)
        for name in ('admin', 'root'): self.assertEqual(self.sign('signup', name, 'uma-senha-boa')[0], 409)
        self.assertEqual(self.sign('signup', 'x', 'uma-senha-boa')[0], 400)
        self.assertEqual(self.sign('signup', 'joana', 'curta')[0], 400)
        self.assertEqual(json.loads(self.call('/api/auth/me', headers=session)[2])['user']['username'], 'maria.silva')
        status, headers, _ = self.call('/api/auth/login', {'username': 'maria.silva', 'password': 'uma-senha-boa'}, {'X-Forwarded-Proto': 'https'})
        cookie = headers['Set-Cookie']
        for flag in ('HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/'): self.assertIn(flag, cookie)
        self.assertEqual(self.sign('login', 'maria.silva', 'senha-errada')[0], 401)
        self.assertEqual(self.sign('login', 'nao-existe', 'senha-errada')[1]['error'], 'Usuário ou senha incorretos.')
        self.assertEqual(self.call('/login', headers=session)[0], 302)
        self.assertEqual(self.call('/api/auth/logout', {}, session)[0], 200)
        self.assertEqual(self.call('/api/auth/me', headers=session)[0], 401)

    def test_roles_decide_menu_and_admin_files(self):
        _, _, user = self.sign('signup', 'bruno', 'uma-senha-boa')
        _, body, admin = self.sign('login', 'ADMIN', 'admin-senha-1')
        self.assertEqual(body['user']['role'], 'admin')
        page = self.call('/', headers=user)[2].decode()
        self.assertIn('data-auth="on" data-role="user" data-username="bruno"', page)
        self.assertIn('account.js?v=', page)
        self.assertIn('data-role="admin"', self.call('/index.html', headers=admin)[2].decode())
        for path in ('/manual-test-example.json', '/tests/fixtures/typed-relations-b002.json'):
            self.assertEqual(self.call(path, headers=user)[0], 404)
            self.assertEqual(self.call(path, headers=admin)[0], 200)
        for path in ('/lab.js', '/meeting-room.js', '/beam-engine.js', '/remote-storage.js', '/classifier-config.json'):
            self.assertEqual(self.call(path, headers=user)[0], 200)
        health = json.loads(self.call('/api/health', headers=user)[2])
        self.assertTrue(health['ready']); self.assertNotIn('TYPESAFE', health['message'])

    def test_login_attempts_are_throttled(self):
        self.sign('signup', 'carla', 'uma-senha-boa')
        for _ in range(8): self.assertEqual(self.sign('login', 'carla', 'errada-123')[0], 401)
        status, body, _ = self.sign('login', 'carla', 'uma-senha-boa')
        self.assertEqual(status, 429)

    def test_signup_code_when_configured(self):
        with patch.object(server, 'SETTINGS', config.Settings(signup_code='convite-123')):
            self.assertTrue(json.loads(self.call('/api/auth/config')[2])['signup_code_required'])
            self.assertEqual(self.sign('signup', 'dani', 'uma-senha-boa')[0], 403)
            self.assertEqual(self.sign('signup', 'dani', 'uma-senha-boa', code='errado')[0], 403)
            self.assertEqual(self.sign('signup', 'dani', 'uma-senha-boa', code='convite-123')[0], 200)

    def test_host_and_origin_guards_cover_accounts(self):
        body = {'username': 'eva', 'password': 'uma-senha-boa'}
        self.assertEqual(self.call('/api/auth/signup', body, {'Origin': 'https://attacker.example'})[0], 403)
        self.assertEqual(self.call('/api/auth/signup', body, {'Host': 'attacker.example'})[0], 403)
        self.assertEqual(self.call('/api/auth/signup', body, {'Host': 'norte.example', 'Origin': 'https://norte.example'})[0], 200)

    def test_meeting_records_round_trip_with_gzip_and_conflicts(self):
        _, _, ana = self.sign('signup', 'ana', 'uma-senha-boa')
        _, _, bia = self.sign('signup', 'bia', 'uma-senha-boa')
        key = 'norte.meeting-room.session.v2.abc'
        snapshot = json.dumps({'id': 'abc', 'meeting_events': ['fala'] * 5000})
        packed = gzip.compress(json.dumps({'key': key, 'value': snapshot}).encode())
        status, _, body = self.call('/api/records', headers={**ana, 'Content-Encoding': 'gzip'}, raw=packed, method='POST')
        self.assertEqual((status, json.loads(body)), (200, {'version': 1}))
        self.assertEqual(json.loads(self.call('/api/records?key=' + key, headers=ana)[2]), {'value': snapshot, 'version': 1})
        self.assertEqual(json.loads(self.call('/api/records?key=' + key, headers=bia)[2]), {'value': None, 'version': 0})
        status, _, body = self.call('/api/records', {'key': key, 'value': 'novo', 'expected_version': 0}, ana)
        self.assertEqual(status, 409); self.assertEqual(json.loads(body)['version'], 1)
        self.assertEqual(self.call('/api/records', {'key': key, 'value': 'novo', 'expected_version': 1}, ana)[0], 200)
        self.assertEqual(self.call('/api/records', {'key': 'norte.lab.v1', 'value': 'x'}, ana)[0], 400)
        self.assertEqual(self.call('/api/records?key=norte.lab.v1', headers=ana)[0], 400)
        self.assertEqual(self.call('/api/records', {'key': key, 'value': 'x'})[0], 401)
        bomb = gzip.compress(json.dumps({'key': key, 'value': ' ' * (server.MAX_RECORD_REQUEST + 10)}).encode())
        self.assertEqual(self.call('/api/records', headers={**ana, 'Content-Encoding': 'gzip'}, raw=bomb, method='POST')[0], 413)

    def test_each_account_has_its_own_processing_lanes(self):
        _, _, ana = self.sign('signup', 'ana', 'uma-senha-boa')
        _, _, bia = self.sign('signup', 'bia', 'uma-senha-boa')
        body = {'model': 'jev-latest', 'state': 'Teste', 'questions': {'q': {'type': 'noul', 'instructions': 'Is it a test?'}}}
        ana_id = self.store.find_user('ana')['id']
        with patch.object(server, 'classify', side_effect=lambda b, settings: {'request': b}):
            lane = server.lanes_for(ana_id)['classify']; lane.acquire()
            try:
                self.assertEqual(self.call('/api/classify', body, ana)[0], 429)
                self.assertEqual(self.call('/api/classify', body, bia)[0], 200)
            finally: lane.release()


class SettingsTests(unittest.TestCase):
    def test_render_hostname_and_account_settings(self):
        settings = config.load_settings('/nonexistent', {'RENDER_EXTERNAL_HOSTNAME': 'norte.onrender.com', 'ALLOWED_HOSTS': 'Norte.com.br, www.norte.com.br',
                                                         'ADMIN_USERNAME': 'chefe', 'ADMIN_PASSWORD': 'x' * 12, 'DATABASE_URL': 'postgres://u:p@h/db'})
        self.assertEqual(settings.allowed_hosts, ('norte.com.br', 'www.norte.com.br', 'norte.onrender.com'))
        self.assertEqual((settings.admin_username, settings.database_url), ('chefe', 'postgres://u:p@h/db'))
        self.assertNotIn('x' * 12, repr(settings)); self.assertNotIn('u:p@h', repr(settings))
        self.assertEqual(config.load_settings('/nonexistent', {}).admin_username, 'admin')


if __name__ == '__main__': unittest.main()
