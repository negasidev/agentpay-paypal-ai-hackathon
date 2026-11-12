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
Sandbox page. Genuine buyer consent, a single exact 119.00 USD capture, current provider readback, a matching software receipt and repeat-payment refusal subsequently passed. The acceptance purchase approval was automated; it does not independently prove human presence. No real goods or live money are
supported. Software signatures do not independently prove human presence.

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

### Next steps

Record the completed Sandbox flow and expand
beyond the three-product evaluation catalog. We do not claim production readiness,
customer adoption, AP2 compliance or protection against every prompt injection.

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
| 2:10-2:30 | Open genuine PayPal Sandbox checkout and transaction evidence. Show the completed 119.00 USD capture, matching software receipt and repeat-payment refusal. Explain that the acceptance software approval was automated; do not imply hardware or independent human-presence proof. |
| 2:30-2:50 | Show Claude + catalog tools, strict server validation, PayPal Orders v2, and durable approval/evidence. "The recommendation can change. Payment authority cannot silently change with it." |

## Replacement only after completed payment acceptance

Do not publish completed-payment language before observing real buyer consent,
one exact capture, current PayPal readback, matching receipt and repeat-payment
refusal. Keep the canonical protected-capture flag off for this isolated edition;
its browser software approval has a separate Sandbox execution gate. A flag is
not approval. Never bypass a missing consent, session or exact-term check.

After those checks pass, replace the 1:15-2:30 sequence with the exact approval,
altered-amount refusal, genuine PayPal buyer checkout, successful original-amount
capture, reconciled receipt and replay refusal. Show a PayPal dashboard capture
only if it was actually observed. Record under three minutes and remove secrets,
inbox addresses, session tokens and unrelated dashboard data from footage.
