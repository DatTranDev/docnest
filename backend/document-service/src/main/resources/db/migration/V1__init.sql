-- Flyway datasource must already select document_db. No cross-database foreign keys.
CREATE TABLE owner_workspaces (
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  tree_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE folders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  parent_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS
    (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')) STORED,
  name VARCHAR(120) NOT NULL,
  name_norm VARCHAR(120) COLLATE utf8mb4_0900_as_ci NOT NULL,
  metadata_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_folder_owner_id(owner_user_id,id),
  UNIQUE KEY uq_folder_sibling(owner_user_id,parent_key,name_norm),
  FOREIGN KEY(owner_user_id) REFERENCES owner_workspaces(owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_user_id,parent_id) REFERENCES folders(owner_user_id,id) ON DELETE RESTRICT,
  INDEX ix_folder_list(owner_user_id,parent_key,name_norm,id),
  CHECK(metadata_revision>=1),
  CHECK(parent_id IS NULL OR parent_id<>id)
) ENGINE=InnoDB;
CREATE TABLE documents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  folder_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  restore_folder_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  title VARCHAR(200) NOT NULL,
  head_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  head_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  metadata_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  preview_revision BIGINT UNSIGNED NULL,
  preview_json JSON NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  FOREIGN KEY(owner_user_id) REFERENCES owner_workspaces(owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_user_id,folder_id) REFERENCES folders(owner_user_id,id) ON DELETE RESTRICT,
  INDEX ix_doc_owned(owner_user_id,deleted_at,folder_id,created_at,id),
  CHECK(metadata_revision>=1),
  CHECK((head_revision=0 AND head_version_id IS NULL) OR (head_revision>0 AND head_version_id IS NOT NULL))
) ENGINE=InnoDB;
CREATE TABLE document_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  storage_provider VARCHAR(16) CHARACTER SET ascii NOT NULL,
  storage_bucket VARCHAR(128) CHARACTER SET ascii NULL,
  object_key VARCHAR(512) CHARACTER SET ascii NOT NULL,
  object_generation VARCHAR(32) CHARACTER SET ascii NOT NULL,
  native_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  native_bytes INT UNSIGNED NOT NULL,
  text_utf8_bytes INT UNSIGNED NOT NULL,
  utf16_length INT UNSIGNED NOT NULL,
  logical_lines INT UNSIGNED NOT NULL,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  last_access_at DATETIME(6) NOT NULL,
  retired_at DATETIME(6) NULL,
  cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY uq_version_revision(document_id,revision),
  UNIQUE KEY uq_version_document_id(document_id,id),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  INDEX ix_version_gc(retired_at,cleanup_pending,last_access_at),
  CHECK(revision>=1), CHECK(storage_provider IN ('LOCAL','GCS')),
  CHECK(native_bytes<=33554432), CHECK(text_utf8_bytes<=10485760),
  CHECK(utf16_length<=10485760), CHECK(logical_lines BETWEEN 1 AND 1000000)
) ENGINE=InnoDB;
ALTER TABLE documents ADD CONSTRAINT fk_document_head
  FOREIGN KEY(id,head_version_id) REFERENCES document_versions(document_id,id) ON DELETE RESTRICT;
CREATE TABLE document_permissions (
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantee_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii NOT NULL,
  granted_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY(document_id,grantee_user_id),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  INDEX ix_permissions_grantee(grantee_user_id,document_id),
  CHECK(role IN ('VIEWER','EDITOR'))
) ENGINE=InnoDB;
CREATE TABLE share_links (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL, expires_at DATETIME(6) NOT NULL, revoked_at DATETIME(6) NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  INDEX ix_share_document(document_id,created_at),
  CHECK(expires_at>created_at)
) ENGINE=InnoDB;
CREATE TABLE upload_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_head_revision BIGINT UNSIGNED NOT NULL,
  expected_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expected_native_bytes INT UNSIGNED NOT NULL,
  storage_provider VARCHAR(16) CHARACTER SET ascii NOT NULL,
  storage_bucket VARCHAR(128) CHARACTER SET ascii NULL,
  object_key VARCHAR(512) CHARACTER SET ascii NOT NULL UNIQUE,
  object_generation VARCHAR(32) CHARACTER SET ascii NULL,
  validated_manifest JSON NULL,
  state VARCHAR(16) CHARACTER SET ascii NOT NULL,
  validation_lease_until DATETIME(6) NULL,
  validation_lease_owner CHAR(36) CHARACTER SET ascii NULL,
  committed_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(6) NOT NULL, expires_at DATETIME(6) NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  FOREIGN KEY(committed_version_id) REFERENCES document_versions(id) ON DELETE RESTRICT,
  INDEX ix_upload_expiry(state,expires_at),
  CHECK(expected_native_bytes BETWEEN 20 AND 33554432),
  CHECK(storage_provider IN ('LOCAL','GCS')),
  CHECK(state IN ('CREATED','UPLOADED','VALIDATING','VALIDATED','COMMITTED','ABANDONED'))
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
