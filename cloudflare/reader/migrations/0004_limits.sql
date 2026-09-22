ALTER TABLE reservations ADD COLUMN metered INTEGER NOT NULL DEFAULT 1;
DROP TRIGGER reservation_check;
CREATE TRIGGER reservation_check BEFORE INSERT ON reservations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND (NEW.metered=0 OR (enabled=1 AND balance>=NEW.total))) OR EXISTS(SELECT 1 FROM account_debt WHERE account=NEW.account AND characters>0) THEN RAISE(ABORT,'insufficient credit') END;
END;
DROP TRIGGER reservation_debit;
CREATE TRIGGER reservation_debit AFTER INSERT ON reservations WHEN NEW.metered=1 BEGIN
 UPDATE accounts SET balance=balance-NEW.total WHERE id=NEW.account;
END;
DROP TRIGGER reservation_refund;
CREATE TRIGGER reservation_refund AFTER UPDATE OF state ON reservations WHEN OLD.state='open' AND NEW.state='closed' AND NEW.metered=1 BEGIN
 INSERT INTO balance_changes(account,delta) VALUES(NEW.account,OLD.remaining);
END;
CREATE TABLE speech_budget(id TEXT PRIMARY KEY,characters INTEGER NOT NULL,maximum INTEGER NOT NULL CHECK(maximum BETWEEN 1 AND 100000));
CREATE TABLE speech_admissions(job TEXT PRIMARY KEY,characters INTEGER NOT NULL CHECK(characters>0),fingerprint TEXT NOT NULL);
CREATE TRIGGER budget_check BEFORE INSERT ON speech_admissions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM speech_budget WHERE id='private-lifetime' AND characters+NEW.characters<=maximum) THEN RAISE(ABORT,'speech_budget_exhausted') END;
END;
CREATE TRIGGER budget_debit AFTER INSERT ON speech_admissions BEGIN
 UPDATE speech_budget SET characters=characters+NEW.characters WHERE id='private-lifetime';
END;
ALTER TABLE orders ADD COLUMN creation_state TEXT NOT NULL DEFAULT 'new';
