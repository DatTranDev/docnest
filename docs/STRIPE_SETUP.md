# Stripe subscriptions: local setup

Payment uses hosted Checkout and Customer Portal, with durable requests and an
entitlement saga. Catalog: Free, Pro monthly, Pro yearly. Existing Free features
remain available; plan-specific quotas/features have not been specified. Card
details stay on Stripe. The application currently accepts **test mode only**.

The configured local sandbox catalog is **Pro USD 5/month** and **Pro USD 50/year**.
Both are fixed recurring prices with quantity one, without trials or metered use.
The app uses the exact Price IDs in `.env`; Stripe Checkout displays the price
before payment. Product/Price setup and enabled buttons do not certify a completed
subscription purchase or the entitlement saga. Current IDs and executed checks
are recorded in PROJECT_STATUS.md; other accounts need their own matching Prices.

## Connect Codex MCP

The local Codex configuration already has `stripe` at `https://mcp.stripe.com`.
Complete OAuth in your terminal:

```powershell
codex mcp login stripe
codex mcp get stripe
```

For another machine, register it first with
`codex mcp add stripe --url https://mcp.stripe.com`. Restart the Codex session after
authentication to load tools. MCP is an agent tool; application containers do not
use it or need its OAuth credentials. The optional Stripe app/plugin connection
is separate. See [official Stripe MCP setup](https://docs.stripe.com/mcp).

## Configure sandbox billing

1. Choose your Stripe sandbox. Create one Product with two recurring Prices:
   monthly and yearly, quantity one, no trial/metered usage. You choose the amounts
   and currency. Do not use live keys or enable real payments.
2. Backend API requests and supported webhook events are pinned to
   **2026-09-30.endive**. The local listener below requests Stripe's latest event
   version and checks it against this exact pin before configuring credentials.
   It does not change the account's default version. Configure deployed webhook
   endpoints explicitly with this version. If Stripe changes its latest version,
   the helper refuses setup; keep the pin rather than upgrading one side.
3. Configure the sandbox default Customer Portal: payment method updates and
   invoices; cancellation **at period end**. Disable plan switching, pause,
   trials, coupons and immediate cancellation for this catalog. Portal changes
   still reconcile from current API state.
4. Install [Stripe CLI](https://github.com/stripe/stripe-cli#installation), run
   `stripe login`, and select the intended sandbox on the authorization page.
   CLI and MCP login are separate. This workstation's CLI 1.37.3 is verified with
   the listener below; it has no `switch` command. Newer installations can use
   `stripe switch` if available. CLI access may require account-admin permission.
5. Start the application, then run this from the repository root in a separate
   terminal:

```powershell
python -X utf8 tooling/scripts/stripe_listen.py
```

The helper forwards only the nine supported snapshot event types to
`http://localhost:8080/api/v1/billing/webhooks/stripe`. It takes the authenticated
CLI profile's `sk_test_` key and actual listener signing secret, writes them to the
ignored `.env` without printing them, and reloads only Payment. Existing nonempty
API keys must match the chosen CLI profile; the helper refuses an account/key
change rather than overwriting it. Use `--profile NAME` for another configured
profile. CLI-created API keys expire after 90 days; reauthenticate and explicitly
update an expired application key when needed.

Keep the helper running while testing webhooks; Ctrl+C stops its child listener.
After a machine restart, run the same command again. Nonsecret runtime state and
an exclusive lock are under ignored `.tools/stripe/`. If a process crashes, check
the recorded process IDs before removing a stale lock; do not start duplicate
listeners. CLI output is consumed privately rather than relayed into logs.

Put these values in the ignored local `.env`, never in Git, screenshots or logs:

| Value                      | Source                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | Helper configures the CLI sandbox test key, or set your own sandbox key (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET`    | Helper configures this CLI listener's signing secret (`whsec_…`)                      |
| `STRIPE_PRO_MONTHLY_PRICE` | Your monthly recurring `price_…` ID                                                   |
| `STRIPE_PRO_YEARLY_PRICE`  | Your yearly recurring `price_…` ID                                                    |
| `WEB_ORIGIN`               | `http://localhost:8080` locally; exact HTTPS origin in cloud                          |

After adding/changing Price IDs, run `python -X utf8 tooling/scripts/run.py up`. Open **Gói dịch vụ** in the
workspace. Missing configuration leaves Checkout disabled. Prices appear on
Stripe before purchase. Returning to the app never grants a plan by itself;
signed events and current paid subscription state drive the saga.

The CLI listener signing secret differs from a deployed endpoint signing secret.
Do not use `--live`, or log raw webhook/API JSON. The adapter makes bounded HTTP
requests directly to Stripe; no application Stripe SDK/MCP dependency is needed.
See [CLI listener](https://docs.stripe.com/cli/listen) and
[Portal configuration](https://docs.stripe.com/customer-management/configure-portal).

## Acceptance and recovery

Executed local evidence belongs only in `docs/PROJECT_STATUS.md`. These provider
checks remain **PENDING** until actual sandbox credentials are configured:

- Purchase both configured plans with Stripe's test payment method. Verify paid
  invoice/current subscription and all four entitlement projections; only then
  Payment reaches COMPLETE. A cancelled Checkout leaves Free.
- Retry the same application request/key; obtain one durable request/Checkout.
  Duplicate/reordered webhook deliveries must converge to current API state.
- Test failed payment and renewal with the sandbox/test clock. Check access
  expiry, current invoice status, and generation changes without modifying SQL.
- Open Portal, change payment method, cancel at period end; paid access remains
  until expiry. End/cancelled/unpaid subscriptions reconcile to Free.
- Interrupt Payment/Kafka, complete Checkout, restart, and verify durable receipt,
  leased work/outbox recovery. Test signature tampering, version mismatch,
  anonymous access, and another user's request ID.

`python testing/checks/billing_saga_check.py` requires Stripe disabled and tests
five real local services using SQL-seeded test entitlement intents. It covers
broker outage, complete replies, duplicates, restart, delayed commands and
compensation. It is **not** a Stripe payment test. Java HTTP adapter contract
tests use a loopback provider server; HMAC tests use synthetic signed bytes.

Permanent entitlement rejection restores the previous entitlement at a higher
generation and queues a period-end cancellation if a subscription exists. State
becomes MANUAL_REVIEW: cancellation does not refund an existing charge. Review
the sandbox subscription/invoice and correct the participant problem before
**Đồng bộ trạng thái**. Refunds require an explicitly reviewed operation outside
this implementation. Temporary outages retry; they do not automatically refund.

Customer/subscription mappings and Stripe request idempotency must survive
backups. After SQL rollback/restore, pause billing writes and reconcile affected
accounts against Stripe before reopening Checkout: restoring SQL cannot undo an
external purchase. Retain inbox/event IDs and saga generations. Unfinished phases
republish stable commands every minute; participants republish the same stored
reply when a command repeats. Inspect private DLQ fingerprints/offsets for repair,
not raw payload logs. The single-broker lab has no high availability; load/multi-
instance acceptance and live billing are not certified.

If customer creation has an unknown expired outcome and its mapping is missing, new billing writes return `BILLING_REVIEW_REQUIRED`. An operator must identify the existing customer by the account UUID metadata in Stripe and repair the mapping before retrying; never blindly POST another customer after Stripe's idempotency retention window. Known customer mappings can use the explicit reconciliation action after the underlying issue is repaired.

The browser retains a per-account/action/plan idempotency key until the server acknowledges the durable request, then journals the returned request ID for resumption. Billing request/receipt/inbox/outbox retention and operator repair remain manual; include their growth in backup/capacity planning.
