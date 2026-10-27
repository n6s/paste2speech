-- Additive staging-only document receipts. Existing paid attempts remain unchanged.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='staging' AND version='unified-v1') THEN 'true' ELSE 'STAGING_ONLY_TRANSLATION_DOCUMENTS' END);
CREATE TABLE translation_documents(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),fingerprint TEXT NOT NULL,target TEXT NOT NULL,manifest TEXT NOT NULL CHECK(length(manifest)<=900000),characters INTEGER NOT NULL CHECK(characters>0 AND characters<=2251799813685247),units INTEGER NOT NULL CHECK(units=characters*4),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','pausing','paused','ready','blocked','expired')),cycle INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0 AND consumed<=units),next INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL,
 retry_of TEXT REFERENCES translation_documents(id)
);
CREATE UNIQUE INDEX translation_document_source ON translation_documents(account,fingerprint) WHERE state<>'expired';
CREATE UNIQUE INDEX translation_document_active_account ON translation_documents(account) WHERE state IN('active','pausing');
CREATE TABLE translation_document_chunks(document TEXT NOT NULL REFERENCES translation_documents(id),part INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('running','ready','failed','uncertain')),characters INTEGER NOT NULL CHECK(characters BETWEEN 1 AND 5000),billable INTEGER NOT NULL CHECK(billable=0 OR billable=characters*4),hash TEXT NOT NULL,started INTEGER NOT NULL,deadline INTEGER NOT NULL,result TEXT CHECK(result IS NULL OR length(result)<=120000),PRIMARY KEY(document,part));
CREATE UNIQUE INDEX translation_document_single_running ON translation_document_chunks(document) WHERE state='running';
CREATE TABLE translation_document_events(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),document TEXT NOT NULL REFERENCES translation_documents(id),cycle INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN('hold','release','settle')),delta INTEGER NOT NULL,created INTEGER NOT NULL,net INTEGER);
CREATE TRIGGER translation_document_event_apply AFTER INSERT ON translation_document_events BEGIN
 UPDATE translation_document_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM translation_document_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM translation_document_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
CREATE TRIGGER translation_document_event_immutable BEFORE UPDATE ON translation_document_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.delta<>OLD.delta OR NEW.account<>OLD.account OR NEW.document<>OLD.document OR NEW.kind<>OLD.kind OR NEW.cycle<>OLD.cycle OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable document event');END;
CREATE TRIGGER translation_document_event_retain BEFORE DELETE ON translation_document_events BEGIN SELECT RAISE(ABORT,'retain document event');END;
CREATE TRIGGER translation_document_admit BEFORE INSERT ON translation_documents BEGIN
 SELECT RAISE(ABORT,'invalid document admission') WHERE NEW.state<>'active' OR NEW.cycle<>0 OR NEW.consumed<>0 OR NEW.next<>0 OR NEW.expires<>NEW.created+86400000;
 SELECT RAISE(ABORT,'invalid expired document retry') WHERE NEW.retry_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM translation_documents p WHERE p.id=NEW.retry_of AND p.account=NEW.account AND p.fingerprint=NEW.fingerprint AND p.state='expired');
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
END;
CREATE TRIGGER translation_document_hold AFTER INSERT ON translation_documents BEGIN
 INSERT INTO translation_document_events VALUES('document-hold:'||NEW.id||':0',NEW.account,NEW.id,0,'hold',-NEW.units,NEW.created,NULL);
END;
CREATE TRIGGER translation_document_resume BEFORE UPDATE OF state ON translation_documents WHEN OLD.state<>'active' AND NEW.state='active' BEGIN
 SELECT RAISE(ABORT,'document cannot resume') WHERE OLD.state<>'paused' OR NEW.cycle<>OLD.cycle+1 OR NEW.updated>=NEW.expires OR EXISTS(SELECT 1 FROM translation_document_chunks WHERE document=NEW.id AND state IN('running','uncertain'));
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units-NEW.consumed);
END;
CREATE TRIGGER translation_document_rehold AFTER UPDATE OF state ON translation_documents WHEN OLD.state='paused' AND NEW.state='active' BEGIN
 INSERT INTO translation_document_events VALUES('document-hold:'||NEW.id||':'||NEW.cycle,NEW.account,NEW.id,NEW.cycle,'hold',-(NEW.units-NEW.consumed),NEW.updated,NULL);
