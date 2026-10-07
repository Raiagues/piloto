#!/usr/bin/env python3
"""UI + private TypeSafe API proxy behind accounts, or opt-in local engine.

Stdlib only, except psycopg when DATABASE_URL points to Postgres (see auth.py).
"""
import argparse
import copy
import hmac
import io
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import threading
import time
import zlib
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
import auth
from config import Settings, load_settings
import gemini_minutes

ROOT = Path(__file__).resolve().parent
ALLOWED = {'index.html', 'styles.css', 'memory-flow.css', 'memory-flow.js', 'memory-page.js', 'relation-worker.js', 'app.js', 'transcription.js', 'speech-windows.js', 'classifier.js', 'workspace.js', 'experiments.js', 'automation.js', 'lab.js', 'classifier-config.json', 'manual-test-example.json'}
ENGINE_URL = ''
ALLOWED.update({'memory-v2.js','gemini-minutes.js','gemini-minutes.css','reuniao.html','meeting-room.js','meeting-room.css','meeting-canvas.js','meeting-canvas.css','meeting-session.js','meeting-commands.js','meeting-hierarchy.js','meeting-evidence.js','meeting-state.js','meeting-review.js'})
ALLOWED.update({'beam-engine.js','beam-commands.js','beam-workspace.js','beam-workspace.css','meeting-beam.js','meeting-beam.css','meeting-speech.js'})
ALLOWED.update({'meeting-document.js','meeting-amendments.js'})
ALLOWED.update({'account.js', 'account.css', 'remote-storage.js'})
ALLOWED.update({'typed-relations.js', 'typed-relations-page.js', 'meeting-minutes.js', 'meeting-minutes.css', 'relation-map.js', 'relation-map.css', 'memory-storage.js',
                'vendor/minutes/jspdf-4.2.1.umd.min.js', 'vendor/minutes/DejaVuSans-2.37.ttf',
                'tests/fixtures/typed-relations-curated.json', 'tests/fixtures/typed-relations-holdout.json', 'tests/fixtures/typed-relations-b002.json',
                'tests/fixtures/typed-relations-natural.json', 'tests/fixtures/typed-relations-b002-clarified.json'})
# Served without an account. Everything else in ALLOWED needs a session.
PUBLIC = {'login.html', 'auth.css', 'auth.js'}
# Test benches and fixtures belong to the admin account only.
ADMIN_ONLY = {'manual-test-example.json'} | {name for name in ALLOWED if name.startswith('tests/')}
SETTINGS = Settings()
OFFICIAL_URL = 'https://api.typesafe.ai/v1/systemone'
STORE = None
COOKIE = 'norte_session'
AUTH_REQUIRED = {'error': 'Entre na sua conta para continuar.', 'code': 'auth'}
LOGIN_THROTTLE = auth.Throttle(8, 15 * 60)
NETWORK_THROTTLE = auth.Throttle(40, 15 * 60)
SIGNUP_THROTTLE = auth.Throttle(10, 60 * 60)
MAX_RECORD_REQUEST = 32_000_000
POST_ROUTES = ('/api/classify', '/api/relations', '/api/typed-relations', '/api/minutes', '/api/records',
               '/api/auth/login', '/api/auth/signup', '/api/auth/logout')
# One request per lane per account: accounts never block each other.
LANE_NAMES = ('classify', 'relations', 'typed-relations', 'minutes')
LANES = {}
LANES_LOCK = threading.Lock()


def lanes_for(user_id):
    with LANES_LOCK:
        if user_id not in LANES: LANES[user_id] = {name: threading.BoundedSemaphore(1) for name in LANE_NAMES}
        return LANES[user_id]


def public_user(user): return {'username': user['username'], 'role': user['role']}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None


OFFICIAL_HTTP = build_opener(NoRedirect())


class ProviderError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def validate_state(state):
    if isinstance(state, str):
        if not state.strip() or len(state) > 16000: raise ValueError('State deve conter entre 1 e 16000 caracteres.')
        return
    if not isinstance(state, (dict, list)) or not state: raise ValueError('State deve ser texto, objeto ou lista JSON não vazios.')
    def visit(value, depth=0):
        if depth > 16: raise ValueError('State excede 16 níveis de profundidade.')
        if value is None or isinstance(value, (str, bool)): return
        if type(value) in (int, float):
            if not math.isfinite(value): raise ValueError('Número inválido no State.')
        elif isinstance(value, (dict, list)):
            if isinstance(value, dict) and any(not isinstance(key, str) for key in value): raise ValueError('Chave inválida no State.')
            for child in (value.values() if isinstance(value, dict) else value): visit(child, depth + 1)
        else: raise ValueError('Valor inválido no State.')
    visit(state)
    if len(json.dumps(state, ensure_ascii=False, separators=(',', ':'))) > 16000: raise ValueError('State JSON excede 16000 caracteres.')


