// The long-transcript window over the host's real transport (docs/doperpowers/plans/2026-10-30-long-transcript-window.md):
// C1's runtime serving the fs service over a Unix socket, read by a SocketPort as main reads it, with the line cap and
// the window budget lowered together (the hard cap a quarter of the line cap, as in production). A transcript whose
// whole history would be one line over the cap is opened: the answer stays under the cap, the connection stays up, a
// command asked beside it is answered, and every line that reaches main is under the cap. Facts, not timings: the
// measured bounds are the Mac lane's.
import { createConnection, createServer, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes } from '@shared/graph/history-window';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import { createHostRuntime, hostPing } from '@shared/host/runtime';
import { SocketPort } from '@shared/host/socket-port';
import { LONG_DIR, LONG_SESSION, longTranscript } from '../../../test/support/long-transcript';
import { listenTemp, type TempSocket } from '../../../test/support/socket-lines';
import { StoreFixture } from '../../../test/support/store-fixture';
import { FsService } from './service';

const APP = 'app-transport' as AppSessionId;
const LINE_CAP = 128 * 1024; // main's reader; production's is 64 MiB
const WINDOW = { soft: 8 * 1024, hard: LINE_CAP / 4 }; // production's: 2 MiB and a quarter of the cap

describe('a long transcript opened over the host socket', () => {
  let fixture: StoreFixture;
  let temp: TempSocket | null = null;
  let fs: FsService | null = null;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    fs?.stop();
    await temp?.dispose();
    temp = null;
    await fixture.dispose();
  });

  it('answers within the line cap, keeps the connection, and answers a command asked beside it', async () => {
    const lines = longTranscript(200); // about 300 KB of events: the whole history is over the cap
    await fixture.addTranscript(LONG_DIR, LONG_SESSION, lines);

    const runtime = createHostRuntime((on, emit) => {
      fs = new FsService({ paths: fixture.paths, emit, window: WINDOW });
      on('engine.ping', async () => hostPing('test'));
      on('session.events', async ({ appSessionId, before }) => ({ ...(await fs!.eventsSnapshot(appSessionId as AppSessionId, null, { before: (before ?? null) as EventId | null })), lastSeq: 0 }));
    });
    await fs!.start();
    fs!.bind([{ sessionId: LONG_SESSION, appSessionId: APP }]);
    let accept!: (socket: Socket) => void;
    const accepted = new Promise<Socket>((resolve) => (accept = resolve));
    temp = await listenTemp(createServer((socket) => accept(socket)));
    const client = createConnection(temp.path);
    await new Promise((resolve) => client.once('connect', resolve));
    runtime.serve(new SocketPort(await accepted, Buffer.alloc(0), { lineCap: LINE_CAP }));

    // Main's side: every line it reads, measured as it arrived; an overflow would close the connection.
    const main = new SocketPort(client, Buffer.alloc(0), { lineCap: LINE_CAP, log: () => {} });
    const received: { t: string; id?: string; name?: string; ok?: boolean; value?: unknown; payload?: unknown }[] = [];
    let closed = false;
    main.on('message', ({ data }) => void received.push(data as never));
    main.onClose(() => (closed = true));
    const longest = { bytes: 0, current: 0 };
    client.on('data', (chunk: Buffer) => {
      for (let start = 0; start < chunk.length; ) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline;
        longest.current += end - start;
        longest.bytes = Math.max(longest.bytes, longest.current);
        if (newline !== -1) longest.current = 0;
        start = end + 1;
      }
    });
    main.start();
    main.postMessage({ t: 'ready' });
    main.postMessage({ t: 'req', id: 'events', name: 'session.events', input: { appSessionId: APP, afterSeq: null, limit: null } });
    main.postMessage({ t: 'req', id: 'ping', name: 'engine.ping', input: undefined });

    const response = (id: string) => received.find((message) => message.t === 'res' && message.id === id);
    await vi.waitFor(() => expect(response('events') && response('ping')).toBeTruthy(), { timeout: 10_000, interval: 10 });
    const answer = response('events')!;
    expect(answer.ok).toBe(true);
    const { events, earlier } = answer.value as { events: SessionEvent[]; earlier?: EventId };
    expect(events.length).toBeGreaterThan(0);
    expect(earlier).toBeDefined(); // older history remains, asked as `before`
    expect(response('ping')!.ok).toBe(true);

    // The whole history the old answer would have carried is over the cap; nothing that crossed was.
    let whole = 0;
    let page: { events: SessionEvent[]; earlier?: EventId } = { events, earlier };
    whole += events.reduce((bytes, event) => bytes + eventBytes(event), 0);
    while (page.earlier !== undefined) {
      page = await fs!.eventsSnapshot(APP, null, { before: page.earlier });
      whole += page.events.reduce((bytes, event) => bytes + eventBytes(event), 0);
    }
    expect(whole).toBeGreaterThan(LINE_CAP);
    await vi.waitFor(() => expect(received.some((message) => message.t === 'evt' && message.name === 'fs.followState')).toBe(true), { timeout: 10_000, interval: 10 });
    expect(longest.bytes).toBeLessThan(LINE_CAP);
    expect(closed).toBe(false);
    main.close();
  });
});
