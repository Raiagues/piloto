#!/usr/bin/env python3
"""Offline, reviewed removal of old workspaces. Default mode is read-only.

Keep the requested project and its team, real accounts, and independent meetings.
Apply requires the report fingerprint and stopped services. Backups are private.
"""
import argparse
from copy import deepcopy
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, separators=(',', ':'), default=lambda blob: {'blobHash': hashlib.sha256(blob).hexdigest()} if isinstance(blob, bytes) else str(blob)).encode()).hexdigest()


def explicit_demo(item):
    return bool(item.get('isDemoAccount') or item.get('demoSandboxId') or item.get('isFictionalProfile'))


def retire_json(original, keep_project):
    data = deepcopy(original)
    workspace = data.get('workspace', {})
    projects = workspace.get('projects', {})
    if keep_project not in projects:
        raise ValueError('The project to preserve does not exist.')
    keep_record = projects[keep_project]
    keep_document = keep_record.get('document', {})
    if keep_document.get('id') != keep_project:
        raise ValueError('The preserved project identifier is inconsistent.')
    keep_team = keep_document.get('context', {}).get('teamId')
    if not keep_team or not any(team.get('id') == keep_team for team in data.get('teams', [])):
        raise ValueError('The preserved project must have an existing team.')
    removed_projects = set(projects) - {keep_project}
    removed_teams = {team['id'] for team in data.get('teams', []) if team['id'] != keep_team}
    removed_users = {user['id'] for user in data.get('users', []) if explicit_demo(user)}
    removed_members = {member['id'] for member in data.get('members', []) if member.get('accountId') in removed_users or explicit_demo(member)}
    if any(user.get('accessRole') == 'owner_admin' and user['id'] in removed_users for user in data.get('users', [])):
        raise ValueError('An administrator is flagged as a demo; manual review is required.')
    if any(user.get('memberId') in removed_members for user in data.get('users', []) if user['id'] not in removed_users):
        raise ValueError('A real account references a demo member; manual review is required.')
    selected_team = next(team for team in data['teams'] if team['id'] == keep_team)
    if removed_members.intersection(selected_team.get('memberIds', [])):
        raise ValueError('The retained team still references demo members; no ACL changes are inferred.')
    removed_meetings = {key for key, meeting in data.get('meetings', {}).items() if
                        meeting.get('projectId') in removed_projects or meeting.get('teamId') in removed_teams
                        or meeting.get('ownerId') in removed_users or meeting.get('example') or meeting.get('copiedFromExample')}
    removed_artifacts = {artifact['id'] for artifact in data.get('artifacts', []) if
                         explicit_demo(artifact) or artifact.get('ownerId') in removed_projects | removed_teams | removed_users
                         or artifact.get('projectId') in removed_projects or artifact.get('teamId') in removed_teams}
    def artifact_references(value):
        references = set()
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('artifactId', 'sourceArtifactId') and isinstance(item, str):
                    references.add(item)
                elif key in ('artifactIds', 'projectArtifactIds') and isinstance(item, list):
                    references.update(identifier for identifier in item if isinstance(identifier, str))
                else:
                    references.update(artifact_references(item))
        elif isinstance(value, list):
            for item in value:
                references.update(artifact_references(item))
        return references
    if removed_artifacts.intersection(artifact_references([keep_record, workspace.get('delivery', {}).get(keep_project, {})])):
        raise ValueError('The retained project still uses an artifact from a retired scope; review it first.')

    def related(item):
        return item.get('projectId') in removed_projects or item.get('teamId') in removed_teams \
            or item.get('meetingId') in removed_meetings or item.get('userId') in removed_users \
            or item.get('memberId') in removed_members or item.get('artifactId') in removed_artifacts

    data['users'] = [user for user in data.get('users', []) if user['id'] not in removed_users]
    data['members'] = [member for member in data.get('members', []) if member['id'] not in removed_members]
    data['teams'] = [team for team in data.get('teams', []) if team['id'] == keep_team]
    data['artifacts'] = [artifact for artifact in data.get('artifacts', []) if artifact['id'] not in removed_artifacts]
    data['meetings'] = {key: value for key, value in data.get('meetings', {}).items() if key not in removed_meetings}
    for key in ('sessions', 'emailVerifications', 'activity', 'documentPresence', 'invitations', 'meetingInvitations'):
        if key in data:
            data[key] = [item for item in data[key] if not related(item)
                         and item.get('invitedUserId') not in removed_users and item.get('createdBy') not in removed_users]
    workspace['projects'] = {keep_project: keep_record}
    workspace['project'] = deepcopy(keep_record)
    workspace['delivery'] = {key: value for key, value in workspace.get('delivery', {}).items() if key == keep_project}
    legacy_fields = ('labs', 'extractionJobs', 'ideaSessions', 'ideaAnalysisBudgets', 'ideaAnalysisCache')
    for key in legacy_fields:
        workspace.pop(key, None)
    data['projectLearning'] = {key: value for key, value in data.get('projectLearning', {}).items() if key == keep_project}
    data['teamStats'] = {key: value for key, value in data.get('teamStats', {}).items() if key == keep_team}
    platform = data.get('platform', {})
    conversations = platform.get('conversations', {})
    platform['conversations'] = {key: value for key, value in conversations.items() if not related(value)
                                 and value.get('createdBy') not in removed_users
                                 and not set(value.get('participantIds', [])).intersection(removed_users)}
    for key in ('catalog', 'planRequests', 'entitlements'):
        platform.pop(key, None)
    telemetry = data.get('telemetry', {})
    if isinstance(telemetry.get('sessions'), dict):
        telemetry['sessions'] = {key: value for key, value in telemetry['sessions'].items() if not related(value)}
    if isinstance(telemetry.get('events'), list):
        telemetry['events'] = [item for item in telemetry['events'] if not related(item)]
    if data['workspace']['projects'][keep_project] != original['workspace']['projects'][keep_project]:
        raise ValueError('Preserved project changed unexpectedly.')
    if data['teams'][0] != selected_team:
        raise ValueError('Preserved team permissions changed unexpectedly.')
    for user in data['users']:
        if user != next(item for item in original['users'] if item['id'] == user['id']):
            raise ValueError('A real account changed unexpectedly.')
    scopes = {'projects': removed_projects, 'teams': removed_teams, 'users': removed_users,
              'members': removed_members, 'artifacts': removed_artifacts, 'meetings': removed_meetings}
    return data, scopes


