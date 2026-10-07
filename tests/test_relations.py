"""Independent proxy lanes. All inference is mocked; no keys or paid calls."""
import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from config import Settings
from support import signed_in


class RelationTransportTests(unittest.TestCase):
    def setUp(self):
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.http.server_port)
        self.user_id, self.auth = signed_in(self)
        self.body = {'model': 'jev-latest', 'state': {'current_event': {'event_id': 'E002', 'text': 'Test failed'}, 'candidates': [{'event_id': 'E001', 'text': 'Test the bracket'}]}, 'questions': {'has_relation__E001': {'type': 'noul', 'instructions': 'Related to candidate E001?'}}}

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def post(self, route, body=None, headers=None):
        request = Request(self.base + route, data=json.dumps(body or self.body).encode(), headers={'Content-Type': 'application/json', 'X-Norte-Provider': 'official', **self.auth, **(headers or {})})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def test_relation_request_never_holds_the_primary_lane_and_each_lane_is_bounded(self):
        entered, release = threading.Event(), threading.Event()
        result, errors, sent = [], [], []

        def classify(body, settings):
            sent.append(body)
            if 'current_event' in body['state']:
                entered.set()
                if not release.wait(2): raise AssertionError('Relation did not release')
            return {'request': body, 'provider': settings.provider}

        def relation():
            try: result.append(self.post('/api/relations'))
            except Exception as error: errors.append(error)

        with patch.object(server, 'SETTINGS', Settings(api_key='fixture-only')), patch.object(server, 'classify', side_effect=classify):
            thread = threading.Thread(target=relation)
            thread.start()
            try:
                self.assertTrue(entered.wait(1))
                with self.assertRaises(HTTPError) as error: self.post('/api/relations')
                self.assertEqual(error.exception.code, 429)
                chunk = {**self.body, 'state': {'current_utterance': 'New chunk'}}
                self.assertEqual(self.post('/api/classify', chunk)['request'], chunk)
                self.assertFalse(release.is_set(), 'Chunks finish while relations are still waiting')
            finally:
                release.set()
                thread.join(timeout=3)
        self.assertEqual(errors, [])
        self.assertEqual(result[0]['request'], self.body)
        self.assertEqual(len(sent), 2)

    def test_secondary_endpoint_keeps_all_origin_provider_and_validation_guards(self):
        with patch.object(server, 'SETTINGS', Settings(api_key='fixture-only')), patch.object(server, 'classify') as classify:
            for headers, status in [({'Origin': 'https://attacker.example'}, 403), ({'Host': 'attacker.example'}, 403), ({'Content-Type': 'text/plain'}, 415), ({'X-Norte-Provider': 'local'}, 409)]:
                with self.assertRaises(HTTPError) as error: self.post('/api/relations', headers=headers)
                self.assertEqual(error.exception.code, status)
            with self.assertRaises(HTTPError) as error: self.post('/api/relations', {**self.body, 'model': 'wrong'})
            self.assertEqual(error.exception.code, 400)
            classify.assert_not_called()

    def test_thread_choice_questions_and_hydrated_archives_use_existing_secondary_lane(self):
        question = {'type': 'choice', 'instructions': 'Evaluate only the matching candidate thread.',
                    'criteria': {'belongs': 'Same discussion', 'does_not_belong': 'Different discussion', 'uncertain': 'Insufficient context'}}
        body = {'model': 'jev-latest', 'state': {
            'current_event': {'event_id': 'E071', 'text': 'Return to the bracket.'},
            'recent_context': [{'chunk_id': 'C099', 'text': 'Earlier discussion'}],
            'candidate_threads': [
                {'thread_id': 'T001', 'anchor_event_ids': ['E001'], 'anchors': [{'event_id': 'E001', 'text': 'Bracket deformation'}]},
                {'thread_id': 'T002', 'anchor_event_ids': ['E044'], 'anchors': [{'event_id': 'E044', 'text': 'Sensor enclosure'}]}
            ]}, 'questions': {'belongs_to_archive_thread__T001': question, 'belongs_to_archive_thread__T002': question}}
        with patch.object(server, 'SETTINGS', Settings(api_key='fixture-only')), patch.object(server, 'classify', side_effect=lambda b, settings: {'request': b}) as classify:
            self.assertEqual(self.post('/api/relations', body)['request'], body)
            classify.assert_called_once()

    def test_typed_relation_lane_is_bounded_and_keeps_security_guards(self):
        body = {**self.body, 'questions': {'relation_type__E001': {'type': 'choice', 'instructions': 'Direct relationship to E001?', 'criteria': {'result_of': 'Outcome of this test', 'none': 'No direct link'}}}}
        with patch.object(server, 'SETTINGS', Settings(api_key='fixture-only')), patch.object(server, 'classify', side_effect=lambda b, settings: {'request': b}) as classify:
            self.assertEqual(self.post('/api/typed-relations', body)['request'], body)
            with self.assertRaises(HTTPError) as error:
                self.post('/api/typed-relations', body, {'Origin': 'https://attacker.example'})
            self.assertEqual(error.exception.code, 403)
            lane = server.lanes_for(self.user_id)['typed-relations']
            lane.acquire()
            try:
                with self.assertRaises(HTTPError) as error: self.post('/api/typed-relations', body)
                self.assertEqual(error.exception.code, 429)
                self.assertEqual(self.post('/api/relations', body)['request'], body)
                self.assertEqual(self.post('/api/classify', body)['request'], body)
            finally: lane.release()
            self.assertEqual(classify.call_count, 3)


if __name__ == '__main__': unittest.main()
