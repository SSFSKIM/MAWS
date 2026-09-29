// The queued list above the composer frame (C7 execution document, "Submit control and queue", as the Decision Log of
// 2026-09-29 amends it): one row per entry in C3's states. A `queued` entry reads as one line with Steer (promote with
// priority `next`: it joins the running turn at its next step), a caret with Interrupt and send (priority `now`), Edit
// (inline, through `session.queue.edit`) and Delete. An `uncertain` entry is the paused queue's head and says it may not
// have been delivered, with Resume, Edit and Delete. A `submitting` entry is in flight: after 300 ms it reads Sending…,
// with nothing to act on. A `released` entry is the running turn and is not listed. While paused (and no uncertain
// entry explains why) the header says why, from the host's pause reason, with Resume. Failures keep the row and toast.
import { DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { QueueEntry, QueuePauseReason, SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { steerPriority } from '../submit/submit-state';
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
    promote: (queueId: string, action: 'steer' | 'interrupt_and_send') => run(queueId, () => client.invoke('session.queue.promote', { appSessionId, queueId, priority: steerPriority(action) })),
    remove: (queueId: string) => run(queueId, () => client.invoke('session.queue.remove', { appSessionId, queueId })),
    edit: (queueId: string, content: SendContent) => run(queueId, () => client.invoke('session.queue.edit', { appSessionId, queueId, content })),
    resume: () => run(null, () => client.invoke('session.queue.setPaused', { appSessionId, paused: false })),
  };
}

// A submitting entry is in flight; C3 acknowledges within milliseconds, so it shows only once it has lasted.
function SubmittingRow({ entry }: { entry: QueueEntry }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const since = entry.submittedAt ? Date.parse(entry.submittedAt) : Date.now();
    const timer = setTimeout(() => setShown(true), Math.max(0, SUBMITTING_VISIBLE_MS - (Date.now() - since)));
    return () => clearTimeout(timer);
  }, [entry.submittedAt]);
  if (!shown) return null;
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
  const listed = queue.entries.filter((e) => e.state !== 'released');
  if (listed.length === 0) return null;
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
          {waiting > 0 ? `${waiting} queued` : 'Sending'}
          {queue.paused && !uncertain ? ` · ${PAUSED_COPY[queue.pauseReason ?? 'none']}` : ''}
        </span>
        {queue.paused && !uncertain && (
          <button type="button" className={BUTTON} disabled={actions.busy !== null} onClick={() => void actions.resume()}>
            Resume
          </button>
        )}
      </header>
      <ul className="m-0 flex list-none flex-col p-0">
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
                  <button type="button" className={BUTTON} title="Adds this to the running turn at its next step" disabled={disabled(entry)} onClick={() => void actions.promote(entry.queueId, 'steer')}>
                    Steer
                  </button>
                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger aria-label="More ways to send" className={BUTTON} disabled={disabled(entry)}>
                      ⌄
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                        <DropdownMenu.Item className={ITEM} onSelect={() => void actions.promote(entry.queueId, 'interrupt_and_send')}>
                          <span>Interrupt and send</span>
                          <span className="text-ui-sm text-fg-muted">Stops the running turn, then sends this</span>
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
