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
import threading
import time
import zlib
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
import auth
from config import Settings, load_settings
from meetings.engine import gemini_minutes
from meetings.engine import meeting_bridge
from meetings.engine import ai_runtime

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / 'meetings' / 'web'


def meeting_return_path(value):
    """Only return to a meeting in this app; never redirect to user-supplied hosts."""
    if not isinstance(value, str) or len(value) > 1000 or '\\' in value or any(ord(c) < 32 for c in value):
        return '/'
    try:
        target = urlsplit(value)
        if target.scheme or target.netloc or target.path not in ('/', '/index.html'):
            return '/'
        query = parse_qs(target.query)
        meeting, event = query.get('meeting', [''])[0], query.get('event', [''])[0]
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', meeting): return '/'
        if event and not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', event): return '/'
        params = {'meeting': meeting}
        if event: params['event'] = event
        fragment = '#' + target.fragment if target.fragment in ('reuniao', 'simulacao') else ''
        return '/?' + urlencode(params) + fragment
    except ValueError:
        return '/'


# Explicit assets only; engine sources and retired laboratory pages are never served.
ALLOWED = {'memory-storage.js', 'relation-worker.js', 'layout.js', 'meeting-session.js', 'meeting-canvas.css', 'meeting-speech.js', 'memory-flow.js', 'meeting-room.css', 'meeting-room.js', 'experiments.js', 'meeting-state.js', 'meeting-amendments.js', 'gemini-minutes.css', 'meeting-hierarchy.js', 'meeting-i18n.js', 'meeting-review.js', 'meeting-evidence.js', 'base.css', 'meeting-blocks.js', 'classifier-transport.js', 'meeting-commands.js', 'norte-meeting-bridge.js', 'index.html', 'meeting-minutes.css', 'speech-windows.js', 'meeting-blocks.css', 'vendor/minutes/DejaVuSans-Bold-2.37.ttf', 'vendor/minutes/DejaVuSans-2.37.ttf', 'norte-meeting-bridge.css', 'tokens.css', 'remote-storage.js', 'meeting-canvas.js', 'typed-relations.js', 'meeting-minutes.js', 'gemini-minutes.js', 'vendor/minutes/jspdf-4.2.1.umd.min.js', 'transcription.js', 'meeting-document.js', 'memory-v2.js'}
# Preserve account login for standalone deployments.
PUBLIC = {'login.html', 'auth.css', 'auth.js'}
SETTINGS = Settings()
OFFICIAL_URL = 'https://api.typesafe.ai/v1/systemone'
STORE = None
AI_RUNTIME = None
COOKIE = 'norte_session'
AUTH_REQUIRED = {'error': 'Entre na sua conta para continuar.', 'code': 'auth'}
LOGIN_THROTTLE = auth.Throttle(8, 15 * 60)
NETWORK_THROTTLE = auth.Throttle(40, 15 * 60)
SIGNUP_THROTTLE = auth.Throttle(10, 60 * 60)
MAX_RECORD_REQUEST = 32_000_000
POST_ROUTES = ('/api/classify', '/api/relations', '/api/typed-relations', '/api/minutes', '/api/records',
               '/api/auth/login', '/api/auth/signup', '/api/auth/logout',
               '/api/ai/blocks/review', '/api/ai/blocks/feedback', '/api/ai/blocks/learning', '/api/ai/blocks/inspect')
AI_THROTTLE = auth.Throttle(120, 60)
AI_ADMIN_THROTTLE = auth.Throttle(10, 60)
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
    if body['model'] not in ('jev-latest', SETTINGS.jev_model): raise ValueError('Use jev-latest ou o modelo configurado em JEV_MODEL.')
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


