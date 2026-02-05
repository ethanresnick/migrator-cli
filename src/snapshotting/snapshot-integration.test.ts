import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import path from "path";
import { tmpdir } from "os";

import type { DatabaseConfig } from "../DatabaseConfig.js";
import { findScriptsToRun, loadSortedScripts } from "../script-utils.js";
import { createSnapshotAndArchiveCoveredScripts } from "./create-snapshot.js";
import { catchUpToSnapshot } from "./catch-up-to-snapshot.js";
import { toAbsolutePath, toFileBaseName } from "../utils.js";
import { toValidEnvName, toValidScriptFormat } from "../script-name-parsing/index.js";
import {
  createMockDatabaseConfig,
  type MockDbConfigWithSnapshot,
  type MockStorage,
  type TestContext,
} from "../test-utils/mocks/databaseConfig.js";

// =============================================================================
// Test Infrastructure
// =============================================================================

function setupTestScripts(
  scriptsDir: string,
  scripts: Record<string, string>,
): void {
  mkdirSync(scriptsDir, { recursive: true });
  for (const [name, content] of Object.entries(scripts)) {
    writeFileSync(path.join(scriptsDir, name), content);
  }
}

async function createSnapshot(opts: {
  db: MockDbConfigWithSnapshot<string>;
  scriptsDirectory: string;
  snapshotArchivesDirectory: string;
  upTo?: string;
}): Promise<{
  snapshotTimestamp: string;
  newSnapshotFiles: string[];
  archivedScripts: string[];
}> {
  const { db, scriptsDirectory, snapshotArchivesDirectory, upTo } = opts;
  const sortedScripts = await loadSortedScripts(
    scriptsDirectory,
    db.supportedScriptFormats.map(toValidScriptFormat),
  );

  const result = await createSnapshotAndArchiveCoveredScripts({
    sortedScripts,
    snapshotArchivesDirectory: toAbsolutePath(snapshotArchivesDirectory),
    supportedEnvironments: db.supportedEnvironments.map(toValidEnvName),
    generateSnapshot: db.generateSnapshot!,
    ...(upTo !== undefined && { upTo: toFileBaseName(upTo) }),
    logger: console,
  });

  return {
    snapshotTimestamp: result.snapshotTimestamp,
    newSnapshotFiles: result.newSnapshotFiles.map(String),
    archivedScripts: result.archivedScripts.map(String),
  };
}

async function applyScripts(opts: {
  env: string;
  db: DatabaseConfig<string, string, TestContext>;
  scriptsDirectory: string;
  snapshotArchivesDirectory: string;
  storage: MockStorage;
  context: TestContext;
}): Promise<{ executedLog: string[] }> {
  const { env, db, scriptsDirectory, snapshotArchivesDirectory, storage, context } = opts;

  const sortedScripts = await loadSortedScripts(
    scriptsDirectory,
    db.supportedScriptFormats.map(toValidScriptFormat),
  );

  await catchUpToSnapshot({
    env: toValidEnvName(env),
    sortedScripts,
    snapshotArchivesDirectory: toAbsolutePath(snapshotArchivesDirectory),
    supportedScriptFormats: db.supportedScriptFormats.map(toValidScriptFormat),
    storage,
    context,
    resolveScript: db.resolveScript.bind(db),
  });

  const scriptsToRun = findScriptsToRun({
    sortedScriptSet: sortedScripts.scriptNames,
    env: toValidEnvName(env),
  });

  const executedBefore = await storage.executed({ context });
  for (const scriptName of scriptsToRun) {
    if (!executedBefore.includes(scriptName)) {
      const scriptPath = path.join(scriptsDirectory, scriptName);
      const runnable = db.resolveScript({
        name: scriptName,
        path: scriptPath,
        context,
      });
      await runnable.up({
        name: scriptName,
        path: scriptPath,
        context,
      } as any);
      await storage.logMigration({ name: scriptName, context });
    }
  }

  const executedLog = await storage.executed({ context });
  return { executedLog: [...executedLog].sort() };
}

// =============================================================================
// E2E Integration Tests
// =============================================================================

