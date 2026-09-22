-- Preserve historical metadata without replaying a grant or reservation.
CREATE TABLE legacy_grants(transaction_id TEXT PRIMARY KEY REFERENCES grants(id),created TEXT NOT NULL);
CREATE TABLE legacy_reservations(job TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),remaining INTEGER NOT NULL CHECK(remaining=0));
