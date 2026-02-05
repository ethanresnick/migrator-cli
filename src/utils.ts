import path from "path";
import type { Tagged } from "type-fest";
import { instantiateTaggedType } from "type-party/runtime/tagged-types.js";
import type { RunnableMigration } from "umzug";

export function wrapMigration<T>(
  hooks: {
    runBefore?: () => void | Promise<void>;
    runAfter?: () => void | Promise<void>;
  },
  migration: RunnableMigration<T>
) {
  return {
    ...migration,
    async up(params) {
      await hooks.runBefore?.();
      await migration.up(params);
      await hooks.runAfter?.();
    },
    ...(migration.down
      ? {
          async down(params) {
            await hooks.runBefore?.();
            await migration.down!(params);
            await hooks.runAfter?.();
          },
        }
      : {}),
  } satisfies RunnableMigration<T>;
}

export function assertStringInOptions<
  T extends string,
  U extends string,
>(
  string: T,
  options: readonly U[],
  optionGroupName: string
): asserts string is T & U {
  if (!(options as T & U[]).includes(string)) {
    throw new Error(
      `String "${string}" is not in the list of legal ${optionGroupName}: [${options.join(
        ", "
      )}]`
    );
  }
}

export function assertUnreachable(type: never): never {
  throw new Error("Function not implemented.");
}

// =============================================================================
// Filesystem utility tagged types
// =============================================================================

/** Represents a file's basename (filename without directory path, but including extension) */
export type FileBaseName = Tagged<string, "FileBaseName">;
export type AbsolutePath = Tagged<string, "AbsolutePath">;

/**
 * Extracts the basename from a path and returns it as a FileBaseName.
 * If the input is already a basename (no path separators), it is returned as-is.
 */
export function toFileBaseName(pathOrName: string): FileBaseName {
  return instantiateTaggedType<FileBaseName>(path.basename(pathOrName));
}

export function toAbsolutePath(thePath: string): AbsolutePath {
  const absolutePath = path.isAbsolute(thePath)
    ? instantiateTaggedType<AbsolutePath>(thePath)
    : instantiateTaggedType<AbsolutePath>(path.resolve(thePath));
  return absolutePath;
}
