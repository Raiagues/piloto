"""The refinement script must never carry words of one meeting into a question."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'refine', Path(__file__).resolve().parents[1] / 'scripts/refine_highlight_questions.py'
)
refine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refine)
SENTENCE = 'a seleção do propelente está concluída'


class LeakTests(unittest.TestCase):
    def test_general_wording_passes(self):
        self.assertFalse(
            refine.leaks(
                {'instructions': 'Is a choice reported as finished?', 'true': 'Yes.', 'false': 'No.'}, [SENTENCE]
            )
        )

    def test_four_words_of_the_meeting_are_refused(self):
        self.assertTrue(
            refine.leaks(
                {'instructions': 'Example: seleção do propelente está pronta', 'true': 'Yes.', 'false': 'No.'},
                [SENTENCE],
            )
        )


if __name__ == '__main__':
    unittest.main()
