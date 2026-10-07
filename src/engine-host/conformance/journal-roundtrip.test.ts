// Reload survival's foundation (charter §4.1; C3 execution document, Residue "Reload survival"): a live-shaped run
// journaled to disk by the production JournalWriter re-reads through a fresh Normalizer into the same event list, ids
// and seq included, a successful rewind, a transport parse error and the process exit among them; and (M5) with the
// event ring capped at 50, `session.events` rebuilds the evicted range from that journal through the X2 handlers.
import { withAppRewindGuards } from '../../../test/support/app-rewind-fixture';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { loadJournal } from '../../../test/support/fixtures';
import { registerEngineIpc } from '../ipc';
import type { JournalRow } from '@shared/wire/journal';
import { JOURNAL_MAX_BYTES, JournalReader, JournalWriter } from '../journal';
import { Normalizer } from '../normalizer';
import { rewind } from '../rewind';
import type { EngineTransport, TransportItem } from '../transport';
import { replayedSession } from './session-harness';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-journal-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true, maxRetries: 10 });
});

// Passes the replay through, with one malformed stdout line reported after the `after`-th item.
function withParseError(inner: EngineTransport, after: number): EngineTransport {
  return {
    ...inner,
    pid: inner.pid,
    exited: inner.exited,
    stderr: inner.stderr,
    write: (frame) => inner.write(frame),
    endInput: () => inner.endInput(),
    kill: (signal) => inner.kill(signal),
    frames: {
      async *[Symbol.asyncIterator]() {
        let n = 0;
        for await (const item of inner.frames) {
          yield item;
          n += 1;
          if (n === after) yield { frame: null, raw: '{"type":"assis', error: { kind: 'parse_error', message: 'Unterminated string in JSON at position 14', length: 14, typeGuess: 'assistant' } } satisfies TransportItem;
        }
      },
    },
  };
}

