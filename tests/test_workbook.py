"""Read-only regression checks against the user's original Jev workbook."""
import json
from pathlib import Path
import subprocess
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / 'jev_results_tracker_tests_002_to_007.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def rows(book, number):
    root = ET.fromstring(book.read(f'xl/worksheets/sheet{number}.xml'))
    return [{''.join(filter(str.isalpha, cell.attrib['r'])): ''.join(cell.itertext())
             for cell in row} for row in root.findall('.//m:sheetData/m:row', NS)]


@unittest.skipUnless(BOOK.exists(), 'Original user workbook not available')
class WorkbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.example = json.loads((ROOT / 'manual-test-example.json').read_text())
        cls.options = json.loads(subprocess.check_output([
            'node', '-e', "console.log(JSON.stringify(require('./automation.js').exampleOptions(require('./manual-test-example.json').questions)))"
        ], cwd=ROOT, text=True))

    def test_all_questions_match_workbook_v2_exactly(self):
        with zipfile.ZipFile(BOOK) as book:
            for number in range(5, 12):
                questions = [r for r in rows(book, number) if r.get('B') in ('noul', 'choice', 'score') and 'D' in r and 'E' not in r]
                self.assertEqual(len(questions), 11)
                for row in questions:
                    q = self.example['questions'][row['A']]
                    self.assertEqual(q['type'], row['B'])
                    self.assertEqual(q['instructions'], row['C'])
                    entries = enumerate(q['criteria']) if isinstance(q['criteria'], list) else q['criteria'].items()
                    criteria = ' '.join(f'{str(k).upper() if q["type"] == "noul" else k}: {v}' for k, v in entries)
                    self.assertEqual(criteria, row['D'], row['A'])

    def test_labels_and_full_state_match_workbook(self):
        with zipfile.ZipFile(BOOK) as book:
            cases = [r for r in rows(book, 2) if r.get('D') == 'v2' and r.get('G', '').startswith('{')]
            self.assertEqual(len(cases), 7)
            for index, number in enumerate(range(5, 12)):
                state = self.example['state'] if index == 0 else {**self.example['state'], 'current_utterance': self.options[index-1]['text']}
                self.assertEqual(state, json.loads(cases[index]['G']))
                expected = self.example['expected'] if index == 0 else self.options[index-1]['expected']
                results = [r for r in rows(book, number) if r.get('B') in ('noul', 'choice', 'score') and 'J' in r]
                self.assertEqual(len(results), 11)
                for row in results:
                    value = expected[row['A']]['value']
                    self.assertEqual(str(value).lower() if isinstance(value, bool) else str(value), row['C'])
                    self.assertGreater(expected[row['A']]['minProbability'], 0)


if __name__ == '__main__':
    unittest.main()
