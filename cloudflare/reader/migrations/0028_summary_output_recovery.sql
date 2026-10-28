-- Production only. No existing job, wallet or attempt is modified by this migration.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='production' AND version='unified-v1') THEN 'true' ELSE 'PRODUCTION_ONLY_SUMMARY_RECOVERY' END);
ALTER TABLE summary_documents ADD COLUMN budget_revision INTEGER NOT NULL DEFAULT 1 CHECK(budget_revision IN(1,2));
ALTER TABLE summary_document_chunks ADD COLUMN recovery_round INTEGER NOT NULL DEFAULT 0 CHECK(recovery_round IN(0,1));
ALTER TABLE summary_document_chunks ADD COLUMN failure_kind TEXT;
CREATE TABLE summary_document_budget_revisions(document TEXT PRIMARY KEY REFERENCES summary_documents(id),account TEXT NOT NULL,prior_units INTEGER NOT NULL,units INTEGER NOT NULL CHECK(units>=1000),created INTEGER NOT NULL);
CREATE TRIGGER summary_budget_revision_admit BEFORE INSERT ON summary_document_budget_revisions BEGIN
 SELECT RAISE(ABORT,'invalid Summary recovery quote') WHERE NOT EXISTS(SELECT 1 FROM summary_documents d WHERE d.id=NEW.document AND d.account=NEW.account AND d.budget_revision=1 AND d.units=NEW.prior_units AND d.state='blocked' AND d.reason='output_limit' AND d.expires>NEW.created AND NEW.units>=d.consumed AND EXISTS(SELECT 1 FROM summary_document_chunks c WHERE c.document=d.id AND c.part=d.next AND c.state='uncertain' AND c.result IS NULL AND c.work=0));
END;
CREATE TRIGGER summary_budget_revision_immutable BEFORE UPDATE ON summary_document_budget_revisions BEGIN SELECT RAISE(ABORT,'immutable Summary recovery quote');END;
CREATE TRIGGER summary_budget_revision_retain BEFORE DELETE ON summary_document_budget_revisions BEGIN SELECT RAISE(ABORT,'retain Summary recovery quote');END;
CREATE TRIGGER summary_budget_update BEFORE UPDATE ON summary_documents WHEN NEW.units<>OLD.units OR NEW.budget_revision<>OLD.budget_revision BEGIN
 SELECT RAISE(ABORT,'unapproved Summary budget change') WHERE NOT(OLD.budget_revision=1 AND NEW.budget_revision=2 AND OLD.state='blocked' AND NEW.state='blocked' AND NEW.reason='output_limit' AND EXISTS(SELECT 1 FROM summary_document_budget_revisions b WHERE b.document=OLD.id AND b.account=OLD.account AND b.prior_units=OLD.units AND b.units=NEW.units));
