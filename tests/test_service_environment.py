"""Entrypoint persistence guard, using only an isolated temporary environment."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('norte_service_environment_test', ROOT / 'scripts' / 'service.py')
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class ServiceEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / '.runtime'
        self.runtime.mkdir()
        for replacement in (patch.object(service, 'ROOT', self.root), patch.object(service, 'RUNTIME', self.runtime), patch.dict(os.environ, {}, clear=True)):
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_render_requires_database_even_with_explicit_file_store(self):
        for database in ('', '   '):
            with self.subTest(database=database), patch.dict(os.environ, {'RENDER': 'true', 'DATABASE_URL': database, 'NORTE_STORE_FILE': str(self.runtime / 'state.json')}):
                with self.assertRaisesRegex(SystemExit, 'DATABASE_URL.*Render'):
                    service.environment()
                self.assertEqual(list(self.runtime.iterdir()), [], 'invalid hosted configuration must fail before creating local secrets or state')

    def test_render_database_uses_injected_values_without_local_fallback(self):
        (self.root / '.env').write_text('DATABASE_URL=postgresql://local-fixture/ignored\n', encoding='utf-8')
        injected = {'RENDER': 'true', 'DATABASE_URL': 'postgresql://isolated-fixture/norte', 'NORTE_MEETING_BRIDGE_SECRET': 'isolated-fixture-bridge-secret-at-least-32-characters'}
        with patch.dict(os.environ, injected):
            result = service.environment()
        self.assertEqual(result['DATABASE_URL'], injected['DATABASE_URL'])
        self.assertNotIn('NORTE_STORE_FILE', result)
        self.assertEqual(list(self.runtime.iterdir()), [])

    def test_local_development_keeps_file_fallback_and_persistent_secret(self):
        first = service.environment()
        self.assertEqual(first['NORTE_STORE_FILE'], str(self.runtime / 'norte-data.json'))
        self.assertGreaterEqual(len(first['NORTE_MEETING_BRIDGE_SECRET']), 32)
        self.assertEqual(service.environment()['NORTE_MEETING_BRIDGE_SECRET'], first['NORTE_MEETING_BRIDGE_SECRET'])
        self.assertEqual((self.runtime / 'meeting-bridge.key').stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
