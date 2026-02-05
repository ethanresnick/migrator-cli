# Snapshot Feature Test Plan

This document provides a comprehensive test plan for the snapshot feature and related script naming/parsing logic. It emphasizes **property-based testing** for pure functions (parsing, serialization, validation) and **example-based/integration testing** for orchestration and edge cases.

---

## Test Coverage Status (as of last update)

| Section | Tests | Status | File |
|---------|-------|--------|------|
| **3.1** parseScriptName / nameScript | P1–P4 (round-trip), P5–P8 (examples), P9–P11 | ✅ | script-name-parsing.test.ts |
| **3.2** parseTimestamp / toValidScriptTimestamp | P12–P18 | ✅ | script-name-parsing.test.ts |
| **3.3** toValidEnvName | P19–P23 | ✅ | name-component-validation.test.ts |
| **3.4** toValidScriptFormat | P24–P26 | ✅ | name-component-validation.test.ts |
| **3.5** toValidScriptName | P27–P31 | ✅ | name-component-validation.test.ts |
| **3.6** findScriptsToRun | P32–P40 | ✅ | script-utils.test.ts |
| **3.7** compareScriptNames / sortScriptNames | P41–P43 | ✅ | script-utils.test.ts |
| **3.8** isParsedSnapshotScript | P45–P46 | ✅ | script-utils.test.ts |
| **3.9** toFileBaseName | P47–P49 | ✅ | utils.test.ts |
| **4** Edge cases | E1–E15 | ✅ | script-name-parsing.test.ts |
| **5.1** createSnapshotAndArchiveCoveredScripts | I1–I3, I5 | ✅ | create-snapshot.test.ts |
| **5.2** catchUpToSnapshot | I10, I12, I15, I16 | ✅ | catch-up-to-snapshot.test.ts |
| **5.4** E2E Integration | E2E-1, 2, 3, 4, 5, 8, 12, 17, 18, 19, 20, 28, 31, 32, 34 | ✅ | snapshot-integration.test.ts |
| **loadSortedScripts** | Filters by extension (supportedFormats) | ✅ | script-utils.test.ts |

**Not yet covered:** I4, I6–I9, I11, I13–I14, I17–I20; E2E-6, 7, 9–11, 13–16, 21–22, 29–30, 33, 35.

---

## 1. Property-Based Testing Style

The existing `script-generator.test.ts` uses **fast-check** with this pattern:

1. **Arbitraries (generators)** filter inputs through the code's own validation functions. This ensures:
   - Tests reflect real constraints enforced by the code
   - If validation rules change, tests adapt automatically
   - Edge cases (e.g., `Date(NaN)`, empty strings) are caught when validation rejects them

2. **Round-trip properties**: `parseScriptName(nameScript(opts))` recovers all original fields.

3. **Consistency properties**: Functions like `findScriptsToRun` and `isParsedSnapshotScript` behave consistently across arbitrary inputs.

4. **Format/ordering properties**: Timestamps are lexicographically sortable; script names follow expected patterns.

---

## 2. Arbitraries (Generators)

Use these generators, filtering through the actual validation functions:

| Arbitrary | Source | Filter | Notes |
|-----------|--------|--------|-------|
| `arbDate` | `fc.integer(min, max).map(ts => new Date(ts))` | `!isNaN(date.getTime())` | Reject `Date(NaN)` |
| `arbFormat` | `fc.string({ minLength: 1, maxLength: 10 })` | `toValidScriptFormat` (wrap in try/catch) | Alphanumeric only, no dots |
| `arbEnv` | `fc.string({ minLength: 1, maxLength: 20 })` | `toValidEnvName` | Alphanumeric, hyphens, underscores |
| `arbUserName` | `fc.string({ minLength: 1, maxLength: 30 })` | `s => toValidScriptName(s, false)` | Excludes reserved "snapshot" |
| `arbUserNameAllowSnapshot` | Same | `s => toValidScriptName(s, true)` | For parsing tests where "snapshot" is valid |
| `arbScriptType` | `fc.constantFrom("migration", "seed", "snapshot")` | — | For snapshot, env can be `undefined` or `arbEnv` |

