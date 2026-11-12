ï»¿# Verification status - 12 November 2026

**Hosted status: signup, workspace, owned evidence and fresh Sandbox order readback verified; one exact Sandbox capture and reconciled software receipt verified.**

This sanitized handoff contains no operational credentials or account identities.
Deployed acceptance passed as described below. This release includes the signup,
software approval, payment and receipt source alongside the public copy updates.
The maintainer authorized source publication and deployment on November 12.

| Scope | Observed result |
| --- | --- |
| Local regression | 151 PostgreSQL tests passed, zero failed or skipped on a fresh disposable database |
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

A native owner-login check displayed the completed private receipt. It exposed a
repeat-protection control with no historical approval ID after a new login. The
status response now retains the consumed approval as history; regression proves
that the new session still cannot dispatch another capture.

The final native Chrome check passed: owner sign-in, private receipt hydration,
consumed approval after reload, verified buyer consent, confirmed 119.00 USD
Sandbox capture and visible repeat-payment refusal. No password-manager save or
replacement was accepted. Browser-review delivery is complete; the new video,
Devpost submission has not been performed. Source publication and deployment
were subsequently authorized for this release.

## Signed-in journey follow-up

The approval, checkout and evidence pages now retain a selected purchase in their
links. A foreign or missing selection shows no substitute purchase. Read-only
accounts are directed to saved results and receive no editing controls. Order
verification refreshes checkout and approval availability; PayPal consent refreshes
the payment controls. Completed purchases retain their receipt and repeat-payment
check. Opening approval controls no longer sends a notification automatically;
email is an explicit action. These interface changes do not alter server-side
purchase ownership, approval verification or single-use capture enforcement.

The original payment acceptance above remains dated evidence. Fresh release
checks must distinguish recovered completed receipts from newly captured payments.

### Fresh hosted journey verification

A fresh browser journey on November 12 passed real Claude recommendation,
purchase-specific review and submission, new PayPal Sandbox order creation and
readback, password-confirmed software-key purchase approval, and altered-amount
refusal without provider dispatch. The buyer signed into PayPal Sandbox and
consent was provider verified. An approval that expired during the ceremony kept
payment blocked; a fresh exact-purchase approval was required.

The approved 119.00 USD payment then completed. The evidence page rendered its
verified receipt and consumed approval. Independent PayPal readback confirmed
exactly one matching capture on that order. A new application login recovered
the same receipt; repeat payment returned 409. This was a fresh capture, separate
from the earlier acceptance payment. Purchase approval in this test was automated
through the browser software key; no human-presence or hardware proof is claimed.

The consent callback exposed a duplicate checkout panel caused by remounting the
active PayPal widget while refreshing approval status. The final repair keeps
those refreshes separate; the final deployed checkout rendered one buyer panel.
Both repair revisions passed the complete CI suite: 151 application, 66 SDK and
four publication tests, with no failures or skips, plus lint, typecheck and build.
Shared judge write refusal and cross-account evidence isolation remained intact.
The earlier linked video still does not show this completed-payment journey.
