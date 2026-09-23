-- Staging only. Additive and compatible with the prior full-preparation Worker.
CREATE TABLE IF NOT EXISTS mse_campaign (
 id TEXT PRIMARY KEY CHECK(id='mse-pixel-v1'),
 maximum INTEGER NOT NULL CHECK(maximum=3000),
 characters INTEGER NOT NULL DEFAULT 0 CHECK(characters BETWEEN 0 AND 3000),
 active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS mse_campaign_admissions (
 job TEXT PRIMARY KEY REFERENCES speech_admissions(job),
 characters INTEGER NOT NULL CHECK(characters>0)
);
INSERT OR IGNORE INTO mse_campaign VALUES('mse-pixel-v1',3000,0,1);
CREATE TRIGGER IF NOT EXISTS mse_campaign_check BEFORE INSERT ON speech_admissions
WHEN EXISTS(SELECT 1 FROM mse_campaign WHERE active=1)
BEGIN
 SELECT RAISE(ABORT,'mse_campaign_exhausted') WHERE NOT EXISTS(
 SELECT 1 FROM mse_campaign WHERE active=1 AND characters+NEW.characters<=maximum);
END;
CREATE TRIGGER IF NOT EXISTS mse_campaign_debit AFTER INSERT ON speech_admissions
WHEN EXISTS(SELECT 1 FROM mse_campaign WHERE active=1)
BEGIN
 INSERT INTO mse_campaign_admissions VALUES(NEW.job,NEW.characters);
 UPDATE mse_campaign SET characters=characters+NEW.characters WHERE active=1;
END;
