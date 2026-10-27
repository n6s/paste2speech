-- Additive staging-only document receipts. Existing paid attempts remain unchanged.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='staging' AND version='unified-v1') THEN 'true' ELSE 'STAGING_ONLY_SUMMARY_DOCUMENTS' END);
CREATE TABLE summary_documents(
 id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),fingerprint TEXT NOT NULL,root TEXT NOT NULL,preset TEXT NOT NULL,version TEXT NOT NULL,map_count INTEGER NOT NULL CHECK(map_count>0),bytes INTEGER NOT NULL CHECK(bytes>0),stages INTEGER NOT NULL CHECK(stages>=map_count),units INTEGER NOT NULL CHECK(units>=1000),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','pausing','paused','ready','blocked','expired')),cycle INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0 AND consumed<=units),next INTEGER NOT NULL DEFAULT 0,mapped_bytes INTEGER NOT NULL DEFAULT 0,map_work INTEGER NOT NULL DEFAULT 0,full_work INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL,reason TEXT,
 retry_of TEXT REFERENCES summary_documents(id)
);
CREATE UNIQUE INDEX summary_document_source ON summary_documents(account,fingerprint) WHERE state<>'expired';
CREATE UNIQUE INDEX summary_document_active_account ON summary_documents(account) WHERE state IN('active','pausing');
CREATE TABLE summary_document_chunks(document TEXT NOT NULL REFERENCES summary_documents(id),part INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('running','ready','failed','uncertain')),kind TEXT NOT NULL CHECK(kind IN('map','merge')),bytes INTEGER NOT NULL CHECK(bytes>=0),hash TEXT NOT NULL,started INTEGER NOT NULL,deadline INTEGER NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,retry_safe INTEGER NOT NULL DEFAULT 0,dispatched INTEGER,result TEXT,result_hash TEXT,work INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(document,part));
CREATE TABLE summary_document_attempts(document TEXT NOT NULL REFERENCES summary_documents(id),part INTEGER NOT NULL,attempt INTEGER NOT NULL,started INTEGER NOT NULL,deadline INTEGER NOT NULL,dispatched INTEGER,state TEXT NOT NULL,PRIMARY KEY(document,part,attempt));
CREATE TRIGGER summary_document_attempt_retain BEFORE DELETE ON summary_document_attempts BEGIN SELECT RAISE(ABORT,'retain Summary attempt');END;
CREATE TRIGGER summary_document_attempt_immutable BEFORE UPDATE ON summary_document_attempts BEGIN SELECT RAISE(ABORT,'immutable Summary attempt');END;
CREATE UNIQUE INDEX summary_document_single_running ON summary_document_chunks(document) WHERE state='running';
CREATE TABLE summary_document_events(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),document TEXT NOT NULL REFERENCES summary_documents(id),cycle INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN('hold','release','settle')),delta INTEGER NOT NULL,created INTEGER NOT NULL,net INTEGER);
CREATE TRIGGER summary_document_event_apply AFTER INSERT ON summary_document_events BEGIN
 UPDATE summary_document_events SET net=(SELECT balance-debt FROM unified_wallets WHERE account=NEW.account)+NEW.delta WHERE id=NEW.id;
 UPDATE unified_wallets SET balance=MAX(0,(SELECT net FROM summary_document_events WHERE id=NEW.id)),debt=MAX(0,-(SELECT net FROM summary_document_events WHERE id=NEW.id)) WHERE account=NEW.account;
END;
CREATE TRIGGER summary_document_event_immutable BEFORE UPDATE ON summary_document_events WHEN OLD.net IS NOT NULL OR NEW.id<>OLD.id OR NEW.delta<>OLD.delta OR NEW.account<>OLD.account OR NEW.document<>OLD.document OR NEW.kind<>OLD.kind OR NEW.cycle<>OLD.cycle OR NEW.created<>OLD.created BEGIN SELECT RAISE(ABORT,'immutable document event');END;
CREATE TRIGGER summary_document_event_retain BEFORE DELETE ON summary_document_events BEGIN SELECT RAISE(ABORT,'retain document event');END;
CREATE TRIGGER summary_document_admit BEFORE INSERT ON summary_documents BEGIN
 SELECT RAISE(ABORT,'invalid document admission') WHERE NEW.state<>'active' OR NEW.cycle<>0 OR NEW.consumed<>0 OR NEW.next<>0 OR NEW.expires<>NEW.created+86400000;
 SELECT RAISE(ABORT,'invalid expired document retry') WHERE NEW.retry_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM summary_documents p WHERE p.id=NEW.retry_of AND p.account=NEW.account AND p.fingerprint=NEW.fingerprint AND p.state='expired');
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units);
END;
CREATE TRIGGER summary_document_hold AFTER INSERT ON summary_documents BEGIN
 INSERT INTO summary_document_events VALUES('summary-document-hold:'||NEW.id||':0',NEW.account,NEW.id,0,'hold',-NEW.units,NEW.created,NULL);
