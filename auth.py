"""Accounts, sessions and per-account meeting records.

Postgres (DATABASE_URL) in production; a local SQLite file otherwise, so ./start
keeps working without any database server. Passwords use scrypt and only a
SHA-256 digest of each session token is stored.
"""
import base64
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time

USERNAME = re.compile(r'[a-z0-9][a-z0-9._-]{2,31}')
RESERVED = {'admin', 'administrador', 'root', 'norte', 'suporte'}
SESSION_SECONDS = 30 * 24 * 3600
RECORD_PREFIX = 'norte.meeting-room.'
MAX_RECORD_CHARS = 30_000_000
SCRYPT = {'n': 2 ** 14, 'r': 8, 'p': 1}


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _b64(raw): return base64.b64encode(raw).decode()


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${_b64(salt)}${_b64(digest)}"


def verify_password(password, stored):
    try:
        scheme, n, r, p, salt, digest = stored.split('$')
        if scheme != 'scrypt': return False
        expected = base64.b64decode(digest)
        candidate = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError):
        return False


# Unknown usernames still pay for one scrypt run, so timing does not reveal accounts.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def normalize_username(value):
    name = value.strip().lower() if isinstance(value, str) else ''
    if not USERNAME.fullmatch(name):
        raise AuthError('Use de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.')
    return name


def check_password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise AuthError('A senha precisa ter de 8 a 128 caracteres.')
    return value


def valid_record_key(key):
    return isinstance(key, str) and key.startswith(RECORD_PREFIX) and len(key) <= 200 and key.isprintable()


def _token_digest(token): return hashlib.sha256(token.encode()).hexdigest()


SCHEMA = {
    'postgres': [
        """CREATE TABLE IF NOT EXISTS norte_users (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at BIGINT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS norte_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL)""",
        'CREATE INDEX IF NOT EXISTS norte_sessions_user ON norte_sessions(user_id)',
        """CREATE TABLE IF NOT EXISTS norte_records (
            user_id BIGINT NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            version BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            PRIMARY KEY (user_id, key))""",
    ],
    'sqlite': [
        """CREATE TABLE IF NOT EXISTS norte_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS norte_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL)""",
        'CREATE INDEX IF NOT EXISTS norte_sessions_user ON norte_sessions(user_id)',
        """CREATE TABLE IF NOT EXISTS norte_records (
            user_id INTEGER NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            version INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, key))""",
    ],
}


