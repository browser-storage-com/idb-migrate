// Data-backfill example for idb-migrate.
//
// Run in Node with:  node examples/data-backfill.mjs
//
// Shows how to reshape existing records during a schema migration using the
// `forEach` cursor helper, all inside the same atomic versionchange
// transaction as the schema change.

import { IDBFactory } from "fake-indexeddb";
import { defineMigration, openWithMigrations } from "../dist/index.js";

const indexedDB = new IDBFactory();

// --- Version 1: initial schema, seeded with some legacy-shaped records. ---
const v1 = [
  defineMigration(1, {
    name: "create-contacts",
    up(ctx) {
      ctx.createStore("contacts", { keyPath: "id" });
    },
  }),
];

const db1 = await openWithMigrations("crm", v1, { indexedDB });

await new Promise((resolve, reject) => {
  const tx = db1.transaction("contacts", "readwrite");
  const store = tx.objectStore("contacts");
  // Legacy records store first/last separately and have no `displayName`.
  store.put({ id: 1, first: "Ada", last: "Lovelace" });
  store.put({ id: 2, first: "Alan", last: "Turing" });
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
});
db1.close();

// --- Version 2: backfill a computed `displayName`, then index it. ---
const v2 = [
  ...v1,
  defineMigration(2, {
    name: "backfill-displayName",
    async up(ctx) {
      // Visit every existing record and rewrite it. `cursor.update` runs in the
      // same transaction, so the backfill is atomic with the index creation.
      await ctx.forEach("contacts", (contact, cursor) => {
        contact.displayName = `${contact.first} ${contact.last}`;
        cursor.update(contact);
      });
      ctx.createIndex("contacts", "byDisplayName", "displayName");
    },
  }),
];

const db2 = await openWithMigrations("crm", v2, {
  indexedDB,
  onLog: (e) => console.log(`applied v${e.version} (${e.name})`),
});

// Look a contact up through the freshly built index.
const found = await new Promise((resolve, reject) => {
  const tx = db2.transaction("contacts", "readonly");
  const req = tx.objectStore("contacts").index("byDisplayName").get("Alan Turing");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

console.log("Found via index:", found);
db2.close();
