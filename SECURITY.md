# Security

This application is for isolated PayPal Sandbox evaluation. It is not a production
payment service. The hosted browser-approval Sandbox flow can capture only after
current purchase-specific approval and independently verified PayPal buyer consent.
Source downloads keep capture disabled by default. The separate canonical protected
capture path remains disabled for this edition. An AI recommendation, reviewed
purchase or created order alone never grants payment authority.

Provider credentials remain server-side. The backend enforces sessions, request
origin, tenant/user ownership, exact purchase terms, short-lived approval and
single-use execution. Unknown provider outcomes require reconciliation of the
existing attempt. See [architecture](docs/architecture.md),
[approval boundaries](docs/browser-software-sandbox.md) and
[verification status](docs/verification-status.md) for the tested scope and limits.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/negasidev/agentpay-paypal-ai-hackathon/security/advisories/new).
Private vulnerability reporting is enabled for this repository. Do not put secrets,
personal information or exploitable details into public issues. Include the
affected revision, reproduction steps and observed impact. Redact session cookies,
provider tokens, passwords and account data from attachments.

Use dedicated evaluation credentials. Never connect regression tests to customer
data or test another person's account, production service or live payments.
This project has no independently completed security audit, certification or
production payment approval. Reported controls and passing tests do not establish
those assurances.
