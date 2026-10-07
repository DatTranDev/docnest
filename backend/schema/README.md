# Using migrations

bootstrap.sql creates only the three databases using a local lab administrator. P01 creates database users from secrets and grants separate access: identity_app to identity_db, document_app to document_db, and processing_app to processing_db. Never GRANT _._ to an application user.

Each V1__init.sql is a Flyway migration for its service's datasource. Do not run all three through one application account. After applying V1, make changes in V2 rather than modifying deployed V1. Migration administrator and runtime roles can be separated in the cloud learning phase.

Cross-service references use stable UUIDs and APIs/events. Do not create a foreign key from Document/Processing to Identity users. requester_queues serializes job quotas. Set preview_dedup_key only for PREVIEW jobs, using documentId:revision:PREVIEW. Leave it NULL for manual exports to allow distinct requests; idempotency keys prevent duplicate retries.

Document purge sets head_revision=0,head_version_id=NULL before deleting child versions and tickets. FK RESTRICT constraints prevent deletion outside the procedure. Honor read/processing grace periods before physical deletion. Where both locks are needed, acquire owner_workspace before document. Saving and grants lock only document to avoid deadlocks.