END;
CREATE TRIGGER translation_document_release AFTER UPDATE OF state ON translation_documents WHEN OLD.state IN('active','pausing') AND NEW.state IN('paused','blocked','ready','expired') BEGIN
 INSERT INTO translation_document_events VALUES('document-release:'||NEW.id||':'||NEW.cycle,NEW.account,NEW.id,NEW.cycle,'release',NEW.units-NEW.consumed,NEW.updated,NULL);
END;
CREATE TRIGGER translation_document_identity BEFORE UPDATE ON translation_documents WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.fingerprint<>OLD.fingerprint OR NEW.target<>OLD.target OR NEW.manifest<>OLD.manifest OR NEW.characters<>OLD.characters OR NEW.units<>OLD.units OR NEW.created<>OLD.created OR NEW.expires<>OLD.expires OR NEW.retry_of IS NOT OLD.retry_of OR NEW.next<OLD.next OR NEW.consumed<OLD.consumed BEGIN SELECT RAISE(ABORT,'immutable document identity');END;
CREATE TRIGGER translation_document_chunk_admit BEFORE INSERT ON translation_document_chunks BEGIN
 SELECT RAISE(ABORT,'invalid document chunk') WHERE NEW.state<>'running' OR NEW.result IS NOT NULL OR NOT EXISTS(SELECT 1 FROM translation_documents d JOIN accounts a ON a.id=d.account JOIN unified_wallets w ON w.account=d.account WHERE d.id=NEW.document AND d.state='active' AND a.enabled=1 AND w.debt=0 AND d.next=NEW.part AND d.expires>NEW.started AND json_extract(d.manifest,'$['||NEW.part||'].characters')=NEW.characters AND json_extract(d.manifest,'$['||NEW.part||'].hash')=NEW.hash);
END;
CREATE TRIGGER translation_document_chunk_identity BEFORE UPDATE ON translation_document_chunks WHEN NEW.document<>OLD.document OR NEW.part<>OLD.part OR NEW.hash<>OLD.hash OR NEW.characters<>OLD.characters OR NEW.billable<>OLD.billable OR (OLD.state='ready' AND NOT(NEW.state='ready' AND NEW.result IS NULL)) OR (OLD.state='uncertain' AND NEW.state<>'uncertain') BEGIN SELECT RAISE(ABORT,'immutable document chunk');END;
CREATE TRIGGER translation_document_chunk_settle BEFORE UPDATE OF state ON translation_document_chunks WHEN NEW.state='ready' AND OLD.state<>'ready' BEGIN
 SELECT RAISE(ABORT,'unusable document chunk') WHERE OLD.state<>'running' OR NEW.result IS NULL OR (NEW.billable>0 AND length(trim(NEW.result))=0) OR NOT EXISTS(SELECT 1 FROM translation_documents WHERE id=NEW.document AND state IN('active','pausing') AND next=NEW.part);
END;
CREATE TRIGGER translation_document_chunk_charge AFTER UPDATE OF state ON translation_document_chunks WHEN OLD.state='running' AND NEW.state='ready' BEGIN
 UPDATE translation_documents SET consumed=consumed+NEW.billable,next=next+1,updated=NEW.started WHERE id=NEW.document;
 INSERT INTO translation_document_events SELECT 'document-settle:'||NEW.document||':'||NEW.part,account,id,cycle,'settle',0,NEW.started,NULL FROM translation_documents WHERE id=NEW.document;
END;
CREATE TRIGGER translation_document_retain BEFORE DELETE ON translation_documents BEGIN SELECT RAISE(ABORT,'retain document receipt');END;
CREATE TRIGGER translation_document_chunk_retain BEFORE DELETE ON translation_document_chunks BEGIN SELECT RAISE(ABORT,'retain document chunk receipt');END;


DROP VIEW unified_capacity;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM summary_credit_attempts WHERE state IN('held','prepared'))+(SELECT COALESCE(SUM(units),0) FROM ocr_jobs WHERE state='held')+(SELECT COALESCE(SUM(units),0) FROM translation_attempts WHERE state='held')+(SELECT COALESCE(SUM(units-consumed),0) FROM translation_documents WHERE state IN('active','pausing'))+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';

CREATE TRIGGER translation_document_retry_admit BEFORE UPDATE OF state ON translation_document_chunks WHEN NEW.state='running' BEGIN
 SELECT RAISE(ABORT,'invalid document retry') WHERE OLD.state<>'failed' OR NOT EXISTS(SELECT 1 FROM translation_documents d JOIN accounts a ON a.id=d.account JOIN unified_wallets w ON w.account=d.account WHERE d.id=NEW.document AND d.state='active' AND d.next=NEW.part AND a.enabled=1 AND w.debt=0 AND d.expires>NEW.started);
END;
