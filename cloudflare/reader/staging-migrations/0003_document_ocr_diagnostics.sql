-- STAGING ONLY. Bounded metadata; never store provider bodies, headers or secrets.
CREATE TABLE IF NOT EXISTS ocr_experiment_diagnostics(
 attempt_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ocr','access-check')),
 phase TEXT NOT NULL,http_status INTEGER,error_kind TEXT,model_available INTEGER,
 key_edge_whitespace INTEGER,key_control_characters INTEGER,
 created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(attempt_id,kind)
);
