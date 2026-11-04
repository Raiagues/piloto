"""Private server configuration. Never served to the browser."""

from dataclasses import dataclass, field
import os
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    provider: str = 'official'
    api_key: str = field(default='', repr=False)
    gemini_api_key: str = field(default='', repr=False)
    openai_api_key: str = field(default='', repr=False)
    llm_provider: str = 'openai'
    meeting_editor_model: str = 'gpt-6-luna'
    minutes_model: str = 'gpt-6.1-sol'
    jev_model: str = 'jev-1.13.0'
    meeting_editor_input_usd_per_million: float | None = None
    meeting_editor_output_usd_per_million: float | None = None
    meeting_editor_timeout_seconds: int = 30
    meeting_editor_max_output_tokens: int = 4096
    minutes_input_usd_per_million: float | None = None
    minutes_output_usd_per_million: float | None = None
    minutes_max_output_tokens: int = 32768
    minutes_daily_call_limit: int = 50
    database_url: str = field(default='', repr=False)
    admin_username: str = 'admin'
    admin_password: str = field(default='', repr=False)
    signup_code: str = field(default='', repr=False)
    allowed_hosts: tuple = ()
    ai_agents_enabled: bool = True
    # Explicit operator opt-in: candidate text is sent to the selected provider.
    # A key configured for the minutes does not opt meeting telemetry in.
    ai_external_review_enabled: bool = False
    ai_auto_publish: bool = True
    ai_daily_budget_usd: float = 1.0
    ai_daily_call_limit: int = 50
    ai_retention_days: int = 90
    jev_input_usd_per_million: float | None = None
    jev_output_usd_per_million: float | None = None
    jev_usd_per_request: float | None = None


PLACEHOLDER_KEYS = ('COLE_SUA_CHAVE_AQUI', 'SUA_CHAVE_AQUI')
# USD per million input and output tokens, from developers.openai.com/api/docs/models on 2026-11-03.
MODEL_RATES = {
    'gpt-6-luna': (0.10, 0.50),
    'gpt-6.1-terra': (1.00, 5.00),
    'gpt-6.1-sol': (2.00, 10.00),
    'gpt-6-astra': (10.00, 50.00),
}


def single_key(environ, values, names):
    """Same alias policy as norte/server/ai-keys.mjs. The process environment overrides
    the .env file as a whole for this credential; inside one origin, empty means absent
    and two aliases with different values are a configuration error (values never shown)."""

    def filled(source):
        return {
            name: source[name].strip()
            for name in names
            if source.get(name, '').strip() and source[name].strip() not in PLACEHOLDER_KEYS
        }

    found = filled(environ) or filled(values)
    if len(set(found.values())) > 1:
        raise ValueError(
            ' e '.join(found) + ' estão preenchidas com valores diferentes. Mantenha somente uma delas no .env.'
        )
    return next(iter(found.values()), '')


