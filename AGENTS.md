# Coding-agent guide

Read README.md, AI_CONTEXT.json, docs/developer-guide.md, docs/architecture.md,
docs/release-policy.md and docs/verification-status.md before editing.

Current acceptance boundary: hosted self-service signup, owned transaction
evidence and fresh Sandbox order readback are verified. Buyer consent, capture
and a provider-verified receipt remain unverified. See the dated status document;
do not describe a completed payment because local tests pass.

## Boundaries

- This is a standalone sandbox application. Do not assume access to another checkout, private service or production account.
- Model output is untrusted input, never payment authority. Deterministic validation and backend authorization remain mandatory.
- Preserve tenant/user isolation, same-origin mutation checks, exact transaction binding, expiry, single-use grants and replay refusal.
- Money crosses protocol boundaries as decimal strings; spelling and scale can affect signed hashes. Do not rename protocol fields or SDK symbols for presentation.
- Human review, signed approval, buyer consent, order creation and capture are distinct facts. Never fabricate evidence or enable capture to make a demonstration pass.
- Missing configuration and provider/storage failures must fail closed. Do not introduce mock provider success or weaken quota/security tests.
- Keep credentials, private endpoints, workstation paths and operational reports out of source. Environment examples must contain placeholders only.
- Maintain this repository independently. Integrate external services through configured APIs; never copy their repositories, history, configuration or operational evidence into a release.
- Keep documentation links inside this checkout or point to intentionally public sources. Raw deployment logs, cookies and private diagnostic files must stay outside public source.
- Apply enterprise engineering controls as described in docs/developer-guide.md. This is not a production-readiness or certification claim.

## Commands and navigation

Use npm ci, npm run lint, npm run typecheck, npm test and npm run build. Integration tests require a migrated disposable PostgreSQL database in DATABASE_URL. See docs/judge-setup.md. No model keys are needed for fixture-based regression; live provider verification is separate.

Before release, also run npm run check:public, npm run test:boundary and npm run test:sdk. Preserve the bundled conformance vectors so SDK checks work in a downloaded archive. Keep reports with private operational details outside public source.

Add rejection coverage when changing enforcement. Report actual results and limitations; a local test is not hosted, physical-device or payment acceptance. Update public setup and architecture docs when behavior changes. Preserve license notices and third-party attribution.
