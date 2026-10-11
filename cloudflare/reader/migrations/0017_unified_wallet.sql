-- PRODUCTION ONLY. Additive zero-opening unified-v1 wallet.
-- Keep all legacy balances, holds, payments and history; no grant replay or refill.
-- 1 credit = 1000 integer units; speech 1 unit/character, OCR 2000 units/page.
CREATE TABLE unified_controls(id TEXT PRIMARY KEY CHECK(id='production'),version TEXT NOT NULL CHECK(version='unified-v1'));
INSERT INTO unified_controls VALUES('production','unified-v1');
CREATE TABLE unified_wallets(account TEXT PRIMARY KEY REFERENCES accounts(id),balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance>=0),debt INTEGER NOT NULL DEFAULT 0 CHECK(typeof(debt)='integer' AND debt>=0));
CREATE TABLE unified_events(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL CHECK(kind IN('purchase','refund','speech-hold','speech-release','ocr-hold','ocr-release')),reference TEXT NOT NULL,delta INTEGER NOT NULL CHECK(typeof(delta)='integer'),created INTEGER NOT NULL,net INTEGER);
CREATE TRIGGER unified_event_apply AFTER INSERT ON unified_events BEGIN
 INSERT OR IGNORE INTO unified_wallets(account) VALUES(NEW.account);
 UPDATE unified_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM unified_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM unified_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
-- Only the initial trigger may fill net; every completed event is immutable.
CREATE TRIGGER unified_event_update BEFORE UPDATE ON unified_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.kind<>OLD.kind OR NEW.reference<>OLD.reference OR NEW.delta<>OLD.delta OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable wallet event'); END;
CREATE TRIGGER unified_event_delete BEFORE DELETE ON unified_events BEGIN SELECT RAISE(ABORT,'immutable wallet event'); END;
ALTER TABLE reservations ADD COLUMN wallet_version TEXT NOT NULL DEFAULT 'legacy' CHECK(wallet_version IN('legacy','unified-v1'));
ALTER TABLE ocr_attempts ADD COLUMN wallet_version TEXT NOT NULL DEFAULT 'legacy' CHECK(wallet_version IN('legacy','unified-v1'));
DROP TRIGGER reservation_check;
CREATE TRIGGER reservation_check BEFORE INSERT ON reservations WHEN NEW.wallet_version='legacy' BEGIN
 SELECT RAISE(ABORT,'insufficient credit') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND (NEW.metered=0 OR (enabled=1 AND balance>=NEW.total))) OR EXISTS(SELECT 1 FROM account_debt WHERE account=NEW.account AND characters>0);
END;
DROP TRIGGER reservation_debit;
CREATE TRIGGER reservation_debit AFTER INSERT ON reservations WHEN NEW.metered=1 AND NEW.wallet_version='legacy' BEGIN
 UPDATE accounts SET balance=balance-NEW.total WHERE id=NEW.account;
END;
DROP TRIGGER reservation_refund;
CREATE TRIGGER reservation_refund AFTER UPDATE OF state ON reservations WHEN OLD.state='open' AND NEW.state='closed' AND NEW.metered=1 AND NEW.wallet_version='legacy' BEGIN
 INSERT INTO balance_changes(account,delta) VALUES(NEW.account,OLD.remaining);
END;
DROP TRIGGER ocr_attempt_check;
CREATE TRIGGER ocr_attempt_check BEFORE INSERT ON ocr_attempts BEGIN
 SELECT RAISE(ABORT,'insufficient OCR credit') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN ocr_accounts o ON o.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND o.debt=0 AND o.balance>=NEW.pages) AND NEW.wallet_version='legacy';
 SELECT RAISE(ABORT,'OCR business ceiling') WHERE NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND reserved_cents+(NEW.pages*8+9)/10<=cap_cents);
 SELECT RAISE(ABORT,'OCR provider allowance exhausted') WHERE NEW.provider_permit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=NEW.account AND p.id=NEW.provider_permit AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND NEW.pages<=p.max_pages AND (p.document_hash IS NULL OR p.document_hash=NEW.document_hash));
END;
DROP TRIGGER ocr_attempt_hold;
CREATE TRIGGER ocr_attempt_hold AFTER INSERT ON ocr_attempts BEGIN
 UPDATE ocr_accounts SET balance=balance-NEW.pages WHERE account=NEW.account AND NEW.wallet_version='legacy';
 UPDATE ocr_business_budget SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10 WHERE id='sandbox-retail';
 INSERT INTO ocr_business_reservations VALUES(NEW.id,(NEW.pages*8+9)/10);
 UPDATE ocr_provider_permits SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10,calls=calls+1 WHERE id=NEW.provider_permit;
 INSERT INTO ocr_provider_reservations SELECT NEW.id,NEW.provider_permit,(NEW.pages*8+9)/10 WHERE NEW.provider_permit IS NOT NULL;