class Store:
    """Every operation is one SQL statement, so concurrent requests stay atomic."""

    def __init__(self, database_url='', sqlite_path=':memory:'):
        if database_url:
            from psycopg_pool import ConnectionPool  # Only needed when Postgres is configured.
            url = 'postgresql://' + database_url.split('://', 1)[1] if database_url.startswith('postgres://') else database_url
            self.dialect = 'postgres'
            self.pool = ConnectionPool(url, min_size=1, max_size=8, kwargs={'autocommit': True}, open=True, timeout=15)
        else:
            self.dialect = 'sqlite'
            self.lock = threading.Lock()
            self.sqlite = sqlite3.connect(str(sqlite_path), check_same_thread=False, isolation_level=None)
            self.sqlite.execute('PRAGMA foreign_keys = ON')
            if str(sqlite_path) != ':memory:': self.sqlite.execute('PRAGMA journal_mode = WAL')
        for statement in SCHEMA[self.dialect]: self._run(statement)

    def _run(self, sql, params=(), fetch=None):
        if self.dialect == 'postgres':
            with self.pool.connection() as connection:
                cursor = connection.execute(sql, params)
                return cursor.fetchone() if fetch == 'one' else cursor.fetchall() if fetch == 'all' else cursor.rowcount
        with self.lock:
            cursor = self.sqlite.execute(sql.replace('%s', '?'), params)
            return cursor.fetchone() if fetch == 'one' else cursor.fetchall() if fetch == 'all' else cursor.rowcount

    def ping(self):
        return self._run('SELECT 1', fetch='one')[0] == 1

    def close(self):
        if self.dialect == 'postgres': self.pool.close()
        else: self.sqlite.close()

    # Accounts
    def create_user(self, username, password, role='user'):
        row = self._run('INSERT INTO norte_users (username, password_hash, role, created_at) VALUES (%s, %s, %s, %s) '
                        'ON CONFLICT (username) DO NOTHING RETURNING id',
                        (username, hash_password(password), role, int(time.time())), fetch='one')
        if not row: raise AuthError('Este usuário já existe. Escolha outro nome.', 409)
        return {'id': row[0], 'username': username, 'role': role}

    def find_user(self, username):
        row = self._run('SELECT id, username, role, password_hash FROM norte_users WHERE username = %s', (username,), fetch='one')
        return {'id': row[0], 'username': row[1], 'role': row[2], 'password_hash': row[3]} if row else None

    def authenticate(self, username, password):
        user = self.find_user(username)
        if not verify_password(password, user['password_hash'] if user else _DUMMY_HASH) or not user: return None
        return {key: user[key] for key in ('id', 'username', 'role')}

    def ensure_admin(self, username, password):
        """The configured admin is the only admin; a changed password ends its old sessions."""
        user = self.find_user(username)
        if user is None:
            user = self.create_user(username, password, 'admin')
        else:
            if user['role'] != 'admin': self._run("UPDATE norte_users SET role = 'admin' WHERE id = %s", (user['id'],))
            if not verify_password(password, user['password_hash']):
                self._run('UPDATE norte_users SET password_hash = %s WHERE id = %s', (hash_password(password), user['id']))
                self._run('DELETE FROM norte_sessions WHERE user_id = %s', (user['id'],))
        self._run("UPDATE norte_users SET role = 'user' WHERE role = 'admin' AND id <> %s", (user['id'],))
        return user['id']

    # Sessions
    def create_session(self, user_id):
        token, now = secrets.token_urlsafe(32), int(time.time())
        self._run('DELETE FROM norte_sessions WHERE expires_at < %s', (now,))
        self._run('INSERT INTO norte_sessions (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)',
                  (_token_digest(token), user_id, now, now + SESSION_SECONDS))
        return token

    def session_user(self, token):
        if not token or len(token) > 200: return None
        row = self._run('SELECT u.id, u.username, u.role FROM norte_sessions s JOIN norte_users u ON u.id = s.user_id '
                        'WHERE s.token_hash = %s AND s.expires_at > %s', (_token_digest(token), int(time.time())), fetch='one')
        return {'id': row[0], 'username': row[1], 'role': row[2]} if row else None

    def delete_session(self, token):
        if token: self._run('DELETE FROM norte_sessions WHERE token_hash = %s', (_token_digest(token),))

    # Meeting records: the same read/change contract the browser storage offers.
    def get_record(self, user_id, key):
        row = self._run('SELECT value, version FROM norte_records WHERE user_id = %s AND key = %s', (user_id, key), fetch='one')
        return (row[0], row[1]) if row else (None, 0)

    def put_record(self, user_id, key, value, expected=None):
        """Returns the new version, or None when `expected` no longer matches."""
        now = int(time.time())
        if value is None:
            if expected is None: self._run('DELETE FROM norte_records WHERE user_id = %s AND key = %s', (user_id, key))
            elif expected and not self._run('DELETE FROM norte_records WHERE user_id = %s AND key = %s AND version = %s', (user_id, key, expected)): return None
            elif not expected and self.get_record(user_id, key)[1]: return None
            return 0
        if expected is None:
            row = self._run('INSERT INTO norte_records (user_id, key, value, version, updated_at) VALUES (%s, %s, %s, 1, %s) '
                            'ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, version = norte_records.version + 1, updated_at = excluded.updated_at '
                            'RETURNING version', (user_id, key, value, now), fetch='one')
        elif expected == 0:
            row = self._run('INSERT INTO norte_records (user_id, key, value, version, updated_at) VALUES (%s, %s, %s, 1, %s) '
                            'ON CONFLICT (user_id, key) DO NOTHING RETURNING version', (user_id, key, value, now), fetch='one')
        else:
            row = self._run('UPDATE norte_records SET value = %s, version = version + 1, updated_at = %s '
                            'WHERE user_id = %s AND key = %s AND version = %s RETURNING version', (value, now, user_id, key, expected), fetch='one')
        return row[0] if row else None


class Throttle:
    """In-memory attempt limiter for login and sign-up (one server process)."""

    def __init__(self, limit, window):
        self.limit, self.window, self.lock, self.hits = limit, window, threading.Lock(), {}

    def blocked(self, key):
        now = time.monotonic()
        with self.lock:
            hits = [t for t in self.hits.get(key, []) if now - t < self.window]
            if hits: self.hits[key] = hits
            else: self.hits.pop(key, None)
            return len(hits) >= self.limit

    def hit(self, key):
        with self.lock:
            self.hits.setdefault(key, []).append(time.monotonic())
            if len(self.hits) > 10000: self.hits.clear()

    def reset(self, key):
        with self.lock: self.hits.pop(key, None)
