# Bundled authorization SDK

This dependency-free JavaScript client provides authorization envelopes, grant verification and guarded execution helpers. AgentPay installs it from `vendor/agent-sdk`; no sibling repository or package registry publication is required.

```sh
npm install ./vendor/agent-sdk
```

The `@verid/agent-sdk` package name and exported `Verid*` identifiers are protocol compatibility names. Preserve them when changing presentation copy. Runtime implementations and TypeScript declarations are in `src/`.

Model proposals never grant permission. Callers must validate exact parameters, issuer signatures, audience, expiry and single-use redemption at the protected resource. Missing configuration must fail closed. Optional external service integrations do not become available merely because the client exposes methods for them.

This bundled SDK is Apache-2.0 licensed; see the repository LICENSE. Synthetic tests and fixtures are not live credentials or evidence of independent hardware assurance.
