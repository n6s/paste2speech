-- Keep financial application atomic while avoiding zero-value changes.
ALTER TABLE payment_sync ADD COLUMN next_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_sync ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER payment_apply;
CREATE TRIGGER payment_apply BEFORE INSERT ON payment_commands BEGIN
 SELECT RAISE(ABORT,'invalid_payment') WHERE NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND transaction_id=NEW.transaction_id AND NEW.revoked BETWEEN 0 AND characters)
 OR NEW.state NOT IN ('draft','ready','billed','paid','completed','canceled','past_due')
 OR (NEW.state<>'completed' AND EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='credited'));
 INSERT INTO grants(id,account,characters) SELECT NEW.transaction_id,account,characters FROM orders WHERE id=NEW.order_id AND NEW.state='completed' AND NOT EXISTS(SELECT 1 FROM grants WHERE id=NEW.transaction_id);
 INSERT INTO balance_changes(account,delta) SELECT account,COALESCE((SELECT revoked FROM payment_sync WHERE order_id=NEW.order_id),0)-NEW.revoked FROM orders WHERE id=NEW.order_id AND NEW.state='completed' AND COALESCE((SELECT revoked FROM payment_sync WHERE order_id=NEW.order_id),0)<>NEW.revoked;
 UPDATE orders SET status='credited' WHERE id=NEW.order_id AND NEW.state='completed' AND status<>'credited';
 UPDATE orders SET status='canceled' WHERE id=NEW.order_id AND NEW.state='canceled' AND status<>'canceled';
 INSERT INTO payment_sync(order_id,checked,revoked,state) VALUES(NEW.order_id,NEW.checked,NEW.revoked,NEW.state) ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,revoked=excluded.revoked,state=excluded.state;
END;

CREATE TABLE reader_maintenance (
 object_id TEXT PRIMARY KEY,
 action TEXT NOT NULL CHECK(action IN ('inspect','retire')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','attention')),
 next_attempt INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 result TEXT,
 updated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reader_maintenance_due ON reader_maintenance(state,next_attempt);
