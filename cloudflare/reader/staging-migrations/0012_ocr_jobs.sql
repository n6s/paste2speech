-- Staging-only additive durable OCR journals. Never replay or rewrite old money.
-- Experimental allowance records stay empty. Standard customer-funded jobs use
-- the verified wallet and technical bounds; their estimate is not a spending cap.
CREATE TABLE ocr_job_uploads(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),
 mime TEXT NOT NULL CHECK(mime IN('application/pdf','image/png','image/jpeg','image/webp')),bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 50000000),name TEXT NOT NULL,
 started INTEGER NOT NULL,expires INTEGER NOT NULL CHECK(expires=started+3600000),policy TEXT NOT NULL CHECK(policy='mistral-temporary-original-2-credit-v1'),
 state TEXT NOT NULL DEFAULT 'awaiting-upload' CHECK(state IN('awaiting-upload','verified','accepted','closed','canceled','failed','expired')),document_hash TEXT,pages INTEGER,
 CHECK(document_hash IS NULL OR length(document_hash)=64),CHECK(pages IS NULL OR pages BETWEEN 1 AND 1000),CHECK(mime='application/pdf' OR pages IS NULL OR pages=1)
);
CREATE INDEX ocr_job_upload_expiry ON ocr_job_uploads(account,state,expires);
CREATE TABLE ocr_job_allowances(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),max_pages INTEGER NOT NULL CHECK(max_pages BETWEEN 1 AND 1000),cap_cents INTEGER NOT NULL CHECK(cap_cents BETWEEN 1 AND 1000),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=cap_cents),max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 1 AND 1000),calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0 AND calls<=max_calls),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),approval_reference TEXT NOT NULL CHECK(length(approval_reference)>0)
);
CREATE TABLE ocr_jobs(
 id TEXT PRIMARY KEY REFERENCES ocr_job_uploads(id),account TEXT NOT NULL REFERENCES accounts(id),document_hash TEXT NOT NULL CHECK(length(document_hash)=64),model TEXT NOT NULL CHECK(model='mistral-ocr-4-1'),
 pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 1000),units INTEGER NOT NULL CHECK(units=pages*2000),provider_kind TEXT NOT NULL CHECK(provider_kind IN('legacy','job','standard')),provider_permit TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'held' CHECK(state IN('held','ready','canceled','failed','uncertain','expired')),created INTEGER NOT NULL,updated INTEGER NOT NULL,deadline INTEGER NOT NULL CHECK(deadline=created+720000),dispatched INTEGER,
 result_pages INTEGER,cache_key TEXT,expires INTEGER,source_deleted INTEGER NOT NULL DEFAULT 0 CHECK(source_deleted IN(0,1)),consumed INTEGER NOT NULL DEFAULT 0,released INTEGER NOT NULL DEFAULT 0,
 CHECK(consumed IN(0,pages)),CHECK(released IN(0,pages)),UNIQUE(account,document_hash,model)
);
CREATE INDEX ocr_jobs_expiry ON ocr_jobs(state,deadline);
CREATE TABLE ocr_job_events(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),job TEXT NOT NULL REFERENCES ocr_jobs(id),kind TEXT NOT NULL CHECK(kind IN('hold','settle','release')),delta INTEGER NOT NULL CHECK(typeof(delta)='integer'),created INTEGER NOT NULL,net INTEGER,UNIQUE(job,kind));
CREATE TABLE ocr_job_provider_reservations(job TEXT PRIMARY KEY REFERENCES ocr_jobs(id),kind TEXT NOT NULL,permit TEXT NOT NULL,cents INTEGER NOT NULL CHECK(cents BETWEEN 1 AND 800),created INTEGER NOT NULL);
CREATE TRIGGER ocr_job_upload_check BEFORE INSERT ON ocr_job_uploads BEGIN
 SELECT RAISE(ABORT,'account unavailable') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1);
 SELECT RAISE(ABORT,'another OCR job active') WHERE EXISTS(SELECT 1 FROM ocr_job_uploads WHERE account=NEW.account AND state IN('awaiting-upload','verified') AND expires>NEW.started) OR EXISTS(SELECT 1 FROM ocr_jobs WHERE account=NEW.account AND state='held') OR EXISTS(SELECT 1 FROM ocr_attempts WHERE account=NEW.account AND state='held');
