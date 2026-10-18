-- Keep existing identities and user IDs. Legacy Google accounts retain their old
-- unguessable password hash because V4 did not record how the account was created.
ALTER TABLE users MODIFY password_hash VARCHAR(512) CHARACTER SET ascii NULL;
ALTER TABLE users ADD COLUMN custom_avatar MEDIUMBLOB NULL;
ALTER TABLE users ADD COLUMN custom_avatar_mime VARCHAR(32) CHARACTER SET ascii NULL;
ALTER TABLE users ADD COLUMN google_picture_url VARCHAR(1024) NULL;
ALTER TABLE users ADD COLUMN avatar_source VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT 'GENERATED';
ALTER TABLE users ADD COLUMN avatar_updated_at DATETIME(6) NULL;
ALTER TABLE google_identities ADD COLUMN provider_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NULL;
