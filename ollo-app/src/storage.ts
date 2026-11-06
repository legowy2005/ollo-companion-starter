import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, DEMO_CARDS, type LibraryData, type StoredImage } from './types';

interface OllODatabase {
  images: { key: number; value: StoredImage };
  library: { key: 'main'; value: LibraryData };
}

let dbPromise: Promise<IDBPDatabase<OllODatabase>> | undefined;
function database(): Promise<IDBPDatabase<OllODatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<OllODatabase>('ollo-companion', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('library')) db.createObjectStore('library');
      }
    });
  }
  return dbPromise!;
}

export async function loadLibrary(): Promise<LibraryData> {
  const db = await database();
  const existing = await db.get('library', 'main');
  if (existing) {
    const settings = { ...DEFAULT_SETTINGS, ...existing.settings };
    // Older versions had a single editable quote. Keep it as one of the user's own quotes if they changed it.
    const legacy = existing.settings.motivationalQuote?.trim();
    if (!existing.settings.customQuotes && legacy && legacy !== DEFAULT_SETTINGS.motivationalQuote) {
      settings.customQuotes = [{ id: crypto.randomUUID(), text: legacy, emotion: 'auto' }];
    }
    return { ...existing, settings };
  }
  const initial: LibraryData = { cards: DEMO_CARDS, settings: DEFAULT_SETTINGS };
  await db.put('library', initial, 'main');
  return initial;
}

export async function saveLibrary(data: LibraryData): Promise<void> {
  const db = await database();
  await db.put('library', data, 'main');
}

export async function saveImage(image: StoredImage): Promise<void> {
  const db = await database();
  await db.put('images', image);
}

export async function getImage(id: number): Promise<StoredImage | undefined> {
  const db = await database();
  return db.get('images', id);
}

export async function getAllImages(): Promise<StoredImage[]> {
  const db = await database();
  return db.getAll('images');
}

export async function deleteImage(id: number): Promise<void> {
  const db = await database();
  await db.delete('images', id);
}

export async function deleteUnreferencedImages(referencedIds: Set<number>): Promise<void> {
  const db = await database();
  const tx = db.transaction('images', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (!referencedIds.has(cursor.value.id)) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
