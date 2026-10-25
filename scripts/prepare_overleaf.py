#!/usr/bin/env python3
"""Create the local Overleaf secret once, without exposing or replacing it."""
import os
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.runtime' / 'overleaf.env'
target.parent.mkdir(parents=True, exist_ok=True)
try:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    values = dict(line.split('=', 1) for line in target.read_text().splitlines() if '=' in line and not line.startswith('#'))
    if len(values.get('OVERLEAF_INVITE_TOKEN_SECRET', '').strip()) < 32:
        raise SystemExit('The existing .runtime/overleaf.env needs a valid OVERLEAF_INVITE_TOKEN_SECRET. It was not overwritten.')
    os.chmod(target, 0o600)
    print('Existing local Overleaf secret preserved.')
else:
    with os.fdopen(descriptor, 'w') as stream:
        stream.write('OVERLEAF_INVITE_TOKEN_SECRET=' + secrets.token_urlsafe(48) + '\n')
    print('Local Overleaf secret created in .runtime/overleaf.env (private).')