def classify(body, settings):
    """Exactly one provider call, no automatic retries/fallback or secret error echoes."""
    if settings.provider != 'official': raise ProviderError('Use o provedor oficial configurado.', 400)
    if not settings.api_key:
        raise ProviderError('Configure TYPESAFE_API_KEY no arquivo .env e execute ./start.', 503)
    effective = copy.deepcopy(body)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    headers['Authorization'] = 'Bearer ' + settings.api_key
    url = OFFICIAL_URL
    request = Request(url, data=json.dumps(effective, ensure_ascii=False).encode(), headers=headers, method='POST')
    started = time.perf_counter()
    try:
        with OFFICIAL_HTTP.open(request, timeout=30) as result:
            raw = result.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError('Resposta grande demais.')
            response = json.loads(raw)
            timing = None
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
        message = messages.get(code, 'Falha na API TypeSafe (HTTP ' + str(code) + ').')
        raise ProviderError(message, code if code in (401, 402, 403, 422, 429) else 502) from None
    except (TimeoutError, socket.timeout):
        raise ProviderError('A classificação excedeu 30 segundos. Não houve repetição automática.', 504) from None
    except (OSError, URLError):
        raise ProviderError('Não foi possível conectar à TypeSafe. Confira a internet.') from None
    except (ValueError, TypeError, RecursionError):
        raise ProviderError('Resposta inválida da API TypeSafe.') from None
    output = {'request': body, 'response': response, 'provider': settings.provider, 'latencyMs': round((time.perf_counter()-started)*1000), 'serverTiming': timing}
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
        if hasattr(self, '_bridge_user'): return self._bridge_user
        try:
            if meeting_bridge.enabled() or self.headers.get('X-Norte-Bridge-Signature'):
                self._bridge_user = None
                length = int(self.headers.get('Content-Length', '0'))
                if length < 0 or length > MAX_RECORD_REQUEST: return None
                self._bridge_raw = self.rfile.read(length) if length else b''
                if len(self._bridge_raw) != length: return None
                identity = meeting_bridge.verify(self.command, self.path, self.headers, self._bridge_raw, self.client_address[0])
                if identity: self._bridge_user = meeting_bridge.storage_user(STORE, identity)
                return self._bridge_user
            return STORE.session_user(self.session_token())
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
        raw = self._bridge_raw if hasattr(self, '_bridge_raw') else self.rfile.read(length)
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
        html = (WEB_ROOT / 'index.html').read_text(encoding='utf-8')
        marker = '<body data-page="meeting">'
        if marker not in html or '</head>' not in html or '</body>' not in html:
            return self.send_error(500, 'index.html sem marcadores de conta')
        html = html.replace(marker, f'<body data-page="meeting" data-auth="on" data-role="{user["role"]}" data-username="{user["username"]}">', 1)
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
        return self.json_response(503, {'error': 'Provedor indisponível.'})
    def send_head(self):
        # Restricts both GET and inherited HEAD, including traversal/encoded paths.
        route = self.path.split('?')[0]
        name = 'index.html' if route == '/' else 'login.html' if route == '/login' else route[1:]
        if name not in ALLOWED and name not in PUBLIC: return self.send_error(404)
        user = self.current_user()
        if name == 'login.html' and user:
            return self.redirect(meeting_return_path(parse_qs(urlsplit(self.path).query).get('next', ['/'])[0]))
        if name not in PUBLIC:
            if not user:
                destination = meeting_return_path(self.path)
                login = '/login' + ('?' + urlencode({'next': destination}) if destination != '/' else '')
                return self.redirect(login) if name.endswith('.html') else self.send_error(401)
            if name == 'index.html': return self.send_index(user)
        path = ROOT / name if name in PUBLIC else ROOT / 'norte/src/styles/tokens.css' if name == 'tokens.css' else WEB_ROOT / name
        try: return self.serve_bytes(path.read_bytes(), self.guess_type(str(path)))
        except OSError: return self.send_error(404)

    def do_POST(self):
        if self.path not in POST_ROUTES: return self.send_error(404)
        if not self.valid_host(): return self.json_response(403, {'error': 'Host não permitido.'})
        if not self.valid_origin(): return self.json_response(403, {'error': 'Origem não permitida.'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json': return self.json_response(415, {'error': 'Envie application/json.'})
        if self.path.startswith('/api/auth/'):
            if meeting_bridge.enabled(): return self.json_response(403, {'error': 'Entre pela conta do Norte.'})
            return self.account(self.path.rsplit('/', 1)[1])
        user = self.current_user()
        if not user: return self.json_response(401, AUTH_REQUIRED)
        if self.path == '/api/records': return self.write_record(user)
        if self.path.startswith(('/api/ai/', '/api/admin/ai/')): return self.ai_request(user)
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
        started = time.monotonic()
        usage_result, usage_status, usage_provider, usage_model = {}, 'error', 'jev', SETTINGS.jev_model
        if self.path == '/api/minutes': usage_provider, usage_model = 'gemini', SETTINGS.gemini_model
        try:
            if self.path == '/api/minutes':
                if AI_RUNTIME is not None and not AI_RUNTIME.reserve_minutes_call():
                    usage_status = 'skipped'
                    raise gemini_minutes.MinutesError('O limite diário de organização de atas foi atingido. O documento atual foi preservado. Tente no próximo dia ou contate o administrador.', 429, 'daily_limit', False)
                result = gemini_minutes.generate(body['source'], SETTINGS)
                usage_result = {'usageMetadata': result.get('usage_metadata', {})}
                usage_status = 'success'
                return self.json_response(200, result)
            effective = AI_RUNTIME.blocks.apply_learning(user['id'], body) if AI_RUNTIME is not None and self.path == '/api/classify' else body
            validate_request(effective)
            result = classify(effective, SETTINGS)
            # The original request stays auditable; the contextual prompt has its
            # own versioned history and must not replace transcript evidence.
            result['request'] = body
            if self.path == '/api/classify':
                state = effective.get('state')
                result['learning_version'] = state.get('meeting_feedback', {}).get('version', 0) if isinstance(state, dict) else 0
            usage_result, usage_status = result.get('response', {}), 'success'
            return self.json_response(200, result)
        except (OSError, ValueError): return self.json_response(503, {'error': 'Não foi possível carregar a configuração do servidor.'})
        except gemini_minutes.MinutesError as error: return self.json_response(error.status, error.response())
        except ProviderError as error: return self.json_response(error.status, {'error': str(error)})
        finally:
            lane.release()
            if AI_RUNTIME is not None and usage_status != 'skipped':
                try: AI_RUNTIME.record_usage(user['id'], usage_provider, usage_model, self.path.rsplit('/', 1)[-1], usage_result, (time.monotonic() - started) * 1000, usage_status)
                except Exception as error: self.log_error('AI usage write failed: %s', type(error).__name__)

    def ai_request(self, user):
        admin = self.path.startswith('/api/admin/')
        if admin and user['role'] != 'admin': return self.json_response(403, {'error': 'Acesso restrito ao administrador.'})
        if AI_RUNTIME is None: return self.json_response(503, {'error': 'Agentes ainda não inicializados.'})
        throttle = AI_ADMIN_THROTTLE if admin else AI_THROTTLE
        if throttle.blocked(user['id']): return self.json_response(429, {'error': 'Muitas solicitações; tente novamente em instantes.'})
        throttle.hit(user['id'])
        try:
            body = self.read_json(64000)
            if not isinstance(body, dict): raise ValueError('Requisição inválida.')
            if self.path == '/api/ai/blocks/review': result = AI_RUNTIME.blocks.review(user['id'], body)
            elif self.path == '/api/ai/blocks/feedback': result = AI_RUNTIME.blocks.feedback(user['id'], body)
            elif self.path == '/api/ai/blocks/learning': result = AI_RUNTIME.blocks.learning(user['id'], body)
            elif self.path == '/api/ai/blocks/inspect': result = AI_RUNTIME.blocks.inspect(user['id'], body)
            else: return self.json_response(404, {'error': 'Rota inexistente.'})
            return self.json_response(200, result)
        except (ValueError, TypeError, RecursionError, OverflowError) as error:
            return self.json_response(400, {'error': str(error) or 'Requisição inválida.'})
        except Exception as error:
            self.log_error('AI request failed: %s', type(error).__name__)
            return self.json_response(503, {'error': 'Não foi possível concluir a solicitação dos agentes.'})

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
    global SETTINGS, STORE, AI_RUNTIME
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8000')))
    args = parser.parse_args()
    if meeting_bridge.enabled() and (args.host not in ('127.0.0.1', 'localhost', '::1') or len(os.environ.get('NORTE_MEETING_BRIDGE_SECRET', '')) < 32):
        raise SystemExit('A ponte Norte exige endereço local e segredo privado de pelo menos 32 caracteres.')
    try: SETTINGS = load_settings()
    except (OSError, ValueError) as error: raise SystemExit(str(error))
    try: STORE = open_store(SETTINGS)
    except auth.AuthError as error: raise SystemExit('ADMIN_USERNAME/ADMIN_PASSWORD: ' + str(error))
    AI_RUNTIME = ai_runtime.Runtime(STORE, SETTINGS)
    AI_RUNTIME.start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    try:
        print(f'Norte: http://{args.host}:{args.port} · banco: {STORE.dialect}', flush=True)
        server.serve_forever()
    finally:
        server.server_close()
        AI_RUNTIME.stop()
        STORE.close()


if __name__ == '__main__': main()
