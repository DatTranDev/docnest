# Billing and subscription saga v1

Payment owns `payment_db` and Stripe customer/subscription mappings. Each of the
four existing services owns its entitlement projection, inbox and outbox in its
own database. No cross-database SQL or service imports are permitted.

The initial catalog is FREE, PRO_MONTHLY and PRO_YEARLY. Stripe recurring Price
IDs are server-side configuration; clients never choose prices, amounts, customer
IDs, return URLs or Stripe subscription IDs. Existing Free capabilities remain
available pending the owner's plan-benefit decision. This integration does not
silently introduce a paywall for existing documents or shared users.

Payment orchestrates a durable entitlement saga. A verified Stripe subscription
snapshot produces a new per-account generation and commands for Identity,
Document, Processing and Collaboration. Participant mutation, inbox receipt and
reply outbox commit atomically. Payment completes only after all four replies.
Monotonic generations fence delayed commands, concurrent sagas and compensation.
Permanent rejection starts compensating commands restoring the prior entitlement
at a higher generation, and queues a durable period-end cancellation when a Stripe subscription exists. Financial state remains MANUAL_REVIEW: local compensation
does not undo a Stripe charge, and refunds require an explicit reviewed operation.
Temporary database/Kafka outages retry; they do not trigger financial compensation.

Messages retain the existing envelope fields eventId, eventType, schemaVersion,
occurredAt, producer, traceId, payload. New topics are service-specific
`billing.{service}.command.v1` and `billing.{service}.reply.v1`; key is userId.
64 KiB cap, three partitions, private SASL principals and exact consumer groups.
Outbox publication happens after SQL commit and marks success only after broker
ACK. Inbox hashes detect inconsistent event-ID reuse. Delivery is at least once;
business effects are idempotent, not claimed exactly-once transport.

Stripe webhooks verify HMAC over bounded raw bytes with a 300-second tolerance.
Store minimal event IDs/object IDs, not full card/customer payloads. Return 2xx
only after durable receipt. Events wake reconciliation; they are not applied in
timestamp order. A leased worker retrieves current Stripe state outside SQL and
commits only while its fencing token is current. API responses and webhook
destinations use pinned Stripe API version `2026-09-30.endive`. Grant Pro only for
an active configured subscription with a paid latest invoice and future paid
period; trial/proration/discount/multi-price purchases are outside this catalog.
Deletion/payment failure and expiry reconcile to Free; period-end cancellation
keeps paid access until expiry. Checkout success redirects cannot grant access.

Stripe is disabled when no test key is configured. This local task accepts only
test-mode secrets/events. Live mode needs a separately reviewed operational gate.
Actual sandbox Checkout/renewal/cancel/webhook tests remain PENDING credentials;
local provider contract tests cannot certify them.

Primary references: [Stripe MCP](https://docs.stripe.com/mcp),
[subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[webhook duplicate and ordering behavior](https://docs.stripe.com/webhooks),
[API versioning](https://docs.stripe.com/api/versioning),
[sagas](https://microservices.io/patterns/data/saga.html),
[transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html).

Unfinished phases republish stable command event IDs every 60 seconds. Duplicate commands republish the matching stored reply envelope, without changing the inbox or grant. Completed phases are not periodically replayed. This repairs bounded consumer outages/Kafka retention gaps while preserving at-least-once semantics. Expiry is evaluated on entitlement reads; no paid access survives its stored period. Catalog benefit enforcement is pending the owner's product decision, so Free retains the existing application capabilities.
