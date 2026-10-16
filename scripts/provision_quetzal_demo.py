#!/usr/bin/env python3
"""Restore only missing public corpus files from the pinned checked-in manifest.

The manifest and existing files are immutable. Originals, extracted text and page
maps must match all recorded SHA-256 hashes before any missing file is published.
No evaluation sources, LLM calls, credentials or database writes are involved.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
from download_project_docs import ROOT, MAX_BYTES, SourceRedirect, digest, extract, safe_file, safe_url

SOURCE_IDS = frozenset({
    'quetzal-hardware-overview', 'quetzal-eps-hardware-readme', 'quetzal-eps-schematic',
    'quetzal-eps-bom-reference', 'quetzal-eps-flight-software-readme', 'quetzal-adcs-hardware',
    'quetzal-adcs-software', 'quetzal-adm-hardware', 'gomspace-nanocom-ax100-datasheet',
    'ti-ina260-datasheet', 'ti-tps2551-datasheet', 'ti-ina169-datasheet', 'ti-tps63070-datasheet',
    'ti-tmp100-datasheet', 'ti-bq27441-g1-datasheet', 'ti-bq27741-g1-datasheet',
    'microchip-atmega328p-datasheet'})
FILE_HASH_KEYS = (('path', 'sha256'), ('text_path', 'text_sha256'), ('pages_path', 'pages_sha256'))


def fetch_original(url: str) -> bytes:
    request = urllib.request.Request(safe_url(url), headers={'User-Agent': 'Norte-public-corpus-provision/1.0'})
    opener = urllib.request.build_opener(SourceRedirect())
    with opener.open(request, timeout=60) as response:
        safe_url(response.url)
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Original exceeds 64 MiB')
    return data


def restore_source(root: Path, source: dict, fetch=fetch_original) -> dict:
    if source.get('id') not in SOURCE_IDS or source.get('role') not in ('project_context', 'supporting_datasheet'):
        raise ValueError('Only the 17 fixed engineering sources may be provisioned')
    safe_url(source['source_url'])
    keys = [(path_key, hash_key) for path_key, hash_key in FILE_HASH_KEYS if source.get(path_key)]
    if not {'path', 'text_path'}.issubset({key for key, _ in keys}):
        raise ValueError('Pinned original and text hashes are required')
    missing = []
    for path_key, hash_key in keys:
        target = safe_file(root, source[path_key])
        if target.exists():
            if digest(target.read_bytes()) != source[hash_key]:
                raise ValueError(f'Existing {path_key} differs; refused to replace')
        else:
            missing.append(path_key)
    if not missing:
        return {'id': source['id'], 'status': 'verified', 'downloaded': False, 'createdFiles': 0}
    # Staging is on the same filesystem so link publication is atomic and no-clobber.
    with tempfile.TemporaryDirectory(prefix='.provision-', dir=root) as temporary:
        stage = Path(temporary)
        original = safe_file(root, source['path'])
        payload = original.read_bytes() if original.exists() else fetch(source['source_url'])
        if len(payload) > MAX_BYTES or digest(payload) != source['sha256']:
            raise ValueError('Downloaded original differs from pinned revision')
        if original.suffix.lower() == '.pdf' and not payload.startswith(b'%PDF-'):
            raise ValueError('Expected PDF')
        stage_original = safe_file(stage, source['path']); stage_original.parent.mkdir(parents=True, exist_ok=True)
        stage_original.write_bytes(payload)
        extract(stage, dict(source))
        for path_key, hash_key in keys:
            produced = safe_file(stage, source[path_key])
            if not produced.exists() or digest(produced.read_bytes()) != source[hash_key]:
                raise ValueError(f'Extracted {path_key} differs from pinned text; check Poppler version (reference 24.02.0)')
        created = 0
        for path_key in missing:
            target = safe_file(root, source[path_key]); target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(safe_file(stage, source[path_key]), target)
                created += 1
            except FileExistsError:
                hash_key = next(hash_key for key, hash_key in keys if key == path_key)
                if digest(target.read_bytes()) != source[hash_key]:
                    raise ValueError('Concurrent file change; refused to replace')
        return {'id': source['id'], 'status': 'restored', 'downloaded': not original.exists() or 'path' in missing, 'createdFiles': created}


def provision(root: Path, workers: int = 3) -> dict:
    manifest = json.loads((root / 'manifest.json').read_text())
    sources = [source for source in manifest['sources'] if source.get('id') in SOURCE_IDS]
    if len(sources) != 17 or {source['id'] for source in sources} != SOURCE_IDS:
        raise ValueError('The complete fixed 17-source manifest is required')
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        jobs = {executor.submit(restore_source, root, source): source['id'] for source in sources}
        for job in concurrent.futures.as_completed(jobs):
            try:
                result = job.result()
            except Exception as error:
                result = {'id': jobs[job], 'status': 'unavailable', 'error': str(error)[:220]}
            results.append(result)
    return {'available': all(item['status'] != 'unavailable' for item in results), 'sources': sorted(results, key=lambda item: item['id'])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--optional', action='store_true', help='Report failure without blocking the normal site build')
    args = parser.parse_args()
    try:
        if not shutil.which('pdftotext') or not shutil.which('pdfinfo'):
            raise ValueError('poppler-utils is required')
        result = provision(args.root.resolve())
    except Exception as error:
        result = {'available': False, 'error': str(error)[:250]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result['available'] and not args.optional:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
