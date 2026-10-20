-- PRODUCTION ONLY. Preserve every identity, session, link, limit and financial row.
-- Fail before any write if this is not the production wallet database.
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM unified_controls WHERE id='production' AND version='unified-v1') THEN 'true' ELSE 'PRODUCTION_ONLY_LOGIN_RESERVE' END);

-- Public callers may use at most 90 shared links per rolling day. Each existing,
-- enabled verified identity has five additional links reserved for that identity
-- per rolling day. Exhausting the public pool cannot consume another identity's
-- reserve. Existing five/email/hour and twenty/IP/hour limits still apply.
-- The bounded daily mail budget is 90 plus 5 per eligible identity, not unlimited.
-- A reserve is admission capacity only: it confers no session or account access.
DROP TRIGGER login_limit_check;
DROP TRIGGER login_limit_record;
CREATE TRIGGER login_limit_check BEFORE INSERT ON login_links BEGIN
 SELECT RAISE(ABORT,'login_rate_limited') WHERE
 (SELECT COUNT(*) FROM login_limits WHERE scope=NEW.email_scope AND created>NEW.created-3600000)>=5
 OR (SELECT COUNT(*) FROM login_limits WHERE scope=NEW.ip_scope AND created>NEW.created-3600000)>=20
 OR ((SELECT COUNT(*) FROM login_limits WHERE scope='global' AND created>NEW.created-86400000)>=90
 AND NOT (EXISTS(SELECT 1 FROM identities i JOIN accounts a ON a.id=i.account WHERE i.email=NEW.email AND a.enabled=1)
 AND (SELECT COUNT(*) FROM login_limits WHERE scope='member:'||NEW.email_scope AND created>NEW.created-86400000)<5));
END;
CREATE TRIGGER login_limit_record AFTER INSERT ON login_links BEGIN
 INSERT INTO login_limits VALUES(NEW.email_scope,NEW.created),(NEW.ip_scope,NEW.created);
 INSERT INTO login_limits(scope,created) SELECT
 CASE WHEN EXISTS(SELECT 1 FROM identities i JOIN accounts a ON a.id=i.account WHERE i.email=NEW.email AND a.enabled=1)
 AND (SELECT COUNT(*) FROM login_limits WHERE scope='member:'||NEW.email_scope AND created>NEW.created-86400000)<5
 THEN 'member:'||NEW.email_scope ELSE 'global' END,NEW.created;
END;