**Validation helper:** For arbitraries that throw on invalid input, use:

```ts
const arbFormat = fc.string({ minLength: 1, maxLength: 10 })
  .filter((s) => { try { toValidScriptFormat(s); return true; } catch { return false; } });
```

---

## 3. Pure Function Test Suites

### 3.1 `parseScriptName` / `nameScript` (script-name-parsing)

**Property: Round-trip**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P1 | `parseScriptName(nameScript(opts))` recovers all fields for **migration** | arbDate, arbFormat, arbUserName |
| P2 | Same for **seed** | arbDate, arbFormat, arbUserName, arbEnv |
| P3 | Same for **snapshot** (env-specific) | arbDate, arbFormat, arbEnv |
| P4 | Same for **snapshot** (fallback, env=undefined) | arbDate, arbFormat |

**Property: `nameScript` output format**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P5 | Migration output matches `{timestamp}.{name}.{format}` | arbDate, arbFormat, arbUserName |
| P6 | Seed output matches `{timestamp}.{name}.seed.{env}.{format}` | arbDate, arbFormat, arbUserName, arbEnv |
| P7 | Snapshot (env) matches `{timestamp}.snapshot.{env}.{format}` | arbDate, arbFormat, arbEnv |
| P8 | Snapshot (fallback) matches `{timestamp}.snapshot.{format}` | arbDate, arbFormat |

**Property: `parseScriptName` throws on invalid input**

| Test | Input | Expected |
|------|-------|----------|
| P9 | Invalid format (no timestamp) | Throws |
| P10 | Malformed timestamp (wrong separators) | Throws |
| P11 | Empty string | Throws |

---

### 3.2 `parseTimestamp` / `toValidScriptTimestamp` (script-name-parsing)

**Property: Round-trip**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P12 | `parseTimestamp(toValidScriptTimestamp(date))` returns equivalent Date (same second) | arbDate |

**Property: Timestamp format**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P13 | Output matches `/^\d{4}\.\d{2}\.\d{2}T\d{2}\.\d{2}\.\d{2}$/` | arbDate |
| P14 | Same date produces same timestamp (deterministic) | arbDate |
| P15 | Lexicographic order of timestamps matches chronological order | arbDate, arbDate, with `fc.pre` to ensure distinct seconds |

**Property: `toValidScriptTimestamp` throws**

| Test | Input | Expected |
|------|-------|----------|
| P16 | `new Date(NaN)` | Throws "Date is invalid" |

**Property: `parseTimestamp` throws**

| Test | Input | Expected |
|------|-------|----------|
| P17 | Invalid format (e.g., "2024-10-20") | Throws |
| P18 | Invalid values (e.g., month 13) | Throws |

---

### 3.3 `toValidEnvName` (name-component-validation)

**Property: Validation**

| Test | Input | Expected |
|------|-------|----------|
| P19 | Empty string | Throws |
| P20 | String with dots | Throws |
| P21 | String with spaces | Throws |
| P22 | Valid: alphanumeric, hyphens, underscores | Returns tagged value |
| P23 | Single character | Valid | 

**Property-based:** `toValidEnvName(s)` succeeds iff `s` matches `/^[a-zA-Z0-9_-]+$/` and `s.length > 0`.

---

### 3.4 `toValidScriptFormat` (name-component-validation)

**Property: Validation**

| Test | Input | Expected |
|------|-------|----------|
| P24 | Empty string | Throws |
| P25 | Format with hyphens/underscores | Throws (alphanumeric only) |
| P26 | Valid: "sql", "cjs", "mjs" | Returns tagged value |

**Property-based:** `toValidScriptFormat(s)` succeeds iff `s` matches `/^[a-zA-Z0-9]+$/` and `s.length > 0`.

---

### 3.5 `toValidScriptName` (name-component-validation)

**Property: Validation**

| Test | Input | allowSnapshotNames | Expected |
|------|-------|--------------------|----------|
| P27 | Empty string | any | Throws |
| P28 | "snapshot" | false | Throws "reserved" |
| P29 | "snapshot" | true | Returns tagged value |
| P30 | String with dots | any | Throws |
| P31 | "add-seed-column" (contains "seed" but not reserved) | false | Valid |

