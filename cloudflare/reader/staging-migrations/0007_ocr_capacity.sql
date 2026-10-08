-- Additive staging capacity safeguards. Preserve every old credit and reservation.
ALTER TABLE ocr_attempts ADD COLUMN provider_permit TEXT;
DROP TRIGGER ocr_business_immutable_update;
DROP TRIGGER ocr_business_immutable_delete;
ALTER TABLE ocr_business_reservations RENAME TO ocr_business_reservations_previous;
CREATE TABLE ocr_business_reservations(attempt TEXT PRIMARY KEY REFERENCES ocr_attempts(id),cents INTEGER NOT NULL CHECK(cents BETWEEN 1 AND 8));
INSERT INTO ocr_business_reservations SELECT * FROM ocr_business_reservations_previous;
DROP TABLE ocr_business_reservations_previous;
CREATE TRIGGER ocr_business_immutable_update BEFORE UPDATE ON ocr_business_reservations BEGIN SELECT RAISE(ABORT,'immutable business reservation'); END;
CREATE TRIGGER ocr_business_immutable_delete BEFORE DELETE ON ocr_business_reservations BEGIN SELECT RAISE(ABORT,'immutable business reservation'); END;
CREATE VIEW ocr_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(balance),0) FROM ocr_accounts)+(SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held')+(SELECT COALESCE(SUM(pages),0) FROM ocr_orders WHERE status='pending') AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';
CREATE TRIGGER ocr_order_capacity BEFORE INSERT ON ocr_orders BEGIN
 SELECT RAISE(ABORT,'OCR purchase capacity exhausted') WHERE NOT EXISTS(SELECT 1 FROM ocr_capacity WHERE reserved_cents+committed_cents+NEW.pages<=cap_cents);
END;
CREATE TABLE ocr_provider_permits(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,document_hash TEXT,max_pages INTEGER NOT NULL CHECK(max_pages BETWEEN 1 AND 10),cap_cents INTEGER NOT NULL CHECK(cap_cents BETWEEN 1 AND 100),reserved_cents INTEGER NOT NULL DEFAULT 0,max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 1 AND 100),calls INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents),CHECK(calls>=0 AND calls<=max_calls));
CREATE TABLE ocr_provider_reservations(attempt TEXT PRIMARY KEY REFERENCES ocr_attempts(id),permit TEXT NOT NULL REFERENCES ocr_provider_permits(id),cents INTEGER NOT NULL CHECK(cents BETWEEN 1 AND 8));
CREATE TRIGGER ocr_provider_reservation_update BEFORE UPDATE ON ocr_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable provider reservation'); END;
CREATE TRIGGER ocr_provider_reservation_delete BEFORE DELETE ON ocr_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable provider reservation'); END;
DROP TRIGGER ocr_attempt_check;
DROP TRIGGER ocr_attempt_hold;
CREATE TRIGGER ocr_attempt_check BEFORE INSERT ON ocr_attempts BEGIN
 SELECT RAISE(ABORT,'insufficient OCR credit') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN ocr_accounts o ON o.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND o.debt=0 AND o.balance>=NEW.pages);
 SELECT RAISE(ABORT,'OCR business ceiling') WHERE NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND reserved_cents+(NEW.pages*8+9)/10<=cap_cents);
 SELECT RAISE(ABORT,'OCR provider allowance exhausted') WHERE NEW.provider_permit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=NEW.account AND p.id=NEW.provider_permit AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND NEW.pages<=p.max_pages AND (p.document_hash IS NULL OR p.document_hash=NEW.document_hash));
END;
CREATE TRIGGER ocr_attempt_hold AFTER INSERT ON ocr_attempts BEGIN
 UPDATE ocr_accounts SET balance=balance-NEW.pages WHERE account=NEW.account;
 UPDATE ocr_business_budget SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10 WHERE id='sandbox-retail';
 INSERT INTO ocr_business_reservations VALUES(NEW.id,(NEW.pages*8+9)/10);
 UPDATE ocr_provider_permits SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10,calls=calls+1 WHERE id=NEW.provider_permit;
 INSERT INTO ocr_provider_reservations SELECT NEW.id,NEW.provider_permit,(NEW.pages*8+9)/10 WHERE NEW.provider_permit IS NOT NULL;
END;
