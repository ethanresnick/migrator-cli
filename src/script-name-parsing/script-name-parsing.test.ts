import * as fc from "fast-check";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  nameScript,
  parseScriptName,
  parseTimestamp,
  toValidEnvName,
  toValidScriptFormat,
  toValidScriptName,
  toValidScriptTimestamp,
  type ParsedScriptMetadata,
} from "./index.js";
import { toFileBaseName } from "../utils.js";
import { arbDate, arbEnv, arbFormat, arbUserName } from "../test-utils/arbitraries.js";

// =============================================================================
// Property-Based: Round-trip parseScriptName / nameScript
// =============================================================================

describe("Script Naming and Parsing (Property-Based)", () => {
  describe("Round-trip properties", () => {
    it("parseScriptName(nameScript(opts)) recovers all fields for migrations", () => {
      fc.assert(
        fc.property(arbDate, arbFormat, arbUserName, (date, format, name) => {
          const opts: ParsedScriptMetadata = {
            date,
            type: "migration",
            format: format,
            name: name,
          };
          const scriptName = nameScript(opts);
          const parsed = parseScriptName(scriptName);

          assert.equal(parsed.type, "migration");
          assert.equal(parsed.format, format);
          assert.equal(parsed.name, name);
          assert.equal(parsed.env, undefined);
          assert.equal(
            toValidScriptTimestamp(parsed.date),
            toValidScriptTimestamp(date),
          );
        }),
        { numRuns: 100 },
      );
    });

    it("parseScriptName(nameScript(opts)) recovers all fields for seeds", () => {
      fc.assert(
        fc.property(
          arbDate,
          arbFormat,
          arbUserName,
          arbEnv,
          (date, format, name, env) => {
            const opts: ParsedScriptMetadata = {
              date,
              type: "seed",
              format,
              name,
              env,
            };
            const scriptName = nameScript(opts);
            const parsed = parseScriptName(scriptName);

            assert.equal(parsed.type, "seed");
            assert.equal(parsed.format, format);
            assert.equal(parsed.name, name);
            assert.equal(parsed.env, env);
            assert.equal(
              toValidScriptTimestamp(parsed.date),
              toValidScriptTimestamp(date),
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("parseScriptName(nameScript(opts)) recovers all fields for snapshot (env-specific)", () => {
      fc.assert(
        fc.property(arbDate, arbFormat, arbEnv, (date, format, env) => {
          const opts: ParsedScriptMetadata = {
            date,
            type: "snapshot",
            format,
            env,
          };
          const scriptName = nameScript(opts);
          const parsed = parseScriptName(scriptName);

          assert.equal(parsed.type, "snapshot");
          assert.equal(parsed.format, format);
          assert.equal(parsed.env, env);
          assert.equal(parsed.name, undefined);
          assert.equal(
            toValidScriptTimestamp(parsed.date),
            toValidScriptTimestamp(date),
          );
        }),
        { numRuns: 100 },
      );
    });

    it("parseScriptName(nameScript(opts)) recovers all fields for snapshot (fallback)", () => {
      fc.assert(
        fc.property(arbDate, arbFormat, (date, format) => {
          const opts: ParsedScriptMetadata = {
            date,
            type: "snapshot",
            format,
            env: undefined,
          };
          const scriptName = nameScript(opts);
          const parsed = parseScriptName(scriptName);

          assert.equal(parsed.type, "snapshot");
          assert.equal(parsed.format, format);
          assert.equal(parsed.env, undefined);
          assert.equal(parsed.name, undefined);
          assert.equal(
            toValidScriptTimestamp(parsed.date),
            toValidScriptTimestamp(date),
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("parseTimestamp / toValidScriptTimestamp round-trip", () => {
    it("parseTimestamp(toValidScriptTimestamp(date)) returns equivalent Date", () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const ts = toValidScriptTimestamp(date);
          const parsed = parseTimestamp(ts);
          assert.equal(
            Math.floor(parsed.getTime() / 1000),
            Math.floor(date.getTime() / 1000),
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("toValidScriptTimestamp properties", () => {
    it("produces consistent output for the same date", () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const ts1 = toValidScriptTimestamp(date);
          const ts2 = toValidScriptTimestamp(new Date(date.getTime()));
          assert.equal(ts1, ts2);
        }),
        { numRuns: 100 },
      );
    });

    it("produces lexicographically sortable timestamps", () => {
      fc.assert(
        fc.property(arbDate, arbDate, (date1, date2) => {
          const ts1 = toValidScriptTimestamp(date1);
          const ts2 = toValidScriptTimestamp(date2);
          const time1Seconds = Math.floor(date1.getTime() / 1000);
          const time2Seconds = Math.floor(date2.getTime() / 1000);

          if (time1Seconds < time2Seconds) {
            assert.ok(ts1 < ts2, `${ts1} should be < ${ts2}`);
          } else if (time1Seconds > time2Seconds) {
            assert.ok(ts1 > ts2, `${ts1} should be > ${ts2}`);
          } else {
            assert.equal(ts1, ts2);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("produces timestamps matching expected format", () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const ts = toValidScriptTimestamp(date);
          const pattern = /^\d{4}\.\d{2}\.\d{2}T\d{2}\.\d{2}\.\d{2}$/;
          assert.match(ts, pattern, `Timestamp ${ts} doesn't match format`);
        }),
        { numRuns: 100 },
      );
    });
  });
});

// =============================================================================
// Example-Based: Edge Cases
// =============================================================================

describe("Script Naming and Parsing (Example-Based)", () => {
  const testDate = new Date(2024, 1, 4, 19, 0, 0); // Feb 4, 2024, 19:00:00

  describe("nameScript examples", () => {
    it("generates correct migration name", () => {
      const result = nameScript({
        date: testDate,
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("create-users", false),
      });
      assert.equal(result, "2024.02.04T19.00.00.create-users.sql");
    });

    it("generates correct seed name", () => {
      const result = nameScript({
        date: testDate,
        type: "seed",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("add-test-data", false),
        env: toValidEnvName("local-dev"),
      });
      assert.equal(
        result,
        "2024.02.04T19.00.00.add-test-data.seed.local-dev.sql",
      );
    });

    it("generates correct snapshot name (fallback)", () => {
      const result = nameScript({
        date: testDate,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: undefined,
      });
      assert.equal(result, "2024.02.04T19.00.00.snapshot.sql");
    });

    it("generates correct snapshot name (env-specific)", () => {
      const result = nameScript({
        date: testDate,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: toValidEnvName("local-dev"),
      });
      assert.equal(result, "2024.02.04T19.00.00.snapshot.local-dev.sql");
    });
  });

  describe("parseScriptName examples", () => {
    it("parses migration correctly", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.create-users.sql"),
      );
      assert.equal(result.type, "migration");
      assert.equal(result.format, "sql");
      assert.equal(result.env, undefined);
      assert.equal(result.name, "create-users");
      assert.equal(toValidScriptTimestamp(result.date), "2024.02.04T19.00.00");
    });

    it("parses seed correctly", () => {
      const result = parseScriptName(
        toFileBaseName(
          "2024.02.04T19.00.00.add-test-data.seed.local-dev.sql",
        ),
      );
      assert.equal(result.type, "seed");
      assert.equal(result.format, "sql");
      assert.equal(result.env, "local-dev");
      assert.equal(result.name, "add-test-data");
      assert.equal(toValidScriptTimestamp(result.date), "2024.02.04T19.00.00");
    });

    it("parses snapshot (fallback) correctly", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.format, "sql");
      assert.equal(result.env, undefined);
      assert.equal(result.name, undefined);
      assert.equal(toValidScriptTimestamp(result.date), "2024.02.04T19.00.00");
    });

    it("parses snapshot (env-specific) correctly", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot.local-dev.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.format, "sql");
      assert.equal(result.env, "local-dev");
      assert.equal(result.name, undefined);
      assert.equal(toValidScriptTimestamp(result.date), "2024.02.04T19.00.00");
    });

    it("parses snapshot before migration when name would be 'snapshot'", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.env, undefined);
    });

    it("throws for invalid script names (P9, P10, P11)", () => {
      assert.throws(
        () => parseScriptName(toFileBaseName("invalid-name.sql")),
        /Invalid script name/,
      );
      assert.throws(
        () => parseScriptName(toFileBaseName("no-timestamp.sql")),
        /Invalid script name/,
      );
      assert.throws(
        () => parseScriptName(toFileBaseName("")),
        /Invalid script name/,
      );
    });
  });

  describe("parseTimestamp / toValidScriptTimestamp edge cases", () => {
    it("toValidScriptTimestamp throws for NaN date", () => {
      assert.throws(
        () => toValidScriptTimestamp(new Date(NaN)),
        /Date is invalid/,
      );
    });

    it("parseTimestamp throws for invalid format", () => {
      assert.throws(
        () => parseTimestamp("2024-10-20" as any),
        /Invalid timestamp format/,
      );
    });

    it("handles leap year (E7)", () => {
      const result = parseTimestamp("2024.02.29T12.00.00" as any);
      assert.equal(result.getFullYear(), 2024);
      assert.equal(result.getMonth(), 1);
      assert.equal(result.getDate(), 29);
    });

    it("E8: non-leap Feb 29 rolls over to Mar 1 (JS Date behavior)", () => {
      const result = parseTimestamp("2023.02.29T12.00.00" as any);
      assert.equal(result.getFullYear(), 2023);
      assert.equal(result.getMonth(), 2); // March (0-indexed)
      assert.equal(result.getDate(), 1);
    });

    it("E9/E10: month 13 and 0 - JS Date rolls over (no throw)", () => {
      // parseTimestamp uses new Date(y, m-1, d, ...); JS Date rolls invalid values
      const month13 = parseTimestamp("2024.13.01T12.00.00" as any);
      assert.equal(month13.getFullYear(), 2025);
      assert.equal(month13.getMonth(), 0);
      const month0 = parseTimestamp("2024.00.01T12.00.00" as any);
      assert.equal(month0.getFullYear(), 2023);
      assert.equal(month0.getMonth(), 11);
    });

    it("parseTimestamp throws for invalid values (P18)", () => {
      assert.throws(
        () => parseTimestamp("2024-10-20" as any),
        /Invalid timestamp format/,
      );
    });
  });

  describe("Edge cases: regex match order and format (E1-E6, E12-E13)", () => {
    it("E1: snapshot.sql parses as snapshot (not migration)", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.env, undefined);
    });

    it("E2: snapshot.dev.sql parses as snapshot (env-specific)", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot.dev.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.env, "dev");
    });

    it("E3: add.seed.column.seed.dev.sql throws (name has dots)", () => {
      assert.throws(
        () =>
          parseScriptName(
            toFileBaseName("2024.02.04T19.00.00.add.seed.column.seed.dev.sql"),
          ),
        /Script name must contain only|Invalid script name/,
      );
    });

    it("E4: my-migration.seed.dev.sql parses as seed", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.my-migration.seed.dev.sql"),
      );
      assert.equal(result.type, "seed");
      assert.equal(result.name, "my-migration");
      assert.equal(result.env, "dev");
    });

    it("E5: create-users.sql parses as migration", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.create-users.sql"),
      );
      assert.equal(result.type, "migration");
    });

    it("E6: create-users.seed.dev.sql parses as seed", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.create-users.seed.dev.sql"),
      );
      assert.equal(result.type, "seed");
    });

    it("E12: x.sql parses as migration with name=x", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.x.sql"),
      );
      assert.equal(result.type, "migration");
      assert.equal(result.name, "x");
      assert.equal(result.format, "sql");
    });

    it("E13: x.y.sql does not match migration pattern (invalid)", () => {
      assert.throws(
        () => parseScriptName(toFileBaseName("2024.02.04T19.00.00.x.y.sql")),
        /Invalid script name/,
      );
    });

    it("E14: snapshot..sql with empty env throws (regex requires non-empty env)", () => {
      assert.throws(
        () =>
          parseScriptName(toFileBaseName("2024.02.04T19.00.00.snapshot..sql")),
        /Invalid script name/,
      );
    });

    it("E15: env with leading underscore is valid", () => {
      const result = parseScriptName(
        toFileBaseName("2024.02.04T19.00.00.snapshot._dev.sql"),
      );
      assert.equal(result.type, "snapshot");
      assert.equal(result.env, "_dev");
    });
  });
});
