-- STAGING ONLY: approved $5 owner newsletter experiment. Never reset to retry.
CREATE TABLE IF NOT EXISTS ocr_experiment_budget(
 id TEXT PRIMARY KEY, cap_cents INTEGER NOT NULL CHECK(cap_cents=500),
 prior_known_cents INTEGER NOT NULL CHECK(prior_known_cents>=2),
 prior_reserved_cents INTEGER NOT NULL CHECK(prior_reserved_cents>=100),
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents>=prior_reserved_cents AND reserved_cents<=cap_cents)
);
INSERT OR IGNORE INTO ocr_experiment_budget VALUES('spanish-fork-october-2026',500,2,100,100);
CREATE TABLE IF NOT EXISTS ocr_experiment_attempts(
 id TEXT PRIMARY KEY,experiment TEXT NOT NULL REFERENCES ocr_experiment_budget(id),
 document_hash TEXT NOT NULL,model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),
 reservation_cents INTEGER NOT NULL CHECK(reservation_cents=100),
 state TEXT NOT NULL CHECK(state IN ('reserved','ready','uncertain')),
 created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER,cache_key TEXT,
 UNIQUE(experiment,document_hash,model)
);
CREATE TRIGGER IF NOT EXISTS ocr_experiment_admission BEFORE INSERT ON ocr_experiment_attempts BEGIN
 SELECT RAISE(ABORT,'ocr_budget_exhausted') WHERE NOT EXISTS(
  SELECT 1 FROM ocr_experiment_budget WHERE id=NEW.experiment AND reserved_cents+NEW.reservation_cents<=cap_cents);
END;
CREATE TRIGGER IF NOT EXISTS ocr_experiment_reserve AFTER INSERT ON ocr_experiment_attempts BEGIN
 UPDATE ocr_experiment_budget SET reserved_cents=reserved_cents+NEW.reservation_cents WHERE id=NEW.experiment;
END;
