import hashlib
import hmac
import unittest

import auth
import meeting_bridge as bridge


class BridgeTests(unittest.TestCase):
    secret = 'private-test-secret-' * 3

    def headers(self, body=b'{}', path='/api/records', actor='account-a', scope='meeting:one', role='user', stamp='1000'):
        message = '\n'.join(('POST', path, actor, scope, role, stamp, hashlib.sha256(body).hexdigest()))
        return {'X-Norte-Bridge-User': actor, 'X-Norte-Bridge-Scope': scope,
                'X-Norte-Bridge-Role': role, 'X-Norte-Bridge-Time': stamp,
                'X-Norte-Bridge-Signature': hmac.new(self.secret.encode(), message.encode(), hashlib.sha256).hexdigest()}

    def check(self, headers=None, body=b'{}', path='/api/records', peer='127.0.0.1', now=1000):
        return bridge.verify('POST', path, headers or self.headers(), body, peer, self.secret, now)

    def test_signature_binds_body_path_identity_and_time_and_requires_loopback(self):
        self.assertEqual(self.check()['scope'], 'meeting:one')
        self.assertIsNone(self.check(body=b'{"owner":"someone"}'))
        self.assertIsNone(self.check(path='/api/admin/ai/overview'))
        self.assertIsNone(self.check(peer='192.168.1.1'))
        self.assertIsNone(self.check(now=1061))
        headers = self.headers(); headers['X-Norte-Bridge-User'] = 'account-b'
        self.assertIsNone(self.check(headers))
        headers = self.headers(); headers['X-Norte-Bridge-Scope'] = 'meeting:two'
        self.assertIsNone(self.check(headers))

    def test_meeting_never_grants_admin_and_private_scope_must_match_actor(self):
        self.assertIsNone(self.check(self.headers(role='admin')))
        self.assertIsNone(self.check(self.headers(scope='user:account-b')))
        self.assertIsNotNone(self.check(self.headers(scope='user:account-a')))

    def test_storage_namespace_is_stable_shared_by_participants_but_not_other_meetings(self):
        store = auth.Store()
        try:
            one = bridge.storage_user(store, self.check())
            participant = bridge.storage_user(store, self.check(self.headers(actor='account-b')))
            other = bridge.storage_user(store, self.check(self.headers(scope='meeting:two')))
            self.assertEqual(one['id'], participant['id'])
            self.assertNotEqual(one['id'], other['id'])
            store.put_record(one['id'], 'norte.meeting-room.run.one', 'private')
            self.assertEqual(store.get_record(other['id'], 'norte.meeting-room.run.one'), (None, 0))
            self.assertEqual(participant['bridge_actor'], 'account-b')
        finally:
            store.close()


if __name__ == '__main__': unittest.main()
