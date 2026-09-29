// The conformance harness (C3 execution document, M2): replays one probe fixture through ReplayTransport →
// ControlClient → Normalizer with a scripted driver that issues the fixture's own `out` rows (user frames, bash
// commands, outbound controls, in order) whenever the transport holds at one, and a scripted answerer that replays
// the probe's recorded responses to inbound requests, so the graph reflects the probe's decisions. Every frame in and
// out is journaled through an in-memory sink before it is normalised, exactly as the session will do with the file
// writer. Not a test file: the suites under this directory import it.
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { loadEngineJournal } from '../../../test/support/fixtures';
import { isOutboundSubtype } from '../controls';
import { Normalizer, type NormalizerWarning } from '../normalizer';
import { replayEngine } from '../replay-transport';
import { ControlClient, ControlError, type JournalSink } from '../rpc';
import type { EngineTransport, TransportProblem } from '../transport';

export interface RequestOutcome {
  seq: number; // the fixture's out row
  subtype: string;
  ok: boolean;
  code: string | null; // ControlError.code when not ok
  response: unknown; // the typed (or raw) response when ok
}

export interface ConformanceRun {
  events: SessionEvent[];
  rows: JournalRow[]; // the harness's own journal, in order
  warnings: NormalizerWarning[];
  clientWarnings: string[];
  problems: TransportProblem[]; // replay mismatches and the like, journaled as meta rows
  requests: RequestOutcome[];
  writeErrors: string[];
  exit: { code: number | null; signal: NodeJS.Signals | null };
  sessionId: SessionId | null;
}

// The engine session id the fixture's frames carry, so the normaliser knows it from the first row as the host does
// (the host mints or resumes the id at launch); null for a journal no frame of which carries one.
export function sessionIdOf(journal: JournalRow[]): SessionId | null {
  for (const row of journal) {
    if (row.direction !== 'in') continue;
    const id = (row.frame as { session_id?: unknown }).session_id;
    if (typeof id === 'string' && id.length > 0) return id as SessionId;
  }
  return null;
}

let preludeCache: JournalRow[] | null = null;
export function handshakePrelude(): JournalRow[] {
  preludeCache ??= loadEngineJournal('replay-handshake');
  return preludeCache;
}

