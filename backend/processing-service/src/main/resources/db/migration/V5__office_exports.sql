-- Extend only the existing Processing job-type invariant; applied V1 is immutable.
SET @job_type_check = (
  SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='jobs' AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CHECK_CLAUSE LIKE '%job_type%' LIMIT 1
);
SET @drop_type_check = CONCAT('ALTER TABLE jobs DROP CHECK `', REPLACE(@job_type_check,'`','``'), '`');
PREPARE migrate_job_type FROM @drop_type_check;
EXECUTE migrate_job_type;
DEALLOCATE PREPARE migrate_job_type;
ALTER TABLE jobs ADD CONSTRAINT ck_jobs_export_type CHECK(job_type IN ('PREVIEW','EXPORT_TXT','EXPORT_HTML','EXPORT_DOCX','EXPORT_PDF'));