def validate_request(body):
    if not isinstance(body, dict) or set(body) != {'model', 'state', 'questions'}:
        raise ValueError('Use model, state e questions.')
    if body['model'] != 'jev-latest': raise ValueError('Use o modelo jev-latest.')
    validate_state(body['state'])
    questions = body['questions']
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 32: raise ValueError('Use de 1 a 32 perguntas.')
    for key, q in questions.items():
        if not isinstance(key, str) or not 1 <= len(key) <= 80 or not isinstance(q, dict): raise ValueError('Pergunta inválida.')
        if set(q) - {'type', 'instructions', 'criteria'}: raise ValueError('Campo desconhecido na pergunta.')
        if q.get('type') not in ('choice', 'score', 'noul'): raise ValueError('Tipo deve ser choice, score ou noul.')
        if not isinstance(q.get('instructions'), str) or not 1 <= len(q['instructions']) <= 1500: raise ValueError('Instrução inválida.')
        criteria = q.get('criteria')
        if q['type'] == 'choice':
            if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 12: raise ValueError('Choice precisa de 2 a 12 opções.')
            if any(not isinstance(k, str) or not k or not isinstance(v, str) or len(v) > 800 for k, v in criteria.items()): raise ValueError('Critérios inválidos.')
        elif q['type'] == 'score':
            if not isinstance(criteria, list) or not 2 <= len(criteria) <= 5 or any(not isinstance(v, str) or len(v) > 800 for v in criteria): raise ValueError('Score precisa de 2 a 5 níveis.')
        elif criteria is not None:
            if not isinstance(criteria, dict) or not criteria or set(criteria) - {'true', 'false'} or any(not isinstance(v, str) or len(v) > 800 for v in criteria.values()):
                raise ValueError('Noul aceita descrições true e/ou false de até 800 caracteres.')


def engine_request(body):
    """jevos validates Noul criteria but ignores them; make their meaning explicit."""
    effective = copy.deepcopy(body)
    for question in effective['questions'].values():
        if question['type'] == 'noul' and question.get('criteria'):
            criteria = question.pop('criteria')
            question['instructions'] += '\n\n' + '\n'.join(
                f'Answer {key} when: {criteria[key]}' for key in ('true', 'false') if key in criteria
            )
    return effective


def validate_response(response, questions):
    if not isinstance(response, dict) or not isinstance(response.get('model'), str): raise ValueError('Resposta do modelo inválida.')
    answers = response.get('answers', {})
    if not isinstance(answers, dict): raise ValueError('Respostas inválidas.')
    if set(answers) != set(questions): raise ValueError('O modelo não respondeu todas as perguntas.')
    def probability(value):
        return type(value) in (float, int) and math.isfinite(value) and 0 <= value <= 1
    for key, q in questions.items():
        answer = answers[key]
        if not isinstance(answer, dict) or answer.get('type') != q['type']: raise ValueError('Tipo de resposta inválido.')
        if q['type'] == 'noul':
            if not probability(answer.get('noul')): raise ValueError('Probabilidade inválida.')
            continue
        expected = set(q['criteria']) if q['type'] == 'choice' else set(map(str, range(len(q['criteria']))))
        distribution = answer.get('probabilities', {})
        if not isinstance(distribution, dict): raise ValueError('Distribuição inválida.')
        if set(distribution) != expected or not all(probability(v) for v in distribution.values()) or abs(sum(distribution.values()) - 1) > .02:
            raise ValueError('Distribuição inválida.')
        if not probability(answer.get('confidence')): raise ValueError('Confiança inválida.')
        if q['type'] == 'choice' and answer.get('choice') not in expected: raise ValueError('Classe inválida.')
        if q['type'] == 'score':
            score = answer.get('score')
            if type(score) not in (float, int) or not math.isfinite(score) or not 0 <= score <= len(expected) - 1: raise ValueError('Score inválido.')


