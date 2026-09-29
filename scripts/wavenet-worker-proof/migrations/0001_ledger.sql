-- LOCAL PILOT ONLY. Never applied to the live Python ledger or public D1.
PRAGMA foreign_keys=ON;
CREATE TABLE accounts(id TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0));
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
CREATE TABLE grants(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), characters INTEGER NOT NULL CHECK(characters>0));
CREATE TRIGGER grant_credit AFTER INSERT ON grants BEGIN
  UPDATE accounts SET balance=balance+NEW.characters WHERE id=NEW.account;
END;
CREATE TABLE reservations(
  job TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), fingerprint TEXT NOT NULL,
  plan TEXT NOT NULL, total INTEGER NOT NULL CHECK(total>0), remaining INTEGER NOT NULL CHECK(remaining>=0),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
  outcome TEXT, created INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, released INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER reservation_check BEFORE INSERT ON reservations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND enabled=1 AND balance>=NEW.total)
    THEN RAISE(ABORT,'insufficient credit') END;
END;
CREATE TRIGGER reservation_debit AFTER INSERT ON reservations BEGIN
  UPDATE accounts SET balance=balance-NEW.total WHERE id=NEW.account;
END;
CREATE TABLE usage(
  job TEXT NOT NULL REFERENCES reservations(job), section INTEGER NOT NULL, characters INTEGER NOT NULL CHECK(characters>0),
  PRIMARY KEY(job,section)
);
CREATE TRIGGER usage_check BEFORE INSERT ON usage BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reservations WHERE job=NEW.job AND state='open' AND remaining>=NEW.characters)
    THEN RAISE(ABORT,'invalid reservation') END;
END;
CREATE TRIGGER usage_consume AFTER INSERT ON usage BEGIN
  UPDATE reservations SET remaining=remaining-NEW.characters,consumed=consumed+NEW.characters WHERE job=NEW.job;
END;
CREATE TRIGGER reservation_refund AFTER UPDATE OF state ON reservations
WHEN OLD.state='open' AND NEW.state='closed' BEGIN
  UPDATE accounts SET balance=balance+OLD.remaining WHERE id=NEW.account;
END;
-- Synthetic identities and grants; these are not migrated customer balances.
INSERT INTO accounts(id,label) VALUES('test-reader-a','Test reader A'),('test-reader-b','Test reader B'),('test-low-credit','Low-credit test reader');
INSERT INTO grants VALUES('local-seed-a','test-reader-a',5000),('local-seed-b','test-reader-b',5000),('local-seed-low','test-low-credit',800);
