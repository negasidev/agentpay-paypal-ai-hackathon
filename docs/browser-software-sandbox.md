# Browser software-key Sandbox approval

This opt-in design is under acceptance review. The public release and video do not establish a successful payment using this mode.

This is an explicit alternative policy for the isolated hackathon edition, not a fallback when 2AYE authority is unavailable. It does not modify the platform evaluator or create a platform grant. It creates a separate short-lived browser approval, labelled `software` throughout. Password confirmation plus a software signature is not hardware attestation or a claim of multi-factor authentication.

## Approval and execution

1. An authenticated, explicitly configured evaluation principal reviews a catalog purchase.
2. The server confirms that same principal's password using the durable login lockout counters. It prepares or retrieves the bound PayPal Sandbox order.
3. A browser-generated P-256 software key signs a server-created statement. Its private key is non-exportable and kept in page memory. The statement binds the origin, nonce, principal, tenant, purchase/version, exact decimal amount, currency, merchant, provider order and expiry.
4. The server verifies the signature and consumes the challenge once. The challenge expires after two minutes; approved authority expires five minutes after challenge creation. Reloading loses an unsigned browser key and requires another fresh ceremony.
5. PayPal buyer consent is a separate provider-verified event. The application does not approve on the buyer's behalf.
6. Capture rechecks the approval, current terms and real provider order. Approval consumption, a unique execution reservation and purchase transition commit together. Only the first reservation may dispatch one stable PayPal request identity.
7. An uncertain response never dispatches a second capture. Reconciliation retrieves the original provider order and confirms exact capture fields. A receipt is displayed as paid only while that provider evidence and software approval match.

Approvals can be revoked before consumption. New amount fields on the capture request are refused; changed stored terms invalidate the binding. A repeated capture request is refused and the original receipt remains inspectable. These controls require fixture, deployed and real-human acceptance evidence before release claims are expanded.

## Configuration

All values are server-side. Keep the canonical capture flag false.

```text
AGENTPAY_APPROVAL_MODE=sandbox-browser-software
AGENTPAY_EDITION=hackathon
PAYPAL_ENVIRONMENT=sandbox
AGENTPAY_PROTECTED_CAPTURE_ENABLED=false
AGENTPAY_BROWSER_SANDBOX_APPROVER_ID=<dedicated evaluation user UUID>
AGENTPAY_BROWSER_SANDBOX_TENANT_ID=<that user's tenant UUID>
AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT=150.00
AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED=false
```

Capture remains disabled until this exact profile passes acceptance. The deployed origin must be the isolated hackathon host. Local tests use an explicit loopback origin. No production PayPal endpoint, personal account, hardware-assurance classification or production authority is enabled by this profile.
