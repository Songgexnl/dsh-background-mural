/**
 * Runtime-compatibility range checks.
 *
 * The plugin paints over the shell's chrome, so it must be able to declare which
 * DSH builds it was written against and refuse to paint on anything else. These
 * cover the range parser on its own; the failure policy (report, do not paint) is
 * covered by the route tests through `runtime.supported`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SUPPORTED_DSH_RANGE, isRuntimeSupported, satisfiesRange } from "../lib/index.js";

test("satisfiesRange handles the declared two-sided range", () => {
  assert.equal(satisfiesRange("0.1.7", SUPPORTED_DSH_RANGE), true);
  assert.equal(satisfiesRange("0.2.0-rc.2", SUPPORTED_DSH_RANGE), true);
  assert.equal(satisfiesRange("0.1.1-rc.1", SUPPORTED_DSH_RANGE), true);
  // Below the floor and above the ceiling both fail, which is the whole point:
  // a shell that moved its tokens must stop being painted on.
  assert.equal(satisfiesRange("0.1.0", SUPPORTED_DSH_RANGE), false);
  assert.equal(satisfiesRange("0.3.0", SUPPORTED_DSH_RANGE), false);
  assert.equal(satisfiesRange("1.0.0", SUPPORTED_DSH_RANGE), false);
});

test("satisfiesRange compares numerically, not as text", () => {
  assert.equal(satisfiesRange("0.1.10", ">=0.1.9 <0.2.0"), true);
  assert.equal(satisfiesRange("0.1.9", ">=0.1.10"), false);
});

test("an unparsable version never locks the user out", () => {
  // Unknown syntax is treated as satisfied: the plugin must not refuse to work
  // because it failed to understand a range it has never seen.
  assert.equal(satisfiesRange("0.1.7", ">=wat"), true);
  assert.equal(satisfiesRange("0.1.7", ""), true);
});

test("isRuntimeSupported reports the version it checked", () => {
  const result = isRuntimeSupported();
  assert.equal(typeof result.supported, "boolean");
  assert.equal(typeof result.version, "string");
  // An unreadable runtime is not evidence of an incompatible one.
  if (result.version === "") assert.equal(result.supported, true);
});
