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
import type { CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { SessionEvent } from '@shared/graph/events';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink } from '../machines/remote/link';

/** Events asked for per page at most: the stream's own page (PAGE_EVENTS). */
export const HISTORY_PAGE_EVENTS = 500;

type Events = CommandOutput<'session.events'>;
type Result = CommandResult<CommandName>;

export interface HistoryDeps {
  /** The session's current launch, for a left-out row's gap; null when not known. */
  launch(): string | null;
  /** `remote.gap` for the session, at a row left out. */
  gap(launchId: string, at: { seq: number }): void;
  /** `remote.historyTooLarge` for the session: a window this read can't page is answered history unavailable next. */
  tooLarge(window: 'newest' | 'older'): void;
  log(line: string): void;
  pageEvents?: number;
}

const refusalOf = (result: Result): unknown => (result.ok ? null : (result.error.issues as { refusal?: unknown } | undefined)?.refusal);
const tooLarge = (result: Result) => refusalOf(result) === 'too-large';
const unavailable = (): Result => ({ ok: true, value: { events: [], lastSeq: 0, complete: true, historyUnavailable: true } as Events });
/** A transcript read from disk: its events carry no `seq`. */
const fromDisk = (page: Events) => page.events.length > 0 && page.events.every((event: SessionEvent) => typeof event.seq !== 'number');

export async function readEventsInPages(link: RemoteLink, input: Record<string, unknown>, deps: HistoryDeps): Promise<Result> {
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
