-- Flyway datasource must already select identity_db. UTC connection/session.
CREATE TABLE users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  email_norm VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  password_hash VARCHAR(512) CHARACTER SET ascii NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CHECK(status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB;
CREATE TABLE refresh_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  used_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX ix_refresh_family(family_id),
  INDEX ix_refresh_expiry(expires_at)
) ENGINE=InnoDB;
