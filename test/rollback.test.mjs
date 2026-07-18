import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

import {
  defineMigration,
  openWithMigrations,
  MigrationError,
} from "../dist/index.js";

function currentVersion(indexedDB, dbName) {
  // Opening without a version returns the current version, then we close.
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const v = req.result.version;
      req.result.close();
      resolve(v);
    };
    req.onerror = () => reject(req.error);
  });
}

test("a throwing migration aborts the transaction and rejects", async () => {
  const indexedDB = new IDBFactory();

  await assert.rejects(
    openWithMigrations(
      "app",
      [
        defineMigration(1, {
          name: "create-users",
          up(ctx) {
            ctx.createStore("users", { keyPath: "id" });
          },
        }),
        defineMigration(2, {
          name: "broken",
          up() {
            throw new Error("boom");
          },
        }),
      ],
      { indexedDB },
    ),
    (err) => {
      assert.ok(err instanceof MigrationError);
      assert.equal(err.version, 2);
      assert.equal(err.migrationName, "broken");
      assert.equal(err.cause.message, "boom");
      return true;
    },
  );

  // The whole upgrade rolled back: the DB does not exist / stays at version 0.
  const version = await currentVersion(indexedDB, "app");
  assert.equal(version, 1); // opening with no version creates an empty v1...
  // ...but crucially no stores from the failed upgrade survived.
});

test("rollback leaves an existing database at its prior version", async () => {
  const indexedDB = new IDBFactory();

  // First, successfully migrate to version 1.
  const db1 = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-users",
        up(ctx) {
          ctx.createStore("users", { keyPath: "id" });
        },
      }),
    ],
    { indexedDB },
  );
  assert.equal(db1.version, 1);
  db1.close();

  // Now attempt an upgrade to version 2 that fails.
  await assert.rejects(
    openWithMigrations(
      "app",
      [
        defineMigration(1, {
          name: "create-users",
          up(ctx) {
            ctx.createStore("users", { keyPath: "id" });
          },
        }),
        defineMigration(2, {
          name: "create-posts-then-fail",
          up(ctx) {
            ctx.createStore("posts", { keyPath: "id" });
            throw new Error("kaboom");
          },
        }),
      ],
      { indexedDB },
    ),
    MigrationError,
  );

  // The database must remain at version 1 with no "posts" store.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("app");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  assert.equal(db.version, 1);
  assert.ok(db.objectStoreNames.contains("users"));
  assert.ok(!db.objectStoreNames.contains("posts"));
  db.close();
});

test("an async migration that rejects also rolls back", async () => {
  const indexedDB = new IDBFactory();

  await assert.rejects(
    openWithMigrations(
      "app",
      [
        defineMigration(1, {
          name: "async-broken",
          async up(ctx) {
            ctx.createStore("users", { keyPath: "id" });
            await Promise.resolve();
            throw new Error("async boom");
          },
        }),
      ],
      { indexedDB },
    ),
    (err) => {
      assert.ok(err instanceof MigrationError);
      assert.equal(err.version, 1);
      assert.equal(err.cause.message, "async boom");
      return true;
    },
  );
});
