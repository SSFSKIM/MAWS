// The stack above the composer frame (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M3;
// decisions 12, 14, 15; the child's file, "The stack"): the only place a waiting message is drawn. Its rows are
// `stackRows`' (./stack.ts): the messages at the next step, then those after the turn, each two lines of text with its
// mark ("Next step", "After the turn", "Held") at the right; a click on the text or Enter on the focused row opens it in
// place. On hover or keyboard focus a row shows Send now, Delete and "More" (Edit, and the move to the other kind of
// wait) just left of its mark, over the end of the text behind a short fade, so nothing reflows. With three or more rows
// it folds to one line, opened per session for the window's life; a paused queue says why with Resume and stays open.
// Three rows keep their earlier shape: the entry that may not have been delivered, a submission that has lasted 300 ms
// ("Sending…"), and an answer's row, which offers Send now only. Edit is the composer's take-back (`onTakeBack`); the
// inline editor is gone. One notice line (`role="status"`) says what an act or a key could not do, and clears at the
// queue's next change other than the act's own row leaving, or at the next key in the box (the composer's).
import { DropdownMenu } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { QueueEntry, QueuePauseReason } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { Icon } from '../../app/IconButton';
import { ipc } from '../../ipc/client';
import { useSessionControls } from '../../session/controls/controls-for'; // P5 O9 M4
import { clearStackNotice, setSendingNow, setStackOpen, useComposerStore } from '../../stores/composer';
import type { SessionQueue } from '../../stores/queue';
import { deleteRefusal, sendNowRefusal, stackActs, takeBackRefusal, useRead, useRefusals, type Acts, type Refusals } from './stack-acts';
import { isWaiting, rowText, STACK_WORDS, stackRows, type StackRow, type TakenRow, type WaitingRow } from './stack';

export const SUBMITTING_VISIBLE_MS = 300;
export const UNCERTAIN_TEXT = 'May not have been delivered · check the transcript, then Resume or Delete';

// The header of a paused queue, by the reason the host paused it (Decision Log "execution start 2026-09-29" item 2).
export const PAUSED_COPY: Record<QueuePauseReason | 'none', string> = {
  interrupt: 'Queue paused because you interrupted',
  user: 'Queue paused',
  exit: 'Queue paused · the session ended',
  engine_turn: 'Queue paused · a background task finished while messages were waiting',
  refused: 'Queue paused · a message could not be sent',
  write_failed: 'Queue paused · a message could not be sent',
  store_failed: 'Queue paused · a message could not be sent',
  state_corrupt: 'Queue paused · the saved queue could not be read',
  uncertain: 'Queue paused',
  none: 'Queue paused',
};

const BUTTON = 'rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint';
const ICON_BUTTON = 'flex size-6 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint';
const ITEM = 'flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';
const NO_KEYS: ReadonlySet<string> = new Set();

