// The replay transport (C3 execution document, Interfaces "Transport", M2 decisions): a test seam that stands in for
// a process and plays a fixture journal's `in` rows, holding at each `out` row until the adapter writes the frame the
// fixture recorded there. Recorded request ids and user uuids are mapped onto the ones the adapter minted and the map
// is applied to every following `in` row, so correlation and deduplication see the host's own ids. The host's own
// `initialize` and `get_status` are answered from the handshake prelude when the fixture's next `out` row is not that
// request; an unrecorded `end_session` ends the replay as the engine does, with exit 0 (M4); an unrecorded read (a
// control whose class is `read`: it mutates nothing, so answering it cannot change what the fixture replays next) is
// answered with an empty success, announced by a `replay_unrecorded_read` item the consumer journals as a meta row
// (debt wave 3); any other unrecorded write is a replay mismatch that ends the stream (`exited` `{ null, null }`), so a
// test cannot pass by advancing past a frame the probe never saw. `stderr` rows replay; `meta exit` ends the stream with
// the row's code and signal; `kill` ends a journal that has no exit row. Nothing here journals (the harness does).
// R2: with `surfaceReads` (the app's replays under MAWS_ENGINE_REPLAY, never the conformance harness), the surface's
// attach, detach, roster reads and renders, and the renderer's reports of where the keyboard, a window and the shown
// pane are (focus, scroll, pane shown or focused, a prompt edit) are never held: the renderer sends them as its sites
// mount and its DOM moves, in an order and number no recording can fix, so each is answered at once with the fixture's
// recorded answer for the same ask (a render's by its component and instance) as of the cursor (the latest at or before
// it, else the next after it), or an empty success when the fixture has none, and their recorded rows are passed over.
// What the person does to a plugin's drawing (presses, inputs, picks, a pane closed) is still held and matched in order.
import { isDeepStrictEqual } from 'node:util';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { requestClassOf } from './controls';
import { TransportClosed, type EngineTransport, type TransportItem } from './transport';

export const PRELUDE_SUBTYPES: ReadonlySet<string> = new Set(['initialize', 'get_status']);
export const SURFACE_READ_SUBTYPES: ReadonlySet<string> = new Set(['ui_attach', 'ui_detach', 'ui_render', 'ui_panes', 'ui_focus', 'ui_scroll', 'ui_pane_show', 'ui_pane_focus', 'ui_prompt_edit']); // R2

export interface ReplayTransport extends EngineTransport {
  readonly holding: JournalRow | null; // the `out` row the replay waits on, or null while `in` rows remain or the stream ended
}

type Frame = Record<string, unknown>;
type ControlRequest = { type: 'control_request'; request_id: string; request: { subtype: string } };
type ControlResponse = { type: 'control_response'; response: { subtype: string; request_id: string; response?: { behavior?: string } } };

interface Waiter {
  frame: StdinFrame;
  resolve: () => void;
  reject: (error: Error) => void;
}

function describeOut(row: JournalRow): string {
  const f = row.frame as Frame;
  return `seq ${row.seq} ${describeFrame(f)}`;
}

function describeFrame(f: Frame): string {
  if (f.type === 'control_request') return `control_request/${(f as ControlRequest).request.subtype}`;
  if (f.type === 'control_response') {
    const r = (f as ControlResponse).response;
    return `control_response/${r.request_id}${r.response?.behavior ? `/${r.response.behavior}` : ''}`;
  }
  return String(f.type);
}

// Minted ids are wire values, never substrings of arbitrary payload text.
function rewriteIds(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => rewriteIds(entry, idMap));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteIds(entry, idMap)]));
  return value;
}

function sameControl(recorded: Frame, written: Frame): boolean {
  return recorded.type === 'control_request' && written.type === 'control_request' && (recorded as ControlRequest).request.subtype === (written as ControlRequest).request.subtype;
}

// Control request payloads match structurally after recorded ids are translated to this run's ids. Only the request's
// freshly minted envelope id is excluded. Responses retain the existing id/behavior contract. Optional undefined properties do not travel over JSON stdin.
function matches(recorded: Frame, written: Frame, idMap: ReadonlyMap<string, string> = new Map()): boolean {
  if (recorded.type !== written.type) return false;
  if (recorded.type === 'control_request') return isDeepStrictEqual(rewriteIds((recorded as ControlRequest).request, idMap), JSON.parse(JSON.stringify((written as ControlRequest).request)));
  if (recorded.type === 'control_response') {
    const a = (recorded as ControlResponse).response;
    const b = (written as ControlResponse).response;
    return (idMap.get(a.request_id) ?? a.request_id) === b.request_id && (a.response?.behavior === undefined || a.response.behavior === b.response?.behavior);
  }
  if (recorded.type === 'control_cancel_request') return (idMap.get(recorded.request_id as string) ?? recorded.request_id) === written.request_id;
  return true;
}

