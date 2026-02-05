import type { Tagged } from "type-fest";
import { instantiateTaggedType } from "type-party/runtime/tagged-types.js";
import type { FileBaseName } from "../utils.js";

export type ValidEnvName<T extends string = string> = Tagged<T, "ValidEnvName">;
export type ValidScriptFormat<T extends string = string> = Tagged<
  T,
  "ValidScriptFormat"
>;
export type ValidScriptFileName = Tagged<FileBaseName, "ValidScriptFileName">;
export type ValidScriptTimestamp = Tagged<string, "ValidScriptTimestamp">;

// The user-provided portion of a script name.
export type ValidScriptName = Tagged<string, "ValidScriptName">;

/**
 * Validates that a string is a valid environment name.
 * Throws if invalid.
 *
 * Environments:
 * - Cannot be empty or whitespace-only
 * - Cannot contain dots (used as delimiters in filenames)
 * - Must match pattern: alphanumeric, hyphens, underscores
 */
export function toValidEnvName(env: string): ValidEnvName {
  if (env.length === 0) {
    throw new Error("Environment cannot be empty");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(env)) {
    throw new Error(
      `Environment must contain only alphanumeric, hyphens, or underscores: "${env}"`,
    );
  }
  return instantiateTaggedType<ValidEnvName>(env);
}

/**
 * Validates that a string is a valid script format (file extension).
 * Throws if invalid.
 *
 * Formats:
 * - Cannot be empty or whitespace-only
 * - Cannot contain dots (used as delimiters in filenames)
 * - Must only contain alphanumeric characters
 */
export function toValidScriptFormat(format: string): ValidScriptFormat {
  if (format.length === 0) {
    throw new Error("Format cannot be empty");
  }
  if (!/^[a-zA-Z0-9]+$/.test(format)) {
    throw new Error(`Format must be alphanumeric only: "${format}"`);
  }
  return instantiateTaggedType<ValidScriptFormat>(format);
}

/**
 * Formats a Date as a timestamp string in the format used for migration
 * prefixes. Validates it in the process (date's time cannot be NaN).
 *
 * Format: YYYY.MM.DDTHH.MM.SS (e.g., "2024.02.04T19.00.00")
 */
export function toValidScriptTimestamp(date: Date): ValidScriptTimestamp {
  if (isNaN(date.getTime())) {
    throw new Error("Date is invalid (NaN)");
  }

  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return instantiateTaggedType<ValidScriptTimestamp>(
    `${year}.${month}.${day}T${hours}.${minutes}.${seconds}`,
  );
}

/**
 * Validates that a string is a valid script name (user-provided portion).
 * Throws if invalid.
 *
 * Names:
 * - Cannot be empty or whitespace-only
 * - Cannot contain dots (used as delimiters in filenames)
 * - Must match pattern: alphanumeric, hyphens, underscores
 */
export function toValidScriptName(name: string, allowSnapshotNames: boolean): ValidScriptName {
  if (name.length === 0) {
    throw new Error("Script name cannot be empty");
  }
  // Must contain only safe characters for filenames (no dots)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Script name must contain only alphanumeric, hyphens, or underscores: "${name}"`,
    );
  }
  if (!allowSnapshotNames && isReservedSnapshotName(name)) {
    throw new Error(
      `Script name "${name}" is reserved for snapshot scripts.`,
    );
  }
  return instantiateTaggedType<ValidScriptName>(name);
}

function isReservedSnapshotName(name: string): boolean {
  return name === "snapshot";
}