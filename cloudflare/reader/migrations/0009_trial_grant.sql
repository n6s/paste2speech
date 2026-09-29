-- Operator-issued grant, never reachable from a public API. Identity must already
-- have been verified. The unique command ID makes retries a no-op.
CREATE TABLE trial_grants(id TEXT PRIMARY KEY CHECK(id='production-owner-trial-v1'),email TEXT NOT NULL,characters INTEGER NOT NULL CHECK(characters=100000),created INTEGER NOT NULL);
CREATE TRIGGER trial_grant_check BEFORE INSERT ON trial_grants BEGIN
 SELECT RAISE(ABORT,'trial_identity_required') WHERE NEW.email<>'rogerpbrown@gmail.com' OR NOT EXISTS(SELECT 1 FROM identities WHERE email=NEW.email);
END;
CREATE TRIGGER trial_grant_apply AFTER INSERT ON trial_grants BEGIN
 INSERT INTO grants(id,account,characters) SELECT NEW.id,account,NEW.characters FROM identities WHERE email=NEW.email;
END;
