// The scheme's remote responder (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5b's Proves for
// this file): through the real chain `startArtifacts` installs on the window's session (the presenter's embeds, then the
// remote responder, then the local path), over a link whose streams are the real device table (../machines/remote/
// streams.ts) and whose endpoint the test plays: the chain's order, the referrer rule, the cap of 8 open streams a link,
// `Content-Length` held, a range as 206, a refusal as a status the frame shows, 503 offline and 504 unanswered, credit
// given as the body is read, and `artifacts.downloadAsset` of another machine's asset.
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceMessage, EndpointMessage } from 'org-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink } from '../../../test/lane-b/fake-link';
import { StreamTable, type StreamRequest, type StreamSink } from '../machines/remote/streams';
import type { LinkState } from '../machines/manager';
import { ArtifactMachines } from './machines';
import { createRemoteScheme, HTTP_STREAM_CREDIT, HTTP_STREAMS_PER_LINK } from './remote-scheme';

const sessions = vi.hoisted(() => {
  const make = () => ({ protocol: { handle: vi.fn() } });
  return { default: make(), capture: make() };
});
vi.mock('electron', () => ({
  protocol: {},
  MessageChannelMain: class {},
  session: { defaultSession: sessions.default, fromPartition: () => sessions.capture },
}));

import { startArtifacts, type ArtifactsDeps } from '.';
import { createAssetDownload } from '../dashboard/download';
import { createRemoteArtifacts } from '../lane-b/remote-artifacts';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const MINI = 'MiniMachineRef00000000' as MachineRef;
const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d'; // on the mini
const EMBED = '1b2c3d4e-5f6a-4b7c-8d9e-9f0a1b2c3d4e'; // an artifact the mini's page embeds, which nothing listed
const HERE = '2c3d4e5f-6a7b-4c8d-9eaf-a0b1c2d3e4f5'; // this Mac's
const url = (id: string, path = 'index.html', revision: number | 'live' = 'live') => `maws-artifact://${id}/${revision}/${path}`;
const b64 = (text: string) => Buffer.from(text).toString('base64url');

/** A link whose streams are the device's real table; its channel is current while it is `up`, and what it sends is kept. */
class TableLink extends FakeLink {
  readonly sent: DeviceMessage[] = [];
  /** Told of each message sent. */
  onSend: (message: DeviceMessage) => void = () => {};
  readonly table = new StreamTable({
    send: (m) => (this.state() === 'up' ? (this.sent.push(m), this.onSend(m), true) : false),
    current: () => this.state() === 'up',
    peerCapabilities: () => this.peerCapabilities(),
    log: () => {},
  });
  override openStream(request: StreamRequest, sink: StreamSink) {
    return this.table.open(request, sink, this.ended());
  }
  override set(state: LinkState, carrier?: 'direct' | 'relay' | null, refusal?: string | null): void {
    super.set(state, carrier, refusal);
    if (state === 'up') this.table.onCurrent();
    else this.table.onLost();
  }
  /** The `streamOpen`s sent. */
  opens() {
    return this.sent.filter((m) => m.t === 'streamOpen') as Array<Extract<DeviceMessage, { t: 'streamOpen' }>>;
  }
  of(t: string, id?: string) {
    return this.sent.filter((m) => m.t === t && (id === undefined || (m as { id?: string }).id === id)) as Array<DeviceMessage & Record<string, unknown>>;
  }
  /** The endpoint's message. */
  hear(message: EndpointMessage): void {
    this.table.receive(message);
  }
  /** The endpoint's whole answer: its status and headers, the body from offset 0 in `chunks`, then its close. */
  answer(id: string, status: number, headers: Record<string, string>, chunks: string[] = [], close = 'closed'): void {
    this.hear({ t: 'streamOpened', id, credit: 1, http: { status, headers } });
    let offset = 0;
    for (const chunk of chunks) {
      this.hear({ t: 'streamData', id, offset, data: b64(chunk) });
      offset += Buffer.byteLength(chunk);
    }
    if (close !== '') this.hear({ t: 'streamClose', id, reason: close });
  }
}

