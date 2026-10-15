-- Public promotion of the reviewed staging experience; additive journals only.
-- Additive consent receipt; old upload/financial identities stay intact.
CREATE TABLE ocr_job_consents(
 job TEXT PRIMARY KEY REFERENCES ocr_jobs(id),account TEXT NOT NULL REFERENCES accounts(id),
 policy TEXT NOT NULL CHECK(policy='mistral-temporary-original-2-credit-v2-bounded3'),accepted INTEGER NOT NULL
);
CREATE TRIGGER ocr_job_consent_check BEFORE INSERT ON ocr_job_consents BEGIN
 SELECT RAISE(ABORT,'invalid OCR consent receipt') WHERE NOT EXISTS(SELECT 1 FROM ocr_jobs j WHERE j.id=NEW.job AND j.account=NEW.account AND j.state='held' AND j.dispatched IS NULL AND j.created=NEW.accepted);
END;
CREATE TRIGGER ocr_job_consent_update BEFORE UPDATE ON ocr_job_consents BEGIN SELECT RAISE(ABORT,'immutable OCR consent receipt'); END;
CREATE TRIGGER ocr_job_consent_delete BEFORE DELETE ON ocr_job_consents BEGIN SELECT RAISE(ABORT,'retain OCR consent receipt'); END;
