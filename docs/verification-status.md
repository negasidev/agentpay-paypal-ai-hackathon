# Verification status - 12 November 2026

**Hosted status: signup, workspace, owned evidence and fresh Sandbox order readback verified; one exact Sandbox capture and reconciled software receipt verified.**

This sanitized handoff contains no operational credentials or account identities.
Changes are held locally pending deployed acceptance; public main does not yet
contain the deployed application changes.

| Scope | Observed result |
| --- | --- |
| Local regression | 150 PostgreSQL tests passed, zero failed or skipped on a fresh disposable database |
| Bundled SDK | 66 tests passed, zero failed or skipped |
| Publication rejection controls | Four tests passed |
| Lint, typecheck and production build | Passed |
| Registration email | Actual delivery to an application-owned acceptance inbox verified |
| Email verification | Accepted once; replay refused |
| Verified login and workspace | Passed without administrator intervention |
| Fresh recommendation and PayPal order | Real model request, Sandbox creation and exact provider readback passed |
| Purchase review email | Delivery and exact purchase sign-in link verified |
| Judge owned transaction | HTTP 200 with explicit read-only approval status |
| Judge abuse paths | Foreign ownership, writes, model requests, approval challenges, workspace escalation and cross-origin mutations refused |
| Changed terms | Stateless inspection returned 409 without payment dispatch |
| Browser approval | Automated software-key signature accepted for the acceptance owner; no human-presence or hardware-attestation proof |
| Post-approval tampering | Altered amount and merchant requests specifically refused with no provider dispatch; test approval revoked |
| Buyer consent, capture and linked receipt | Genuine consent, one 119.00 USD capture, matching provider readback and software receipt verified; repeat payment refused |

The previous transaction 404 came from an approver-membership check inside owned
read-only evidence retrieval. The repair preserves ownership and write guards.
Service failures return generic 503 responses rather than missing-item responses.

PayPal returns 404 for the historical judge orders. The application explains their
unavailability and never silently creates replacements. Fresh purchases belong
in the user's own Sandbox workspace.

Browser acceptance found and repaired the post-login return to workspace setup.
Unexpected capture terms are validated before the disabled execution gate, so a
closed gate cannot masquerade as proof of parameter binding.

Repeated local runs exhausted the disposable database's email quota. A fresh
database restored a clean regression run; no rate-limit control was weakened.
Numbers describe this dated cycle and require new evidence after changes.

The revised public problem framing passed 18 staged judge API checks and 13
public browser checks, including consistent headlines, signup continuation,
owned evidence, both post-approval tampering requests and mobile layout. The
publication scan checked 438 source inputs without findings. The prepared
[submission text and video script](submission-package.md) preserve these limits.

See [self-service boundaries](self-service-boundaries.md),
[official rule review](hackathon-rule-review.md), and the
[machine-readable index](../AI_CONTEXT.json). See [completed Sandbox acceptance](completed-sandbox-acceptance.md) for the later payment result. No production-payment, physical approval or customer-adoption claim follows from these results.
