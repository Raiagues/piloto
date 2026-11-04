"""The comparison of minutes, checked by hand on a tiny case."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'compare_minutes', Path(__file__).resolve().parent / 'lyle/compare_minutes.py'
)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)
SOURCE = {
    'events': [
        {'event_id': 'E1', 'text': 'A carga de 550 kg não foi aprovada pela Diretoria.'},
        {'event_id': 'E2', 'text': 'Faltou o relatório.'},
    ]
}


def document(text, event='E1'):
    return {'topics': [{'entries': [{'event_id': event, 'text': text}]}]}


class ScoreTests(unittest.TestCase):
    def test_a_faithful_note_keeps_everything_it_cites(self):
        result = compare.score(SOURCE, document('Carga de 550 kg não aprovada pela Diretoria.'))
        self.assertEqual((result['numbers'], result['negations'], result['names'], result['sources']), (1, 1, 1, 1))
        self.assertEqual(result['facts'], 0.5)

    def test_a_lost_negation_number_and_name_are_counted(self):
        result = compare.score(SOURCE, document('A carga foi aprovada.'))
        self.assertEqual((result['numbers'], result['negations'], result['names']), (0, 0, 0))

    def test_an_invented_source_is_counted(self):
        self.assertEqual(compare.score(SOURCE, document('Nota.', 'E9'))['sources'], 0)

    def test_both_usage_shapes_give_tokens(self):
        self.assertEqual(compare.tokens({'input_tokens': 5, 'output_tokens': 2}), (5, 2))
        self.assertEqual(
            compare.tokens({'promptTokenCount': 5, 'candidatesTokenCount': 1, 'thoughtsTokenCount': 1}), (5, 2)
        )


if __name__ == '__main__':
    unittest.main()
