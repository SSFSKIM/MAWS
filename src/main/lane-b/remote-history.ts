// A remote lane B session's `session.events` in answers the channel carries (P5 O7 M2, the milestone review's P2). The
// renderer hydrates a pane with one `session.events {afterSeq: null, limit: null}`, which the endpoint refuses `too-large`
// once the answer passes the channel's message bound (MESSAGE_MAX_BYTES less headroom, src/endpoint/calls.ts): a long
// launch, or two large inline images. The read goes as one call first; refused `too-large`, it is read again with the
// command's own paging inputs and assembled into the one answer the renderer expects, each page a call with the link's
// own timeout (a read has no pending bound).
//
// - A live launch's events page by `afterSeq` and `limit` (the engine host's stream: whole rows after `afterSeq`, about
//   `limit` events, `complete` once nothing is left). From `afterSeq` as asked, `pageEvents` at a time; a page refused
//   `too-large` is asked again at half the size, and the size grows back after each page that crossed.
// - A row that alone can't cross (a page of one row refused) is left out, and its place told as `remote.gap {launchId,
//   at: {seq}}`, what the stream itself says for an event too large to carry (`{omitted: 'too-large'}`); the renderer,
//   reading this answer, places a gap told meanwhile at that point of the launch. Without a launch to name, the answer
//   says `historyUnavailable` instead (a bar at its start).
// - A window the inputs can't page is answered as history unavailable (no events, `complete`, `historyUnavailable`):
//   an older page (`before`), a subagent's slice (`agentId`), a seek, and a transcript the engine host reads from disk
//   (a session with no stream there: its events carry no `seq`, and its `limit` selects the transcript's first events,
//   not a page after a cursor). Paging those needs a byte budget on the engine host's history window (M4, acceptance
//   12); until then main says why first, `remote.historyTooLarge {window}` (`newest` for the disk read, `older` for the
//   rest), so the renderer's bar for that answer tells the person what to do rather than that history is lost.
//
// P5 O7 M4 (acceptance 12; the architect's ruling on `rl2.events-budget`): a machine whose endpoint listed
// `rl2.events-budget` takes `session.events`' byte budget (`maxBytes`), and every window is read within it, so none is
// refused `too-large` and none needs the bar above:
// - A window from the transcript (a parked session's newest window, an older page, a seek) is one budgeted read: its
//   whole turns within the budget, `earlier` reaching what precedes them, which the renderer's pager asks for next. An
//   item alone past the budget is left out by the engine host (`omitted`, no events, `earlier` already past it); main
//   reads on to the page before, so the answer holds rows, and passes `omitted` on with it: what was left out lies just
//   after the answer's events, where the renderer marks it.
// - A live launch's events are read on from `afterSeq` in budgeted pages while the launch says more follows, and
//   assembled into the one answer the renderer asked for; a row alone past the budget is left out with its place told as
//   `remote.gap {launchId, at: {seq}}`, as above.
// - An older engine host behind a current endpoint (`mawsd` serves one of an earlier build across a swap) refuses the
//   field `invalid_input`: that read goes again on the path above. A subagent's slice ignores the budget, so it keeps
//   that path too. A machine whose endpoint did not list the capability is never sent the field (its registry's strict
//   schema would refuse it).
import { MESSAGE_MAX_BYTES } from '../../../apps/org-protocol/src/index.ts';
import type { CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { SessionEvent } from '@shared/graph/events';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink } from '../machines/remote/link';

/** Events asked for per page at most: the stream's own page (PAGE_EVENTS). */
export const HISTORY_PAGE_EVENTS = 500;
/**
 * The byte budget of one answer (P5 O7 M4): the endpoint carries a result of up to MESSAGE_MAX_BYTES less 1 KiB
 * (src/endpoint/calls.ts); 64 KiB less leaves room for the result's own envelope and any difference in how the two
 * sides measure the same JSON.
 */