const dirs: string[] = [];
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/**
 * main's chain as startArtifacts installs it, with the remote responder over the mini's link. `asked`: in order, each
 * engine host read of this Mac (`local:<name> <id>`) and each stream the link sent (`stream <url>`).
 */
function scene(options: { openTimeoutMs?: number; idleMs?: number; peers?: string[] } = {}) {
  const root = scratch('maws-remote-scheme-');
  const file = join(root, 'page.html');
  writeFileSync(file, '<p>from main</p>');
  const asked: string[] = [];
  const link = new TableLink(MINI);
  link.peers = options.peers ?? ['rl2.streams', 'rl2.read-open'];
  link.onSend = (m) => void (m.t === 'streamOpen' && asked.push(`stream ${m.http?.url}`));
  const machines = new ArtifactMachines();
  machines.record(PAGE, MINI);
  const dispatch = vi.fn(async (_owner: string, name: string, input: { artifactId: string }) => {
    asked.push(`local:${name} ${input.artifactId}`);
    if (name === 'artifacts.content' && input.artifactId === HERE) return { ok: true, value: { revision: 1, kind: 'html', name: 'index.html', size: 0, sha256: 'x', path: file } };
    return { ok: false, error: { code: 'invalid_input', message: 'no such artifact' } };
  });
  const logged: string[] = [];
  const scheme = createRemoteScheme({ machines, remote: (machine) => (machine === MINI ? link : null), ...(options.openTimeoutMs !== undefined && { openTimeoutMs: options.openTimeoutMs }), ...(options.idleMs !== undefined && { idleMs: options.idleMs }), log: (line) => void logged.push(line) });
  stops.push(() => scheme.stop());
  sessions.default.protocol.handle.mockClear();
  const hosts = { dispatch, postDocPort: vi.fn(), closeDocPorts: vi.fn(), onState: () => () => {}, onStreaming: () => () => {}, onEvent: vi.fn(() => () => {}), peer: () => null };
  const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: vi.fn() as never, registerMachine: vi.fn() as never, emit: vi.fn() as never, env: {}, openWindow: vi.fn() as never, root, artifactsSocket: null, remote: scheme.respond });
  stops.push(() => started.stop());
  const handler = sessions.default.protocol.handle.mock.calls.at(-1)![1] as (request: Request) => Promise<Response>;
  /** The stream the `n`th open named (its id), once it went out. */
  const opened = async (n: number) => {
    await vi.waitFor(() => expect(link.opens().length).toBeGreaterThan(n));
    return link.opens()[n]!.id;
  };
  return { link, machines, scheme, handler, asked, opened, logged };
}

describe('the responder chain', () => {
  it('asks the presenter’s embeds first, then the remote responder for an artifact the table places on an RL2 machine, and never this Mac’s store for it', async () => {
    const s = scene();
    const page = s.handler(new Request(url(PAGE)));
    const id = await s.opened(0);
    expect(s.link.opens()[0]).toEqual({ t: 'streamOpen', id, kind: 'http', credit: HTTP_STREAM_CREDIT, http: { url: url(PAGE), method: 'GET' } });
    s.link.answer(id, 200, { 'content-type': 'text/html', 'content-length': '13', 'x-content-type-options': 'nosniff' }, ['<p>from ', 'B</p>']);
    const response = await page;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('<p>from B</p>');
    expect(s.asked).toEqual([`stream ${url(PAGE)}`]); // never this Mac's content
    // a deck's embed URL: the presenter's embeds are asked first (this Mac's host has no such deck), then the machine
    const embed = s.handler(new Request(url(PAGE, 'embeds/slide-1/element-1.html')));
    s.link.answer(await s.opened(1), 200, {}, ['the machine’s']);
    expect(await (await embed).text()).toBe('the machine’s');
    expect(s.asked).toEqual([`stream ${url(PAGE)}`, `local:artifacts.get ${PAGE}`, `stream ${url(PAGE, 'embeds/slide-1/element-1.html')}`]);
  });

  it('leaves an artifact the table doesn’t place to this Mac’s store, sending nothing', async () => {
    const s = scene();
    expect(await (await s.handler(new Request(url(HERE)))).text()).toContain('from main');
    expect(s.asked).toEqual([`local:artifacts.content ${HERE}`]);
    expect(s.link.sent).toEqual([]);
  });
});

