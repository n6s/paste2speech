-- Public promotion of the reviewed staging experience; additive journals only.
-- Append-only recovery. Old source fingerprints, receipts and money remain intact.
-- source_hash is the original verified fingerprint for linked rows; document_hash
-- remains the immutable deduplication key. First-attempt rows keep their old hash.
ALTER TABLE ocr_jobs ADD COLUMN source_hash TEXT CHECK(source_hash IS NULL OR length(source_hash)=64);
ALTER TABLE ocr_jobs ADD COLUMN recovery_of TEXT REFERENCES ocr_jobs(id);
CREATE UNIQUE INDEX ocr_job_one_recovery ON ocr_jobs(recovery_of) WHERE recovery_of IS NOT NULL;
CREATE INDEX ocr_job_source_history ON ocr_jobs(account,COALESCE(source_hash,document_hash),model,created);
CREATE TABLE ocr_job_recovery_authorizations(
 prior TEXT PRIMARY KEY REFERENCES ocr_jobs(id),account TEXT NOT NULL REFERENCES accounts(id),document_hash TEXT NOT NULL CHECK(length(document_hash)=64),
 model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 1000),units INTEGER NOT NULL CHECK(units=pages*2000),
 proof_code TEXT NOT NULL CHECK(proof_code IN('native-fetch-receiver-v1','confirmed-no-provider-contact-v2')),verified INTEGER NOT NULL
);
CREATE TRIGGER ocr_job_recovery_check BEFORE INSERT ON ocr_job_recovery_authorizations BEGIN
 SELECT RAISE(ABORT,'unresolved or consumed attempt') WHERE NOT EXISTS(SELECT 1 FROM ocr_jobs WHERE id=NEW.prior AND account=NEW.account AND COALESCE(source_hash,document_hash)=NEW.document_hash AND model=NEW.model AND pages=NEW.pages AND units=NEW.units AND state IN('uncertain','failed','canceled','expired') AND consumed=0 AND released=pages);
END;
CREATE TRIGGER ocr_job_recovery_update BEFORE UPDATE ON ocr_job_recovery_authorizations BEGIN SELECT RAISE(ABORT,'immutable recovery proof'); END;
CREATE TRIGGER ocr_job_recovery_delete BEFORE DELETE ON ocr_job_recovery_authorizations BEGIN SELECT RAISE(ABORT,'retain recovery proof'); END;
DROP TRIGGER ocr_job_check;
CREATE TRIGGER ocr_job_check BEFORE INSERT ON ocr_jobs BEGIN
 SELECT RAISE(ABORT,'invalid OCR admission') WHERE NEW.state<>'held' OR NEW.dispatched IS NOT NULL OR NEW.consumed<>0 OR NEW.released<>0 OR NOT EXISTS(SELECT 1 FROM ocr_job_uploads u WHERE u.id=NEW.id AND u.account=NEW.account AND u.state='verified' AND u.expires>NEW.created AND u.document_hash=COALESCE(NEW.source_hash,NEW.document_hash) AND u.pages=NEW.pages AND u.model=NEW.model);
 SELECT RAISE(ABORT,'prior OCR attempt retained') WHERE EXISTS(SELECT 1 FROM ocr_attempts WHERE account=NEW.account AND document_hash=COALESCE(NEW.source_hash,NEW.document_hash) AND model=NEW.model);
 SELECT RAISE(ABORT,'invalid linked recovery') WHERE (NEW.recovery_of IS NULL AND NEW.source_hash IS NOT NULL) OR (NEW.recovery_of IS NOT NULL AND (NEW.provider_kind<>'standard' OR NEW.source_hash IS NULL OR NEW.document_hash=NEW.source_hash OR NOT EXISTS(SELECT 1 FROM ocr_job_recovery_authorizations a JOIN ocr_jobs p ON p.id=a.prior WHERE a.prior=NEW.recovery_of AND a.account=NEW.account AND a.document_hash=NEW.source_hash AND a.model=NEW.model AND a.pages=NEW.pages AND a.units=NEW.units AND p.state IN('uncertain','failed','canceled','expired') AND p.consumed=0 AND p.released=p.pages) OR EXISTS(SELECT 1 FROM ocr_jobs WHERE account=NEW.account AND COALESCE(source_hash,document_hash)=NEW.source_hash AND model=NEW.model AND (state='held' OR consumed>0))));
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
 SELECT RAISE(ABORT,'OCR business capacity') WHERE NEW.provider_kind<>'standard' AND NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND (cap_cents IS NULL OR reserved_cents+(NEW.pages*8+9)/10<=cap_cents));
 SELECT RAISE(ABORT,'OCR provider allowance') WHERE (NEW.provider_kind='standard' AND NEW.provider_permit<>'mistral-ocr-4-1') OR (NEW.provider_kind='legacy' AND NOT EXISTS(SELECT 1 FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=NEW.account AND p.id=NEW.provider_permit AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND p.max_pages>=NEW.pages AND (p.document_hash IS NULL OR p.document_hash=NEW.document_hash))) OR (NEW.provider_kind='job' AND NOT EXISTS(SELECT 1 FROM ocr_job_allowances p WHERE p.id=NEW.provider_permit AND p.account=NEW.account AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND p.max_pages>=NEW.pages));
END;
DROP TRIGGER ocr_job_identity;
CREATE TRIGGER ocr_job_identity BEFORE UPDATE ON ocr_jobs WHEN NEW.source_hash IS NOT OLD.source_hash OR NEW.recovery_of IS NOT OLD.recovery_of OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.document_hash<>OLD.document_hash OR NEW.model<>OLD.model OR NEW.pages<>OLD.pages OR NEW.units<>OLD.units OR NEW.provider_kind<>OLD.provider_kind OR NEW.provider_permit<>OLD.provider_permit OR NEW.created<>OLD.created OR NEW.deadline<>OLD.deadline OR OLD.dispatched IS NOT NULL AND NEW.dispatched IS NOT OLD.dispatched BEGIN SELECT RAISE(ABORT,'immutable OCR job identity'); END;
DROP TRIGGER ocr_job_no_duplicate_inline;
CREATE TRIGGER ocr_job_no_duplicate_inline BEFORE INSERT ON ocr_attempts BEGIN SELECT RAISE(ABORT,'prior durable OCR attempt retained') WHERE EXISTS(SELECT 1 FROM ocr_jobs WHERE account=NEW.account AND COALESCE(source_hash,document_hash)=NEW.document_hash AND model=NEW.model); END;