END;
CREATE TRIGGER ocr_job_upload_identity BEFORE UPDATE ON ocr_job_uploads WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.model<>OLD.model OR NEW.mime<>OLD.mime OR NEW.bytes<>OLD.bytes OR NEW.name<>OLD.name OR NEW.started<>OLD.started OR NEW.expires<>OLD.expires OR NEW.policy<>OLD.policy OR OLD.document_hash IS NOT NULL AND (NEW.document_hash IS NOT OLD.document_hash OR NEW.pages IS NOT OLD.pages) BEGIN SELECT RAISE(ABORT,'immutable OCR upload identity'); END;
CREATE TRIGGER ocr_job_check BEFORE INSERT ON ocr_jobs BEGIN
 SELECT RAISE(ABORT,'invalid OCR admission') WHERE NEW.state<>'held' OR NEW.dispatched IS NOT NULL OR NEW.consumed<>0 OR NEW.released<>0 OR NOT EXISTS(SELECT 1 FROM ocr_job_uploads u WHERE u.id=NEW.id AND u.account=NEW.account AND u.state='verified' AND u.expires>NEW.created AND u.document_hash=NEW.document_hash AND u.pages=NEW.pages AND u.model=NEW.model);
 SELECT RAISE(ABORT,'prior OCR attempt retained') WHERE EXISTS(SELECT 1 FROM ocr_attempts WHERE account=NEW.account AND document_hash=NEW.document_hash AND model=NEW.model);
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
 SELECT RAISE(ABORT,'OCR business capacity') WHERE NEW.provider_kind<>'standard' AND NOT EXISTS(SELECT 1 FROM ocr_business_budget WHERE id='sandbox-retail' AND (cap_cents IS NULL OR reserved_cents+(NEW.pages*8+9)/10<=cap_cents));
 SELECT RAISE(ABORT,'OCR provider allowance') WHERE (NEW.provider_kind='standard' AND NEW.provider_permit<>'mistral-ocr-4-1') OR (NEW.provider_kind='legacy' AND NOT EXISTS(SELECT 1 FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=NEW.account AND p.id=NEW.provider_permit AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND p.max_pages>=NEW.pages AND (p.document_hash IS NULL OR p.document_hash=NEW.document_hash))) OR (NEW.provider_kind='job' AND NOT EXISTS(SELECT 1 FROM ocr_job_allowances p WHERE p.id=NEW.provider_permit AND p.account=NEW.account AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+(NEW.pages*8+9)/10<=p.cap_cents AND p.max_pages>=NEW.pages));
END;
CREATE TRIGGER ocr_job_event_apply AFTER INSERT ON ocr_job_events BEGIN
 UPDATE ocr_job_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM ocr_job_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM ocr_job_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
CREATE TRIGGER ocr_job_event_update BEFORE UPDATE ON ocr_job_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.job<>OLD.job OR NEW.kind<>OLD.kind OR NEW.delta<>OLD.delta OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable OCR job event'); END;
CREATE TRIGGER ocr_job_event_delete BEFORE DELETE ON ocr_job_events BEGIN SELECT RAISE(ABORT,'immutable OCR job event'); END;
CREATE TRIGGER ocr_job_hold AFTER INSERT ON ocr_jobs BEGIN
 INSERT INTO ocr_job_events(id,account,job,kind,delta,created) VALUES('ocr-job-hold:'||NEW.id,NEW.account,NEW.id,'hold',-NEW.units,NEW.created);
 UPDATE ocr_business_budget SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10 WHERE id='sandbox-retail' AND NEW.provider_kind<>'standard';
 UPDATE ocr_provider_permits SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10,calls=calls+1 WHERE id=NEW.provider_permit AND NEW.provider_kind='legacy';
 UPDATE ocr_job_allowances SET reserved_cents=reserved_cents+(NEW.pages*8+9)/10,calls=calls+1 WHERE id=NEW.provider_permit AND NEW.provider_kind='job';
 INSERT INTO ocr_job_provider_reservations VALUES(NEW.id,NEW.provider_kind,NEW.provider_permit,(NEW.pages*8+9)/10,NEW.created);
 UPDATE ocr_job_uploads SET state='accepted' WHERE id=NEW.id;
