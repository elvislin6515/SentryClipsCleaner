const PATH_KEY = "sentryclips.lastLocalPath";
const DB_NAME = "sentryclips-cleaner";
const STORE = "handles";
const HANDLE_KEY = "lastDirectory";

export function readLastLocalPath(fallback: string): string {
  try {
    const value = localStorage.getItem(PATH_KEY)?.trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

export function writeLastLocalPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(PATH_KEY, trimmed);
  } catch {
    // Skip when private mode or storage quota blocks localStorage.
  }
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLastDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
  });
}

export async function loadLastDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => {
        resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}