def database_rows(path):
    if not path:
        return {}
    with closing(sqlite3.connect(f'file:{Path(path).resolve()}?mode=ro', uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {table: [dict(row) for row in connection.execute('SELECT rowid AS migration_rowid,* FROM "' + table.replace('"', '""') + '" ORDER BY rowid')] for table in tables}


def meeting_deletions(tables, retained_meetings):
    allowed_names = {'bridge.' + hashlib.sha256(('meeting:' + identifier).encode()).hexdigest()[:25] for identifier in retained_meetings}
    users = {row['id'] for row in tables.get('norte_users', []) if row['username'].startswith('bridge.') and row['username'] not in allowed_names}
    deletions = {}
    for table, rows in tables.items():
        marked = [row['migration_rowid'] for row in rows if (table == 'norte_users' and row['id'] in users)
                  or row.get('user_id') in users]
        if marked:
            deletions[table] = marked
    return deletions


def evidence_deletions(tables, keep_project, removed_meetings):
    other_project = lambda row: row.get('project_id') not in (None, '', keep_project)
    source_ids = {row['id'] for row in tables.get('sources', []) if other_project(row)}
    meeting_ids = set(removed_meetings) | {row['meeting_id'] for row in tables.get('review_meetings', []) if other_project(row)}
    run_ids = {row['id'] for row in tables.get('ai_runs', []) if other_project(row) or row.get('meeting_id') in meeting_ids}
    entry_ids = {row['id'] for row in tables.get('reference_entries', []) if row.get('source_id') in source_ids}
    finding_ids = {row['id'] for row in tables.get('findings', []) if other_project(row) or row.get('entry_id') in entry_ids or row.get('run_id') in run_ids}
    deletions = {}
    for table, rows in tables.items():
        if table == 'schema_migrations':
            continue
        marked = [row['migration_rowid'] for row in rows if other_project(row)
                  or row.get('source_id') in source_ids or row.get('meeting_id') in meeting_ids
                  or row.get('run_id') in run_ids or row.get('entry_id') in entry_ids
                  or row.get('finding_id') in finding_ids]
        if marked:
            deletions[table] = marked
    return deletions


def report_for(original_bytes, keep_project, meeting_tables, evidence_tables):
    original = json.loads(original_bytes)
    updated, scopes = retire_json(original, keep_project)
    meeting_plan = meeting_deletions(meeting_tables, updated.get('meetings', {}))
    evidence_plan = evidence_deletions(evidence_tables, keep_project, scopes['meetings'])
    report = {
        'keepProject': keep_project,
        'sourceHash': digest(original_bytes),
        'databaseHashes': {'meeting': digest(meeting_tables), 'evidence': digest(evidence_tables)},
        'remove': {key: sorted(value) for key, value in scopes.items()},
        'retained': {key: len(updated.get(key, [])) for key in ('users', 'members', 'teams', 'artifacts', 'meetings')},
        'sqliteRowsRemoved': {'meeting': {key: len(value) for key, value in meeting_plan.items()},
                              'evidence': {key: len(value) for key, value in evidence_plan.items()}},
        'preserveNativeMeetingAccounts': len([row for row in meeting_tables.get('norte_users', []) if not row['username'].startswith('bridge.')]),
    }
    # No credentials, transcript text or document contents enter this report.
    report['fingerprint'] = digest(report)
    return updated, report, meeting_plan, evidence_plan


def services_stopped(runtime):
    pid_path = runtime / 'server.pid'
    if not pid_path.exists():
        return
    saved = json.loads(pid_path.read_text())
    number = saved if isinstance(saved, int) else saved.get('pid')
    if isinstance(number, int) and number > 1 and Path(f'/proc/{number}').exists():
        raise ValueError('Stop the Norte supervisor before applying this migration.')


def sqlite_copy(source, destination):
    with closing(sqlite3.connect(f'file:{Path(source).resolve()}?mode=ro', uri=True)) as connection:
        with closing(sqlite3.connect(destination)) as output:
            connection.backup(output)
    os.chmod(destination, 0o600)


def delete_rows(path, deletions):
    with closing(sqlite3.connect(path)) as connection:
        connection.execute('PRAGMA foreign_keys=OFF')
        connection.execute('PRAGMA journal_mode=DELETE')
        connection.execute('BEGIN IMMEDIATE')
        for table, identifiers in deletions.items():
            for index in range(0, len(identifiers), 200):
                batch = identifiers[index:index + 200]
                connection.execute('DELETE FROM "' + table.replace('"', '""') + '" WHERE rowid IN (' + ','.join('?' for _ in batch) + ')', batch)
        connection.commit()
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed on the staged copy.')
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('SQLite still has dangling foreign keys on the staged copy.')
        connection.execute('VACUUM')


def apply_migration(store, meeting_db, evidence_db, keep_project, expected, backup_root):
    services_stopped(store.parent)
    before = store.read_bytes()
    meeting_tables, evidence_tables = database_rows(meeting_db), database_rows(evidence_db)
    updated, report, meeting_plan, evidence_plan = report_for(before, keep_project, meeting_tables, evidence_tables)
    if not expected or expected != report['fingerprint']:
        raise ValueError('The reviewed fingerprint does not match. Run --check again.')
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = Path(tempfile.mkdtemp(prefix='workspace-retirement-', dir=backup_root))
    os.chmod(backup, 0o700)
    saved_json = backup / 'norte-data.json'
    saved_json.write_bytes(before); saved_json.chmod(0o600)
    files = [(store, saved_json, backup / 'next-norte-data.json')]
    files[0][2].write_text(json.dumps(updated, ensure_ascii=False, separators=(',', ':')) + '\n'); files[0][2].chmod(0o600)
    for name, path, plan in [('meeting', meeting_db, meeting_plan), ('evidence', evidence_db, evidence_plan)]:
        if not path:
            continue
        saved, staged = backup / f'{name}.sqlite3', backup / f'next-{name}.sqlite3'
        sqlite_copy(path, saved); shutil.copyfile(saved, staged); staged.chmod(0o600)
        delete_rows(staged, plan)
        files.append((Path(path), saved, staged))
    # Validate all copies before publishing any of them.
    after_meeting = database_rows(files[1][2]) if meeting_db else {}
    after_evidence = database_rows(files[-1][2]) if evidence_db else {}
    _, second, next_meeting, next_evidence = report_for(files[0][2].read_bytes(), keep_project, after_meeting, after_evidence)
    if any(second['remove'].values()) or next_meeting or next_evidence:
        raise ValueError('Migration is not idempotent; no active file was replaced.')
    if store.read_bytes() != before or digest(database_rows(meeting_db)) != digest(meeting_tables) or digest(database_rows(evidence_db)) != digest(evidence_tables):
        raise ValueError('An active source changed while preparing backups; nothing was published.')
    services_stopped(store.parent)
    try:
        for destination, saved, staged in files:
            if destination.suffix == '.sqlite3':
                for suffix in ('-wal', '-shm'):
                    sidecar = Path(str(destination) + suffix)
                    if sidecar.exists():
                        shutil.copyfile(sidecar, backup / (destination.name + suffix))
                        (backup / (destination.name + suffix)).chmod(0o600)
                        sidecar.unlink()
            os.replace(staged, destination)
    except BaseException:
        # Restore every source: sidecars may have been removed just before a failed replace.
        for destination, saved, _ in reversed(files):
            temporary = destination.with_name(destination.name + '.restore-pending')
            shutil.copyfile(saved, temporary); temporary.chmod(0o600); os.replace(temporary, destination)
        raise
    report.update(applied=True, backup=str(backup), appliedAt=datetime.now(timezone.utc).isoformat())
    manifest = backup / 'manifest.json'; manifest.write_text(json.dumps(report, indent=2)); manifest.chmod(0o600)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--meeting-db', type=Path)
    parser.add_argument('--evidence-db', type=Path)
    parser.add_argument('--keep-project', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-fingerprint')
    parser.add_argument('--backup-root', type=Path)
    args = parser.parse_args()
    if args.apply:
        report = apply_migration(args.store, args.meeting_db, args.evidence_db, args.keep_project,
                                 args.expected_fingerprint, args.backup_root or args.store.parent / 'backups')
    else:
        _, report, _, _ = report_for(args.store.read_bytes(), args.keep_project, database_rows(args.meeting_db), database_rows(args.evidence_db))
        report['applied'] = False
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
