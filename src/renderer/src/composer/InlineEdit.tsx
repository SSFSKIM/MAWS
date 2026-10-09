// The bubble edited in place (W3, B6; charter line 134 and §5.3 as amended 2026-10-01; Codex's pattern, shot 13): C7
// registers `BubbleEdit` with C6, which renders it around every user bubble; for the bubble its session is editing it
// shows an editor in the bubble's place, the text as typed with its pasted placeholders, Cancel, Fork (with C10's
// provider, for an edit) and Send. Send rewinds this session to that message and resends; a prompt a hook blocked is
// sent as a new message. P2-A (2026-10-09): on a session with no ready process Send starts it first and says so.
// The resubmit's states read on the editor's own line (`resubmit-seam.ts` drives them); once the
// rewind hid the bubble with its turn and the resend still waits, `ResubmitLine` carries Send or Retry in the composer's
// dock. ⌘Enter sends, Esc cancels. Nothing is pulled into the composer.
import { AlertDialog } from 'radix-ui';
import { useEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { availabilityRefusal, useAvailability } from '../sessions/availability'; // P2-A
import { inlineEditOf, resubmitRecordOf, setInlineText, useComposerStore, type InlineEdit, type Resubmit } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import type { UserRow } from './edit-prefill';
import { cancelInlineEdit, cancelRewind, confirmRewind, forkInlineEdit, keepEditing, resubmitProvider, rewindAgain, sendInlineEdit } from './resubmit-seam';

const BUTTON = 'rounded-sm px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
const PRIMARY = 'rounded-sm bg-accent px-2.5 py-0.5 text-ui-sm text-bg outline-accent hover:opacity-90 focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint';

export const BUSY_REASON = 'Wait for the turn to end, or stop it first';
export const NOT_STARTABLE = 'The session is not running'; // P2-A: a session with no record cannot be started from here

// What the resubmit's line says in each state; `warn` states read in the warning tone; null at rest.
// P2-A: `starting` while the session the edit resubmits to is started first
function lineCopy({ state, exited, sendFailed, sending }: Resubmit, starting = false): { text: string; warn: boolean } | null {
  if (sending && starting) return { text: 'Starting this session…', warn: false };
  if (sending) return { text: state === 'rewound_awaiting_send' ? 'Rewound · sending your edited message…' : 'Sending your edited message…', warn: false };
  switch (state) {
    case 'rewinding':
      return { text: 'Rewinding this session to that message…', warn: false };
    case 'rewind_uncertain':
      return { text: 'Rewind unconfirmed · checking the transcript…', warn: true };
    case 'rewind_unresolved':
      return { text: 'The rewind could not be confirmed', warn: true };
    case 'rewound_awaiting_send':
      return sendFailed ? { text: 'Rewound · the message was not sent', warn: true } : { text: 'Rewound · send your edited message', warn: false };
    default:
      return exited ? { text: 'The engine exited before the rewind was confirmed · your edited text is kept', warn: true } : null;
  }
}

// Around every user bubble: the editor for the one its session edits, else the bubble itself.
export function BubbleEdit({ storeKey, row, children, client = ipc }: { storeKey: string; row: UserRow; children: ReactNode; client?: MawsBridge }) {
  const appSessionId = storeKey as AppSessionId;
  const edit = useComposerStore((s) => inlineEditOf(s, appSessionId));
  if (!edit || row.messageUuid === null || edit.messageUuid !== row.messageUuid) return children;
  return <InlineEditor appSessionId={appSessionId} edit={edit} client={client} />;
}

function InlineEditor({ appSessionId, edit, client }: { appSessionId: AppSessionId; edit: InlineEdit; client: MawsBridge }) {
  const resubmit = useComposerStore((s) => resubmitRecordOf(s, appSessionId));
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const busy = status !== null && (status.turn !== null || status.engineState === 'running');
  const locked = resubmit.sending || resubmit.state === 'rewinding' || resubmit.state === 'rewind_uncertain';
  // P2-A start (2026-10-09; the execution document §5.6): a session with no ready process is started by Send; only a
  // terminal or job holding it, an archive, or no record keeps Send closed
  const ready = status?.process === 'ready';
  const availability = useAvailability(appSessionId);
  const holder = useSessions((s) => s.records.get(appSessionId)?.holder ?? null);
  const notStartable = ready ? null : availabilityRefusal(availability, holder, NOT_STARTABLE);
  const why = notStartable ?? (edit.kind === 'edit' && busy ? BUSY_REASON : null);
  // P2-A end
  const empty = edit.text.trim() === '' && edit.images.length === 0;
  const fork = edit.kind === 'edit' && resubmitProvider() !== null;
  const line = lineCopy(resubmit, !ready);
  const send = () => !locked && why === null && !empty && void sendInlineEdit(client, appSessionId);

  return (
    <section aria-label="Edit your message" data-inline-edit={resubmit.state} className="flex w-full min-w-0 flex-col gap-2 rounded-2xl bg-bg-raised p-3 shadow-composer">
      <textarea
        ref={field}
        aria-label="Edited message"
        value={edit.text}
        readOnly={locked}
        rows={1}
        onChange={(event) => setInlineText(appSessionId, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            cancelInlineEdit(appSessionId);
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        className="max-h-[40vh] min-h-11 w-full resize-none bg-transparent text-prose leading-[var(--lh-prose)] text-fg outline-none field-sizing-content read-only:text-fg-muted"
      />
      {edit.images.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {edit.images.map((image, i) => (
            <span key={i} className="rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted">
              {image.name}
            </span>
          ))}
        </div>
      )}
      {line && (
        <p role="status" className={`m-0 text-ui-sm ${line.warn ? 'text-warning' : 'text-fg-muted'}`}>
          {line.text}
        </p>
      )}
      <div className="flex items-center justify-end gap-1">
        {resubmit.state === 'rewind_unresolved' ? (
          <>
            <button type="button" className={BUTTON} disabled={locked} onClick={() => void rewindAgain(client, appSessionId)}>
              Rewind again
            </button>
            <button type="button" className={BUTTON} disabled={locked} onClick={() => void sendInlineEdit(client, appSessionId, 'without_rewinding')}>
              Send without rewinding
            </button>
            <button type="button" className={BUTTON} disabled={locked} onClick={() => keepEditing(appSessionId)}>
              Keep editing
            </button>
          </>
        ) : (
          <>
            {why !== null && <span className="mr-auto text-ui-sm text-fg-muted">{why}</span>}
            <button type="button" className={BUTTON} disabled={locked} onClick={() => cancelInlineEdit(appSessionId)}>
              Cancel
            </button>
            {fork && (
              <button type="button" className={BUTTON} title="Send this in a forked session; this one stays as it is" disabled={locked || status?.process !== 'ready' || empty} onClick={() => void forkInlineEdit(client, appSessionId)}>
                Fork
              </button>
            )}
            <button type="button" className={PRIMARY} title={edit.kind === 'edit' ? 'Rewinds this session to here and sends (⌘Enter)' : 'Sends it as a new message (⌘Enter)'} disabled={locked || why !== null || empty} onClick={send}>
              Send
            </button>
          </>
        )}
      </div>
      {resubmit.state === 'confirming' && <RewindConfirm onConfirm={() => void confirmRewind(client, appSessionId)} onCancel={() => cancelRewind(appSessionId)} />}
    </section>
  );
}

// Asked when a turn began after the edit did: the rewind discards it too.
function RewindConfirm({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <AlertDialog.Content className="fixed top-[24%] left-1/2 z-50 flex w-[min(440px,90vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg">
          <AlertDialog.Title className="m-0 text-ui font-semibold">Rewind past a newer turn?</AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-fg-muted">A newer turn started after you began editing. Rewinding discards it too. Rewind anyway?</AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel className="rounded-sm border border-border px-2 py-0.5 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action className="rounded-sm bg-accent px-2 py-0.5 text-bg outline-accent hover:opacity-90 focus-visible:outline-2" onClick={onConfirm}>
              Rewind anyway
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// The composer dock's line once the rewind hid the edited bubble and the resend still waits: Send (a late-confirmed
// rewind, the human's decision) or Retry (a failed send, never another rewind); × puts the text in the composer instead.
// Both hold while the send is with the host.
export function ResubmitLine({ resubmit, onSend, onLeave }: { resubmit: Resubmit; onSend(): void; onLeave(): void }) {
  const line = lineCopy(resubmit);
  return (
    <div data-edit-mode={resubmit.state} className={`flex w-full min-w-0 items-center gap-1 rounded-md border-l-2 bg-bg-raised px-2.5 py-1 text-ui-sm ${line?.warn ? 'border-warning' : 'border-accent'}`}>
      <span role="status" className={`min-w-0 flex-1 truncate ${line?.warn ? 'text-warning' : 'text-fg-muted'}`}>
        {line?.text}
      </span>
      <button type="button" className={BUTTON} disabled={resubmit.sending} onClick={onSend}>
        {resubmit.sendFailed ? 'Retry' : 'Send'}
      </button>
      <button type="button" aria-label="Leave the edit" title="Leave the edit · your edited text goes into the composer" className={BUTTON} disabled={resubmit.sending} onClick={onLeave}>
        ×
      </button>
    </div>
  );
}
