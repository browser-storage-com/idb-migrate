/**
 * idb-migrate — a tiny, zero-dependency declarative migration framework for
 * IndexedDB.
 *
 * @packageDocumentation
 */

export { defineMigration, openWithMigrations, LOG_STORE } from "./migrate.js";
export { planMigrations, validateMigrations } from "./plan.js";
export { createContext, requestToPromise } from "./context.js";
export { MigrationError, MigrationValidationError } from "./errors.js";

export type {
  Migration,
  MigrationOptions,
  MigrationContext,
  MigrationLogEntry,
  MigrationPlan,
  OpenOptions,
  ForEachCallback,
} from "./types.js";
