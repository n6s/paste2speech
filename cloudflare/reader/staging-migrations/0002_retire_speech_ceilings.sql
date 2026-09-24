-- Staging only. Keep historical campaign/admission records and usage counters.
-- This first statement intentionally fails on a production database, which
-- has no mse_campaign table. Execute this file only with the staging config.
UPDATE mse_campaign SET active=0 WHERE id='mse-pixel-v1';
DROP TRIGGER IF EXISTS budget_check;
-- budget_debit continues counting lifetime admissions, without a cutoff.
-- Account balances and reservation/settlement checks remain unchanged.