def load_settings(path=None, environ=None):
    path = ROOT / '.env' if path is None else Path(path)
    environ = os.environ if environ is None else environ
    values = {}
    if path.exists():
        for number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:].strip()
            if '=' not in line:
                raise ValueError(f'.env: linha {number} inválida; use NOME=valor.')
            name, value = line.split('=', 1)
            name, value = name.strip(), value.strip()
            if name not in (
                'NORTE_PROVIDER',
                'TYPESAFE_API_KEY',
                'JEV_API_KEY',
                'JEV_KEY_API',
                'OPENAI_API_KEY',
                'GEMINI_API_KEY',
                'GOOGLE_API_KEY',
                'JEV_MODEL',
                'DATABASE_URL',
                'ADMIN_USERNAME',
                'ADMIN_PASSWORD',
                'SIGNUP_CODE',
                'ALLOWED_HOSTS',
                'NORTE_LLM_PROVIDER',
                'NORTE_MEETING_EDITOR_MODEL',
                'NORTE_MINUTES_MODEL',
                'NORTE_MEETING_EDITOR_INPUT_USD_PER_MILLION',
                'NORTE_MEETING_EDITOR_OUTPUT_USD_PER_MILLION',
                'NORTE_MEETING_EDITOR_TIMEOUT_SECONDS',
                'NORTE_MEETING_EDITOR_MAX_OUTPUT_TOKENS',
                'NORTE_MINUTES_INPUT_USD_PER_MILLION',
                'NORTE_MINUTES_OUTPUT_USD_PER_MILLION',
                'NORTE_MINUTES_MAX_OUTPUT_TOKENS',
                'MINUTES_DAILY_CALL_LIMIT',
                'AI_AGENTS_ENABLED',
                'AI_EXTERNAL_REVIEW_ENABLED',
                'AI_AUTO_PUBLISH',
                'AI_DAILY_BUDGET_USD',
                'AI_DAILY_CALL_LIMIT',
                'AI_RETENTION_DAYS',
                'JEV_INPUT_USD_PER_MILLION',
                'JEV_OUTPUT_USD_PER_MILLION',
                'JEV_USD_PER_REQUEST',
            ):
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            values[name] = value
    provider = environ.get('NORTE_PROVIDER', values.get('NORTE_PROVIDER', 'official')).strip()
    if provider != 'official':
        raise ValueError('NORTE_PROVIDER deve ser official; o classificador local foi retirado.')
    key = single_key(environ, values, ('TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API'))
    if key and (not key.isascii() or any(ord(c) <= 32 or ord(c) == 127 for c in key)):
        raise ValueError('Chave inválida no .env: remova espaços e quebras de linha.')
    gemini_key = single_key(environ, values, ('GOOGLE_API_KEY', 'GEMINI_API_KEY'))
    text = lambda name, default='': environ.get(name, values.get(name, default)).strip()

    def number(name, default=None, integer=False, minimum=0, maximum=1000000):
        raw = text(name, '' if default is None else str(default))
        if not raw:
            return default
        try:
            value = int(raw) if integer else float(raw)
        except ValueError:
            raise ValueError(name + ': use um número válido.') from None
        if not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(name + ': valor fora do intervalo permitido.')
        return value

    def boolean(name, default):
        raw = text(name, 'true' if default else 'false').lower()
        if raw not in ('true', 'false', '1', '0'):
            raise ValueError(name + ': use true ou false.')
        return raw in ('true', '1')

    hosts = [text('ALLOWED_HOSTS'), text('RENDER_EXTERNAL_HOSTNAME')]
    hosts = tuple(dict.fromkeys(host.strip().lower() for value in hosts for host in value.split(',') if host.strip()))
    llm_provider = text('NORTE_LLM_PROVIDER', 'openai')
    if llm_provider not in ('openai', 'gemini'):
        raise ValueError('NORTE_LLM_PROVIDER deve ser openai ou gemini.')
    jev_model = text('JEV_MODEL', 'jev-1.13.0') or 'jev-1.13.0'
    if not re.fullmatch(r'jev-(latest|preview|\d+\.\d+\.\d+)', jev_model):
        raise ValueError('JEV_MODEL deve ser jev-latest, jev-preview ou uma versão como jev-1.13.0.')
    editor_model = text('NORTE_MEETING_EDITOR_MODEL', 'gpt-6-luna')
    minutes_model = text('NORTE_MINUTES_MODEL', 'gpt-6.1-sol')
    editor_rates = MODEL_RATES.get(editor_model, (None, None))
    minutes_rates = MODEL_RATES.get(minutes_model, (None, None))
    return Settings(
        provider=provider,
        api_key=key,
        gemini_api_key=gemini_key,
        openai_api_key=text('OPENAI_API_KEY'),
        jev_model=jev_model,
        llm_provider=llm_provider,
        meeting_editor_model=editor_model,
        minutes_model=minutes_model,
        meeting_editor_input_usd_per_million=number('NORTE_MEETING_EDITOR_INPUT_USD_PER_MILLION', editor_rates[0]),
        meeting_editor_output_usd_per_million=number('NORTE_MEETING_EDITOR_OUTPUT_USD_PER_MILLION', editor_rates[1]),
        meeting_editor_timeout_seconds=number(
            'NORTE_MEETING_EDITOR_TIMEOUT_SECONDS', 30, integer=True, minimum=5, maximum=120
        ),
        meeting_editor_max_output_tokens=number(
            'NORTE_MEETING_EDITOR_MAX_OUTPUT_TOKENS', 4096, integer=True, minimum=256, maximum=65536
        ),
        minutes_input_usd_per_million=number('NORTE_MINUTES_INPUT_USD_PER_MILLION', minutes_rates[0]),
        minutes_output_usd_per_million=number('NORTE_MINUTES_OUTPUT_USD_PER_MILLION', minutes_rates[1]),
        minutes_max_output_tokens=number(
            'NORTE_MINUTES_MAX_OUTPUT_TOKENS', 32768, integer=True, minimum=1024, maximum=131072
        ),
        minutes_daily_call_limit=number('MINUTES_DAILY_CALL_LIMIT', 50, integer=True, maximum=10000),
        database_url=text('DATABASE_URL'),
        admin_username=text('ADMIN_USERNAME', 'admin') or 'admin',
        admin_password=text('ADMIN_PASSWORD'),
        signup_code=text('SIGNUP_CODE'),
        allowed_hosts=hosts,
        ai_agents_enabled=boolean('AI_AGENTS_ENABLED', True),
        ai_auto_publish=boolean('AI_AUTO_PUBLISH', True),
        ai_external_review_enabled=boolean('AI_EXTERNAL_REVIEW_ENABLED', False),
        ai_daily_budget_usd=number('AI_DAILY_BUDGET_USD', 1, maximum=10000),
        ai_daily_call_limit=number('AI_DAILY_CALL_LIMIT', 50, integer=True, maximum=10000),
        ai_retention_days=number('AI_RETENTION_DAYS', 90, integer=True, minimum=1, maximum=3650),
        jev_input_usd_per_million=number('JEV_INPUT_USD_PER_MILLION'),
        jev_output_usd_per_million=number('JEV_OUTPUT_USD_PER_MILLION'),
        jev_usd_per_request=number('JEV_USD_PER_REQUEST'),
    )


def setup():
    path = ROOT / '.env'
    if not path.exists():
        with path.open('x', encoding='utf8') as output:
            output.write((ROOT / '.env.example').read_text(encoding='utf8'))
        path.chmod(0o600)
    settings = load_settings()
    print('JEV oficial selecionado.')
    print(
        'Chave configurada.'
        if settings.api_key
        else 'Configure TYPESAFE_API_KEY no arquivo .env para classificar as reuniões.'
    )
    if not settings.admin_password:
        print(
            'Defina ADMIN_PASSWORD no arquivo .env para criar a conta admin (usuário: ' + settings.admin_username + ').'
        )


if __name__ == '__main__':
    try:
        setup()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
