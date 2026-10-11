-- Explicitly authorized October 11, 2026: one 100-credit owner testing balance.
-- Run only after migration 0017 and fresh owner/capacity verification.
-- Immutable unique event; rerunning does not replenish used testing credits.
INSERT INTO unified_events(id,account,kind,reference,delta,created)
 SELECT 'owner-testing-2026-10-11-100',i.account,'owner-test-grant','roger-approved-production-testing-2026-10-11',100000,CAST(strftime('%s','now') AS INTEGER)*1000
 FROM identities i JOIN accounts a ON a.id=i.account
 WHERE i.email='rogerpbrown@gmail.com' AND a.enabled=1
 AND NOT EXISTS(SELECT 1 FROM unified_events WHERE id='owner-testing-2026-10-11-100');
