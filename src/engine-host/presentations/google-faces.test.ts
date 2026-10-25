// P4-B2 D19: the engine host's fetch of a named Google Fonts face, over the grounding's recorded answers
// (e2e/fixtures/google-fonts/, its map.json the e2e's too) through the `google-fonts` egress rule: one fetch for two
// commits, the stale result discarded, an offline attempt retried, a refusal recorded by name, a refused link never
// fetched, a load as a trigger, a design like a deck, the sliced answer's TTF fallback and a family too large.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { faceFiles, googleRecord, type DeckFace } from '@artifacts/slides/deck';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { openDocuments, type Documents } from '../documents';
import { registerDesigns } from '../designs';
import { egressGet, fixtureFetch, GOOGLE_FONTS_EGRESS, type BaseFetch } from '@shared/net/egress';
import { registerPresentations } from '.';
import { fetchFamily, startGoogleFaces, type GoogleFaces } from './google-faces';
import { googleRequest } from '@artifacts/slides/google-faces';

const FIXTURES = resolve(__dirname, '../../../e2e/fixtures/google-fonts');
const human: Actor = { kind: 'human' };
const LORA = 'https://fonts.googleapis.com/css2?family=Lora';
const SLAB = 'https://fonts.googleapis.com/css2?family=Roboto+Slab';
const META = 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/METADATA.pb';

let userData: string;
let documents: Documents;
let closers: { close(): void }[];
let faces: GoogleFaces | null;
let calls: string[];
let now: number;
let timers: { run: () => void; ms: number; cancelled: boolean }[];
/** The fixtures' map, recording each URL asked; `offline` fails every URL as the network does. */
let offline: boolean;
let gate: Promise<void> | null;
const recorded = (inner: BaseFetch): BaseFetch => async (url, init) => {
  calls.push(url);
  if (gate) await gate;
  if (offline) throw new TypeError('fetch failed');
  return inner(url, init);
};

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-gf-'));
  documents = openDocuments(userData, () => {})!;
  closers = [registerPresentations({ documents, chain: null, refresh: () => {}, env: {} }), registerDesigns({ documents, chain: null, refresh: () => {}, env: {} })];
  calls = [];
  now = 1_000_000;
  timers = [];
  offline = false;
  gate = null;
  faces = null;
});
afterEach(() => {
  faces?.close();
  for (const closer of closers) closer.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});

function start(base: BaseFetch = recorded(fixtureFetch(FIXTURES))): GoogleFaces {
  faces = startGoogleFaces(documents, {
    get: egressGet(GOOGLE_FONTS_EGRESS, base),
    now: () => now,
    log: () => {},
    setTimer: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return { cancel: () => void (timer.cancelled = true) };
    },
  });
  return faces;
}
const store = () => documents.store;
async function deck(kind: 'presentation' | 'design' = 'presentation'): Promise<string> {
  return (await store().create({ kind, title: 'Deck' }, human)).id;
}
const name = (id: string, key: string, face: DeckFace) => store().writeWithAssets(id, human, [], (doc) => Y.setDeckEntry(doc, 'faces', key, face as unknown as Y.Json));
const faceOf = (id: string, key: string) => Y.deckEntries(store().service.live(id), 'faces')?.[key] as unknown as DeckFace;
const fontAssets = (id: string) => store().listAssets(id).filter((a) => a.name.startsWith('gf-')).map((a) => `${a.ref} ${a.mime}`);

