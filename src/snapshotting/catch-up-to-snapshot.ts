import { stat } from "fs/promises";
import * as path from "path";
import { isNonEmptyArray } from "type-party/runtime/nonempty.js";

import type { UmzugStorage } from "umzug";

import { partition } from "es-toolkit";
import type { DatabaseConfig, MigrationStorage } from "../DatabaseConfig.js";
import {
  parseScriptName,
  toValidScriptTimestamp,
  type ValidEnvName,
  type ValidScriptFileName,
  type ValidScriptFormat,
} from "../script-name-parsing/index.js";
import {
  compareScriptNames,
  filterSortedScriptNames,
  findScriptsToRun,
  isParsedSnapshotScript,
  loadSortedScripts,
  type SortedScriptFileNames,
  type SortedScripts,
} from "../script-utils.js";
import { type AbsolutePath, type FileBaseName } from "../utils.js";

// =============================================================================
// Types
// =============================================================================

// First, some types from the DatabaseConfig type with their this type
// removed, because we expect them to be passed in with `this` already bound
// if needed.
type ResolveScriptFn<Context> = OmitThisParameter<
  Exclude<DatabaseConfig<string, string, Context>["resolveScript"], undefined>
>;
/**
 * A snapshot that has been loaded and validated:
 * - Archive folder exists and has been read
 * - The main scripts directory does not contain any script whose timestamp is
 *   before the snapshot timestamp.
 */
type ValidatedSnapshot = {
  date: Date;
  scriptsByEnv: Map<ValidEnvName, ValidScriptFileName>;
  fallbackEnvScript?: ValidScriptFileName | undefined;
  archiveFolderPath: AbsolutePath;
  archivedScripts: SortedScriptFileNames;
};

// =============================================================================
// Load & Validate Snapshot
// =============================================================================

/**
 * Finds the snapshot on disk (if any), loads its archived scripts, and
 * validates integrity.
 *
 * Invariant: There can be at most one snapshot in the scripts set at a time.
 * Creating a new snapshot archives any existing snapshot along with all scripts
 * since that snapshot.
 *
 * Validation includes:
 * - At most one snapshot exists [a snapshot includes the _schema_ script plus
 *   any env-specific seed scripts]
 * - An archive folder exists, holding all scripts (including, perhaps the prior
 *   snapshot) that got run to produce the snapshot.
 * - The only other scripts in the scripts directory are from after the
 *   snapshot's date.
 *
 * Throws if any validation fails.
 */
async function loadAndValidateSnapshot(
  scripts: SortedScripts,
  snapshotArchivesDirectory: AbsolutePath,
  supportedScriptFormats: readonly ValidScriptFormat[],
): Promise<ValidatedSnapshot | null> {
  const parsedScripts = scripts.scriptNames.map((name) => ({
    name,
    parsed: parseScriptName(name),
  }));

  const [parsedSnapshotScripts, parsedNonSnapshotScripts] = partition(
    parsedScripts,
    (it) => isParsedSnapshotScript(it.parsed),
  );

  if (!isNonEmptyArray(parsedSnapshotScripts)) {
    return null;
  }

  const snapshotTimestamp = parsedSnapshotScripts[0]!.parsed.date;
  const hasMultipleSnapshots = parsedSnapshotScripts.some(
    (it) => it.parsed.date.getTime() !== snapshotTimestamp.getTime(),
  );

  if (hasMultipleSnapshots) {
    const uniqueTimestamps = [
      ...new Set(
        parsedSnapshotScripts.map((it) =>
          toValidScriptTimestamp(it.parsed.date),
        ),
      ),
    ];
    throw new Error(
      `Found multiple snapshots in scripts (timestamps: ${uniqueTimestamps.join(
        ", ",
      )}). ` +
        `This should not happen - creating a snapshot archives any existing snapshot. ` +
        `Please remove extraneous snapshot files or ensure your scripts directory is in a valid state.`,
    );
  }

  // Validate integrity: there must be no (non-snapshot) scripts in the main
  // scripts directory before this snapshot.
  if (
    parsedNonSnapshotScripts.some(
      (it) => it.parsed.date.getTime() <= snapshotTimestamp.getTime(),
    )
  ) {
    throw new Error(
      `Integrity check failed for snapshot at timestamp ${snapshotTimestamp}:\n` +
        `Some non-snapshot script predates the snapshot in the scripts directory.\n` +
        `This may indicate the snapshot was created from an incomplete set of migrations.\n` +
        `Scripts directory: ${scripts.scriptDirectory}.\n`,
    );
  }

  const archiveFolderPath = path.resolve(
    snapshotArchivesDirectory,
    toValidScriptTimestamp(snapshotTimestamp),
  ) as AbsolutePath;

  // Load archived scripts from disk
  const archiveExists = await stat(archiveFolderPath)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!archiveExists) {
    throw new Error(
      `Snapshot archive not found: ${archiveFolderPath}\n` +
        `Cannot verify integrity of snapshot with timestamp ${snapshotTimestamp}.`,
    );
  }

  const archivedScripts = await loadSortedScripts(
    archiveFolderPath,
    supportedScriptFormats,
  );

  return {
    date: snapshotTimestamp,
    scriptsByEnv: new Map(
      parsedSnapshotScripts
        .filter((s) => s.parsed.env != null)
        .map((s) => [s.parsed.env!, s.name]),
    ),
    fallbackEnvScript: parsedSnapshotScripts.find((s) => s.parsed.env == null)
      ?.name,
    archiveFolderPath,
    archivedScripts: archivedScripts.scriptNames,
  };
}

