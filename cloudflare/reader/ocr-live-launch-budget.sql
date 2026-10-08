-- One-time production launch seed, after migration 0015 and verified backup.
-- Repeat execution fails on the primary key; never reset reserved_cents.
-- Internal historical ID is shared by the accounting code.
INSERT INTO ocr_business_budget(id,cap_cents,reserved_cents) VALUES('sandbox-retail',1000,0);
