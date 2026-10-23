"""Effective public configuration dependencies, shared by rendering and release checks."""

import hashlib
import json

COMMON = {
    "PORT",
    "SPRING_PROFILES_ACTIVE",
    "FLYWAY_ENABLED",
    "SPRING_FLYWAY_ENABLED",
    "JAVA_TOOL_OPTIONS",
    "KAFKA_BOOTSTRAP_SERVERS",
    "SPRING_KAFKA_BOOTSTRAP_SERVERS",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "JWT_JWK_URI",
}
CONFIG_KEYS = {
    "identity-service": COMMON
    | {
        "IDENTITY_DB_URL",
        "IDENTITY_DB_USER",
        "REDIS_HOST",
        "SPRING_DATA_REDIS_HOST",
        "JWT_KEY_PATH",
        "JWT_ALLOW_KEY_GENERATION",
        "SECURE_COOKIES",
        "ALLOWED_ORIGINS",
        "GOOGLE_CLIENT_ID",
        "MAX_USERS",
        "REGISTRATION_ENABLED",
    },
    "document-service": COMMON
    | {
        "DATABASE_URL",
        "DOCUMENT_DB_USER",
        "REDIS_HOST",
        "SPRING_DATA_REDIS_HOST",
        "PUBLIC_BASE_URL",
        "IDENTITY_BASE_URL",
        "WEB_ORIGIN",
        "STORAGE_PROVIDER",
        "STORAGE_ROOT",
        "SNAPSHOTS_BUCKET",
    },
    "processing-service": COMMON
    | {
        "PROCESSING_DB_URL",
        "PROCESSING_DB_USER",
        "DOCUMENT_URL",
        "PUBLIC_BASE_URL",
        "STORAGE_PROVIDER",
        "STORAGE_ROOT",
        "GCS_BUCKET",
        "SNAPSHOTS_BUCKET",
        "ALLOWED_ORIGINS",
    },
    "collaboration-service": COMMON
    | {
        "COLLABORATION_DB_URL",
        "COLLABORATION_DB_USER",
        "DOCUMENT_URL",
        "SNAPSHOTS_BUCKET",
    },
    "payment-service": COMMON
    | {
        "PAYMENT_DB_URL",
        "PAYMENT_DB_USER",
        "WEB_ORIGIN",
        "STRIPE_PRO_MONTHLY_PRICE",
        "STRIPE_PRO_YEARLY_PRICE",
    },
    "web": set(),
}


def effective_config(name, config):
    return {key: config[key] for key in sorted(CONFIG_KEYS[name]) if key in config}


def config_hash(name, config):
    return hashlib.sha256(
        json.dumps(
            effective_config(name, config), sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()
