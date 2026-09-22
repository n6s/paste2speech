CREATE TABLE reading_audit(job TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),created INTEGER NOT NULL,voice TEXT NOT NULL,mode TEXT NOT NULL,submitted INTEGER NOT NULL,seconds REAL NOT NULL,incomplete INTEGER NOT NULL,outcome TEXT NOT NULL);
CREATE TABLE legacy_usage(id TEXT PRIMARY KEY,created TEXT NOT NULL,provider TEXT NOT NULL,voice TEXT NOT NULL,kind TEXT NOT NULL,source_characters INTEGER NOT NULL,submitted_characters INTEGER NOT NULL,audio_seconds REAL NOT NULL,provider_cost REAL NOT NULL,cost_incomplete INTEGER NOT NULL,outcome TEXT NOT NULL);
CREATE TABLE legacy_accounts(token_hash TEXT PRIMARY KEY,account TEXT UNIQUE NOT NULL REFERENCES accounts(id));
CREATE TRIGGER legacy_revoke AFTER INSERT ON login_confirmations BEGIN
 DELETE FROM legacy_accounts WHERE account=(SELECT account FROM sessions WHERE token_hash=NEW.session_hash);
END;
