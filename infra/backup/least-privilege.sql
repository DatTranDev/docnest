-- Operator template: provision the credential out of band, never commit it.
-- The online_backup account is restricted to the existing runner's network origin.
CREATE USER 'online_backup'@'YOUR_BACKUP_RUNNER_HOST' IDENTIFIED BY 'REPLACE_OUT_OF_BAND' REQUIRE SSL WITH MAX_USER_CONNECTIONS 4;
GRANT BACKUP_ADMIN, RELOAD, REPLICATION CLIENT, REPLICATION SLAVE, SHOW_ROUTINE ON *.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON identity_db.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON document_db.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON processing_db.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON collaboration_db.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON payment_db.* TO 'online_backup'@'YOUR_BACKUP_RUNNER_HOST';