// The prelude's response to `subtype`: the `in` control_response following its `out` control_request.
function preludeResponse(prelude: JournalRow[], subtype: string): Frame | null {
  const request = prelude.find((r) => r.direction === 'out' && (r.frame as Frame).type === 'control_request' && (r.frame as ControlRequest).request.subtype === subtype);
  if (!request) return null;
  const id = (request.frame as ControlRequest).request_id;
  const response = prelude.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'control_response' && (r.frame as ControlResponse).response.request_id === id);
  return response ? (response.frame as Frame) : null;
}

// R2: the ask a surface read answers: its subtype, and a render's component and instance.
function surfaceKey(request: Frame): string {
  return request.subtype === 'ui_render' ? `ui_render\u0000${String(request.component)}\u0000${String(request.instance_id)}` : String(request.subtype);
}

// A control that mutates nothing, so answering it unrecorded cannot change what the fixture replays next: a read, and
// E1 M5: a `rewind_files` dry run (the transcript's file-change receipt asks one as it draws, `canUndo`).
function isReplayRead(request: { subtype: string; dry_run?: unknown }): boolean {
  return requestClassOf(request.subtype) === 'read' || (request.subtype === 'rewind_files' && request.dry_run === true);
}

export function replayEngine(journal: JournalRow[], opts: { prelude: JournalRow[]; onHold?: (row: JournalRow) => void; surfaceReads?: boolean }): ReplayTransport {
  const rows = journal;
  // R2: the recorded surface reads (their out row's index, key and the engine's answer), and the rows the cursor passes over
  const surfaceReads: { index: number; key: string; response: Frame }[] = [];
  const passedOver = new Set<number>();
  if (opts.surfaceReads) {
    rows.forEach((row, index) => {
      const f = row.frame as Frame;
      if (row.direction !== 'out' || f.type !== 'control_request' || !SURFACE_READ_SUBTYPES.has((f as ControlRequest).request.subtype)) return;
      const id = (f as ControlRequest).request_id;
      const answer = rows.findIndex((r, i) => i > index && r.direction === 'in' && (r.frame as Frame).type === 'control_response' && (r.frame as ControlResponse).response.request_id === id);
      passedOver.add(index);
      if (answer === -1) return;
      passedOver.add(answer);
      surfaceReads.push({ index, key: surfaceKey((f as ControlRequest).request as unknown as Frame), response: rows[answer]!.frame as Frame });
    });
  }
  let cursor = 0; // index of the next row to consider
  let ended = false;
  const idMap = new Map<string, string>(); // recorded id → minted id
  const injected: TransportItem[] = []; // prelude and unrecorded-read answers, delivered before the cursor's next row
  const waiters: Waiter[] = []; // writes not yet matched, in order
  const stderrQueue: string[] = [];
  let stderrWaiter: ((r: IteratorResult<string>) => void) | null = null;
  let stderrEnded = false;
  let wake: (() => void) | null = null; // the frames iterator waiting for a write or a kill
  let held: JournalRow | null = null; // the `out` row `onHold` was last told about
  let resolveExited!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => (resolveExited = r));

  const rewrite = (frame: unknown): unknown => rewriteIds(frame, idMap);

  const pushStderr = (line: string) => {
    if (stderrWaiter) {
      const w = stderrWaiter;
      stderrWaiter = null;
      w({ value: line, done: false });
    } else stderrQueue.push(line);
  };

  const finish = (exit: { code: number | null; signal: NodeJS.Signals | null }) => {
    if (ended) return;
    ended = true;
    stderrEnded = true;
    if (stderrWaiter) {
      const w = stderrWaiter;
      stderrWaiter = null;
      w({ value: undefined, done: true });
    }
    for (const w of waiters.splice(0)) w.reject(new TransportClosed('the replay ended'));
    resolveExited(exit);
    wake?.();
  };

  // Skips the meta rows the replay never delivers (spawn, provenance, the probe's notes) and stderr rows (pushed on
  // the way), leaving the cursor at an `in` row, an `out` row, an exit row, or the end.
  const settleCursor = (): JournalRow | null => {
    while (cursor < rows.length) {
      const row = rows[cursor]!;
      if (passedOver.has(cursor)) {
        cursor += 1; // R2: a surface read, answered by lookup
        continue;
      }
      if (row.direction === 'in' || row.direction === 'out') return row;
      if (row.direction === 'meta' && (row.frame as Frame).event === 'exit') return row;
      if (row.direction === 'stderr') pushStderr(String((row.frame as { text?: unknown }).text ?? ''));
      cursor += 1;
    }
    return null;
  };

  // The `out` row a write made now would be matched against, without side effects (used at write time to decide whether
  // a request was recorded): the one past those the writes still waiting will claim, since each waiting write takes the
  // next out row in order. Two same-subtype reads written back to back against one recorded row: the first claims it,
  // the second is unrecorded (debt wave 3 review).
  const nextOut = (): JournalRow | null => {
    let skip = waiters.length;
    for (let i = cursor; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (passedOver.has(i)) continue; // R2
      if (row.direction === 'out' && skip-- === 0) return row;
      if (row.direction === 'meta' && (row.frame as Frame).event === 'exit') return null;
    }
    return null;
  };

  // Records the minted ids of a matched write so the recorded ones in later `in` rows become them.
  const learnIds = (recorded: Frame, written: Frame) => {
    if (recorded.type === 'control_request') idMap.set((recorded as ControlRequest).request_id, (written as ControlRequest).request_id);
    if ((recorded.type === 'user' || recorded.type === 'bash_command') && typeof recorded.uuid === 'string' && typeof written.uuid === 'string') idMap.set(recorded.uuid, written.uuid);
  };

  // The spec's gate: any unrecorded write ends the replay. Rejects the waiting write, ends the stream as a crash
  // (`exited` `{ null, null }`) and returns the item the consumer journals as `meta replay_mismatch`.
  const endAsMismatch = (expected: string): TransportItem => {
    const waiter = waiters.shift()!;
    const got = describeFrame(waiter.frame as unknown as Frame);
    const message = `replay mismatch: expected ${expected}, got ${got}`;
    waiter.reject(new TransportClosed(message));
    finish({ code: null, signal: null });
    return { frame: null, raw: '', error: { kind: 'replay_mismatch', message, length: 0, typeGuess: null, replay: { expected, got } } };
  };

  // At a held `out` row with a write waiting: match and advance, or end the replay as a mismatch.
  const tryMatch = (): TransportItem | null => {
    const row = settleCursor();
    if (!row || row.direction !== 'out' || waiters.length === 0) return null;
    const recorded = row.frame as Frame;
    const written = waiters[0]!.frame as unknown as Frame;
    if (!matches(recorded, written, idMap)) return endAsMismatch(describeOut(row));
    learnIds(recorded, written);
    cursor += 1;
    waiters.shift()!.resolve();
    return null;
  };

  const frames: AsyncIterable<TransportItem> = {
    [Symbol.asyncIterator]() {
      let pendingMismatch: TransportItem | null = null;
      return {
        next: async (): Promise<IteratorResult<TransportItem>> => {
          for (;;) {
            if (pendingMismatch) {
              const item = pendingMismatch;
              pendingMismatch = null;
              return { value: item, done: false };
            }
            if (injected.length > 0) return { value: injected.shift()!, done: false };
            if (ended) return { value: undefined, done: true };
            const row = settleCursor();
            if (!row) {
              if (waiters.length > 0) return { value: endAsMismatch('end of journal'), done: false }; // a write the journal never recorded
              await new Promise<void>((r) => (wake = r)); // a journal without an exit row waits for kill (or a write)
              wake = null;
              continue;
            }
            if (row.direction === 'meta') {
              if (waiters.length > 0) return { value: endAsMismatch(`seq ${row.seq} exit`), done: false }; // written after the engine's last frame
              const f = row.frame as { code?: unknown; signal?: unknown };
              cursor += 1;
              finish({ code: typeof f.code === 'number' ? f.code : null, signal: typeof f.signal === 'string' ? (f.signal as NodeJS.Signals) : null });
              return { value: undefined, done: true };
            }
            if (row.direction === 'in') {
              cursor += 1;
              const frame = rewrite(row.frame);
              return { value: { frame, raw: JSON.stringify(frame), error: null }, done: false };
            }
            // an `out` row: match a waiting write, or wait for one. `onHold` fires here, once per held row, when every
            // earlier row has been delivered and the consumer has finished with it (it called `next()` again), which
            // is the one moment a scripted driver can issue the row's frame without racing the consumer.
            if (waiters.length === 0) {
              if (held !== row) {
                held = row;
                opts.onHold?.(row);
              }
              // the hold handler may have killed the replay, or issued a read answered at once (injected)
              if (waiters.length === 0 && injected.length === 0 && !ended) {
                await new Promise<void>((r) => (wake = r));
                wake = null;
              }
              continue;
            }
            const mismatch = tryMatch();
            if (mismatch) pendingMismatch = mismatch;
          }
        },
      };
    },
  };

  const stderr: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (stderrQueue.length > 0) return Promise.resolve({ value: stderrQueue.shift()!, done: false });
          if (stderrEnded) return Promise.resolve({ value: undefined, done: true });
          return new Promise((r) => (stderrWaiter = r));
        },
      };
    },
  };

  return {
    pid: null,
    frames,
    stderr,
    get holding() {
      if (ended) return null;
      const row = settleCursor();
      return row && row.direction === 'out' ? row : null;
    },
    write(frame) {
      if (ended) return Promise.reject(new TransportClosed('the replay ended'));
      const f = frame as unknown as Frame;
      // R2: a surface read, answered from the fixture as of the cursor, never held
      if (opts.surfaceReads && f.type === 'control_request' && SURFACE_READ_SUBTYPES.has((f as ControlRequest).request.subtype)) {
        const { request_id: requestId, request } = f as ControlRequest;
        const key = surfaceKey(request as unknown as Frame);
        const same = surfaceReads.filter((r) => r.key === key);
        const recorded = same.filter((r) => r.index < cursor).at(-1) ?? same.find((r) => r.index >= cursor);
        if (recorded) {
          const response = { ...(recorded.response as ControlResponse).response, request_id: requestId };
          injected.push({ frame: { ...recorded.response, response }, raw: '', error: null });
        } else {
          const message = `replay: ${request.subtype} was not recorded; answered with an empty success`;
          injected.push({ frame: null, raw: '', error: { kind: 'replay_unrecorded_read', message, length: 0, typeGuess: null, read: { subtype: request.subtype, requestId } } });
          injected.push({ frame: { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: {} } }, raw: '', error: null });
        }
        wake?.();
        return Promise.resolve();
      }
      if (f.type === 'control_request' && (f as ControlRequest).request.subtype === 'end_session') {
        const upcoming = nextOut();
        if (!upcoming || !sameControl(upcoming.frame as Frame, f)) {
          // The engine's answer to end_session is to exit (Decision Log, controller for M4 and M5): the write reaches
          // the pipe, then the replay ends with exit 0 and no mismatch. A macrotask later, so the writer's continuation
          // journals the out row before the stream ends.
          setTimeout(() => finish({ code: 0, signal: null }), 0);
          return Promise.resolve();
        }
      }
      if (f.type === 'control_request' && PRELUDE_SUBTYPES.has((f as ControlRequest).request.subtype)) {
        const upcoming = nextOut();
        if (!upcoming || !sameControl(upcoming.frame as Frame, f)) {
          const answer = preludeResponse(opts.prelude, (f as ControlRequest).request.subtype);
          if (!answer) return Promise.reject(new TransportClosed(`the handshake prelude has no ${(f as ControlRequest).request.subtype} response`));
          const response = { ...(answer as ControlResponse).response, request_id: (f as ControlRequest).request_id };
          injected.push({ frame: { ...answer, response }, raw: '', error: null });
          wake?.();
          return Promise.resolve();
        }
      }
      if (f.type === 'control_request' && isReplayRead((f as ControlRequest).request)) {
        const upcoming = nextOut();
        if (!upcoming || !sameControl(upcoming.frame as Frame, f) || ((f as ControlRequest).request.subtype.startsWith('ui_') && !matches(upcoming.frame as Frame, f, idMap))) {
          const { subtype } = (f as ControlRequest).request;
          const requestId = (f as ControlRequest).request_id;
          const message = `replay: ${subtype} was not recorded; answered with an empty success`;
          injected.push({ frame: null, raw: '', error: { kind: 'replay_unrecorded_read', message, length: 0, typeGuess: null, read: { subtype, requestId } } });
          injected.push({ frame: { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: {} } }, raw: '', error: null });
          wake?.();
          return Promise.resolve();
        }
      }
      return new Promise<void>((resolve, reject) => {
        waiters.push({ frame, resolve, reject });
        wake?.();
      });
    },
    endInput() {},
    kill(signal) {
      finish({ code: null, signal });
    },
    exited,
  };
}
