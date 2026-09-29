-- Operator-only, fixed cached-fixture probes; never accepted from public APIs.
ALTER TABLE reader_maintenance ADD COLUMN probe TEXT CHECK(probe IN ('ready','cancel','expire'));
