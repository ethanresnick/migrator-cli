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
