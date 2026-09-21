"""Private durable usage and sandbox credits. No source text, audio or email stored."""
import hashlib
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

PACK_CHARACTERS = 3_000_000

class InsufficientCredit(Exception):
    pass

class Ledger:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS accounts (
              id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
              balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0), enabled INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
              transaction_id TEXT UNIQUE, created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
            CREATE TABLE IF NOT EXISTS grants (
              transaction_id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
              characters INTEGER NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reservations (
              job TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
              remaining INTEGER NOT NULL CHECK(remaining >= 0));
            CREATE TABLE IF NOT EXISTS usage (
              id TEXT PRIMARY KEY, created TEXT NOT NULL, provider TEXT NOT NULL,
              voice TEXT NOT NULL, kind TEXT NOT NULL, source_characters INTEGER NOT NULL,
              submitted_characters INTEGER NOT NULL, audio_seconds REAL NOT NULL,
              provider_cost REAL NOT NULL, cost_incomplete INTEGER NOT NULL, outcome TEXT NOT NULL);
            ''')
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()

    def new_account(self):
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('INSERT INTO accounts(id,token_hash) VALUES(?,?)',
                       (secrets.token_urlsafe(24), hashlib.sha256(token.encode()).hexdigest()))
        return token

    def account(self, token):
        if not token or len(token) > 100:
            return None
        with self.connect() as db:
            row = db.execute('SELECT id,balance,enabled FROM accounts WHERE token_hash=?',
                             (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            if not row:
                return None
            held = db.execute('SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE account=?',
                              (row['id'],)).fetchone()[0]
            return dict(row) | {'reserved': held}

    def enable(self, account, enabled):
        with self.connect() as db:
            db.execute('UPDATE accounts SET enabled=? WHERE id=?', (int(enabled), account))

    def new_order(self, account):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            # Reuse an outstanding order to make double-clicks/reloads harmless.
            existing = db.execute("SELECT * FROM orders WHERE account=? AND status='pending' ORDER BY created DESC LIMIT 1", (account,)).fetchone()
            if existing:
                return dict(existing)
            key = secrets.token_urlsafe(24)
            db.execute('INSERT INTO orders(id,account,created) VALUES(?,?,?)', (key,account,self.now()))
            return dict(db.execute('SELECT * FROM orders WHERE id=?',(key,)).fetchone())

    def bind_order(self, order, transaction):
        with self.connect() as db:
            db.execute('UPDATE orders SET transaction_id=? WHERE id=? AND transaction_id IS NULL', (transaction,order))

    def order(self, key, account):
        with self.connect() as db:
            row = db.execute('SELECT * FROM orders WHERE id=? AND account=?',(key,account)).fetchone()
            return dict(row) if row else None

    def pending_order(self, account):
        with self.connect() as db:
            row = db.execute("SELECT id FROM orders WHERE account=? AND status='pending' AND transaction_id IS NOT NULL ORDER BY created DESC LIMIT 1", (account,)).fetchone()
            return row['id'] if row else None

    def fulfill(self, order, transaction):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM orders WHERE id=? AND transaction_id=?', (order,transaction)).fetchone()
            if not row:
                raise ValueError('Unknown purchase')
            inserted = db.execute('INSERT OR IGNORE INTO grants VALUES(?,?,?,?)',
                (transaction,row['account'],PACK_CHARACTERS,self.now())).rowcount
            if inserted:
                db.execute('UPDATE accounts SET balance=balance+? WHERE id=?',(PACK_CHARACTERS,row['account']))
            db.execute("UPDATE orders SET status='credited' WHERE id=?",(order,))
            return bool(inserted)

    def reserve(self, job, account, characters):
        if type(characters) is not int or characters <= 0:
            raise ValueError('Invalid allowance')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute('UPDATE accounts SET balance=balance-? WHERE id=? AND balance>=?',
                                 (characters,account,characters)).rowcount
            if not changed:
                raise InsufficientCredit('Not enough sandbox credit for this reading. Add a test pack or use a shorter passage.')
            db.execute('INSERT INTO reservations VALUES(?,?,?)',(job,account,characters))

    def record(self, key, *, provider, voice, kind, source_characters, submitted_characters,
               audio_seconds, provider_cost=0, cost_incomplete=False, outcome='succeeded', job=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM usage WHERE id=?',(key,)).fetchone():
                return
            if job and outcome == 'succeeded':
                updated = db.execute('UPDATE reservations SET remaining=remaining-? WHERE job=? AND remaining>=?',
                                     (source_characters,job,source_characters)).rowcount
                if not updated:
                    raise ValueError('Missing speech reservation')
            db.execute('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                (key,self.now(),provider,voice,kind,source_characters,submitted_characters,
                 audio_seconds,provider_cost,int(cost_incomplete),outcome))

    def release(self, job):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM reservations WHERE job=?',(job,)).fetchone()
            if row:
                db.execute('UPDATE accounts SET balance=balance+? WHERE id=?',(row['remaining'],row['account']))
                db.execute('DELETE FROM reservations WHERE job=?',(job,))

    def recover(self):
        # Call only on exclusive service startup. Finished chunks stay consumed;
        # uncertain in-flight work is refunded to the user after an interruption.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute('SELECT * FROM reservations').fetchall():
                db.execute('UPDATE accounts SET balance=balance+? WHERE id=?',(row['remaining'],row['account']))
            db.execute('DELETE FROM reservations')

    def summary(self, month):
        with self.connect() as db:
            rows = db.execute('''SELECT provider,kind,COUNT(*) AS sections,
                SUM(source_characters) AS sourceCharacters, SUM(submitted_characters) AS submittedCharacters,
                SUM(audio_seconds) AS seconds, SUM(provider_cost) AS providerCost,
                SUM(cost_incomplete) AS incompleteCosts,
                SUM(CASE WHEN outcome='succeeded' THEN source_characters ELSE 0 END) AS completedCharacters
                FROM usage WHERE substr(created,1,7)=? GROUP BY provider,kind''',(month,)).fetchall()
            return [dict(row) for row in rows]