// b3's review: this Mac's store answers an id the table doesn't place before any referrer does, and the responder never
// writes the table, so a referrer can't take a local artifact to another machine. An embed this Mac's store doesn't hold
// goes to the machine of the page it loads from.
describe('the referrer rule', () => {
  it('sends a page’s embed this Mac’s store doesn’t hold to the machine of the page it loads from, recording nothing', async () => {
    const s = scene();
    const font = s.handler(new Request(url(EMBED, 'assets/face.woff2'), { referrer: url(PAGE, 'index.html', 3) }));
    const id = await s.opened(0);
    expect(s.link.opens()[0]!.http).toEqual({ url: url(EMBED, 'assets/face.woff2'), method: 'GET' });
    s.link.answer(id, 200, { 'content-length': '4' }, ['font']);
    expect(await (await font).text()).toBe('font');
    expect(s.asked).toEqual([`local:artifacts.content ${EMBED}`, `stream ${url(EMBED, 'assets/face.woff2')}`]); // this Mac's store first
    expect(s.machines.machineOf(EMBED)).toBeNull();
    // an origin-only referrer is the page's too, and the machine's own 404 is the answer
    const viaOrigin = s.handler(new Request(url(EMBED, 'assets/a.png'), { referrer: `maws-artifact://${PAGE}/` }));
    s.link.answer(await s.opened(1), 404, { 'content-type': 'text/plain' });
    expect((await viaOrigin).status).toBe(404);
    // a load of the embed with no referrer (an unplaced id): this Mac's 404, nothing sent
    const bare = await s.handler(new Request(url(EMBED, 'index.html')));
    expect(bare.status).toBe(404);
    expect(s.link.opens()).toHaveLength(2);
  });

  it('keeps a local artifact here whatever page refers to it, and later loads of it too', async () => {
    const s = scene();
    const referred = await s.handler(new Request(url(HERE), { referrer: url(PAGE, 'index.html', 3) }));
    expect(await referred.text()).toContain('from main');
    expect(await (await s.handler(new Request(url(HERE)))).text()).toContain('from main');
    expect(s.link.sent).toEqual([]);
    expect(s.machines.machineOf(HERE)).toBeNull();
  });

  it('leaves to this Mac an embed whose page is this Mac’s, or whose referrer is no artifact', async () => {
    const s = scene();
    await s.handler(new Request(url(EMBED, 'assets/a.png'), { referrer: url(HERE) }));
    await s.handler(new Request(url(EMBED, 'assets/a.png'), { referrer: 'http://localhost:5173/' }));
    expect(s.link.sent).toEqual([]);
    expect(s.asked.filter((line) => line.startsWith('local:artifacts.content'))).toHaveLength(2);
  });
});

