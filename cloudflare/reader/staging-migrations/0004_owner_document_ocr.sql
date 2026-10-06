-- STAGING ONLY. Shares the existing cumulative budget; never seeds or resets it.
CREATE TABLE IF NOT EXISTS owner_document_ocr(
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,experiment TEXT NOT NULL REFERENCES ocr_experiment_budget(id),
 document_hash TEXT NOT NULL,model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),
 mime TEXT NOT NULL,pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 10),name TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','ready','uncertain')),
 created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER,cache_key TEXT,
 UNIQUE(owner,document_hash,model)
);
CREATE TRIGGER IF NOT EXISTS owner_document_admission BEFORE INSERT ON owner_document_ocr BEGIN
 SELECT RAISE(ABORT,'ocr_budget_exhausted') WHERE NOT EXISTS(
 SELECT 1 FROM ocr_experiment_budget WHERE id=NEW.experiment AND cap_cents=500 AND reserved_cents+100<=cap_cents);
END;
CREATE TRIGGER IF NOT EXISTS owner_document_reserve AFTER INSERT ON owner_document_ocr BEGIN
 UPDATE ocr_experiment_budget SET reserved_cents=reserved_cents+100 WHERE id=NEW.experiment;
END;
