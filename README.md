# idb-migrate

A tiny, zero-dependency declarative migration framework for [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

Define versioned, ordered migrations once. `idb-migrate` runs only the pending
ones inside a single `versionchange` transaction, records what it applied in a
migration log, rolls back cleanly on failure, and can dry-run a plan without
touching a database. It works in the browser and in Node (via an injectable
`indexedDB` factory), so your migrations are unit-testable with
[fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB).

- **Zero runtime dependencies.** Pure TypeScript compiled to ESM plus type
  declarations.
- **Correct IndexedDB semantics.** All schema changes and data backfills run in
  the real `onupgradeneeded` / `versionchange` transaction, so a failure aborts
  the whole upgrade atomically.
- **Declarative and ordered.** Each migration owns one schema version and runs
  exactly once, in ascending order.
- **Auditable.** Every applied migration is written to an internal log store.
- **Testable.** Deterministic timestamps and a pluggable IndexedDB factory.

## Contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [API reference](#api-reference)
- [The migration log](#the-migration-log)
- [Rollback semantics](#rollback-semantics)
- [Testing with fake-indexeddb](#testing-with-fake-indexeddb)
- [FAQ](#faq)
- [Further reading](#further-reading)
- [License](#license)

## Why

Raw IndexedDB upgrades are error-prone. You get a single `onupgradeneeded`
callback with an `oldVersion` and a `newVersion`, and you are expected to
hand-write a cascade of `if (oldVersion < N)` blocks that create stores, add
indexes, and reshape existing data — all inside a transaction that silently
auto-commits the moment you `await` the wrong thing.

`idb-migrate` replaces that cascade with a list of small, named, versioned
migrations. You describe each step once; the library figures out which steps are
pending, runs them in order in the correct transaction, records them, and undoes
everything if one fails.

## Install

This package is distributed via GitHub (it is **not** published to the npm
registry). Install it straight from the repository:

```sh
npm install github:browser-storage-com/idb-migrate
```

Or pin it in `package.json`:

```json
{
  "dependencies": {
    "idb-migrate": "github:browser-storage-com/idb-migrate"
  }
}
```

It ships as ESM with TypeScript declarations and requires Node `>=18` for the
tooling (in the browser, any environment with IndexedDB works).

## Quick start

```ts
import { defineMigration, openWithMigrations } from "idb-migrate";

const migrations = [
  defineMigration(1, {
    name: "create-users",
    up(ctx) {
      const users = ctx.createStore("users", { keyPath: "id" });
      users.createIndex("byEmail", "email", { unique: true });
    },
  }),
  defineMigration(2, {
    name: "create-posts",
    up(ctx) {
      ctx.createStore("posts", { keyPath: "id", autoIncrement: true });
    },
  }),
];

// In the browser, `indexedDB` defaults to the global one.
const db = await openWithMigrations("my-app", migrations);

console.log(db.version); // 2
```

Re-opening later with more migrations appended applies only the new ones:

```ts
migrations.push(
  defineMigration(3, {
    name: "add-post-author-index",
    up(ctx) {
      ctx.createIndex("posts", "byAuthor", "authorId");
    },
  }),
);

const db = await openWithMigrations("my-app", migrations); // runs only v3
```

## API reference

### `defineMigration(version, { name, up })`

Creates a single migration.

- `version` — a **positive integer** schema version. Must be unique across the
  set.
- `name` — a human-readable label, recorded in the migration log.
- `up(ctx)` — performs the upgrade. May be synchronous or return a `Promise`.
  Receives a [`MigrationContext`](#migrationcontext).

```ts
const migration = defineMigration(1, {
  name: "create-users",
  up(ctx) {
    ctx.createStore("users", { keyPath: "id" });
  },
});
```

### `MigrationContext`

The object passed to every `up` function. It exposes the raw IndexedDB
primitives for the running upgrade plus ergonomic helpers.

| Member | Description |
| --- | --- |
| `db` | The `IDBDatabase` being upgraded. |
| `transaction` | The active `versionchange` `IDBTransaction`. All work happens here. |
| `oldVersion` | The version before this upgrade started. |
| `newVersion` | The version being upgraded to. |
| `createStore(name, options?)` | Create an object store (wraps `db.createObjectStore`). |
| `deleteStore(name)` | Delete an object store. |
| `createIndex(store, indexName, keyPath, options?)` | Create an index on a store. |
| `deleteIndex(store, indexName)` | Delete an index from a store. |
| `getStore(name)` | Get an object store handle from the upgrade transaction. |
| `forEach(store, callback)` | Iterate every record, awaiting the callback per record (data backfills). |

The `forEach` helper visits each record with a cursor and awaits your callback
before advancing:

```ts
defineMigration(2, {
  name: "backfill-fullName",
  async up(ctx) {
    await ctx.forEach("users", (user, cursor) => {
      user.fullName = `${user.first} ${user.last}`;
      cursor.update(user); // runs in the same transaction
    });
    ctx.createIndex("users", "byFullName", "fullName");
  },
});
```

> The callback may be `async`, but it must only `await` operations that belong
> to the active transaction (such as `cursor.update(...)` or reads from another
> store in the same upgrade). Awaiting a timer, a network request, or an
> unrelated promise lets IndexedDB auto-commit the transaction and the migration
> will fail. See [rollback semantics](#rollback-semantics).

### `openWithMigrations(dbName, migrations, options?)`

Opens `dbName` at the highest migration version and runs every pending migration
in ascending order inside one `versionchange` transaction. Returns a
`Promise<IDBDatabase>`.

```ts
const db = await openWithMigrations("my-app", migrations, {
  indexedDB,                 // optional IDBFactory (defaults to globalThis.indexedDB)
  onLog: (entry) => {},      // optional; called per applied migration
  now: () => Date.now(),     // optional; timestamp source for log entries
});
```

Options:

- `indexedDB?: IDBFactory` — the factory to open with. Defaults to
  `globalThis.indexedDB`. Pass a `fake-indexeddb` factory in Node.
- `onLog?: (entry: MigrationLogEntry) => void` — invoked with each log entry as
  it is recorded.
- `now?: () => number` — supplies the `appliedAt` timestamp for each entry.
  Defaults to `Date.now`. Inject a deterministic function in tests — the library
  never assumes `Date.now()` is deterministic.

### `planMigrations(currentVersion, migrations)`

A pure, side-effect-free dry-run planner. Given a current version and a set of
migrations, returns the ordered pending migrations and the resulting target
version. No database required.

```ts
import { planMigrations } from "idb-migrate";

const plan = planMigrations(1, migrations);
plan.currentVersion; // 1
plan.targetVersion;  // 3
plan.pending;        // [migration v2, migration v3]
plan.warnings;       // e.g. ["Gap in migration versions: 1 -> 3. ..."]
```

Validation performed (throws `MigrationValidationError`):

- versions must be **positive integers**;
- versions must be **unique** (duplicates throw);
- **gaps are allowed but reported as warnings** (e.g. jumping from 1 to 3).

### Types and errors

All types are exported: `Migration`, `MigrationOptions`, `MigrationContext`,
`MigrationLogEntry`, `MigrationPlan`, `OpenOptions`, and `ForEachCallback`.

- `MigrationError` — thrown when a migration fails at runtime. Carries
  `version`, `migrationName`, and the original `cause`.
- `MigrationValidationError` — thrown for an invalid migration set (bad or
  duplicate versions).

## The migration log

Every successful migration is recorded in an internal object store named
`__idb_migrate_log__`, keyed by `version`. Each entry looks like:

```ts
interface MigrationLogEntry {
  version: number;   // the migration's version
  name: string;      // the migration's name
  appliedAt: number; // timestamp from the `now` option (defaults to Date.now)
}
```

Because the log lives in the same database, you can read it back at runtime to
inspect exactly which migrations have run:

```ts
const tx = db.transaction("__idb_migrate_log__", "readonly");
tx.objectStore("__idb_migrate_log__").getAll().onsuccess = (e) => {
  console.log(e.target.result); // [{ version: 1, name: "...", appliedAt: ... }]
};
```

The log store is created automatically before any migration runs, and the log
write for each migration happens inside the same transaction as that migration —
so if a migration is rolled back, its log entry is rolled back with it.

## Rollback semantics

`idb-migrate` relies on IndexedDB's native atomicity. All pending migrations run
in **one** `versionchange` transaction. If any migration throws (or returns a
rejected promise), the library aborts that transaction. IndexedDB then rolls back
every schema change and data write made during the upgrade, and the database is
left untouched at its previous version.

The returned promise rejects with a `MigrationError` identifying the migration
that failed:

```ts
try {
  await openWithMigrations("my-app", migrations);
} catch (err) {
  if (err instanceof MigrationError) {
    console.error(`v${err.version} (${err.migrationName}) failed:`, err.cause);
    // The database is still at its prior version — nothing was applied.
  }
}
```

Because the transaction auto-commits when it becomes inactive, your migrations
must only `await` IndexedDB work that belongs to the upgrade transaction. Do not
`await` timers, `fetch`, or unrelated promises inside a migration.

## Testing with fake-indexeddb

Pass a `fake-indexeddb` factory as the `indexedDB` option to run migrations in
Node with no browser. A fresh factory per test gives you full isolation.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { defineMigration, openWithMigrations } from "idb-migrate";

test("applies migrations", async () => {
  const indexedDB = new IDBFactory(); // isolated in-memory database
  let clock = 0;

  const db = await openWithMigrations(
    "test-db",
    [
      defineMigration(1, {
        name: "create-users",
        up(ctx) {
          ctx.createStore("users", { keyPath: "id" });
        },
      }),
    ],
    { indexedDB, now: () => ++clock }, // deterministic timestamps
  );

  assert.equal(db.version, 1);
  assert.ok(db.objectStoreNames.contains("users"));
  db.close();
});
```

This repository's own tests use exactly this setup with Node's built-in test
runner. Clone it and run:

```sh
npm install
npm test
```

## FAQ

**Is this on npm?** No. It is distributed via GitHub — install with
`npm install github:browser-storage-com/idb-migrate`.

**Can migrations be async?** Yes. An `up` function may return a promise, and
`forEach` awaits your callback per record. Just keep every `await` tied to the
upgrade transaction — no timers or network calls.

**How do downgrades work?** IndexedDB does not support opening at a lower
version, so this library is upgrade-only by design. To reverse a change, ship a
new, higher-versioned migration that undoes it.

**What if two tabs open the database at once?** The upgrade is `blocked` until
other connections close. `openWithMigrations` rejects with a clear error in that
case; listen for the browser `versionchange` event on your open connections and
close them so upgrades can proceed.

**Can I skip version numbers?** Yes — gaps are allowed. `planMigrations` reports
them as warnings so accidental gaps are easy to spot.

**Where is the current version stored?** IndexedDB tracks the database version
itself; the library reads it from `oldVersion` during the upgrade and applies
only migrations above it. The `__idb_migrate_log__` store adds a human-readable
audit trail on top.

## Further reading

Deep dives on getting IndexedDB migrations right in production:

- [Database Schema Migrations](https://www.browser-storage.com/indexeddb-architecture-advanced-patterns/database-schema-migrations/) — patterns and pitfalls for evolving an IndexedDB schema over time.
- [Step-by-step IndexedDB version upgrade migration](https://www.browser-storage.com/indexeddb-architecture-advanced-patterns/database-schema-migrations/step-by-step-indexeddb-version-upgrade-migration/) — a worked walkthrough of a real version bump.
- [Recovering from a failed IndexedDB version upgrade](https://www.browser-storage.com/indexeddb-architecture-advanced-patterns/database-schema-migrations/recovering-from-a-failed-indexeddb-version-upgrade/) — what to do when an upgrade goes wrong.
- [IndexedDB transaction management](https://www.browser-storage.com/indexeddb-architecture-advanced-patterns/indexeddb-transaction-management/) — how transactions stay active and why they auto-commit.

Maintained by the team behind [Browser Storage & Offline-First State Persistence](https://www.browser-storage.com/).

## License

[MIT](./LICENSE) © 2026 browser-storage.com
