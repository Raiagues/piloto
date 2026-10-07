import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('norte_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.body = {**json.loads((ROOT / 'classifier-config.json').read_text()), 'state': 'Precisamos registrar temperatura.'}

    def test_real_default_request_validates(self):
        server.validate_request(self.body)
        self.assertEqual(server.engine_request(self.body), self.body)

    def test_full_prototype_and_noul_adapter_preserve_original(self):
        body = json.loads((ROOT / 'manual-test-example.json').read_text())
        body = {key: body[key] for key in ('model', 'state', 'questions')}
        original = copy.deepcopy(body)
        server.validate_request(body)
        effective = server.engine_request(body)
        self.assertEqual(body, original)
        self.assertEqual(effective['state'], body['state'])
        self.assertEqual(len(effective['questions']), 11)
        for key, q in body['questions'].items():
            adapted = effective['questions'][key]
            if q['type'] == 'noul':
                self.assertNotIn('criteria', adapted)
                self.assertTrue(adapted['instructions'].startswith(q['instructions']))
                for label in ('true', 'false'):
                    self.assertIn(f'Answer {label} when: ' + q['criteria'][label], adapted['instructions'])
            else: self.assertEqual(adapted, q)
        effective['state']['recent_context'].append('Not in original')
        self.assertEqual(body, original)

    def test_structured_state_and_noul_criteria_validation(self):
        for state in ({'context': ['earlier'], 'current': 'now'}, ['one', 'two']):
            server.validate_request({**self.body, 'state': state})
        for state in ({}, [], None, True, 42, {'x': float('nan')}, {'x': 'a' * 16000}):
            with self.assertRaises(ValueError): server.validate_request({**self.body, 'state': state})
        state = {'x': 1}
        for _ in range(17): state = {'x': state}
        with self.assertRaises(ValueError): server.validate_state(state)
        for criteria in ({}, [], {'yes': 'wrong'}, {'true': True}, {'false': 'a' * 801}):
            q = {'q': {'type': 'noul', 'instructions': 'Question?', 'criteria': criteria}}
            with self.assertRaises(ValueError): server.validate_request({**self.body, 'questions': q})
        for criteria in ({'true': 'Yes'}, {'false': 'No'}):
            q = {'q': {'type': 'noul', 'instructions': 'Question?', 'criteria': criteria}}
            body = {**self.body, 'questions': q}
            server.validate_request(body)
            self.assertIn(next(iter(criteria.values())), server.engine_request(body)['questions']['q']['instructions'])

    def test_rejects_invalid_shapes_before_inference(self):
        cases = [{**self.body, 'state': ''}, {**self.body, 'model': 'remote-model'}, {**self.body, 'questions': {'q': {'type': 'unknown', 'instructions': '?'}}}]
        for body in cases:
            with self.assertRaises(ValueError): server.validate_request(body)

    def test_response_types_labels_and_probabilities_are_checked(self):
        questions = {'q': {'type': 'choice', 'criteria': {'a': '', 'b': ''}}}
        valid = {'model': 'test-model', 'answers': {'q': {'type': 'choice', 'choice': 'a', 'probabilities': {'a': .8, 'b': .2}, 'confidence': .6}}}
        server.validate_response(valid, questions)
        for change in [{'choice': 'invented'}, {'probabilities': {'a': .1, 'b': .1}}, {'confidence': float('nan')}]:
            response = copy.deepcopy(valid); response['answers']['q'].update(change)
            with self.assertRaises(ValueError): server.validate_response(response, questions)

    def test_noul_is_not_a_generated_boolean_or_out_of_range(self):
        questions = {'q': {'type': 'noul'}}
        server.validate_response({'model': 'test-model', 'answers': {'q': {'type': 'noul', 'noul': .65}}}, questions)
        for value in [True, 2, '0.5']:
            with self.assertRaises(ValueError): server.validate_response({'model': 'test-model', 'answers': {'q': {'type': 'noul', 'noul': value}}}, questions)


if __name__ == '__main__': unittest.main()
