# Self-service Sandbox approval

The hosted flow now has [completed Sandbox acceptance](completed-sandbox-acceptance.md) with genuine buyer consent and an automated software-key purchase approval. It is not production external authorization. Fixture tests alone do not establish payment completion, human presence or inbox delivery.

## User journey

1. A tester enters their own full name, email and password at `/register`.
2. A one-time verification email goes to that address. The account is created only after successful verification. Email verification grants no workspace or payment authority.
3. The tester signs in and explicitly creates an isolated Sandbox workspace. The verified owner becomes its initial approver, limited to that workspace and its own purchases. No predetermined human email or name is required.
4. The AI proposes a catalog purchase. The user reviews the purchase, merchant, exact amount and currency. The owner can explicitly send a review notification from the approval view; opening a page sends no notification.
5. The notification opens sign-in and review. Opening an email never approves or pays. The approver confirms their password, reviews server-created terms and explicitly approves.
6. PayPal buyer consent is independently verified. Capture requires the current software approval, unchanged terms and buyer consent. Source downloads keep capture separately disabled; the hosted accepted Sandbox release enables it within the documented limits.
7. A provider-confirmed result and matching software approval produce readable evidence. Unknown outcomes require read-only reconciliation, never another capture dispatch.

The shared judge account remains read-only in self-service mode. It cannot create a workspace, spend model quota, create an order, approve or capture. Separate-approver invitations and enterprise role administration are deferred; the initial owner is the designated approver for this scoped demonstration.

## Software-key boundary

A browser-generated non-exportable P-256 key signs a fresh server challenge. The public key is enrolled only for that password-confirmed session and purchase. The statement binds the session hash, server-verified approver profile and permission generation, origin, tenant, purchase/version, item, quantity, exact decimal amount, currency, merchant and PayPal order. The server verifies the raw P-256 signature against that stored public key.

This proves key possession and transaction binding, not independent human presence or understanding. It is not hardware attestation, multi-factor authentication or equivalent to production authenticator-backed 2AYE approval. Production authorization behavior and its canonical grant path are unchanged.

Challenge expiry is two minutes; approved authority expires five minutes after challenge issuance. Logout, session expiry, lockout, credential change, permission revocation, new permission generation, rejection or changed transaction terms prevent unused approval from authorizing capture. Permission and session locks serialize revocation/logout with capture reservation: revocation before reservation denies; it cannot undo an already dispatched provider payment.

Approval consumption and a unique execution reservation commit together in PostgreSQL. Each reservation has one durable PayPal idempotency identity. Uncertain responses never dispatch again. A fresh process can retrieve the original order and reconcile an exact single completed capture. A receipt is labelled paid only when current provider read-back matches the approval and transaction.

## Email and abuse controls

The sender is configured on the server; recipients are the registering tester and verified workspace owner, never a fixed central recipient. SMTP requires TLS and certificate validation. Message subjects are fixed, content is plain text, and files/URL attachments are disabled. Optional exact-recipient restrictions support operator acceptance.

Verification tokens are 256-bit random values; only their hashes persist. Links carry the secret in a URL fragment, which the page removes before explicit verification. They expire after 15 minutes, are single-use and have a five-failed-attempt ceiling. The API never returns a verification secret or password.

Durable admission limits registration to one email/minute/address, three/hour/address and 50/day overall. Approval notifications are idempotent for ordinary retries, have explicit resend controls, a per-user cooldown, a three/hour/purchase ceiling and a 50/day global ceiling. These limits are operating constraints, not proof of unrestricted judge access.

SMTP success is `SUBMITTED`, not proof of inbox delivery. Failures and expired links remain visible; a crash or missing configuration never grants authority. Actual receipt in an operator-controlled inbox must be observed before claiming real notification delivery.

## Server configuration

```text
AGENTPAY_APPROVAL_MODE=sandbox-browser-software
AGENTPAY_EDITION=hackathon
PAYPAL_ENVIRONMENT=sandbox
AGENTPAY_PROTECTED_CAPTURE_ENABLED=false
AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE=true
AGENTPAY_SANDBOX_REGISTRATION_ENABLED=true
AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT=150.00
AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED=false
AGENTPAY_EMAIL_PROFILE=isolated-sandbox
AGENTPAY_SANDBOX_SMTP_USER=<sender mailbox>
AGENTPAY_SANDBOX_SMTP_PASSWORD=<private sender credential>
AGENTPAY_EMAIL_ALLOWED_RECIPIENTS=<optional exact addresses during acceptance>
```

The deployed origin must be the isolated hackathon host. Loopback is allowed only in development/test; a production standalone build correctly refuses it. SMTP transport is pinned to Hostinger STARTTLS on port 587. Keep secrets outside public source, browser bundles and build context. Reusing an existing sender requires operator authorization; no existing production mail settings are changed automatically.

The repository requires only its included source, migrations, dependencies and configured providers. Independent real-email receipt, genuine user approval, PayPal buyer consent, exact capture and subsequent replay refusal remain release acceptance gates. Keep each release claim scoped to its actual evidence and obtain explicit release authorization. The completed acceptance above does not establish human-presence or hardware assurance.
