"""Dedicated meeting assets retain authenticated GET/HEAD and private API contracts."""
import json
import hashlib
import hmac
import os
import time
from pathlib import Path
import re
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import config
import server
from support import signed_in


class MeetingAssetsTests(unittest.TestCase):
    def setUp(self):
        self.settings = patch.object(server, 'SETTINGS', config.Settings(api_key='fixture-only'))
        self.settings.start()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True); self.worker.start()
        self.base = 'http://127.0.0.1:' + str(self.http.server_port)
        self.user, self.headers = signed_in(self, role='admin')

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.worker.join(); self.settings.stop()

    def test_new_entry_has_no_laboratory_and_loads_styles_before_body(self):
        with urlopen(Request(self.base + '/', headers=self.headers)) as response:
            html = response.read().decode(); self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn('data-page="meeting" data-auth="on" data-role="admin"', html)
        self.assertNotIn('id="memoryPage"', html); self.assertNotIn('id="workspacePanels"', html)
        for sheet in ['tokens.css', 'base.css', 'meeting-room.css', 'norte-meeting-bridge.css']:
            self.assertLess(html.index(sheet), html.index('<body'))

    def test_every_declared_asset_supports_get_and_head(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / 'meetings/web/index.html').read_text()
        assets = re.findall(r'(?:src|href)="([^"?]+\.(?:js|css))"', html)
        for asset in assets:
            for method in ['GET', 'HEAD']:
                with self.subTest(asset=asset, method=method), urlopen(Request(self.base + '/' + asset, headers=self.headers, method=method)) as response:
                    self.assertEqual(response.status, 200); self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    if method == 'GET': self.assertEqual(response.read(), (root / 'norte/src/styles/tokens.css' if asset == 'tokens.css' else root / 'meetings/web' / asset).read_bytes())

    def test_api_health_and_private_files_keep_their_boundary(self):
        with patch.object(server.OFFICIAL_HTTP, 'open') as provider:
            with urlopen(Request(self.base + '/api/health', headers=self.headers)) as response: self.assertTrue(json.load(response)['ready'])
            provider.assert_not_called()
        for name in ['server.py', '.env', '../.env', 'meetings/engine/meeting_learning.py', 'lab.js', 'beam-engine.js']:
            for method in ['GET', 'HEAD']:
                with self.subTest(name=name, method=method), self.assertRaises(HTTPError) as error: urlopen(Request(self.base + '/' + name, headers=self.headers, method=method))
                self.assertEqual(error.exception.code, 404)

    def test_signed_gateway_requests_keep_meeting_storage_isolation(self):
        secret = 'isolated-test-bridge-secret-' * 2
        def request(method, path, scope, value=None):
            raw = json.dumps(value).encode() if value is not None else b''
            stamp = str(int(time.time()))
            canonical = '\n'.join((method, path, 'norte-user', scope, 'user', stamp, hashlib.sha256(raw).hexdigest()))
            headers = {'Content-Type': 'application/json', 'X-Norte-Bridge-User': 'norte-user', 'X-Norte-Bridge-Scope': scope,
                       'X-Norte-Bridge-Role': 'user', 'X-Norte-Bridge-Time': stamp,
                       'X-Norte-Bridge-Signature': hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()}
            with urlopen(Request(self.base + path, data=raw if method == 'POST' else None, method=method, headers=headers)) as response:
                return json.load(response)
        with patch.dict(os.environ, {'NORTE_BRIDGE_ONLY': '1', 'NORTE_MEETING_BRIDGE_SECRET': secret}), patch.object(server.OFFICIAL_HTTP, 'open') as provider:
            key = 'norte.meeting-room.session.v2.same-key'
            self.assertEqual(request('POST', '/api/records', 'meeting:one', {'key': key, 'value': 'original transcript', 'expected_version': 0})['version'], 1)
            self.assertEqual(request('GET', '/api/records?key=' + key, 'meeting:one')['value'], 'original transcript')
            self.assertIsNone(request('GET', '/api/records?key=' + key, 'meeting:two')['value'])
            with self.assertRaises(HTTPError) as error: urlopen(Request(self.base + '/api/records?key=' + key, headers=self.headers))
            self.assertEqual(error.exception.code, 401)
            provider.assert_not_called()
