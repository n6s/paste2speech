-- Balance reads only need active reservations, not the closed reading history.
CREATE INDEX reservations_open_account
ON reservations(account) WHERE state='open';
