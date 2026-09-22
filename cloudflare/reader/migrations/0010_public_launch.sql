-- Additive public launch state. Existing accounts, grants and trial budgets survive.
ALTER TABLE orders ADD COLUMN environment TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE orders ADD COLUMN price_id TEXT;
ALTER TABLE orders ADD COLUMN product_id TEXT;
ALTER TABLE orders ADD COLUMN amount TEXT NOT NULL DEFAULT '1000';
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
CREATE TABLE public_controls(id TEXT PRIMARY KEY CHECK(id='public'),daily INTEGER NOT NULL CHECK(daily BETWEEN 1 AND 2500000),monthly INTEGER NOT NULL CHECK(monthly BETWEEN 1 AND 12500000));
INSERT INTO public_controls VALUES('public',2500000,12500000);
CREATE TABLE provider_periods(period TEXT PRIMARY KEY,characters INTEGER NOT NULL DEFAULT 0 CHECK(characters>=0));
CREATE TABLE provider_attempts(job TEXT NOT NULL,section INTEGER NOT NULL,characters INTEGER NOT NULL CHECK(characters>0),day TEXT NOT NULL,month TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(job,section));
CREATE TRIGGER provider_budget_guard BEFORE INSERT ON provider_attempts BEGIN
 SELECT RAISE(ABORT,'provider_budget_exhausted') WHERE
 COALESCE((SELECT characters FROM provider_periods WHERE period=NEW.day),0)+NEW.characters>(SELECT daily FROM public_controls WHERE id='public') OR
 COALESCE((SELECT characters FROM provider_periods WHERE period=NEW.month),0)+NEW.characters>(SELECT monthly FROM public_controls WHERE id='public');
END;
CREATE TRIGGER provider_budget_charge AFTER INSERT ON provider_attempts BEGIN
 INSERT INTO provider_periods VALUES(NEW.day,NEW.characters) ON CONFLICT(period) DO UPDATE SET characters=characters+excluded.characters;
 INSERT INTO provider_periods VALUES(NEW.month,NEW.characters) ON CONFLICT(period) DO UPDATE SET characters=characters+excluded.characters;
END;
CREATE TABLE public_jobs(job TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id));
CREATE TRIGGER public_single_preparation BEFORE INSERT ON reservations WHEN EXISTS(SELECT 1 FROM public_jobs WHERE job=NEW.job) BEGIN
 SELECT RAISE(ABORT,'active_preparation') WHERE EXISTS(SELECT 1 FROM reservations WHERE account=NEW.account AND state='open');
 SELECT RAISE(ABORT,'public_account_disabled') WHERE NOT EXISTS(SELECT 1 FROM accounts a JOIN identities i ON i.account=a.id WHERE a.id=NEW.account AND a.enabled=1);
END;
CREATE TABLE webhook_events(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL,received INTEGER NOT NULL,processed INTEGER,attempts INTEGER NOT NULL DEFAULT 0);
CREATE INDEX webhook_pending ON webhook_events(processed,received);
CREATE TABLE operations_alerts(kind TEXT PRIMARY KEY,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,occurrences INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);
