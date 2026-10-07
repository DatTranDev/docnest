ALTER TABLE upload_sessions ADD COLUMN resumable_uri TEXT NULL;
ALTER TABLE upload_sessions ADD COLUMN object_deleted_at DATETIME(6) NULL;
ALTER TABLE document_versions ADD COLUMN object_deleted_at DATETIME(6) NULL;
