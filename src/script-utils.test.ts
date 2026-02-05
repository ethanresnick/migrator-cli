import * as fc from "fast-check";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { tmpdir } from "os";
import path from "path";

import {
  nameScript,
  toValidEnvName,
  toValidScriptFormat,
  toValidScriptName,
} from "./script-name-parsing/index.js";
import {
  compareScriptNames,
  filterSortedScriptNames,
  findScriptsToRun,
  isParsedSnapshotScript,
  loadSortedScripts,
  sortScriptNames,
} from "./script-utils.js";
import { arbDate, arbEnv, arbFormat, arbUserName } from "./test-utils/arbitraries.js";

// =============================================================================
// findScriptsToRun
// =============================================================================

describe("findScriptsToRun", () => {
  it("migrations always run regardless of environment", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbFormat,
        arbUserName,
        arbEnv,
        (date, format, name, env) => {
          const scriptName = nameScript({
            date,
            type: "migration",
            format,
            name,
          });
          const scriptSet = sortScriptNames([scriptName]);
          const result = findScriptsToRun({ sortedScriptSet: scriptSet, env });
          assert.equal(result.length, 1);
          assert.equal(result[0], scriptName);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("seed runs only when env matches", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbFormat,
        arbUserName,
        arbEnv,
        arbEnv,
        (date, format, name, env1, env2) => {
          const scriptName = nameScript({
            date,
            type: "seed",
            format,
            name,
            env: env1,
          });
          const scriptSet = sortScriptNames([scriptName]);
          const resultMatch = findScriptsToRun({
            sortedScriptSet: scriptSet,
            env: env1,
          });
          const resultNoMatch = findScriptsToRun({
            sortedScriptSet: scriptSet,
            env: env2,
          });
          assert.equal(
            resultMatch.length,
            1,
            "seed should run when env matches",
          );
          assert.equal(
            resultNoMatch.length,
            env1 === env2 ? 1 : 0,
            "seed should not run when env differs",
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it("env-specific snapshot runs only for matching env", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const scriptSet = sortScriptNames([
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: toValidEnvName("local-dev"),
      }),
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: toValidEnvName("staging"),
      }),
    ]);

    const resultLocal = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("local-dev"),
    });
    const resultStaging = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("staging"),
    });
    const resultProd = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("production"),
    });

    assert.equal(resultLocal.length, 1);
    assert.ok(String(resultLocal[0]).includes("local-dev"));
    assert.equal(resultStaging.length, 1);
    assert.ok(String(resultStaging[0]).includes("staging"));
    assert.equal(resultProd.length, 0);
  });

  it("fallback snapshot runs when env has no dedicated snapshot", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const scriptSet = sortScriptNames([
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: undefined,
      }),
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: toValidEnvName("local-dev"),
      }),
    ]);

    const resultLocal = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("local-dev"),
    });
    const resultStaging = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("staging"),
    });

    assert.equal(resultLocal.length, 1);
    assert.ok(String(resultLocal[0]).includes("local-dev"));
    assert.equal(resultStaging.length, 1);
    assert.ok(
      String(resultStaging[0]).includes("snapshot") &&
        !String(resultStaging[0]).includes("local-dev"),
    );
  });

  it("P39: fallback snapshot runs for unknown env (env=undefined)", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const scriptSet = sortScriptNames([
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: undefined,
      }),
    ]);

    const result = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: undefined,
    });

    assert.equal(result.length, 1);
    assert.ok(String(result[0]).includes("snapshot"));
  });

  it("fallback snapshot excluded when env has dedicated snapshot", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const scriptSet = sortScriptNames([
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: undefined,
      }),
      nameScript({
        date,
        type: "snapshot",
        format: toValidScriptFormat("sql"),
        env: toValidEnvName("local-dev"),
      }),
    ]);

    const result = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("local-dev"),
    });

    assert.equal(result.length, 1);
    assert.ok(String(result[0]).includes("local-dev"));
    assert.ok(
      !result.some((s) => String(s) === "2024.02.04T19.00.00.snapshot.sql"),
    );
  });
});

// =============================================================================
// isParsedSnapshotScript
// =============================================================================

