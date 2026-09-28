// Reload survival's foundation (charter §4.1; C3 execution document, Residue "Reload survival"): a live-shaped run
// journaled to disk by the production JournalWriter re-reads through a fresh Normalizer into the same event list, ids
// and seq included, a successful rewind, a transport parse error and the process exit among them. M5 adds the event
// ring capped at 50 and `session.events` over this same property.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
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
  await rm(userData, { recursive: true, force: true });
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
  it('pass2/rewind with a parse error and the exit, journaled to disk, re-reads into the live event list exactly', async () => {
    const sent: MessageUuid[] = [];
    const dir = join(userData, 'engine-host', 'journal', 'replay-rewind');
    const writer = new JournalWriter(dir, 'LAUNCHJ1', { maxBytes: JOURNAL_MAX_BYTES });
    const run = await replayedSession('pass2', 'rewind', (row, { session, transport, ready, fixture }) => {
      const frame = row.frame as { type: string; message?: { content: string }; request?: { subtype: string } };
      if (frame.type === 'user') void ready().then(() => session.send((fixture.find((r) => r.seq === row.seq)!.frame as { message: { content: string } }).message.content)).then((r) => sent.push(r.messageUuid!));
      else if (frame.request?.subtype === 'rewind_files') void session.control!.request('rewind_files', { user_message_id: sent[1]!, dry_run: true }).catch(() => {});
      else if (frame.request?.subtype === 'rewind_conversation') void rewind(session, { targetMessageUuid: row.seq === 39 ? sent[0]! : sent[1]!, lastSeenMessageUuid: sent[1]!, files: false }); // seq 39 stale, seq 41 rewound
      else transport.kill('SIGTERM');
    }, {
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
});
