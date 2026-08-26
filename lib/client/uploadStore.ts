"use client";

// A recorded/selected video only exists as an in-memory Blob — it does not
// survive a closed tab or reload on its own. True "resume an interrupted
// upload after reopening the app" requires the raw bytes to live somewhere
// durable *before* upload starts. IndexedDB is that place; this is a thin,
// dependency-free wrapper scoped to exactly the three operations
// uploadLargeMedia() needs.

const DB_NAME = "civiquex-uploads";
const DB_VERSION = 1;
const STORE_NAME = "pending-blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

export async function putPendingBlob(contentHash: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, contentHash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to persist pending upload"));
  });
  db.close();
}

export async function getPendingBlob(contentHash: string): Promise<Blob | null> {
  const db = await openDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(contentHash);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to read pending upload"));
  });
  db.close();
  return result;
}

export async function deletePendingBlob(contentHash: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(contentHash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear pending upload"));
  });
  db.close();
}
