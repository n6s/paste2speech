-- STAGING ONLY. Preserve original receipts and reservations; add linked attempts.
CREATE TABLE IF NOT EXISTS ocr_experiment_dispatch(
 attempt_id TEXT PRIMARY KEY,started INTEGER NOT NULL,deadline INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ocr_experiment_retries(
 id TEXT PRIMARY KEY,parent_id TEXT NOT NULL UNIQUE,
 experiment TEXT NOT NULL REFERENCES ocr_experiment_budget(id),document_hash TEXT NOT NULL,
 model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),reservation_cents INTEGER NOT NULL CHECK(reservation_cents=100),
 state TEXT NOT NULL CHECK(state IN ('reserved','ready','uncertain')),
 created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER,cache_key TEXT
);
CREATE TRIGGER IF NOT EXISTS ocr_retry_admission BEFORE INSERT ON ocr_experiment_retries BEGIN
 SELECT RAISE(ABORT,'ocr_budget_exhausted') WHERE NOT EXISTS(
  SELECT 1 FROM ocr_experiment_budget WHERE id=NEW.experiment AND reserved_cents+NEW.reservation_cents<=cap_cents);
 SELECT RAISE(ABORT,'ocr_parent_not_retryable') WHERE NOT EXISTS(
  SELECT 1 FROM (SELECT id,experiment,document_hash,model,state,created,expires FROM ocr_experiment_attempts
   UNION ALL SELECT id,experiment,document_hash,model,state,created,expires FROM ocr_experiment_retries) p
  LEFT JOIN ocr_experiment_dispatch d ON d.attempt_id=p.id
  WHERE p.id=NEW.parent_id AND p.experiment=NEW.experiment AND p.document_hash=NEW.document_hash AND p.model=NEW.model
   AND p.created<=NEW.created-300000 AND COALESCE(d.deadline,0)<=NEW.created
   AND (p.state IN ('reserved','uncertain') OR p.state='ready' AND p.expires<=NEW.created));
END;
CREATE TRIGGER IF NOT EXISTS ocr_retry_reserve AFTER INSERT ON ocr_experiment_retries BEGIN
 UPDATE ocr_experiment_budget SET reserved_cents=reserved_cents+NEW.reservation_cents WHERE id=NEW.experiment;
END;