END;
DROP TRIGGER ocr_usage_check;
CREATE TRIGGER ocr_usage_check BEFORE INSERT ON ocr_usage BEGIN
 SELECT RAISE(ABORT,'invalid OCR usage') WHERE NOT EXISTS(SELECT 1 FROM ocr_attempts a LEFT JOIN ocr_accounts o ON o.account=a.account WHERE a.id=NEW.attempt AND a.state='held' AND NEW.page<a.pages AND (a.wallet_version='unified-v1' OR o.debt=0));
END;
DROP TRIGGER ocr_settle;
CREATE TRIGGER ocr_settle BEFORE INSERT ON ocr_settlements BEGIN
 SELECT RAISE(ABORT,'closed OCR hold') WHERE NOT EXISTS(SELECT 1 FROM ocr_attempts WHERE id=NEW.attempt AND state='held');
 SELECT RAISE(ABORT,'invalid OCR result') WHERE NEW.outcome='ready' AND (NEW.cache_key IS NULL OR NEW.expires<=NEW.created OR NOT EXISTS(SELECT 1 FROM ocr_attempts WHERE id=NEW.attempt AND dispatched IS NOT NULL AND deadline>=NEW.created));
 INSERT INTO ocr_usage(attempt,page) SELECT NEW.attempt,CAST(value AS INTEGER) FROM json_each('[0,1,2,3,4,5,6,7,8,9]') WHERE NEW.outcome='ready' AND value<(SELECT pages FROM ocr_attempts WHERE id=NEW.attempt);
 INSERT INTO ocr_changes(account,delta) SELECT account,pages FROM ocr_attempts WHERE id=NEW.attempt AND NEW.outcome<>'ready' AND wallet_version='legacy';
 INSERT INTO unified_events(id,account,kind,reference,delta,created) SELECT 'ocr-release:'||id,account,'ocr-release',id,pages*2000,NEW.created FROM ocr_attempts WHERE id=NEW.attempt AND NEW.outcome<>'ready' AND wallet_version='unified-v1';
 UPDATE ocr_attempts SET state=NEW.outcome,updated=NEW.created,expires=NEW.expires,cache_key=NEW.cache_key,consumed=CASE WHEN NEW.outcome='ready' THEN pages ELSE 0 END,released=CASE WHEN NEW.outcome='ready' THEN 0 ELSE pages END WHERE id=NEW.attempt;
END;
CREATE TRIGGER unified_speech_check BEFORE INSERT ON reservations WHEN NEW.wallet_version='unified-v1' BEGIN
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.total) OR NEW.metered<>1 OR typeof(NEW.total)<>'integer';
END;
CREATE TRIGGER unified_speech_hold AFTER INSERT ON reservations WHEN NEW.wallet_version='unified-v1' BEGIN
 INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES('speech-hold:'||NEW.job,NEW.account,'speech-hold',NEW.job,-NEW.total,NEW.created);
END;
CREATE TRIGGER unified_speech_release AFTER UPDATE OF state ON reservations WHEN OLD.state='open' AND NEW.state='closed' AND NEW.wallet_version='unified-v1' BEGIN
 INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES('speech-release:'||NEW.job,NEW.account,'speech-release',NEW.job,OLD.remaining,CAST(strftime('%s','now') AS INTEGER)*1000);
END;
CREATE TRIGGER unified_ocr_check BEFORE INSERT ON ocr_attempts WHEN NEW.wallet_version='unified-v1' BEGIN
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.pages*2000) OR typeof(NEW.pages)<>'integer';
END;
CREATE TRIGGER unified_ocr_hold AFTER INSERT ON ocr_attempts WHEN NEW.wallet_version='unified-v1' BEGIN
 INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES('ocr-hold:'||NEW.id,NEW.account,'ocr-hold',NEW.id,-NEW.pages*2000,NEW.created);
