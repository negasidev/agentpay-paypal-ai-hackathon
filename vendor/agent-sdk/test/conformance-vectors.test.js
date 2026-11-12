import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalizeEnvelope} from "../src/security.js";

// The contract's own definition of conformance (specification section 10.3),
// run against this SDK for the first time.
//
// Every SDK test shared one hand-written fixture carrying an amount and a
// counterparty, so nothing exercised a hashed counterparty, a data class with an
// access mode, a region, a record count, or model provenance - the exact places
// where other languages had silently diverged from Verid.Core.
const vectors = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../verid-platform/contracts/schemas/predicate-envelope/vectors.v1.json",
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