export const HISTORY_PAGE_BYTES = MESSAGE_MAX_BYTES - 64 * 1024;

type Events = CommandOutput<'session.events'>;
type Result = CommandResult<CommandName>;
type Omitted = NonNullable<Events['omitted']>;

export interface HistoryDeps {
  /** The session's current launch, for a left-out row's gap; null when not known. */
  launch(): string | null;
  /** `remote.gap` for the session, at a row left out. */
  gap(launchId: string, at: { seq: number }): void;
  /** `remote.historyTooLarge` for the session: a window this read can't page is answered history unavailable next. */
  tooLarge(window: 'newest' | 'older'): void;
  /** Whether the machine's endpoint listed `rl2.events-budget` (P5 O7 M4): every window is read within a byte budget. */
  budget?: boolean;
  log(line: string): void;
  pageEvents?: number;
  pageBytes?: number;
}

const refusalOf = (result: Result): unknown => (result.ok ? null : (result.error.issues as { refusal?: unknown } | undefined)?.refusal);
const tooLarge = (result: Result) => refusalOf(result) === 'too-large';
const unavailable = (): Result => ({ ok: true, value: { events: [], lastSeq: 0, complete: true, historyUnavailable: true } as Events });
/** A transcript read from disk: its events carry no `seq`. */
const fromDisk = (page: Events) => page.events.length > 0 && page.events.every((event: SessionEvent) => typeof event.seq !== 'number');
const plus = (a: Omitted | undefined, b: Omitted | undefined): Omitted | undefined =>
  a === undefined ? b : b === undefined ? a : { events: a.events + b.events, bytes: a.bytes + b.bytes, seq: b.seq ?? a.seq };

export async function readEventsInPages(link: RemoteLink, input: Record<string, unknown>, deps: HistoryDeps): Promise<Result> {
  if (deps.budget === true && input.agentId === undefined) {
    const read = await readWithinBudget(link, input, deps);
    if (read !== null) return read;
  }
  return readWhole(link, input, deps);
}

/** Every window within the byte budget; null when the engine host behind the endpoint refused the budget. */
async function readWithinBudget(link: RemoteLink, input: Record<string, unknown>, deps: HistoryDeps): Promise<Result | null> {
  const app = String(input.appSessionId);
  const said = `lane B: session.events of ${link.name}/${app}`;
  const maxBytes = deps.pageBytes ?? HISTORY_PAGE_BYTES;
  const ask = (fields: Record<string, unknown>) => dispatchOverLink(link, 'session.events', { ...fields, maxBytes });
  const first = await ask(input);
  if (!first.ok && first.error.code === 'invalid_input') {
    deps.log(`${said}: the engine host refused the byte budget (an older build); read again without it`);
    return null;
  }
  if (!first.ok) return first;
  let page = first.value as Events;

  // A window from the transcript (every disk answer's `lastSeq` is 0; a live page that read anything is past 0). An item
  // alone past the budget leaves its page empty with `earlier` past it: the page before is read, so the answer has rows.
  if (page.lastSeq === 0) {
    let omitted = page.omitted;
    while (page.omitted !== undefined && page.events.length === 0 && page.earlier !== undefined) {
      deps.log(`${said}: an item of ${page.omitted.bytes} bytes alone past the channel's budget; left out, reading the page before it`);
      const before = await ask({ appSessionId: app, afterSeq: null, limit: null, before: page.earlier });
      if (!before.ok) return before;
      page = before.value as Events;
      omitted = plus(omitted, page.omitted);
    }
    // The newest window's crons stay with it, whichever page the answer's rows came from.
    const crons = (first.value as Events).cronHistory;
    const value: Events = { ...page, ...(crons !== undefined && { cronHistory: crons }) };
    delete value.omitted;
    if (omitted !== undefined) value.omitted = omitted;
    return { ok: true, value } as Result;
  }

  // A live launch: budgeted pages from `afterSeq` while it says more follows, assembled into one answer.
  const total = typeof input.limit === 'number' ? input.limit : null;
  const events: SessionEvent[] = [];
  let cursor = typeof input.afterSeq === 'number' ? input.afterSeq : 0;
  let lost = false;
  for (;;) {
    if (page.omitted !== undefined) {
      const seq = page.omitted.seq ?? page.lastSeq;
      const launch = deps.launch();
      deps.log(`${said}: row ${seq} alone is past the channel's budget; left out${launch === null ? '' : ', a gap at its place'}`);
      if (launch === null) lost = true;
      else deps.gap(launch, { seq });
    }
    events.push(...page.events);
    lost ||= page.historyUnavailable === true;
    const full = total !== null && events.length >= total;
    if (page.complete || page.lastSeq <= cursor || full) {
      const value: Events = { events, lastSeq: Math.max(cursor, page.lastSeq), complete: page.complete && !full, ...(lost && { historyUnavailable: true as const }) };
      return { ok: true, value } as Result;
    }
    cursor = page.lastSeq;
    const next = await ask({ appSessionId: app, afterSeq: cursor, limit: total === null ? null : total - events.length });
    if (!next.ok) return next;
    page = next.value as Events;
  }
}

