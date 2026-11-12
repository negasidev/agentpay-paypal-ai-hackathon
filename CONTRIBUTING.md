# Contributing

Start with [the developer guide](docs/developer-guide.md), [verification status](docs/verification-status.md)
and [release policy](docs/release-policy.md). Use Node 24 and a disposable PostgreSQL 17 database.
Keep credentials in ignored local environment files.

Before proposing a change, run lint, type checking, integration tests and a production build. Describe the problem, resulting behavior, checks performed and remaining limitations. Security changes need a test for the rejected bypass, not only a successful request.

Keep changes focused. Preserve deterministic authorization, transaction binding and actor isolation. Do not include generated build output, internal operational reports, real account records or provider credentials. Update documentation without claiming acceptance that has not occurred.
