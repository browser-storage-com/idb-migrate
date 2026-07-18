import type { ForEachCallback, MigrationContext } from "./types.js";

/**
 * Wrap an `IDBRequest` in a promise that resolves with its result or rejects
 * with its error. Safe to await inside a version-change transaction because the
 * pending request keeps the transaction active until it settles.
 */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Build the {@link MigrationContext} handed to each migration's `up` function.
 *
 * All helpers operate against the single active version-change transaction so
 * that schema changes and data backfills participate in the same atomic upgrade.
 */
export function createContext(
  db: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
): MigrationContext {
  const getStore = (name: string): IDBObjectStore => transaction.objectStore(name);

  const forEach = <T>(
    store: string | IDBObjectStore,
    callback: ForEachCallback<T>,
  ): Promise<void> => {
    const objectStore = typeof store === "string" ? getStore(store) : store;
    return new Promise<void>((resolve, reject) => {
      const request = objectStore.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        // Run the (possibly async) callback, then advance. Any awaited
        // same-transaction requests keep the transaction alive across the await.
        Promise.resolve()
          .then(() => callback(cursor.value as T, cursor))
          .then(() => {
            cursor.continue();
          })
          .catch(reject);
      };
    });
  };

  return {
    db,
    transaction,
    oldVersion,
    newVersion,
    createStore: (name, options) => db.createObjectStore(name, options),
    deleteStore: (name) => db.deleteObjectStore(name),
    createIndex: (store, indexName, keyPath, options) =>
      getStore(store).createIndex(indexName, keyPath, options),
    deleteIndex: (store, indexName) => getStore(store).deleteIndex(indexName),
    getStore,
    forEach,
  };
}
