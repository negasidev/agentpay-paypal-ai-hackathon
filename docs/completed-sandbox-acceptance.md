# Completed Sandbox payment acceptance - 12 November 2026

The deployed application completed one 119.00 USD PayPal Sandbox purchase from
the real catalog-backed AI recommendation. Existing genuine PayPal buyer consent
was independently retrieved and verified against the stored order and its exact
merchant, amount and currency. The test then created a fresh session-bound
software-key approval, refused altered amount and merchant requests, captured the
approved amount once and independently retrieved the completed order from PayPal.

Exactly one matching provider capture was observed. The receipt matched its
capture ID, order, amount, currency, merchant and signed purchase. Reusing the
approval returned `SANDBOX_EXECUTION_ALREADY_RESERVED`. A new application login
retrieved the same provider-verified receipt without a new dispatch.

## Assurance boundary

Buyer consent was genuine and provider verified. The purchase approval used an
automated acceptance software key, not independent proof of a human approving
the purchase in the application. The receipt explicitly declares software
assurance and `hardwareAttested: false`. This does not establish hardware-backed
approval, canonical external authorization, production payment readiness or
protection against every prompt injection.

The isolated browser Sandbox execution gate is enabled on the hosted hackathon.
Canonical protected capture remains disabled; all PayPal transport remains pinned
to Sandbox. Shared judge access remains read-only. Other users must create and
verify their own workspace and satisfy exact-term approval and buyer consent.
Source-download defaults retain capture disabled until separately configured.

## Presentation requirements

The software receipt can be shown as verified only when fresh backend evidence
matches the exact owned purchase, provider order, signed terms and currency.
Uncertain, mismatched or unavailable readback must not show payment completion.
The canonical receipt verifier remains separate and unchanged.

The earlier 94-second video records order creation and refusal only. It is not
evidence of this completed capture. Update footage before presenting it as the
completed flow. Account identifiers, provider credentials, cookies and raw
operational records must remain outside the public repository and video.