describe("Snapshot Integration (E2E)", () => {
  let testDir: string;
  let scriptsDir: string;
  let archiveDir: string;

  beforeEach(() => {
    testDir = path.join(
      tmpdir(),
      `migrator-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    scriptsDir = path.join(testDir, "scripts");
    archiveDir = path.join(testDir, "archives");
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Create → Verify Directory Structure", () => {
    it("E2E-1: 1 migration creates snapshot and archives", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      const result = await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      assert.equal(result.archivedScripts.length, 1);
      assert.ok(result.newSnapshotFiles.length >= 1);

      const archivePath = path.join(archiveDir, result.snapshotTimestamp);
      assert.ok(existsSync(archivePath));
      assert.ok(readdirSync(archivePath).includes("2024.02.01T10.00.00.create-users.sql"));
      assert.ok(!existsSync(path.join(scriptsDir, "2024.02.01T10.00.00.create-users.sql")));
    });

    it("E2E-2: 2 migrations create snapshot and archive both", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.add-email.sql": "-- add email",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      const result = await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      assert.equal(result.archivedScripts.length, 2);
      const archivePath = path.join(archiveDir, result.snapshotTimestamp);
      assert.ok(readdirSync(archivePath).includes("2024.02.01T10.00.00.create-users.sql"));
      assert.ok(readdirSync(archivePath).includes("2024.02.02T10.00.00.add-email.sql"));
    });

    it("E2E-3: migration + seed creates env-specific and fallback snapshots", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.seed-data.seed.local-dev.sql": "-- seed",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async (scripts) => ({
          migrationScriptContent: `-- snapshot of ${scripts.length} scripts`,
          format: "sql",
        }),
      });

      const result = await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      assert.equal(result.archivedScripts.length, 2);
      assert.ok(
        result.newSnapshotFiles.some((f) => f.includes("snapshot.local-dev")),
      );
    });

    it("E2E-4: migration + seeds for local-dev and staging creates snapshots per env", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.seed-data.seed.local-dev.sql": "-- seed local",
        "2024.02.02T10.00.00.seed-data.seed.staging.sql": "-- seed staging",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev", "staging"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      const result = await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      assert.equal(result.archivedScripts.length, 3);
      assert.ok(
        result.newSnapshotFiles.some((f) => f.includes("snapshot.local-dev")),
      );
      assert.ok(
        result.newSnapshotFiles.some((f) => f.includes("snapshot.staging")),
      );
      assert.ok(
        result.newSnapshotFiles.some(
          (f) => f.includes("snapshot.sql") && !f.includes("local-dev") && !f.includes("staging"),
        ),
      );
    });

    it("E2E-5: --up-to archives only scripts up to target", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.a.sql": "-- a",
        "2024.02.02T10.00.00.b.sql": "-- b",
        "2024.02.03T10.00.00.c.sql": "-- c",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      const result = await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        upTo: "2024.02.02T10.00.00.b.sql",
      });

      assert.deepEqual(
        [...result.archivedScripts].sort(),
        ["2024.02.01T10.00.00.a.sql", "2024.02.02T10.00.00.b.sql"],
      );
      assert.ok(existsSync(path.join(scriptsDir, "2024.02.03T10.00.00.c.sql")));
    });
  });

  describe("Create → Apply → Verify Executed Log", () => {
    it("E2E-8: Fresh DB - snapshot runs and is logged", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.add-email.sql": "-- add email",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.ok(
        executedLog.some((s) => s.includes("snapshot")),
        `Expected snapshot in executed log, got: ${executedLog.join(", ")}`,
      );
    });

    it("E2E-12: Partial execution - catch-up runs missing archived scripts", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.add-email.sql": "-- add email",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        executedScripts: ["2024.02.01T10.00.00.create-users.sql" as any],
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.ok(executedLog.includes("2024.02.02T10.00.00.add-email.sql"));
      assert.ok(executedLog.some((s) => s.includes("snapshot")));
    });

    it("E2E-20: Post-snapshot migration runs after snapshot", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.add-email.sql": "-- add email",
        "2024.02.05T10.00.00.add-phone.sql": "-- add phone (post-snapshot)",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        upTo: "2024.02.02T10.00.00.add-email.sql",
      });

      const { executedLog } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      const snapshotIdx = executedLog.findIndex((s) => s.includes("snapshot"));
      const postMigrationIdx = executedLog.findIndex((s) => s.includes("add-phone"));
      assert.ok(snapshotIdx >= 0);
      assert.ok(postMigrationIdx >= 0);
      assert.ok(postMigrationIdx > snapshotIdx);
    });
  });

  describe("Fallback Snapshot Behavior", () => {
    it("E2E-17: fallback snapshot runs when no env-specific snapshot", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.ok(
        executedLog.some((s) => s.includes("snapshot")),
        `Expected snapshot in executed log, got: ${executedLog.join(", ")}`,
      );
    });

    it("E2E-18: env-specific snapshot runs, fallback excluded for local-dev", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.seed-data.seed.local-dev.sql": "-- seed",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev", "staging"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.ok(
        executedLog.some((s) => s.includes("snapshot.local-dev")),
        `Expected snapshot.local-dev, got: ${executedLog.join(", ")}`,
      );
      const fallbackScript = executedLog.find(
        (s) => s.includes("snapshot") && !s.includes("local-dev") && !s.includes("staging"),
      );
      assert.ok(!fallbackScript, "Fallback snapshot should not run when env-specific exists");
    });

    it("E2E-19: fallback runs for staging when no staging-specific snapshot", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
        "2024.02.02T10.00.00.seed-data.seed.local-dev.sql": "-- seed",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev", "staging"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog } = await applyScripts({
        env: "staging",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.ok(
        executedLog.some((s) => s.includes("snapshot")),
        `Expected snapshot (fallback) for staging, got: ${executedLog.join(", ")}`,
      );
    });
  });

  describe("Idempotency", () => {
    it("E2E-28: Second apply runs nothing", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.create-users.sql": "-- create users",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
        snapshotGenerator: async () => ({
          migrationScriptContent: "-- snapshot",
          format: "sql",
        }),
      });

      await createSnapshot({
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
      });

      const { executedLog: log1 } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      const { executedLog: log2 } = await applyScripts({
        env: "local-dev",
        db,
        scriptsDirectory: scriptsDir,
        snapshotArchivesDirectory: archiveDir,
        storage: db._storage,
        context: { testId: "test" },
      });

      assert.deepEqual(log1.sort(), log2.sort());
    });
  });

  describe("Error Scenarios", () => {
    it("E2E-32: Throws when non-snapshot script before snapshot", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.03T10.00.00.create-users.sql": "-- create users",
        "2024.02.04T19.00.00.snapshot.local-dev.sql": "-- snapshot",
      });
      setupTestScripts(path.join(archiveDir, "2024.02.04T19.00.00"), {
        "2024.02.01T10.00.00.initial.sql": "-- initial",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
      });

      await assert.rejects(
        async () => {
          await applyScripts({
            env: "local-dev",
            db,
            scriptsDirectory: scriptsDir,
            snapshotArchivesDirectory: archiveDir,
            storage: db._storage,
            context: { testId: "test" },
          });
        },
        /Integrity check failed/,
      );
    });

    it("E2E-34: Throws when two snapshots (different timestamps)", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.01T10.00.00.snapshot.local-dev.sql": "-- snapshot 1",
        "2024.02.02T10.00.00.snapshot.local-dev.sql": "-- snapshot 2",
      });

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
      });

      await assert.rejects(
        async () => {
          await applyScripts({
            env: "local-dev",
            db,
            scriptsDirectory: scriptsDir,
            snapshotArchivesDirectory: archiveDir,
            storage: db._storage,
            context: { testId: "test" },
          });
        },
        /Found multiple snapshots/,
      );
    });

    it("E2E-31: Throws when archive missing", async () => {
      setupTestScripts(scriptsDir, {
        "2024.02.04T19.00.00.snapshot.local-dev.sql": "-- snapshot",
      });
      // No archive

      const db = createMockDatabaseConfig({
        environments: ["local-dev"],
        scriptsDirectory: scriptsDir,
      });

      await assert.rejects(
        async () => {
          await applyScripts({
            env: "local-dev",
            db,
            scriptsDirectory: scriptsDir,
            snapshotArchivesDirectory: archiveDir,
            storage: db._storage,
            context: { testId: "test" },
          });
        },
        /Snapshot archive not found/,
      );
    });
  });
});
