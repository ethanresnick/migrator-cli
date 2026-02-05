import { mkdir, rename, writeFile } from "fs/promises";
import path from "path";
import { instantiateTaggedType } from "type-party/runtime/tagged-types.js";
import type { DatabaseConfig } from "../DatabaseConfig.js";
import {
  nameScript,
  parseScriptName,
  toValidScriptFormat,
  toValidScriptTimestamp,
  type ValidEnvName,
  type ValidScriptFileName,
  type ValidScriptTimestamp,
} from "../script-name-parsing/index.js";
import {
  compareScriptNames,
  findScriptsToRun,
  isParsedSnapshotScript,
  type SortedScriptFileNames,
  type SortedScripts,
} from "../script-utils.js";
import type { AbsolutePath, FileBaseName } from "../utils.js";

type GenerateSnapshotFn = OmitThisParameter<
  Exclude<DatabaseConfig["generateSnapshot"], undefined>
>;

/**
 * Creates snapshot files for all environments and archives the original scripts.
 */
export async function createSnapshotAndArchiveCoveredScripts(opts: {
  sortedScripts: SortedScripts;
  snapshotArchivesDirectory: AbsolutePath;
  supportedEnvironments: readonly ValidEnvName[];
  generateSnapshot: GenerateSnapshotFn;
  /** Only include scripts up to this name (lexicographically) */
  upTo?: FileBaseName;
  logger?: { log: (msg: string) => void };
}): Promise<{
  snapshotTimestamp: ValidScriptTimestamp;
  newSnapshotFiles: ValidScriptFileName[];
  archivedScripts: ValidScriptFileName[];
}> {
  const {
    sortedScripts,
    snapshotArchivesDirectory,
    supportedEnvironments,
    generateSnapshot,
    upTo,
    logger,
  } = opts;

  // Convert to script info objects and filter by upTo
  const allScriptsToArchive = sortedScripts.scriptNames
    .map((scriptName) => ({
      path: path.join(sortedScripts.scriptDirectory, scriptName),
      name: scriptName,
      parsed: parseScriptName(scriptName),
    }))
    .filter((s) => !upTo || compareScriptNames(s.name, upTo) <= 0);

  if (allScriptsToArchive.length === 0) {
    throw new Error("No scripts to snapshot");
  }

  const hasMigrationsOrSeeds = allScriptsToArchive.some(
    (s) => !isParsedSnapshotScript(s.parsed),
  );
  if (!hasMigrationsOrSeeds) {
    throw new Error(
      "No migrations or seeds to snapshot - scripts directory contains only snapshot files",
    );
  }

  // Snapshot timestamp is the same as the last script being archived, not the
  // current time. This mostly only matters when --up-to is used, and it ensures
  // the snapshot sorts correctly relative to any scripts that exist after the
  // --up-to target. Also, gives snapshots a deterministic timestamp given their
  // input scripts.
  const lastScriptToArchive = allScriptsToArchive.at(-1)!;
  const snapshotDate = lastScriptToArchive.parsed.date;
  const snapshotTimestamp = toValidScriptTimestamp(lastScriptToArchive.parsed.date);

  // Generate snapshots for all supported environments in parallel, and one for
  // any future envs (the "fallback" env). Undefined for the fallback env.
  const scriptsToArchiveNames = instantiateTaggedType<SortedScriptFileNames>(
    allScriptsToArchive.map((s) => s.name),
  );
  const snapshotScriptsByEnv = new Map(
    [...supportedEnvironments, undefined].map((env) => [
      env,
      findScriptsToRun({
        sortedScriptSet: scriptsToArchiveNames,
        env,
      }),
    ]),
  );

  const snapshotResults = await Promise.all(
    snapshotScriptsByEnv.entries().map(async ([env, scripts]) => {
      if (scripts.length === 0) {
        return null;
      }

      return generateSnapshot(
        scripts.map((it) => ({
          path: path.join(sortedScripts.scriptDirectory, it),
          name: it,
        })),
        env ?? undefined,
      ).then((result) => {
        const newSnapshotName = nameScript({
          date: snapshotDate,
          type: "snapshot",
          format: toValidScriptFormat(result.format),
          env: env,
        });

        return {
          newSnapshotName,
          path: path.join(sortedScripts.scriptDirectory, newSnapshotName),
          content: result.migrationScriptContent,
        };
      });
    }),
  ).then((results) => results.filter((it) => it !== null));

  // Write all snapshot files in parallel
  const newSnapshotFiles = snapshotResults.map((it) => it.newSnapshotName);
  await Promise.all(
    snapshotResults.map(({ path, content }) => {
      return writeFile(path, content).then(() =>
        logger?.log(`Created: ${path}`),
      );
    }),
  );

  // Move ALL original scripts to archive folder
  const archiveFolderPath = path.resolve(
    snapshotArchivesDirectory,
    snapshotTimestamp,
  );
  await mkdir(archiveFolderPath, { recursive: true });

  // Archive all scripts in parallel
  const archivedScripts = allScriptsToArchive.map((s) => s.name);
  await Promise.all(
    allScriptsToArchive.map(async (script) => {
      const destPath = path.join(archiveFolderPath, script.name);
      await rename(script.path, destPath);
      logger?.log(`Archived: ${script.name}`);
    }),
  );

  logger?.log(
    `\nCompleted snapshot creation for all environments. Archived ${allScriptsToArchive.length} scripts to ${archiveFolderPath}. `,
  );

  return {
    snapshotTimestamp,
    newSnapshotFiles,
    archivedScripts,
  };
}
