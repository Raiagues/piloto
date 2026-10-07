"""Signed-in sessions for HTTP tests: an in-memory account store, no network."""
from unittest.mock import patch

import auth
import server


def signed_in(test, role='user', username='tester'):
    """Gives server.STORE a fresh in-memory store for one test; returns (user_id, headers)."""
    store = auth.Store()
    patcher = patch.object(server, 'STORE', store)
    patcher.start()
    test.addCleanup(patcher.stop)
    test.addCleanup(store.close)
    user = store.create_user(username, 'fixture-password', role)
    return user['id'], {'Cookie': f'{server.COOKIE}={store.create_session(user["id"])}'}
