# Submission text and recording plan

## Title and tagline

AgentPay: An AI draft is not an approval.

AI recommends supplies. Approval stays bound to the exact purchase.

## Devpost description: verified-scope version

### Inspiration

Small-business owners and office managers want help finding supplies, without
giving a buying agent unrestricted payment access. A malicious listing, an
invented merchant or a changed price can steer a useful recommendation into the
wrong payment. We focus on the gap between what someone approved and what an
agent subsequently asks to pay.

### What it does

AgentPay recommends an evaluation-catalog item within a budget and preserves its
exact merchant, amount and currency. The owner reviews those terms, and the
server prepares a real PayPal Sandbox order. A verified workspace owner can
confirm their password and sign a purchase-specific software-key approval.
An altered-amount request sent after approval is refused on the capture endpoint,
without asking PayPal to capture. Ownership, session, expiry and exact terms are
checked on the server; a model response never grants spending authority.

The hosted build demonstrates registration, actual verification-email delivery,
isolated workspaces, real AI recommendations, PayPal order creation and readback,
software-key approval, refusal and revocation. Buyer checkout opens PayPal's real
Sandbox page. Genuine buyer consent, one exact 119.00 USD capture, current
provider readback, a matching software receipt and repeat-payment refusal passed.
The acceptance purchase approval was automated; it does not independently prove
human presence. No real goods or live money are supported.

### How we built it

Claude uses read-only catalog tools through the Vercel AI SDK and returns a
strict structured proposal. Deterministic server checks enforce catalog prices,
quantities and budget. PayPal Orders v2 supplies real Sandbox orders and provider
readback; PayPal JavaScript checkout handles the separate buyer consent step.
Next.js serves the UI and API. PostgreSQL persists scoped purchases, approval
statements, idempotency identities and evidence. Capture code reserves a unique
execution and consumes approval atomically; uncertain outcomes are reconciled
against the original order rather than dispatched again.

### What changed during the hackathon

Since 1 October, this edition adds the catalog-backed AI purchasing experience,
PayPal Sandbox order and buyer checkout integration, exact-term review,
purchase-scoped software approval, self-service verified workspaces, notification
delivery, transaction evidence, and adversarial refusal demonstrations. It is a
standalone application with its own source, migrations, setup, tests and license.
It does not require another repository to run the documented order/refusal flow.

### Challenges and lessons

Order creation, purchase approval, PayPal buyer consent and capture are different
facts. Treating any one as the others creates misleading success claims. We
fixed a real read-only evidence defect without granting the judge write access,
and distinguish unavailable historical orders from new provider results.

### What's next

AgentPay should become the approval layer an existing AI agent can call, rather
than require people to use our shopping interface. Agents propose purchases;
AgentPay checks their exact terms and authority before asking PayPal to capture.
Our first audience is small-business owners and office managers delegating supply
purchases. The three-product catalog is a controlled demonstration, not the
intended product boundary.

Our planned milestones, in order, are:

1. A documented approval API, SDK and MCP tools for existing assistants and
   business agents to request approval for a structured cart. External agent
   output remains untrusted; integrations cannot create their own authority.
2. Phone notifications with exact merchant, items, amount and currency, followed
   by device-backed signing and biometric confirmation. This needs integration
   and deployed verification; the current demo uses software keys.
3. Human-authorized spending policies with per-agent budgets and merchant limits.
   Deterministic policy can permit small purchases within that authority and
   escalate larger purchases, reducing approval fatigue without allowing a model
   to override a denial.
4. Refund and dispute workflows that retain approval, provider and receipt
   records to support investigation. A technical receipt is not a guarantee of
   legal liability allocation or dispute resolution.
5. Team roles, amount-based approver limits, spending reports and accounting
   exports, followed by evaluated integrations such as QuickBooks or Xero.
6. Simpler onboarding, including an evaluated PayPal sign-in integration and
   agent connection flow. Ordinary users should configure neither databases nor
   provider API keys; developers receive clear integration documentation.

We will keep the service Sandbox-only while provider requirements, security and
privacy review, retention, accessibility, recovery and responsibility terms are
resolved. These are planned capabilities, not implemented integrations or partner
endorsements. We do not claim production readiness, customer adoption, AP2
compliance or protection against every prompt injection. See the
[product roadmap](product-roadmap.md).

## Judge testing instructions

1. Start at https://hackathon.agentpay.twoaye.com/hackathon.
2. Use the shared judge login supplied privately in Devpost testing instructions.
   Inspect its saved recommendation, transaction evidence and changed-term refusal.
   This account is read-only; historical provider orders may be unavailable, which
   the UI explains. It cannot generate, approve or pay.
3. For a fresh case, create your own account, verify the email, sign in and create
   your isolated Sandbox workspace. No administrator is needed. Real model quotas
   and email abuse limits apply.
4. Generate a catalog recommendation, review its exact terms, submit, and create
   its Sandbox order. Confirm your AgentPay password, review the server-created
   statement and approve. Test the approved-amount protection, then revoke if you
   do not continue. The altered-amount request must be refused without dispatch.
5. PayPal buyer checkout uses a separate Sandbox Personal buyer login. Never use
   a real payment account. The isolated browser Sandbox capture gate is enabled on the hosted release. Email verification and opening notifications do not approve payment.

Supply actual judge credentials in the private submission field, not this public
file. Keep access available through judging. Do not publish API secrets.

## Video script: current verified flow (2 minutes 50 seconds)

| Time | Picture and narration |
| --- | --- |
| 0:00-0:20 | Show the headline. "An office manager wants an AI agent to find supplies, but a changed price or merchant must not become permission to spend. An AI draft is not an approval." |
| 0:20-0:50 | Show the real saved or freshly generated Claude recommendation, the $150 budget, $119 exact purchase and merchant. Label a saved recommendation honestly. |
| 0:50-1:15 | Review and submit; create/re-read the real PayPal Sandbox order. Explain that CREATED is not paid. |
| 1:15-1:45 | In an owned verified workspace, confirm the password, review exact terms and approve. Explain browser software-key assurance briefly. |
| 1:45-2:10 | Click Test approved amount protection. Show the altered $1,190 request, specific refusal, and no capture attempt. Call this a simulated compromised-client request; do not call it a live prompt-injection exploit. |
| 2:10-2:20 | Show the completed 119.00 USD capture, matching software receipt and repeat-payment refusal. Label the acceptance software approval as automated; do not imply hardware or independent human-presence proof. |
| 2:20-2:30 | Show Claude + catalog tools, strict server validation, PayPal Orders v2, and durable approval/evidence. |
| 2:30-2:50 | Label the screen "Planned roadmap." Say: "Next, connect the agents people already use. Add phone approvals with device-backed signing, spending rules for small purchases, and team workflows. Keep exact purchase approval and verifiable receipts at the center. AgentPay checks authority before it asks PayPal to capture." |

## Recording and publication requirements

Do not publish completed-payment language before observing real buyer consent,
one exact capture, current PayPal readback, matching receipt and repeat-payment
refusal. Keep the canonical protected-capture flag off for this isolated edition;
its browser software approval has a separate Sandbox execution gate. A flag is
not approval. Never bypass a missing consent, session or exact-term check.

Those checks passed in the automated software-approval acceptance. Record the 1:15-2:30 sequence with the exact approval,
altered-amount refusal, genuine PayPal buyer checkout, successful original-amount
capture, reconciled receipt and replay refusal. Show a PayPal dashboard capture
only if it was actually observed. Record under three minutes and remove secrets,
inbox addresses, session tokens and unrelated dashboard data from footage.
