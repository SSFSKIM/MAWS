// `/rewind`, and Esc Esc on an empty composer while no turn runs (W3, B7; charter §5.4 as amended 2026-10-01): the
// terminal's rewind picker as a floating dialog. The session's own messages, newest first (the transcript's human
// prompts), and what to rewind to before the chosen one: the conversation (`session.rewind`, with the newest message
// the transcript shows as the seen cursor, pass2/rewind seq 41-42), its files (`session.rewindFiles`, the file
// checkpoint, pass3/rewind-files seq 141-142), or both (`session.rewind` with `files`). Files only while the session
// checkpoints them: without it `rewind_files` answers "File rewinding is not enabled." (pass2/rewind seq 38). After a
// conversation rewind the composer holds the engine's `prefillText`, the chosen message's text, as the Edit path does;
// the transcript hides the rewound turns from C3's boundary. Nothing is issued while a turn runs.
import { useState } from 'react';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { prefillComposer } from '../composer';
import { newestUserUuid, type UserRow } from '../composer/edit-prefill';
import { typedFromRowText } from '../composer/editor/recall';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../transcript';
import { REWIND, WIDGET_TITLE } from './copy';
import { useDormant } from './read';
import { WidgetFrame } from './WidgetFrame';

type What = 'conversation' | 'files' | 'both';
const WHAT: readonly What[] = ['conversation', 'files', 'both'];
const NO_ROWS: readonly unknown[] = [];
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

// The human's own prompts, newest first.
export function rewindTargets(rows: readonly { kind: string }[]): (UserRow & { messageUuid: MessageUuid })[] {
  return (rows as UserRow[]).filter((r): r is UserRow & { messageUuid: MessageUuid } => r.kind === 'user' && r.messageUuid !== null && r.editable && !r.pending).reverse();
}

export function RewindWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const dormant = useDormant(appSessionId); // P2-A: a rewind needs the engine; Load now starts it
  const rows = useTranscriptStore((s) => (s.entries[appSessionId]?.rows ?? NO_ROWS) as readonly { kind: string }[]);
  const targets = rewindTargets(rows);
  const [picked, pick] = useState<MessageUuid | null>(null);
  const [what, setWhat] = useState<What>('conversation');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const target = targets.find((t) => t.messageUuid === picked) ?? targets[0] ?? null;
  const checkpointing = status?.fileCheckpointing ?? false;
  const running = status !== null && (status.turn !== null || status.engineState === 'running');
  const why = running ? REWIND.busy : null;

  const rewind = async () => {
    if (!target || busy || why !== null) return;
    setBusy(true);
    setRefusal(null);
    try {
      if (what === 'files') {
        const result = await ipc.invoke('session.rewindFiles', { appSessionId, userMessageUuid: target.messageUuid, dryRun: false });
        if (!result.ok) return setRefusal(result.error.message);
        if (!result.value.ok) return setRefusal(result.value.message ?? REWIND.filesRefused);
        toast({ level: 'info', text: REWIND.filesDone, actions: [], dismissible: true });
        return close();
      }
      const lastSeen = newestUserUuid(useTranscriptStore.getState().rows(appSessionId) as UserRow[]) ?? target.messageUuid;
      const result = await ipc.invoke('session.rewind', { appSessionId, targetMessageUuid: target.messageUuid, lastSeenMessageUuid: lastSeen, files: what === 'both' });
      if (!result.ok) return setRefusal(result.error.message);
      if (!result.value.rewound) return setRefusal(REWIND.refused(result.value.reason ?? result.value.error ?? REWIND.noReason));
      if (result.value.prefillText !== null) prefillComposer(appSessionId, { text: result.value.prefillText });
      const files = result.value.files;
      if (files !== null && !files.canRewind) toast({ level: 'warning', text: REWIND.filesNotRestored(files.error ?? REWIND.noReason), actions: [], dismissible: true });
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.rewind} command="rewind" state={dormant?.state ?? 'ready'} error={dormant?.words ?? null} close={close}>
      <div className="flex flex-col gap-3">
        {targets.length === 0 ? (
          <p className="m-0 text-fg-muted">{REWIND.none}</p>
        ) : (
          <div role="radiogroup" aria-label={REWIND.messages} className="flex max-h-72 flex-col overflow-y-auto">
            {targets.map((row) => (
              <button
                key={row.messageUuid}
                type="button"
                role="radio"
                aria-checked={row.messageUuid === target?.messageUuid}
                onClick={() => pick(row.messageUuid)}
                className="flex w-full min-w-0 items-baseline gap-3 rounded-sm px-2 py-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-checked:bg-bg-active"
              >
                <span className="min-w-0 flex-1 truncate">{typedFromRowText(row.text).split('\n')[0]}</span>
                <span className="shrink-0 text-ui-sm text-fg-faint">{TIME.format(Date.parse(row.at))}</span>
              </button>
            ))}
          </div>
        )}
        <div role="radiogroup" aria-label={REWIND.what} className="flex gap-1">
          {WHAT.map((option) => {
            const off = option !== 'conversation' && !checkpointing;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === what}
                disabled={off}
                title={off ? REWIND.noCheckpoints : undefined}
                onClick={() => setWhat(option)}
                className="flex-1 rounded-sm border border-border px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-checked:bg-bg-active"
              >
                {REWIND.option[option]}
              </button>
            );
          })}
        </div>
        {!checkpointing && <p className="m-0 text-ui-sm text-fg-muted">{REWIND.noCheckpoints}</p>}
        <p className="m-0 text-ui-sm text-fg-muted">{REWIND.consequence}</p>
        <div className="flex items-center justify-end gap-2">
          {why !== null && <span className="mr-auto text-ui-sm text-fg-muted">{why}</span>}
          <button
            type="button"
            disabled={busy || target === null || why !== null}
            onClick={() => void rewind()}
            className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
          >
            {REWIND.rewind}
          </button>
        </div>
        {refusal && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {refusal}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
