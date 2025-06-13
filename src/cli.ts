#!/usr/bin/env node
import glob from "glob";
import path from "path";
import { promisify } from "util";

import { Umzug } from "umzug";
import yargs from "yargs";

import type { DatabaseConfig } from "./DatabaseConfig.js";
import { nameScript, scriptTypes, shouldRun } from "./script-generator.js";

const globAsync = promisify(glob);

const dbs = await (async (): Promise<{ [k: string]: DatabaseConfig }> => {
  try {
    return await import(path.resolve(process.cwd(), ".migrator.config.mjs"));
  } catch (e) {
    try {
      return await import(path.resolve(process.cwd(), ".migrator.config.js"));
    } catch (e) {
      throw new Error(
        "Could not find .migrator.config.mjs or .migrator.config.js in current directory"
      );
    }
  }
})();

const dbOpt = {
  alias: "database",
  describe: "The database(s) to run migration against",
  type: "array",
  choices: Object.keys(dbs),
  required: true,
} as const;

const envOpt = {
  alias: "environment",
  describe:
    "Environment you're creating a seed for or running the migrations/seeds " +
    "in (effects which/whether seeds are run and how generated files are named).",
  type: "string",
  choices: ["staging", "prod", "demo"],
} as const;

const formatOpt = {
  alias: "format",
  describe: "Whether this script (seed or migration) will be in SQL or JS.",
  type: "string",
  choices: Object.values(dbs).flatMap((it) => it.supportedScriptFormats),
  demandOption: false,
  default: undefined,
} as const;

