# Snapshot Feature Analysis

This document describes the snapshot feature added in commit `e1781da` ("feat: add snapshot support, take 2"), including its intended behavior, edge-case handling, and identified bugs.

**Note**: This analysis has been updated to account for uncommitted changes (see "Uncommitted Changes" section below).

---

## 1. Overview: What the New Code Does

The snapshot feature allows consolidating many migration and seed scripts into a smaller set of "snapshot" scripts. The goal is to reduce the number of scripts that must be run when provisioning a fresh database (e.g., for a new developer or CI), while preserving the original scripts in an archive for integrity verification.

### High-Level Flow

1. **Create snapshot** (`migrator snapshot`): Takes all (or a subset of) migration/seed scripts, generates consolidated snapshot files via the database adapter's `generateSnapshot`, writes snapshot files to the scripts directory, and moves the original scripts into an archive folder.

2. **Apply migrations** (`migrator apply`): When applying migrations, the system first runs `catchUpToSnapshot`, which handles the case where a database has partially applied the pre-snapshot scripts. If some archived scripts have run but not all, it runs the missing ones from the archive and marks the snapshot as executed, so Umzug can then run the snapshot and any post-snapshot scripts normally.

---

## 2. Script Naming Convention (New Format)

The old `script-generator.ts` used a simple format: `{userName}.seed.{env}` for seeds and `{userName}` for migrations, with Umzug adding a timestamp prefix.

The new system uses a **timestamp-prefixed** format for all scripts:

- **Migration**: `{timestamp}.{name}.{format}` (e.g., `2024.02.04T19.00.00.add-users-table.sql`)
- **Seed**: `{timestamp}.{name}.seed.{env}.{format}` (e.g., `2024.02.04T19.00.00.seed-users.seed.dev.sql`)
- **Snapshot**: `{timestamp}.snapshot{.env}?.{format}` (e.g., `2024.02.04T19.00.01.snapshot.sql` or `2024.02.04T19.00.01.snapshot.dev.sql`)

The timestamp format is `YYYY.MM.DDTHH.MM.SS` (dots as separators).

### Snapshot Types

- **Env-specific snapshot** (`2024.02.04T19.00.01.snapshot.dev.sql`): Runs only when applying migrations for that environment.
- **Fallback snapshot** (`2024.02.04T19.00.01.snapshot.sql`): Runs for any environment that does *not* have a dedicated snapshot. Used for "future" environments not in `supportedEnvironments`.

---

## 3. Component-by-Component Behavior

### 3.1 `createSnapshotAndArchiveCoveredScripts` (create-snapshot.ts)

**Purpose**: Create snapshot files for all environments and archive the original scripts.

**Flow**:
1. Load all scripts from the scripts directory (already sorted).
2. Optionally filter by `upTo` (lexicographic comparison: include scripts where `name <= upTo`).
3. Compute snapshot timestamp = last script's timestamp (same as last script; snapshot still sorts after it because `"snapshot"` sorts after migration/seed names like `"add-x"` or `"seed-x.seed.env"`).
4. For each supported environment + `undefined` (fallback), call `findScriptsToRun` to get scripts relevant to that env.
5. Call `generateSnapshot` for each env with scripts; generate snapshot filenames and content.
6. Write snapshot files to the scripts directory.
7. Create archive folder `{snapshotArchivesDirectory}/{timestamp}`.
8. Move all original scripts (that were snapshotted) into the archive.

**Edge cases**:
- **No scripts**: Throws `"No scripts to snapshot"`.
- **`--up-to`**: Only scripts with `name <= upTo` (lexicographically) are included. Snapshot timestamp matches the last included script.
- **Empty env**: If `findScriptsToRun` returns no scripts for an env, that env gets no snapshot (returns `null` from the map).

### 3.2 `catchUpToSnapshot` (catch-up-to-snapshot.ts)

**Purpose**: Before Umzug runs, ensure the database is "caught up" to the snapshot if it has partially applied pre-snapshot scripts.

