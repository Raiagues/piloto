"""Authenticated loopback bridge from Norte's single account/session service.

The browser never receives the signing secret. Storage belongs to a signed scope,
not to a user id supplied in a request body. Node enforces membership and CSRF.
"""
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import time

IDENTITY = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z')
SCOPE = re.compile(r'(meeting|user):[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z')


def enabled():
    return os.environ.get('NORTE_BRIDGE_ONLY', '').lower() in ('1', 'true')


def verify(method, path, headers, raw, peer, secret=None, now=None):
    secret = secret if secret is not None else os.environ.get('NORTE_MEETING_BRIDGE_SECRET', '')
    if len(secret) < 32:
        return None
    try:
        if not ipaddress.ip_address(peer).is_loopback:
            return None
        user = headers.get('X-Norte-Bridge-User', '')
        scope = headers.get('X-Norte-Bridge-Scope', '')
        role = headers.get('X-Norte-Bridge-Role', '')
        stamp = headers.get('X-Norte-Bridge-Time', '')
        signature = headers.get('X-Norte-Bridge-Signature', '')
        if not IDENTITY.fullmatch(user) or not SCOPE.fullmatch(scope) or role not in ('user', 'admin'):
            return None
        if not stamp.isdigit() or abs((time.time() if now is None else now) - int(stamp)) > 60:
            return None
        if scope.startswith('meeting:') and role != 'user':
            return None
        if scope.startswith('user:') and scope != 'user:' + user:
            return None
        message = '\n'.join((method, path, user, scope, role, stamp, hashlib.sha256(raw).hexdigest()))
        expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        return {'actor': user, 'scope': scope, 'role': role}
    except (ValueError, TypeError, OverflowError):
        return None


def storage_user(store, identity):
    """Stable opaque namespace; never aliases an existing human username."""
    name = 'bridge.' + hashlib.sha256(identity['scope'].encode()).hexdigest()[:25]
    user = store.find_user(name)
    if user is None:
        try:
            user = store.create_user(name, secrets.token_urlsafe(64), 'user')
        except Exception:
            user = store.find_user(name)
            if user is None:
                raise
    return {'id': user['id'], 'username': name, 'role': identity['role'],
            'bridge_actor': identity['actor'], 'bridge_scope': identity['scope']}
