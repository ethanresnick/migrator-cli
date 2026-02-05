import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { tmpdir } from "os";
import path from "path";

import { toValidEnvName, toValidScriptFormat } from "../script-name-parsing/index.js";
import {
  loadSortedScripts,
  sortScriptNames,
  type SortedScriptFileNames,
} from "../script-utils.js";
import { createSnapshotAndArchiveCoveredScripts } from "./create-snapshot.js";
import { toAbsolutePath, toFileBaseName } from "../utils.js";

function setupTestScripts(
  scriptsDir: string,
  scripts: Record<string, string>,
): void {
  mkdirSync(scriptsDir, { recursive: true });
  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(path.join(scriptsDir, name), content);
  }
}

describe("createSnapshotAndArchiveCoveredScripts", () => {
  let testDir: string;
  let scriptsDir: string;
  let archiveDir: string;

  beforeEach(() => {
    testDir = path.join(
      tmpdir(),
      `migrator-create-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    scriptsDir = path.join(testDir, "scripts");
    archiveDir = path.join(testDir, "archives");
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("throws when only snapshot scripts exist (no migrations or seeds since snapshot)", async () => {
    setupTestScripts(scriptsDir, {
      "2024.02.02T10.00.00.snapshot.sql": "-- fallback snapshot",
      "2024.02.02T10.00.00.snapshot.local-dev.sql": "-- env snapshot",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);

    await assert.rejects(
      async () => {
        await createSnapshotAndArchiveCoveredScripts({
          sortedScripts,
          snapshotArchivesDirectory: toAbsolutePath(archiveDir),
          supportedEnvironments: [toValidEnvName("local-dev")],
          generateSnapshot: async () => ({
            migrationScriptContent: "-- snapshot",
            format: "sql",
          }),
        });
      },
      /No migrations or seeds to snapshot/,
    );
  });

  it("throws when no scripts exist", async () => {
    mkdirSync(scriptsDir, { recursive: true });

    const sortedScripts = {
      scriptDirectory: toAbsolutePath(scriptsDir),
      scriptNames: sortScriptNames([]) as SortedScriptFileNames,
    };

    await assert.rejects(
      async () => {
        await createSnapshotAndArchiveCoveredScripts({
          sortedScripts,
          snapshotArchivesDirectory: toAbsolutePath(archiveDir),
          supportedEnvironments: [toValidEnvName("local-dev")],
          generateSnapshot: async () => ({
            migrationScriptContent: "-- snapshot",
            format: "sql",
          }),
        });
      },
      /No scripts to snapshot/,
    );
  });

  it("creates snapshot and archives scripts", async () => {
    setupTestScripts(scriptsDir, {
      "2024.02.01T10.00.00.create-users.sql": "-- create users",
      "2024.02.02T10.00.00.add-email.sql": "-- add email",
      "2024.02.03T10.00.00.seed-data.seed.local-dev.sql": "-- seed for local-dev",
      "2024.02.03T10.00.00.staging-data.seed.staging.sql": "-- seed for staging",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);

    const result = await createSnapshotAndArchiveCoveredScripts({
      sortedScripts,
      snapshotArchivesDirectory: toAbsolutePath(archiveDir),
      supportedEnvironments: [toValidEnvName("local-dev"), toValidEnvName("staging")],
      generateSnapshot: async (scripts) => ({
        migrationScriptContent: scripts.map((s) => s.name).join(" | "),
        format: "sql",
      }),
    });

    assert.equal(result.archivedScripts.length, 4);
    assert.ok(result.newSnapshotFiles.length == 3);

    const archivePath = path.join(archiveDir, result.snapshotTimestamp);
    assert.ok(existsSync(archivePath));
    const archivedFiles = readdirSync(archivePath).sort();
    assert.deepEqual(
      archivedFiles,
      [
        "2024.02.01T10.00.00.create-users.sql",
        "2024.02.02T10.00.00.add-email.sql",
        "2024.02.03T10.00.00.seed-data.seed.local-dev.sql",
        "2024.02.03T10.00.00.staging-data.seed.staging.sql",
      ],
      "archive directory should contain only the four archived scripts",
    );

    const scriptsDirFiles = readdirSync(scriptsDir).sort();
    assert.deepEqual(
      scriptsDirFiles,
      [
        "2024.02.03T10.00.00.snapshot.local-dev.sql",
        "2024.02.03T10.00.00.snapshot.sql",
        "2024.02.03T10.00.00.snapshot.staging.sql",
      ],
      "scripts directory should contain only the three snapshot files",
    );

    assert.equal(
      readFileSync(path.join(scriptsDir, "2024.02.03T10.00.00.snapshot.sql"), "utf-8"),
      "2024.02.01T10.00.00.create-users.sql | 2024.02.02T10.00.00.add-email.sql",
      "fallback snapshot should include only migrations (no env-specific seeds)",
    );
    assert.equal(
      readFileSync(path.join(scriptsDir, "2024.02.03T10.00.00.snapshot.local-dev.sql"), "utf-8"),
      "2024.02.01T10.00.00.create-users.sql | 2024.02.02T10.00.00.add-email.sql | 2024.02.03T10.00.00.seed-data.seed.local-dev.sql",
      "local-dev snapshot should include migrations and local-dev seed only",
    );
    assert.equal(
      readFileSync(path.join(scriptsDir, "2024.02.03T10.00.00.snapshot.staging.sql"), "utf-8"),
      "2024.02.01T10.00.00.create-users.sql | 2024.02.02T10.00.00.add-email.sql | 2024.02.03T10.00.00.staging-data.seed.staging.sql",
      "staging snapshot should include migrations and staging seed only",
    );
  });

  it("--up-to filters scripts to archive", async () => {
    setupTestScripts(scriptsDir, {
      "2024.02.01T10.00.00.create-users.sql": "-- create users",
      "2024.02.02T10.00.00.add-email.sql": "-- add email",
      "2024.02.03T10.00.00.add-phone.sql": "-- add phone",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);

    const result = await createSnapshotAndArchiveCoveredScripts({
      sortedScripts,
      snapshotArchivesDirectory: toAbsolutePath(archiveDir),
      supportedEnvironments: [toValidEnvName("local-dev")],
      generateSnapshot: async () => ({
        migrationScriptContent: "-- snapshot",
        format: "sql",
      }),
      upTo: toFileBaseName("2024.02.02T10.00.00.add-email.sql"),
    });

    assert.deepEqual(
      [...result.archivedScripts].sort(),
      [
        "2024.02.01T10.00.00.create-users.sql",
        "2024.02.02T10.00.00.add-email.sql",
      ],
    );

    const scriptsDirFiles = readdirSync(scriptsDir).sort();
    assert.deepEqual(
      scriptsDirFiles,
      [
        "2024.02.02T10.00.00.snapshot.local-dev.sql",
        "2024.02.02T10.00.00.snapshot.sql",
        "2024.02.03T10.00.00.add-phone.sql",
      ],
      "scripts directory should contain snapshot files and the unfiltered migration",
    );
  });

  it("snapshot timestamp matches last archived script", async () => {
    setupTestScripts(scriptsDir, {
      "2024.02.02T10.00.00.add-email.sql": "-- add email",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);

    const result = await createSnapshotAndArchiveCoveredScripts({
      sortedScripts,
      snapshotArchivesDirectory: toAbsolutePath(archiveDir),
      supportedEnvironments: [toValidEnvName("local-dev")],
      generateSnapshot: async () => ({
        migrationScriptContent: "-- snapshot",
        format: "sql",
      }),
    });

    assert.equal(result.snapshotTimestamp, "2024.02.02T10.00.00");
  });
});
