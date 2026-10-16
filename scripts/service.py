#!/usr/bin/env python3
"""Own and supervise the Norte web server and its private meeting worker."""
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
PID = RUNTIME / 'server.pid'


def environment():
    values = {}
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if line.startswith('export '): line = line[7:].strip()
            if '=' not in line: continue
            name, value = line.split('=', 1)
            name, value = name.strip(), value.strip()
            if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name): continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"): value = value[1:-1]
            values[name] = value
    values.update(os.environ)
    if values.get('RENDER') and not values.get('DATABASE_URL', '').strip():
        raise SystemExit('DATABASE_URL é obrigatória no Render; o disco local não preserva os dados após um deploy.')
    defaults = {'NORTE_DEMO_PROFILE': 'validation', 'GEMINI_EXTRACTION_MODEL': 'gemini-3.8-flash',
        'GEMINI_EXTRACTION_THINKING_LEVEL': 'low', 'GEMINI_DISCOVERY_MODEL': 'gemini-3.5-flash-lite',
        'GEMINI_DISCOVERY_THINKING_LEVEL': 'minimal', 'GEMINI_ORGANIZATION_MODEL': 'gemini-3.5-flash-lite',
        'NORTE_EXTRACTION_CACHE_DIR': str(RUNTIME / 'extraction-cache')}
    for key, value in defaults.items(): values.setdefault(key, value)
    if not values.get('DATABASE_URL'): values.setdefault('NORTE_STORE_FILE', str(RUNTIME / 'norte-data.json'))
    if not values.get('NORTE_MEETING_BRIDGE_SECRET'):
        key_file = RUNTIME / 'meeting-bridge.key'
        if not key_file.exists():
            descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as handle: handle.write(secrets.token_hex(32))
        key_file.chmod(0o600)
        values['NORTE_MEETING_BRIDGE_SECRET'] = key_file.read_text().strip()
    if len(values['NORTE_MEETING_BRIDGE_SECRET']) < 32: raise SystemExit('A chave privada da ponte precisa ter ao menos 32 caracteres.')
    return values


def owned_server():
    try:
        saved = json.loads(PID.read_text())
        number = saved if isinstance(saved, int) else saved['pid']
        if not isinstance(number, int) or number <= 1: return None
        proc = Path(f'/proc/{number}')
        cmd = (proc / 'cmdline').read_bytes().split(b'\0')
        if (proc / 'cwd').resolve() != ROOT or proc.stat().st_uid != os.getuid(): return None
        if str(ROOT / 'server.py').encode() not in cmd and not (str(ROOT / 'scripts/service.py').encode() in cmd and b'serve' in cmd): return None
        return number, saved.get('port', 8000) if isinstance(saved, dict) else 8000
    except (OSError, ValueError, TypeError, KeyError): return None


def stop():
    found = owned_server()
    if found:
        os.kill(found[0], signal.SIGTERM)
        for _ in range(350):
            try:
                if Path(f'/proc/{found[0]}/stat').read_text().split(') ')[1][0] == 'Z': break
            except OSError: break
            time.sleep(.1)
        else: raise SystemExit('O site ainda está encerrando. Tente ./stop novamente.')
    PID.unlink(missing_ok=True)
    print('Site encerrado.' if found else 'O site já estava parado.')


def health(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=.6) as response: return json.load(response)
    except (OSError, ValueError): return {}


def serve():
    env = environment()
    port, worker_port = int(env.get('PORT', '8000')), int(env.get('NORTE_MEETING_PORT', '8790'))
    if port == worker_port or not all(1024 <= p <= 65535 for p in (port, worker_port)): raise SystemExit('Escolha duas portas diferentes, entre 1024 e 65535.')
    env.update(PORT=str(port), NORTE_MEETING_BACKEND_URL=f'http://127.0.0.1:{worker_port}', NORTE_BRIDGE_ONLY='1')
    if env.get('NODE_ENV') != 'production': env.setdefault('NORTE_API_HOST', '127.0.0.1')
    children, stopping = [], False
    def shutdown(*_args):
        nonlocal stopping
        stopping = True
        for child in children:
            if child.poll() is None: child.terminate()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        worker = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--host', '127.0.0.1', '--port', str(worker_port)], cwd=ROOT, env=env)
        children.append(worker)
        for _ in range(100):
            if stopping or worker.poll() is not None: return 1
            if health(worker_port).get('pid') == worker.pid: break
            time.sleep(.1)
        else: raise RuntimeError('O trabalhador privado de reuniões não iniciou.')
        children.append(subprocess.Popen(['node', str(ROOT / 'norte/server/index.mjs')], cwd=ROOT / 'norte', env=env))
        while not stopping and all(child.poll() is None for child in children): time.sleep(.25)
        return 0 if stopping else 1
    finally:
        shutdown()
        # Both children receive SIGTERM together. Share one grace period so
        # waiting for Node cannot give Python a second full period and make
        # the launcher report a failed stop while shutdown is still running.
        deadline = time.monotonic() + 20
        for child in reversed(children):
            try: child.wait(timeout=max(.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired: pass
        for child in children:
            if child.poll() is None: child.kill()
        for child in children:
            child.wait(timeout=5)


def start():
    if owned_server(): stop()
    port = int(environment().get('PORT', '8000'))
    with (RUNTIME / 'server.log').open('ab') as log:
        child = subprocess.Popen([sys.executable, str(ROOT / 'scripts/service.py'), 'serve'], cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    PID.write_text(json.dumps({'pid': child.pid, 'port': port, 'kind': 'norte-integrated'})); PID.chmod(0o600)
    for _ in range(150):
        if child.poll() is not None:
            PID.unlink(missing_ok=True); raise SystemExit('Falha ao iniciar. Consulte .runtime/server.log.')
        if health(port).get('supervisorPid') == child.pid: break
        time.sleep(.1)
    else:
        child.terminate(); child.wait(timeout=30); PID.unlink(missing_ok=True)
        raise SystemExit('O Norte não respondeu. Consulte .runtime/server.log.')
    print(f'Norte iniciado em http://127.0.0.1:{port}\nUse a conta de teste para abrir o Quetzal-1.\n./start aplica alterações; ./stop encerra os dois serviços.')
    return port


if __name__ == '__main__':
    RUNTIME.mkdir(exist_ok=True, mode=0o700)
    if len(sys.argv) > 1 and sys.argv[1] == 'serve': sys.exit(serve())
    with (RUNTIME / 'service.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if len(sys.argv) > 1 and sys.argv[1] == 'stop': stop()
        else:
            port = start()
            if os.environ.get('NORTE_NO_BROWSER') != '1':
                try: subprocess.Popen(['xdg-open', f'http://127.0.0.1:{port}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                except OSError: pass