// `sessionId`: the engine session id the host would know at launch; defaults to the first one the fixture's frames
// carry, else `fixture:<label>` for a recording no frame of which names one (a refused resume, a handshake-only run).
export async function replayFixture(journal: JournalRow[], opts: { appSessionId?: string; launchId?: string; sessionId?: SessionId | null; label?: string } = {}): Promise<ConformanceRun> {
  const appSessionId = (opts.appSessionId ?? 'conformance') as AppSessionId;
  const launchId = opts.launchId ?? 'REPLAY01';
  const rows: JournalRow[] = [];
  const events: SessionEvent[] = [];
  const warnings: NormalizerWarning[] = [];
  const clientWarnings: string[] = [];
  const problems: TransportProblem[] = [];
  const requests: RequestOutcome[] = [];
  const writeErrors: string[] = [];
  const settling: Promise<unknown>[] = [];

  const sessionId = opts.sessionId !== undefined ? opts.sessionId : (sessionIdOf(journal) ?? (`fixture:${opts.label ?? 'unnamed'}` as SessionId));
  const normalizer = new Normalizer({ appSessionId, launchId, sessionId, warn: (w) => warnings.push(w) });

  // The harness journal mirrors the fixture row for row: the driver writes exactly the fixture's `out` rows and the
  // transport delivers exactly its `in` rows, so each journaled row takes the fixture seq of the row it corresponds
  // to, and the fixture's own `meta` and `stderr` rows are journaled as the cursor passes them. Seqs in the graph
  // therefore read against the fixture file, which is how the spec's pins and a failure message name a frame.
  let fixturePos = 0;
  const journalRaw = (row: JournalRow): JournalRow => {
    rows.push(row);
    events.push(...normalizer.push(row));
    return row;
  };
  const passUntil = (direction: JournalDirection): JournalRow => {
    while (fixturePos < journal.length) {
      const row = journal[fixturePos]!;
      fixturePos += 1;
      if (row.direction === direction) return row;
      if (row.direction === 'meta' || row.direction === 'stderr') {
        journalRaw({ ...row, at: new Date().toISOString() });
        continue;
      }
      throw new Error(`harness journal diverged from the fixture at seq ${row.seq}: expected a ${direction} row, found ${row.direction}; journaled so far: ${rows.slice(-6).map((r) => `${r.seq}:${r.direction}:${(r.frame as { type?: string; event?: string }).type ?? (r.frame as { event?: string }).event}`).join(' ')}`);
    }
    throw new Error(`harness journal ran past the fixture looking for a ${direction} row`);
  };
  const sink: JournalSink = {
    row(direction: JournalDirection, frame: unknown): JournalRow {
      const fixtureRow = passUntil(direction);
      return journalRaw({ seq: fixtureRow.seq, direction, at: new Date().toISOString(), frame });
    },
  };

  // The driver runs from the transport's own hold point: `onHold` fires inside `next()` once every earlier row has
  // been delivered and processed, so the held `out` row is always the next row the harness journals.
  const transport: EngineTransport = replayEngine(journal, { prelude: handshakePrelude(), onHold: (row) => issue(row) });
  const client = new ControlClient(transport, sink, launchId, { warn: (m) => clientWarnings.push(m) });

  const capture = (label: string) => (error: unknown) => {
    writeErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  };

  // The scripted driver and answerer: the row the transport holds at is what the probe wrote next.
  const issue = (held: JournalRow) => {
    const frame = held.frame as StdinFrame;
    switch (frame.type) {
      case 'control_request': {
        const { subtype, ...payload } = frame.request as { subtype: string } & Record<string, unknown>;
        const pending = isOutboundSubtype(subtype) ? client.request(subtype, payload as never) : client.requestRaw(subtype, payload);
        settling.push(
          pending.then(
            (response) => requests.push({ seq: held.seq, subtype, ok: true, code: null, response }),
            (error: unknown) => requests.push({ seq: held.seq, subtype, ok: false, code: error instanceof ControlError ? error.code : 'unknown', response: null }),
          ),
        );
        return;
      }
      case 'control_response': {
        const envelope = frame.response;
        const answer = envelope.subtype === 'success' ? client.respond(envelope.request_id as never, envelope.response) : client.respondError(envelope.request_id as never, envelope.error);
        answer.catch(capture(`control_response seq ${held.seq}`));
        return;
      }
      default:
        sink.row('out', frame);
        transport.write(frame).catch(capture(`${frame.type} seq ${held.seq}`));
    }
  };

  const drainingStderr = (async () => {
    for await (const line of transport.stderr) void line; // journaled from the fixture row as the cursor passes it
  })();

  for await (const item of transport.frames) {
    if (item.error) {
      problems.push(item.error);
      journalRaw({ seq: (rows.at(-1)?.seq ?? 0) + 1, direction: 'meta', at: new Date().toISOString(), frame: { event: item.error.kind, message: item.error.message, ...(item.error.replay ?? {}) } });
    } else {
      sink.row('in', item.frame);
      client.observe(item.frame);
    }
  }
  const exit = await transport.exited;
  client.close('the replay ended');
  await drainingStderr;
  await Promise.all(settling);
  // The rows after the last delivered frame: the fixture's exit row becomes the host's (reason and lost count added).
  const mismatched = problems.some((p) => p.kind === 'replay_mismatch');
  const reason = mismatched ? 'crash' : exit.code === 0 && exit.signal === null ? 'unknown' : 'crash';
  let exitJournaled = false;
  for (; fixturePos < journal.length && !mismatched; fixturePos += 1) {
    const row = journal[fixturePos]!; // after a mismatch the replay ended early: what the probe saw next is not ours to journal
    const isExit = row.direction === 'meta' && (row.frame as { event?: unknown }).event === 'exit';
    if (isExit) exitJournaled = true;
    journalRaw({ ...row, at: new Date().toISOString(), frame: isExit ? { ...(row.frame as object), reason, lostAttentionCount: 0 } : row.frame });
  }
  if (!exitJournaled) journalRaw({ seq: (rows.at(-1)?.seq ?? 0) + 1, direction: 'meta', at: new Date().toISOString(), frame: { event: 'exit', code: exit.code, signal: exit.signal, reason, lostAttentionCount: 0 } });

  return { events, rows, warnings, clientWarnings, problems, requests, writeErrors, exit, sessionId: normalizer.state.sessionId };
}
