-- Run as the local bootstrap/migration administrator, never as an app user.
CREATE DATABASE IF NOT EXISTS identity_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS document_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS processing_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
-- P01 creates three users from secrets and grants only their own database.
-- No runnable default password is embedded in this file.
