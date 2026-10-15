// The built-in systems' assets as the engine host reads them when it seeds (D9; E10's bundle rule): the engine-host
// chunk loads everything at start and may outlive the app binary that built it, so it carries no lazy chunk. The
// renderer's `loadDefaultAssets` (data URLs behind dynamic imports) would add three; here each asset is an
// electron-vite `?asset` import instead: the file is copied beside the build and the chunk holds only its path, read
// once, when a fresh store is seeded. A file gone with a replaced binary fails that seeding, which is logged.
import { readFileSync } from 'node:fs';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';

const PATHS = import.meta.glob<string>('../../artifacts/types/design_system/defaults/*/assets/*', { query: '?asset', import: 'default', eager: true });
const PREFIX = '../../artifacts/types/design_system/defaults/';

const MIME: Readonly<Record<string, string>> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/** A default's assets as bytes, by name; none for a key with no assets. */
export async function loadBundledAssets(key: string): Promise<DefaultAsset[]> {
  const prefix = `${PREFIX}${key}/assets/`;
  return Object.entries(PATHS)
    .filter(([module]) => module.startsWith(prefix))
    .map(([module, path]) => ({ name: module.slice(prefix.length), mime: mimeOf(module), bytes: new Uint8Array(readFileSync(path)) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}