**Property-based:** `toValidScriptName(s, false)` succeeds iff `s` matches `/^[a-zA-Z0-9_-]+$/`, `s.length > 0`, and `s !== "snapshot"`.

---

### 3.6 `findScriptsToRun` (script-utils)

**Property: Migrations always included**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P32 | For any migration in script set, `findScriptsToRun` includes it for any env | arbEnv, script set with migration |

**Property: Seeds filtered by env**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P33 | Seed with env E is included only when `env === E` | arbEnv, script set with seed for env E |
| P34 | Seed with env E is excluded when `env !== E` | arbEnv, script set with seed for env E |

**Property: Snapshot filtering**

| Test | Property | Scenario |
|------|----------|----------|
| P35 | Env-specific snapshot (e.g., `snapshot.dev`) runs only when env is dev | Script set: {snapshot.dev.sql}, env=dev → included |
| P36 | Env-specific snapshot excluded when env differs | Script set: {snapshot.dev.sql}, env=prod → excluded |
| P37 | Fallback snapshot (`snapshot.sql`) runs when env has no dedicated snapshot | Script set: {snapshot.sql}, env=prod → included |
| P38 | Fallback snapshot excluded when env has dedicated snapshot | Script set: {snapshot.sql, snapshot.dev.sql}, env=dev → fallback excluded |
| P39 | Fallback snapshot runs for "unknown" env (undefined) | Script set: {snapshot.sql}, env=undefined → included |

**Property: Result is sorted**

| Test | Property |
|------|----------|
| P40 | `findScriptsToRun` returns scripts in same order as input (filtered subset) |

---

### 3.7 `compareScriptNames` / `sortScriptNames` (script-utils)

**Property: Ordering**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P41 | `compareScriptNames(a, b)` returns -1, 0, or 1 consistently with string comparison | arbValidScriptNames |
| P42 | `sortScriptNames` is idempotent: `sortScriptNames(sortScriptNames(x)) === sortScriptNames(x)` | arbScriptNameList |
| P43 | Scripts with earlier timestamps sort before later (all types) | arbDate, arbDate (distinct), arbFormat, arbUserName, arbEnv |

---

### 3.8 `isParsedSnapshotScript` (script-utils)

**Property: Type predicate**

| Test | Property | Arbitraries |
|------|----------|-------------|
| P45 | Returns true only for `type === "snapshot"` | Parsed metadata for migration, seed, snapshot |
| P46 | Returns false for migration and seed | arbDate, arbFormat, arbUserName, arbEnv |

---

### 3.9 `toFileBaseName` (utils)

**Property: Basename extraction**

| Test | Property |
|------|----------|
| P47 | `toFileBaseName("/path/to/file.sql")` returns `"file.sql"` |
| P48 | `toFileBaseName("file.sql")` returns `"file.sql"` (no path separators) |
| P49 | `toFileBaseName("")` returns `""` |

---

## 4. Edge Cases (Parsing & Validation)

### 4.1 Regex Match Order Ambiguity

**Critical:** `parseScriptName` tries patterns in order: migration → snapshot → seed. The migration pattern is `{timestamp}.{name}.{format}` with `name = [^.]+`.

| Edge Case | Input | Expected | Notes |
|-----------|-------|----------|-------|
| E1 | `2024.02.04T19.00.00.snapshot.sql` | Should parse as **snapshot** (fallback) | If migration is tried first, migration would match with name="snapshot", then `toValidScriptName("snapshot", false)` throws. **Verify** snapshot is tried before migration, or migration explicitly excludes name="snapshot". |
| E2 | `2024.02.04T19.00.00.snapshot.dev.sql` | Should parse as **snapshot** (env=dev) | Same ordering concern. |

### 4.2 Seed Name Ambiguity

The seed regex uses `(.+)` for name (greedy). A seed name could theoretically contain `.seed.` in the middle.

| Edge Case | Input | Expected | Notes |
|-----------|-------|----------|-------|
| E3 | `2024.02.04T19.00.00.add.seed.column.seed.dev.sql` | Parse or throw | Greedy `(.+)` could match `add.seed.column`; `toValidScriptName` rejects dots. Should throw. |
| E4 | `2024.02.04T19.00.00.my-migration.seed.dev.sql` | Parses as seed, name="my-migration" | Standard case. |

