// What every desk browser suite stands on: a DX3 double serving the built app on its own port, and the org key seeded
// into the browser through the same IndexedDB store a key the owner keeps on the device lives in (the DC5 plan's
// pre-flight: the product has no other way in).
import { test as base, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { HubDouble } from '../test/double/hub-double';
import { VECTOR_KEY } from '../test/vectors';
import { DESK_DB } from '../src/store/idb';
import { DOUBLE_ORG } from '../test/double/hub-double';

export const DIST = join(import.meta.dirname, '..', 'dist');

export const test = base.extend<{ hub: HubDouble }>({
  // eslint-disable-next-line no-empty-pattern
  hub: async ({}, use) => {
    const hub = await HubDouble.start({ orgKey: VECTOR_KEY, staticDir: DIST });
    await use(hub);
    await hub.close();
  },
});

export { expect };

/**
 * Stores a key (the vector key, by default) as a non-extractable HMAC key under an org (the double's), from a page of
 * the app's origin that does not run the app (an /api path), so the app reads it on its next load as it reads a key the
 * owner kept.
 */
export async function seedKey(page: Page, hub: Pick<HubDouble, 'url'>, org: string = DOUBLE_ORG.id, raw: Uint8Array = VECTOR_KEY): Promise<void> {
  await page.goto(`${hub.url}/api/seed`);
  await page.evaluate(
    async ({ db, org, raw }) => {
      const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      const open = indexedDB.open(db.name, db.version);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(db.keys)) open.result.createObjectStore(db.keys);
        if (!open.result.objectStoreNames.contains(db.log)) open.result.createObjectStore(db.log);
      };
      const conn = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = conn.transaction(db.keys, 'readwrite');
      tx.objectStore(db.keys).put(key, org);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      conn.close();
    },
    { db: DESK_DB, org, raw: [...raw] },
  );
}
