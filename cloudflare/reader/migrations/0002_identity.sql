-- Browser-bound email identity and durable sessions for the private reader.
CREATE TABLE identities(email TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL REFERENCES accounts(id));
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'test';
CREATE TABLE orders(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), transaction_id TEXT UNIQUE,
 created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', characters INTEGER NOT NULL DEFAULT 1000000 CHECK(characters>0));
CREATE TABLE login_links(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,flow_hash TEXT NOT NULL,
 source_account TEXT REFERENCES accounts(id),expires INTEGER NOT NULL,created INTEGER NOT NULL,email_scope TEXT NOT NULL,ip_scope TEXT NOT NULL);
CREATE TABLE login_limits(scope TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX login_limits_scope ON login_limits(scope,created);
CREATE TRIGGER login_limit_check BEFORE INSERT ON login_links BEGIN
 SELECT RAISE(ABORT,'login_rate_limited') WHERE (SELECT COUNT(*) FROM login_limits WHERE scope=NEW.email_scope AND created>NEW.created-3600000)>=5
 OR (SELECT COUNT(*) FROM login_limits WHERE scope=NEW.ip_scope AND created>NEW.created-3600000)>=20
 OR (SELECT COUNT(*) FROM login_limits WHERE scope='global' AND created>NEW.created-86400000)>=90;
END;
CREATE TRIGGER login_limit_record AFTER INSERT ON login_links BEGIN
 INSERT INTO login_limits VALUES(NEW.email_scope,NEW.created),(NEW.ip_scope,NEW.created),('global',NEW.created);
END;
-- Inserting this short-lived command performs confirmation in ONE transaction.
-- Single-use validation, identity selection and session issuance cannot race.
CREATE TABLE login_confirmations(token_hash TEXT PRIMARY KEY,flow_hash TEXT NOT NULL,new_account TEXT NOT NULL,
 session_hash TEXT NOT NULL,confirmed INTEGER NOT NULL);
CREATE TRIGGER login_confirm BEFORE INSERT ON login_confirmations BEGIN
 SELECT RAISE(ABORT,'login_invalid') WHERE NOT EXISTS(SELECT 1 FROM login_links WHERE token_hash=NEW.token_hash AND flow_hash=NEW.flow_hash AND expires>NEW.confirmed);
 SELECT RAISE(ABORT,'login_account_conflict') WHERE EXISTS(
  SELECT 1 FROM login_links l JOIN identities i ON i.email=l.email JOIN accounts a ON a.id=l.source_account
  WHERE l.token_hash=NEW.token_hash AND a.id<>i.account AND
  (a.balance>0 OR EXISTS(SELECT 1 FROM reservations WHERE account=a.id AND state='open' AND remaining>0)
  OR EXISTS(SELECT 1 FROM orders WHERE account=a.id AND status='pending')));
 INSERT INTO accounts(id,label)
 SELECT NEW.new_account,'Reader' FROM login_links l WHERE l.token_hash=NEW.token_hash
 AND NOT EXISTS(SELECT 1 FROM identities WHERE email=l.email)
 AND (l.source_account IS NULL OR EXISTS(SELECT 1 FROM identities WHERE account=l.source_account));
 INSERT INTO identities(email,account)
 SELECT l.email, COALESCE((SELECT l.source_account WHERE l.source_account IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identities WHERE account=l.source_account)),NEW.new_account) FROM login_links l WHERE l.token_hash=NEW.token_hash
 AND NOT EXISTS(SELECT 1 FROM identities WHERE email=l.email);
 DELETE FROM sessions WHERE kind IN ('test','anonymous') AND account=(SELECT i.account FROM identities i JOIN login_links l ON i.email=l.email WHERE l.token_hash=NEW.token_hash);
 INSERT INTO sessions(token_hash,account,expires,kind)
 SELECT NEW.session_hash,i.account,NEW.confirmed+2592000000,'verified' FROM identities i JOIN login_links l ON i.email=l.email WHERE l.token_hash=NEW.token_hash;
 DELETE FROM login_links WHERE token_hash=NEW.token_hash;
END;
CREATE TRIGGER login_confirm_cleanup AFTER INSERT ON login_confirmations BEGIN
 DELETE FROM login_confirmations WHERE token_hash=NEW.token_hash;
END;
