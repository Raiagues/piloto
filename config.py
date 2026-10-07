"""Private server configuration. Never served to the browser."""
from dataclasses import dataclass, field
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    provider: str = 'official'
    api_key: str = field(default='', repr=False)
    gemini_api_key: str = field(default='', repr=False)
    gemini_model: str = 'gemini-3.1-pro-preview'
    database_url: str = field(default='', repr=False)
    admin_username: str = 'admin'
    admin_password: str = field(default='', repr=False)
    signup_code: str = field(default='', repr=False)
    allowed_hosts: tuple = ()


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
                            'DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SIGNUP_CODE', 'ALLOWED_HOSTS'): continue
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
    hosts = [text('ALLOWED_HOSTS'), text('RENDER_EXTERNAL_HOSTNAME')]
    hosts = tuple(dict.fromkeys(host.strip().lower() for value in hosts for host in value.split(',') if host.strip()))
    return Settings(provider=provider, api_key=key, gemini_api_key=gemini_key, gemini_model=model,
                    database_url=text('DATABASE_URL'), admin_username=text('ADMIN_USERNAME', 'admin') or 'admin',
                    admin_password=text('ADMIN_PASSWORD'), signup_code=text('SIGNUP_CODE'), allowed_hosts=hosts)


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