describe('a request over the link', () => {
  it('passes a range through and answers the 206 as received', async () => {
    const s = scene();
    const media = s.handler(new Request(url(PAGE, 'assets/clip.mp4'), { headers: { Range: 'bytes=4-9' } }));
    const id = await s.opened(0);
    expect(s.link.opens()[0]!.http).toEqual({ url: url(PAGE, 'assets/clip.mp4'), method: 'GET', range: 'bytes=4-9' });
    s.link.answer(id, 206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': 'bytes 4-9/100', 'content-length': '6' }, ['456789']);
    const response = await media;
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 4-9/100');
    expect(response.headers.get('content-length')).toBe('6');
    expect(await response.text()).toBe('456789');
  });

  it('answers a HEAD with the status and headers alone', async () => {
    const s = scene();
    const head = s.handler(new Request(url(PAGE), { method: 'HEAD' }));
    const id = await s.opened(0);
    expect(s.link.opens()[0]!.http).toEqual({ url: url(PAGE), method: 'HEAD' });
    s.link.answer(id, 200, { 'content-length': '12' });
    const response = await head;
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it('holds the body to its Content-Length: a short body, a long one and a stream lost mid-body fail the load', async () => {
    const s = scene();
    const short = s.handler(new Request(url(PAGE)));
    s.link.answer(await s.opened(0), 200, { 'content-length': '10' }, ['abcd']);
    const shortBody = await short;
    expect(shortBody.status).toBe(200);
    await expect(shortBody.text()).rejects.toThrow();

    const long = s.handler(new Request(url(PAGE)));
    const longId = await s.opened(1);
    s.link.answer(longId, 200, { 'content-length': '2' }, ['abcd'], '');
    await expect((await long).text()).rejects.toThrow();
    expect(s.link.of('streamClose', longId)).toEqual([{ t: 'streamClose', id: longId, reason: 'closed' }]); // what it held is let go

    const lost = s.handler(new Request(url(PAGE)));
    s.link.answer(await s.opened(2), 200, {}, ['ab'], 'unavailable');
    await expect((await lost).text()).rejects.toThrow();

    const whole = s.handler(new Request(url(PAGE)));
    s.link.answer(await s.opened(3), 200, { 'content-length': '4' }, ['ab', 'cd']);
    expect(await (await whole).text()).toBe('abcd');
  });

  it('gives the endpoint credit as the body is read, never before', async () => {
    const s = scene();
    const page = s.handler(new Request(url(PAGE)));
    const id = await s.opened(0);
    s.link.answer(id, 200, { 'content-length': '6' }, ['abc', 'def'], '');
    const reader = (await page).body!.getReader();
    expect(s.link.of('streamCredit', id)).toEqual([]);
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('abc');
    expect(s.link.of('streamCredit', id)).toEqual([{ t: 'streamCredit', id, bytes: 3 }]);
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('def');
    expect(s.link.of('streamCredit', id).map((m) => m.bytes)).toEqual([3, 3]);
    // a read waiting for bytes takes them as they come, credited at once
    const next = reader.read();
    s.link.hear({ t: 'streamClose', id, reason: 'closed' });
    expect((await next).done).toBe(true);
  });

  it('fails the load of an endpoint that sends past the credit granted, holding none of the excess (b3’s review)', async () => {
    const s = scene();
    const page = s.handler(new Request(url(PAGE)));
    const id = await s.opened(0);
    s.link.hear({ t: 'streamOpened', id, credit: 1, http: { status: 200, headers: {} } });
    const chunk = Buffer.alloc(64 * 1024, 1).toString('base64url');
    for (let n = 0; n < (2 * HTTP_STREAM_CREDIT) / (64 * 1024); n += 1) s.link.hear({ t: 'streamData', id, offset: n * 64 * 1024, data: chunk });
    expect(s.link.of('streamClose', id)).toEqual([{ t: 'streamClose', id, reason: 'malformed' }]);
    await expect((await page).text()).rejects.toThrow();
  });

  it('closes the stream when the frame stops reading the body', async () => {
    const s = scene();
    const page = s.handler(new Request(url(PAGE)));
    const id = await s.opened(0);
    s.link.answer(id, 200, {}, ['abc'], '');
    await (await page).body!.cancel();
    expect(s.link.of('streamClose', id)).toEqual([{ t: 'streamClose', id, reason: 'closed' }]);
  });

  it('maps a refusal to a status the frame shows, with the machine’s name', async () => {
    const s = scene();
    const statuses: Array<[string, number]> = [];
    for (const reason of ['grade', 'malformed', 'unavailable', 'busy'] as const) {
      const page = s.handler(new Request(url(PAGE)));
      s.link.hear({ t: 'streamRefused', id: await s.opened(statuses.length), reason });
      const response = await page;
      statuses.push([reason, response.status]);
      expect(await response.text()).toContain('mini');
    }
    expect(statuses).toEqual([['grade', 403], ['malformed', 400], ['unavailable', 502], ['busy', 503]]);
  });

  it('answers 501 "doesn’t offer this", sending nothing, for an endpoint that lists no `rl2.read-open`', async () => {
    const s = scene({ peers: ['rl2.streams'] });
    const response = await s.handler(new Request(url(PAGE)));
    expect(response.status).toBe(501);
    expect(await response.text()).toBe('mini doesn’t offer this');
    expect(s.link.sent).toEqual([]);
  });
});

describe('the cap and the bounds', () => {
  it('holds at most 8 http streams open on a link, the rest waiting their turn in order', async () => {
    const s = scene();
    const pages = Array.from({ length: HTTP_STREAMS_PER_LINK + 2 }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.png`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.link.opens()).toHaveLength(HTTP_STREAMS_PER_LINK);
    s.link.answer(s.link.opens()[0]!.id, 200, {}, ['x']);
    expect(await (await pages[0]!).text()).toBe('x');
    await s.opened(HTTP_STREAMS_PER_LINK);
    expect(s.link.opens()).toHaveLength(HTTP_STREAMS_PER_LINK + 1);
    expect(s.link.opens()[HTTP_STREAMS_PER_LINK]!.http?.url).toBe(url(PAGE, `assets/${HTTP_STREAMS_PER_LINK}.png`));
    // a refusal frees its slot as a close does
    s.link.hear({ t: 'streamRefused', id: s.link.opens()[1]!.id, reason: 'grade' });
    await s.opened(HTTP_STREAMS_PER_LINK + 1);
    expect(s.link.opens().at(-1)!.http?.url).toBe(url(PAGE, `assets/${HTTP_STREAMS_PER_LINK + 1}.png`));
  });

  it('answers 503 "<machine> is offline" while the link is down, sending nothing, and when it goes down before the answer', async () => {
    const s = scene();
    s.link.set('down');
    const down = await s.handler(new Request(url(PAGE)));
    expect([down.status, await down.text()]).toEqual([503, 'mini is offline']);
    s.link.set('up');
    const page = s.handler(new Request(url(PAGE)));
    await s.opened(0);
    s.link.set('down');
    const lost = await page;
    expect([lost.status, await lost.text()]).toEqual([503, 'mini is offline']);
  });

  it('opens a request lost with its channel before its answer again on the next one', async () => {
    const s = scene();
    s.link.set('connecting');
    const page = s.handler(new Request(url(PAGE)));
    s.link.set('up');
    const first = await s.opened(0);
    s.link.set('connecting'); // the channel lost, the link not down
    s.link.set('up');
    const second = await s.opened(1);
    expect(second).not.toBe(first);
    s.link.answer(second, 200, {}, ['again']);
    expect(await (await page).text()).toBe('again');
  });

  it('answers 504 when nothing opened in time, closing the stream and freeing its slot', async () => {
    const s = scene({ openTimeoutMs: 200 });
    const page = s.handler(new Request(url(PAGE)));
    const id = await s.opened(0);
    const response = await page;
    expect([response.status, await response.text()]).toEqual([504, 'mini didn’t answer in time']);
    expect(s.link.of('streamClose', id)).toEqual([{ t: 'streamClose', id, reason: 'closed' }]);
    s.link.answer(id, 200, {}, ['late']); // an answer after it is nobody's
    const next = s.handler(new Request(url(PAGE)));
    s.link.answer(await s.opened(1), 200, {}, ['next']);
    expect(await (await next).text()).toBe('next');
  });

  // The architect's ruling on b3's review (2026-11-02): a paused media pane holds its stream under spent credit; while
  // another request waits, a stream the frame hasn't read for the idle bound gives its slot up, its body ended normally,
  // and the media element asks again with a Range when it plays on.
  it('lets the oldest idle stream give its slot to a waiting request, its body ended normally with what came', async () => {
    const s = scene({ idleMs: 60 });
    const media = Array.from({ length: HTTP_STREAMS_PER_LINK }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.mp4`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = [];
    for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) {
      s.link.answer(s.link.opens()[n]!.id, 206, { 'content-length': '100', 'content-range': `bytes 0-99/1000` }, ['0123'], '');
      readers.push((await media[n]!).body!.getReader());
      await readers[n]!.read(); // each played its first bytes, then paused
      await new Promise((resolve) => setTimeout(resolve, 5)); // the first paused earliest
    }
    const next = s.handler(new Request(url(PAGE, 'assets/next.png')));
    await s.opened(HTTP_STREAMS_PER_LINK);
    const first = s.link.opens()[0]!.id;
    expect(s.link.of('streamClose', first)).toEqual([{ t: 'streamClose', id: first, reason: 'closed' }]); // the oldest gave way
    expect(s.link.of('streamClose')).toHaveLength(1); // and it alone
    expect((await readers[0]!.read()).done).toBe(true); // a normal end, not an error
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await next).text()).toBe('png');
    await new Promise((resolve) => setTimeout(resolve, 150)); // the other seven idle on, with nothing waiting
    expect(s.link.of('streamClose')).toHaveLength(1);
  });

  it('never takes the slot of a stream the frame keeps reading, nor of an idle one while nothing waits', async () => {
    const s = scene({ idleMs: 60 });
    const pages = Array.from({ length: HTTP_STREAMS_PER_LINK }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.mp4`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = [];
    const offsets = new Array<number>(HTTP_STREAMS_PER_LINK).fill(0);
    for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) {
      s.link.answer(s.link.opens()[n]!.id, 200, {}, [], '');
      readers.push((await pages[n]!).body!.getReader());
    }
    await new Promise((resolve) => setTimeout(resolve, 150)); // idle well past the bound, nothing waiting
    expect(s.link.of('streamClose')).toEqual([]);
    const next = s.handler(new Request(url(PAGE, 'assets/next.png')));
    // every stream keeps flowing: a read waits, the endpoint sends, the frame takes it
    for (let round = 0; round < 6; round += 1) {
      for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) {
        const read = readers[n]!.read();
        s.link.hear({ t: 'streamData', id: s.link.opens()[n]!.id, offset: offsets[n]!, data: b64('ab') });
        offsets[n]! += 2;
        expect((await read).done).toBe(false);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(s.link.of('streamClose')).toEqual([]);
    expect(s.link.opens()).toHaveLength(HTTP_STREAMS_PER_LINK); // the ninth still waits
    s.link.answer(s.link.opens()[0]!.id, 200, {}, [], 'closed');
    await s.opened(HTTP_STREAMS_PER_LINK);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await next).text()).toBe('png');
  });

  it('serves the Range the media element asks with when it plays on after giving way', async () => {
    const s = scene({ idleMs: 60 });
    const media = Array.from({ length: HTTP_STREAMS_PER_LINK }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.mp4`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = [];
    for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) {
      s.link.answer(s.link.opens()[n]!.id, 200, { 'content-length': '10', 'accept-ranges': 'bytes' }, ['0123'], '');
      readers.push((await media[n]!).body!.getReader());
      expect(Buffer.from((await readers[n]!.read()).value!).toString()).toBe('0123'); // played the first bytes, then paused
    }
    const image = s.handler(new Request(url(PAGE, 'assets/next.png')));
    await s.opened(HTTP_STREAMS_PER_LINK);
    // the body ends where the element stopped, and it asks for the rest by its offset
    expect((await readers[0]!.read()).done).toBe(true);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await image).text()).toBe('png');
    const resume = s.handler(new Request(url(PAGE, 'assets/0.mp4'), { headers: { Range: 'bytes=4-' } }));
    await s.opened(HTTP_STREAMS_PER_LINK + 1);
    expect(s.link.opens()[HTTP_STREAMS_PER_LINK + 1]!.http).toEqual({ url: url(PAGE, 'assets/0.mp4'), method: 'GET', range: 'bytes=4-' });
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK + 1]!.id, 206, { 'content-range': 'bytes 4-9/10', 'content-length': '6' }, ['456789']);
    const resumed = await resume;
    expect([resumed.status, await resumed.text()]).toEqual([206, '456789']);
  });

  // b3's review: a body the machine finished but the frame hasn't read still holds its bytes here, so it keeps its slot
  // (and its share of the link's budget) until it is read to its end or let go; it gives way as an idle stream does.
  it('keeps the slot of a finished body until the frame reads it out, so unread bodies make the next request wait', async () => {
    const s = scene();
    const pages = Array.from({ length: HTTP_STREAMS_PER_LINK }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.png`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) s.link.answer(s.link.opens()[n]!.id, 200, { 'content-length': '3' }, ['abc']); // whole, unread
    const responses = await Promise.all(pages);
    const next = s.handler(new Request(url(PAGE, 'assets/next.png')));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(s.link.opens()).toHaveLength(HTTP_STREAMS_PER_LINK); // the ninth waits behind what is held here
    expect(await responses[0]!.text()).toBe('abc'); // one read out: its slot goes to the ninth
    await s.opened(HTTP_STREAMS_PER_LINK);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await next).text()).toBe('png');
    await responses[1]!.body!.cancel(); // a body let go frees its slot too
    const after = s.handler(new Request(url(PAGE, 'assets/after.png')));
    await s.opened(HTTP_STREAMS_PER_LINK + 1);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK + 1]!.id, 200, {}, ['after']);
    expect(await (await after).text()).toBe('after');
  });

  it('lets a finished, unread body give way as an idle stream does, letting go of what it held', async () => {
    const s = scene({ idleMs: 60 });
    const pages = Array.from({ length: HTTP_STREAMS_PER_LINK }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.mp4`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    for (let n = 0; n < HTTP_STREAMS_PER_LINK; n += 1) s.link.answer(s.link.opens()[n]!.id, 200, { 'content-length': '3' }, ['abc']);
    const responses = await Promise.all(pages);
    const next = s.handler(new Request(url(PAGE, 'assets/next.png')));
    await s.opened(HTTP_STREAMS_PER_LINK);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await next).text()).toBe('png');
    expect(await responses[0]!.text()).toBe(''); // a normal end; the media element asks again by its Range
  });

  // M5b's milestone review: only a frame's load resumes by Range; a body read through `fetch` (an asset's download) is
  // never cut, however long its reader holds back, so it is never saved short.
  it('never cuts a body read through `fetch` (a download), however long it is unread while requests wait', async () => {
    const s = scene({ idleMs: 60 });
    const download = s.scheme.fetch(MINI, new Request(url(PAGE, 'assets/data.csv')));
    const downloadId = await s.opened(0);
    s.link.answer(downloadId, 200, { 'content-length': '6' }, ['abc'], ''); // half came; its writer holds back
    const reader = (await download).body!.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('abc');
    const media = Array.from({ length: HTTP_STREAMS_PER_LINK - 1 }, (_, n) => s.handler(new Request(url(PAGE, `assets/${n}.mp4`))));
    await s.opened(HTTP_STREAMS_PER_LINK - 1);
    for (let n = 1; n < HTTP_STREAMS_PER_LINK; n += 1) s.link.answer(s.link.opens()[n]!.id, 200, {}, ['0123'], '');
    await Promise.all(media);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the download idle longest
    const next = s.handler(new Request(url(PAGE, 'assets/next.png')));
    await s.opened(HTTP_STREAMS_PER_LINK);
    expect(s.link.of('streamClose', downloadId)).toEqual([]); // a media stream gave way, never the download
    expect(s.link.of('streamClose')).toHaveLength(1);
    s.link.answer(s.link.opens()[HTTP_STREAMS_PER_LINK]!.id, 200, {}, ['png']);
    expect(await (await next).text()).toBe('png');
    s.link.hear({ t: 'streamData', id: downloadId, offset: 3, data: b64('def') });
    s.link.hear({ t: 'streamClose', id: downloadId, reason: 'closed' });
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('def');
    expect((await reader.read()).done).toBe(true);
  });

  it('ends every request in flight when stopped', async () => {
    const s = scene();
    const waiting = s.handler(new Request(url(PAGE)));
    await s.opened(0);
    s.scheme.stop();
    expect((await waiting).status).toBe(503);
  });
});

