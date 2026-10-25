"""Bootstrap checks never contact providers or install models."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('prepare_tools', Path(__file__).parents[1] / 'scripts/prepare_local.py')
TOOLS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOLS)


class PrepareToolsTests(unittest.TestCase):
    def test_check_never_downloads_or_spawns_missing_runtime(self):
        with patch.object(TOOLS, 'node_version', return_value=None), patch.object(TOOLS, 'download') as download:
            self.assertEqual(TOOLS.node_status(False)['state'], 'missing')
            download.assert_not_called()

    def test_supported_system_runtime_avoids_download(self):
        with patch.object(TOOLS, 'node_version', return_value='24.20.0'), patch.object(TOOLS, 'download') as download:
            self.assertEqual(TOOLS.node_status(True)['source'], 'system')
            download.assert_not_called()

    def test_wrong_checksum_discards_archive_without_extracting_or_running(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            asset = {'node': {'dir': '.runtime/tools/node', 'url': 'https://example.test/node.tar.xz', 'shasums': 'https://example.test/SHASUMS256.txt'}}
            def download(url, target):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(('0' * 64 + '  node.tar.xz\n').encode() if 'SHASUMS' in url else b'corrupt archive')
            with patch.object(TOOLS, 'ROOT', root), patch.object(TOOLS, 'ASSETS', asset), patch.object(TOOLS, 'node_version', return_value=None), patch.object(TOOLS.platform, 'system', return_value='Linux'), patch.object(TOOLS.platform, 'machine', return_value='x86_64'), patch.object(TOOLS, 'download', side_effect=download), patch.object(TOOLS.tarfile, 'open') as extract:
                with self.assertRaisesRegex(ValueError, 'Checksum'):
                    TOOLS.node_status(True)
                extract.assert_not_called()
                self.assertFalse((root / '.runtime/tools/node.tar.xz').exists())


if __name__ == '__main__':
    unittest.main()
