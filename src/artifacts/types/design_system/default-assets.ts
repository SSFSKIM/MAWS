// The built-in design systems' binary assets (`defaults/<key>/assets/*`: font files and their licences), apart from
// `./defaults.ts` so only a build that seeds the defaults carries them. Each file is a Vite `?inline` import (a data URL)
// behind its own dynamic import: a build that imports this module emits one chunk per asset, and nothing is read
// until a system's assets are asked for. The seeding host uploads them through A's asset path; canon refers to one as
// `assets/<name>`.
const ASSETS = import.meta.glob<string>('./defaults/*/assets/*', { query: '?inline', import: 'default' });

export interface DefaultAsset {
  /** The file's name; canon refers to it as `assets/<name>`. */
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

const prefix = (key: string) => `./defaults/${key}/assets/`;

/** The names of a default's assets, without loading them. */
export const defaultAssetNames = (key: string): string[] =>
  Object.keys(ASSETS)
    .filter((module) => module.startsWith(prefix(key)))
    .map((module) => module.slice(prefix(key).length))
    .sort();

function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (!match) throw new Error('a bundled asset is not a data URL');
  const [, mime, params, data] = match;
  if (/;base64$/.test(params!)) {
    const binary = atob(data!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: mime!, bytes };
  }
  return { mime: mime!, bytes: new TextEncoder().encode(decodeURIComponent(data!)) };
}

/** A default's assets as bytes, by name; none for a key with no assets. */
export async function loadDefaultAssets(key: string): Promise<DefaultAsset[]> {
  return Promise.all(
    defaultAssetNames(key).map(async (name) => ({ name, ...decodeDataUrl(await ASSETS[`${prefix(key)}${name}`]!()) })),
  );
}
