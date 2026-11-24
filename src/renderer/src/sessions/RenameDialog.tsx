// Rename, a small sheet as Claude Desktop's (D-20): the field and, for a live session, "Regenerate" through C3's
// `session.generateTitle` (the word cut, W143 and W144, took the lines on whose act named the title and what records the
// new one, and N176 the "Regenerating…" in Regenerate's place, now a quiet spinner beside its word). A live session
// is renamed through the engine (its store carries the title); an exited one gets C4's override, which a later
// terminal `/rename` replaces (C4's title rule).
// The UX wave, U9 (S-02, A10): a session on another machine is renamed there, from its listing alone where this Mac holds
// no record (its title the listing's; no provenance and no Regenerate, which read a record and a tab), and what this window
// did shows in the sidebar at once (the sessions store's `noteRenamed`). While the act can't work there (the window's
// helper) the sheet says why and its Rename is disabled, whenever that begins.
import { useEffect, useState } from 'react';
import type { ContentBlock } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { withoutLinkedReads } from '@shared/maws/linked-read'; // P4-A3: a linked read is not the prompt's words
import { answerOutsideTranscript, personsParts } from '@shared/engine/persons-message'; // the UX wave, ticket 704
import { ipc } from '../ipc/client';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { useSessions } from '../stores/sessions';
import { closeDialog } from './dialogs';
import { onAnotherMachine } from './record-ops';
import { Sheet, SheetForm } from './Sheet';
import { FIELD, PRIMARY, QUIET } from './ui';
import { WaitingWords } from '../ui/spinner';
import { RENAME_WORDS } from './copy';

// What the title summarises: the conversation's first prompt with words from the host's events, else the current title.
// The UX wave, ticket 704: the person's words of a message, MAWS's answer envelopes read out (an older host's message
// can hold them joined to the prompt); a message of answers alone reads as an answer reads outside the transcript
// (ruling A: nothing), and the walk goes on. The content is read as the split reads it, each text block by itself
// (decision 7), and only what is left is flattened, so the title's source is the transcript's.
async function describe(appSessionId: AppSessionId, fallback: string): Promise<string> {
  const events = await ipc.invoke('session.events', { appSessionId, afterSeq: null, limit: 200 });
  if (!events.ok) return fallback;
  for (const event of events.value.events) {
    if (event.kind !== 'user.message' || event.isSynthetic || event.bash !== null) continue;
    const { own, envelopes } = personsParts(event.content);
    const words = own !== null ? textOf(own) : envelopes.map(answerOutsideTranscript).filter(Boolean).join('\n');
    if (words.trim()) return words.trim();
  }
  return fallback;
}

const textOf = (content: string | ContentBlock[]): string =>
  typeof content === 'string' ? content : withoutLinkedReads(content).flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n');

export function RenameDialog({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const listing = useSessions((s) => (record === null ? (s.listed.get(appSessionId) ?? null) : null)); // the UX wave, U9
  const live = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const current = record?.title.text ?? listing?.title ?? '';
  const [title, setTitle] = useState(current);
  const [error, setError] = useState<string | null>(null);
  // Regenerate's wait, from its press (the transcript read, then the receipt, `opId` null until it names the operation)
  // until the operation ends or the request is refused
  const [regenerating, setRegenerating] = useState<{ opId: string | null } | null>(null);
  const unavailable = useRemoteUnavailable(appSessionId, 'session.rename'); // the UX wave, U9: null on this Mac

  const awaited = regenerating?.opId ?? null;
  useEffect(() => {
    if (awaited === null) return;
    return ipc.on('session.operation', (event) => {
      if (event.opId !== awaited) return;
      setRegenerating(null);
      if (event.outcome.ok) {
        const value = event.outcome.value as { title?: unknown };
        if (typeof value.title === 'string') setTitle(value.title);
      } else setError(event.outcome.error.message);
    });
  }, [awaited]);

  if (record === null && listing === null) return null;
  const trimmed = title.trim();

  const submit = async () => {
    const result = await ipc.invoke('session.rename', { appSessionId, title: trimmed });
    if (!result.ok) return setError(result.error.message);
    if (onAnotherMachine(appSessionId)) useSessions.getState().noteRenamed(appSessionId, trimmed);
    closeDialog();
  };
  const regenerate = async () => {
    setError(null);
    setRegenerating({ opId: null });
    const description = await describe(appSessionId, current);
    const receipt = await ipc.invoke('session.generateTitle', { appSessionId, description, persist: true });
    if (!receipt.ok) {
      setRegenerating(null);
      setError(receipt.error.message);
    } else setRegenerating({ opId: receipt.value.opId });
  };

  return (
    <Sheet title="Rename">
      <SheetForm canSubmit={trimmed.length > 0 && trimmed !== current && unavailable === null} onSubmit={() => void submit()} submitLabel="Rename" submitClass={PRIMARY}>
        <input aria-label="Title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
        {record !== null && live && (
          <p className="m-0 flex items-center gap-2 text-ui-sm text-fg-muted">
            <button type="button" disabled={regenerating !== null} aria-busy={regenerating !== null || undefined} onClick={() => void regenerate()} className={QUIET}>
              <WaitingWords words={RENAME_WORDS.regenerate} wait={regenerating === null ? null : RENAME_WORDS.regenerating} />
            </button>
          </p>
        )}
        {unavailable !== null && <p className="m-0 text-ui-sm text-fg-muted">{unavailable}</p>}
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
