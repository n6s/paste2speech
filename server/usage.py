"""Private durable usage and sandbox credits. No source text or audio stored; verified account emails are private."""
import hashlib
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

PACK_CHARACTERS = 1_000_000

class AccountConflict(ValueError):
    pass

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
            CREATE TABLE IF NOT EXISTS account_debt (
              account TEXT PRIMARY KEY REFERENCES accounts(id), characters INTEGER NOT NULL CHECK(characters>=0));
            CREATE TABLE IF NOT EXISTS payment_sync (
              order_id TEXT PRIMARY KEY REFERENCES orders(id), checked REAL NOT NULL DEFAULT 0,
              revoked INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending');
            CREATE TABLE IF NOT EXISTS identities (
              email TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL REFERENCES accounts(id));
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS login_links (
              token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, flow_hash TEXT NOT NULL,
              source_account TEXT, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS login_limits (
              scope TEXT NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS login_limits_scope ON login_limits(scope,created);
            ''')
            # Existing orders retain the offer made when they were created.
            columns = {r['name'] for r in db.execute('PRAGMA table_info(orders)')}
            if 'characters' not in columns:
                db.execute('ALTER TABLE orders ADD COLUMN characters INTEGER NOT NULL DEFAULT 3000000')
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
                row = db.execute('SELECT a.id,a.balance,a.enabled FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token_hash=? AND s.expires>?', (self.digest(token), time.time())).fetchone()
            if not row:
                return None
            held = db.execute('SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE account=?',
                              (row['id'],)).fetchone()[0]
            email = db.execute('SELECT email FROM identities WHERE account=?', (row['id'],)).fetchone()
            debt = db.execute('SELECT characters FROM account_debt WHERE account=?',(row['id'],)).fetchone()
            return dict(row) | {'reserved': held, 'email': email[0] if email else None, 'shortfall':debt[0] if debt else 0}

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
            db.execute('INSERT INTO orders(id,account,created,characters) VALUES(?,?,?,?)', (key,account,self.now(),PACK_CHARACTERS))
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
                (transaction,row['account'],row['characters'],self.now())).rowcount
            if inserted:
                self.change_balance(db,row['account'],row['characters'])
            db.execute("UPDATE orders SET status='credited' WHERE id=?",(order,))
            return bool(inserted)

    def reserve(self, job, account, characters):
        if type(characters) is not int or characters <= 0:
            raise ValueError('Invalid allowance')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute('UPDATE accounts SET balance=balance-? WHERE id=? AND balance>=? AND NOT EXISTS (SELECT 1 FROM account_debt WHERE account=accounts.id AND characters>0)',
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
                self.change_balance(db,row['account'],row['remaining'])
                db.execute('DELETE FROM reservations WHERE job=?',(job,))

    def recover(self):
        # Call only on exclusive service startup. Finished chunks stay consumed;
        # uncertain in-flight work is refunded to the user after an interruption.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute('SELECT * FROM reservations').fetchall():
                self.change_balance(db,row['account'],row['remaining'])
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

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def login_request(self, email, flow, source_account, ip):
        now = time.time()
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM login_links WHERE expires<=?', (now,))
            db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
            db.execute('DELETE FROM login_limits WHERE created<?', (now-86400,))
            for scope, limit, window in [('email:'+self.digest(email), 5, 3600),
                                         ('ip:'+self.digest(ip), 20, 3600), ('global', 90, 86400)]:
                count = db.execute('SELECT COUNT(*) FROM login_limits WHERE scope=? AND created>?',
                                   (scope, now-window)).fetchone()[0]
                if count >= limit:
                    raise ValueError('Rate limited')
            for scope in ('email:'+self.digest(email), 'ip:'+self.digest(ip), 'global'):
                db.execute('INSERT INTO login_limits VALUES(?,?)', (scope,now))
            db.execute('INSERT INTO login_links VALUES(?,?,?,?,?)',
                       (self.digest(token),email,self.digest(flow),source_account,now+900))
        return token

    def cancel_login(self, token):
        with self.connect() as db:
            db.execute('DELETE FROM login_links WHERE token_hash=?', (self.digest(token),))

    def login_confirm(self, token, flow):
        now = time.time()
        session = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            link = db.execute('SELECT * FROM login_links WHERE token_hash=? AND expires>? AND flow_hash=?',
                              (self.digest(token),now,self.digest(flow))).fetchone()
            if not flow or not link:
                raise ValueError('Invalid link')
            existing = db.execute('SELECT account FROM identities WHERE email=?', (link['email'],)).fetchone()
            if existing:
                account = existing[0]
                # Do not silently abandon paid anonymous credit or merge accounts.
                source = link['source_account']
                if source and source != account:
                    value = db.execute("SELECT balance + COALESCE((SELECT SUM(remaining) FROM reservations WHERE account=?),0) FROM accounts WHERE id=?", (source,source)).fetchone()
                    pending = db.execute("SELECT 1 FROM orders WHERE account=? AND status='pending'", (source,)).fetchone()
                    if value and (value[0] or pending):
                        raise AccountConflict('This browser has separate credit or a pending purchase. Link it to a different email, or sign in to your existing account in a separate browser profile.')
            else:
                account = link['source_account']
                # An already verified account cannot be renamed through sign-in.
                if not account or db.execute('SELECT 1 FROM identities WHERE account=?', (account,)).fetchone():
                    account = secrets.token_urlsafe(24)
                    db.execute('INSERT INTO accounts(id,token_hash) VALUES(?,?)',
                               (account,self.digest(secrets.token_urlsafe(32))))
                db.execute('INSERT INTO identities VALUES(?,?)', (link['email'],account))
                # Replace the original unlimited browser credential on first verification.
                db.execute('UPDATE accounts SET token_hash=? WHERE id=?', (self.digest(secrets.token_urlsafe(32)),account))
            db.execute('DELETE FROM login_links WHERE token_hash=?', (self.digest(token),))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (self.digest(session),account,now+30*86400))
        return session

    def logout(self, token):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM sessions WHERE token_hash=?', (self.digest(token),))
            db.execute('UPDATE accounts SET token_hash=? WHERE token_hash=?',
                       (self.digest(secrets.token_urlsafe(32)),self.digest(token)))

    @staticmethod
    def change_balance(db, account, delta):
        balance = db.execute('SELECT balance FROM accounts WHERE id=?',(account,)).fetchone()[0]
        debt = db.execute('SELECT characters FROM account_debt WHERE account=?',(account,)).fetchone()
        net = balance - (debt[0] if debt else 0) + delta
        db.execute('UPDATE accounts SET balance=? WHERE id=?',(max(0,net),account))
        db.execute('INSERT INTO account_debt VALUES(?,?) ON CONFLICT(account) DO UPDATE SET characters=excluded.characters',
                   (account,max(0,-net)))

    def payment_candidates(self, limit=50):
        with self.connect() as db:
            return [dict(row) for row in db.execute("""SELECT o.* FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id
                WHERE o.transaction_id IS NOT NULL AND o.status!='canceled'
                ORDER BY COALESCE(s.checked,0),o.created LIMIT ?""",(limit,)).fetchall()]

    def payment_error(self, key):
        with self.connect() as db:
            db.execute("INSERT INTO payment_sync(order_id,checked,state) VALUES(?,?,'error') ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,state='error'",(key,time.time()))

    def payment_status(self, account):
        with self.connect() as db:
            rows = db.execute('SELECT checked,state,revoked FROM payment_sync s JOIN orders o ON o.id=s.order_id WHERE o.account=?',(account,)).fetchall()
            return {'lastChecked':max((r['checked'] for r in rows),default=None),
                    'needsAttention':any(r['state']=='error' for r in rows),
                    'revokedCharacters':sum(r['revoked'] for r in rows)}

    def sync_payment(self, key, transaction, state, revoked=0):
        if type(revoked) is not int or not 0<=revoked<=3_000_000:
            raise ValueError('Invalid revocation')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM orders WHERE id=? AND transaction_id=?',(key,transaction)).fetchone()
            if not row: raise ValueError('Unknown purchase')
            if revoked > row['characters']: raise ValueError('Invalid revocation')
            old = db.execute('SELECT revoked FROM payment_sync WHERE order_id=?',(key,)).fetchone()
            previous = old[0] if old else 0
            added = False
            if state == 'completed':
                added = bool(db.execute('INSERT OR IGNORE INTO grants VALUES(?,?,?,?)',
                    (transaction,row['account'],row['characters'],self.now())).rowcount)
                self.change_balance(db,row['account'],(row['characters'] if added else 0)+previous-revoked)
                db.execute("UPDATE orders SET status='credited' WHERE id=?",(key,))
            elif row['status']=='credited':
                raise ValueError('Completed purchase regressed')
            elif state == 'canceled':
                db.execute("UPDATE orders SET status='canceled' WHERE id=?",(key,))
            db.execute('INSERT INTO payment_sync VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,revoked=excluded.revoked,state=excluded.state',
                       (key,time.time(),revoked,state))
            return added

    def check_reservation(self, job):
        with self.connect() as db:
            row = db.execute('SELECT d.characters FROM reservations r JOIN account_debt d ON d.account=r.account WHERE r.job=?',(job,)).fetchone()
            if row and row[0]>0:
                raise InsufficientCredit('A payment refund changed your allowance. This reading has stopped; check speech usage.')
