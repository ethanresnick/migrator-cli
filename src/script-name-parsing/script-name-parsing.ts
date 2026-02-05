import { instantiateTaggedType } from "type-party/runtime/tagged-types.js";
import { assertUnreachable, type FileBaseName } from "../utils.js";
import {
  toValidEnvName,
  toValidScriptFormat,
  toValidScriptName,
  toValidScriptTimestamp,
  type ValidEnvName,
  type ValidScriptFileName,
  type ValidScriptFormat,
  type ValidScriptName,
  type ValidScriptTimestamp,
} from "./name-component-validation.js";

export type ParsedScriptMetadata =
  | {
      date: Date;
      type: "migration";
      format: ValidScriptFormat;
      // migrations are inherently cross-env.
      env?: undefined;
      // But must have a name that describes what the migration does.
      name: ValidScriptName;
    }
  | {
      date: Date;
      type: "seed";
      format: ValidScriptFormat;
      // whereas seeds must have a name and an environment they target.
      env: ValidEnvName;
      name: ValidScriptName;
    }
  | {
      date: Date;
      type: "snapshot";
      format: ValidScriptFormat;
      // A snapshot can either apply to one env or to _any env which doesn't
      // have a dedicated snapshot_. So, 2026.02.06T12.00.00.snapshot.dev.sql
      // would run when restoring dev, but 2026.02.06T12.00.00.snapshot.sql
      // would NOT run when restoring dev from a snapshot; it would run if
      // restoring a different env that has no dedicated snapshot.
      env: ValidEnvName | undefined;
      name?: undefined;
    };

/**
 * Parses a script filename to extract its components. This is the inverse of
 * {@link nameScript}. Throws if the filename doesn't match any known script
 * pattern.
 *
 * Accepts a FileBaseName to ensure callers have explicitly extracted the
 * basename. Use {@link toFileBaseName} to convert a path to a FileBaseName.
 */
export function parseScriptName(
  scriptName: FileBaseName,
): ParsedScriptMetadata {
  const timestampPattern =
    "(\\d{4}\\.\\d{2}\\.\\d{2}T\\d{2}\\.\\d{2}\\.\\d{2})";

  // Match snapshot: {timestamp}.snapshot{.env}?.{format}
  const snapshotMatch = scriptName.match(
    new RegExp(`^${timestampPattern}\\.snapshot(\\.([^.]+))?\\.([^.]+)$`),
  );

  if (snapshotMatch) {
    const [_, timestampString, __, env, format] = snapshotMatch;
    return {
      date: parseTimestamp(
        instantiateTaggedType<ValidScriptTimestamp>(timestampString!),
      ),
      format: toValidScriptFormat(format!),
      env: env ? toValidEnvName(env!) : undefined,
      type: "snapshot" as const,
      name: undefined,
    };
  }

  // Match migration: {timestamp}.{name}.{format}
  const migrationMatch = scriptName.match(
    new RegExp(`^${timestampPattern}\\.([^.]+)\\.([^.]+)$`),
  );

  if (migrationMatch) {
    const [, timestampString, name, format] = migrationMatch;

    return {
      date: parseTimestamp(
        instantiateTaggedType<ValidScriptTimestamp>(timestampString!),
      ),
      format: toValidScriptFormat(format!),
      env: undefined,
      type: "migration" as const,
      name: toValidScriptName(name!, false),
    };
  }

  // Match seed: {timestamp}.{name}.seed.{env}.{format}
  const seedMatch = scriptName.match(
    new RegExp(`^${timestampPattern}\\.(.+)\\.seed\\.([^.]+)\\.([^.]+)$`),
  );
  if (seedMatch) {
    const [, timestampString, name, env, format] = seedMatch;

    return {
      date: parseTimestamp(
        instantiateTaggedType<ValidScriptTimestamp>(timestampString!),
      ),
      format: toValidScriptFormat(format!),
      env: toValidEnvName(env!),
      type: "seed" as const,
      name: toValidScriptName(name!, false),
    };
  }

  throw new Error(`Invalid script name: ${scriptName}`);
}

export function parseTimestamp(timestamp: ValidScriptTimestamp): Date {
  // Format is "YYYY.MM.DDTHH.MM.SS" - use regex to properly parse
  const match = timestamp.match(
    /^(\d{4})\.(\d{2})\.(\d{2})T(\d{2})\.(\d{2})\.(\d{2})$/,
  );

  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day) ||
    isNaN(hour) ||
    isNaN(minute) ||
    isNaN(second)
  ) {
    throw new Error(`Invalid timestamp values: ${timestamp}`);
  }

  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Generates the full filename for a script file from (already validated)
 * components. This function enforces a naming convention that allows us to
 * identify the script type and, for seeds, which environment it should run in.
 */
export function nameScript(opts: ParsedScriptMetadata): ValidScriptFileName {
  const { date, type, format, env, name } = opts;
  const timestamp = toValidScriptTimestamp(date);

  switch (type) {
    case "migration":
      return instantiateTaggedType<ValidScriptFileName>(
        `${timestamp}.${name}.${format}`,
      );
    case "seed":
      return instantiateTaggedType<ValidScriptFileName>(
        `${timestamp}.${name}.seed.${env}.${format}`,
      );
    case "snapshot":
      return instantiateTaggedType<ValidScriptFileName>(
        `${timestamp}.snapshot${env ? `.${env}` : ""}.${format}`,
      );
    default:
      assertUnreachable(type);
  }
}
