-- Staging only. Four integer ledger units per source Unicode code point.
-- No existing rows, grants or payment configuration are changed.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='staging' AND version='unified-v1') THEN 'true' ELSE 'STAGING_ONLY_TRANSLATION' END);
CREATE TABLE translation_attempts(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),target TEXT NOT NULL,
 characters INTEGER NOT NULL CHECK(characters BETWEEN 1 AND 30000),units INTEGER NOT NULL CHECK(units=characters*4),
 state TEXT NOT NULL DEFAULT 'held' CHECK(state IN('held','ready','failed','uncertain','expired')),
 created INTEGER NOT NULL,updated INTEGER NOT NULL,deadline INTEGER NOT NULL,expires INTEGER NOT NULL,dispatched INTEGER,
 result TEXT CHECK(result IS NULL OR length(result) BETWEEN 1 AND 120000),
 consumed INTEGER NOT NULL DEFAULT 0,released INTEGER NOT NULL DEFAULT 0,retry_safe INTEGER NOT NULL DEFAULT 0 CHECK(retry_safe IN(0,1)),
 retry_of TEXT REFERENCES translation_attempts(id),CHECK(consumed IN(0,units)),CHECK(released IN(0,units)),CHECK(consumed=0 OR released=0)
);
CREATE UNIQUE INDEX translation_active_source ON translation_attempts(account,fingerprint) WHERE state IN('held','ready');
CREATE INDEX translation_expiry ON translation_attempts(state,expires);
CREATE TABLE translation_events(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),attempt TEXT NOT NULL REFERENCES translation_attempts(id),kind TEXT NOT NULL CHECK(kind IN('hold','settle','release')),delta INTEGER NOT NULL,created INTEGER NOT NULL,net INTEGER,UNIQUE(attempt,kind));
CREATE TRIGGER translation_check BEFORE INSERT ON translation_attempts BEGIN
 SELECT RAISE(ABORT,'invalid translation hold') WHERE NEW.state<>'held' OR NEW.consumed<>0 OR NEW.released<>0 OR NEW.dispatched IS NOT NULL OR NEW.result IS NOT NULL OR NEW.retry_safe<>0 OR NEW.deadline<=NEW.created OR NEW.deadline>NEW.created+120000 OR NEW.expires<>NEW.created+86400000;
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
 SELECT RAISE(ABORT,'invalid translation retry') WHERE NEW.retry_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM translation_attempts p WHERE p.id=NEW.retry_of AND p.account=NEW.account AND p.fingerprint=NEW.fingerprint AND p.target=NEW.target AND p.units=NEW.units AND p.retry_safe=1 AND p.state IN('failed','expired'));
END;
CREATE TRIGGER translation_event_apply AFTER INSERT ON translation_events BEGIN
 UPDATE translation_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM translation_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM translation_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
CREATE TRIGGER translation_event_update BEFORE UPDATE ON translation_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.attempt<>OLD.attempt OR NEW.kind<>OLD.kind OR NEW.delta<>OLD.delta OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable translation event'); END;
CREATE TRIGGER translation_event_delete BEFORE DELETE ON translation_events BEGIN SELECT RAISE(ABORT,'retain translation event'); END;
CREATE TRIGGER translation_hold AFTER INSERT ON translation_attempts BEGIN
 INSERT INTO translation_events(id,account,attempt,kind,delta,created) VALUES('translation-hold:'||NEW.id,NEW.account,NEW.id,'hold',-NEW.units,NEW.created);
END;
CREATE TRIGGER translation_identity BEFORE UPDATE ON translation_attempts WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.fingerprint<>OLD.fingerprint OR NEW.target<>OLD.target OR NEW.characters<>OLD.characters OR NEW.units<>OLD.units OR NEW.created<>OLD.created OR NEW.deadline<>OLD.deadline OR NEW.expires<>OLD.expires OR NEW.retry_of IS NOT OLD.retry_of OR (OLD.dispatched IS NOT NULL AND NEW.dispatched IS NOT OLD.dispatched) BEGIN SELECT RAISE(ABORT,'immutable translation identity'); END;
CREATE TRIGGER translation_transition BEFORE UPDATE OF state ON translation_attempts WHEN OLD.state<>NEW.state BEGIN
 SELECT RAISE(ABORT,'closed translation') WHERE OLD.state<>'held' AND NOT(OLD.state='ready' AND NEW.state='expired');
 SELECT RAISE(ABORT,'invalid translation settlement') WHERE NEW.state='ready' AND (OLD.state<>'held' OR NEW.dispatched IS NULL OR NEW.result IS NULL OR NEW.updated>NEW.deadline OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND enabled=1) OR EXISTS(SELECT 1 FROM unified_wallets WHERE account=NEW.account AND debt>0));
END;
CREATE TRIGGER translation_settle AFTER UPDATE OF state ON translation_attempts WHEN OLD.state='held' AND NEW.state='ready' BEGIN
 INSERT INTO translation_events(id,account,attempt,kind,delta,created) VALUES('translation-settle:'||NEW.id,NEW.account,NEW.id,'settle',0,NEW.updated);
 UPDATE translation_attempts SET consumed=units WHERE id=NEW.id;
END;
CREATE TRIGGER translation_release AFTER UPDATE OF state ON translation_attempts WHEN OLD.state='held' AND NEW.state IN('failed','uncertain','expired') BEGIN
 INSERT INTO translation_events(id,account,attempt,kind,delta,created) VALUES('translation-release:'||NEW.id,NEW.account,NEW.id,'release',NEW.units,NEW.updated);
 UPDATE translation_attempts SET released=units,result=NULL WHERE id=NEW.id;
END;
CREATE TRIGGER translation_no_delete BEFORE DELETE ON translation_attempts BEGIN SELECT RAISE(ABORT,'retain translation receipt'); END;

CREATE TRIGGER translation_result_immutable BEFORE UPDATE OF result ON translation_attempts WHEN OLD.state='ready' AND NOT(NEW.state='expired' AND NEW.result IS NULL) BEGIN SELECT RAISE(ABORT,'immutable saved translation'); END;

-- Keep refundable translation holds in existing purchase liability.
DROP VIEW unified_capacity;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM summary_credit_attempts WHERE state IN('held','prepared'))+(SELECT COALESCE(SUM(units),0) FROM ocr_jobs WHERE state='held')+(SELECT COALESCE(SUM(units),0) FROM translation_attempts WHERE state='held')+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';