/** M2's read: one call, and the launch in pages of whole rows when it is refused `too-large`. */
async function readWhole(link: RemoteLink, input: Record<string, unknown>, deps: HistoryDeps): Promise<Result> {
  const app = String(input.appSessionId);
  const whole = await dispatchOverLink(link, 'session.events', input);
  if (!tooLarge(whole)) return whole;
  const said = `lane B: session.events of ${link.name}/${app}`;
  if (input.before !== undefined || input.agentId !== undefined || input.seek !== undefined) {
    deps.log(`${said}: an older window too large for the channel, answered as history unavailable`);
    deps.tooLarge('older');
    return unavailable();
  }

  const most = deps.pageEvents ?? HISTORY_PAGE_EVENTS;
  const total = typeof input.limit === 'number' ? input.limit : null;
  const events: SessionEvent[] = [];
  let cursor = typeof input.afterSeq === 'number' ? input.afterSeq : null;
  let lastSeq = cursor ?? 0;
  let size = Math.min(most, total ?? most);
  let lost = false;
  for (;;) {
    const read = await dispatchOverLink(link, 'session.events', { appSessionId: app, afterSeq: cursor, limit: size });
    if (tooLarge(read)) {
      if (size > 1) {
        size = Math.floor(size / 2);
        continue;
      }
      // One row the channel can't carry: left out, its place told, and the read goes on after it.
      const seq = (cursor ?? 0) + 1;
      const launch = deps.launch();
      deps.log(`${said}: row ${seq} alone is too large for the channel; left out${launch === null ? '' : ', a gap at its place'}`);
      if (launch === null) lost = true;
      else deps.gap(launch, { seq });
      cursor = lastSeq = seq;
      continue;
    }
    if (!read.ok) return read;
    const page = read.value as Events;
    if (fromDisk(page)) {
      deps.log(`${said}: a transcript read from disk too large for the channel, answered as history unavailable`);
      deps.tooLarge('newest');
      return unavailable();
    }
    events.push(...page.events);
    lost ||= page.historyUnavailable === true;
    const advanced = page.lastSeq > (cursor ?? 0) || (cursor === null && page.events.length > 0);
    lastSeq = Math.max(lastSeq, page.lastSeq);
    const full = total !== null && events.length >= total;
    if (page.complete || page.events.length === 0 || !advanced || full) {
      const value: Events = { events, lastSeq, complete: page.complete && !full, ...(lost && { historyUnavailable: true as const }) };
      return { ok: true, value } as Result;
    }
    cursor = page.lastSeq;
    size = Math.min(size * 2, most, total === null ? most : total - events.length);
  }
}
