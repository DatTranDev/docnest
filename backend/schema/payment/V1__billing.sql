CREATE TABLE payment_accounts (
 user_id CHAR(36) PRIMARY KEY, customer_id VARCHAR(128) NULL UNIQUE,
 plan VARCHAR(24) NOT NULL DEFAULT 'FREE', expires_at DATETIME(6) NULL,
 generation BIGINT NOT NULL DEFAULT 0, subscription_id VARCHAR(128) NULL,
 stripe_status VARCHAR(32) NOT NULL DEFAULT 'none', cancel_at_period_end TINYINT NOT NULL DEFAULT 0,
 saga_id CHAR(36) NULL, review_needed TINYINT NOT NULL DEFAULT 0,
 sync_revision BIGINT NOT NULL DEFAULT 0, synced_revision BIGINT NOT NULL DEFAULT 0,
 next_sync_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 work_lease CHAR(36) NULL, work_until TIMESTAMP(6) NULL
);
CREATE TABLE payment_requests (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, request_key CHAR(36) NOT NULL,
 kind VARCHAR(16) NOT NULL, plan VARCHAR(24) NOT NULL DEFAULT 'FREE', status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NOT NULL,
 result_url VARCHAR(2048) NULL, error_code VARCHAR(64) NULL,
 attempts INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY payment_request_key(user_id,request_key), INDEX payment_request_due(status,next_attempt_at),
 FOREIGN KEY(user_id) REFERENCES payment_accounts(user_id)
);
CREATE TABLE payment_sagas (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, generation BIGINT NOT NULL,
 phase VARCHAR(16) NOT NULL DEFAULT 'APPLY', state VARCHAR(24) NOT NULL DEFAULT 'PROVISIONING',
 plan VARCHAR(24) NOT NULL, expires_at DATETIME(6) NULL,
 previous_plan VARCHAR(24) NOT NULL, previous_expires_at DATETIME(6) NULL,
 replies INT NOT NULL DEFAULT 0, trace_id CHAR(32) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY payment_saga_generation(user_id,generation), FOREIGN KEY(user_id) REFERENCES payment_accounts(user_id)
);
CREATE TABLE stripe_receipts (
 event_id VARCHAR(128) PRIMARY KEY, fingerprint CHAR(64) NOT NULL, event_type VARCHAR(64) NOT NULL,
 customer_id VARCHAR(128) NULL, received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE saga_inbox (
 event_id CHAR(36) PRIMARY KEY, fingerprint CHAR(64) NOT NULL,
 completed TINYINT NOT NULL DEFAULT 0, received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE saga_outbox (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, event_id CHAR(36) NOT NULL UNIQUE,
 topic VARCHAR(128) NOT NULL, aggregate_key CHAR(36) NOT NULL, payload JSON NOT NULL,
 attempts INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 lease_id CHAR(36) NULL, lease_until TIMESTAMP(6) NULL, published_at TIMESTAMP(6) NULL,
 INDEX saga_outbox_due(published_at,next_attempt_at)
);
