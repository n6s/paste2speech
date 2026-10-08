-- Metadata only. Reserved cents count every admitted request, including uncertain failures.
CREATE TABLE IF NOT EXISTS summary_attempts (
 id TEXT PRIMARY KEY,
 account TEXT NOT NULL,
 created INTEGER NOT NULL,
 day TEXT NOT NULL,
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents=1)
);
CREATE INDEX IF NOT EXISTS summary_attempts_account_time ON summary_attempts(account,created);