// =============================================================================
// Apply Snapshot
// =============================================================================

/**
 * Runs a single script and logs it to storage.
 */
async function runAndLogScript<Context>(opts: {
  scriptName: FileBaseName;
  scriptPath: string;
  context: Context;
  storage: UmzugStorage<Context>;
  resolveScript: ResolveScriptFn<Context>;
}): Promise<void> {
  const { scriptName, scriptPath, context, storage, resolveScript } = opts;

  const runnable = resolveScript({
    name: scriptName,
    path: scriptPath,
    context,
  });

  await runnable.up({
    name: scriptName,
    path: scriptPath,
    context,
  });

  await storage.logMigration({ name: scriptName, context });
}

/**
 * - If no snapshot exists, or if _none_ of the snapshot's archived scripts have
 *   been executed, do nothing; we let umzug run the migrations as normal.
 *
 * - If some archived scripts have been executed, run the missing ones from the
 *   archive and mark snapshot as executed. This essentially catches the db up
 *   to the snapshot.
 *
 * Then, return to umzug which migrations it will see, accounting for the
 * env-fallback logic of snapshots.
 */
export async function catchUpToSnapshot<Context>(opts: {
  env: ValidEnvName;
  /** All script file paths on disk (absolute paths), already sorted */
  sortedScripts: SortedScripts;
  snapshotArchivesDirectory: AbsolutePath;
  supportedScriptFormats: readonly ValidScriptFormat[];
  storage: MigrationStorage<Context>;
  context: Context;
  resolveScript: ResolveScriptFn<Context>;
  logger?: { log: (msg: string) => void };
  /** If specified, only apply snapshots and migrations up to this script name */
  upTo?: FileBaseName;
}): Promise<void> {
  const {
    env,
    sortedScripts,
    snapshotArchivesDirectory,
    supportedScriptFormats,
    storage,
    context,
    resolveScript,
    logger,
    upTo,
  } = opts;

  // Load & Validate snapshot (if any)
  const snapshot = await loadAndValidateSnapshot(
    sortedScripts,
    snapshotArchivesDirectory,
    supportedScriptFormats,
  );

  if (snapshot === null) {
    return;
  }

  // Determine which snapshot script applies to this environment, if any
  const snapshotScriptForEnv =
    snapshot.scriptsByEnv.get(env) ?? snapshot.fallbackEnvScript;

  if (snapshotScriptForEnv == null) {
    return
  }

  // Get executed scripts
  const executedScripts = await storage.executed({ context });

  // Check if upTo is before the snapshot (invalid - can't skip the snapshot)
  if (
    upTo !== undefined &&
    compareScriptNames(snapshotScriptForEnv, upTo) > 0
  ) {
    throw new Error(
      `Cannot apply migrations up to "${upTo}": this target is before the snapshot. ` +
        `Scripts covered by the snapshot have been archived and are no longer in the ` +
        `scripts directory. To reach this target, you would need to apply the snapshot ` +
        `first, but that would go beyond the specified target.\n\n` +
        `Either:\n` +
        `  - Specify a target at or after the snapshot: "${snapshotScriptForEnv}"\n` +
        `  - Or omit --up-to to apply all pending migrations including snapshots`,
    );
  }

  // Filter archived scripts to those relevant to this environment, sorted
  const relevantArchivedScripts = findScriptsToRun({
    sortedScriptSet: snapshot!.archivedScripts,
    env,
  });

  // Determine which archived scripts are missing (not yet executed)
  const missingArchivedScripts = filterSortedScriptNames(
    relevantArchivedScripts,
    (script) => !executedScripts.includes(script),
  );

  // If all archived scripts are missing, do nothing -- return the snapshot (and
  // anything after it) as the valid scripts, and let umzug run the migrations
  // as normal.
  if (missingArchivedScripts.length === relevantArchivedScripts.length) {
    return 
  }

  // Otherwise, run missing archived scripts and mark snapshot as executed.
  // This catches umzug up so migrations after the snapshot can run as normal.
    for (const scriptName of missingArchivedScripts) {
      const scriptPath = path.join(snapshot.archiveFolderPath, scriptName);
      logger?.log(`Running archived script "${scriptName}" to catch up to snapshot.`);

      await runAndLogScript({
        scriptName,
        scriptPath,
        context,
        storage,
        resolveScript,
      });
    }
  

  await storage.logMigration({ name: snapshotScriptForEnv, context });
  return 
}