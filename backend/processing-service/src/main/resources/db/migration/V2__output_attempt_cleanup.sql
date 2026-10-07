CREATE TABLE output_attempts (
  attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  output_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  state VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'RESERVED',
  output_ref JSON NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CHECK(state IN ('RESERVED','PUBLISHED','CLEANED')),
  INDEX ix_output_cleanup(state,created_at)
) ENGINE=InnoDB;
