import { createContext, requestToPromise } from "./context.js";
import { MigrationError } from "./errors.js";
import { validateMigrations } from "./plan.js";
import type {
  Migration,
  MigrationLogEntry,
  MigrationOptions,
  OpenOptions,
} from "./types.js";

/** Name of the internal object store where applied migrations are recorded. */
export const LOG_STORE = "__idb_migrate_log__";

/**
 * Define a single migration.
 *
 * @param version Positive integer version this migration upgrades the DB to.
 * @param options `name` and the `up(ctx)` function that performs the upgrade.
 */
export function defineMigration(
  version: number,
  options: MigrationOptions,
): Migration {
  return {
    version,
    name: options.name,
    up: options.up,
  };
}

/**
 * Apply the pending migrations, in order, inside the active upgrade
 * transaction, recording each one in the migration log store. Throws a
 * {@link MigrationError} tagged with the offending migration on first failure.
 */
async function applyMigrations(
  pending: readonly Migration[],
  ctx: ReturnType<typeof createContext>,
  logStore: IDBObjectStore,
  now: () => number,
  onLog?: (entry: MigrationLogEntry) => void,
): Promise<void> {
  for (const migration of pending) {
    let entry: MigrationLogEntry;
    try {
      await migration.up(ctx);
      entry = {
        version: migration.version,
        name: migration.name,
        appliedAt: now(),
      };
      await requestToPromise(logStore.put(entry));
    } catch (err) {
      throw new MigrationError(migration.version, migration.name, err);
    }
    onLog?.(entry);
  }
}

/**
 * Open `dbName` at the highest migration version and run every pending
 * migration in ascending order inside a single `versionchange` transaction.
 *
 * Each applied migration is recorded in the internal `__idb_migrate_log__`
 * store. If any migration throws, the transaction is aborted (IndexedDB rolls
 * the whole upgrade back), the returned promise rejects with a
 * {@link MigrationError} identifying the failed migration, and the database is
 * left at its prior version.
 *
 * @returns A promise resolving to the opened, upgraded `IDBDatabase`.
 */
export function openWithMigrations(
  dbName: string,
  migrations: readonly Migration[],
  options: OpenOptions = {},
): Promise<IDBDatabase> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    return Promise.reject(
      new Error(
        "No IndexedDB factory available. Pass `indexedDB` in options " +
          "(e.g. a fake-indexeddb factory when running in Node).",
      ),
    );
  }

  const now = options.now ?? (() => Date.now());
  const sorted = validateMigrations(migrations);
  const targetVersion =
    sorted.length > 0 ? sorted[sorted.length - 1].version : 1;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = factory.open(dbName, targetVersion);

    // Captures a failure raised while running migrations so it can be reported
    // from `onerror` after the aborted transaction unwinds.
    let failure: unknown;

    openRequest.onupgradeneeded = (event) => {
      const db = openRequest.result;
      const transaction = openRequest.transaction;
      if (!transaction) {
        failure = new Error("Missing version-change transaction on upgrade.");
        return;
      }

      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion ?? targetVersion;

      // Ensure the internal log store exists before any migration runs.
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { keyPath: "version" });
      }

      const ctx = createContext(db, transaction, oldVersion, newVersion);
      const logStore = transaction.objectStore(LOG_STORE);
      const pending = sorted.filter((m) => m.version > oldVersion);

      applyMigrations(pending, ctx, logStore, now, options.onLog).catch(
        (err) => {
          failure = err;
          try {
            transaction.abort();
          } catch {
            // Transaction may already be finishing; the abort/error events
            // below will still settle the promise.
          }
        },
      );
    };

    openRequest.onsuccess = () => {
      if (failure) {
        // Extremely defensive: an abort should route through `onerror`, but if
        // the environment still resolves the open, surface the failure.
        try {
          openRequest.result.close();
        } catch {
          /* ignore */
        }
        reject(toMigrationError(failure));
        return;
      }
      resolve(openRequest.result);
    };

    openRequest.onerror = () => {
      reject(toMigrationError(failure ?? openRequest.error));
    };

    openRequest.onblocked = () => {
      reject(
        new Error(
          `Opening "${dbName}" is blocked: another connection is still open ` +
            `and must be closed before the upgrade can proceed.`,
        ),
      );
    };
  });
}

function toMigrationError(err: unknown): Error {
  if (err instanceof MigrationError) return err;
  if (err instanceof Error) return err;
  return new Error(String(err ?? "Unknown error opening database."));
}
