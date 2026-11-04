"""Wire format of the language-model providers. No network and no real key."""

import unittest

from config import Settings
from meetings.engine import llm

SCHEMA = {
    'type': 'object',
    'properties': {'items': {'type': 'array', 'maxItems': 3, 'items': {'type': 'string', 'maxLength': 20}}},
    'required': ['items'],
    'additionalProperties': False,
}


class OpenAITests(unittest.TestCase):
    settings = Settings(openai_api_key='fixture')

    def test_request_uses_strict_schema_and_keeps_nothing_on_the_provider(self):
        url, headers, payload = llm.request(self.settings, 'gpt-6.1-sol', 'prompt', 'dados', 500, SCHEMA, 'notas')
        self.assertEqual(url, 'https://api.openai.com/v1/responses')
        self.assertEqual(headers['Authorization'], 'Bearer fixture')
        self.assertIs(payload['store'], False)
        self.assertEqual(payload['max_output_tokens'], 500)
        self.assertTrue(payload['text']['format']['strict'])
        self.assertNotIn('maxItems', str(payload['text']['format']['schema']))

    def test_request_without_schema_asks_for_json(self):
        payload = llm.request(self.settings, 'gpt-6-luna', 'prompt', 'dados', 500)[2]
        self.assertEqual(payload['text']['format'], {'type': 'json_object'})
        # The real API answers 400 when the word is only in the instructions.
        self.assertIn('json', payload['input'].lower())

    def test_finished_answer(self):
        reply = llm.answer(
            self.settings,
            {
                'status': 'completed',
                'model': 'gpt-6-luna',
                'usage': {'input_tokens': 3},
                'output': [
                    {'type': 'reasoning', 'summary': []},
                    {'type': 'message', 'content': [{'type': 'output_text', 'text': '{"a":1}'}]},
                ],
            },
        )
        self.assertEqual(
            (reply['text'], reply['finished'], reply['model'], reply['usage']),
            ('{"a":1}', True, 'gpt-6-luna', {'input_tokens': 3}),
        )

    def test_cut_answer_is_not_finished(self):
        reply = llm.answer(
            self.settings, {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}, 'output': []}
        )
        self.assertFalse(reply['finished'])
        self.assertTrue(reply['cut'])

    def test_refusal_is_not_finished_even_when_completed(self):
        reply = llm.answer(
            self.settings,
            {
                'status': 'completed',
                'output': [{'type': 'message', 'content': [{'type': 'refusal', 'refusal': 'não'}]}],
            },
        )
        self.assertFalse(reply['finished'])
        self.assertEqual(reply['reason'], 'refusal')
        self.assertEqual(reply['text'], '')


class SelectableProviderTests(unittest.TestCase):
    settings = Settings(llm_provider='gemini', gemini_api_key='fixture')

    def test_the_same_flow_can_select_gemini(self):
        url, headers, payload = llm.request(self.settings, 'gemini-model', 'prompt', 'dados', 500, SCHEMA)
        self.assertIn('gemini-model:generateContent', url)
        self.assertEqual(headers['x-goog-api-key'], 'fixture')
        self.assertEqual(payload['generationConfig']['maxOutputTokens'], 500)
        reply = llm.answer(
            self.settings, {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{}'}]}}]}
        )
        self.assertTrue(reply['finished'])


if __name__ == '__main__':
    unittest.main()