END;
CREATE TRIGGER summary_document_resume BEFORE UPDATE OF state ON summary_documents WHEN OLD.state<>'active' AND NEW.state='active' BEGIN
 SELECT RAISE(ABORT,'document cannot resume') WHERE OLD.state<>'paused' OR NEW.cycle<>OLD.cycle+1 OR NEW.updated>=NEW.expires OR EXISTS(SELECT 1 FROM summary_document_chunks WHERE document=NEW.id AND state IN('running','uncertain'));
 SELECT RAISE(ABORT,'insufficient shared credits') WHERE NOT EXISTS(SELECT 1 FROM unified_wallets w JOIN accounts a ON a.id=w.account WHERE a.id=NEW.account AND a.enabled=1 AND w.debt=0 AND w.balance>=NEW.units-NEW.consumed);
END;
CREATE TRIGGER summary_document_rehold AFTER UPDATE OF state ON summary_documents WHEN OLD.state='paused' AND NEW.state='active' BEGIN
 INSERT INTO summary_document_events VALUES('summary-document-hold:'||NEW.id||':'||NEW.cycle,NEW.account,NEW.id,NEW.cycle,'hold',-(NEW.units-NEW.consumed),NEW.updated,NULL);
END;
CREATE TRIGGER summary_document_release AFTER UPDATE OF state ON summary_documents WHEN OLD.state IN('active','pausing') AND NEW.state IN('paused','blocked','ready','expired') BEGIN
 INSERT INTO summary_document_events VALUES('summary-document-release:'||NEW.id||':'||NEW.cycle,NEW.account,NEW.id,NEW.cycle,'release',NEW.units-NEW.consumed,NEW.updated,NULL);
END;
CREATE TRIGGER summary_document_identity BEFORE UPDATE ON summary_documents WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.fingerprint<>OLD.fingerprint OR NEW.root<>OLD.root OR NEW.preset<>OLD.preset OR NEW.version<>OLD.version OR NEW.map_count<>OLD.map_count OR NEW.bytes<>OLD.bytes OR NEW.stages<>OLD.stages OR NEW.units<>OLD.units OR NEW.created<>OLD.created OR NEW.expires<>OLD.expires OR NEW.retry_of IS NOT OLD.retry_of OR NEW.next<OLD.next OR NEW.consumed<OLD.consumed OR NEW.mapped_bytes<OLD.mapped_bytes OR NEW.map_work<OLD.map_work OR NEW.full_work<OLD.full_work BEGIN SELECT RAISE(ABORT,'immutable Summary identity');END;
CREATE TRIGGER summary_document_chunk_admit BEFORE INSERT ON summary_document_chunks BEGIN
 SELECT RAISE(ABORT,'invalid Summary stage') WHERE NEW.state<>'running' OR NEW.result IS NOT NULL OR NEW.dispatched IS NOT NULL OR NEW.work<>0 OR NOT EXISTS(SELECT 1 FROM summary_documents d JOIN accounts a ON a.id=d.account JOIN unified_wallets w ON w.account=d.account WHERE d.id=NEW.document AND d.state='active' AND a.enabled=1 AND w.debt=0 AND d.next=NEW.part AND NEW.part<d.stages AND d.expires>NEW.started AND ((NEW.part<d.map_count AND NEW.kind='map' AND NEW.bytes BETWEEN 1 AND 67712 AND d.mapped_bytes+NEW.bytes<=d.bytes AND (NEW.part<>d.map_count-1 OR d.mapped_bytes+NEW.bytes=d.bytes)) OR (NEW.part>=d.map_count AND NEW.kind='merge' AND NEW.bytes=0)));
END;
CREATE TRIGGER summary_document_chunk_identity BEFORE UPDATE ON summary_document_chunks WHEN NEW.document<>OLD.document OR NEW.part<>OLD.part OR NEW.kind<>OLD.kind OR NEW.hash<>OLD.hash OR NEW.bytes<>OLD.bytes OR (OLD.state='ready' AND NOT(NEW.state='ready' AND NEW.result IS NULL AND NEW.result_hash IS OLD.result_hash AND NEW.work=OLD.work AND NEW.started=OLD.started AND NEW.deadline=OLD.deadline AND NEW.attempt=OLD.attempt AND NEW.retry_safe=OLD.retry_safe AND NEW.dispatched IS OLD.dispatched AND EXISTS(SELECT 1 FROM summary_documents WHERE id=OLD.document AND state='expired'))) OR (OLD.state='uncertain' AND NEW.state<>'uncertain') BEGIN SELECT RAISE(ABORT,'immutable Summary stage');END;
CREATE TRIGGER summary_document_chunk_settle BEFORE UPDATE OF state ON summary_document_chunks WHEN NEW.state='ready' AND OLD.state<>'ready' BEGIN
 SELECT RAISE(ABORT,'unusable Summary stage') WHERE OLD.state<>'running' OR NEW.dispatched IS NULL OR NEW.result IS NULL OR length(trim(NEW.result))=0 OR NEW.work<0 OR NOT EXISTS(SELECT 1 FROM summary_documents d JOIN accounts a ON a.id=d.account WHERE d.id=NEW.document AND d.state IN('active','pausing') AND d.next=NEW.part AND d.updated<=d.expires AND a.enabled=1);
