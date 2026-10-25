import copy
import importlib.util
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('norte_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.body = {**json.loads((ROOT / 'tests/fixtures/legacy-classifier/default-questions.json').read_text()), 'state': 'Precisamos registrar temperatura.'}

    def test_real_default_request_validates(self):
        server.validate_request(self.body)

    def test_full_prototype_preserves_original_criteria(self):
        body = json.loads((ROOT / 'tests/fixtures/legacy-classifier/full-request.json').read_text())
        body = {key: body[key] for key in ('model', 'state', 'questions')}
        original = copy.deepcopy(body)
        server.validate_request(body)
        self.assertEqual(body, original)
        self.assertEqual(len(body['questions']), 11)

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
            self.assertIn(next(iter(criteria.values())), next(iter(body['questions']['q']['criteria'].values())))

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


class MeetingLearningHandlerTests(unittest.TestCase):
    def handler(self, path, body):
        handler = SimpleNamespace(path=path, headers={'Content-Type': 'application/json'},
                                  valid_host=lambda: True, valid_origin=lambda: True,
                                  current_user=lambda: {'id': 791, 'role': 'user'},
                                  read_json=lambda limit: body,
                                  json_response=lambda status, result: (status, result), log_error=Mock())
        handler.ai_request = lambda user: server.Handler.ai_request(handler, user)
        return handler

    def test_classification_uses_scoped_context_and_returns_original_request_with_version(self):
        original = {**json.loads((ROOT / 'tests/fixtures/legacy-classifier/default-questions.json').read_text()),
                    'state': {'current_utterance': 'A equipe decidiu revisar o suporte.', '_norte_meeting_id': 'meeting-1'}}
        effective = copy.deepcopy(original)
        effective['state'].pop('_norte_meeting_id')
        effective['state']['meeting_feedback'] = {'version': 3, 'examples': []}
        runtime = Mock()
        runtime.blocks.apply_learning.return_value = effective
        result = {'response': {'answers': {}}}
        with patch.object(server, 'AI_RUNTIME', runtime), patch.object(server, 'classify', return_value=result) as classifier:
            status, output = server.Handler.do_POST(self.handler('/api/classify', original))
        self.assertEqual(status, 200)
        runtime.blocks.apply_learning.assert_called_once_with(791, original)
        classifier.assert_called_once_with(effective, server.SETTINGS)
        self.assertIs(output['request'], original)
        self.assertEqual(output['learning_version'], 3)
        self.assertNotIn('meeting_feedback', original['state'])

    def test_learning_route_uses_authenticated_account(self):
        body = {'session_id': 'meeting-1', 'action': 'get'}
        runtime = Mock()
        runtime.blocks.learning.return_value = {'learning': {'version': 0, 'examples': []}}
        with patch.object(server, 'AI_RUNTIME', runtime), patch.object(server.AI_THROTTLE, 'blocked', return_value=False), patch.object(server.AI_THROTTLE, 'hit'):
            status, result = server.Handler.do_POST(self.handler('/api/ai/blocks/learning', body))
        self.assertEqual(status, 200)
        runtime.blocks.learning.assert_called_once_with(791, body)
        self.assertEqual(result['learning']['version'], 0)


if __name__ == '__main__': unittest.main()