yargs(process.argv.slice(2))
  .command({
    command: "add <db> <type> <name>",
    describe: "Creates a blank migration or seed file, properly named.",
    builder(yargs) {
      return yargs
        .positional("db", {
          alias: "database",
          describe: "The name of the database for which to create the script.",
          choices: Object.keys(dbs),
          demandOption: true,
        })
        .positional("type", {
          choices: scriptTypes,
          demandOption: true,
        })
        .positional("name", {
          describe: "Name of the script to create.",
          type: "string",
          demandOption: true,
        })
        .option("env", envOpt)
        .option("format", formatOpt)
        .check((opts) => {
          if (opts.type === "seed" && !opts.env) {
            throw new Error(
              "Environment is required when adding a seed file, to indicate" +
                "in which environment the seed should be applied."
            );
          }

          if (opts.type === "migration" && opts.env) {
            throw new Error(
              "You cannot provide an environment when creating a migration; " +
                "every migration is run in every environment for schema consistency."
            );
          }

          const db = dbs[opts.db];
          if (!db) {
            throw new Error(`Database "${opts.db}" not configured`);
          }

          if (
            opts.format !== undefined &&
            !db.supportedScriptFormats.includes(opts.format)
          ) {
            throw new Error(
              `The db "${opts.db}" doesn't support .${opts.format} files as scripts.`
            );
          }

          return true;
        }, false);
    },
    async handler({ db, name, type, env, format: formatOptValue }) {
      const dbConfig = dbs[db];
      if (!dbConfig) {
        throw new Error(`Database "${db}" not configured`);
      }

      const { defaultScriptFormat, getTemplate, scriptsDirectory } = dbConfig;

      // Umzug couples together script creation and running into one class,
      // presumaly to support the `verify` behavior mentioned below, so we have
      // to instantiate it w/ dummy values for `migrations` and `context` here.
      const migrator = new Umzug({
        async migrations() {
          return [];
        },
        create: {
          template: (filePath) => [[filePath, getTemplate?.(filePath) ?? ""]],
          folder: scriptsDirectory,
        },
        context: {},
        logger: console,
      });

      const format = formatOptValue ?? defaultScriptFormat;

      await migrator.create({
        name: `${nameScript(type, env, name)}.${format}`,
        allowExtension: `.${format}`,
        prefix: "TIMESTAMP",
        // skipVerify lets us run this command without an active db connection,
        // at least for pg, which is a bit safer. It will prevent umzug from
        // checking that we haven't already run a migration with the same name,
        // but that check isn't super useful (it only checks whatever db this
        // script happens to be connected to when the migration is created) and
        // this error should be prevented by the filesystem not allowing
        // duplicate names anyway.
        skipVerify: true,
      });
    },
  })
  .command({
    command: ["apply-scripts [target] [name]", "apply"],
    describe:
      "Runs one or more migration/seed scripts. By default, applies " +
      "all that haven't been applied to the db yet.",
    builder: (yargs) => {
      return yargs
        .option("env", envOpt)
        .option("db", dbOpt)
        .demandOption("env")
        .positional("target", {
          choices: ["remaining", "next", "only", "until"],
          default: "remaining",
        })
        .positional("name", {
          describe:
            "Name of the script, if targeting only/until a specific script.",
          type: "string",
          demandOption: false,
        })
        .check(({ target, name }) => {
          const needsSpecificScript = target === "only" || target === "until";
          if (!needsSpecificScript && name) {
            throw new Error(
              "Can't provide a general script/set of scripts to run (with " +
                '"next" or "remaining") and then also provide the name of a ' +
                "specific script."
            );
          }
          if (needsSpecificScript && !name) {
            throw new Error(
              'Must provide a script name when you use "only"/"until" to ' +
                "apply (only or up to) a specific script."
            );
          }
          return true;
        });
    },
    handler: async function ({ target, name, env, db: optDbs }) {
      const migrationTasks = Object.entries(dbs)
        .filter(([dbName, _]) => (optDbs ?? []).includes(dbName))
        .map(([_, db]) => async () => {
          const { scriptsDirectory, supportedScriptFormats } = db;

          // Every database can (and will) define a different context type. TS
          // just types this return type as the intersection of all the possible
          // context types, which isn't meaningful; what we want instead is for it
          // to track that, for this particular db, there's some context type that
          // matches the type expected by this particular db's resolveMigrations()
          // function, but TS can't do that, so we cast to any. To do this more
          // safely, I think here we'd need "existential types", but that'd
          // currently add a lot of boilerplate. All this applies to storage too.
          // See https://unsafe-perform.io/posts/2020-02-21-existential-quantification-in-typescript
          const [context, storage]: [any, any] = await Promise.all([
            db.createContext(),
            db.createStorage(),
          ]);

          const migrator = new Umzug({
            migrations: async (context) => {
              const supportedExtensions =
                supportedScriptFormats.length > 1
                  ? `{${supportedScriptFormats.join(",")}}`
                  : `${supportedScriptFormats[0]}`;
              const matchingFilePaths = await globAsync(
                `${scriptsDirectory}/*.${supportedExtensions}`,
                { absolute: true }
              );

              return matchingFilePaths
                .filter(shouldRun.bind(null, env, supportedScriptFormats))
                .map((unresolvedPath) => {
                  const filepath = path.resolve(unresolvedPath);
                  const name = path.basename(filepath);
                  return {
                    path: filepath,
                    ...db.resolveScript({
                      name,
                      path: filepath,
                      context,
                    }),
                  };
                });
            },
            context,
            storage,
            logger: console,
          });

          try {
            switch (target) {
              case "remaining":
                await migrator.up();
                break;
              case "next":
                await migrator.up({ step: 1 });
                break;
              case "only":
                await migrator.up({ migrations: [name!] });
                break;
              case "until":
                await migrator.up({ to: name! });
            }
          } finally {
            // Await not return so that any errors from the try aren't swallowed.
            await db.destroyContext(context);
            if ("destroyStorage" in db) {
              await db.destroyStorage?.(storage);
            }
          }
        });

      // Run in sequence so that the logs don't get interleaved (easier to follow).
      return migrationTasks.reduce(
        (res, task) => res.then(task),
        Promise.resolve()
      );
    },
  })
  .command({
    command: "clean",
    describe:
      "Deletes all the data in the databases specified in the ENV vars.",
    builder: (yargs) => {
      return yargs
        .option("db", dbOpt)
        .option("env", {
          ...envOpt,
          demand:
            "Must provide an environment (even though it has no effect; the " +
            "connection-related env vars determine which db(s) are cleaned) " +
            "to help prevent accidentally deleting prod!",
        })
        .check((opts) => {
          return opts.env !== "prod";
        });
    },
    handler: async ({ db: optDbs }) => {
      await Promise.all(
        Object.entries(dbs)
          .filter(([dbName, _]) => optDbs.includes(dbName))
          .map(async ([_, db]) => {
            const { dropDbAndDisconnect, prepareDbAndDisconnect } = db;
            // If drop fails, assume the db didn't exist, for convenience, and
            // just move on to attempting the create. If the error was something
            // different, then the create will fail, as `prepareDbAndDisconnect`
            // is defined to throw if the db already exists, so this seems fine.
            await dropDbAndDisconnect().catch(() => {});
            await prepareDbAndDisconnect();
          })
      );
    },
  })
  .command({
    command: "drop",
    describe: "Drops the databases specified in the ENV vars.",
    builder: (yargs) => {
      return yargs
        .option("db", dbOpt)
        .option("env", {
          ...envOpt,
          demand:
            "Must provide an environment (even though it has no effect; the " +
            "connection-related env vars determine which db(s) are dropped) " +
            "to help prevent accidentally deleting prod!",
        })
        .check((opts) => {
          return opts.env !== "prod";
        });
    },
    handler: async ({ db: optDbs }) => {
      await Promise.all(
        Object.entries(dbs)
          .filter(([dbName, _]) => optDbs.includes(dbName))
          .map(([_, db]) => db.dropDbAndDisconnect())
      );
    },
  })
  .command({
    command: "create",
    describe: "Creates the databases specified in the config for this db name.",
    builder: (yargs) => {
      return yargs.option("db", dbOpt);
    },
    handler: async ({ db: optDbs }) => {
      await Promise.all(
        Object.entries(dbs)
          .filter(([dbName, _]) => optDbs.includes(dbName))
          .map(([_, db]) => db.prepareDbAndDisconnect())
      );
    },
  })
  .demandCommand(1, 'Must invoke a command (e.g., "clean" or "migrate")')
  .parse();
