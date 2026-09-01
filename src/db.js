import { openDB } from 'idb';

const DB_NAME = 'kastelu-pwa';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('plants')) {
          db.createObjectStore('plants', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('pendingChanges')) {
          db.createObjectStore('pendingChanges', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function savePlants(plants) {
  const db = await getDB();
  const tx = db.transaction('plants', 'readwrite');
  const store = tx.objectStore('plants');
  await store.clear();
  for (const p of plants) {
    await store.put(p);
  }
  await tx.done;
}

export async function getPlants() {
  const db = await getDB();
  return db.getAll('plants');
}

export async function updatePlant(plant) {
  const db = await getDB();
  await db.put('plants', plant);
}

export async function getMeta(key) {
  const db = await getDB();
  return db.get('meta', key);
}

export async function setMeta(key, value) {
  const db = await getDB();
  await db.put('meta', value, key);
}

export async function addPendingChange(change) {
  const db = await getDB();
  await db.add('pendingChanges', change);
}

export async function getPendingChanges() {
  const db = await getDB();
  return db.getAll('pendingChanges');
}

export async function clearPendingChanges() {
  const db = await getDB();
  const tx = db.transaction('pendingChanges', 'readwrite');
  await tx.objectStore('pendingChanges').clear();
  await tx.done;
}
