#!/usr/bin/env python3
"""Prepare or inspect the Node.js and Python tools used by Norte.

./prepare-local installs missing tools; ./diagnose-local only checks them.
Existing system installations and files under .runtime are preserved.
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get('NORTE_RUNTIME_DIR') or ROOT / '.runtime')
ASSETS = json.loads((ROOT / 'scripts/local_assets.json').read_text())


def run(command, **kwargs):
    return subprocess.run(command, capture_output=True, text=True, timeout=kwargs.pop('timeout', 120), **kwargs)


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.part')
    try:
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output, 1 << 20)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def node_version(binary):
    if not binary: return None
    try:
        result = run([str(binary), '-p', 'process.versions.node'], timeout=10)
        version = result.stdout.strip()
        numbers = tuple(int(part) for part in version.split('.')[:2])
        return version if result.returncode == 0 and numbers >= (24, 20) else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def node_status(prepare):
    system = shutil.which('node')
    version = node_version(system)
    if version: return {'state': 'ready', 'source': 'system', 'version': version}
    spec = ASSETS['node']
    local = ROOT / spec['dir'] / 'bin/node'
    version = node_version(local)
    if version: return {'state': 'ready', 'source': 'app copy', 'version': version}
    if not prepare: return {'state': 'missing', 'message': 'Node.js 24.20+ ausente.'}
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        return {'state': 'missing', 'message': 'Instale Node.js 24.20+ para o seu sistema e execute ./setup.'}
    tools = ROOT / '.runtime/tools'
    archive = tools / Path(spec['url']).name
    checksums = tools / 'SHASUMS256.txt'
    download(spec['shasums'], checksums)
    expected = next((line.split()[0] for line in checksums.read_text().splitlines()
                     if line.split()[-1] == archive.name), None)
    if not expected or not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
        raise ValueError('O manifesto oficial não contém o checksum do Node.js esperado.')
    download(spec['url'], archive)
    with archive.open('rb') as handle:
        actual = hashlib.file_digest(handle, 'sha256').hexdigest()
    if actual.lower() != expected.lower():
        archive.unlink(missing_ok=True)
        raise ValueError('Checksum do Node.js divergente. Download descartado.')
    with tarfile.open(archive) as package:
        package.extractall(tools, filter='data')
    archive.unlink(missing_ok=True)
    version = node_version(local)
    return {'state': 'ready' if version else 'error', 'source': 'verified app copy', 'version': version}


def python_status(prepare):
    python = ROOT / '.venv/bin/python'
    if not python.exists() and prepare:
        result = run([sys.executable, '-m', 'venv', str(ROOT / '.venv')], timeout=300)
        if result.returncode: return {'state': 'error', 'message': 'Não foi possível criar .venv. Instale python3-venv.'}
    if not python.exists(): return {'state': 'missing', 'message': 'Ambiente Python (.venv) ausente.'}
    requirements = ROOT / 'requirements.txt'
    wanted = {}
    for line in requirements.read_text().splitlines():
        match = re.fullmatch(r'([\w-]+)(?:\[[\w,-]+\])?==([^\s#]+)', line.strip())
        if match: wanted[match[1].lower().replace('_', '-')] = match[2]
    listing = run([str(python), '-m', 'pip', 'list', '--format=json'])
    if listing.returncode: return {'state': 'error', 'message': 'pip indisponível em .venv.'}
    have = {item['name'].lower().replace('_', '-'): item['version'] for item in json.loads(listing.stdout)}
    missing = {name: version for name, version in wanted.items() if have.get(name) != version}
    if missing and prepare:
        result = run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', str(requirements)], timeout=900)
        if result.returncode: return {'state': 'error', 'message': 'Instalação das dependências Python falhou. Confira a conexão e requirements.txt.'}
        return python_status(False)
    return {'state': 'ready' if not missing else 'incomplete', 'missingOrDifferent': missing}


def poppler_status():
    missing = [name for name in ('pdftotext', 'pdfinfo') if not shutil.which(name)]
    return {'state': 'missing' if missing else 'ready', **({'message': 'Instale poppler-utils no sistema para ler os PDFs.'} if missing else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verificar ferramentas sem downloads')
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'mode': 'check' if args.check else 'prepare'}
    for name, check in (('node', node_status), ('python', python_status)):
        report[name] = check(not args.check)
    report['poppler'] = poppler_status()
    ready = all(report[key]['state'] == 'ready' for key in ('node', 'python', 'poppler'))
    report['toolsReady'] = ready
    target = RUNTIME / 'bootstrap/tools-ready.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    for key in ('node', 'python', 'poppler'):
        print(f"{key}: {json.dumps(report[key], ensure_ascii=False)}")
    print('Ferramentas prontas. Use ./setup para compilar a interface.' if ready else 'Ferramentas incompletas. Confira as indicações acima.')
    return 0 if ready else 1


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(f'Não foi possível preparar as ferramentas: {type(error).__name__}. Confira a conexão e as permissões.') from None
