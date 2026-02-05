import * as fc from "fast-check";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toValidEnvName,
  toValidScriptFormat,
  toValidScriptName,
  toValidScriptTimestamp,
} from "./name-component-validation.js";
import { arbDate } from "../test-utils/arbitraries.js";

// =============================================================================
// toValidEnvName
// =============================================================================

describe("toValidEnvName", () => {
  it("throws for empty string", () => {
    assert.throws(() => toValidEnvName(""), /Environment cannot be empty/);
  });

  it("throws for string with dots", () => {
    assert.throws(
      () => toValidEnvName("local.dev"),
      /Environment must contain only/,
    );
  });

  it("throws for string with spaces", () => {
    assert.throws(
      () => toValidEnvName("local dev"),
      /Environment must contain only/,
    );
  });

  it("accepts alphanumeric, hyphens, underscores", () => {
    assert.doesNotThrow(() => toValidEnvName("local-dev"));
    assert.doesNotThrow(() => toValidEnvName("local_dev"));
    assert.doesNotThrow(() => toValidEnvName("localdev"));
    assert.doesNotThrow(() => toValidEnvName("a"));
  });

  it("returns tagged value for valid input", () => {
    const result = toValidEnvName("staging");
    assert.equal(result, "staging");
  });
});

// =============================================================================
// toValidScriptFormat
// =============================================================================

describe("toValidScriptFormat", () => {
  it("throws for empty string", () => {
    assert.throws(() => toValidScriptFormat(""), /Format cannot be empty/);
  });

  it("throws for format with hyphens", () => {
    assert.throws(
      () => toValidScriptFormat("my-format"),
      /Format must be alphanumeric only/,
    );
  });

  it("throws for format with underscores", () => {
    assert.throws(
      () => toValidScriptFormat("my_format"),
      /Format must be alphanumeric only/,
    );
  });

  it("accepts alphanumeric only", () => {
    assert.doesNotThrow(() => toValidScriptFormat("sql"));
    assert.doesNotThrow(() => toValidScriptFormat("cjs"));
    assert.doesNotThrow(() => toValidScriptFormat("mjs"));
    assert.doesNotThrow(() => toValidScriptFormat("a"));
  });
});

// =============================================================================
// toValidScriptName
// =============================================================================

describe("toValidScriptName", () => {
  it("throws for empty string", () => {
    assert.throws(
      () => toValidScriptName("", false),
      /Script name cannot be empty/,
    );
  });

  it("throws for 'snapshot' when allowSnapshotNames is false", () => {
    assert.throws(
      () => toValidScriptName("snapshot", false),
      /reserved for snapshot scripts/,
    );
  });

  it("accepts 'snapshot' when allowSnapshotNames is true", () => {
    assert.doesNotThrow(() => toValidScriptName("snapshot", true));
  });

  it("throws for string with dots", () => {
    assert.throws(
      () => toValidScriptName("add.seed.column", false),
      /Script name must contain only/,
    );
  });

  it("accepts 'add-seed-column' (contains 'seed' but not reserved)", () => {
    assert.doesNotThrow(() => toValidScriptName("add-seed-column", false));
  });
});

// =============================================================================
// toValidScriptTimestamp
// =============================================================================

describe("toValidScriptTimestamp", () => {
  it("throws for NaN date", () => {
    assert.throws(
      () => toValidScriptTimestamp(new Date(NaN)),
      /Date is invalid/,
    );
  });

  it("produces correct format", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const result = toValidScriptTimestamp(date);
    assert.equal(result, "2024.02.04T19.00.00");
  });

  it("pads single-digit values", () => {
    const date = new Date(2024, 0, 5, 9, 5, 3); // Jan 5, 09:05:03
    const result = toValidScriptTimestamp(date);
    assert.equal(result, "2024.01.05T09.05.03");
  });

  it("produces deterministic output", () => {
    fc.assert(
      fc.property(arbDate, (date) => {
        const ts1 = toValidScriptTimestamp(date);
        const ts2 = toValidScriptTimestamp(new Date(date.getTime()));
        assert.equal(ts1, ts2);
      }),
      { numRuns: 50 },
    );
  });
});
