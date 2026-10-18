// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13, Decision Log 18): a deck's x-embed served to the
// presenter through `maws-artifact:` as a page of its own, under the embed's own sandbox policy (scripts, no network),
// read from the deck's live state; any other URL is the store's to answer.
import { describe, expect, it } from 'vitest';
import { importSlide, writeDeckKeys } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { EMBED_CSP } from '@artifacts/slides/render-rules';
import { newDoc, stateV2, transact } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { embedUrl, presentationEmbeds } from './present-embeds';

const DECK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FILE = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

function deckState(): Uint8Array {
  const doc = newDoc();
  const loaded = loadSlide(`<section id="s1"><x-embed id="clock" style="position:absolute; left:0px; top:0px; width:400px; height:300px"><p id="out">tick</p><script>document.getElementById('out').textContent = 'ran'</script></x-embed><p id="t" style="font-size:40px">Hi</p></section>`, { fileId: 's1' });
  if (!loaded.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s1'] });
    importSlide(doc, loaded.slide, 'a0');
  });
  return stateV2(doc);
}

function host() {
  const calls: string[] = [];
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    calls.push(name);
    const { artifactId } = input as { artifactId: string };
    if (name === 'artifacts.get') return { ok: true, value: { artifact: artifactId === DECK ? { kind: 'presentation', revision: 7 } : { kind: 'file', revision: 1 } } } as never;
    if (name === 'artifacts.state') return { ok: true, value: { revision: 7, bytes: deckState() } } as never;
    throw new Error(`unexpected ${name}`);
  };
  return { call, calls };
}

describe('the presenter’s embeds', () => {
  it('names an embed by deck, slide and element, its markup’s hash keeping a changed embed from a cached page', () => {
    expect(embedUrl(DECK, 's1', 'clock', '<p>a</p>')).toMatch(new RegExp(`^maws-artifact://${DECK}/live/embeds/s1/clock\\.html\\?v=[0-9a-z]+$`));
    expect(embedUrl(DECK, 's1', 'clock', '<p>a</p>')).not.toBe(embedUrl(DECK, 's1', 'clock', '<p>b</p>'));
  });

  it('serves the embed’s page from the deck’s live state with its sandbox policy: scripts, no network', async () => {
    const { call } = host();
    const answer = (await presentationEmbeds(call)(new Request(embedUrl(DECK, 's1', 'clock', 'x'))))!;
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const csp = answer.headers.get('Content-Security-Policy')!;
    expect(csp.startsWith('sandbox allow-scripts; ')).toBe(true);
    expect(csp).toContain(EMBED_CSP);
    expect(csp).not.toMatch(/connect-src (?!'none')/);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    const page = await answer.text();
    expect(page).toContain("document.getElementById('out').textContent = 'ran'");
  });

  it('answers 404 for an element that is not an embed or is not there, and leaves other URLs to the store', async () => {
    const { call } = host();
    const embeds = presentationEmbeds(call);
    expect((await embeds(new Request(embedUrl(DECK, 's1', 't', 'x'))))!.status).toBe(404);
    expect((await embeds(new Request(embedUrl(DECK, 's9', 'clock', 'x'))))!.status).toBe(404);
    expect(await embeds(new Request(`maws-artifact://${DECK}/live/assets/pic.png`))).toBeNull();
    expect(await embeds(new Request(`maws-artifact://${FILE}/live/embeds/s1/clock.html`))).toBeNull();
    expect(await embeds(new Request(`maws-artifact://${DECK}/7/embeds/s1/clock.html`))).toBeNull();
  });

  it('reads the deck once per revision', async () => {
    const { call, calls } = host();
    const embeds = presentationEmbeds(call);
    await embeds(new Request(embedUrl(DECK, 's1', 'clock', 'x')));
    await embeds(new Request(embedUrl(DECK, 's1', 'clock', 'y')));
    expect(calls.filter((c) => c === 'artifacts.state')).toHaveLength(1);
  });
});
