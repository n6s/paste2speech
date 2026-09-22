-- Run against production LEDGER only, after owner verification and approval.
INSERT INTO trial_grants(id,email,characters,created)
SELECT 'production-owner-trial-v1','rogerpbrown@gmail.com',100000,unixepoch()*1000
WHERE NOT EXISTS(SELECT 1 FROM trial_grants WHERE id='production-owner-trial-v1');
SELECT t.id,t.characters,a.balance FROM trial_grants t JOIN identities i ON i.email=t.email JOIN accounts a ON a.id=i.account;