END;
DROP TRIGGER summary_document_identity;
CREATE TRIGGER summary_document_identity BEFORE UPDATE ON summary_documents WHEN NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.fingerprint<>OLD.fingerprint OR NEW.root<>OLD.root OR NEW.preset<>OLD.preset OR NEW.version<>OLD.version OR NEW.map_count<>OLD.map_count OR NEW.bytes<>OLD.bytes OR NEW.stages<>OLD.stages OR NEW.created<>OLD.created OR NEW.expires<>OLD.expires OR NEW.retry_of IS NOT OLD.retry_of OR NEW.next<OLD.next OR NEW.consumed<OLD.consumed OR NEW.mapped_bytes<OLD.mapped_bytes OR NEW.map_work<OLD.map_work OR NEW.full_work<OLD.full_work BEGIN SELECT RAISE(ABORT,'immutable Summary identity');END;
DROP TRIGGER summary_document_chunk_identity;
CREATE TRIGGER summary_document_chunk_identity BEFORE UPDATE ON summary_document_chunks WHEN NEW.document<>OLD.document OR NEW.part<>OLD.part OR NEW.kind<>OLD.kind OR NEW.hash<>OLD.hash OR NEW.bytes<>OLD.bytes OR (OLD.state='ready' AND NOT(NEW.state='ready' AND NEW.result IS NULL AND NEW.result_hash IS OLD.result_hash AND NEW.work=OLD.work AND NEW.started=OLD.started AND NEW.deadline=OLD.deadline AND NEW.attempt=OLD.attempt AND NEW.retry_safe=OLD.retry_safe AND NEW.dispatched IS OLD.dispatched AND EXISTS(SELECT 1 FROM summary_documents WHERE id=OLD.document AND state='expired'))) OR (OLD.state='uncertain' AND NEW.state<>'uncertain' AND NOT(NEW.state='failed' AND NEW.retry_safe=1 AND EXISTS(SELECT 1 FROM summary_document_budget_revisions b JOIN summary_documents d ON d.id=b.document WHERE b.document=OLD.document AND d.next=OLD.part AND d.budget_revision=2 AND d.state='blocked' AND d.reason='output_limit' AND OLD.result IS NULL AND OLD.work=0))) BEGIN SELECT RAISE(ABORT,'immutable Summary stage');END;
DROP TRIGGER summary_document_chunk_charge;
CREATE TRIGGER summary_document_chunk_charge AFTER UPDATE OF state ON summary_document_chunks WHEN OLD.state='running' AND NEW.state='ready' BEGIN
 UPDATE summary_documents SET consumed=CASE WHEN units=1000 THEN 1000 WHEN NEW.part=stages-1 THEN CASE WHEN units=1000 OR full_work+NEW.work>0 THEN MAX(1000,CAST(((full_work+NEW.work)*5+9999)/10000 AS INTEGER)) ELSE consumed END WHEN NEW.kind='map' THEN CASE WHEN units=1000 OR map_work+NEW.work>0 THEN MAX(1000,CAST(((map_work+NEW.work)*5+9999)/10000 AS INTEGER)) ELSE consumed END ELSE consumed END,mapped_bytes=mapped_bytes+NEW.bytes,map_work=map_work+CASE WHEN NEW.kind='map' THEN NEW.work ELSE 0 END,full_work=full_work+NEW.work,next=next+1,updated=NEW.started WHERE id=NEW.document;
 INSERT INTO summary_document_events SELECT 'summary-document-settle:'||NEW.document||':'||NEW.part,account,id,cycle,'settle',0,NEW.started,NULL FROM summary_documents WHERE id=NEW.document;
END;

CREATE TRIGGER summary_recovery_round BEFORE UPDATE ON summary_document_chunks WHEN NEW.recovery_round<>OLD.recovery_round BEGIN
 SELECT RAISE(ABORT,'invalid Summary output recovery') WHERE NOT(OLD.recovery_round=0 AND NEW.recovery_round=1 AND OLD.state='failed' AND OLD.failure_kind='output_limit' AND OLD.retry_safe=1 AND NEW.state='running');
END;
CREATE TRIGGER summary_recovery_archive BEFORE UPDATE ON summary_document_chunks WHEN OLD.state='uncertain' AND NEW.state='failed' BEGIN
 INSERT INTO summary_document_attempts VALUES(OLD.document,OLD.part,OLD.attempt,OLD.started,OLD.deadline,OLD.dispatched,OLD.state);
END;
DROP TRIGGER summary_document_retry_archive;
CREATE TRIGGER summary_document_retry_archive BEFORE UPDATE ON summary_document_chunks WHEN OLD.state='failed' AND NEW.state='running' BEGIN
 INSERT INTO summary_document_attempts SELECT OLD.document,OLD.part,OLD.attempt,OLD.started,OLD.deadline,OLD.dispatched,OLD.state WHERE NOT EXISTS(SELECT 1 FROM summary_document_attempts WHERE document=OLD.document AND part=OLD.part AND attempt=OLD.attempt);
END;
