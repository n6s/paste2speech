-- STAGING ONLY. Approved cumulative $10 policy. The original $5 ledger and
-- every historical/uncertain reservation remain untouched, including successes.
-- A snapshot carries all prior reservations forward, never refunds or resets.
ALTER TABLE owner_document_ocr ADD COLUMN reservation_cents INTEGER NOT NULL DEFAULT 100 CHECK(reservation_cents BETWEEN 1 AND 100);
CREATE TABLE ocr_owner_budget(
 id TEXT PRIMARY KEY REFERENCES ocr_experiment_budget(id),
 cap_cents INTEGER NOT NULL CHECK(cap_cents=1000),
 baseline_reserved_cents INTEGER NOT NULL CHECK(baseline_reserved_cents>=100),
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents>=baseline_reserved_cents AND reserved_cents<=cap_cents),
 policy TEXT NOT NULL CHECK(policy='page-margin-v1'), created INTEGER NOT NULL
);
INSERT INTO ocr_owner_budget SELECT id,1000,reserved_cents,reserved_cents,'page-margin-v1',CAST(strftime('%s','now') AS INTEGER)*1000 FROM ocr_experiment_budget WHERE id='spanish-fork-october-2026';
CREATE TABLE ocr_owner_reservations(
 attempt_id TEXT PRIMARY KEY REFERENCES owner_document_ocr(id),experiment TEXT NOT NULL REFERENCES ocr_owner_budget(id),
 pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 10),reservation_cents INTEGER NOT NULL CHECK(reservation_cents BETWEEN 1 AND 8),
 price_microdollars_per_page INTEGER NOT NULL CHECK(price_microdollars_per_page=4000),
 margin_multiplier INTEGER NOT NULL CHECK(margin_multiplier=2),policy TEXT NOT NULL CHECK(policy='page-margin-v1'),created INTEGER NOT NULL
);
DROP TRIGGER owner_document_admission;
DROP TRIGGER owner_document_reserve;
CREATE TRIGGER owner_document_admission BEFORE INSERT ON owner_document_ocr BEGIN
 -- 4000 microdollars/page = 0.4 cents/page; double, round up, minimum 1 cent.
 SELECT RAISE(ABORT,'ocr_reservation_invalid') WHERE NEW.reservation_cents!=MAX(1,CAST((NEW.pages*8+9)/10 AS INTEGER));
 SELECT RAISE(ABORT,'ocr_budget_exhausted') WHERE NOT EXISTS(
 SELECT 1 FROM ocr_owner_budget WHERE id=NEW.experiment AND cap_cents=1000 AND policy='page-margin-v1' AND reserved_cents+NEW.reservation_cents<=cap_cents);
END;
CREATE TRIGGER owner_document_reserve AFTER INSERT ON owner_document_ocr BEGIN
 UPDATE ocr_owner_budget SET reserved_cents=reserved_cents+NEW.reservation_cents WHERE id=NEW.experiment;
 INSERT INTO ocr_owner_reservations VALUES(NEW.id,NEW.experiment,NEW.pages,NEW.reservation_cents,4000,2,'page-margin-v1',NEW.created);
END;
