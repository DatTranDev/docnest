-- Flyway datasource must already select processing_db.
CREATE TABLE requester_queues (
  requester_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE jobs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_revision BIGINT UNSIGNED NOT NULL,
  requested_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  job_type VARCHAR(16) CHARACTER SET ascii NOT NULL,
  system_job BOOLEAN NOT NULL DEFAULT FALSE,
  preview_dedup_key VARCHAR(100) CHARACTER SET ascii NULL UNIQUE,
  state VARCHAR(16) CHARACTER SET ascii NOT NULL,
  source_ref JSON NOT NULL,
  source_native_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  lease_owner CHAR(36) CHARACTER SET ascii NULL, lease_until DATETIME(6) NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  output_ref JSON NULL, output_bytes INT UNSIGNED NULL,
  summary_json JSON NULL, error_code VARCHAR(64) NULL, error_message VARCHAR(500) NULL,
  created_at DATETIME(6) NOT NULL, started_at DATETIME(6) NULL, finished_at DATETIME(6) NULL,
  deadline_at DATETIME(6) NOT NULL, output_expires_at DATETIME(6) NULL,
  INDEX ix_jobs_requester(requested_by_user_id,system_job,created_at,id),
  INDEX ix_jobs_claim(state,next_attempt_at,lease_until),
  INDEX ix_jobs_document(document_id,document_revision),
  CHECK(document_revision>=1),
  CHECK(job_type IN ('PREVIEW','EXPORT_TXT','EXPORT_HTML')),
  CHECK(state IN ('QUEUED','READY','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  CHECK(output_bytes IS NULL OR output_bytes<=67108864)
) ENGINE=InnoDB;

CREATE TABLE idempotency_requests (
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_key VARCHAR(150) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY(actor_user_id, operation_key, idempotency_key),
  INDEX ix_idempotency_expiry(expires_at)
) ENGINE=InnoDB;

CREATE TABLE outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  aggregate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aggregate_revision BIGINT UNSIGNED NOT NULL,
  topic VARCHAR(128) CHARACTER SET ascii NOT NULL,
  event_key VARCHAR(128) CHARACTER SET ascii NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  next_attempt_at DATETIME(6) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  lease_owner CHAR(36) CHARACTER SET ascii NULL,
  lease_until DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  last_error_code VARCHAR(64) NULL,
  INDEX ix_outbox_pending(published_at, next_attempt_at, id)
) ENGINE=InnoDB;

CREATE TABLE inbox_receipts (
  consumer_name VARCHAR(128) CHARACTER SET ascii NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  received_at DATETIME(6) NOT NULL,
  PRIMARY KEY(consumer_name, event_id)
) ENGINE=InnoDB;
