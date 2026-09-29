ALTER TABLE webhook_events ADD COLUMN next_attempt INTEGER NOT NULL DEFAULT 0;
CREATE INDEX webhook_due ON webhook_events(processed,next_attempt,received);
