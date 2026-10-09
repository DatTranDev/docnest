#!/bin/bash
set -euo pipefail
# Generated local credentials are hexadecimal. Reject SQL metacharacters.
for name in IDENTITY_DB_PASSWORD DOCUMENT_DB_PASSWORD PROCESSING_DB_PASSWORD COLLABORATION_DB_PASSWORD PAYMENT_DB_PASSWORD; do
  value=${!name}
  [[ "$value" =~ ^[a-zA-Z0-9_-]{20,128}$ ]] || { echo "Invalid bootstrap credential format" >&2; exit 1; }
done
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS identity_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS document_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS processing_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS collaboration_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE USER IF NOT EXISTS 'identity'@'%' IDENTIFIED BY '${IDENTITY_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'document'@'%' IDENTIFIED BY '${DOCUMENT_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'processing'@'%' IDENTIFIED BY '${PROCESSING_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'collaboration'@'%' IDENTIFIED BY '${COLLABORATION_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON identity_db.* TO 'identity'@'%';
GRANT ALL PRIVILEGES ON document_db.* TO 'document'@'%';
GRANT ALL PRIVILEGES ON processing_db.* TO 'processing'@'%';
GRANT ALL PRIVILEGES ON collaboration_db.* TO 'collaboration'@'%';
CREATE DATABASE IF NOT EXISTS payment_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE USER IF NOT EXISTS 'payment'@'%' IDENTIFIED BY '${PAYMENT_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON payment_db.* TO 'payment'@'%';
SQL
