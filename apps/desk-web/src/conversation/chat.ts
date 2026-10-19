// The group chat's blocks (the composite's §4, amended 2026-10-19): the stream's items as a chat reads them. A sender's
// consecutive items — messages, questions, requests — within a few minutes of each other stand under one header (a
// run); the lifecycle lines between two things the human reads merge per session and stand together (a quiet run, which
// the view folds past a few lines); a day separator stands wherever the calendar day changes, as the session view's
// time rows do. A human's message, a run of agent traffic and a working-record fold are blocks of their own.
import type { StreamItem } from './stream';

export type RunItem = Extract<StreamItem, { kind: 'message' | 'question' | 'request' }>;
export type HumanItem = Extract<StreamItem, { kind: 'human' }>;
export type SystemItem = Extract<StreamItem, { kind: 'system' }>;

/** One line of a quiet run: a session's consecutive lifecycle events, each its words after the subject. */
export type QuietLine = { key: string; session: string | null; subject: string; says: Array<{ offset: number; text: string }>; ts: string };

export type ChatBlock =
  | { kind: 'day'; key: string; ts: string }
  /** `from`: the alias the run's first message or question went out under; null for a run of requests alone. `ts`: the
   * first dated item's. */
  | { kind: 'run'; key: string; session: string | null; from: string | null; ts: string | null; items: RunItem[] }
  | { kind: 'human'; key: string; item: HumanItem }
  | { kind: 'quiet'; key: string; lines: QuietLine[] }
  | { kind: 'agents'; key: string; item: Extract<StreamItem, { kind: 'agents' }> }
  | { kind: 'work'; key: string; item: Extract<StreamItem, { kind: 'work' }> };

/** How long after a sender's last item its next one still stands under the same header. */
export const RUN_WINDOW_MS = 5 * 60_000;

/** An item's time: a request's is the bound below it the stream gives it, so an old run or a past day does not take
 * it in; a working-record fold has none. */
const tsOf = (item: StreamItem): string | null =>
  item.kind === 'agents' ? (item.says[0]?.event.ts ?? null) : item.kind === 'request' ? item.ts : item.kind === 'work' ? null : item.event.ts;

/** The local calendar day of a time, for the separators. */
export function dayOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function chatBlocks(items: readonly StreamItem[], options: { window?: number } = {}): ChatBlock[] {
  const window = options.window ?? RUN_WINDOW_MS;
  const blocks: ChatBlock[] = [];
  let day = '';
  // The run under construction, with the time of its last dated item.
  let run: { block: Extract<ChatBlock, { kind: 'run' }>; until: string | null } | null = null;
  for (const item of items) {
    const ts = tsOf(item);
    if (ts !== null && dayOf(ts) !== day) {
      day = dayOf(ts);
      // Keyed by the item that opened the day, not the day: the log is in offset order, and a writer whose clock is
      // behind can put yesterday after today, so one day may open twice.
      blocks.push({ kind: 'day', key: `day:${item.key}`, ts });
      run = null;
    }
    const last = blocks.at(-1);
    switch (item.kind) {
      case 'message':
      case 'question':
      case 'request': {
        const within = run !== null && last === run.block && run.block.session === item.session && (ts === null || run.until === null || Date.parse(ts) - Date.parse(run.until) <= window);
        if (within && run !== null) {
          run.block.items.push(item);
          run.block.ts ??= ts;
          run.block.from ??= item.kind === 'request' ? null : item.from;
          if (ts !== null) run.until = ts;
        } else {
          const block: Extract<ChatBlock, { kind: 'run' }> = { kind: 'run', key: `run:${item.key}`, session: item.session, from: item.kind === 'request' ? null : item.from, ts, items: [item] };
          blocks.push(block);
          run = { block, until: ts };
        }
        break;
      }
      case 'system': {
        const say = { offset: item.offset, text: item.rest };
        const previous = last?.kind === 'quiet' ? last.lines.at(-1) : undefined;
        if (last?.kind === 'quiet' && previous && previous.session === item.session && previous.subject === item.subject) previous.says.push(say);
        else {
          const line: QuietLine = { key: item.key, session: item.session, subject: item.subject, says: [say], ts: item.event.ts };
          if (last?.kind === 'quiet') last.lines.push(line);
          else blocks.push({ kind: 'quiet', key: `quiet:${item.key}`, lines: [line] });
        }
        run = null;
        break;
      }
      case 'human':
        blocks.push({ kind: 'human', key: item.key, item });
        run = null;
        break;
      case 'agents':
        blocks.push({ kind: 'agents', key: item.key, item });
        run = null;
        break;
      case 'work':
        blocks.push({ kind: 'work', key: item.key, item });
        run = null;
        break;
    }
  }
  return blocks;
}
