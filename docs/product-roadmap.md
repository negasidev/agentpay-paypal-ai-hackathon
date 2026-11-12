# Product roadmap: approval for purchases proposed by any agent

Status: planned direction. This document does not expand the implemented or
verified scope in [acceptance status](verification-status.md). No roadmap feature
is being added to the deadline submission.

## Problem and audience

Small-business owners and office managers want to delegate supply shopping to
the AI assistants they already use, while controlling what can actually be paid.
AgentPay's intended boundary is exact purchase authority at payment time. The
three-product catalog is a controlled evaluation surface, not a universal shop
or evidence of a live marketplace integration.

## Prioritized milestones and evidence required

| Priority | Planned capability | Evidence required before claiming it works |
| --- | --- | --- |
| 1 | Approval API, SDK and MCP tools for existing agents | An independently configured agent proposes a structured cart, receives scoped approval state, and completes the protected flow; foreign actors, changed terms and replay fail |
| 2 | Phone approval with device-backed signing and biometric confirmation | Deployed browser-to-phone-to-payment tests bind the exact cart, identity, key, expiry and permission; assurance and attestation limits are documented |
| 3 | Human-authorized per-agent budgets and merchant policies | Concurrent requests respect cumulative limits; delegation cannot widen authority; missing accounting fails closed; larger purchases escalate |
| 4 | Refunds, disputes and receipt lifecycle | Correct original capture binding, permitted amounts, idempotency, reconciliation and evidence retention across provider failures |
| 5 | Team approvers, spending reports and accounting exports | Tenant isolation, threshold enforcement, revocation, report reconciliation and independently tested accounting integration |
| 6 | Simpler user onboarding and agent connection | Tested identity linking, consent and recovery; user signup requires no database setup or provider API keys; developer setup remains explicit |
| 7 | Live-mode readiness | Applicable provider requirements, independent security review, privacy/retention policy, accessibility, recovery and responsibility terms are resolved and verified |

Potential adapters include MCP-enabled assistants and a PayPal toolkit where
its supported interfaces fit. No ChatGPT, Claude, PayPal toolkit, accounting or
mobile integration is claimed available merely because it appears in this plan.
Compatibility with AP2 or another standard requires its own conformance work.

## Authority boundaries to preserve

- An agent proposal and a model recommendation never grant spending authority.
- Approval must bind exact material terms. A new amount, merchant, item or other
  material change requires appropriate new authority.
- Policy-authorized purchases use previously human-authorized deterministic
  constraints. "Automatic approval" must not mean that a model can override a
  denial or create its own permission.
- Purchase authority and PayPal buyer consent remain separate. AgentPay checks
  authority before requesting capture; PayPal is not claimed to independently
  verify an AgentPay approval signature.
- Provider keys remain server-side. Uncertain outcomes reconcile the original
  execution rather than create another payment.
- Receipts support technical audit and investigation. They are not independent
  proof of human understanding or a promise about legal dispute outcomes.

## Submission boundary

Today's verified result is one exact Sandbox payment with genuine buyer consent,
automated software-key purchase approval, provider readback, receipt recovery,
and amount/merchant/replay refusals. It is not production payment acceptance or
hardware-attested human approval. New video footage must preserve that boundary.
Use the roadmap in the Devpost "What's next" section and the last twenty seconds
of the [video script](submission-package.md); do not present planned screens as
implemented functionality.
