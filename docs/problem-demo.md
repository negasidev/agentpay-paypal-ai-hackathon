# Problem demonstration

Entry: `/demo` or `/assistant`, with authentication required. `/judge` redirects
to `/demo`. A saved proposal is labeled and reused; generating a
fresh proposal is an explicit model request, never a page-load action. Check
[verification status](verification-status.md) before describing the hosted flow.

Problem: find an ergonomic wireless keyboard within a $150 budget without turning an AI suggestion into permission to spend.

1. Generate a catalog-validated AI proposal, or inspect the latest saved proposal.
2. Review this purchase's exact merchant, amount and currency. Confirm review, then explicitly submit for authorization.
3. Compare two paths on the same purchase. Path A prepares/retrieves its real PayPal Sandbox order and checks independent authority. Path B asks the backend to inspect a tenfold amount change and displays its actual response.

Outcome: useful order preparation and a visible refusal when authority or binding is missing. A backend mismatch inspection is not a signed-grant evaluation. Order creation is not capture. Buyer consent, canonical signed-device approval and permitted capture remain separate acceptance gates. No payment success claim is made.

The scenario reuses the existing actor-scoped endpoints, authorization component and protected-capture checks; it introduces no additional evaluator, approval shortcut or payment execution endpoint. It does not auto-call a model, create an order or submit an approval on page load.