### 4.3 Migration vs Seed Overlap

| Edge Case | Input | Expected |
|-----------|-------|----------|
| E5 | `2024.02.04T19.00.00.create-users.sql` | Migration (no `.seed.` in name) |
| E6 | `2024.02.04T19.00.00.create-users.seed.dev.sql` | Seed |

### 4.4 Timestamp Edge Cases

| Edge Case | Input | Expected |
|-----------|-------|----------|
| E7 | `2024.02.29T12.00.00` (leap year) | Valid |
| E8 | `2023.02.29T12.00.00` (non-leap) | `parseTimestamp` may produce invalid date; verify behavior |
| E9 | `2024.13.01T12.00.00` (month 13) | `parseTimestamp` throws |
| E10 | `2024.00.01T12.00.00` (month 0) | Verify behavior |
| E11 | `2024.02.04T24.00.00` (hour 24) | Verify behavior (JS Date may roll over) |

### 4.5 Format Edge Cases

| Edge Case | Input | Expected |
|-----------|-------|----------|
| E12 | `2024.02.04T19.00.00.x.sql` | Migration with name="x", format="sql" |
| E13 | `2024.02.04T19.00.00.x.y.sql` | Migration: name="x", format="y"? Or invalid? Format is `[^.]+` so "y" then ".sql" left over – no match. |

### 4.6 Environment Edge Cases

| Edge Case | Input | Expected |
|-----------|-------|----------|
| E14 | `2024.02.04T19.00.00.snapshot..sql` | `snapshot.` with empty env? Regex may match empty string for env. Verify. |
| E15 | Env with leading/trailing hyphen: `_dev` | `toValidEnvName` allows; verify in filenames. |

---

## 5. Integration / Orchestration Tests

### 5.1 `createSnapshotAndArchiveCoveredScripts`

| Test | Scenario | Expected |
|------|----------|----------|
| I1 | No scripts in directory | Throws "No scripts to snapshot" |
| I2 | Single migration script | Creates snapshot, archives script, snapshot timestamp = script timestamp |
| I3 | Migration + seed for same env | Both archived, snapshot generated for that env |
| I4 | Migration + seeds for multiple envs | Snapshots generated per env + fallback |
| I5 | `--up-to` before last script | Only scripts up to that point archived |
| I6 | `--up-to` equals last script | Same as no up-to |
| I7 | `--up-to` after last script | Same as no up-to |
| I8 | Empty env (no scripts for env) | No snapshot for that env (null from map) |
| I9 | Scripts already in archive (re-run) | Should fail or handle gracefully (archive exists) |

### 5.2 `catchUpToSnapshot`

| Test | Scenario | Expected |
|------|----------|----------|
| I10 | No snapshot in scripts | Returns immediately, no-op |
| I11 | Snapshot exists, no archived scripts executed | Returns, lets Umzug run all |
| I12 | Snapshot exists, some archived scripts executed | Runs missing scripts from archive, logs snapshot |
| I13 | Snapshot exists, all archived scripts executed | Logs snapshot (no scripts to run) |
| I14 | Snapshot for env A, current env B (no snapshot for B) | Fallback or env-specific handling |
| I15 | `upTo` before snapshot | Throws |
| I16 | Archive folder missing | Throws |
| I17 | Multiple snapshots (different timestamps) | Throws |

### 5.3 `loadAndValidateSnapshot`

| Test | Scenario | Expected |
|------|----------|----------|
| I18 | Non-snapshot script before snapshot | Throws integrity error |
| I19 | Archive folder exists but empty | Valid |
| I20 | Snapshot with env, fallback with env=undefined | Both in scriptsByEnv / fallbackEnvScript |

---

## 5.4 Full End-to-End Integration Tests (Mock DB + Storage)

These tests use a **mock database config** and **mock storage** to exercise the full create → apply flow. They verify **directory structure** and **executed log** after various combinations of creating and applying snapshots.

