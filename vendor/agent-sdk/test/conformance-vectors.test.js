import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalizeEnvelope} from "../src/security.js";

// Bundled protocol vectors make the same acceptance and rejection checks
// reproducible from a source download without access to another repository.
const vectors = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/predicate-envelope-vectors.v1.json",
    import.meta.url)), "utf8")).vectors;

const accepted = vectors.filter(vector => !vector.rejects);
const rejected = vectors.filter(vector => vector.rejects);

test("the vectors are present and cover both outcomes", () => {
  assert.ok(accepted.length >= 8, "acceptance vectors are missing");
  assert.ok(rejected.length >= 4, "rejection vectors are missing");
});

for (const vector of accepted) {
  test(`canonical form and hash: ${vector.name}`, () => {
    const canonical = canonicalizeEnvelope(vector.envelope);
    assert.equal(canonical, vector.canonical, vector.why);
    assert.equal(
      createHash("sha256").update(canonical, "utf8").digest("hex").toUpperCase(),
      vector.hash,
      vector.why);
  });
}

for (const vector of rejected) {
  test(`refused: ${vector.name}`, () => {
    assert.throws(() => canonicalizeEnvelope(vector.envelope), vector.rejects);
  });
}
