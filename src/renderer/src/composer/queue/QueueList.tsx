// The queued list above the composer frame (C7 execution document, "Submit control and queue", as the Decision Log of
// 2026-09-29 amends it, and W1's Enter scheme, charter §4.2 as amended 2026-10-01). First the pending steers (Enter
// while a turn runs: the engine delivers them at the next step), each with Send now (an interrupt: the engine then
// starts what it holds, pass3/steer-next-interrupted) and Hold until the turn ends (`session.queue.hold`). Then one row
// per app-queue entry in C3's states. A `queued` (held) entry reads as one line with Send now (promote with priority
// `now`), a caret with Send at the next step (priority `next`), Edit (inline, through `session.queue.edit`) and Delete.
// An `uncertain` entry is the paused queue's head and says it may not have been delivered, with Resume, Edit and
// Delete. A `submitting` entry is in flight: after 300 ms it reads Sending…, with nothing to act on. A `released` entry
// is the running turn and is not listed. While paused (and no uncertain entry explains why) the header says why, from
// the host's pause reason, with Resume. Failures keep the row and toast.
import { DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { QueueEntry, QueuePauseReason, SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { SENDS_AT_NEXT_STEP, SENDS_AT_TURN_END, SEND_NOW_DETAIL, steerPriority } from '../submit/submit-state';
import { entryDisplay } from './entry-text';
import { QueueEdit } from './QueueEdit';

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
const ITEM = 'flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover';

export interface QueueListProps {
  appSessionId: AppSessionId;
  queue: SessionQueue;
  sessionId: string | null; // the engine session id, for an edit's pasted tags
  cwd: string;
  client?: MawsBridge;
}

function useQueueActions(appSessionId: AppSessionId, client: MawsBridge) {
  const [busy, setBusy] = useState<string | null>(null); // the queue id an action is in flight for
  const run = async (queueId: string | null, action: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setBusy(queueId ?? '');
    try {
      const result = await action();
      if (!result.ok) toast({ level: 'warning', text: result.error?.message ?? 'The queue did not answer', actions: [], dismissible: true });
      return result.ok;
    } finally {
      setBusy(null);
    }
  };
  return {
    busy,
    promote: (queueId: string, action: 'queue' | 'interrupt_and_send') => run(queueId, () => client.invoke('session.queue.promote', { appSessionId, queueId, priority: steerPriority(action) })),
    // W1: a pending steer's two actions
    sendNow: (messageUuid: string) => run(messageUuid, () => client.invoke('session.interrupt', { appSessionId, cancelEngineQueued: false })),
    hold: (messageUuid: string) => run(messageUuid, () => client.invoke('session.queue.hold', { appSessionId, messageUuid: messageUuid as MessageUuid })),
    remove: (queueId: string) => run(queueId, () => client.invoke('session.queue.remove', { appSessionId, queueId })),
    edit: (queueId: string, content: SendContent) => run(queueId, () => client.invoke('session.queue.edit', { appSessionId, queueId, content })),
    resume: () => run(null, () => client.invoke('session.queue.setPaused', { appSessionId, paused: false })),
  };
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
  return new Set(submitting.filter((e) => lasting.has(submission(e))).map((e) => e.queueId));
}

function SubmittingRow({ entry }: { entry: QueueEntry }) {
  return (
    <li data-queue-state="submitting" className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-fg-muted">
      <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent" />
      <span className="min-w-0 flex-1 truncate">{entryDisplay(entry.content)}</span>
      <span className="shrink-0 text-ui-sm">Sending…</span>
    </li>
  );
}

export function QueueList({ appSessionId, queue, sessionId, cwd, client = ipc }: QueueListProps) {
  const actions = useQueueActions(appSessionId, client);
  const [editing, setEditing] = useState<string | null>(null);
  const lasting = useLastingSubmissions(queue.entries);
  // what is shown decides whether the list is: queued entries (the uncertain head among them) and lasting submissions
  const listed = queue.entries.filter((e) => e.state === 'queued' || (e.state === 'submitting' && lasting.has(e.queueId)));
  const steers = queue.steers;
  if (listed.length === 0 && steers.length === 0) return null;
  const waiting = listed.filter((e) => e.state === 'queued').length;
  const uncertain = listed.some((e) => e.uncertain);
  const disabled = (e: QueueEntry) => actions.busy !== null && (actions.busy === '' || actions.busy === e.queueId);

  const editRow = (entry: QueueEntry) => (
    <QueueEdit
      content={entry.content}
      sessionId={sessionId}
      cwd={cwd}
      onCancel={() => setEditing(null)}
      onSave={async (content) => {
        const saved = await actions.edit(entry.queueId, content);
        if (saved) setEditing(null);
        return saved;
      }}
    />
  );

  return (
    <section aria-label="Queued messages" className="flex flex-col overflow-hidden rounded-lg border border-border bg-bg-raised text-ui">
      <header className="flex items-center gap-2 border-b border-border px-2.5 py-1 text-ui-sm text-fg-muted">
        <span className="flex-1">
          {[steers.length > 0 ? `${steers.length} at the next step` : null, waiting > 0 ? `${waiting} held until the turn ends` : listed.length > 0 ? 'Sending' : null].filter(Boolean).join(' · ')}
          {queue.paused && !uncertain && listed.length > 0 ? ` · ${PAUSED_COPY[queue.pauseReason ?? 'none']}` : ''}
        </span>
        {queue.paused && !uncertain && listed.length > 0 && (
          <button type="button" className={BUTTON} disabled={actions.busy !== null} onClick={() => void actions.resume()}>
            Resume
          </button>
        )}
      </header>
      <ul className="m-0 flex list-none flex-col p-0">
        {steers.map((steer) => (
          <li key={steer.messageUuid} data-queue-state="steer" className="flex min-w-0 items-center gap-1 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate text-fg">{entryDisplay(steer.content)}</span>
            <span className="shrink-0 text-ui-sm text-fg-muted">{SENDS_AT_NEXT_STEP}</span>
            <button type="button" className={BUTTON} title={SEND_NOW_DETAIL} disabled={actions.busy !== null} onClick={() => void actions.sendNow(steer.messageUuid)}>
              Send now
            </button>
            <button type="button" className={BUTTON} title={SENDS_AT_TURN_END} disabled={actions.busy !== null} onClick={() => void actions.hold(steer.messageUuid)}>
              Hold until the turn ends
            </button>
          </li>
        ))}
        {listed.map((entry) => {
          if (entry.state === 'submitting') return <SubmittingRow key={entry.queueId} entry={entry} />;
          if (entry.uncertain)
            return (
              <li key={entry.queueId} data-queue-state="uncertain" className="flex min-w-0 flex-col gap-1 border-l-2 border-warning bg-bg-hover px-2.5 py-1.5">
                {editing === entry.queueId ? (
                  editRow(entry)
                ) : (
                  <>
                    <span className="truncate text-fg">{entryDisplay(entry.content)}</span>
                    <div className="flex items-center gap-1">
                      <span role="status" className="flex-1 text-ui-sm text-warning">
                        {UNCERTAIN_TEXT}
                      </span>
                      <button type="button" className={BUTTON} disabled={disabled(entry)} onClick={() => void actions.resume()}>
                        Resume
                      </button>
                      <button type="button" className={BUTTON} disabled={disabled(entry)} onClick={() => setEditing(entry.queueId)}>
                        Edit
                      </button>
                      <button type="button" className={BUTTON} disabled={disabled(entry)} onClick={() => void actions.remove(entry.queueId)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          return (
            <li key={entry.queueId} data-queue-state="queued" className="flex min-w-0 items-center gap-1 px-2.5 py-1.5">
              {editing === entry.queueId ? (
                editRow(entry)
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-fg">{entryDisplay(entry.content)}</span>
                  <button type="button" className={BUTTON} title={SEND_NOW_DETAIL} disabled={disabled(entry)} onClick={() => void actions.promote(entry.queueId, 'interrupt_and_send')}>
                    Send now
                  </button>
                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger aria-label="More ways to send" className={BUTTON} disabled={disabled(entry)}>
                      ⌄
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                        <DropdownMenu.Item className={ITEM} onSelect={() => void actions.promote(entry.queueId, 'queue')}>
                          <span>Send at the next step</span>
                          <span className="text-ui-sm text-fg-muted">Adds this to the running turn at its next step</span>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                  <button type="button" className={BUTTON} disabled={disabled(entry)} onClick={() => setEditing(entry.queueId)}>
                    Edit
                  </button>
                  <button type="button" className={BUTTON} disabled={disabled(entry)} onClick={() => void actions.remove(entry.queueId)}>
                    Delete
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
