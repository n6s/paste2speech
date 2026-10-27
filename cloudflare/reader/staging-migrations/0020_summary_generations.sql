-- Staging only. Preserve all existing results, attempts, credits and expiries.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='staging' AND version='unified-v1') THEN 'true' ELSE 'STAGING_ONLY_SUMMARY_GENERATIONS' END);
ALTER TABLE summary_documents ADD COLUMN generation TEXT NOT NULL DEFAULT 'original';
ALTER TABLE summary_documents ADD COLUMN replacement_of TEXT REFERENCES summary_documents(id);
DROP INDEX summary_document_source;
CREATE UNIQUE INDEX summary_document_source ON summary_documents(account,fingerprint,generation) WHERE state<>'expired';
CREATE TRIGGER summary_generation_admit BEFORE INSERT ON summary_documents BEGIN
 SELECT RAISE(ABORT,'invalid Summary generation') WHERE NEW.generation<>'original' AND NEW.generation<>NEW.id;
 SELECT RAISE(ABORT,'invalid Summary replacement') WHERE NEW.replacement_of IS NOT NULL AND (NEW.generation='original' OR NOT EXISTS(SELECT 1 FROM summary_documents p WHERE p.id=NEW.replacement_of AND p.account=NEW.account AND p.fingerprint=NEW.fingerprint));
END;
DROP TRIGGER summary_document_identity;
CREATE TRIGGER summary_document_identity BEFORE UPDATE ON summary_documents WHEN NEW.generation<>OLD.generation OR NEW.replacement_of IS NOT OLD.replacement_of OR NEW.id<>OLD.id OR NEW.account<>OLD.account OR NEW.fingerprint<>OLD.fingerprint OR NEW.root<>OLD.root OR NEW.preset<>OLD.preset OR NEW.version<>OLD.version OR NEW.map_count<>OLD.map_count OR NEW.bytes<>OLD.bytes OR NEW.stages<>OLD.stages OR NEW.created<>OLD.created OR NEW.expires<>OLD.expires OR NEW.retry_of IS NOT OLD.retry_of OR NEW.next<OLD.next OR NEW.consumed<OLD.consumed OR NEW.mapped_bytes<OLD.mapped_bytes OR NEW.map_work<OLD.map_work OR NEW.full_work<OLD.full_work BEGIN SELECT RAISE(ABORT,'immutable Summary identity');END;
