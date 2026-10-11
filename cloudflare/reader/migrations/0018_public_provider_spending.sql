-- Approved October 11, 2026: remove artificial public provider spend ceilings.
-- Preserve every usage/reservation/credit record and record prior policy values.
CREATE TABLE provider_spending_policy_changes(id TEXT PRIMARY KEY,created INTEGER NOT NULL,prior_ocr_cap INTEGER,prior_speech_daily INTEGER,prior_speech_monthly INTEGER);
INSERT INTO provider_spending_policy_changes SELECT 'roger-approved-2026-10-11',CAST(strftime('%s','now') AS INTEGER)*1000,(SELECT cap_cents FROM ocr_business_budget WHERE id='sandbox-retail'),daily,monthly FROM public_controls WHERE id='public';
CREATE TRIGGER spending_policy_update BEFORE UPDATE ON provider_spending_policy_changes BEGIN SELECT RAISE(ABORT,'immutable spending policy history'); END;
CREATE TRIGGER spending_policy_delete BEFORE DELETE ON provider_spending_policy_changes BEGIN SELECT RAISE(ABORT,'immutable spending policy history'); END;
DROP TRIGGER ocr_attempt_check;
DROP TRIGGER ocr_attempt_hold;
DROP TRIGGER ocr_order_capacity;
DROP TRIGGER unified_order_capacity;
DROP TRIGGER unified_owner_test_grant;
DROP VIEW ocr_capacity;
DROP VIEW unified_capacity;
CREATE TABLE ocr_business_budget_unbounded(id TEXT PRIMARY KEY,cap_cents INTEGER CHECK(cap_cents IS NULL OR cap_cents>0),reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0));
INSERT INTO ocr_business_budget_unbounded SELECT id,NULL,reserved_cents FROM ocr_business_budget;
DROP TABLE ocr_business_budget;
ALTER TABLE ocr_business_budget_unbounded RENAME TO ocr_business_budget;
DROP TRIGGER provider_budget_guard;
CREATE TABLE public_controls_unbounded(id TEXT PRIMARY KEY CHECK(id='public'),daily INTEGER CHECK(daily IS NULL OR daily>0),monthly INTEGER CHECK(monthly IS NULL OR monthly>0));
INSERT INTO public_controls_unbounded SELECT id,NULL,NULL FROM public_controls;
DROP TABLE public_controls;
ALTER TABLE public_controls_unbounded RENAME TO public_controls;
CREATE TRIGGER provider_budget_guard BEFORE INSERT ON provider_attempts BEGIN
 SELECT RAISE(ABORT,'provider_budget_exhausted') WHERE
 COALESCE((SELECT characters FROM provider_periods WHERE period=NEW.day),0)+NEW.characters>(SELECT daily FROM public_controls WHERE id='public') OR
 COALESCE((SELECT characters FROM provider_periods WHERE period=NEW.month),0)+NEW.characters>(SELECT monthly FROM public_controls WHERE id='public');
END;
CREATE UNIQUE INDEX ocr_one_active_per_account ON ocr_attempts(account) WHERE state='held';
CREATE TRIGGER ocr_attempt_check BEFORE INSERT ON ocr_attempts BEGIN
 SELECT RAISE(ABORT,'insufficient OCR credit') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN ocr_accounts o ON o.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND o.debt=0 AND o.balance>=NEW.pages) AND NEW.wallet_version='legacy';
 SELECT RAISE(ABORT,'OCR business ceiling') WHERE NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND (cap_cents IS NULL OR reserved_cents+(NEW.pages*8+9)/10<=cap_cents));
 SELECT RAISE(ABORT,'OCR provider allowance exhausted') WHERE NEW.provider_permit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=NEW.account AND p.id=NEW.provider_permit AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND NEW.pages<=p.max_pages AND (p.document_hash IS NULL OR p.document_hash=NEW.document_hash));
END;

CREATE TRIGGER ocr_attempt_hold AFTER INSERT ON ocr_attempts BEGIN
 UPDATE ocr_accounts SET balance=balance-NEW.pages WHERE account=NEW.account AND NEW.wallet_version='legacy';
 UPDATE ocr_business_budget SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10 WHERE id='sandbox-retail';
 INSERT INTO ocr_business_reservations VALUES(NEW.id,(NEW.pages*8+9)/10);
 UPDATE ocr_provider_permits SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10,calls=calls+1 WHERE id=NEW.provider_permit;
 INSERT INTO ocr_provider_reservations SELECT NEW.id,NEW.provider_permit,(NEW.pages*8+9)/10 WHERE NEW.provider_permit IS NOT NULL;
END;
CREATE VIEW ocr_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(balance),0) FROM ocr_accounts)+(SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held')+(SELECT COALESCE(SUM(pages),0) FROM ocr_orders WHERE status='pending') AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';
CREATE TRIGGER ocr_order_capacity BEFORE INSERT ON ocr_orders BEGIN
 SELECT RAISE(ABORT,'OCR purchase capacity exhausted') WHERE NOT EXISTS(SELECT 1 FROM ocr_capacity WHERE (cap_cents IS NULL OR reserved_cents+committed_cents+NEW.pages<=cap_cents));
END;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents
 FROM ocr_business_budget b WHERE id='sandbox-retail';
CREATE TRIGGER unified_order_capacity BEFORE INSERT ON unified_orders BEGIN
 SELECT RAISE(ABORT,'shared purchase capacity exhausted') WHERE NOT EXISTS(SELECT 1 FROM unified_capacity WHERE (cap_cents IS NULL OR reserved_cents+committed_cents+NEW.units/2000<=cap_cents));
END;
CREATE TRIGGER unified_owner_test_grant BEFORE INSERT ON unified_events WHEN NEW.kind='owner-test-grant' BEGIN
 SELECT RAISE(ABORT,'unapproved owner testing grant') WHERE NEW.id<>'owner-testing-2026-10-11-100' OR NEW.reference<>'roger-approved-production-testing-2026-10-11' OR NEW.delta<>100000 OR NOT EXISTS(SELECT 1 FROM identities i JOIN accounts a ON a.id=i.account WHERE i.email='rogerpbrown@gmail.com' AND a.id=NEW.account AND a.enabled=1);
 SELECT RAISE(ABORT,'owner testing grant exceeds provider capacity') WHERE NOT EXISTS(SELECT 1 FROM unified_capacity WHERE (cap_cents IS NULL OR reserved_cents+committed_cents+50<=cap_cents));
END;
