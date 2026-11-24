// The pinned set's fixtures as the sheet's components read them (test/fixtures/sheet/set): each fixture directory's
// `show.before.json` and `show.after.json` (the model sminos's own `show` printed, null where a side has no record), and
// the captured bodies under each side's `refs/`, fetched only when a body is asked for. Read through Vite's glob, so the
// sheet's suites, the harness's `#sheet` page and desk-web's suite share one reading and no Node builtin.
import { SheetModelSchema, type SheetBody, type SheetBodyRequest, type SheetModel } from '@shared/sheet/model';

const SHOWS = import.meta.glob<string>('../../../../../test/fixtures/sheet/set/fixtures/*/show.*.json', { query: '?raw', import: 'default', eager: true });
const TEXTS = import.meta.glob<string>('../../../../../test/fixtures/sheet/set/fixtures/*/*/sheet/*/refs/*', { query: '?raw', import: 'default' });
const URLS = import.meta.glob<string>('../../../../../test/fixtures/sheet/set/fixtures/*/*/sheet/*/{refs,uploads}/*', { query: '?url', import: 'default' });

export type PinSide = 'before' | 'after';
export interface PinCase {
  name: string;
  before: SheetModel | null;
  after: SheetModel | null;
}

const SHOW = /\/fixtures\/([^/]+)\/show\.(before|after)\.json$/;

/** Every fixture directory of the pin, by name, each side's model as the set's own `show` printed it. */
export const PIN_CASES: readonly PinCase[] = (() => {
  const cases = new Map<string, PinCase>();
  for (const [path, raw] of Object.entries(SHOWS)) {
    const [, name, side] = SHOW.exec(path)!;
    const parsed: unknown = JSON.parse(raw);
    const entry = cases.get(name) ?? { name, before: null, after: null };
    entry[side as PinSide] = parsed === null ? null : SheetModelSchema.parse(parsed);
    cases.set(name, entry);
  }
  return [...cases.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
})();

export function pinModel(name: string, side: PinSide): SheetModel | null {
  const found = PIN_CASES.find((entry) => entry.name === name);
  if (!found) throw new Error(`no fixture ${name} in the pin`);
  return found[side];
}

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * A body of a fixture's side, as a machine's service would answer it: a text reference as text, an image reference or
 * an upload as its bytes (fetched from the page's own server, so only where one serves them: the harness), anything
 * else as `gone`.
 */
export async function pinBody(name: string, side: PinSide, of: SheetBodyRequest): Promise<SheetBody> {
  const model = pinModel(name, side);
  if (model === null) return { kind: 'gone' };
  const dir = `/fixtures/${name}/${side}/sheet/${model.session}/`;
  const find = <T>(table: Record<string, T>, rest: string): T | undefined => Object.entries(table).find(([path]) => path.endsWith(dir + rest))?.[1];
  const image = async (rest: string, mediaType: string): Promise<SheetBody> => {
    const url = find(URLS, rest);
    if (!url || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) return { kind: 'gone' };
    const bytes = new Uint8Array(await (await fetch(await url())).arrayBuffer());
    return { kind: 'image', mediaType: mediaType as 'image/png', data: base64(bytes) };
  };
  if ('ref' in of) {
    const reference = model.open.flatMap((question) => question.references).find((entry) => entry.sha256 === of.ref);
    if (!reference) return { kind: 'gone' };
    if (reference.kind === 'image') return image(`refs/${of.ref}`, reference.mediaType ?? '');
    const text = find(TEXTS, `refs/${of.ref}`);
    return text ? { kind: 'text', text: await text() } : { kind: 'gone' };
  }
  if ('upload' in of) {
    const extension = /\.(png|jpe?g|gif|webp)$/.exec(of.upload)?.[1] ?? '';
    return image(of.upload, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
  }
  return { kind: 'gone' };
}
