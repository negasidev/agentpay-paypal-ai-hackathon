# Public source and release policy

Every public source archive must install, build and run its documented scenario
without another repository. Maintain changes in this repository and preserve its
own Git history and license notices.

## Allowed inputs

Repository-owned source and documentation, published dependencies, the bundled
protocol client, synthetic fixtures, original/licensed assets and empty credential
templates are release inputs. Documented localhost commands allow a reader to run
their own evaluation. Public protocol names and public provider URLs are allowed.

## Excluded inputs

Do not publish workstation paths, outside-checkout imports or documentation links,
SSH-only package dependencies, private service endpoints, operator runbooks,
populated environment files, account records, customer identifiers, database dumps,
logs, browser storage/cookies, signing keys, provider secrets or deployment metadata.
Keep diagnostic evidence in an access-controlled operator location outside source.
Private filenames alone are not adequate protection: check the committed files and
the exported archive, not only the working directory's ignore rules.

Credential fields in environment examples must be empty. The documented local
database example uses an explicitly synthetic loopback password; remote database
credentials do not belong in a template. Documentation and AI entrypoint links
must resolve inside the source download or to an intentionally public website.

Licenses, public protocol identifiers and signed fixtures must retain their
required attribution and wire compatibility. A privacy cleanup must not rename
signed fields, weaken an authorization check or rewrite frozen protocol material.

## Release checks

1. Run the complete [developer validation sequence](developer-guide.md).
2. Inspect all changes and verify that the source audit has no findings. The guard
   runs in CI, before package creation, and during committed-source export.
3. Commit the reviewed source and export that exact revision to a new directory
   outside the checkout:

   ```sh
   node scripts/package-acceptance.mjs <full-commit-sha> <new-export-directory>
   node scripts/public-boundary.mjs --export <new-export-directory>
   ```

4. From that clean export, run the SDK and boundary tests, then reproduce setup
   and the affected application flow with dedicated evaluation resources.
5. Review generated assets and rendered copy. Confirm that evidence and claims
   match the specific source and target. An archive manifest is not deployment
   acceptance.
6. Obtain explicit release authorization before deploying, promoting, changing
   provider settings or submitting competition declarations. Repository source
   publication and running a live payment are separate actions.

The guard detects selected leak patterns and literal references. It cannot prove
the absence of arbitrary secrets, dynamically constructed dependencies or sensitive
content embedded in images. Human review and scope-appropriate security checks
remain required.

## Existing history

A source cleanup changes the current tree. It does not erase old commits, cached
archives or prior downloads, and it cannot revoke permissions already granted by
an open-source license. Treat a discovered credential as compromised: revoke it
through the provider and follow a reviewed cleanup procedure. Do not force-push
or rewrite history as a routine documentation change.