**Test infrastructure:**
- `createMockDatabaseConfig`: Mock with `generateSnapshot`, `resolveScript`, `createStorage`, `createContext`
- Mock storage: Tracks `executed` scripts via `logMigration`; `executed()` returns list of applied script names
- `setupTestScripts(scriptsDir, { "scriptName.sql": "content" })`: Populate scripts directory
- `loadSortedScripts` → `createSnapshotAndArchiveCoveredScripts` or `catchUpToSnapshot` → run remaining migrations (Umzug or equivalent)

**Naming convention in tests:** Use current format: `{timestamp}.{name}.{format}` for migrations, `{timestamp}.{name}.seed.{env}.{format}` for seeds, `{timestamp}.snapshot{.env}?.{format}` for snapshots.

---

### Create → Verify Directory Structure

| Test | Initial Scripts | Action | Verify Directory | Verify Archive |
|------|-----------------|--------|-------------------|----------------|
| E2E-1 | 1 migration, 1 env | Create snapshot | Scripts dir: snapshot file(s) per env + fallback, 0 originals | Archive: 1 migration |
| E2E-2 | 2 migrations | Create snapshot | Scripts dir: snapshot file(s), 0 originals | Archive: 2 migrations |
| E2E-3 | 1 migration + 1 seed (local-dev) | Create snapshot | Scripts dir: `snapshot.local-dev.sql` + `snapshot.sql` (fallback), 0 originals | Archive: migration + seed |
| E2E-4 | 1 migration + seeds for local-dev, staging | Create snapshot | Scripts dir: `snapshot.local-dev.sql`, `snapshot.staging.sql`, `snapshot.sql`, 0 originals | Archive: migration + both seeds |
| E2E-5 | 3 migrations, use `--up-to` middle one | Create snapshot | Scripts dir: 1 snapshot + 1 migration (third), 0 archived originals | Archive: first 2 migrations only |
| E2E-6 | 1 migration + 1 seed (local-dev) + 1 post-snapshot migration | Create snapshot | Scripts dir: snapshot(s) + post-snapshot migration, 0 originals | Archive: migration + seed only |
| E2E-7 | Migration only, no seeds | Create snapshot | Snapshot(s) per env + fallback (migration content only) | Archive: migration(s) |

---

### Create → Apply → Verify Executed Log (Fresh DB)

| Test | Initial Scripts | Create Snapshot | Apply (env) | Verify Executed Log |
|------|-----------------|-----------------|-------------|---------------------|
| E2E-8 | 2 migrations | Yes | local-dev | `[migration1, migration2, snapshot.local-dev]` or `[snapshot.local-dev]` (snapshot replaces archived) |
| E2E-9 | 1 migration + 1 seed (local-dev) | Yes | local-dev | Snapshot replaces both; executed = `[snapshot.local-dev]` |
| E2E-10 | 1 migration + seeds for local-dev, staging | Yes | staging | Executed = `[snapshot.staging]` (only staging snapshot) |
| E2E-11 | 2 migrations + 1 post-snapshot migration | Yes | local-dev | Executed = `[snapshot]` + `[post-snapshot-migration]` |

**Note:** For fresh DB, snapshot replaces archived scripts. Executed log should contain the snapshot script(s) for the env, not the individual archived scripts.

---

### Create → Apply → Verify Executed Log (Partial Execution / Catch-Up)

| Test | Initial Scripts | Create Snapshot | Pre-executed (storage) | Apply (env) | Verify Executed Log |
|------|-----------------|-----------------|------------------------|-------------|---------------------|
| E2E-12 | 2 migrations | Yes | `[migration1]` | local-dev | Executed: migration1, migration2 (from archive), snapshot (marked) |
| E2E-13 | 2 migrations + 1 seed | Yes | `[migration1, migration2]` | local-dev | Executed: seed (from archive), snapshot (marked) |
| E2E-14 | 2 migrations | Yes | `[migration1, migration2]` | local-dev | Executed: snapshot only (marked) — no archived scripts to run |
| E2E-15 | 2 migrations + seeds for local-dev, staging | Yes | `[migration1]` | local-dev | Executed: migration2, local-dev seed (from archive), snapshot.local-dev (marked) |
| E2E-16 | 2 migrations + seeds for local-dev, staging | Yes | `[migration1]` | staging | Executed: migration2, staging seed (from archive), snapshot.staging (marked) — no local-dev seed |

