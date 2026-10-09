CREATE TABLE subscription_entitlements (
 user_id CHAR(36) PRIMARY KEY, generation BIGINT NOT NULL DEFAULT 0,
 plan VARCHAR(24) NOT NULL DEFAULT 'FREE', expires_at DATETIME(6) NULL,
 saga_id CHAR(36) NULL, phase VARCHAR(16) NOT NULL DEFAULT 'APPLY',
 CHECK(plan IN ('FREE','PRO_MONTHLY','PRO_YEARLY')), CHECK(generation>=0)
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
