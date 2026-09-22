-- Local/private ledger only. Credit changes, including returned reservations,
-- pay down refund debt before becoming spendable again.
CREATE TABLE account_debt(account TEXT PRIMARY KEY REFERENCES accounts(id),characters INTEGER NOT NULL DEFAULT 0 CHECK(characters>=0));
CREATE TABLE balance_changes(id INTEGER PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL,net INTEGER);
CREATE TRIGGER balance_change AFTER INSERT ON balance_changes BEGIN
 UPDATE balance_changes SET net=(SELECT balance FROM accounts WHERE id=NEW.account)-COALESCE((SELECT characters FROM account_debt WHERE account=NEW.account),0)+NEW.delta WHERE id=NEW.id;
 UPDATE accounts SET balance=MAX(0,(SELECT net FROM balance_changes WHERE id=NEW.id)) WHERE id=NEW.account;
 INSERT INTO account_debt VALUES(NEW.account,MAX(0,-(SELECT net FROM balance_changes WHERE id=NEW.id))) ON CONFLICT(account) DO UPDATE SET characters=excluded.characters;
 DELETE FROM balance_changes WHERE id=NEW.id;
END;
DROP TRIGGER grant_credit;
CREATE TRIGGER grant_credit AFTER INSERT ON grants BEGIN
 INSERT INTO balance_changes(account,delta) VALUES(NEW.account,NEW.characters);
END;
DROP TRIGGER reservation_refund;
CREATE TRIGGER reservation_refund AFTER UPDATE OF state ON reservations WHEN OLD.state='open' AND NEW.state='closed' BEGIN
 INSERT INTO balance_changes(account,delta) VALUES(NEW.account,OLD.remaining);
END;
CREATE TABLE payment_sync(order_id TEXT PRIMARY KEY REFERENCES orders(id),checked INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL);
CREATE TABLE payment_commands(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,transaction_id TEXT NOT NULL,state TEXT NOT NULL,revoked INTEGER NOT NULL,checked INTEGER NOT NULL);
CREATE TRIGGER payment_apply BEFORE INSERT ON payment_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND transaction_id=NEW.transaction_id AND NEW.revoked BETWEEN 0 AND characters)
 OR NEW.state NOT IN ('draft','ready','billed','paid','completed','canceled','past_due')
 OR (NEW.state<>'completed' AND EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='credited')) THEN RAISE(ABORT,'invalid_payment') END;
 INSERT INTO grants(id,account,characters) SELECT NEW.transaction_id,account,characters FROM orders WHERE id=NEW.order_id AND NEW.state='completed' AND NOT EXISTS(SELECT 1 FROM grants WHERE id=NEW.transaction_id);
 INSERT INTO balance_changes(account,delta) SELECT account,COALESCE((SELECT revoked FROM payment_sync WHERE order_id=NEW.order_id),0)-NEW.revoked FROM orders WHERE id=NEW.order_id AND NEW.state='completed';
 UPDATE orders SET status='credited' WHERE id=NEW.order_id AND NEW.state='completed';
 UPDATE orders SET status='canceled' WHERE id=NEW.order_id AND NEW.state='canceled';
 INSERT INTO payment_sync VALUES(NEW.order_id,NEW.checked,NEW.revoked,NEW.state) ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,revoked=excluded.revoked,state=excluded.state;
END;
CREATE TRIGGER payment_command_cleanup AFTER INSERT ON payment_commands BEGIN
 DELETE FROM payment_commands WHERE id=NEW.id;
END;
CREATE UNIQUE INDEX one_pending_order ON orders(account) WHERE status='pending';
