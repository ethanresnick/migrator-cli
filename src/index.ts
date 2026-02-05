import type { FileBaseName } from "./utils.js";
import { isParsedSnapshotScript, findScriptsToRun } from "./script-utils.js";
import { parseScriptName } from "./script-name-parsing/index.js";

export type {
  DatabaseConfig,
  SnapshotResult,
} from "./DatabaseConfig.js";
export { isParsedSnapshotScript, findScriptsToRun } from "./script-utils.js";
export { createSnapshotAndArchiveCoveredScripts as createSnapshot } from "./snapshotting/create-snapshot.js";
export { catchUpToSnapshot as prepareScriptApplication } from "./snapshotting/catch-up-to-snapshot.js";
export { wrapMigration, toFileBaseName, type FileBaseName } from "./utils.js";

/**
 * Returns whether the given script is a snapshot (schema or data).
 *
 * Accepts a FileBaseName to ensure callers have explicitly extracted the basename.
 * Use {@link toFileBaseName} to convert a path to a FileBaseName.
 */
export function isSnapshotScript(scriptName: FileBaseName): boolean {
  const parsed = parseScriptName(scriptName);
  return isParsedSnapshotScript(parsed);
}
