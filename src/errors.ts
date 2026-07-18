/**
 * Error thrown when a migration fails while running inside the version-change
 * transaction. When this is thrown the transaction has been aborted, so the
 * database is left untouched at its previous version.
 */
export class MigrationError extends Error {
  /** The version of the migration that failed. */
  readonly version: number;
  /** The name of the migration that failed. */
  readonly migrationName: string;
  /** The original error that caused the failure, if any. */
  readonly cause?: unknown;

  constructor(version: number, migrationName: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    super(
      `Migration ${version} ("${migrationName}") failed` +
        (detail ? `: ${detail}` : ""),
    );
    this.name = "MigrationError";
    this.version = version;
    this.migrationName = migrationName;
    this.cause = cause;
    // Restore prototype chain for environments that down-level classes.
    Object.setPrototypeOf(this, MigrationError.prototype);
  }
}

/**
 * Error thrown by validation (in {@link planMigrations} and
 * {@link openWithMigrations}) when the supplied migration set is invalid, e.g.
 * duplicate or non-positive-integer versions.
 */
export class MigrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationValidationError";
    Object.setPrototypeOf(this, MigrationValidationError.prototype);
  }
}
