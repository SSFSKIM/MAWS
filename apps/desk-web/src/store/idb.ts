// The browser's own record, in one IndexedDB database: the org key a device keeps (`org-keys`, keyed by org id, the
// value a non-extractable CryptoKey, which IndexedDB stores without exposing its bytes), each project's log by offset
// (`log`, keyed by [project, offset]), and from version 2 (P5 O13 M3) this browser's `web-cards` device (`device`,
// keyed by org id: its record, its channel key a non-extractable CryptoKey) and the signed org state it verified
// (`org`, keyed by org id). The browser suites seed the key through these same names.
export const DESK_DB = { name: 'desk', version: 2, keys: 'org-keys', log: 'log', device: 'device', org: 'org' } as const;

let opening: Promise<IDBDatabase> | null = null;

export function openDesk(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DESK_DB.name, DESK_DB.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DESK_DB.keys)) db.createObjectStore(DESK_DB.keys);
      if (!db.objectStoreNames.contains(DESK_DB.log)) db.createObjectStore(DESK_DB.log);
      if (!db.objectStoreNames.contains(DESK_DB.device)) db.createObjectStore(DESK_DB.device);
      if (!db.objectStoreNames.contains(DESK_DB.org)) db.createObjectStore(DESK_DB.org);
    };
    request.onsuccess = () => {
      // A newer version opened in another tab (a deploy's) waits on this connection: it is let go, and the next open
      // here meets the new version.
      request.result.onversionchange = () => {
        request.result.close();
        opening = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

export function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
