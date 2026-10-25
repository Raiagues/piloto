"""Offline retirement preserves real identities, retained ACLs and native meetings."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('retirement', ROOT / 'scripts/retire_legacy_workspace.py')
retirement = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retirement)


class WorkspaceRetirementTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.store, self.meetings, self.evidence = [self.folder / name for name in ('state.json', 'meeting.sqlite3', 'evidence.sqlite3')]
        kept = {'document': {'id': 'lyle', 'context': {'teamId': 'team-live', 'projectArtifactIds': ['doc-live']}, 'name': 'LYLE'}, 'revision': 3}
        self.original = {
            'users': [{'id': 'admin', 'memberId': 'm-admin', 'accessRole': 'owner_admin', 'passwordHash': 'private-admin-hash'}, {'id': 'real', 'memberId': 'm-real', 'passwordHash': 'private-real-hash'}, {'id': 'demo', 'memberId': 'm-demo', 'isDemoAccount': True}],
            'members': [{'id': 'm-admin', 'accountId': 'admin'}, {'id': 'm-real', 'accountId': 'real'}, {'id': 'm-demo', 'accountId': 'demo'}],
            'teams': [{'id': 'team-live', 'captainMemberId': 'm-real', 'memberIds': ['m-real']}, {'id': 'team-old', 'memberIds': ['m-admin']}],
            'artifacts': [{'id': 'doc-live', 'scope': 'project', 'ownerId': 'lyle'}, {'id': 'doc-old', 'scope': 'project', 'ownerId': 'satellite'}],
            'workspace': {'projects': {'lyle': kept, 'satellite': {'document': {'id': 'satellite', 'context': {'teamId': 'team-old'}}}}, 'project': {'document': {'id': 'satellite'}}, 'delivery': {'lyle': {'revision': 8}, 'satellite': {}}, 'labs': {'old': {}}},
            'meetings': {'kept-private': {'id': 'kept-private', 'ownerId': 'real'}, 'old': {'id': 'old', 'ownerId': 'admin', 'projectId': 'satellite'}},
            'sessions': [{'id': 'real-session', 'userId': 'real'}, {'id': 'demo-session', 'userId': 'demo'}],
            'authBootstrap': {'completedAt': 'keep'}, 'platform': {'conversations': {'real-chat': {'createdBy': 'real', 'participantIds': ['admin', 'real']}, 'demo-chat': {'createdBy': 'demo', 'participantIds': ['demo']}}, 'catalog': {'retired': True}},
        }
        self.store.write_text(json.dumps(self.original))
        bridge = lambda identifier: 'bridge.' + hashlib.sha256(('meeting:' + identifier).encode()).hexdigest()[:25]
        with sqlite3.connect(self.meetings) as database:
            database.executescript('CREATE TABLE norte_users(id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT); CREATE TABLE norte_records(user_id INTEGER REFERENCES norte_users(id),key TEXT,value TEXT); CREATE TABLE ai_usage(id TEXT,user_id INTEGER REFERENCES norte_users(id));')
            database.executemany('INSERT INTO norte_users VALUES(?,?,?)', [(1, 'native-account', 'native-secret'), (2, bridge('old'), ''), (3, bridge('kept-private'), '')])
            database.executemany('INSERT INTO norte_records VALUES(?,?,?)', [(1, 'native-meeting', 'original speech'), (2, 'old-meeting', 'retired speech'), (3, 'kept-meeting', 'private speech')])
            database.executemany('INSERT INTO ai_usage VALUES(?,?)', [('old-use', 2), ('private-use', 3)])
        with sqlite3.connect(self.evidence) as database:
            database.executescript('CREATE TABLE schema_migrations(version INTEGER); CREATE TABLE sources(id TEXT PRIMARY KEY,project_id TEXT); CREATE TABLE extractions(id TEXT,source_id TEXT REFERENCES sources(id),body BLOB); CREATE TABLE requirements(project_id TEXT,id TEXT); CREATE TABLE reference_entries(id TEXT,source_id TEXT REFERENCES sources(id));')
            database.execute('INSERT INTO schema_migrations VALUES(1)')
            database.executemany('INSERT INTO sources VALUES(?,?)', [('global-source', None), ('old-source', 'satellite')])
            database.execute('INSERT INTO extractions VALUES(?,?,?)', ('old-extraction', 'old-source', b'original binary'))
            database.execute('INSERT INTO requirements VALUES(?,?)', ('satellite', 'S-1'))
            database.executemany('INSERT INTO reference_entries VALUES(?,?)', [('reference-global', 'global-source'), ('reference-old', 'old-source')])

    def plan(self):
        return retirement.report_for(self.store.read_bytes(), 'lyle', retirement.database_rows(self.meetings), retirement.database_rows(self.evidence))

    def apply(self, fingerprint):
        return retirement.apply_migration(self.store, self.meetings, self.evidence, 'lyle', fingerprint, self.folder / 'backups')

    def test_check_never_writes_and_report_has_no_credentials(self):
        before = [path.read_bytes() for path in (self.store, self.meetings, self.evidence)]
        _, report, _, _ = self.plan()
        self.assertEqual(before, [path.read_bytes() for path in (self.store, self.meetings, self.evidence)])
        serialized = json.dumps(report)
        for secret in ('private-admin-hash', 'private-real-hash', 'native-secret', 'original speech', 'private speech'):
            self.assertNotIn(secret, serialized)
        self.assertEqual(report['remove']['users'], ['demo'])
        self.assertEqual(report['remove']['meetings'], ['old'])

    def test_apply_preserves_project_accounts_acl_native_meeting_and_backup(self):
        _, report, _, _ = self.plan()
        result = self.apply(report['fingerprint'])
        data = json.loads(self.store.read_text())
        self.assertEqual(data['users'], self.original['users'][:2])
        self.assertEqual(data['teams'], self.original['teams'][:1])
        self.assertEqual(data['workspace']['projects']['lyle'], self.original['workspace']['projects']['lyle'])
        self.assertEqual(data['workspace']['delivery'], {'lyle': {'revision': 8}})
        self.assertEqual(data['workspace']['project'], data['workspace']['projects']['lyle'])
        self.assertEqual(set(data['meetings']), {'kept-private'})
        self.assertEqual(set(data['platform']['conversations']), {'real-chat'})
        self.assertEqual(data['sessions'], [{'id': 'real-session', 'userId': 'real'}])
        meeting = retirement.database_rows(self.meetings)
        self.assertEqual([row['id'] for row in meeting['norte_users']], [1, 3])
        self.assertEqual([row['value'] for row in meeting['norte_records']], ['original speech', 'private speech'])
        evidence = retirement.database_rows(self.evidence)
        self.assertEqual([row['id'] for row in evidence['sources']], ['global-source'])
        self.assertEqual(evidence['extractions'], [])
        self.assertEqual(len(evidence['schema_migrations']), 1)
        backup = Path(result['backup'])
        self.assertEqual(json.loads((backup / 'norte-data.json').read_text()), self.original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in backup.iterdir()))
        self.assertFalse(any(self.plan()[1]['remove'].values()))

    def test_changed_source_and_active_service_refuse_apply(self):
        _, report, _, _ = self.plan()
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            self.apply('not-reviewed')
        import os
        (self.folder / 'server.pid').write_text(json.dumps({'pid': os.getpid()}))
        with self.assertRaisesRegex(ValueError, 'supervisor'):
            self.apply(report['fingerprint'])
        self.assertEqual(json.loads(self.store.read_text()), self.original)

    def test_failed_publication_restores_every_store(self):
        _, report, _, _ = self.plan()
        before = [retirement.database_rows(path) for path in (self.meetings, self.evidence)]
        replace = retirement.os.replace
        calls = 0
        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated publication failure')
            replace(source, destination)
        with patch.object(retirement.os, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'simulated'):
                self.apply(report['fingerprint'])
        self.assertEqual(json.loads(self.store.read_text()), self.original)
        self.assertEqual([retirement.database_rows(path) for path in (self.meetings, self.evidence)], before)

    def test_cross_project_artifact_is_not_silently_removed(self):
        source = deepcopy(self.original)
        source['workspace']['projects']['lyle']['document']['context']['projectArtifactIds'].append('doc-old')
        with self.assertRaisesRegex(ValueError, 'artifact'):
            retirement.retire_json(source, 'lyle')


if __name__ == '__main__':
    unittest.main()
