# AgentPay - PayPal AI Hackathon Edition

AI proposes a useful purchase. A human reviews the exact terms. The backend checks a real PayPal Sandbox order and refuses payment when authority is missing.

## What you can run

Find a wireless keyboard within a $150 budget, inspect the AI recommendation, review its merchant and price, and create or retrieve a matching PayPal Sandbox order. Then change the amount and observe the backend reject it. Transaction evidence shows what actually happened.

**Scope:** this demonstration prepares and verifies sandbox orders. It does not demonstrate a completed payment. Human review, signed authorization, PayPal buyer consent and capture are separate steps; capture stays disabled. No real goods or live payments are supported.

**Current hosted limitation:** the 12 November check found transaction evidence
returning 404 for an existing owned purchase. Local regression passes; the hosted
journey remains blocked. See [verification status](docs/verification-status.md).

## Quick start

Requires Docker Compose, your own supported AI-provider credentials and PayPal Sandbox business credentials. No other repository is required.

1. Copy `.env.example` to `.env.local`.
2. Fill in your sandbox client ID, secret and merchant ID, AI provider/model credentials, and a disposable evaluation email/password. Keep capture disabled.
3. Run:

```sh
docker compose up -d database
docker compose --profile tools run --rm tools node scripts/migrate.mjs
docker compose --profile tools run --rm tools node scripts/provision-user.mjs
docker compose up -d --build app
```

Open http://localhost:3006/hackathon, then sign in with the account you provisioned. Keys stay on the server. Model requests may incur provider charges. Source contains no shared judge account or credentials.

See [setup and troubleshooting](docs/judge-setup.md) for native Node 24/PostgreSQL 17 instructions and a separate disposable regression database.

## Understand the implementation

| Path | Purpose |
| --- | --- |
| `src/` | Next.js interface, API handlers and server-side workflow |
| `migrations/` | PostgreSQL schema, applied by the migration script |
| `scripts/` | Setup, verification and standalone source packaging |
| `tests/integration/` | Workflow, isolation and rejection tests |
| `vendor/agent-sdk/` | Bundled authorization protocol client; no sibling checkout required |
| `config/staging-authority-plan.json` | Unconfigured optional authority template; grants no permissions |
| `public/` | Local illustrations, fonts and other browser assets |

Start with the [developer guide](docs/developer-guide.md), [architecture](docs/architecture.md),
[release policy](docs/release-policy.md), [AGENTS.md](AGENTS.md) and [AI_CONTEXT.json](AI_CONTEXT.json).
The optional authorization integration is not required for the proposal/order/refusal
demonstration. Missing authorization must prevent capture.

## Development checks

```sh
npm ci
npm run check:public
npm run test:boundary
npm run test:sdk
npm run lint
npm run typecheck
npm test
npm run build
```

Tests need a separately migrated disposable PostgreSQL database supplied through `DATABASE_URL`; `npm test` does not load `.env.local`. Do not point regression tests at retained demo or customer data. Provider verification is an explicit separate command documented in the setup guide.

## Hackathon work

This edition adds the catalog-backed AI purchase proposal, exact-term review, PayPal Sandbox order verification, persisted transaction evidence, changed-amount refusal, scoped evaluation login and a problem-first demonstration. These are the submission's updates since 1 October 2026. An order existing is not a payment being completed.

## License and contributions

Owned application and bundled SDK code use [Apache-2.0](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and [image provenance](docs/image-provenance.md). Product names do not imply endorsement. See [contributing](CONTRIBUTING.md) and [security](SECURITY.md).
