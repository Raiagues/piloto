"""Private server configuration. Never served to the browser."""
from dataclasses import dataclass, field
import os
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    provider: str = 'official'
    api_key: str = field(default='', repr=False)
    gemini_api_key: str = field(default='', repr=False)
    openai_api_key: str = field(default='', repr=False)
    gemini_model: str = 'gemini-3.1-pro-preview'
    database_url: str = field(default='', repr=False)
    admin_username: str = 'admin'
    admin_password: str = field(default='', repr=False)
    signup_code: str = field(default='', repr=False)
    allowed_hosts: tuple = ()
    ai_agents_enabled: bool = True
    # Explicit operator opt-in: candidate text is sent to the selected provider.
    # Existing GEMINI_API_KEY for minutes does not opt meeting telemetry in.
    ai_external_review_enabled: bool = False
    ai_auto_publish: bool = True
    ai_agent_model: str = 'gemini-2.5-flash'
    ai_agent_provider: str = 'gemini'
    ai_openai_model: str = 'gpt-4.1-mini'
    ai_daily_budget_usd: float = 1.0
    ai_daily_call_limit: int = 50
    ai_retention_days: int = 90
    ai_gemini_input_usd_per_million: float | None = None
    ai_gemini_output_usd_per_million: float | None = None
    ai_openai_input_usd_per_million: float | None = None
    ai_openai_output_usd_per_million: float | None = None
    jev_input_usd_per_million: float | None = None
    jev_output_usd_per_million: float | None = None
    jev_usd_per_request: float | None = None


