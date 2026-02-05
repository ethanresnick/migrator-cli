import { readdir } from "fs/promises";
import type { Tagged } from "type-fest";
import { instantiateTaggedType } from "type-party/runtime/tagged-types.js";
import {
  nameScript,
  parseScriptName, type ParsedScriptMetadata,
  type ValidEnvName,
  type ValidScriptFileName,
  type ValidScriptFormat
} from "./script-name-parsing/index.js";
import {
  toAbsolutePath,
  toFileBaseName,
  type AbsolutePath,
  type FileBaseName,
} from "./utils.js";

/**
 * Script types that can be created via the `add` command.
 */
export const scriptTypes = ["seed", "migration"] as const;
export type ScriptType = (typeof scriptTypes)[number];

export function isParsedSnapshotScript(parsed: ParsedScriptMetadata): boolean {
  return parsed.type === "snapshot";
}

export function findScriptsToRun(opts: {
  sortedScriptSet: SortedScriptFileNames;
  // Undefined means "any env not currently in the supported environment list";
  // this just results in "fallback" snapshots being included in the result.
  env: ValidEnvName | undefined;
}) {
  const { sortedScriptSet, env } = opts;
  const parsedScripts = sortedScriptSet.map((it) => parseScriptName(it));

  // Can include a previously-generated fallback snapshot with env as undefined.
  const envsWithSnapshotInScripts = new Set<ValidEnvName | undefined>(
    parsedScripts.filter((s) => s.type === "snapshot").map((s) => s.env),
  );

  const res = parsedScripts
    .filter((scriptMetadata) => {
      switch (scriptMetadata.type) {
        // Migrations always run on all envs;
        case "migration":
          return true;

        //seeds run on the env they target.
        case "seed":
          return scriptMetadata.env === env;

        // snapshots are trickier: they run if the env matches (including if
        // this is the fallback snapshot and we're dealing with an unknown env)
        // OR if we're dealing with the fallback snapshot and `env` doesn't
        // have a dedicated snapshot for it.
        case "snapshot":
          return (
            scriptMetadata.env === env ||
            (scriptMetadata.env === undefined &&
              !envsWithSnapshotInScripts.has(env))
          );
      }
    })
    .map((s) => nameScript(s));

  return instantiateTaggedType<SortedScriptFileNames>(res);
}

/**
 * Load all scripts in the scripts directory; used by subsequent operations.
 * Will include the snapshot, if any. Will ignore any files that have invalid
 * names (i.e., that wouldn't be valid for any DatabaseConfig) or use
 * unsupported formats for the particular DatabaseConfig.
 */
export async function loadSortedScripts(
  scriptsDirectory: string,
  supportedFormats: readonly ValidScriptFormat[],
): Promise<SortedScripts> {
  const scriptsDirectoryAbsolutePath = toAbsolutePath(scriptsDirectory);
  const entries = await readdir(scriptsDirectoryAbsolutePath, {
    withFileTypes: true,
  });

  const validScripts = entries
    .filter((entry) => {
      if (!entry.isFile()) {
        return false;
      }
      try {
      const parsed = parseScriptName(toFileBaseName(entry.name));
      return supportedFormats.includes(parsed.format);
      } catch {
        // Ignore invalid script names
        return false;
      }
    })
    .map((entry) => {
      // We parsed above, so this is safe.
      return instantiateTaggedType<ValidScriptFileName>(entry.name);
    });

  return {
    scriptDirectory: scriptsDirectoryAbsolutePath,
    scriptNames: sortScriptNames(validScripts),
  };
}

// =============================================================================
// Script Ordering
// =============================================================================

export type SortedScriptFileNames = Tagged<
  readonly ValidScriptFileName[],
  "SortedScriptFileNames"
>;
export type SortedScripts = {
  scriptDirectory: AbsolutePath;
  scriptNames: SortedScriptFileNames;
};

const TYPE_SORT_ORDER = { migration: 0, seed: 1, snapshot: 2 } as const;

/**
 * Comparison function for sorting scripts in canonical order. Scripts are
 * sorted by timestamp first, then by type (migration < seed < snapshot), then
 * lexicographically for tie-breaking. This ensures snapshots always sort after
 * the migrations and seeds that the snapshot absorbed, regardless of script
 * names.
 */
export function compareScriptNames(a: FileBaseName, b: FileBaseName): number {
  const parsedA = parseScriptName(a);
  const parsedB = parseScriptName(b);

  if (parsedA.date.getTime() !== parsedB.date.getTime()) {
    return parsedA.date.getTime() < parsedB.date.getTime() ? -1 : 1;
  }

  const typeOrderA = TYPE_SORT_ORDER[parsedA.type];
  const typeOrderB = TYPE_SORT_ORDER[parsedB.type];

  if (typeOrderA !== typeOrderB) {
    return typeOrderA - typeOrderB;
  }

  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortScriptNames(
  scriptNames: readonly ValidScriptFileName[],
): SortedScriptFileNames {
  return instantiateTaggedType<SortedScriptFileNames>(
    scriptNames.toSorted(compareScriptNames),
  );
}

export function filterSortedScriptNames(
  scriptNames: SortedScriptFileNames,
  predicate: (scriptName: FileBaseName) => boolean,
): SortedScriptFileNames {
  return instantiateTaggedType<SortedScriptFileNames>(
    scriptNames.filter(predicate),
  );
}