**Flow**:
1. Load and validate snapshot (if any) from the scripts directory.
2. Determine which snapshot script applies to the current env (env-specific or fallback).
3. If no snapshot applies to this env, return (do nothing).
4. Get list of executed scripts from storage.
5. If `upTo` is specified and is before the snapshot, throw (can't skip the snapshot).
6. Filter archived scripts to those relevant to this env via `findScriptsToRun`.
7. Find which archived scripts are missing (not in `executedScripts`).
8. **If all archived scripts are missing**: Do nothing; let Umzug run everything (including the snapshot) as normal.
9. **If some archived scripts are missing**: Run the missing ones from the archive, then log the snapshot as executed.

**Edge cases**:
- **No snapshot**: Returns immediately; Umzug runs migrations as before.
- **Snapshot but no script for this env**: Returns (e.g., fallback snapshot exists but current env has its own snapshot).
- **All archived scripts already executed**: Would imply snapshot was already applied; the "some missing" branch handles partial execution.
- **All archived scripts missing**: Let Umzug run everything; no catch-up needed.
- **Some archived scripts missing**: Run them from the archive, then mark snapshot executed so Umzug doesn't re-run it.

### 3.3 `loadAndValidateSnapshot`

**Purpose**: Find and validate the snapshot (if any) in the scripts directory.

**Validation**:
- At most one snapshot (by timestamp); multiple snapshots with different timestamps throw.
- No non-snapshot script in the main directory may have a timestamp before the snapshot.
- Archive folder must exist at `{snapshotArchivesDirectory}/{snapshotTimestamp}`.
- Archive folder is read to get `archivedScripts`.

**Returns**: `ValidatedSnapshot` with `scriptsByEnv`, `fallbackEnvScript`, `archiveFolderPath`, `archivedScripts`, or `null` if no snapshot.

### 3.4 `findScriptsToRun` (script-utils.ts)

**Purpose**: Filter scripts to those that should run for a given environment.

**Logic**:
- **Migrations**: Always run.
- **Seeds**: Run only if `script.env === env`.
- **Snapshots**: Run if `script.env === env`, OR if `script.env === undefined` (fallback) and `env` does not have a dedicated snapshot in the set.

### 3.5 Script Name Parsing & Validation

- **`parseScriptName`**: Parses a filename into `ParsedScriptMetadata` (date, type, format, env, name). Throws on invalid format.
- **`toValidScriptName`**: Validates user-provided names (alphanumeric, hyphens, underscores; no dots). Reserves `"snapshot"` unless `allowSnapshotNames` is true.
- **`toValidEnvName`**, **`toValidScriptFormat`**: Similar validation for env and format.
- **`nameScript`**: Builds a full filename from parsed metadata.

---

## 4. Config Changes

- **`MigratorConfig`**: Now loads full config (not just `databases`). Adds optional `snapshotArchivesDirectory` (default: `./snapshot-archives`).
- **`DatabaseConfig`**: Adds optional `generateSnapshot`, and `MigrationStorage` with `executed(): Promise<FileBaseName[]>`.
- **`SnapshotResult`**: `{ migrationScriptContent, format }` returned by `generateSnapshot`.

---

## 5. CLI Changes

- **`add`**: Uses new `nameScript` with timestamp, validated env/name/format. Uses `prefix: "NONE"` (timestamp added manually).
- **`apply`**: Calls `catchUpToSnapshot` before creating Umzug; uses `loadSortedScripts` and `findScriptsToRun` instead of glob + `shouldRun`.
- **`snapshot`** (new): Creates snapshots for all environments. Requires `supportedEnvironments` and `generateSnapshot`. Optional `--up-to` to limit scripts.

---

---

## 7. Identified Bugs

### Bug 1: `archivedScripts` used before definition (create-snapshot.ts)

**Location**: Lines 80–88

```typescript
const snapshotScriptsByEnv = new Map(
  [...supportedEnvironments, undefined].map((env) => [
    env,
    findScriptsToRun({
      sortedScriptSet:
        instantiateTaggedType<SortedScriptFileNames>(archivedScripts),  // BUG: archivedScripts is undefined
      env,
    }),
  ]),
);
```

`archivedScripts` is only defined later (line 136) as `allScriptsToArchive.map((s) => s.name)`. At this point, the scripts have not yet been archived; the intent is to use the script names that *will* be archived.

**Fix**: Use `allScriptsToArchive.map((s) => s.name)` instead, wrapped in `instantiateTaggedType<SortedScriptFileNames>(...)`.

---

### Bug 2: Wrong path when running archived scripts (catch-up-to-snapshot.ts)

**Location**: Line 286

```typescript
const scriptPath = path.join(sortedScripts.scriptDirectory, scriptName);
```

The scripts being run are the *archived* scripts—they have been moved to `snapshot.archiveFolderPath`. The main scripts directory no longer contains them. Using `sortedScripts.scriptDirectory` will cause the code to look for (and fail to find) scripts in the wrong place.

**Fix**: Use `path.join(snapshot.archiveFolderPath, scriptName)`.

---

### Bug 3: Invalid export syntax (index.ts)

**Location**: Lines 8–15

```typescript
export {
  type FileBaseName,
  isParsedSnapshotScript,
  findScriptsToRun,
export {   // Missing closing }; for first export block
  createSnapshotAndArchiveCoveredScripts as createSnapshot,
  ...
```

The first `export {` block is not closed before the second one. This is a syntax error.

**Fix**: Close the first block and merge or separate correctly, e.g.:

```typescript
export {
  type FileBaseName,
  isParsedSnapshotScript,
  findScriptsToRun,
} from "./script-utils.js";
export {
  createSnapshotAndArchiveCoveredScripts as createSnapshot,
  catchUpToSnapshot as prepareScriptApplication
} from "./snapshotting/catch-up-to-snapshot.js";
```

---

### Bug 4: `parseScriptName` used but not imported (index.ts)

**Location**: Line 26

```typescript
export function isSnapshotScript(scriptName: FileBaseName): boolean {
  const parsed = parseScriptName(scriptName);  // parseScriptName is not imported
  return isParsedSnapshotScript(parsed);
}
```

**Fix**: Add `parseScriptName` to the imports from `./script-name-parsing/index.js` (or `./script-utils.js` if re-exported there).

---

### Bug 5: `--up-to` format mismatch (cli.ts + create-snapshot)

**Location**: CLI docs and `toValidScriptName(upTo, false)` usage

The `--up-to` option is documented as: *"Include scripts up to this date/datetime (e.g., 2024-10-20 or 2024-10-20T14:00:00)"*.

- `toValidScriptName` allows only alphanumeric, hyphens, and underscores—**no dots**.
- Script names use dots in timestamps: `2024.02.04T19.00.00`.
- So `2024.10.20` or `2024.10.20T14.00.00` would be rejected.
- If the user passes `2024-10-20` (hyphens), it would pass validation, but lexicographic comparison with script names like `2024.10.20T14.00.00.add-x.sql` would be wrong: `'-'` (ASCII 45) < `'.'` (ASCII 46), so `"2024-10-20"` < `"2024.10.20"`, and scripts from that date could be excluded incorrectly.

**Fix**: Either:
- Document that `--up-to` must be a full script name (e.g. `2024.02.04T19.00.00.add-x.sql`) and relax validation for this specific use, or
- Support a date/datetime format and normalize it (e.g., convert `2024-10-20` to a comparable form like `2024.10.20` or a timestamp prefix) before comparison.

---

## 8. Summary

The snapshot feature consolidates migrations and seeds into snapshot files, archives originals, and handles databases that have partially applied pre-snapshot scripts by running missing archived scripts before letting Umzug proceed. The design accounts for env-specific vs fallback snapshots, validation of the snapshot state, and correct ordering.

The bugs above would prevent the snapshot command from running (Bug 1), cause catch-up to fail when resolving script paths (Bug 2), prevent the package from building (Bugs 3–4), and make `--up-to` confusing or incorrect for users (Bug 5).