END;
CREATE TABLE unified_orders(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),transaction_id TEXT UNIQUE,created TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',creation_state TEXT NOT NULL DEFAULT 'new',environment TEXT NOT NULL CHECK(environment='live'),price_id TEXT NOT NULL,product_id TEXT NOT NULL,amount TEXT NOT NULL CHECK(amount='1000'),currency TEXT NOT NULL CHECK(currency='USD'),units INTEGER NOT NULL CHECK(units=1000000),wallet_version TEXT NOT NULL DEFAULT 'unified-v1' CHECK(wallet_version='unified-v1'));
CREATE UNIQUE INDEX unified_one_pending_order ON unified_orders(account) WHERE status='pending';
CREATE TABLE unified_grants(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),units INTEGER NOT NULL CHECK(units=1000000));
CREATE TRIGGER unified_grant AFTER INSERT ON unified_grants BEGIN INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES('purchase:'||NEW.id,NEW.account,'purchase',NEW.id,NEW.units,CAST(strftime('%s','now') AS INTEGER)*1000); END;
CREATE TRIGGER unified_grant_update BEFORE UPDATE ON unified_grants BEGIN SELECT RAISE(ABORT,'immutable grant'); END;
CREATE TRIGGER unified_grant_delete BEFORE DELETE ON unified_grants BEGIN SELECT RAISE(ABORT,'immutable grant'); END;
CREATE TABLE unified_payment_sync(order_id TEXT PRIMARY KEY REFERENCES unified_orders(id),checked INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,next_check INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0);
CREATE TABLE unified_payment_commands(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES unified_orders(id),transaction_id TEXT NOT NULL,state TEXT NOT NULL,revoked INTEGER NOT NULL CHECK(typeof(revoked)='integer' AND revoked BETWEEN 0 AND 1000000),checked INTEGER NOT NULL);
CREATE TRIGGER unified_payment_apply BEFORE INSERT ON unified_payment_commands BEGIN
 SELECT RAISE(ABORT,'invalid unified payment') WHERE NOT EXISTS(SELECT 1 FROM unified_orders WHERE id=NEW.order_id AND transaction_id=NEW.transaction_id)
 OR NEW.state NOT IN ('draft','ready','billed','paid','completed','canceled','past_due') OR (NEW.state<>'completed' AND EXISTS(SELECT 1 FROM unified_orders WHERE id=NEW.order_id AND status='credited'));
 INSERT INTO unified_grants SELECT NEW.transaction_id,account,units FROM unified_orders WHERE id=NEW.order_id AND NEW.state='completed' AND NOT EXISTS(SELECT 1 FROM unified_grants WHERE id=NEW.transaction_id);
 INSERT INTO unified_events(id,account,kind,reference,delta,created) SELECT 'refund:'||NEW.id,account,'refund',NEW.transaction_id,COALESCE((SELECT revoked FROM unified_payment_sync WHERE order_id=NEW.order_id),0)-NEW.revoked,NEW.checked FROM unified_orders WHERE id=NEW.order_id AND NEW.state='completed' AND COALESCE((SELECT revoked FROM unified_payment_sync WHERE order_id=NEW.order_id),0)<>NEW.revoked;
 UPDATE unified_orders SET status=CASE WHEN NEW.state='completed' THEN 'credited' WHEN NEW.state='canceled' THEN 'canceled' ELSE status END WHERE id=NEW.order_id;
 INSERT INTO unified_payment_sync(order_id,checked,revoked,state) VALUES(NEW.order_id,NEW.checked,NEW.revoked,NEW.state) ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,revoked=excluded.revoked,state=excluded.state;
END;
CREATE TRIGGER unified_command_update BEFORE UPDATE ON unified_payment_commands BEGIN SELECT RAISE(ABORT,'immutable payment evidence'); END;
CREATE TRIGGER unified_command_delete BEFORE DELETE ON unified_payment_commands BEGIN SELECT RAISE(ABORT,'immutable payment evidence'); END;
CREATE TABLE unified_webhook_events(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,received INTEGER NOT NULL,processed INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);
CREATE INDEX unified_wallet_activity ON unified_events(account,created);
CREATE INDEX unified_pending_webhooks ON unified_webhook_events(processed,next_attempt);
-- A fresh wallet admits new work only against unified credits. Legacy balances
-- stay recorded but cannot fund new work; existing legacy OCR holds still count.
-- Keep ocr_capacity and all legacy purchase guards unchanged for recovery.
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents
 FROM ocr_business_budget b WHERE id='sandbox-retail';
CREATE TRIGGER unified_order_capacity BEFORE INSERT ON unified_orders BEGIN
 SELECT RAISE(ABORT,'shared purchase capacity exhausted') WHERE NOT EXISTS(SELECT 1 FROM unified_capacity WHERE reserved_cents+committed_cents+NEW.units/2000<=cap_cents);
END;
CREATE TRIGGER unified_speech_provenance BEFORE UPDATE OF wallet_version ON reservations WHEN NEW.wallet_version<>OLD.wallet_version BEGIN SELECT RAISE(ABORT,'immutable wallet provenance'); END;
CREATE TRIGGER unified_ocr_provenance BEFORE UPDATE OF wallet_version ON ocr_attempts WHEN NEW.wallet_version<>OLD.wallet_version BEGIN SELECT RAISE(ABORT,'immutable wallet provenance'); END;

CREATE TRIGGER unified_control_update BEFORE UPDATE ON unified_controls BEGIN SELECT RAISE(ABORT,'immutable wallet environment'); END;
CREATE TRIGGER unified_control_delete BEFORE DELETE ON unified_controls BEGIN SELECT RAISE(ABORT,'immutable wallet environment'); END;