describe('journal round-trips into the same graph', () => {
  it('pass2/rewind with app guard fields, a parse error and the exit, journaled to disk, re-reads into the live event list exactly', async () => {
    const sent: MessageUuid[] = [];
    const dir = join(userData, 'engine-host', 'journal', 'replay-rewind');
    const writer = new JournalWriter(dir, 'LAUNCHJ1', { maxBytes: JOURNAL_MAX_BYTES });
    const run = await replayedSession('pass2', 'rewind', (row, { session, transport, ready, fixture }) => {
      const frame = row.frame as { type: string; message?: { content: string }; request?: { subtype: string } };
      if (frame.type === 'user') void ready().then(() => session.send((fixture.find((r) => r.seq === row.seq)!.frame as { message: { content: string } }).message.content)).then((r) => sent.push(r.messageUuid!));
      else if (frame.request?.subtype === 'rewind_files') void session.control!.request('rewind_files', { user_message_id: sent[1]!, dry_run: true }).catch(() => {});
      else if (frame.request?.subtype === 'rewind_conversation') void rewind(session, { targetMessageUuid: row.seq === 39 ? sent[0]! : sent[1]!, lastSeenMessageUuid: row.seq === 39 ? sent[0]! : sent[1]!, files: false }); // seq 39 stale, seq 41 rewound
      else transport.kill('SIGTERM');
    }, {
      edit: withAppRewindGuards,
      wrap: (t) => withParseError(t, 10),
      session: { journal: writer },
    });
    const live: SessionEvent[] = run.events;
    expect(live.some((e) => e.kind === 'boundary.rewind')).toBe(true);
    expect(live.filter((e) => e.kind === 'error.raised')).toMatchObject([{ scope: 'transport', message: 'Unterminated string in JSON at position 14' }]);
    expect(live.at(-1)).toMatchObject({ kind: 'process.exited', reason: 'unknown', code: 0 });

    const [file] = JournalReader.forSession(dir);
    const rows: JournalRow[] = [];
    for await (const row of JournalReader.rows(file!)) rows.push(row);
    const spawn = rows[0]!.frame as { event: string; launchId: string; sessionId: string };
    expect(spawn.event).toBe('spawn');
    // a fresh normaliser knows what the host knew at launch, from the spawn row
    const normalizer = new Normalizer({ appSessionId: run.session.status().appSessionId, launchId: spawn.launchId, sessionId: spawn.sessionId as never });
    const rebuilt = rows.flatMap((row) => normalizer.push(row));
    const masked = (events: SessionEvent[]) => events.map((e) => ({ ...e, at: '<at>' }));
    expect(masked(rebuilt)).toEqual(masked(live));
    expect(rebuilt).toEqual(live); // `at` too: the frame's timestamp or the row's, and the file holds the same row
  });

  // The spec's pin names a ring of 50; the whole of pass2/rewind yields 36 events, so the ring is capped at 10 here to
  // make the eviction the pin is about actually happen (the rebuild path is the same at any size).
  it('with the ring capped below the run, session.events after a replayed pass2/rewind with app guard fields and a stop deep-equals every batch received, boundary and exit included', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const batches: SessionEvent[][] = [];
    const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
    const emit: HostEmit = (name, payload) => {
      if (name === 'session.eventBatch') batches.push((payload as { events: SessionEvent[] }).events);
      return true;
    };
    registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: resolve(__dirname, '../../..'), ringSize: 10 });
    const call = (name: string, input: Record<string, unknown>) => handlers.get(name)!({ appSessionId: 'app-ring', ...input }) as Promise<Record<string, unknown>>;
    const received = () => batches.flat();
    const until = async (check: () => boolean, what: string) => {
      for (const start = Date.now(); !check(); await new Promise((r) => setTimeout(r, 5))) if (Date.now() - start > 3_000) throw new Error(`timed out waiting for ${what}`);
    };
    const turnsEnded = () => received().filter((e) => e.kind === 'turn.ended').length;
    const status = () => call('session.status', {}) as Promise<{ process: string; turn: unknown }>;
    const idle = async (turns: number) => {
      await until(() => turnsEnded() === turns, `turn ${turns}`);
      for (let s = await status(); s.turn !== null; s = await status()) await new Promise((r) => setTimeout(r, 5));
    };
    const fixture = withAppRewindGuards(loadJournal('pass2', 'rewind'));
    const replayPath = join(userData, 'rewind-with-app-guards.jsonl');
    await writeFile(replayPath, fixture.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const prompt = (seq: number) => (fixture.find((r) => r.seq === seq)!.frame as { message: { content: string } }).message.content;
    const spec = LaunchSpecSchema.parse({
      appSessionId: 'app-ring', cwd: '/tmp/maws-ring', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null /* C10 */, replay: replayPath,
    });
    await handlers.get('session.launch')!({ spec });
    for (let s = await status(); s.process !== 'ready'; s = await status()) await new Promise((r) => setTimeout(r, 5));

    const first = (await call('session.send', { content: prompt(5) })).messageUuid as MessageUuid;
    await idle(1);
    const second = (await call('session.send', { content: prompt(19) })).messageUuid as MessageUuid;
    await idle(2);
    expect(await call('session.rewindFiles', { userMessageUuid: second, dryRun: true })).toMatchObject({ ok: false, enabled: false }); // seq 36
    expect(await call('session.rewind', { targetMessageUuid: first, lastSeenMessageUuid: first, files: false })).toMatchObject({ rewound: false }); // seq 39
    expect(await call('session.rewind', { targetMessageUuid: second, lastSeenMessageUuid: second, files: false })).toMatchObject({ rewound: true }); // seq 41
    await call('session.send', { content: prompt(44) });
    await idle(3);
    await call('session.stop', { reason: 'stop' });
    await until(() => received().some((e) => e.kind === 'process.exited'), 'process.exited');

    const live = received();
    expect(live.length).toBeGreaterThan(12); // the ring (10, trimmed in chunks of a fifth) no longer holds the start
    expect(live.filter((e) => e.kind === 'boundary.rewind')).toHaveLength(1);
    const snapshot = (await call('session.events', { afterSeq: null, limit: null })) as { events: SessionEvent[]; complete: boolean };
    expect(snapshot.complete).toBe(true);
    expect(snapshot.events).toEqual(live); // ids and seq included: no rewound-away history, no missing boundary after a reload
  });
});
