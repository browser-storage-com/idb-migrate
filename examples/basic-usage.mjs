// Basic usage example for idb-migrate.
//
// Run in Node with:  node examples/basic-usage.mjs
// (uses fake-indexeddb so it works without a browser)
//
// In a real browser you would omit the `indexedDB` option entirely and let the
// library use the global `indexedDB`.

import { IDBFactory } from "fake-indexeddb";
import { defineMigration, openWithMigrations, planMigrations } from "../dist/index.js";

// A fresh in-memory IndexedDB factory for this example.
const indexedDB = new IDBFactory();

// 1. Declare your migrations. Each one owns a single schema version and is
//    applied exactly once, in ascending order.
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
      const posts = ctx.createStore("posts", { keyPath: "id", autoIncrement: true });
      posts.createIndex("byAuthor", "authorId");
    },
  }),
];

// 2. (Optional) Dry-run the plan without touching any database.
const plan = planMigrations(0, migrations);
console.log("Pending versions:", plan.pending.map((m) => m.version));
console.log("Target version:", plan.targetVersion);

// 3. Open the database. Pending migrations run inside one versionchange
//    transaction; each is recorded in the internal migration log.
const db = await openWithMigrations("demo-app", migrations, {
  indexedDB,
  onLog: (entry) => console.log(`applied v${entry.version} (${entry.name})`),
});

console.log("Opened at version", db.version);
console.log("Stores:", [...db.objectStoreNames]);

// 4. Use the database as normal.
await new Promise((resolve, reject) => {
  const tx = db.transaction("users", "readwrite");
  tx.objectStore("users").put({ id: 1, email: "ada@example.com", name: "Ada" });
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
});

const user = await new Promise((resolve, reject) => {
  const tx = db.transaction("users", "readonly");
  const req = tx.objectStore("users").get(1);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
console.log("Read back:", user);

db.close();