---

### Fallback Snapshot Behavior

| Test | Scripts | Envs | Apply (env) | Verify |
|------|---------|------|-------------|--------|
| E2E-17 | 1 migration + fallback snapshot only | local-dev | local-dev | Fallback snapshot runs (no env-specific snapshot) |
| E2E-18 | 1 migration + fallback + snapshot.local-dev | local-dev, staging | local-dev | snapshot.local-dev runs, fallback excluded |
| E2E-19 | 1 migration + fallback + snapshot.local-dev | local-dev, staging | staging | Fallback snapshot runs (staging has no dedicated snapshot) |

---

### Apply with Post-Snapshot Scripts

| Test | Scripts Dir After Create | Apply | Verify Executed Order |
|------|--------------------------|-------|------------------------|
| E2E-20 | Snapshot + 1 migration after | local-dev | `[snapshot]` then `[migration]` |
| E2E-21 | Snapshot + 2 migrations after | local-dev | `[snapshot]` then `[migration1, migration2]` |
| E2E-22 | Snapshot + 1 seed (local-dev) after | local-dev | `[snapshot]` then `[seed]` |

---

### Idempotency and Re-Apply

| Test | Setup | Action | Expected |
|------|-------|--------|----------|
| E2E-28 | Create snapshot, apply (full) | Apply again (same env) | No scripts run; executed log unchanged |
| E2E-29 | Create snapshot, apply (full), add new migration | Apply again | Only new migration runs |
| E2E-30 | Partial execution, apply | Apply again | No scripts run (already caught up) |

### Error / Validation Scenarios

| Test | Setup | Action | Expected |
|------|-------|--------|----------|
| E2E-31 | Snapshot in scripts dir, archive missing | Apply | Throws "Snapshot archive not found" |
| E2E-32 | Snapshot + non-snapshot script before snapshot | Apply | Throws "Integrity check failed" |
| E2E-33 | Snapshot + migration before snapshot | Apply | Throws "Integrity check failed" |
| E2E-34 | Two snapshots (different timestamps) | Apply | Throws "Found multiple snapshots" |
| E2E-35 | Apply with `--up-to` before snapshot | Apply | Throws "Cannot apply migrations up to" |

---

### Test Helper: Full Apply Flow

```ts
async function createAndApplySnapshot(opts: {
  initialScripts: Record<string, string>;
  env: string;
  supportedEnvironments: string[];
  createSnapshot: boolean;
  executedBeforeApply?: string[];
}): Promise<{
  scriptsDirContents: string[];
  archiveContents: Record<string, string[]>;
  executedLog: string[];
}> {
  // 1. Setup scripts dir
  // 2. Create mock db with generateSnapshot
  // 3. If createSnapshot: call createSnapshotAndArchiveCoveredScripts
  // 4. Create storage with executedBeforeApply
  // 5. Call catchUpToSnapshot
  // 6. Run remaining migrations (findScriptsToRun → resolveScript → up → logMigration)
  // 7. Return directory contents + executed log
}
```

---

### Mock `generateSnapshot` Contract

The real `generateSnapshot` signature is `(scripts: Array<{ path, name }>) => Promise<SnapshotResult>`. It receives **no env parameter**—the env is implicit because `createSnapshotAndArchiveCoveredScripts` calls `findScriptsToRun` per env and passes the resulting script set. The mock can:

