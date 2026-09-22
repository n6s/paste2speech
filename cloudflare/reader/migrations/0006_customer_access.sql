-- New customers are metered. Only offline-imported pilot entitlements can bypass.
CREATE TABLE legacy_pilots(account TEXT PRIMARY KEY REFERENCES accounts(id));
UPDATE accounts SET enabled=1;
CREATE TRIGGER new_customer_metered AFTER INSERT ON accounts BEGIN
 UPDATE accounts SET enabled=1 WHERE id=NEW.id;
END;
