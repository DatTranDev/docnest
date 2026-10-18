CREATE TABLE collaboration_presence (
  document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  anchor_offset INT NULL,
  head_offset INT NULL,
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY(document_id,session_id),
  INDEX ix_presence_expiry(expires_at),
  FOREIGN KEY(document_id) REFERENCES collaboration_rooms(document_id) ON DELETE CASCADE
) ENGINE=InnoDB;
