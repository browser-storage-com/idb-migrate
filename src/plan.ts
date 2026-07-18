import { MigrationValidationError } from "./errors.js";
import type { Migration, MigrationPlan } from "./types.js";

/**
 * Validate a set of migrations and return them sorted ascending by version.
 *
 * Rules enforced (throwing {@link MigrationValidationError} on violation):
 * - every version must be a positive integer;
 * - versions must be unique.
 *
 * Gaps in the version sequence are permitted but surfaced as warnings by
 * {@link planMigrations}.
 */
export function validateMigrations(migrations: readonly Migration[]): Migration[] {
  const seen = new Set<number>();
  for (const migration of migrations) {
    const { version, name } = migration;
    if (
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version <= 0
    ) {
      throw new MigrationValidationError(
        `Migration "${name}" has an invalid version ${String(version)}: ` +
          `versions must be positive integers.`,
      );
    }
    if (seen.has(version)) {
      throw new MigrationValidationError(
        `Duplicate migration version ${version} ("${name}"): ` +
          `each migration must have a unique version.`,
      );
    }
    seen.add(version);
  }
  return [...migrations].sort((a, b) => a.version - b.version);
}

/**
 * Compute the warnings for a validated, sorted migration set. Currently this
 * flags gaps in the version sequence (e.g. jumping from 1 to 3).
 */
function computeWarnings(sorted: readonly Migration[]): string[] {
  const warnings: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].version;
    const curr = sorted[i].version;
    if (curr - prev > 1) {
      warnings.push(
        `Gap in migration versions: ${prev} -> ${curr}. ` +
          `Missing versions are allowed but usually indicate a mistake.`,
      );
    }
  }
  return warnings;
}

/**
 * Pure dry-run planner. Given the database's current version and a set of
 * migrations, returns the ordered list of pending migrations and the resulting
 * target version. Performs no I/O and needs no database.
 *
 * @throws {MigrationValidationError} if versions are invalid or duplicated.
 */
export function planMigrations(
  currentVersion: number,
  migrations: readonly Migration[],
): MigrationPlan {
  const sorted = validateMigrations(migrations);
  const warnings = computeWarnings(sorted);
  const pending = sorted.filter((m) => m.version > currentVersion);
  const targetVersion =
    sorted.length > 0 ? sorted[sorted.length - 1].version : currentVersion;

  return { currentVersion, targetVersion, pending, warnings };
}
