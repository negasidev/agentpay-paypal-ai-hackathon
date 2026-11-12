# Architecture and trust boundaries

This repository owns the hackathon interface, catalog agent, PayPal Sandbox
transport, evaluation database, scoped sessions and bundled protocol client.
Install, build and test it from this checkout alone.

The supported independent path is:

1. Provision a local evaluation account in a disposable database.
2. Sign in through an HttpOnly session cookie. Every data operation checks the
   authenticated user and tenant; browser mutation requests require the configured
   application origin.
3. A real model uses read-only catalog tools. Strict schema and deterministic
   budget/catalog checks turn the response into a DRAFT, never execution authority.
4. The user reviews exact stored terms and submits for authorization. This records
   review, not a device signature or a verified payment approval.
5. The server creates and retrieves a real PayPal sandbox order from those terms.
   Amount, currency, merchant, order identity and version are checked. A repeat
   retrieves the same stored order. An uncertain creation is not blindly repeated.
6. The optional canonical authority adapter requires an explicitly configured
   evaluation tenant, principal, agent, intent and scoped credential. Absence or
   failure refuses canonical protected execution. The separate browser Sandbox
   flow verifies a password-confirmed purchase signature, current session and
   approver permission, expiry, exact terms and PayPal buyer consent before
   atomically consuming approval and reserving one capture. Environment flags
   alone grant no authority in either path.
7. The UI shows stored audit events and actual provider order states. CREATED,
   buyer approval, canonical authorization and capture are distinct facts.

PayPal access is pinned to the sandbox origin. Provider secrets and model keys
remain server-side. SDK fixtures are synthetic and not production keys. Optional
external authorization interfaces are not needed for AI generation, sandbox
order verification, persistence or refusal tests.

The complete signed-device/buyer-approved capture path has not been accepted.
The isolated browser software-approval flow has separate [completed Sandbox acceptance](completed-sandbox-acceptance.md). Canonical protected capture remains disabled. This edition does not claim independent hardware
attestation, signed receiver conformance, real goods or production payment support.

The application retains backend modules needed for schema and security
compatibility. Their presence does not establish an additional supported product,
provider integration or accepted deployed workflow.

## Service boundary

The optional authorization integration calls a configured HTTPS API through
`src/server/authorization/twoaye.mjs` and `vendor/agent-sdk`. Those files are a
client adapter and public protocol implementation. Authority evaluation, signing
keys, operator configuration and service implementation stay outside this
application. Access tokens are server-only configuration supplied by the operator.
No dependency, import, build step or test may read another checkout.

The public demo has its own sessions and database. It cannot reuse another
application's browser session or database. Missing approval in the selected
authorization path keeps execution blocked. The local sandbox workflow is runnable independently; connecting an
external authorization service requires separately provisioned sandbox access.

Run `npm run check:public`, `npm run test:boundary` and `npm run test:sdk` before
release. The public-source audit checks tracked and unignored files, known secret
formats, workstation paths and literal source/package dependencies. It also runs
against exported source during packaging. It is a release guard, not proof that
every possible secret or dynamically constructed reference has been detected.
