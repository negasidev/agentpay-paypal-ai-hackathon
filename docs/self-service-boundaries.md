# Sandbox self-service and evidence access

Users create an account, receive a single-use email verification link, sign in,
and create an isolated Sandbox workspace. Signup requires no administrator.
The link fills the verification code automatically; users confirm verification
before signing in. Email verification does not authorize a purchase.

Approval notifications link to the exact purchase through sign-in. Opening a
notification grants no authority. Ownership and approver eligibility are checked
on the server. Browser software-key approval is not hardware attestation, and
PayPal buyer consent remains a separate provider step.

The shared judge account can inspect its saved recommendations, transactions,
existing provider orders and stateless term comparisons. It cannot create a
workspace, request model generation, create orders or approve payments. An
ineligible approver receives an explicit read-only status for an owned purchase;
foreign purchases remain unavailable. Inspection never grants payment authority.

If PayPal returns 404 for an existing recorded order, the application reports
`RECORDED_PROVIDER_ORDER_UNAVAILABLE`. It does not replace that order silently.
A user can prepare a fresh purchase in their own workspace. Unexpected storage
or service failures remain service failures rather than misleading missing-item
responses. No payment success is inferred from a stored order or an email.

These changes require deployed verification before publication. Local tests do
not establish buyer consent, capture, hardware approval or production readiness.
