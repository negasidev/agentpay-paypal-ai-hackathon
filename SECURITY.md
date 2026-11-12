# Security

This edition is for isolated PayPal Sandbox evaluation. It is not a production payment service. Capture is disabled; an AI recommendation, reviewed purchase or created order does not establish payment authority.

Provider credentials remain server-side. Database access, sessions, request origin and transaction ownership are enforced by the backend. Use dedicated evaluation credentials and never connect regression tests to customer data.

Do not place secrets, personal information or exploitable vulnerability details in public issues. If the repository has private vulnerability reporting enabled, use its Security tab to report privately. Otherwise arrange a private reporting channel with the maintainer before sharing sensitive details.

Include the affected revision, reproduction steps and observed impact. Do not test against third-party accounts, production services or live payments.
