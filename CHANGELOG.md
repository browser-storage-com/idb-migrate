# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-18

### Added

- Initial release.
- `defineMigration(version, { name, up })` for declaring ordered, versioned
  migrations.
- `openWithMigrations(dbName, migrations, options)` which opens a database at
  the highest migration version and applies only the pending migrations inside
  a single `versionchange` transaction.
- `planMigrations(currentVersion, migrations)`, a pure dry-run planner that
  validates versions and reports pending migrations, the target version, and
  warnings (e.g. version gaps).
- Migration context helpers: `createStore`, `deleteStore`, `createIndex`,
  `deleteIndex`, `getStore`, and an async-friendly `forEach` cursor helper for
  data backfills.
- Internal migration log store (`__idb_migrate_log__`) recording each applied
  migration's version, name, and timestamp (via an injectable `now` function).
- Automatic rollback: a throwing migration aborts the transaction and rejects
  with a `MigrationError` identifying the failed migration; the database is
  left at its prior version.
- Zero runtime dependencies. Ships as ESM with TypeScript declarations.
