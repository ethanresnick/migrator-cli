import {
  type MigrationParams,
  type RunnableMigration,
  type UmzugStorage,
} from "umzug";

type ReadonlyNonEmptyArray<T> = readonly [T, ...T[]];

/**
 * Every database for which we want to support migrations must provide a config
 * object for itself that satisfies this type.
 *
 * NB: file extensions in the options below should be given with no leading dot.
 *
 * NB: "scripts" refers collectively to migrations or seed files.
 */
export type DatabaseConfig<
  SupportedEnvironment extends string = string,
  SupportedScriptFormat extends string = string,
  ContextType = unknown,
  StorageType extends UmzugStorage = UmzugStorage
> = {
  /**
   * The file type (i.e., extension) to use for a new script when a file type
   * isn't specified explicitly.
   */
  readonly defaultScriptFormat: SupportedScriptFormat;

  /**
   * A list of supported file extensions for this db's scripts (no leading dot).
   */
  readonly supportedScriptFormats: ReadonlyNonEmptyArray<SupportedScriptFormat>;

  /**
   * A list of supported/available environments for this db's seeds.
   */
  readonly supportedEnvironments: ReadonlyNonEmptyArray<SupportedEnvironment>;

  /**
   * The default environment to use for commands targeting this db.
   */
  readonly defaultEnvironment?: SupportedEnvironment | undefined;

  /**
   * The directory in which the migrator will look for this db's scripts and
   * into which it'll create new scripts.
   */
  readonly scriptsDirectory: string;

  /**
   * Takes the name and path of a script and turns it into a runnable object
   * that has an `up` and (optionally) `down` method. `up` and `down` will be
   * called with the context object (see below) and should actually update the
   * database.
   */
  resolveScript(
    params: MigrationParams<ContextType> & { path: string }
  ): RunnableMigration<ContextType>;

  /**
   * Given the path of the new script file that is being created, returns a
   * string that will be that file's initial contents. This template can include
   * helper/boilerplate code, like common imports.
   */
  getTemplate?(filePath: string): string;

  /**
   * Creates this db to with an initial state and then closes any open
   * connections/resources. This should throw if the db already exists.
   */
  prepareDbAndDisconnect(env: SupportedEnvironment): Promise<void>;

  /**
   * Deletes this db and then closes any open connections/resources.
   */
  dropDbAndDisconnect(env: SupportedEnvironment): Promise<void>;

  /**
   * Returns a "context" object, which is simply an object that'll be passed to
   * all scripts. Often this context object is an instance of the db driver
   * connected to the database.
   */
  createContext(env: SupportedEnvironment): ContextType | Promise<ContextType>;

  /**
   * Returns an object capable of recording that a script has been run, listing
   * the scripts that have run, and removing the record of a script (if it's
   * rolled back).
   */
  createStorage(env: SupportedEnvironment): UmzugStorage<ContextType>;

  /**
   * A function that destroys the context object and cleans up associated
   * resources. This is called after all the migrations have been run with the
   * context. If the context has an open db connection, that connection should
   * be closed so the process can exit.
   */
  destroyContext(context: ContextType): Promise<void>;

  /**
   * A function that destroys the storage object and cleans up associated
   * resources. This is called after all the migrations have been run with the
   * storage. If the storage has an open db connection, that connection should
   * be closed so the process can exit.
   */
  destroyStorage?(storage: StorageType): Promise<void>;
};
