"""Official transport tests: mocked remote, isolated files, no real keys or charges."""
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import config
import server
from support import signed_in

ROOT = Path(__file__).resolve().parents[1]
FAKE_KEY = 'test-only-not-a-real-api-key'


def fixture_response(body):
    answers = {}
    for key, q in body['questions'].items():
        if q['type'] == 'noul': answers[key] = {'type': 'noul', 'noul': .8}
        else:
            keys = list(q['criteria']) if q['type'] == 'choice' else list(map(str, range(len(q['criteria']))))
            answer = {'type': q['type'], 'probabilities': {key: 1.0 if i == 0 else 0.0 for i, key in enumerate(keys)}, 'confidence': 1}
            if q['type'] == 'choice': answer['choice'] = keys[0]
            else: answer.update({'score': 0, 'legend': dict(enumerate(q['criteria']))})
            answers[key] = answer
    return {'model': 'jev-official-test-double', 'answers': answers, 'usage': {'input_tokens': 0, 'output_tokens': 0}}


def reply(body):
    response = io.BytesIO(json.dumps(body).encode())
    response.headers = {}
    return response


class ConfigTests(unittest.TestCase):
    def test_aliases_defaults_and_environment_priority_without_secret_repr(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / '.env'
            self.assertEqual(config.load_settings(path, {}).provider, 'official')
            for alias in ('TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API'):
                path.write_text(f'# private\n{alias}="{FAKE_KEY}"\n', encoding='utf8')
                settings = config.load_settings(path, {})
                self.assertEqual(settings.api_key, FAKE_KEY)
                self.assertNotIn(FAKE_KEY, repr(settings))
                self.assertEqual(config.load_settings(path, {'TYPESAFE_API_KEY': 'override'}).api_key, 'override')
            original = path.read_bytes()
            config.load_settings(path, {})
            self.assertEqual(path.read_bytes(), original)
            path.write_text('NORTE_PROVIDER=invalid\n')
            with self.assertRaisesRegex(ValueError, 'NORTE_PROVIDER'): config.load_settings(path, {})
            path.write_text('TYPESAFE_API_KEY=private value\n')
            with self.assertRaises(ValueError) as error: config.load_settings(path, {})
            self.assertNotIn('private value', str(error.exception))

    def test_official_setup_never_installs_local_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / '.env.example').write_text('NORTE_PROVIDER=official\nTYPESAFE_API_KEY=\n')
            with patch.object(config, 'ROOT', root), patch.object(config, 'load_settings', return_value=config.Settings()), patch.object(config.subprocess, 'run') as install, patch('builtins.print'):
                config.setup()
                install.assert_not_called()
                self.assertEqual((root / '.env').stat().st_mode & 0o777, 0o600)
                (root / '.env').write_text('JEV_KEY_API=' + FAKE_KEY)
                config.setup()
                self.assertEqual((root / '.env').read_text(), 'JEV_KEY_API=' + FAKE_KEY)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.body = json.loads((ROOT / 'manual-test-example.json').read_text())
        self.body = {key: self.body[key] for key in ('model', 'state', 'questions')}
        self.settings = config.Settings(api_key=FAKE_KEY)

    def test_official_exact_payload_criteria_auth_and_provenance(self):
        with patch.object(server.OFFICIAL_HTTP, 'open', return_value=reply(fixture_response(self.body))) as send, patch.object(server, 'urlopen') as local:
            result = server.classify(self.body, self.settings)
        sent = send.call_args.args[0]
        self.assertEqual(sent.full_url, 'https://api.typesafe.ai/v1/systemone')
        self.assertEqual(sent.get_header('Authorization'), 'Bearer ' + FAKE_KEY)
        self.assertEqual(json.loads(sent.data), self.body)
        self.assertEqual(result['request'], self.body)
        self.assertEqual(result['provider'], 'official')
        self.assertNotIn('requestAdapter', result)
        self.assertNotIn('effectiveRequest', result)
        self.assertNotIn(FAKE_KEY, json.dumps(result))
        self.assertEqual(len(result['response']['answers']), 11)
        self.assertEqual(send.call_count, 1)
        local.assert_not_called()

    def test_missing_key_never_calls_any_provider(self):
        with patch.object(server.OFFICIAL_HTTP, 'open') as send, patch.object(server, 'urlopen') as local:
            with self.assertRaises(server.ProviderError) as error: server.classify(self.body, config.Settings())
            self.assertEqual(error.exception.status, 503)
            send.assert_not_called(); local.assert_not_called()

    def test_errors_do_not_retry_fallback_or_echo_private_payload(self):
        failures = [HTTPError(server.OFFICIAL_URL, code, FAKE_KEY, {}, io.BytesIO(FAKE_KEY.encode())) for code in (301, 401, 402, 403, 422, 429, 529)]
        failures += [URLError(FAKE_KEY), TimeoutError(FAKE_KEY)]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch.object(server.OFFICIAL_HTTP, 'open', side_effect=failure) as send, patch.object(server, 'urlopen') as local:
                with self.assertRaises(server.ProviderError) as error: server.classify(self.body, self.settings)
                self.assertNotIn(FAKE_KEY, str(error.exception))
                self.assertEqual(send.call_count, 1)
                local.assert_not_called()
        self.assertIsNone(server.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://another.example'))

    def test_malformed_response_is_rejected(self):
        for value in (None, [], {'model': 'jev-latest', 'answers': {}}, {'model': 'jev-latest', 'answers': []}):
            with patch.object(server.OFFICIAL_HTTP, 'open', return_value=reply(value)):
                with self.assertRaises(server.ProviderError): server.classify(self.body, self.settings)

    def test_local_path_stays_explicit_and_does_not_send_credentials(self):
        with patch.object(server, 'urlopen', return_value=reply(fixture_response(self.body))) as local, patch.object(server.OFFICIAL_HTTP, 'open') as official:
            result = server.classify(self.body, config.Settings(provider='local', api_key=FAKE_KEY), 'http://127.0.0.1:12345')
        sent = local.call_args.args[0]
        self.assertIsNone(sent.get_header('Authorization'))
        self.assertEqual(result['provider'], 'local')
        self.assertEqual(result['requestAdapter'], 'jevos-noul-criteria-v1')
        official.assert_not_called()


class QuietHandler(server.Handler):
    def log_message(self, *args): pass


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.settings_patch = patch.object(server, 'SETTINGS', config.Settings(api_key=FAKE_KEY))
        self.settings_patch.start()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'
        self.user_id, self.auth = signed_in(self, role='admin')
        self.body = json.loads((ROOT / 'manual-test-example.json').read_text())
        self.body = {key: self.body[key] for key in ('model', 'state', 'questions')}

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join(); self.settings_patch.stop()

    def test_health_does_not_call_remote_or_expose_key(self):
        with patch.object(server.OFFICIAL_HTTP, 'open') as remote:
            with urlopen(Request(self.base + '/api/health', headers=self.auth)) as response: result = json.load(response)
        self.assertTrue(result['ready']); self.assertFalse(result['verified'])
        self.assertEqual(result['provider'], 'official')
        self.assertNotIn(FAKE_KEY, json.dumps(result))
        remote.assert_not_called()

    def test_ui_assets_share_a_release_and_never_store_in_browser_cache(self):
        import re
        html = (ROOT / 'index.html').read_text()
        assets = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css)\?v=[^\"]+)"', html)
        self.assertGreaterEqual(len(assets), 13)
        self.assertTrue({'meeting-room.js', 'meeting-canvas.css', 'meeting-room.css'}.issubset({asset.split('?')[0] for asset in assets}))
        self.assertEqual(len({asset.split('?v=')[1] for asset in assets}), 1)
        with patch.object(server.OFFICIAL_HTTP, 'open') as remote:
            for path in ['/', '/index.html', '/styles.css', '/lab.js', *['/' + asset for asset in assets]]:
                for method in ('GET', 'HEAD'):
                    with self.subTest(path=path, method=method), urlopen(Request(self.base + path, method=method, headers=self.auth)) as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.headers.get('Cache-Control'), 'no-store')
                        if method == 'GET':
                            filename = 'index.html' if path == '/' else path[1:].split('?')[0]
                            body = response.read()
                            if filename != 'index.html': self.assertEqual(body, (ROOT / filename).read_bytes())
                            else:
                                # The account layer adds role data and its own assets, on the same release.
                                served = body.decode()
                                self.assertIn('data-auth="on" data-role="admin"', served)
                                self.assertEqual(len(set(re.findall(r'\?v=([\w-]+)', served))), 1)
                                self.assertTrue({'account.js', 'account.css'}.issubset(set(re.findall(r'(?:src|href)="([\w.-]+)\?v=', served))))
            remote.assert_not_called()

    def test_private_files_blocked_on_get_and_head(self):
        for method in ('GET', 'HEAD'):
            for path in ('/.env', '/.env.example', '/config.py', '/server.py', '/%2eenv', '/foo/../.env', '/.runtime/server.log'):
                with self.subTest(method=method, path=path), self.assertRaises(HTTPError) as error:
                    urlopen(Request(self.base + path, method=method))
                self.assertEqual(error.exception.code, 404)

    def test_origin_host_content_type_and_provider_gate_remote_calls(self):
        for headers, code in [({'Origin': 'https://attacker.example'}, 403), ({'Host': 'attacker.example'}, 403), ({'Content-Type': 'text/plain'}, 415), ({'X-Norte-Provider': 'local'}, 409)]:
            with patch.object(server.OFFICIAL_HTTP, 'open') as remote:
                request = Request(self.base + '/api/classify', data=json.dumps(self.body).encode(), headers={'Content-Type': 'application/json', **self.auth, **headers})
                with self.assertRaises(HTTPError) as error: urlopen(request)
                self.assertEqual(error.exception.code, code)
                remote.assert_not_called()

    def test_proxy_forwards_official_json_once(self):
        with patch.object(server.OFFICIAL_HTTP, 'open', return_value=reply(fixture_response(self.body))) as remote:
            request = Request(self.base + '/api/classify', data=json.dumps(self.body).encode(), headers={'Content-Type': 'application/json', 'X-Norte-Provider': 'official', **self.auth})
            with urlopen(request) as response: result = json.load(response)
        self.assertEqual(result['provider'], 'official')
        self.assertEqual(result['request'], self.body)
        self.assertEqual(remote.call_count, 1)


if __name__ == '__main__': unittest.main()