describe('the host’s Google Fonts fetch', () => {
  it('fetches an OFL face once for two commits, its licence and files written with the face’s record in one write', async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const f = start();
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: `${LORA}&display=swap` });
    await new Promise((resolve) => setImmediate(resolve));
    await name(id, 'lora', { family: 'Lora', href: `${LORA}&display=swap`, note: 'second commit' }); // while the first fetch runs
    await new Promise((resolve) => setImmediate(resolve)); // its faces read
    release();
    await f.idle();
    expect(calls).toEqual([META, 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/OFL.txt', LORA, 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJD.woff2']);
    const face = faceOf(id, 'lora');
    expect(face).toMatchObject({ family: 'Lora', note: 'second commit' });
    expect(googleRecord(face)).toEqual({ request: LORA, licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] });
    expect(faceFiles(face)).toEqual([{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }]);
    expect(fontAssets(id)).toEqual(['assets/gf-lora-OFL.txt text/plain', 'assets/gf-lora-400.woff2 font/woff2']);
    // further commits and loads ask nothing: the record answers the request
    await name(id, 'other', { family: 'Brand', src: 'assets/brand.woff2' });
    await f.idle();
    expect(calls).toHaveLength(4);
  });

  it('records a non-OFL face’s refusal by its licence, fetching nothing past the licence', async () => {
    const f = start();
    const id = await deck();
    await name(id, 'roboto-slab', { family: 'Roboto Slab', href: SLAB });
    await f.idle();
    expect(calls).toEqual(['https://raw.githubusercontent.com/google/fonts/main/ofl/robotoslab/METADATA.pb', 'https://raw.githubusercontent.com/google/fonts/main/apache/robotoslab/METADATA.pb']);
    expect(faceOf(id, 'roboto-slab').google).toEqual({ request: SLAB, refused: 'Apache-2.0' });
    expect(fontAssets(id)).toEqual([]);
  });

  it('never fetches a link refused by its own shape: another family, several families, a text= subset', async () => {
    const f = start();
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: SLAB });
    await name(id, 'two', { family: 'Two', href: `https://fonts.googleapis.com/css2?family=Two&family=Lora` });
    await name(id, 'subset', { family: 'Lora', href: `${LORA}&text=Hello` });
    await f.idle();
    expect(calls).toEqual([]);
    expect(faceOf(id, 'lora').google).toBeUndefined();
  });

  it('discards a result whose face changed its request during the fetch, writing nothing of it', async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const f = start();
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: LORA });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([META]); // waiting on the gate
    await name(id, 'lora', { family: 'Lora', href: `${LORA}:wght@700` }); // the agent's edit since
    release();
    gate = null;
    await f.idle();
    expect(faceOf(id, 'lora')).toEqual({ family: 'Lora', href: `${LORA}:wght@700` }); // the new request is not in the map: pending
    expect(fontAssets(id)).toEqual([]);
  });

  it('discards a result when a record answers the face already (a restore’s carry), writing nothing of it', async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const f = start();
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: LORA });
    await new Promise((resolve) => setImmediate(resolve));
    const carried = { request: LORA, licence: 'OFL', licenceSrc: 'assets/kept-OFL.txt', files: [{ src: 'assets/kept.woff2', weight: '400', style: 'normal' }] };
    await name(id, 'lora', { family: 'Lora', href: LORA, google: carried });
    release();
    gate = null;
    await f.idle();
    expect(faceOf(id, 'lora').google).toEqual(carried);
    expect(fontAssets(id)).toEqual([]);
  });

  it('writes nothing offline, retries on the next commit after the pause and by its backoff, and saves once online', async () => {
    offline = true;
    const f = start();
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: LORA });
    await f.idle();
    expect(calls).toEqual([META]);
    expect(faceOf(id, 'lora').google).toBeUndefined();
    expect(timers.filter((t) => !t.cancelled).map((t) => t.ms)).toEqual([30_000]);
    // a commit within the pause asks nothing; the backoff's timer does
    await name(id, 'lora', { family: 'Lora', href: LORA, note: 1 });
    await f.idle();
    expect(calls).toHaveLength(1);
    timers.at(-1)!.run();
    await f.idle();
    expect(calls).toHaveLength(2);
    expect(timers.filter((t) => !t.cancelled).map((t) => t.ms)).toEqual([60_000]); // the backoff grows
    // back online: the next commit past the pause retries at once
    offline = false;
    now += 10_000;
    await name(id, 'lora', { family: 'Lora', href: LORA, note: 2 });
    await f.idle();
    expect(googleRecord(faceOf(id, 'lora'))).toMatchObject({ licence: 'OFL' });
    expect(timers.filter((t) => !t.cancelled)).toEqual([]);
  });

  // the review's P1: identical bytes already uploaded answer the upload's own ref, which the record holds as it is
  it('records the ref an earlier upload of the same bytes answers, and never loops on a ref no reader takes', async () => {
    const f = start();
    const id = await deck();
    const woff2 = new Uint8Array(readFileSync(join(FIXTURES, 'lora-400.woff2')));
    await store().uploadAsset(id, woff2, { name: 'Lora Regular.woff2', mime: 'font/woff2' }, human);
    await name(id, 'lora', { family: 'Lora', href: LORA });
    await f.idle();
    expect(faceFiles(faceOf(id, 'lora'))).toEqual([{ src: 'assets/Lora Regular.woff2', weight: '400', style: 'normal' }]);
    expect(calls.filter((url) => url === LORA)).toHaveLength(1);

    // a name the store keeps but no record may hold (a control character): the write is taken back and waits its backoff
    const other = await deck();
    await store().uploadAsset(other, woff2, { name: 'Lora\u0001.woff2', mime: 'font/woff2' }, human);
    await name(other, 'lora', { family: 'Lora', href: LORA });
    await f.idle();
    expect(faceOf(other, 'lora').google).toBeUndefined();
    expect(calls.filter((url) => url === LORA)).toHaveLength(2);
    expect(timers.filter((t) => !t.cancelled).map((t) => t.ms)).toEqual([30_000]);
    // the backoff grows across failed writes as across failed fetches (the second round's P2)
    timers.at(-1)!.run();
    await f.idle();
    expect(calls.filter((url) => url === LORA)).toHaveLength(3);
    expect(timers.filter((t) => !t.cancelled).map((t) => t.ms)).toEqual([60_000]);
  });

  it('fetches on a document’s load: a deck named before this run, opened in it', async () => {
    const id = await deck();
    await name(id, 'lora', { family: 'Lora', href: LORA });
    for (const closer of closers) closer.close();
    documents.close();
    documents = openDocuments(userData, () => {})!;
    closers = [registerPresentations({ documents, chain: null, refresh: () => {}, env: {} })];
    const f = start();
    await f.idle();
    expect(calls).toEqual([]); // nothing loaded, nothing asked
    store().service.live(id); // an editor's attach, a read, an export
    await f.idle();
    expect(googleRecord(faceOf(id, 'lora'))).toMatchObject({ request: LORA, licence: 'OFL' });
  });

  it('serves a design’s faces as a deck’s, and one fetch for two artifacts naming the family', async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const f = start();
    const [a, b] = [await deck('design'), await deck()];
    await name(a, 'lora', { family: 'Lora', href: LORA });
    await new Promise((resolve) => setImmediate(resolve));
    await name(b, 'lora', { family: 'Lora', href: `${LORA}&display=swap` }); // while the design's fetch runs
    await new Promise((resolve) => setImmediate(resolve)); // the deck's faces read
    release();
    await f.idle();
    expect(calls.filter((url) => url === LORA)).toHaveLength(1);
    for (const id of [a, b]) expect(googleRecord(faceOf(id, 'lora'))).toMatchObject({ licence: 'OFL' });
  });
});