// The row's three controls, on the app's 16 px icon grid
const SendNowGlyph = () => (
  <Icon>
    <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
  </Icon>
);
const BinGlyph = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);
const MoreGlyph = () => (
  <Icon>
    <path d="M4 8h.01M8 8h.01M12 8h.01" strokeWidth={2} />
  </Icon>
);
const Caret = ({ open }: { open: boolean }) => (
  <Icon className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export interface QueueListProps {
  appSessionId: AppSessionId;
  queue: SessionQueue;
  busy: boolean; // a turn runs (`isBusy`)
  client?: MawsBridge;
  onTakeBack?(row: TakenRow): void; // Edit: the composer's take-back (it says when the box holds a draft)
}

// The submitting entries that have lasted 300 ms. Every Send passes through `submitting` and C3 acknowledges within
// milliseconds, so a fresh one is not shown (nor does it make the list appear); a timer re-renders when one has lasted.
// A submission is its entry and its `submittedAt` (each submission stamps a new one), so an entry reverted to queued and
// submitted again waits its 300 ms again; the set keeps only the submissions still under way.
const submission = (e: QueueEntry) => `${e.queueId}@${e.submittedAt ?? ''}`;
function useLastingSubmissions(entries: readonly QueueEntry[]): ReadonlySet<string> {
  const [lasting, setLasting] = useState<ReadonlySet<string>>(() => new Set());
  const submitting = entries.filter((e) => e.state === 'submitting');
  const fresh = submitting.filter((e) => !lasting.has(submission(e)));
  const key = fresh.map(submission).join(' ');
  const current = submitting.map(submission).join(' ');
  useEffect(() => {
    if (fresh.length === 0) return;
    const under = new Set(current.split(' '));
    const timers = fresh.map((e) => {
      const since = e.submittedAt ? Date.parse(e.submittedAt) : Date.now();
      return setTimeout(() => setLasting((s) => new Set([...s].filter((t) => under.has(t))).add(submission(e))), Math.max(0, SUBMITTING_VISIBLE_MS - (Date.now() - since)));
    });
    return () => timers.forEach(clearTimeout);
    // `key` names exactly the fresh submissions; `current` is read with them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ids = submitting.filter((e) => lasting.has(submission(e))).map((e) => e.queueId).join(' ');
  return useMemo(() => new Set(ids === '' ? [] : ids.split(' ')), [ids]);
}

export function QueueList({ appSessionId, queue, busy, client = ipc, onTakeBack }: QueueListProps) {
  const controls = useSessionControls(appSessionId, { client });
  const acts = useMemo(() => stackActs(appSessionId, controls), [appSessionId, controls]);
  const lasting = useLastingSubmissions(queue.entries);
  const read = useRead(appSessionId);
  const rows = useMemo(() => stackRows(queue, lasting, read), [queue, lasting, read]);
  const refusals = useRefusals(appSessionId);
  const open = useComposerStore((s) => s.stackOpen.has(appSessionId));
  const notice = useComposerStore((s) => s.stackNotices.get(appSessionId) ?? null);
  const sendingNow = useComposerStore((s) => s.sendingNow.get(appSessionId) ?? NO_KEYS);
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(NO_KEYS); // the rows an act is on its way for

  // A Send now's "Sending…" holds for the next-step rows it was answered for, each until it leaves (its `started`)
  const nextKeys = rows.filter((row) => row.kind === 'next').map((row) => row.key);
  const nextKeyList = nextKeys.join(' ');
  useEffect(() => {
    if (sendingNow.size === 0) return;
    const still = new Set(nextKeyList.split(' '));
    const kept = new Set([...sendingNow].filter((key) => still.has(key)));
    if (kept.size !== sendingNow.size) setSendingNow(appSessionId, kept);
  }, [appSessionId, nextKeyList, sendingNow]);

  // The notice clears at the queue's next change, the act's own row leaving aside
  const others = notice === null ? '' : rows.filter((row) => row.key !== notice.subject).map((row) => `${row.kind}:${row.key}`).join(' ');
  const seen = useRef<{ id: number; others: string } | null>(null);
  useEffect(() => {
    if (notice === null) return void (seen.current = null);
    if (seen.current?.id !== notice.id) return void (seen.current = { id: notice.id, others });
    if (seen.current.others !== others) clearStackNotice(appSessionId, notice.id);
  }, [appSessionId, notice, others]);

  if (rows.length === 0 && notice === null) return null;
  const run = async (key: string, act: () => Promise<boolean>) => {
    setInFlight((s) => new Set(s).add(key));
    try {
      await act();
    } finally {
      setInFlight((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };
  const paused = queue.paused && rows.length > 0 && !rows.some((row) => row.kind === 'uncertain');
  const folds = !paused && rows.length >= 3;
  const shown = !folds || open;

  return (
    <section aria-label="Queued messages" className="flex flex-col overflow-hidden rounded-lg border border-border bg-bg-raised text-ui">
      {paused && (
        <header className="flex items-center gap-2 border-b border-border px-2.5 py-1 text-ui-sm text-fg-muted">
          <span className="flex-1">{PAUSED_COPY[queue.pauseReason ?? 'none']}</span>
          <button type="button" className={BUTTON} disabled={inFlight.has('')} onClick={() => void run('', acts.resume)}>
            Resume
          </button>
        </header>
      )}
      {folds && (
        <header className={shown ? 'border-b border-border' : undefined}>
          <button type="button" aria-expanded={open} className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2" onClick={() => setStackOpen(appSessionId, !open)}>
            <Caret open={open} />
            <span className="min-w-0 flex-1 truncate">{STACK_WORDS.folded(rows.length, rowText(rows[0]!).replace(/\n/g, ' '))}</span>
          </button>
        </header>
      )}
      {shown && rows.length > 0 && (
        <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
          {rows.map((row) => (
            <StackRowView key={row.key} row={row} busy={busy} acts={acts} refusals={refusals} sending={sendingNow.has(row.key)} inFlight={inFlight.has(row.key)} nextKeys={nextKeys} run={run} onTakeBack={onTakeBack} />
          ))}
        </ul>
      )}
      {notice !== null && (
        <p role="status" aria-label="Stack notice" className={`m-0 px-2.5 py-1 text-ui-sm text-fg-muted ${rows.length > 0 ? 'border-t border-border' : ''}`}>
          {notice.text}
        </p>
      )}
    </section>
  );
}

interface RowViewProps {
  row: StackRow;
  busy: boolean;
  acts: Acts;
  refusals: Refusals;
  sending: boolean; // a Send now was answered for it: "Sending…" until it starts
  inFlight: boolean;
  nextKeys: readonly string[];
  run(key: string, act: () => Promise<boolean>): Promise<void>;
  onTakeBack?(row: TakenRow): void;
}

function StackRowView({ row, busy, acts, refusals, sending, inFlight, nextKeys, run, onTakeBack }: RowViewProps) {
  const [open, setOpen] = useState(false);
  const text = rowText(row);
  const toggle = () => setOpen((o) => !o);
  // Enter on the focused row itself (not on one of its controls) opens or closes it
  const onKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    event.preventDefault();
    toggle();
  };
  const body = (
    <span data-row-text title={text} onClick={toggle} className={`min-w-0 flex-1 cursor-default text-fg ${open ? 'whitespace-pre-wrap break-words' : 'line-clamp-2 whitespace-pre-line break-words'}`}>
      {text}
    </span>
  );

  if (row.kind === 'uncertain') {
    const editRefused = takeBackRefusal(refusals, row);
    return (
      <li data-queue-state="uncertain" data-open={open} tabIndex={0} onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-1 border-l-2 border-warning bg-bg-hover px-2.5 py-1.5 outline-accent focus-visible:outline-2">
        {body}
        <div className="flex items-center gap-1">
          <span role="status" className="flex-1 text-ui-sm text-warning">
            {UNCERTAIN_TEXT}
          </span>
          <button type="button" className={BUTTON} disabled={inFlight} onClick={() => void run(row.key, acts.resume)}>
            Resume
          </button>
          <button type="button" className={BUTTON} disabled={inFlight || editRefused !== null} title={editRefused ?? undefined} onClick={() => onTakeBack?.(row)}>
            Edit
          </button>
          <button type="button" className={BUTTON} disabled={inFlight} onClick={() => void run(row.key, () => acts.remove(row))}>
            Delete
          </button>
        </div>
      </li>
    );
  }

  const quiet = row.kind === 'sending' || row.kind === 'handed' || sending; // no controls
  return (
    <li
      data-queue-state={row.kind === 'sending' ? 'submitting' : row.kind}
      data-open={open}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group flex min-w-0 items-start gap-2 px-2.5 py-1.5 outline-accent focus-visible:outline-2 ${quiet ? 'text-fg-muted' : ''}`}
    >
      {row.kind === 'sending' && <span aria-hidden className="mt-1 size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent" />}
      <div className="relative flex min-w-0 flex-1">
        {body}
        {!quiet && isWaiting(row) && <RowControls row={row} busy={busy} acts={acts} refusals={refusals} inFlight={inFlight} nextKeys={nextKeys} run={run} onTakeBack={onTakeBack} />}
      </div>
      <span data-mark className="mt-px shrink-0 text-ui-sm text-fg-muted">
        {row.kind === 'sending' || sending ? STACK_WORDS.marks.sending : STACK_WORDS.marks[row.kind]}
      </span>
    </li>
  );
}

interface ControlsProps {
  row: WaitingRow;
  busy: boolean;
  acts: Acts;
  refusals: Refusals;
  inFlight: boolean;
  nextKeys: readonly string[];
  run(key: string, act: () => Promise<boolean>): Promise<void>;
  onTakeBack?(row: TakenRow): void;
}

function RowControls({ row, busy, acts, refusals, inFlight, nextKeys, run, onTakeBack }: ControlsProps) {
  const sendRefused = sendNowRefusal(refusals, row);
  const editRefused = takeBackRefusal(refusals, row);
  const deleteRefused = deleteRefusal(refusals, row);
  const sendTitle = sendRefused ?? (!busy ? STACK_WORDS.sendNow : row.kind === 'next' && nextKeys.length > 1 ? STACK_WORDS.sendNowAll(nextKeys.length) : STACK_WORDS.sendNowWhileRunning);
  const move = row.kind === 'next' ? 'Queue for after the turn' : row.kind === 'after' && busy ? 'Send at the next step' : null;
  return (
    // over the end of the text, behind a short fade; drawn on the row's hover or keyboard focus
    <div className="absolute inset-y-0 right-0 flex items-start gap-0.5 bg-linear-to-l from-bg-raised from-75% to-transparent pl-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" aria-label="Send now" title={sendTitle} className={ICON_BUTTON} disabled={inFlight || sendRefused !== null} onClick={() => void run(row.key, () => acts.sendNow(row, nextKeys))}>
        <SendNowGlyph />
      </button>
      {!row.answer && (
        <>
          <button type="button" aria-label="Delete" title={deleteRefused ?? undefined} className={ICON_BUTTON} disabled={inFlight || deleteRefused !== null} onClick={() => void run(row.key, () => acts.remove(row))}>
            <BinGlyph />
          </button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger aria-label="More" className={ICON_BUTTON} disabled={inFlight}>
              <MoreGlyph />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                <DropdownMenu.Item className={ITEM} disabled={editRefused !== null} title={editRefused ?? undefined} onSelect={() => onTakeBack?.(row)}>
                  Edit
                </DropdownMenu.Item>
                {move !== null && (
                  <DropdownMenu.Item className={ITEM} onSelect={() => void run(row.key, () => acts.move(row))}>
                    {move}
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </>
      )}
    </div>
  );
}
