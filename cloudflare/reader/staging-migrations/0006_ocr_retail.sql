-- Sandbox retail OCR only. No production migration or live policy approval.
CREATE TABLE ocr_accounts(account TEXT PRIMARY KEY REFERENCES accounts(id),balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),debt INTEGER NOT NULL DEFAULT 0 CHECK(debt>=0));
CREATE TABLE ocr_changes(id INTEGER PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL,net INTEGER);
CREATE TRIGGER ocr_change AFTER INSERT ON ocr_changes BEGIN
 INSERT OR IGNORE INTO ocr_accounts(account) VALUES(NEW.account);
 UPDATE ocr_changes SET net=(SELECT balance-debt FROM ocr_accounts WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE ocr_accounts SET balance=MAX(0,(SELECT net FROM ocr_changes WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM ocr_changes WHERE id=NEW.id)) WHERE account=NEW.account;
 DELETE FROM ocr_changes WHERE id=NEW.id;
END;
CREATE TABLE ocr_orders(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),transaction_id TEXT UNIQUE,created TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',creation_state TEXT NOT NULL DEFAULT 'new',environment TEXT NOT NULL CHECK(environment='sandbox'),price_id TEXT NOT NULL,product_id TEXT NOT NULL,amount TEXT NOT NULL CHECK(amount='1000'),currency TEXT NOT NULL CHECK(currency='USD'),pages INTEGER NOT NULL CHECK(pages=500));
CREATE UNIQUE INDEX ocr_one_pending_order ON ocr_orders(account) WHERE status='pending';
CREATE TABLE ocr_grants(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),pages INTEGER NOT NULL CHECK(pages=500));
CREATE TRIGGER ocr_grant AFTER INSERT ON ocr_grants BEGIN INSERT INTO ocr_changes(account,delta) VALUES(NEW.account,NEW.pages); END;
CREATE TRIGGER ocr_grant_immutable_update BEFORE UPDATE ON ocr_grants BEGIN SELECT RAISE(ABORT,'immutable grant'); END;
CREATE TRIGGER ocr_grant_immutable_delete BEFORE DELETE ON ocr_grants BEGIN SELECT RAISE(ABORT,'immutable grant'); END;
CREATE TABLE ocr_payment_sync(order_id TEXT PRIMARY KEY REFERENCES ocr_orders(id),checked INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,next_check INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ocr_payment_commands(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES ocr_orders(id),transaction_id TEXT NOT NULL,state TEXT NOT NULL,revoked INTEGER NOT NULL CHECK(revoked BETWEEN 0 AND 500),checked INTEGER NOT NULL);
CREATE TABLE ocr_refund_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES ocr_orders(id),delta INTEGER NOT NULL,created INTEGER NOT NULL);
CREATE TABLE ocr_attempts(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),document_hash TEXT NOT NULL,model TEXT NOT NULL,mime TEXT NOT NULL,pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 10),name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'held' CHECK(state IN ('held','ready','uncertain','failed')),created INTEGER NOT NULL,updated INTEGER NOT NULL,deadline INTEGER NOT NULL,dispatched INTEGER,expires INTEGER,cache_key TEXT,consumed INTEGER NOT NULL DEFAULT 0,released INTEGER NOT NULL DEFAULT 0,UNIQUE(account,document_hash,model));
CREATE TABLE ocr_business_budget(id TEXT PRIMARY KEY,cap_cents INTEGER NOT NULL CHECK(cap_cents BETWEEN 1 AND 1000),reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents));
-- New sandbox business ledger; the owner experiment budget is untouched.
INSERT INTO ocr_business_budget VALUES('sandbox-retail',1000,0);
CREATE TABLE ocr_business_reservations(attempt TEXT PRIMARY KEY REFERENCES ocr_attempts(id),cents INTEGER NOT NULL CHECK(cents=8));
CREATE TRIGGER ocr_attempt_check BEFORE INSERT ON ocr_attempts BEGIN
 SELECT RAISE(ABORT,'insufficient OCR credit') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN ocr_accounts o ON o.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND o.debt=0 AND o.balance>=NEW.pages);
 SELECT RAISE(ABORT,'OCR business ceiling') WHERE NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND reserved_cents+8<=cap_cents);
END;
CREATE TRIGGER ocr_attempt_hold AFTER INSERT ON ocr_attempts BEGIN
 UPDATE ocr_accounts SET balance=balance-NEW.pages WHERE account=NEW.account;
 UPDATE ocr_business_budget SET reserved_cents=reserved_cents+8 WHERE id='sandbox-retail';
 INSERT INTO ocr_business_reservations VALUES(NEW.id,8);
END;
CREATE TABLE ocr_usage(attempt TEXT NOT NULL REFERENCES ocr_attempts(id),page INTEGER NOT NULL CHECK(page>=0 AND page<10),PRIMARY KEY(attempt,page));
CREATE TRIGGER ocr_usage_immutable_update BEFORE UPDATE ON ocr_usage BEGIN SELECT RAISE(ABORT,'immutable usage'); END;
CREATE TRIGGER ocr_usage_immutable_delete BEFORE DELETE ON ocr_usage BEGIN SELECT RAISE(ABORT,'immutable usage'); END;
CREATE TRIGGER ocr_usage_check BEFORE INSERT ON ocr_usage BEGIN
 SELECT RAISE(ABORT,'invalid OCR usage') WHERE NOT EXISTS(SELECT 1 FROM ocr_attempts a JOIN ocr_accounts o ON o.account=a.account WHERE a.id=NEW.attempt AND a.state='held' AND NEW.page<a.pages AND o.debt=0);