describe('fetchFamily over answers the recordings do not hold', () => {
  const lora = (() => {
    const asked = googleRequest('Lora', LORA);
    if (!asked.ok) throw new Error('the request');
    return asked.request;
  })();
  const fixtures = fixtureFetch(FIXTURES);

  it('asks again without a user agent when the answer comes back sliced, and takes the TTF form', async () => {
    const asked: (string | null)[] = [];
    const ttf = new Uint8Array([0, 1, 0, 0, 0, 16, 1, 0]);
    const base: BaseFetch = async (url, init) => {
      if (url === LORA) {
        const ua = (init.headers as Record<string, string>)['user-agent'] ?? null;
        asked.push(ua);
        return new Response(readFileSync(join(FIXTURES, ua ? 'lora-chrome.css.txt' : 'lora-wght-noua.css.txt')), { headers: { 'content-type': 'text/css' } });
      }
      if (url.startsWith('https://fonts.gstatic.com/')) return new Response(ttf, { headers: { 'content-type': 'font/ttf' } });
      return fixtures(url, init);
    };
    const fetched = await fetchFamily(lora, egressGet(GOOGLE_FONTS_EGRESS, base));
    expect(asked).toEqual([expect.stringContaining('Firefox/40.0'), null]);
    expect(fetched.kind === 'saved' && fetched.files.map((file) => `${file.weight} ${file.ext} ${file.mime}`)).toEqual(['400 ttf font/ttf', '700 ttf font/ttf']);
  });

  it('refuses a family whose file is over the asset limit, and a file that is not a font', async () => {
    const answering = (respond: () => Response): BaseFetch => async (url, init) => (url.startsWith('https://fonts.gstatic.com/') ? respond() : fixtures(url, init));
    const huge = await fetchFamily(lora, egressGet(GOOGLE_FONTS_EGRESS, answering(() => new Response('x', { headers: { 'content-type': 'font/woff2', 'content-length': String(ARTIFACT_MAX_BYTES + 1) } }))));
    expect(huge).toMatchObject({ kind: 'refused', refused: 'too-large' });
    const html = await fetchFamily(lora, egressGet(GOOGLE_FONTS_EGRESS, answering(() => new Response('<html>', { headers: { 'content-type': 'font/woff2' } }))));
    expect(html).toMatchObject({ kind: 'refused', refused: 'unreadable' });
  });

  it('keeps a 5xx, a redirect and an answer of the wrong type pending', async () => {
    for (const respond of [() => new Response(null, { status: 503 }), () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }), () => new Response('<html>', { headers: { 'content-type': 'text/html' } })]) {
      const fetched = await fetchFamily(lora, egressGet(GOOGLE_FONTS_EGRESS, async () => respond()));
      expect(fetched.kind).toBe('pending');
    }
  });

  it('refuses a family no licence directory holds as unlisted, and Google’s 400 as unserved', async () => {
    const missing = await fetchFamily({ ...lora, family: 'Nowhere', dir: 'nowhere', url: 'https://fonts.googleapis.com/css2?family=Nowhere' }, egressGet(GOOGLE_FONTS_EGRESS, async () => new Response('404: Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })));
    expect(missing).toMatchObject({ kind: 'refused', refused: 'unlisted' });
    const unserved = await fetchFamily(lora, egressGet(GOOGLE_FONTS_EGRESS, async (url, init) => (url === LORA ? new Response('<html>', { status: 400, headers: { 'content-type': 'text/html' } }) : fixtures(url, init))));
    expect(unserved).toMatchObject({ kind: 'refused', refused: 'unserved' });
  });
});
