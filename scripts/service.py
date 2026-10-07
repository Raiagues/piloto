#!/usr/bin/env python3
"""Manage only the server belonging to this checkout; never stop an unrelated PID."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
PID = RUNTIME / 'server.pid'


def owned_server():
    if not PID.exists(): return None
    try:
        saved = json.loads(PID.read_text())
        number = saved if isinstance(saved, int) else saved['pid']
        if not isinstance(number, int) or number <= 1: return None
        proc = Path(f'/proc/{number}')
        cmd = (proc / 'cmdline').read_bytes().split(b'\0')
        if (proc / 'cwd').resolve() != ROOT or proc.stat().st_uid != os.getuid(): return None
        is_current = str(ROOT / 'server.py').encode() in cmd
        is_legacy = b'http.server' in cmd and b'127.0.0.1' in cmd
        if not is_current and not is_legacy: return None
        return number, saved.get('port', 8000) if isinstance(saved, dict) else 8000, is_current
    except (OSError, ValueError, TypeError, KeyError): return None


def stop():
    found = owned_server()
    if found:
        os.kill(found[0], signal.SIGTERM)
        for _ in range(100):
            try:
                status = Path(f'/proc/{found[0]}/stat').read_text().split(') ')[1][0]
                if status == 'Z': break
            except OSError: break
            time.sleep(.1)
        else: raise SystemExit('O servidor ainda está encerrando. Tente ./stop novamente.')
    if PID.exists(): PID.unlink()
    print('Site encerrado.' if found else 'O site já estava parado.')


def start():
    found = owned_server()
    if found: stop()  # ./start also applies edited .env/server code, only in this checkout.
    port = int(os.environ.get('PORT', '8000'))
    if not 1024 <= port <= 65535: raise SystemExit('PORT precisa estar entre 1024 e 65535.')
    with (RUNTIME / 'server.log').open('ab') as log:
        child = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', str(port)], cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    PID.write_text(json.dumps({'pid': child.pid, 'port': port}))
    for _ in range(80):
        if child.poll() is not None:
            PID.unlink(missing_ok=True)
            raise SystemExit('Falha ao iniciar. Consulte .runtime/server.log.')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=.4) as response:
                if json.load(response).get('pid') == child.pid: break
        except OSError: pass
        time.sleep(.1)
    else:
        child.terminate(); child.wait(timeout=10); PID.unlink(missing_ok=True)
        raise SystemExit('O servidor não respondeu. Consulte .runtime/server.log.')
    print(f'Site iniciado em http://127.0.0.1:{port}\nPara aplicar alterações no .env: ./start. Para encerrar: ./stop')
    return port


if __name__ == '__main__':
    RUNTIME.mkdir(exist_ok=True)
    with (RUNTIME / 'service.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if sys.argv[1] == 'stop': stop()
        else:
            port = start()
            if os.environ.get('NORTE_NO_BROWSER') != '1':
                try: subprocess.Popen(['xdg-open', f'http://127.0.0.1:{port}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                except OSError: pass
