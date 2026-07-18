import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

import { defineMigration, openWithMigrations } from "../dist/index.js";

/** Read all keys/values from a store into a sorted array (test helper). */
function readAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

test("runs only the pending migrations in ascending order", async () => {
  const indexedDB = new IDBFactory();
  const order = [];

  const migrations = [
    defineMigration(1, {
      name: "create-users",
      up(ctx) {
        order.push(1);
        ctx.createStore("users", { keyPath: "id" });
      },
    }),
    defineMigration(2, {
      name: "add-email-index",
      up(ctx) {
        order.push(2);
        ctx.createIndex("users", "byEmail", "email", { unique: true });
      },
    }),
    defineMigration(3, {
      name: "create-posts",
      up(ctx) {
        order.push(3);
        ctx.createStore("posts", { keyPath: "id", autoIncrement: true });
      },
    }),
  ];

  const db = await openWithMigrations("app", migrations, { indexedDB });

  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(db.version, 3);
  assert.ok(db.objectStoreNames.contains("users"));
  assert.ok(db.objectStoreNames.contains("posts"));
  db.close();
});

test("a second open only applies newly added migrations", async () => {
  const indexedDB = new IDBFactory();
  const order = [];

  const m1 = defineMigration(1, {
    name: "create-users",
    up(ctx) {
      order.push(1);
      ctx.createStore("users", { keyPath: "id" });
    },
  });
  const m2 = defineMigration(2, {
    name: "create-posts",
    up(ctx) {
      order.push(2);
      ctx.createStore("posts", { keyPath: "id" });
    },
  });

  const db1 = await openWithMigrations("app", [m1], { indexedDB });
  assert.equal(db1.version, 1);
  db1.close();

  // Re-open with an additional migration; only migration 2 should run.
  const db2 = await openWithMigrations("app", [m1, m2], { indexedDB });
  assert.equal(db2.version, 2);
  assert.deepEqual(order, [1, 2]);
  db2.close();
});

test("indexes created by a migration are usable", async () => {
  const indexedDB = new IDBFactory();

  const db = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-users",
        up(ctx) {
          const store = ctx.createStore("users", { keyPath: "id" });
          store.createIndex("byEmail", "email", { unique: true });
        },
      }),
    ],
    { indexedDB },
  );

  await new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    tx.objectStore("users").put({ id: 1, email: "a@example.com" });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  const rows = await readAll(db, "users");
  assert.deepEqual(rows, [{ id: 1, email: "a@example.com" }]);
  db.close();
});
