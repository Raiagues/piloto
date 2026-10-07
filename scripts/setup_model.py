#!/usr/bin/env python3
"""Install the pinned jevos release inside this project, without system changes."""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
DEST = RUNTIME / 'jevos'
ASSETS = [
    ('jev-linux-x64.tar.gz', '09a85acf942c92d068bfc455f6bd4b61f4282a09848abd81998c59262c3aafd7'),
    ('jevos-v3-openvino-int8.zip', 'f473c3793fd02566b3c53a7c2b1e8fe223aa3763e7c51222f596bed433b22b75'),
]


def main():
    if (DEST / '.ready-v3').exists() and (DEST / 'jev').exists() and (DEST / 'model/model.json').exists():
        print('jevos-v3 pronto.'); return
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        raise SystemExit('O setup automático do modelo está preparado para Linux x86_64.')
    RUNTIME.mkdir(exist_ok=True)
    if shutil.disk_usage(RUNTIME).free < 1_800_000_000:
        raise SystemExit('O primeiro setup precisa de pelo menos 1,8 GB livres para baixar e extrair o modelo.')
    with tempfile.TemporaryDirectory(prefix='model-install-', dir=RUNTIME) as temporary:
        staging = Path(temporary)
        extracted = staging / 'extracted'
        extracted.mkdir()
        for name, expected in ASSETS:
            archive = staging / name
            print(f'Baixando {name}…', flush=True)
            digest = hashlib.sha256()
            url = f'https://github.com/feder-cr/jev/releases/download/jevos-v3/{name}'
            request = urllib.request.Request(url, headers={'User-Agent': 'Norte-local-setup'})
            with urllib.request.urlopen(request, timeout=90) as response, archive.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk); digest.update(chunk)
            if digest.hexdigest() != expected:
                raise SystemExit(f'Checksum incorreto: {name}. Instalação cancelada.')
            if name.endswith('.tar.gz'):
                with tarfile.open(archive) as source:
                    source.extractall(extracted, filter='data')
            else:
                with zipfile.ZipFile(archive) as source:
                    for member in source.infolist():
                        target = (extracted / member.filename).resolve()
                        if not target.is_relative_to(extracted.resolve()):
                            raise SystemExit('Caminho inválido no arquivo do modelo.')
                    source.extractall(extracted)
            archive.unlink()  # Only our verified, disposable download; install files remain.
        binary = next(p for p in extracted.rglob('jev') if p.is_file())
        model = next(extracted.rglob('model.json')).parent
        DEST.mkdir(exist_ok=True)
        for item in binary.parent.iterdir():
            if item == model or item.name == 'model':
                continue
            if item.is_dir(): shutil.copytree(item, DEST / item.name, dirs_exist_ok=True)
            else: shutil.copy2(item, DEST / item.name)
        shutil.copytree(model, DEST / 'model', dirs_exist_ok=True)
        (DEST / 'jev').chmod((DEST / 'jev').stat().st_mode | 0o111)
        (DEST / '.ready-v3').write_text('jevos-v3\n', encoding='utf8')
    print('Modelo instalado no projeto. Use ./start.', flush=True)


if __name__ == '__main__':
    main()
