import copy
from pathlib import Path
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from provision_quetzal_demo import restore_source
from download_project_docs import digest

class ProvisionQuetzalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.body = b'Public engineering source fixture\n'
        self.source = {'id': 'quetzal-hardware-overview', 'role': 'project_context', 'redistribution': 'license-terms', 'source_url': 'https://raw.githubusercontent.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/pinned/README.md', 'path': 'originals/open-license/source.md', 'sha256': digest(self.body), 'text_path': 'extracted/open-license/quetzal-hardware-overview.txt', 'text_sha256': digest(self.body)}
    def tearDown(self):
        self.temp.cleanup()
    def test_restore_verified_files_and_repeat_offline(self):
        result = restore_source(self.root, self.source, lambda _: self.body)
        self.assertEqual(result['createdFiles'], 2)
        self.assertEqual((self.root / self.source['text_path']).read_bytes(), self.body)
        result = restore_source(self.root, self.source, lambda _: self.fail('must not fetch existing files'))
        self.assertEqual(result['status'], 'verified')
    def test_modified_existing_file_is_never_overwritten(self):
        target = self.root / self.source['path']; target.parent.mkdir(parents=True); target.write_bytes(b'local edits')
        with self.assertRaisesRegex(ValueError, 'refused to replace'):
            restore_source(self.root, self.source, lambda _: self.fail('must not fetch after detecting change'))
        self.assertEqual(target.read_bytes(), b'local edits')
    def test_wrong_original_or_text_hash_publishes_nothing(self):
        with self.assertRaisesRegex(ValueError, 'pinned revision'):
            restore_source(self.root, self.source, lambda _: b'publisher changed source')
        source = copy.deepcopy(self.source); source['text_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'pinned text'):
            restore_source(self.root, source, lambda _: self.body)
        self.assertFalse((self.root / self.source['path']).exists())
    def test_unknown_sources_external_paths_and_urls_rejected(self):
        for key, value in [('id', 'heldout-evaluation'), ('path', '../outside.txt'), ('source_url', 'https://localhost/document.pdf')]:
            source = dict(self.source); source[key] = value
            with self.assertRaises(ValueError): restore_source(self.root, source, lambda _: self.fail('must not fetch'))
if __name__ == '__main__': unittest.main()