END;
CREATE TRIGGER summary_document_chunk_charge AFTER UPDATE OF state ON summary_document_chunks WHEN OLD.state='running' AND NEW.state='ready' BEGIN
 UPDATE summary_documents SET consumed=CASE WHEN NEW.part=stages-1 THEN CASE WHEN units=1000 OR full_work+NEW.work>0 THEN MAX(1000,CAST(((full_work+NEW.work)*5+9999)/10000 AS INTEGER)) ELSE consumed END WHEN NEW.kind='map' THEN CASE WHEN units=1000 OR map_work+NEW.work>0 THEN MAX(1000,CAST(((map_work+NEW.work)*5+9999)/10000 AS INTEGER)) ELSE consumed END ELSE consumed END,mapped_bytes=mapped_bytes+NEW.bytes,map_work=map_work+CASE WHEN NEW.kind='map' THEN NEW.work ELSE 0 END,full_work=full_work+NEW.work,next=next+1,updated=NEW.started WHERE id=NEW.document;
 INSERT INTO summary_document_events SELECT 'summary-document-settle:'||NEW.document||':'||NEW.part,account,id,cycle,'settle',0,NEW.started,NULL FROM summary_documents WHERE id=NEW.document;
END;
CREATE TRIGGER summary_document_retain BEFORE DELETE ON summary_documents BEGIN SELECT RAISE(ABORT,'retain document receipt');END;
CREATE TRIGGER summary_document_chunk_retain BEFORE DELETE ON summary_document_chunks BEGIN SELECT RAISE(ABORT,'retain document chunk receipt');END;


DROP VIEW unified_capacity;
CREATE VIEW unified_capacity AS SELECT b.cap_cents,b.reserved_cents,
 (SELECT COALESCE(SUM(pages),0) FROM ocr_attempts WHERE state='held' AND wallet_version='legacy')+
 ((SELECT COALESCE(SUM(balance),0) FROM unified_wallets)+(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE state='open' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(pages*2000),0) FROM ocr_attempts WHERE state='held' AND wallet_version='unified-v1')+(SELECT COALESCE(SUM(units),0) FROM summary_credit_attempts WHERE state IN('held','prepared'))+(SELECT COALESCE(SUM(units),0) FROM ocr_jobs WHERE state='held')+(SELECT COALESCE(SUM(units),0) FROM translation_attempts WHERE state='held')+(SELECT COALESCE(SUM(units-consumed),0) FROM translation_documents WHERE state IN('active','pausing'))+(SELECT COALESCE(SUM(units-consumed),0) FROM summary_documents WHERE state IN('active','pausing'))+(SELECT COALESCE(SUM(units),0) FROM unified_orders WHERE status='pending')+1999)/2000 AS committed_cents FROM ocr_business_budget b WHERE id='sandbox-retail';

CREATE TRIGGER summary_document_retry_admit BEFORE UPDATE OF state ON summary_document_chunks WHEN NEW.state='running' BEGIN
 SELECT RAISE(ABORT,'invalid document retry') WHERE OLD.state<>'failed' OR OLD.retry_safe<>1 OR NEW.attempt<>OLD.attempt+1 OR NEW.dispatched IS NOT NULL OR NOT EXISTS(SELECT 1 FROM summary_documents d JOIN accounts a ON a.id=d.account JOIN unified_wallets w ON w.account=d.account WHERE d.id=NEW.document AND d.state='active' AND d.next=NEW.part AND a.enabled=1 AND w.debt=0 AND d.expires>NEW.started);
END;

CREATE TRIGGER summary_document_dispatch_once BEFORE UPDATE OF dispatched ON summary_document_chunks WHEN OLD.dispatched IS NOT NULL AND NEW.dispatched IS NOT OLD.dispatched AND NOT(OLD.state='failed' AND OLD.retry_safe=1 AND NEW.state='running' AND NEW.attempt=OLD.attempt+1 AND NEW.dispatched IS NULL) BEGIN SELECT RAISE(ABORT,'immutable Summary dispatch');END;

CREATE TRIGGER summary_document_retry_archive BEFORE UPDATE ON summary_document_chunks WHEN OLD.state='failed' AND NEW.state='running' BEGIN INSERT INTO summary_document_attempts VALUES(OLD.document,OLD.part,OLD.attempt,OLD.started,OLD.deadline,OLD.dispatched,OLD.state);END;
CREATE INDEX summary_document_expiry ON summary_documents(state,expires);
CREATE INDEX summary_document_stage_expiry ON summary_document_chunks(state,deadline);