- Return `{ migrationScriptContent: string, format: string }` (e.g., `format: "sql"`)
- Infer env from the script names (e.g., seeds contain `.seed.{env}.` to identify which env's scripts were passed)
- Use a closure to capture which env is being generated when the test sets up the mock

---

## 6. Potential Bugs to Verify

| ID | Description | Test |
|----|-------------|------|
| B1 | `parseScriptName` match order: migration before snapshot causes `2024.02.04T19.00.00.snapshot.sql` to throw | E1 |
| B2 | `compareScriptNames` with `upTo` when `upTo` uses different date format (hyphens vs dots) | E.g., `--up-to 2024-10-20` vs script names with dots |
| B3 | `findScriptsToRun` with `env: undefined` – fallback snapshot behavior | P39 |
| B4 | `parseTimestamp` with month 0 or 13 | E9, E10 |
| B5 | Seed name with dots in regex match but validation throws | E3 |

---

## 7. Test File Organization

Suggested structure:

```
src/__tests__/
├── script-name-parsing.test.ts       # parseScriptName, nameScript, parseTimestamp, toValidScriptTimestamp
├── name-component-validation.test.ts # toValidEnvName, toValidScriptFormat, toValidScriptName
├── script-utils.test.ts              # findScriptsToRun, compareScriptNames, sortScriptNames, isParsedSnapshotScript
├── utils.test.ts                     # toFileBaseName, toAbsolutePath (if needed)
├── snapshot-integration.test.ts      # Full E2E: create + apply with mock DB/storage, directory + executed log
├── snapshotting/
│   ├── create-snapshot.test.ts       # createSnapshotAndArchiveCoveredScripts (unit/integration)
│   └── catch-up-to-snapshot.test.ts  # catchUpToSnapshot, loadAndValidateSnapshot (unit/integration)
└── mocks/
    └── databaseConfig.ts             # createMockDatabaseConfig, MockStorage
```

The **snapshot-integration.test.ts** file should contain the full end-to-end tests (Section 5.4) that combine create and apply flows, using the mock database config and storage.

---

## 8. Example Property-Based Test (Template)

```ts
import * as fc from "fast-check";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nameScript, parseScriptName, toValidScriptTimestamp } from "../script-name-parsing/index.js";
import { toValidEnvName, toValidScriptFormat, toValidScriptName } from "../script-name-parsing/name-component-validation.js";

const arbDate = fc.integer({
  min: new Date("2020-01-01").getTime(),
  max: new Date("2030-12-31").getTime(),
})
  .map((ts) => new Date(ts))
  .filter((d) => !isNaN(d.getTime()));

const arbFormat = fc.string({ minLength: 1, maxLength: 10 })
  .filter((s) => { try { toValidScriptFormat(s); return true; } catch { return false; } });

const arbEnv = fc.string({ minLength: 1, maxLength: 20 })
  .filter((s) => { try { toValidEnvName(s); return true; } catch { return false; } });

const arbUserName = fc.string({ minLength: 1, maxLength: 30 })
  .filter((s) => { try { toValidScriptName(s, false); return true; } catch { return false; } });

describe("parseScriptName / nameScript round-trip", () => {
  it("recovers all fields for migration", () => {
    fc.assert(
      fc.property(arbDate, arbFormat, arbUserName, (date, format, name) => {
        const opts = { date, type: "migration" as const, format, name };
        const scriptName = nameScript(opts);
        const parsed = parseScriptName(scriptName);
        assert.equal(parsed.type, "migration");
        assert.equal(parsed.format, format);
        assert.equal(parsed.name, name);
        assert.equal(parsed.env, undefined);
        assert.equal(toValidScriptTimestamp(parsed.date), toValidScriptTimestamp(date));
      }),
      { numRuns: 100 }
    );
  });
});
```

---

## 9. Summary

- **Property-based tests** for: `parseScriptName`, `nameScript`, `parseTimestamp`, `toValidScriptTimestamp`, `toValidEnvName`, `toValidScriptFormat`, `toValidScriptName`, `findScriptsToRun`, `compareScriptNames`, `sortScriptNames`, `isParsedSnapshotScript`, `toFileBaseName`.
- **Edge cases** for: regex match order, seed name ambiguity, timestamp validity, format parsing.
- **Unit/integration tests** for: `createSnapshotAndArchiveCoveredScripts`, `catchUpToSnapshot`, `loadAndValidateSnapshot`.
- **Full E2E integration tests** (Section 5.4): Mock DB + storage; create and apply snapshots in various combinations; verify directory structure and executed log. Covers: migrations only, migrations + seeds (single/multi-env), `--up-to`, partial execution catch-up, fallback snapshot, post-snapshot scripts, idempotency, error scenarios.
- **Potential bugs** to verify: E1 (snapshot vs migration), timestamp parsing, `--up-to` format.