def load_settings(path=None, environ=None):
    path = ROOT / '.env' if path is None else Path(path)
    environ = os.environ if environ is None else environ
    values = {}
    if path.exists():
        for number, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'): continue
            if line.startswith('export '): line = line[7:].strip()
            if '=' not in line: raise ValueError(f'.env: linha {number} inválida; use NOME=valor.')
            name, value = line.split('=', 1)
            name, value = name.strip(), value.strip()
            if name not in ('NORTE_PROVIDER', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL',
                            'DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SIGNUP_CODE', 'ALLOWED_HOSTS',
                            'AI_AGENTS_ENABLED', 'AI_EXTERNAL_REVIEW_ENABLED', 'AI_AUTO_PUBLISH', 'AI_AGENT_MODEL', 'AI_DAILY_BUDGET_USD',
                            'AI_AGENT_PROVIDER', 'OPENAI_API_KEY', 'AI_OPENAI_MODEL', 'AI_OPENAI_INPUT_USD_PER_MILLION', 'AI_OPENAI_OUTPUT_USD_PER_MILLION',
                            'AI_DAILY_CALL_LIMIT', 'AI_RETENTION_DAYS', 'AI_GEMINI_INPUT_USD_PER_MILLION',
                            'AI_GEMINI_OUTPUT_USD_PER_MILLION', 'JEV_INPUT_USD_PER_MILLION',
                            'JEV_OUTPUT_USD_PER_MILLION', 'JEV_USD_PER_REQUEST'): continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"): value = value[1:-1]
            values[name] = value
    provider = environ.get('NORTE_PROVIDER', values.get('NORTE_PROVIDER', 'official')).strip()
    if provider not in ('official', 'local'): raise ValueError('NORTE_PROVIDER deve ser official ou local.')
    key = next((source[name].strip() for source in (environ, values) for name in ('TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API') if source.get(name, '').strip()), '')
    if key in ('COLE_SUA_CHAVE_AQUI', 'SUA_CHAVE_AQUI'): key = ''
    if key and (not key.isascii() or any(ord(c) <= 32 or ord(c) == 127 for c in key)):
        raise ValueError('Chave inválida no .env: remova espaços e quebras de linha.')
    gemini_key = next((source[name].strip() for source in (environ, values) for name in ('GEMINI_API_KEY', 'GOOGLE_API_KEY') if source.get(name, '').strip()), '')
    model = environ.get('GEMINI_MODEL', values.get('GEMINI_MODEL', 'gemini-3.1-pro-preview')).strip()
    text = lambda name, default='': environ.get(name, values.get(name, default)).strip()
    def number(name, default=None, integer=False, minimum=0, maximum=1000000):
        raw = text(name, '' if default is None else str(default))
        if not raw: return default
        try: value = int(raw) if integer else float(raw)
        except ValueError: raise ValueError(name + ': use um número válido.') from None
        if not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(name + ': valor fora do intervalo permitido.')
        return value
    def boolean(name, default):
        raw = text(name, 'true' if default else 'false').lower()
        if raw not in ('true', 'false', '1', '0'): raise ValueError(name + ': use true ou false.')
        return raw in ('true', '1')
    hosts = [text('ALLOWED_HOSTS'), text('RENDER_EXTERNAL_HOSTNAME')]
    hosts = tuple(dict.fromkeys(host.strip().lower() for value in hosts for host in value.split(',') if host.strip()))
    agent_provider = text('AI_AGENT_PROVIDER', 'gemini')
    if agent_provider not in ('gemini', 'openai'): raise ValueError('AI_AGENT_PROVIDER deve ser gemini ou openai.')
    return Settings(provider=provider, api_key=key, gemini_api_key=gemini_key, gemini_model=model,
                    database_url=text('DATABASE_URL'), admin_username=text('ADMIN_USERNAME', 'admin') or 'admin',
                    admin_password=text('ADMIN_PASSWORD'), signup_code=text('SIGNUP_CODE'), allowed_hosts=hosts,
                    ai_agents_enabled=boolean('AI_AGENTS_ENABLED', True), ai_auto_publish=boolean('AI_AUTO_PUBLISH', True),
                    ai_external_review_enabled=boolean('AI_EXTERNAL_REVIEW_ENABLED', False),
                    ai_agent_model=text('AI_AGENT_MODEL', 'gemini-2.5-flash'),
                    ai_agent_provider=agent_provider, openai_api_key=text('OPENAI_API_KEY'), ai_openai_model=text('AI_OPENAI_MODEL', 'gpt-4.1-mini'),
                    ai_daily_budget_usd=number('AI_DAILY_BUDGET_USD', 1, maximum=10000),
                    ai_daily_call_limit=number('AI_DAILY_CALL_LIMIT', 50, integer=True, maximum=10000),
                    ai_retention_days=number('AI_RETENTION_DAYS', 90, integer=True, minimum=1, maximum=3650),
                    ai_gemini_input_usd_per_million=number('AI_GEMINI_INPUT_USD_PER_MILLION'),
                    ai_gemini_output_usd_per_million=number('AI_GEMINI_OUTPUT_USD_PER_MILLION'),
                    ai_openai_input_usd_per_million=number('AI_OPENAI_INPUT_USD_PER_MILLION'),
                    ai_openai_output_usd_per_million=number('AI_OPENAI_OUTPUT_USD_PER_MILLION'),
                    jev_input_usd_per_million=number('JEV_INPUT_USD_PER_MILLION'),
                    jev_output_usd_per_million=number('JEV_OUTPUT_USD_PER_MILLION'),
                    jev_usd_per_request=number('JEV_USD_PER_REQUEST'))


def setup():
    path = ROOT / '.env'
    if not path.exists():
        with path.open('x', encoding='utf8') as output: output.write((ROOT / '.env.example').read_text(encoding='utf8'))
        path.chmod(0o600)
    settings = load_settings()
    if settings.provider == 'local':
        subprocess.run([sys.executable, str(ROOT / 'scripts/setup_model.py')], check=True)
    else:
        print('Jev oficial selecionado. Nenhum modelo local será baixado ou iniciado.')
        print('Chave configurada.' if settings.api_key else 'Cole sua chave em TYPESAFE_API_KEY no arquivo .env e execute ./start.')
    if not settings.admin_password:
        print('Defina ADMIN_PASSWORD no arquivo .env para criar a conta admin (usuário: ' + settings.admin_username + ').')


if __name__ == '__main__':
    try: setup()
    except (OSError, ValueError) as error: raise SystemExit(str(error))
