/**
 * Public type definitions for `idb-migrate`.
 *
 * These types describe the migration API surface. They intentionally lean on
 * the standard DOM `IDBDatabase` / `IDBTransaction` / `IDBObjectStore` types so
 * that the library composes with raw IndexedDB code.
 */

/**
 * Callback invoked for every record visited by {@link MigrationContext.forEach}.
 *
 * The callback may be synchronous or asynchronous. When asynchronous it MUST
 * only await operations that belong to the active version-change transaction
 * (for example `cursor.update(...)` or reads from another store in the same
 * transaction). Awaiting timers, network requests, or unrelated promises will
 * cause the transaction to auto-commit and the migration to fail.
 */
export type ForEachCallback<T = unknown> = (
  value: T,
  cursor: IDBCursorWithValue,
) => void | Promise<void>;

/**
 * The context object passed to a migration's `up` function. It exposes the raw
 * IndexedDB primitives for the running upgrade plus a set of ergonomic helpers.
 */
export interface MigrationContext {
  /** The database being upgraded. */
  readonly db: IDBDatabase;
  /** The active `versionchange` transaction. All work must happen within it. */
  readonly transaction: IDBTransaction;
  /** The version the database had before this upgrade started. */
  readonly oldVersion: number;
  /** The version the database is being upgraded to. */
  readonly newVersion: number;

  /** Create a new object store. Thin wrapper around `db.createObjectStore`. */
  createStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore;
  /** Delete an existing object store. Thin wrapper around `db.deleteObjectStore`. */
  deleteStore(name: string): void;
  /** Create an index on a store owned by this upgrade transaction. */
  createIndex(
    store: string,
    indexName: string,
    keyPath: string | string[],
    options?: IDBIndexParameters,
  ): IDBIndex;
  /** Delete an index from a store owned by this upgrade transaction. */
  deleteIndex(store: string, indexName: string): void;
  /** Get an object store handle from the active upgrade transaction. */
  getStore(name: string): IDBObjectStore;

  /**
   * Iterate every record in `store`, awaiting the (optionally async) callback
   * for each one before advancing the cursor. Useful for data backfills that
   * rewrite or reshape existing records during a schema migration.
   */
  forEach<T = unknown>(
    store: string | IDBObjectStore,
    callback: ForEachCallback<T>,
  ): Promise<void>;
}

/**
 * A single migration. Create one with {@link defineMigration}.
 */
export interface Migration {
  /** Positive integer schema version this migration upgrades the database to. */
  readonly version: number;
  /** Human readable name, recorded in the migration log. */
  readonly name: string;
  /** Performs the upgrade work. May be sync or async. */
  up(ctx: MigrationContext): void | Promise<void>;
}

/** Options accepted by {@link defineMigration}. */
export interface MigrationOptions {
  name: string;
  up(ctx: MigrationContext): void | Promise<void>;
}

/** A record written to the internal migration log store. */
export interface MigrationLogEntry {
  /** Version of the migration that was applied. */
  version: number;
  /** Name of the migration that was applied. */
  name: string;
  /** Timestamp (ms) produced by the configured `now` function when applied. */
  appliedAt: number;
}

/** Options accepted by {@link openWithMigrations}. */
export interface OpenOptions {
  /**
   * IndexedDB factory to use. Defaults to `globalThis.indexedDB`. Pass a
   * `fake-indexeddb` factory here to run migrations in Node during tests.
   */
  indexedDB?: IDBFactory;
  /** Called with each migration log entry as it is recorded. */
  onLog?: (entry: MigrationLogEntry) => void;
  /**
   * Returns the timestamp recorded for each applied migration. Defaults to
   * `Date.now`. Provide a deterministic function in tests.
   */
  now?: () => number;
}

/** The result of {@link planMigrations}: a dry-run description of an upgrade. */
export interface MigrationPlan {
  /** The version the plan was computed from. */
  currentVersion: number;
  /** The version the database will be at once all pending migrations run. */
  targetVersion: number;
  /** Ordered (ascending) list of migrations that still need to be applied. */
  pending: Migration[];
  /** Non-fatal advisories, e.g. gaps in the version sequence. */
  warnings: string[];
}
