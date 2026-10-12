"""Run with python3 -m scripts.feedback_review (Python standard library only)."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid
from .runner import ROOT, investigate

ENVIRONMENT = os.environ.get('P2S_FEEDBACK_ENVIRONMENT', 'production')
if ENVIRONMENT not in {'production', 'staging'}:
    raise ValueError('invalid_feedback_environment')
STATE = Path.home() / ('.local/state/paste2speech-feedback-staging' if ENVIRONMENT == 'staging' else '.local/state/paste2speech-feedback')
LABEL = 'PasteToSpeech · ' + ENVIRONMENT
CONFIG = Path.home() / '.config/paste2speech'
RETENTION = 90 * 86400 * 1000
CHAT_ID = '579044008'
PAGE_SIZE = 100


def now_ms():
    return int(time.time() * 1000)


def connect(state=STATE):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    db = sqlite3.connect(state / 'feedback.sqlite3')
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA secure_delete=ON')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports(
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        delivery_attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        review TEXT, message TEXT, telegram_message_id INTEGER, error TEXT,
        updated_at INTEGER NOT NULL);
    ''')
    return db


def meta(db, key, default=None):
    row = db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
    return row[0] if row else default


def set_meta(db, key, value):
    db.execute('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (key, str(value)))


@contextmanager
def locked(state=STATE):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'controller.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('already_running') from None
        yield


def query(sql):
    environment = {k: v for k, v in os.environ.items() if k in {'HOME','PATH','LANG','USER'}}
    token_file = CONFIG / 'cloudflare-api-token'
    token = token_file.read_text().strip() if token_file.exists() else os.environ.get('CLOUDFLARE_API_TOKEN', '')
    if token:
        environment['CLOUDFLARE_API_TOKEN'] = token
    target = ['private-wavenet-reader-staging', '--config', 'cloudflare/reader/wrangler.staging.jsonc'] if ENVIRONMENT == 'staging' else ['paste2speech']
    result = subprocess.run([str(ROOT / 'node_modules/.bin/wrangler'), 'd1', 'execute',
        *target, '--remote', '--json', '--command', sql], cwd=ROOT,
        capture_output=True, text=True, timeout=60, env=environment)
    if result.returncode:
        raise RuntimeError('cloudflare_query_failed')
    data = json.loads(result.stdout)
    if not data or any(not x.get('success') for x in data):
        raise RuntimeError('cloudflare_query_failed')
    return data[0]['results']


def normalize(row):
    identity = str(uuid.UUID(row['id']))
    if identity != row['id'] or not isinstance(row['created_at'], int):
        raise ValueError('invalid_report')
    message = row['message']
    if not isinstance(message, str) or len(message) > 3000:
        raise ValueError('invalid_message')
    context = row.get('context') or '{}'
    if isinstance(context, str):
        context = json.loads(context)
    if not isinstance(context, dict) or len(json.dumps(context,ensure_ascii=False).encode()) > (16000 if 'scanReport' in context else 3000):
        raise ValueError('invalid_context')
    context['feedback_source'] = ENVIRONMENT
    # The optional email is deliberately not imported or sent to Codex.
    return {'id': identity, 'created_at': row['created_at'], 'message': message, 'context': context}


def import_rows(db, rows):
    cutoff = int(meta(db, 'cutover_ms', '0'))
    imported = 0
    with db:
        for row in rows:
            payload = normalize(row)
            status = 'baseline' if payload['created_at'] < cutoff else 'imported'
            imported += db.execute('''INSERT OR IGNORE INTO reports
              (id,created_at,payload,status,updated_at) VALUES(?,?,?,?,?)''',
              (payload['id'], payload['created_at'], json.dumps(payload), status, now_ms())).rowcount
    return imported


def poll(db, fetch=query):
    if meta(db, 'cutover_ms') is None:
        raise RuntimeError('baseline_required')
    # Repeated bounded full-retention reconciliation also finds previously sent rows
    # and rows with timestamps behind a previous cursor. Continue large scans next tick.
    cursor = json.loads(meta(db, 'scan_cursor', '[0, ""]'))
    imported = 0
    for _ in range(20):
        timestamp, identity = cursor
        if identity:
            uuid.UUID(identity)
        rows = fetch('SELECT id,created_at,message,context FROM feedback '
            f'WHERE created_at>={now_ms()-RETENTION} AND '
            f"(created_at>{int(timestamp)} OR (created_at={int(timestamp)} AND id>'{identity}')) "
            f'ORDER BY created_at,id LIMIT {PAGE_SIZE}')
        imported += import_rows(db, rows)
        cursor = [rows[-1]['created_at'], rows[-1]['id']] if rows else [0, '']
        if len(rows) < PAGE_SIZE:
            cursor = [0, '']
        with db:
            set_meta(db, 'scan_cursor', json.dumps(cursor))
        if len(rows) < PAGE_SIZE:
            break
    return imported


def plain(text, limit):
    return ''.join(c for c in text if c in '\n\t' or c.isprintable())[:limit]


def render(review):
    r = dict(review['result'])
    if review.get('scan_report'):
        for key,value in r.items():
            if isinstance(value,str):r[key]=re.sub(r'(?i)(?:https?://|file://|data:image/)[^\s<>]+','[link omitted]',value)
    chunks = [f"{LABEL} · {r['category']}\nReport {r['report_id']}", plain(r['summary'], 700)]
    if r['category'] == 'appreciation':
        return '\n\n'.join(chunks + [f"No action needed. Continue in Codex: Review feedback {r['report_id']}.\nTelegram replies are not monitored."])
    for key, label, limit in ([] if review.get('scan_report') else [('evidence','Evidence',600)]) + [ ('uncertainty', 'Still uncertain', 400),
                               ('recommended_action', 'Recommendation', 600), ('validation_needed', 'Check needed', 300)]:
        if r[key].strip():
            chunks.append(label + ': ' + plain(r[key], limit))
    chunks += ['Static source review; no changes made.',
               f"Continue in Codex: Review feedback {r['report_id']}.\nTelegram replies are not monitored."]
    # Telegram counts UTF-16 units, including astral emoji as two.
    body = '\n\n'.join(chunks[:-2]).encode('utf-16-le')[:6500].decode('utf-16-le', errors='ignore')
    return body + '\n\n' + '\n\n'.join(chunks[-2:])


def send(text):
    token = (CONFIG / 'telegram-bot-token').read_text().strip()
    if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
        raise RuntimeError('telegram_token_invalid')
    data = json.dumps({'chat_id': CHAT_ID, 'text': text,
                      'link_preview_options': {'is_disabled': True}}).encode()
    req = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=data,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise ValueError()
        return int(result['result']['message_id'])
    except Exception:
        # urllib exceptions include the credential-bearing URL; do not log them.
        raise RuntimeError('telegram_delivery_failed') from None


def export(db, identity, state=STATE):
    row = db.execute('SELECT * FROM reports WHERE id=?', (identity,)).fetchone()
    folder = state / 'reports'
    folder.mkdir(exist_ok=True, mode=0o700)
    record = dict(row)
    for key in ['payload', 'review']:
        if record[key]:
            record[key] = json.loads(record[key])
    for suffix, content in [('json', json.dumps(record, indent=2, ensure_ascii=False)),
                            ('md', f"# Feedback {identity}\n\nStatus: {row['status']}\n\n"
                             + record['payload']['message'] + '\n\n'
                             + (row['message'] or 'Not reviewed.') + '\n')]:
        temporary = folder / f'{identity}.{suffix}.tmp'
        temporary.write_text(content)
        temporary.replace(folder / f'{identity}.{suffix}')


def expire(db, state=STATE):
    cutoff = now_ms() - RETENTION
    ids = [r[0] for r in db.execute('SELECT id FROM reports WHERE created_at<?', (cutoff,))]
    for identity in ids:
        for path in (state / 'reports').glob(f'{identity}.*'):
            path.unlink()
    with db:
        db.execute('DELETE FROM reports WHERE created_at<?', (cutoff,))


def run_reviews(db, state=STATE, reviewer=investigate, model='gpt-6-astra'):
    # A killed controller never changes an already persisted review back to imported.
    with db:
        db.execute("UPDATE reports SET status=CASE WHEN attempts>=3 THEN 'needs_attention' ELSE 'imported' END WHERE status='investigating'")
    rows = db.execute("SELECT * FROM reports WHERE status='imported' AND next_attempt<=? ORDER BY created_at,id LIMIT 5", (now_ms(),)).fetchall()
    deadline = time.monotonic() + 19 * 60
    for row in rows:
        if time.monotonic() >= deadline:
            break
        identity = row['id']
        with db:
            db.execute("UPDATE reports SET status='investigating',attempts=attempts+1,updated_at=? WHERE id=?", (now_ms(), identity))
        try:
            report = json.loads(row['payload'])
            review = reviewer(report, model=model)
            message = render(review)
            status = 'suppressed' if review['result']['category'] == 'spam/abuse' else 'notification_pending'
            with db:
                db.execute('UPDATE reports SET status=?,review=?,message=?,error=NULL,next_attempt=0,updated_at=? WHERE id=?',
                           (status, json.dumps(review), message, now_ms(), identity))
        except Exception as exc:
            kind = str(exc) if str(exc) in {'authentication','codex_exit','codex_turn_failed','investigation_timeout','unexpected_tool_event','incomplete_result'} else type(exc).__name__
            exhausted = row['attempts'] + 1 >= 3
            with db:
                db.execute('UPDATE reports SET status=?,error=?,next_attempt=?,updated_at=? WHERE id=?',
                    ('needs_attention' if exhausted else 'imported', kind, now_ms()+1800000, now_ms(), identity))
        export(db, identity, state)
    # Failed/stale runs get a durable notice, distinct from an actual investigation.
    with db:
        db.execute("""UPDATE reports SET message='PasteToSpeech · ' || ? || ' · investigation needs attention' || char(10) ||
          'Report ' || id || char(10) || 'Automatic review failed after three attempts. The original report is saved. '
          || 'Ask Codex to review this report. No changes made.' WHERE status='needs_attention' AND message IS NULL""", (ENVIRONMENT,))


def deliver_pending(db, state=STATE, sender=send):
    rows = db.execute("SELECT * FROM reports WHERE status IN ('notification_pending','needs_attention') AND telegram_message_id IS NULL AND message IS NOT NULL AND next_attempt<=? ORDER BY created_at,id LIMIT 20", (now_ms(),)).fetchall()
    failed = False
    for row in rows:
        with db:
            db.execute('UPDATE reports SET delivery_attempts=delivery_attempts+1 WHERE id=?', (row['id'],))
        text = row['message']
        if row['delivery_attempts']:
            text = 'Delivery retry · same report ID\n\n' + text
        try:
            message_id = sender(text)
        except Exception:
            failed = True
            with db:
                db.execute('UPDATE reports SET error=?,next_attempt=? WHERE id=?',
                           ('telegram_delivery_failed', now_ms()+min(86400000,1800000*2**min(row['delivery_attempts'],5)), row['id']))
        else:
            status = 'notified' if row['status'] == 'notification_pending' else row['status']
            with db:
                db.execute('UPDATE reports SET status=?,telegram_message_id=?,error=NULL,updated_at=? WHERE id=?',
                           (status, message_id, now_ms(), row['id']))
        export(db, row['id'], state)
    return not failed


def health(db, error=None, sender=send):
    previous = meta(db, 'health_error', '')
    alerted = meta(db, 'health_alerted', '')
    with db:
        set_meta(db, 'last_run_ms', now_ms())
        set_meta(db, 'health_error', error or '')
    if error and not alerted:
        try:
            sender(f'{LABEL} feedback reviewer needs attention: {error}. Reports remain queued. Ask Codex to check the feedback reviewer.')
        except Exception:
            return
        with db:
            set_meta(db, 'health_alerted', 'yes')
    elif not error and alerted:
        try:
            sender(f'{LABEL} feedback reviewer has recovered. Queued reports will continue processing.')
        except Exception:
            return
        with db:
            set_meta(db, 'health_alerted', '')
    if not error:
        with db:
            set_meta(db, 'last_success_ms', now_ms())


def run(db, state=STATE):
    expire(db, state)
    try:
        imported = poll(db)
        delivered = deliver_pending(db, state)
        run_reviews(db, state, model=meta(db, 'model', 'gpt-6-astra'))
        delivered = deliver_pending(db, state) and delivered
        pending_error = db.execute("SELECT error FROM reports WHERE status IN ('imported','needs_attention','notification_pending') AND error IS NOT NULL LIMIT 1").fetchone()
        error = 'telegram_delivery_failed' if not delivered else (pending_error[0] if pending_error else None)
        health(db, error)
        print(json.dumps({'imported': imported, 'health': error or 'ok'}))
        return 1 if error else 0
    except Exception as exc:
        kind = str(exc) if str(exc) in {'cloudflare_query_failed','baseline_required'} else type(exc).__name__
        health(db, kind)
        print(json.dumps({'health': kind}))
        return 1


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['baseline','run','status','show','retry','dry-run','self-test'])
    parser.add_argument('id', nargs='?')
    parser.add_argument('--send', action='store_true', help='Send the explicitly labeled synthetic test summary')
    parser.add_argument('--probe', action='store_true', help='Run the synthetic tool-isolation probe')
    args = parser.parse_args()
    if args.command == 'dry-run':
        rows = query('SELECT id,created_at,status FROM feedback ORDER BY created_at,id LIMIT 100')
        print(json.dumps({'sample_count': len(rows), 'action': 'No imports, model calls, or messages.'}))
        return 0
    with locked():
        # Only this application's private, generated temporary run directories.
        for stale in (STATE / 'runs').glob('run-*'):
            if stale.is_dir() and not stale.is_symlink() and stale.stat().st_uid == os.getuid():
                shutil.rmtree(stale)
        db = connect()
        if args.command == 'baseline':
            if meta(db, 'cutover_ms') is not None:
                raise RuntimeError('baseline_already_exists')
            with db:
                set_meta(db, 'cutover_ms', now_ms())
                set_meta(db, 'model', 'gpt-6-astra')
            print(json.dumps({'baseline_imported': poll(db), 'cutover_ms': meta(db, 'cutover_ms')}))
        elif args.command == 'run':
            return run(db)
        elif args.command == 'status':
            print(json.dumps({'metadata': dict(db.execute('SELECT key,value FROM metadata')),
                              'counts': dict(db.execute('SELECT status,count(*) FROM reports GROUP BY status')),
                              'state_directory': str(STATE)}, indent=2))
        elif args.command in {'show','retry'}:
            identity = str(uuid.UUID(args.id or ''))
            row = db.execute('SELECT * FROM reports WHERE id=?', (identity,)).fetchone()
            if not row:
                raise RuntimeError('report_not_found')
            if args.command == 'retry':
                with db:
                    db.execute("UPDATE reports SET status='imported',attempts=0,next_attempt=0,error=NULL,review=NULL,message=NULL,telegram_message_id=NULL,delivery_attempts=0 WHERE id=?", (identity,))
            export(db, identity)
            print((STATE / 'reports' / f'{identity}.json').read_text())
        elif args.command == 'self-test':
            identity = str(uuid.uuid4())
            report = {'id': identity, 'created_at': now_ms(), 'message':
                'SYNTHETIC ACTIVATION TEST: Thank you for making a free reader. It helps me take a break from looking at the screen.',
                'context': {'environment': 'test', 'engine': 'browser', 'release': 'synthetic'}}
            review = investigate(report, probe=args.probe)
            import_rows(db, [report])
            message = 'SYNTHETIC ACTIVATION TEST\n\n' + render(review)
            with db:
                db.execute("UPDATE reports SET status='test',review=?,message=? WHERE id=?", (json.dumps(review), message, identity))
            if args.send:
                message_id = send(message)
                with db:
                    db.execute('UPDATE reports SET telegram_message_id=? WHERE id=?', (message_id, identity))
            export(db, identity)
            print(json.dumps({'id': identity, 'review': review, 'sent': args.send}, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # Do not emit arbitrary exception messages or tracebacks containing input/URLs.
        print('feedback-review failed: ' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
