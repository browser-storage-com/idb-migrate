import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

import { defineMigration, openWithMigrations } from "../dist/index.js";

function readAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function seed(db, storeName, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const row of rows) store.put(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

test("forEach backfills existing records during a migration", async () => {
  const indexedDB = new IDBFactory();

  // v1: create the store and seed some data.
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
  await seed(db1, "users", [
    { id: 1, first: "Ada", last: "Lovelace" },
    { id: 2, first: "Alan", last: "Turing" },
    { id: 3, first: "Grace", last: "Hopper" },
  ]);
  db1.close();

  // v2: add a derived `fullName` field to every existing record using forEach,
  // then index it.
  const db2 = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-users",
        up(ctx) {
          ctx.createStore("users", { keyPath: "id" });
        },
      }),
      defineMigration(2, {
        name: "backfill-fullName",
        async up(ctx) {
          await ctx.forEach("users", (value, cursor) => {
            value.fullName = `${value.first} ${value.last}`;
            // cursor.update returns a request in the same transaction.
            cursor.update(value);
          });
          ctx.createIndex("users", "byFullName", "fullName");
        },
      }),
    ],
    { indexedDB },
  );

  const rows = await readAll(db2, "users");
  assert.deepEqual(
    rows.map((r) => r.fullName).sort(),
    ["Ada Lovelace", "Alan Turing", "Grace Hopper"],
  );

  // The new index resolves records by their backfilled value.
  const viaIndex = await new Promise((resolve, reject) => {
    const tx = db2.transaction("users", "readonly");
    const req = tx.objectStore("users").index("byFullName").get("Grace Hopper");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  assert.equal(viaIndex.id, 3);
  db2.close();
});

test("forEach awaits async callbacks that use same-transaction requests", async () => {
  const indexedDB = new IDBFactory();

  const db1 = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-counters",
        up(ctx) {
          ctx.createStore("counters", { keyPath: "id" });
        },
      }),
    ],
    { indexedDB },
  );
  await seed(db1, "counters", [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ]);
  db1.close();

  const visited = [];
  const db2 = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-counters",
        up(ctx) {
          ctx.createStore("counters", { keyPath: "id" });
        },
      }),
      defineMigration(2, {
        name: "double-counters",
        async up(ctx) {
          await ctx.forEach("counters", async (value, cursor) => {
            // Simulate awaiting a same-transaction request before continuing.
            await new Promise((resolve, reject) => {
              const req = cursor.update({ ...value, n: value.n * 2 });
              req.onsuccess = resolve;
              req.onerror = () => reject(req.error);
            });
            visited.push(value.id);
          });
        },
      }),
    ],
    { indexedDB },
  );

  const rows = await readAll(db2, "counters");
  assert.deepEqual(
    rows.sort((x, y) => x.id.localeCompare(y.id)),
    [
      { id: "a", n: 2 },
      { id: "b", n: 4 },
    ],
  );
  assert.deepEqual(visited.sort(), ["a", "b"]);
  db2.close();
});
