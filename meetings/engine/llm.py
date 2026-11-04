"""HTTP shape of each language-model provider. Flows choose the model and the prompt; this file knows the wire format."""

from pathlib import Path

PROMPTS = Path(__file__).resolve().parents[2] / 'prompts' / 'llm'
OPENAI_URL = 'https://api.openai.com/v1/responses'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'
SIZE_LIMITS = ('minItems', 'maxItems', 'minLength', 'maxLength')


def prompt(name):
    return (PROMPTS / name).read_text(encoding='utf-8')


def api_key(settings):
    return settings.openai_api_key if settings.llm_provider == 'openai' else settings.gemini_api_key


def without_size_limits(schema):
    """Size limits stay in the local validation, not in the provider's decoding grammar."""
    if isinstance(schema, dict):
        return {key: without_size_limits(value) for key, value in schema.items() if key not in SIZE_LIMITS}
    if isinstance(schema, list):
        return [without_size_limits(value) for value in schema]
    return schema


def request(settings, model, instructions, text, max_output_tokens, schema=None, name='result'):
    """Returns (url, headers, payload). store=False keeps the conversation out of OpenAI's stored responses."""
    key = api_key(settings)
    if settings.llm_provider == 'openai':
        output = (
            {'type': 'json_schema', 'name': name, 'schema': without_size_limits(schema), 'strict': True}
            if schema
            else {'type': 'json_object'}
        )
        return (
            OPENAI_URL,
            {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
            {
                'model': model,
                'instructions': instructions,
                # OpenAI refuses JSON mode unless the input itself carries the word JSON.
                'input': text if schema else 'JSON:\n' + text,
                'store': False,
                'max_output_tokens': max_output_tokens,
                'text': {'format': output},
            },
        )
    config = {'responseMimeType': 'application/json', 'maxOutputTokens': max_output_tokens}
    if schema:
        config['responseJsonSchema'] = without_size_limits(schema)
    return (
        GEMINI_URL + model + ':generateContent',
        {'Content-Type': 'application/json', 'x-goog-api-key': key},
        {
            'systemInstruction': {'parts': [{'text': instructions}]},
            'contents': [{'role': 'user', 'parts': [{'text': text}]}],
            'generationConfig': config,
        },
    )


def answer(settings, response):
    """Provider response as {text, finished, reason, model, usage}. A refusal or a cut answer is never finished."""
    if settings.llm_provider == 'openai':
        parts = [
            part
            for item in response.get('output', [])
            if item.get('type') == 'message'
            for part in item.get('content', [])
        ]
        refused = any(part.get('type') == 'refusal' for part in parts)
        status = response.get('status')
        reason = 'refusal' if refused else (response.get('incomplete_details') or {}).get('reason') or status
        return {
            'text': ''.join(part.get('text', '') for part in parts if part.get('type') == 'output_text'),
            'finished': status == 'completed' and not refused,
            'reason': reason,
            'cut': reason == 'max_output_tokens',
            'model': response.get('model'),
            'usage': response.get('usage', {}),
        }
    candidate = (response.get('candidates') or [{}])[0]
    reason = candidate.get('finishReason')
    return {
        'text': ''.join(
            part.get('text', '') for part in candidate.get('content', {}).get('parts', []) if not part.get('thought')
        ),
        'finished': reason == 'STOP',
        'reason': reason,
        'cut': reason == 'MAX_TOKENS',
        'model': response.get('modelVersion'),
        'usage': response.get('usageMetadata', {}),
    }
