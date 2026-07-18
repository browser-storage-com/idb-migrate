import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

import {
  defineMigration,
  openWithMigrations,
  LOG_STORE,
} from "../dist/index.js";

function readLog(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOG_STORE, "readonly");
    const req = tx.objectStore(LOG_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

test("records every applied migration in the log store", async () => {
  const indexedDB = new IDBFactory();
  let clock = 1000;
  const now = () => (clock += 10);
  const logged = [];

  const db = await openWithMigrations(
    "app",
    [
      defineMigration(1, {
        name: "create-users",
        up(ctx) {
          ctx.createStore("users", { keyPath: "id" });
        },
      }),
      defineMigration(2, {
        name: "create-posts",
        up(ctx) {
          ctx.createStore("posts", { keyPath: "id" });
        },
      }),
    ],
    { indexedDB, now, onLog: (e) => logged.push(e) },
  );

  const entries = await readLog(db);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.version),
    [1, 2],
  );
  assert.deepEqual(
    entries.map((e) => e.name),
    ["create-users", "create-posts"],
  );
  // Timestamps come from the injected `now`, not Date.now().
  assert.deepEqual(
    entries.map((e) => e.appliedAt),
    [1010, 1020],
  );

  // onLog callback observed the same entries in order.
  assert.deepEqual(logged, entries);
  db.close();
});

test("does not re-log migrations that were already applied", async () => {
  const indexedDB = new IDBFactory();

  const m1 = defineMigration(1, {
    name: "create-users",
    up(ctx) {
      ctx.createStore("users", { keyPath: "id" });
    },
  });
  const m2 = defineMigration(2, {
    name: "create-posts",
    up(ctx) {
      ctx.createStore("posts", { keyPath: "id" });
    },
  });

  const db1 = await openWithMigrations("app", [m1], { indexedDB });
  db1.close();

  const db2 = await openWithMigrations("app", [m1, m2], { indexedDB });
  const entries = await readLog(db2);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.version),
    [1, 2],
  );
  db2.close();
});
