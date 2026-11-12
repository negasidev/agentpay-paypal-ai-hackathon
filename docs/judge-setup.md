# Independent judge setup

## Reproducible Docker path

Use Docker or a Linux Node 24 environment for the reproducible build path.

Copy `.env.example` to `.env.local`, set your own sandbox/model keys and a fresh
evaluation email/password. Keep capture disabled. With Docker Compose available:

```sh
docker compose up -d database
docker compose --profile tools run --rm tools node scripts/migrate.mjs
docker compose --profile tools run --rm tools node scripts/provision-user.mjs
docker compose up -d --build app
```

Open http://localhost:3006. This stack has its own database and volume, exposes
the app on loopback only, and runs independently of external authorization services. The tools
profile can also run `node scripts/verify-hackathon.mjs --providers` and `npm test`.
Tests should use a separate disposable Compose project/database, not retained
demo purchases. `docker compose down` stops this local stack and retains data.

## Native Node setup

Use Node 24, npm and PostgreSQL 17. No additional repository is required.

1. `npm ci`
2. Create a disposable database named `agentpay_hackathon_judges`. For example:
   `docker run --name agentpay-judges-pg -e POSTGRES_USER=agentpay -e POSTGRES_PASSWORD=local-demo-only -e POSTGRES_DB=agentpay_hackathon_judges -p 127.0.0.1:5454:5432 -d postgres:17-alpine`
3. Copy `.env.example` to `.env.local`. Set
   `DATABASE_URL=postgresql://agentpay:local-demo-only@127.0.0.1:5454/agentpay_hackathon_judges`
   and `APP_ORIGIN=http://localhost:3006`.
4. Add your own PayPal **sandbox business** client ID, secret and merchant ID.
   Configure one supported AI provider and an available model for that provider.
   Model requests can incur usage charges. Keep credentials out of Git and video.
5. Keep `AGENTPAY_PROTECTED_CAPTURE_ENABLED=false`. Enable sandbox order and buyer
   checkout with `AGENTPAY_SANDBOX_CHECKOUT_ENABLED=true`. For independent evaluation,
   leave canonical login disabled and all authority mapping fields empty. This
   enables local account authentication; it does not grant capture authority.
6. Set `AGENTPAY_USER_EMAIL` to your disposable test address and
   `AGENTPAY_USER_PASSWORD` to a fresh 12–128 character password in `.env.local`.
   Run `npm run db:migrate`, then `npm run user:provision` once.
7. Build with `npm run build`, then `npm start`. Open http://localhost:3006/demo and sign in with your provisioned evaluation account.
8. Generate the keyboard recommendation under $150, confirm exact-term review, then explicitly submit for authorization.
9. Path A: create or verify the bound PayPal Sandbox order. Repeat to confirm the same provider ID. Request canonical authorization; absent mapping must leave capture disabled.
10. Path B: test an altered amount. The real backend returns 409 without dispatching a payment. Open the linked transaction evidence. This is a stored-order inspection, not a completed payment or signed-grant rejection.
For CLI provider verification, run `npm run verify:hackathon`. This creates another
synthetic account and independently checks an AI draft, real sandbox order,
binding refusal, capture denial and reconnect recovery. It performs no capture.

For complete regression, use a separate disposable database and run:
`node --env-file=.env.local --test --test-isolation=none tests/integration/*.test.mjs`.
Run `npm run lint` for JavaScript safety checks and `npm run typecheck` for TS/TSX.

Troubleshooting: database connection failures do not fall back to memory; check
the port and migrations. AI failures do not create substitute recommendations.
An UNKNOWN provider creation must be reconciled, not retried as a new purchase.
If 3006 is in use, stop your own earlier local instance. Do not expose the dev
server publicly. No judge credentials or provider keys are supplied in source.
