CREATE TABLE IF NOT EXISTS daily_events (
 day TEXT NOT NULL, event TEXT NOT NULL, engine TEXT NOT NULL, category TEXT NOT NULL,
 release TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,event,engine,category,release)
);
CREATE TABLE IF NOT EXISTS feedback (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, message TEXT NOT NULL, email TEXT NOT NULL,
 digest TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, telegram_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS feedback_delivery ON feedback(status,lease_until);
CREATE INDEX IF NOT EXISTS feedback_age ON feedback(created_at);