END;
CREATE TABLE ocr_settlements(attempt TEXT PRIMARY KEY REFERENCES ocr_attempts(id),outcome TEXT NOT NULL CHECK(outcome IN ('ready','uncertain','failed')),created INTEGER NOT NULL,expires INTEGER,cache_key TEXT);
CREATE TRIGGER ocr_settle BEFORE INSERT ON ocr_settlements BEGIN
 SELECT RAISE(ABORT,'closed OCR hold') WHERE NOT EXISTS(SELECT 1 FROM ocr_attempts WHERE id=NEW.attempt AND state='held');
 SELECT RAISE(ABORT,'invalid OCR result') WHERE NEW.outcome='ready' AND (NEW.cache_key IS NULL OR NEW.expires<=NEW.created OR NOT EXISTS(SELECT 1 FROM ocr_attempts WHERE id=NEW.attempt AND dispatched IS NOT NULL AND deadline>=NEW.created));
 INSERT INTO ocr_usage(attempt,page) SELECT NEW.attempt,CAST(value AS INTEGER) FROM json_each('[0,1,2,3,4,5,6,7,8,9]') WHERE NEW.outcome='ready' AND value<(SELECT pages FROM ocr_attempts WHERE id=NEW.attempt);
 INSERT INTO ocr_changes(account,delta) SELECT account,pages FROM ocr_attempts WHERE id=NEW.attempt AND NEW.outcome<>'ready';
 UPDATE ocr_attempts SET state=NEW.outcome,updated=NEW.created,expires=NEW.expires,cache_key=NEW.cache_key,consumed=CASE WHEN NEW.outcome='ready' THEN pages ELSE 0 END,released=CASE WHEN NEW.outcome='ready' THEN 0 ELSE pages END WHERE id=NEW.attempt;
END;
CREATE TRIGGER ocr_payment_apply BEFORE INSERT ON ocr_payment_commands BEGIN
 SELECT RAISE(ABORT,'invalid OCR payment') WHERE NOT EXISTS(SELECT 1 FROM ocr_orders WHERE id=NEW.order_id AND transaction_id=NEW.transaction_id)
 OR NEW.state NOT IN ('draft','ready','billed','paid','completed','canceled','past_due')
 OR (NEW.state<>'completed' AND EXISTS(SELECT 1 FROM ocr_orders WHERE id=NEW.order_id AND status='credited'));
 INSERT INTO ocr_grants SELECT NEW.transaction_id,account,pages FROM ocr_orders WHERE id=NEW.order_id AND NEW.state='completed' AND NOT EXISTS(SELECT 1 FROM ocr_grants WHERE id=NEW.transaction_id);
 -- Draft sandbox policy: release in-flight holds on increased refund revocation.
 INSERT INTO ocr_settlements(attempt,outcome,created) SELECT id,'uncertain',NEW.checked FROM ocr_attempts WHERE account=(SELECT account FROM ocr_orders WHERE id=NEW.order_id) AND state='held' AND NEW.revoked>COALESCE((SELECT revoked FROM ocr_payment_sync WHERE order_id=NEW.order_id),0);
 INSERT INTO ocr_refund_events SELECT NEW.id,NEW.order_id,COALESCE((SELECT revoked FROM ocr_payment_sync WHERE order_id=NEW.order_id),0)-NEW.revoked,NEW.checked WHERE NEW.state='completed' AND COALESCE((SELECT revoked FROM ocr_payment_sync WHERE order_id=NEW.order_id),0)<>NEW.revoked;
 INSERT INTO ocr_changes(account,delta) SELECT account,COALESCE((SELECT revoked FROM ocr_payment_sync WHERE order_id=NEW.order_id),0)-NEW.revoked FROM ocr_orders WHERE id=NEW.order_id AND NEW.state='completed' AND COALESCE((SELECT revoked FROM ocr_payment_sync WHERE order_id=NEW.order_id),0)<>NEW.revoked;
 UPDATE ocr_orders SET status=CASE WHEN NEW.state='completed' THEN 'credited' WHEN NEW.state='canceled' THEN 'canceled' ELSE status END WHERE id=NEW.order_id;
 INSERT INTO ocr_payment_sync(order_id,checked,revoked,state) VALUES(NEW.order_id,NEW.checked,NEW.revoked,NEW.state) ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,revoked=excluded.revoked,state=excluded.state;
END;
CREATE TRIGGER ocr_payment_command_cleanup AFTER INSERT ON ocr_payment_commands BEGIN DELETE FROM ocr_payment_commands WHERE id=NEW.id; END;
CREATE TRIGGER ocr_refund_immutable_update BEFORE UPDATE ON ocr_refund_events BEGIN SELECT RAISE(ABORT,'immutable refund'); END;
CREATE TRIGGER ocr_refund_immutable_delete BEFORE DELETE ON ocr_refund_events BEGIN SELECT RAISE(ABORT,'immutable refund'); END;
CREATE TABLE ocr_webhook_events(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,received INTEGER NOT NULL,processed INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);

CREATE TRIGGER ocr_settlements_immutable_update BEFORE UPDATE ON ocr_settlements BEGIN SELECT RAISE(ABORT,'immutable settlement'); END;
CREATE TRIGGER ocr_settlements_immutable_delete BEFORE DELETE ON ocr_settlements BEGIN SELECT RAISE(ABORT,'immutable settlement'); END;
CREATE TRIGGER ocr_business_immutable_update BEFORE UPDATE ON ocr_business_reservations BEGIN SELECT RAISE(ABORT,'immutable business reservation'); END;
CREATE TRIGGER ocr_business_immutable_delete BEFORE DELETE ON ocr_business_reservations BEGIN SELECT RAISE(ABORT,'immutable business reservation'); END;