describe("isParsedSnapshotScript", () => {
  it("returns true only for snapshot type", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbFormat,
        arbUserName,
        arbEnv,
        (date, format, name, env) => {
          const migrationParsed = {
            date,
            type: "migration" as const,
            format,
            name,
          };
          const seedParsed = {
            date,
            type: "seed" as const,
            format,
            name,
            env: toValidEnvName(env),
          };
          const snapshotParsed = {
            date,
            type: "snapshot" as const,
            format,
            env: undefined,
          };
          assert.equal(isParsedSnapshotScript(migrationParsed), false);
          assert.equal(isParsedSnapshotScript(seedParsed), false);
          assert.equal(isParsedSnapshotScript(snapshotParsed), true);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// =============================================================================
// compareScriptNames / sortScriptNames
// =============================================================================

describe("compareScriptNames / sortScriptNames", () => {
  it("compareScriptNames returns -1, 0, or 1 consistently with string comparison for same-type scripts", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbDate,
        arbFormat,
        arbUserName,
        (date1, date2, format, name) => {
          const script1 = nameScript({
            date: date1,
            type: "migration",
            format,
            name,
          });
          const script2 = nameScript({
            date: date2,
            type: "migration",
            format,
            name,
          });
          const result = compareScriptNames(script1, script2);
          const expected = script1 < script2 ? -1 : script1 > script2 ? 1 : 0;
          assert.equal(result, expected);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("same timestamp: migration < seed < snapshot regardless of script names", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const migrationZ = nameScript({
      date,
      type: "migration",
      format: toValidScriptFormat("sql"),
      name: toValidScriptName("zzz-final", false),
    });
    const seedA = nameScript({
      date,
      type: "seed",
      format: toValidScriptFormat("sql"),
      name: toValidScriptName("aaa-first", false),
      env: toValidEnvName("local-dev"),
    });
    const snapshot = nameScript({
      date,
      type: "snapshot",
      format: toValidScriptFormat("sql"),
      env: toValidEnvName("local-dev"),
    });

    const sorted = sortScriptNames([snapshot, migrationZ, seedA]);
    assert.equal(sorted[0], migrationZ, "migration should sort first");
    assert.equal(sorted[1], seedA, "seed should sort second");
    assert.equal(sorted[2], snapshot, "snapshot should sort last");
  });

  it("sortScriptNames is idempotent", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbDate,
        arbFormat,
        arbUserName,
        arbEnv,
        (date1, date2, format, name, env) => {
          const script1 = nameScript({
            date: date1,
            type: "migration",
            format,
            name,
          });
          const script2 = nameScript({
            date: date2,
            type: "seed",
            format,
            name,
            env: toValidEnvName(env),
          });
          const scripts = [script1, script2];
          const sortedOnce = sortScriptNames(scripts);
          const sortedTwice = sortScriptNames([...sortedOnce]);
          assert.deepEqual([...sortedOnce], [...sortedTwice]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("P40: findScriptsToRun returns scripts in same order as input", () => {
    const date = new Date(2024, 1, 4, 19, 0, 0);
    const scripts = [
      nameScript({
        date,
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("a", false),
      }),
      nameScript({
        date,
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("b", false),
      }),
    ];
    const scriptSet = sortScriptNames(scripts);
    const result = findScriptsToRun({
      sortedScriptSet: scriptSet,
      env: toValidEnvName("local-dev"),
    });
    assert.equal(result[0], scripts[0]);
    assert.equal(result[1], scripts[1]);
  });

  it("scripts with earlier timestamps sort before later", () => {
    fc.assert(
      fc.property(
        arbDate,
        arbDate,
        arbFormat,
        arbUserName,
        (date1, date2, format, name) => {
          fc.pre(Math.abs(date1.getTime() - date2.getTime()) >= 1000);
          const script1 = nameScript({
            date: date1,
            type: "migration",
            format,
            name,
          });
          const script2 = nameScript({
            date: date2,
            type: "migration",
            format,
            name,
          });
          const sorted = sortScriptNames([script2, script1]);
          const earlier = date1.getTime() < date2.getTime() ? script1 : script2;
          assert.equal(sorted[0], earlier);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// =============================================================================
// loadSortedScripts
// =============================================================================

describe("loadSortedScripts", () => {
  let testDir: string;
  let scriptsDir: string;

  beforeEach(() => {
    testDir = path.join(
      tmpdir(),
      `migrator-load-scripts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    scriptsDir = path.join(testDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("filters by supportedFormats", async () => {
    writeFileSync(
      path.join(scriptsDir, "2024.02.01T10.00.00.create-users.sql"),
      "-- create users",
    );
    writeFileSync(
      path.join(scriptsDir, "2024.02.02T10.00.00.other.cjs"),
      "module.exports = {}",
    );

    const result = await loadSortedScripts(scriptsDir, [
      toValidScriptFormat("sql"),
    ]);
    assert.equal(result.scriptNames.length, 1);
    assert.equal(
      String(result.scriptNames[0]),
      "2024.02.01T10.00.00.create-users.sql",
    );
  });
});

// =============================================================================
// filterSortedScriptNames
// =============================================================================

describe("filterSortedScriptNames", () => {
  it("filters scripts by predicate", () => {
    const scripts = sortScriptNames([
      nameScript({
        date: new Date(2024, 1, 1, 10, 0, 0),
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("a", false),
      }),
      nameScript({
        date: new Date(2024, 1, 2, 10, 0, 0),
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("b", false),
      }),
      nameScript({
        date: new Date(2024, 1, 3, 10, 0, 0),
        type: "migration",
        format: toValidScriptFormat("sql"),
        name: toValidScriptName("c", false),
      }),
    ]);
    const filtered = filterSortedScriptNames(scripts, (s) =>
      String(s).includes("2024.02.02"),
    );
    assert.equal(filtered.length, 1);
    assert.ok(String(filtered[0]).includes("b"));
  });
});