def classify(body, settings, local_url=None):
    """Exactly one provider call, no automatic retries/fallback or secret error echoes."""
    official = settings.provider == 'official'
    if official and not settings.api_key:
        raise ProviderError('Configure TYPESAFE_API_KEY no arquivo .env e execute ./start.', 503)
    effective = copy.deepcopy(body) if official else engine_request(body)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if official: headers['Authorization'] = 'Bearer ' + settings.api_key
    url = OFFICIAL_URL if official else (local_url or ENGINE_URL) + '/v1/systemone'
    request = Request(url, data=json.dumps(effective, ensure_ascii=False).encode(), headers=headers, method='POST')
    started = time.perf_counter()
    try:
        opener = OFFICIAL_HTTP.open if official else urlopen
        with opener(request, timeout=30) as result:
            raw = result.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError('Resposta grande demais.')
            response = json.loads(raw)
            timing = result.headers.get('Server-Timing') if not official else None
        validate_response(response, body['questions'])
    except HTTPError as error:
        code = error.code
        error.close()
        messages = {
            401: 'Chave da TypeSafe inválida. Confira TYPESAFE_API_KEY no .env e execute ./start.',
            402: 'A TypeSafe recusou por cobrança/créditos. Confira sua conta.',
            403: 'A TypeSafe negou acesso. Confira as permissões da chave.',
            422: 'A TypeSafe rejeitou o teste. Confira State, Questions e os limites da API.',
            429: 'Limite da API TypeSafe atingido. Aguarde antes de executar novamente.',
            529: 'TypeSafe temporariamente sobrecarregada. Tente novamente mais tarde.',
        }
        message = messages.get(code, 'Falha na API TypeSafe (HTTP ' + str(code) + ').') if official else 'Falha no modelo local (HTTP ' + str(code) + ').'
        raise ProviderError(message, code if code in (401, 402, 403, 422, 429) else 502) from None
    except (TimeoutError, socket.timeout):
        raise ProviderError('A classificação excedeu 30 segundos. Não houve repetição automática.', 504) from None
    except (OSError, URLError):
        raise ProviderError('Não foi possível conectar à TypeSafe. Confira a internet.' if official else 'Não foi possível conectar ao modelo local.') from None
    except (ValueError, TypeError, RecursionError):
        raise ProviderError('Resposta inválida da API TypeSafe.' if official else 'Resposta inválida do modelo local.') from None
    output = {'request': body, 'response': response, 'provider': settings.provider, 'latencyMs': round((time.perf_counter()-started)*1000), 'serverTiming': timing}
    if effective != body: output.update({'requestAdapter': 'jevos-noul-criteria-v1', 'effectiveRequest': effective})
    return output


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        # HTML, CSS and JS must update together. Old scripts can otherwise stop
        # navigation halfway through after a DOM change, hiding saved tests.
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        super().end_headers()
    def json_response(self, status, body, cookie=None):
        content = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
        if cookie: self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', str(len(content))); self.end_headers()
        try: self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError): pass

    # Accounts
    def session_token(self):
        cookie = SimpleCookie()
        try: cookie.load(self.headers.get('Cookie', ''))
        except CookieError: return None
        return cookie[COOKIE].value if COOKIE in cookie else None
    def current_user(self):
        if STORE is None: return None
        try: return STORE.session_user(self.session_token())
        except Exception as error:  # Database outage: behave as signed out, never as signed in.
            self.log_error('session lookup failed: %s', type(error).__name__)
            return None
    def session_cookie(self, token, max_age):
        secure = self.headers.get('X-Forwarded-Proto', '').split(',')[0].strip() == 'https'
        return f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}' + ('; Secure' if secure else '')
    def client_ip(self):
        # Render's proxy appends the visitor address; locally the socket peer is the visitor.
        forwarded = self.headers.get('X-Forwarded-For', '') if os.environ.get('RENDER') else ''
        return forwarded.split(',')[0].strip() or self.client_address[0]
    def allowed_hosts(self):
        port = self.server.server_port
        return {f'127.0.0.1:{port}', f'localhost:{port}', *SETTINGS.allowed_hosts}
    def valid_host(self):
        return (self.headers.get('Host') or '').lower() in self.allowed_hosts()
    def valid_origin(self):
        origin = self.headers.get('Origin')
        return not origin or origin.lower() in {scheme + host for host in self.allowed_hosts() for scheme in ('http://', 'https://')}
    def read_json(self, limit, allow_gzip=False):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= limit: raise OverflowError('Requisição muito grande ou vazia.')
        raw = self.rfile.read(length)
        encoding = self.headers.get('Content-Encoding', '').strip().lower()
        if encoding == 'gzip' and allow_gzip:
            inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
            raw = inflater.decompress(raw, MAX_RECORD_REQUEST + 1)
            if len(raw) > MAX_RECORD_REQUEST or inflater.unconsumed_tail: raise OverflowError('Registro grande demais.')
            if not inflater.eof: raise ValueError('Envio incompleto.')
        elif encoding not in ('', 'identity'): raise ValueError('Codificação não suportada.')
        return json.loads(raw)

    def serve_bytes(self, content, content_type):
        self.send_response(200); self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content))); self.end_headers()
        return io.BytesIO(content)
    def redirect(self, location):
        self.send_response(302); self.send_header('Location', location); self.send_header('Content-Length', '0'); self.end_headers()
    def send_index(self, user):
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        marker = '<body data-page="live">'
        if marker not in html or '</head>' not in html or '</body>' not in html:
            return self.send_error(500, 'index.html sem marcadores de conta')  # Never serve the full menu by accident.
        version = re.search(r'\?v=([\w-]+)', html)
        suffix = '?v=' + version.group(1) if version else ''
        html = html.replace(marker, f'<body data-page="live" data-auth="on" data-role="{user["role"]}" data-username="{user["username"]}">', 1)
        html = html.replace('</head>', f'  <link rel="stylesheet" href="account.css{suffix}">\n</head>', 1)
        html = html.replace('</body>', f'  <script src="account.js{suffix}"></script>\n</body>', 1)
        return self.serve_bytes(html.encode(), 'text/html; charset=utf-8')

    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/healthz':
            try: healthy = STORE is not None and STORE.ping()
            except Exception: healthy = False
            content = b'ok' if healthy else b'database unavailable'
            self.send_response(200 if healthy else 503); self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(content))); self.end_headers()
            self.wfile.write(content); return
        if route.startswith('/api/'):
            if not self.valid_host(): return self.json_response(403, {'error': 'Host não permitido.'})
            if route == '/api/auth/config': return self.json_response(200, {'signup_code_required': bool(SETTINGS.signup_code)})
            user = self.current_user()
            if route == '/api/health': return self.health(user)
            if not user: return self.json_response(401, AUTH_REQUIRED)
            if route == '/api/auth/me': return self.json_response(200, {'user': public_user(user)})
            if route == '/api/records': return self.read_record(user)
            return self.json_response(404, {'error': 'Rota inexistente.'})
        return super().do_GET()
    def health(self, user):
        if not user: return self.json_response(200, {'app': 'norte', 'pid': os.getpid()})
        admin = user['role'] == 'admin'
        if SETTINGS.provider == 'official':
            message = ('Jev oficial · chave configurada' if SETTINGS.api_key else 'Jev oficial · configure TYPESAFE_API_KEY ' + ('em Environment no Render.' if os.environ.get('RENDER') else 'no .env e execute ./start.')) if admin else ('Serviço pronto' if SETTINGS.api_key else 'Serviço indisponível no momento.')
            return self.json_response(200, {'app': 'norte', 'pid': os.getpid(), 'provider': 'official', 'engine': 'jev-latest', 'ready': bool(SETTINGS.api_key), 'message': message, 'remote': True, 'verified': False})
        try:
            with urlopen(ENGINE_URL + '/health', timeout=2) as result: health = json.load(result)
            return self.json_response(200, {'app': 'norte', 'pid': os.getpid(), 'provider': 'local', 'ready': health.get('status') == 'ready', 'engine': 'jevos-v3', 'health': health})
        except (OSError, ValueError): return self.json_response(200, {'app': 'norte', 'pid': os.getpid(), 'provider': 'local', 'ready': False, 'engine': 'jevos-v3', 'message': 'Carregando modelo local…'})
    def send_head(self):
        # Restricts both GET and inherited HEAD, including traversal/encoded paths.
        route = self.path.split('?')[0]
        name = 'index.html' if route == '/' else 'login.html' if route == '/login' else route[1:]
        if name not in ALLOWED and name not in PUBLIC: return self.send_error(404)
        user = self.current_user()
        if name == 'login.html' and user: return self.redirect('/')
        if name not in PUBLIC:
            if not user: return self.redirect('/login') if name.endswith('.html') else self.send_error(401)
            if name in ADMIN_ONLY and user['role'] != 'admin': return self.send_error(404)
            if name == 'index.html': return self.send_index(user)
        self.path = '/' + name
        return super().send_head()

    def do_POST(self):
        if self.path not in POST_ROUTES: return self.send_error(404)
        if not self.valid_host(): return self.json_response(403, {'error': 'Host não permitido.'})
        if not self.valid_origin(): return self.json_response(403, {'error': 'Origem não permitida.'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json': return self.json_response(415, {'error': 'Envie application/json.'})
        if self.path.startswith('/api/auth/'): return self.account(self.path.rsplit('/', 1)[1])
        user = self.current_user()
        if not user: return self.json_response(401, AUTH_REQUIRED)
        if self.path == '/api/records': return self.write_record(user)
        if self.headers.get('X-Norte-Provider') not in (None, SETTINGS.provider): return self.json_response(409, {'error': 'O provedor mudou. Atualize a página e inicie um novo teste.'})
        try:
            body = self.read_json(2_000_000 if self.path == '/api/minutes' else 64000)
            if self.path == '/api/minutes': gemini_minutes.validate_source(body)
            else: validate_request(body)
        except (ValueError, TypeError, RecursionError, OverflowError) as error: return self.json_response(400, {'error': str(error)})
        # Independent bounded lanes: relation latency cannot hold the chunk lock.
        lane = lanes_for(user['id'])[self.path[len('/api/'):]]
        if not lane.acquire(blocking=False):
            if self.path == '/api/minutes': return self.json_response(429, {'error':'Há uma organização em andamento. Aguarde um momento e tente novamente.','code':'busy','retryable':True,'retry_after_seconds':5})
            return self.json_response(429, {'error': 'Worker ocupado; tente novamente.'})
        try:
            if self.path == '/api/minutes': return self.json_response(200, gemini_minutes.generate(body['source'], load_settings()))
            return self.json_response(200, classify(body, SETTINGS))
        except (OSError, ValueError): return self.json_response(503, {'error': 'Não foi possível carregar a configuração do servidor.'})
        except gemini_minutes.MinutesError as error: return self.json_response(error.status, error.response())
        except ProviderError as error: return self.json_response(error.status, {'error': str(error)})
        finally: lane.release()

    def account(self, action):
        if STORE is None: return self.json_response(503, {'error': 'Contas indisponíveis neste servidor.'})
        try: body = self.read_json(4096)
        except (ValueError, TypeError, RecursionError, OverflowError): return self.json_response(400, {'error': 'Requisição inválida.'})
        try:
            if action == 'logout':
                STORE.delete_session(self.session_token())
                return self.json_response(200, {'ok': True}, cookie=self.session_cookie('', 0))
            if not isinstance(body, dict): raise auth.AuthError('Requisição inválida.')
            ip = self.client_ip()
            if action == 'signup':
                if SIGNUP_THROTTLE.blocked(ip): raise auth.AuthError('Muitas contas criadas a partir desta rede. Tente novamente mais tarde.', 429)
                if SETTINGS.signup_code and not hmac.compare_digest(str(body.get('code', '')).strip().encode(), SETTINGS.signup_code.encode()):
                    raise auth.AuthError('Código de convite inválido.', 403)
                username = auth.normalize_username(body.get('username'))
                if username in auth.RESERVED or username == SETTINGS.admin_username.lower():
                    raise auth.AuthError('Este nome de usuário é reservado. Escolha outro.', 409)
                user = STORE.create_user(username, auth.check_password(body.get('password')))
                SIGNUP_THROTTLE.hit(ip)
            else:
                if NETWORK_THROTTLE.blocked(ip): raise auth.AuthError('Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429)
                try: username = auth.normalize_username(body.get('username'))
                except auth.AuthError: username = ''
                key = ip + '|' + username
                if LOGIN_THROTTLE.blocked(key): raise auth.AuthError('Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429)
                password = body.get('password')
                user = STORE.authenticate(username, password) if username and isinstance(password, str) and len(password) <= 128 else None
                if not user:
                    LOGIN_THROTTLE.hit(key); NETWORK_THROTTLE.hit(ip)
                    raise auth.AuthError('Usuário ou senha incorretos.', 401)
                LOGIN_THROTTLE.reset(key)
            token = STORE.create_session(user['id'])
        except auth.AuthError as error: return self.json_response(error.status, {'error': str(error)})
        except Exception as error:
            self.log_error('account %s failed: %s', action, type(error).__name__)
            return self.json_response(503, {'error': 'O banco de dados não respondeu. Tente novamente em instantes.'})
        return self.json_response(200, {'user': public_user(user)}, cookie=self.session_cookie(token, auth.SESSION_SECONDS))

    def read_record(self, user):
        key = parse_qs(urlsplit(self.path).query).get('key', [''])[0]
        if not auth.valid_record_key(key): return self.json_response(400, {'error': 'Registro inválido.'})
        try: value, version = STORE.get_record(user['id'], key)
        except Exception as error:
            self.log_error('record read failed: %s', type(error).__name__)
            return self.json_response(503, {'error': 'O banco de dados não respondeu. Tente novamente em instantes.'})
        return self.json_response(200, {'value': value, 'version': version})
    def write_record(self, user):
        try:
            body = self.read_json(MAX_RECORD_REQUEST, allow_gzip=True)
            if not isinstance(body, dict) or set(body) - {'key', 'value', 'expected_version'}: raise ValueError('Registro inválido.')
            key, value, expected = body.get('key'), body.get('value'), body.get('expected_version')
            if not auth.valid_record_key(key) or not (value is None or isinstance(value, str)): raise ValueError('Registro inválido.')
            if not (expected is None or type(expected) is int and expected >= 0): raise ValueError('Versão inválida.')
            if value is not None and len(value) > auth.MAX_RECORD_CHARS: raise OverflowError('Registro grande demais.')
        except OverflowError: return self.json_response(413, {'error': 'Esta reunião ficou grande demais para salvar na conta.'})
        except (ValueError, TypeError, RecursionError, zlib.error) as error: return self.json_response(400, {'error': str(error) or 'Registro inválido.'})
        try:
            version = STORE.put_record(user['id'], key, value, expected)
            if version is None:
                current, version = STORE.get_record(user['id'], key)
                return self.json_response(409, {'error': 'O registro mudou em outra aba.', 'value': current, 'version': version})
        except Exception as error:
            self.log_error('record write failed: %s', type(error).__name__)
            return self.json_response(503, {'error': 'O banco de dados não respondeu. Tente novamente em instantes.'})
        return self.json_response(200, {'version': version})


def open_store(settings):
    """Postgres when DATABASE_URL is set; otherwise a SQLite file kept out of git."""
    sqlite_path = Path(os.environ.get('NORTE_SQLITE_PATH') or ROOT / '.runtime/norte.sqlite3')
    if not settings.database_url: sqlite_path.parent.mkdir(exist_ok=True)
    store = auth.Store(settings.database_url, sqlite_path)
    if settings.admin_password:
        store.ensure_admin(auth.normalize_username(settings.admin_username), auth.check_password(settings.admin_password))
    else:
        print('Aviso: ADMIN_PASSWORD não definido; nenhuma conta admin foi criada ou atualizada.', flush=True)
    return store


def main():
    global ENGINE_URL, SETTINGS, STORE
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8000')))
    args = parser.parse_args()
    try: SETTINGS = load_settings()
    except (OSError, ValueError) as error: raise SystemExit(str(error))
    try: STORE = open_store(SETTINGS)
    except auth.AuthError as error: raise SystemExit('ADMIN_USERNAME/ADMIN_PASSWORD: ' + str(error))
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    engine, engine_log = None, None
    if SETTINGS.provider == 'local':
        binary = ROOT / '.runtime/jevos/jev'
        if not binary.exists(): raise SystemExit('Execute ./setup para instalar o modelo local.')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); model_port = sock.getsockname()[1]
        ENGINE_URL = f'http://127.0.0.1:{model_port}'
        engine_log = (ROOT / '.runtime/model.log').open('ab')
        engine = subprocess.Popen([str(binary), 'serve', '--port', str(model_port), '--host', '127.0.0.1', '--threads', str(min(4, os.cpu_count() or 2)), '--warmup', '0', '--state-cache', '2'], cwd=binary.parent, stdout=engine_log, stderr=engine_log)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    try:
        print(f'Norte: http://{args.host}:{args.port} · banco: {STORE.dialect}', flush=True)
        server.serve_forever()
    finally:
        server.server_close()
        if engine:
            engine.terminate()
            try: engine.wait(timeout=8)
            except subprocess.TimeoutExpired: engine.kill(); engine.wait()
        if engine_log: engine_log.close()
        STORE.close()


if __name__ == '__main__': main()
