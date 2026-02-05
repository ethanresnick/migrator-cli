// =============================================================================
// Test Infrastructure
// =============================================================================

import type { DatabaseConfig, MigrationStorage, SnapshotResult } from "../../DatabaseConfig.js";
import { toFileBaseName, type FileBaseName } from "../../utils.js";

export type TestContext = { testId: string };
export type MockStorage = MigrationStorage<TestContext>;

/**
 * Creates a mock MigrationStorage for testing.
 * Tracks executed scripts and supports logMigration/unlogMigration.
 */
export function createMockStorage(
  initialExecuted: readonly string[],
): MigrationStorage<TestContext> {
  const executed = [...initialExecuted];
  return {
    executed: async () => executed,
    logMigration: async ({ name }) => {
      executed.push(name);
    },
    unlogMigration: async ({ name }) => {
      const idx = executed.indexOf(name);
      if (idx >= 0) executed.splice(idx, 1);
    },
  };
}

export type MockDbConfig<T extends string> = DatabaseConfig<T, "sql", TestContext> & {
  _getRunLog(): FileBaseName[];
  _getExecuted(): FileBaseName[];
  _storage: MockStorage;
};

export type MockDbConfigWithSnapshot<T extends string> = MockDbConfig<T> & {
  generateSnapshot: NonNullable<DatabaseConfig["generateSnapshot"]>;
};

type CreateMockDbConfigOpts<T extends [string, ...string[]]> = {
  environments: T;
  executedScripts?: (string | FileBaseName)[];
  scriptsDirectory: string;
  snapshotGenerator?: (scripts: Array<{ path: string; name: string }>) => Promise<SnapshotResult>;
};

/**
 * Creates a mock DatabaseConfig for testing.
 * Tracks all script executions and provides controllable storage.
 */
export function createMockDatabaseConfig<T extends [string, ...string[]]>(
  opts: CreateMockDbConfigOpts<T> & { snapshotGenerator: NonNullable<CreateMockDbConfigOpts<T>["snapshotGenerator"]> }
): MockDbConfigWithSnapshot<T[number]>;
export function createMockDatabaseConfig<T extends [string, ...string[]]>(
  opts: CreateMockDbConfigOpts<T>
): MockDbConfig<T[number]>;
export function createMockDatabaseConfig<T extends [string, ...string[]]>(
  opts: CreateMockDbConfigOpts<T>
): MockDbConfig<T[number]> {
  const executed = new Set<FileBaseName>(
    (opts.executedScripts ?? []).map((s) => toFileBaseName(String(s))),
  );
  const runLog: FileBaseName[] = [];

  const storage: MockStorage = {
    executed: async () => [...executed],
    logMigration: async ({ name }) => {
      executed.add(toFileBaseName(String(name)));
    },
    unlogMigration: async ({ name }) => {
      executed.delete(toFileBaseName(String(name)));
    },
  };

  return {
    supportedEnvironments: opts.environments,
    supportedScriptFormats: ["sql"] as const,
    defaultScriptFormat: "sql",
    scriptsDirectory: opts.scriptsDirectory,

    resolveScript({ name }) {
      const nameAsBase = toFileBaseName(String(name));
      return {
        name: nameAsBase,
        async up() {
          runLog.push(nameAsBase);
        },
        async down() {
          const idx = runLog.indexOf(nameAsBase);
          if (idx >= 0) runLog.splice(idx, 1);
        },
      };
    },

    createStorage() {
      return storage;
    },

    createContext() {
      return { testId: "test" };
    },

    async destroyContext() {},
    async prepareDbAndDisconnect() {},
    async dropDbAndDisconnect() {},

    // Only include generateSnapshot if provided (exactOptionalPropertyTypes compatibility)
    ...(opts.snapshotGenerator && { generateSnapshot: opts.snapshotGenerator }),

    _getRunLog: () => [...runLog] as FileBaseName[],
    _getExecuted: () => [...executed] as FileBaseName[],
    _storage: storage,
  };
}