describe('artifacts.downloadAsset of another machine’s asset', () => {
  it('fetches the asset through the remote responder’s path and saves it here', async () => {
    const link = new TableLink(MINI);
    link.peers = ['rl2.streams', 'rl2.read-open'];
    const machines = new ArtifactMachines();
    const artifacts = createRemoteArtifacts({
      remote: (machine) => (machine === MINI ? link : null),
      onRemote: () => () => {},
      emit: () => {},
      machines,
      bounded: async () => 'pending' as const,
      pendingMs: 1000,
      feedRetryMs: [10, 100],
      openPath: async () => '',
      env: {},
      now: Date.now,
      log: () => {},
    });
    stops.push(() => artifacts.stop());
    const saveTo = scratch('maws-remote-download-');
    const call = vi.fn();
    const download = createAssetDownload({ call: call as never, downloads: () => saveTo, port: { save: vi.fn() }, env: { MAWS_E2E: '1', MAWS_E2E_SAVE_PATH: saveTo }, local: LOCAL, remote: (machine) => artifacts.assets(machine) });
    const saved = download.downloadAsset({ artifactId: PAGE, ref: 'assets/data.csv', name: 'sales.csv' }, null, MINI);
    await vi.waitFor(() => expect(link.opens()).toHaveLength(1));
    const id = link.opens()[0]!.id;
    expect(link.opens()[0]!.http).toEqual({ url: url(PAGE, 'assets/data.csv'), method: 'GET' });
    link.answer(id, 200, { 'content-type': 'text/csv', 'content-length': '8' }, ['a,b\n', '1,2\n']);
    await expect(saved).resolves.toEqual({ path: join(saveTo, 'sales.csv') });
    expect(readFileSync(join(saveTo, 'sales.csv'), 'utf8')).toBe('a,b\n1,2\n');
    expect(readdirSync(saveTo)).toEqual(['sales.csv']); // no temporary file left
    expect(call).not.toHaveBeenCalled(); // this Mac's engine host never asked
    expect(machines.machineOf(PAGE)).toBe(MINI);

    // the machine's 404 is the asset not found, before any dialog; a short body saves nothing
    const missing = download.downloadAsset({ artifactId: PAGE, ref: 'assets/gone.csv' }, null, MINI);
    await vi.waitFor(() => expect(link.opens()).toHaveLength(2));
    link.answer(link.opens()[1]!.id, 404, { 'content-type': 'text/plain' });
    await expect(missing).rejects.toMatchObject({ error: { code: 'invalid_input' } });
    const short = download.downloadAsset({ artifactId: PAGE, ref: 'assets/data.csv', name: 'short.csv' }, null, MINI);
    await vi.waitFor(() => expect(link.opens()).toHaveLength(3));
    link.answer(link.opens()[2]!.id, 200, { 'content-length': '8' }, ['a,b\n']);
    await expect(short).rejects.toThrow();
    expect(readdirSync(saveTo)).toEqual(['sales.csv']);
  });

  it('refuses while no link reaches the machine', async () => {
    const download = createAssetDownload({ call: vi.fn() as never, downloads: () => '/tmp', port: { save: vi.fn() }, env: {}, local: LOCAL, remote: () => null });
    await expect(download.downloadAsset({ artifactId: PAGE, ref: 'assets/data.csv' }, null, MINI)).rejects.toMatchObject({ error: { code: 'host_unavailable' } });
  });
});
