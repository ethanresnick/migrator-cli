import { mkdirSync, rmSync, writeFileSync } from "fs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { tmpdir } from "os";
import path from "path";

import { toValidEnvName, toValidScriptFormat } from "../script-name-parsing/index.js";
import { loadSortedScripts } from "../script-utils.js";
import { toAbsolutePath } from "../utils.js";
import {
  createMockStorage,
  type TestContext,
} from "../test-utils/mocks/databaseConfig.js";
import { catchUpToSnapshot } from "./catch-up-to-snapshot.js";

function setupTestScripts(
  scriptsDir: string,
  scripts: Record<string, string>,
): void {
  mkdirSync(scriptsDir, { recursive: true });
  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(path.join(scriptsDir, name), content);
  }
}

function setupArchive(
  archiveDir: string,
  timestamp: string,
  scripts: Record<string, string>,
): void {
  const archivePath = path.join(archiveDir, timestamp);
  mkdirSync(archivePath, { recursive: true });
  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(path.join(archivePath, name), content);
  }
}

describe("catchUpToSnapshot", () => {
  let testDir: string;
  let scriptsDir: string;
  let archiveDir: string;
  const context: TestContext = { testId: "test" };

  beforeEach(() => {
    testDir = path.join(
      tmpdir(),
      `migrator-catch-up-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    scriptsDir = path.join(testDir, "scripts");
    archiveDir = path.join(testDir, "archives");
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns immediately when no snapshot in scripts", async () => {
    setupTestScripts(scriptsDir, {
      "2024.02.01T10.00.00.create-users.sql": "-- create users",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);
    const storage = createMockStorage([]);

    await catchUpToSnapshot({
      env: toValidEnvName("local-dev"),
      sortedScripts,
      snapshotArchivesDirectory: toAbsolutePath(archiveDir),
      supportedScriptFormats: [toValidScriptFormat("sql")],
      storage,
      context,
      resolveScript: ({ name }) => ({
        name,
        async up() {},
        async down() {},
      }),
    });

    const executed = await storage.executed({ context });
    assert.equal(executed.length, 0);
  });

  it("throws when archive folder is missing", async () => {
    const timestamp = "2024.02.04T19.00.00";
    setupTestScripts(scriptsDir, {
      [`${timestamp}.snapshot.local-dev.sql`]: "-- snapshot",
    });
    // No archive folder

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);
    const storage = createMockStorage([]);

    await assert.rejects(
      async () => {
        await catchUpToSnapshot({
          env: toValidEnvName("local-dev"),
          sortedScripts,
          snapshotArchivesDirectory: toAbsolutePath(archiveDir),
          supportedScriptFormats: [toValidScriptFormat("sql")],
          storage,
          context,
          resolveScript: ({ name }) => ({
            name,
            async up() {},
            async down() {},
          }),
        });
      },
      /Snapshot archive not found/,
    );
  });

  it("throws when non-snapshot script predates snapshot", async () => {
    const timestamp = "2024.02.04T19.00.00";
    setupTestScripts(scriptsDir, {
      "2024.02.03T10.00.00.create-users.sql": "-- create users",
      [`${timestamp}.snapshot.local-dev.sql`]: "-- snapshot",
    });
    setupArchive(archiveDir, timestamp, {
      "2024.02.01T10.00.00.initial.sql": "-- initial",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);
    const storage = createMockStorage([]);

    await assert.rejects(
      async () => {
        await catchUpToSnapshot({
          env: toValidEnvName("local-dev"),
          sortedScripts,
          snapshotArchivesDirectory: toAbsolutePath(archiveDir),
          supportedScriptFormats: [toValidScriptFormat("sql")],
          storage,
          context,
          resolveScript: ({ name }) => ({
            name,
            async up() {},
            async down() {},
          }),
        });
      },
      /Integrity check failed/,
    );
  });

  it("runs missing archived scripts and marks snapshot when partially executed", async () => {
    const timestamp = "2024.02.04T19.00.00";
    const postSnapshotScript = "2024.02.05T10.00.00.add-phone.sql";
    setupTestScripts(scriptsDir, {
      [`${timestamp}.snapshot.local-dev.sql`]: "-- snapshot",
      [postSnapshotScript]: "-- add phone (post-snapshot)",
    });
    setupArchive(archiveDir, timestamp, {
      "2024.02.01T10.00.00.create-users.sql": "-- create users",
      "2024.02.02T10.00.00.add-email.sql": "-- add email",
    });

    const sortedScripts = await loadSortedScripts(scriptsDir, [toValidScriptFormat("sql")]);
    const storage = createMockStorage(["2024.02.01T10.00.00.create-users.sql"]);
    const runLog: string[] = [];

    await catchUpToSnapshot({
      env: toValidEnvName("local-dev"),
      sortedScripts,
      snapshotArchivesDirectory: toAbsolutePath(archiveDir),
      supportedScriptFormats: [toValidScriptFormat("sql")],
      storage,
      context,
      resolveScript: ({ name }) => ({
        name,
        async up() {
          runLog.push(name);
        },
        async down() {},
      }),
    });

    const executed = await storage.executed({ context });
    assert.ok(executed.includes("2024.02.02T10.00.00.add-email.sql"));
    assert.ok(executed.includes(`${timestamp}.snapshot.local-dev.sql`));
    assert.ok(runLog.includes("2024.02.02T10.00.00.add-email.sql"));

    assert.ok(
      !executed.includes(postSnapshotScript),
      "post-snapshot script should not be logged by catch-up",
    );
    assert.ok(
      !runLog.includes(postSnapshotScript),
      "post-snapshot script should not be run by catch-up",
    );
  });
});
