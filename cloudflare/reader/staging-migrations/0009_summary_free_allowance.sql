-- Retain 0008's historical experimental reservations unchanged; do not use as quota.
CREATE TABLE IF NOT EXISTS summary_free_gate (
 id TEXT PRIMARY KEY CHECK(id='workers-ai-free'),
 circuit_until INTEGER NOT NULL DEFAULT 0,
 active_request TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO summary_free_gate(id) VALUES('workers-ai-free');
CREATE TABLE IF NOT EXISTS summary_free_requests (
 id TEXT PRIMARY KEY,
 account TEXT NOT NULL,
 created INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('admitted','done','failed','uncertain'))
);
