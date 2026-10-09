CREATE TABLE collaboration_rooms (
  document_id CHAR(36) PRIMARY KEY,
  head_revision BIGINT NOT NULL,
  sequence BIGINT NOT NULL,
  log_bytes BIGINT NOT NULL,
  checkpoint_id CHAR(36) NULL,
  checkpoint_until TIMESTAMP(6) NULL
);
CREATE TABLE collaboration_updates (
  document_id CHAR(36) NOT NULL,
  sequence BIGINT NOT NULL,
  operation_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  payload MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (document_id, sequence),
  UNIQUE KEY collaboration_operation (document_id, operation_id),
  CONSTRAINT collaboration_room_fk FOREIGN KEY (document_id) REFERENCES collaboration_rooms(document_id)
);
