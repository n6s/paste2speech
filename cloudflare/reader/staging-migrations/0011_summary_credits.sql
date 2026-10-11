-- STAGING ONLY: Roger approved one shared credit per accepted ordinary Summary.
-- Original source text is never stored. Only generated results have 24h access.
-- Additive journal: preserve every existing wallet event, grant and reservation.
CREATE TABLE summary_credit_attempts(
 id TEXT PRIMARY KEY REFERENCES summary_free_requests(id),account TEXT NOT NULL REFERENCES accounts(id),
 units INTEGER NOT NULL DEFAULT 1000 CHECK(units=1000),
 state TEXT NOT NULL DEFAULT 'held' CHECK(state IN('held','prepared','ready','canceled','failed','uncertain','expired')),
 created INTEGER NOT NULL,updated INTEGER NOT NULL,deadline INTEGER NOT NULL,dispatched INTEGER,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1000)),released INTEGER NOT NULL DEFAULT 0 CHECK(released IN(0,1000)),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),language TEXT NOT NULL,length TEXT NOT NULL
);
CREATE TABLE summary_credit_events(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),attempt TEXT NOT NULL REFERENCES summary_credit_attempts(id),
 kind TEXT NOT NULL CHECK(kind IN('hold','settle','release')),delta INTEGER NOT NULL CHECK(typeof(delta)='integer'),created INTEGER NOT NULL,net INTEGER,
 UNIQUE(attempt,kind)
);
CREATE TABLE summary_credit_results(attempt TEXT PRIMARY KEY REFERENCES summary_credit_attempts(id),summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 8000),expires INTEGER NOT NULL);
CREATE INDEX summary_credit_expiry ON summary_credit_attempts(state,deadline);
CREATE INDEX summary_result_expiry ON summary_credit_results(expires);
CREATE TRIGGER summary_credit_check BEFORE INSERT ON summary_credit_attempts BEGIN
 SELECT RAISE(ABORT,'invalid summary hold') WHERE NEW.state<>'held' OR NEW.consumed<>0 OR NEW.released<>0 OR NEW.dispatched IS NOT NULL OR NEW.deadline<=NEW.created OR NOT EXISTS(SELECT 1 FROM summary_free_requests WHERE id=NEW.id AND account=NEW.account AND state='admitted');
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
END;
CREATE TRIGGER summary_credit_event_apply AFTER INSERT ON summary_credit_events BEGIN
 UPDATE summary_credit_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM summary_credit_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM summary_credit_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
CREATE TRIGGER summary_credit_event_update BEFORE UPDATE ON summary_credit_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.attempt<>OLD.attempt OR NEW.kind<>OLD.kind OR NEW.delta<>OLD.delta OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable summary credit event'); END;
CREATE TRIGGER summary_credit_event_delete BEFORE DELETE ON summary_credit_events BEGIN SELECT RAISE(ABORT,'immutable summary credit event'); END;
CREATE TRIGGER summary_credit_hold AFTER INSERT ON summary_credit_attempts BEGIN
 INSERT INTO summary_credit_events(id,account,attempt,kind,delta,created) VALUES('summary-hold:'||NEW.id,NEW.account,NEW.id,'hold',-NEW.units,NEW.created);
END;
CREATE TRIGGER summary_credit_identity BEFORE UPDATE ON summary_credit_attempts WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.units<>OLD.units OR NEW.created<>OLD.created OR NEW.deadline<>OLD.deadline OR NEW.fingerprint<>OLD.fingerprint OR NEW.language<>OLD.language OR NEW.length<>OLD.length OR (OLD.dispatched IS NOT NULL AND NEW.dispatched IS NOT OLD.dispatched) BEGIN SELECT RAISE(ABORT,'immutable summary billing identity'); END;
CREATE TRIGGER summary_credit_transition BEFORE UPDATE OF state ON summary_credit_attempts WHEN NEW.state<>OLD.state BEGIN
 SELECT RAISE(ABORT,'closed summary hold') WHERE OLD.state NOT IN('held','prepared');
 SELECT RAISE(ABORT,'invalid summary completion') WHERE NEW.state IN('held','prepared') AND NOT(OLD.state='held' AND NEW.state='prepared' AND NEW.dispatched IS NOT NULL AND NEW.updated<=NEW.deadline AND EXISTS(SELECT 1 FROM summary_credit_results WHERE attempt=NEW.id AND expires>NEW.updated));
 SELECT RAISE(ABORT,'invalid summary acceptance') WHERE NEW.state='ready' AND (OLD.state<>'prepared' OR NEW.updated>NEW.deadline OR NOT EXISTS(SELECT 1 FROM summary_credit_results WHERE attempt=NEW.id AND expires>NEW.updated) OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND enabled=1) OR EXISTS(SELECT 1 FROM unified_wallets WHERE account=NEW.account AND debt>0));
END;
CREATE TRIGGER summary_credit_settle AFTER UPDATE OF state ON summary_credit_attempts WHEN OLD.state='prepared' AND NEW.state='ready' BEGIN
 INSERT INTO summary_credit_events(id,account,attempt,kind,delta,created) VALUES('summary-settle:'||NEW.id,NEW.account,NEW.id,'settle',0,NEW.updated);
 UPDATE summary_credit_attempts SET consumed=1000 WHERE id=NEW.id;
END;
CREATE TRIGGER summary_credit_release AFTER UPDATE OF state ON summary_credit_attempts WHEN OLD.state IN('held','prepared') AND NEW.state IN('canceled','failed','uncertain','expired') BEGIN
 INSERT INTO summary_credit_events(id,account,attempt,kind,delta,created) VALUES('summary-release:'||NEW.id,NEW.account,NEW.id,'release',NEW.units,NEW.updated);
 UPDATE summary_credit_attempts SET released=1000 WHERE id=NEW.id;
 DELETE FROM summary_credit_results WHERE attempt=NEW.id;
END;
CREATE TRIGGER summary_credit_no_delete BEFORE DELETE ON summary_credit_attempts BEGIN SELECT RAISE(ABORT,'retain summary billing receipt'); END;
-- Include refundable Summary holds in existing staging purchase liability.
DROP VIEW unified_capacity;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM summary_credit_attempts WHERE state IN('held','prepared'))+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents
 FROM ocr_business_budget b WHERE id='sandbox-retail';