END;
CREATE TRIGGER ocr_job_identity BEFORE UPDATE ON ocr_jobs WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.document_hash<>OLD.document_hash OR NEW.model<>OLD.model OR NEW.pages<>OLD.pages OR NEW.units<>OLD.units OR NEW.provider_kind<>OLD.provider_kind OR NEW.provider_permit<>OLD.provider_permit OR NEW.created<>OLD.created OR NEW.deadline<>OLD.deadline OR OLD.dispatched IS NOT NULL AND NEW.dispatched IS NOT OLD.dispatched BEGIN SELECT RAISE(ABORT,'immutable OCR job identity'); END;
CREATE TRIGGER ocr_job_transition BEFORE UPDATE OF state ON ocr_jobs WHEN NEW.state<>OLD.state BEGIN
 SELECT RAISE(ABORT,'closed OCR job') WHERE OLD.state<>'held' OR NEW.state='held';
 SELECT RAISE(ABORT,'invalid OCR job completion') WHERE NEW.state='ready' AND (NEW.dispatched IS NULL OR NEW.updated>NEW.deadline OR NEW.result_pages IS NOT NEW.pages OR NEW.source_deleted<>1 OR NEW.cache_key IS NULL OR NEW.expires<=NEW.updated OR EXISTS(SELECT 1 FROM unified_wallets WHERE account=NEW.account AND debt>0) OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND enabled=1));
END;
CREATE TRIGGER ocr_job_finish AFTER UPDATE OF state ON ocr_jobs WHEN OLD.state='held' AND NEW.state<>'held' BEGIN
 INSERT INTO ocr_job_events(id,account,job,kind,delta,created) VALUES('ocr-job-'|| CASE WHEN NEW.state='ready' THEN 'settle' ELSE 'release' END ||':'||NEW.id,NEW.account,NEW.id, CASE WHEN NEW.state='ready' THEN 'settle' ELSE 'release' END , CASE WHEN NEW.state='ready' THEN 0 ELSE NEW.units END ,NEW.updated);
 UPDATE ocr_jobs SET consumed= CASE WHEN NEW.state='ready' THEN pages ELSE 0 END ,released= CASE WHEN NEW.state='ready' THEN 0 ELSE pages END WHERE id=NEW.id;
 UPDATE ocr_job_uploads SET state='closed' WHERE id=NEW.id;
END;
CREATE TRIGGER ocr_job_keep_history BEFORE DELETE ON ocr_jobs BEGIN SELECT RAISE(ABORT,'retain OCR job receipt'); END;
CREATE TRIGGER ocr_job_provider_update BEFORE UPDATE ON ocr_job_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable OCR provider reservation'); END;
CREATE TRIGGER ocr_job_provider_delete BEFORE DELETE ON ocr_job_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable OCR provider reservation'); END;
CREATE TRIGGER ocr_job_no_duplicate_inline BEFORE INSERT ON ocr_attempts BEGIN SELECT RAISE(ABORT,'prior durable OCR attempt retained') WHERE EXISTS(SELECT 1 FROM ocr_jobs WHERE account=NEW.account AND document_hash=NEW.document_hash AND model=NEW.model); END;
DROP VIEW unified_capacity;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM summary_credit_attempts WHERE state IN('held','prepared'))+(SELECT COALESCE(SUM(units),0) FROM ocr_jobs WHERE state='held')+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';
