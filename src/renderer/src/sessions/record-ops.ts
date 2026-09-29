// What the renderer does with a session's record through main's service (C10 execution document, Actions): archive,
// delete, fork, and the tabs that go with a record that leaves. Each answer is returned for the sheet that asked, and
// every refusal is in words.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { DeleteOutcome } from '@shared/ipc/schema/session';
import type { ForkTarget } from '@shared/sessions/intent';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { holderWords } from './holder-words';
import { useSetup } from './store';

const fail = (text: string) => toast({ level: 'danger', text, actions: [], dismissible: true });

export const titleOf = (appSessionId: AppSessionId): string => useSessions.getState().records.get(appSessionId)?.title.text ?? 'this session';

// A record that leaves the sidebar (archived or deleted) takes its tabs along.
export function dropTabs(appSessionId: AppSessionId): void {
  useLayout.getState().dropSession(appSessionId);
}

// `session.archive`: archived, or the refusal in words (a foreign holder; under `onlyIfIdle`, a session live by now).
export async function archiveSession(appSessionId: AppSessionId, opts: { onlyIfIdle?: boolean } = {}): Promise<{ archived: true } | { skipped: string } | { error: string }> {
  const result = await ipc.invoke('session.archive', { appSessionId, ...(opts.onlyIfIdle ? { onlyIfIdle: true } : {}) });
  if (!result.ok) return { error: result.error.message };
  const outcome = result.value;
  if ('archived' in outcome) {
    dropTabs(appSessionId);
    return { archived: true };
  }
  if (outcome.status === 'skipped_live') return { skipped: holderWords(outcome.holder) };
  return { error: `Held by ${holderWords(outcome.holder)}; archive it where it runs` };
}

// `session.delete`: whole or not at all. A delete that finished drops the tabs and any interrupted-delete note; one that
// stopped half-way leaves its manifest, which the session's tab offers to finish.
export async function deleteSession(appSessionId: AppSessionId, stopIfLive: boolean): Promise<DeleteOutcome | { status: 'error'; error: string }> {
  const result = await ipc.invoke('session.delete', { appSessionId, stopIfLive });
  if (!result.ok) return { status: 'error', error: result.error.message };
  if (result.value.status === 'deleted') {
    dropTabs(appSessionId);
    useSetup.getState().setDeletion(appSessionId, null);
  } else if (result.value.status === 'partial') {
    const manifests = await ipc.invoke('session.deletions.list', undefined);
    if (manifests.ok) useSetup.getState().applyDeletions(manifests.value.manifests);
  }
  return result.value;
}

export function deleteOutcomeWords(outcome: DeleteOutcome | { status: 'error'; error: string }): string | null {
  switch (outcome.status) {
    case 'deleted':
      return null;
    case 'held':
      return `Held by ${holderWords(outcome.holder)}; it cannot be deleted while it runs there`;
    case 'live':
      return 'The session is running; stop and delete it';
    case 'stop_unconfirmed':
      return 'The session has not exited yet; try again in a moment';
    case 'partial':
      return `Moved ${outcome.trashed.length} to the Trash; ${outcome.failed.path} could not be moved (${outcome.failed.error}). Finish deleting to move the rest.`;
    case 'error':
      return outcome.error;
  }
}

// `session.fork`: the fork's tab opens as soon as its setup starts; a refusal is in words.
export async function forkSession(appSessionId: AppSessionId, target: ForkTarget): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await ipc.invoke('session.fork', { appSessionId, target, message: null, rewindTo: null });
  if (!result.ok) return { ok: false, error: result.error.message };
  const outcome = result.value;
  const fork = outcome.appSessionId as AppSessionId;
  useSetup.getState().follow(fork); // this window started it: its answer and phases tell its tab what runs
  // a fork into a directory that needs trust, or with the relay down, opens with its card waiting
  if (outcome.status === 'needs_trust') useSetup.getState().dock(fork, { kind: 'trust', trust: outcome.trust, message: null });
  if (outcome.status === 'relay_unreachable') useSetup.getState().dock(fork, { kind: 'relay', health: outcome.health, message: null });
  if (outcome.status === 'starting' || outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') {
    // the tab renders from the fork's intent, which may still be on its way as an event
    const intent = await ipc.invoke('session.intent.get', { appSessionId: fork });
    if (intent.ok && intent.value !== null) useSetup.getState().setIntent(intent.value);
    useSessions.getState().addUnstarted(fork, { projectId: useSessions.getState().records.get(appSessionId)?.projectId ?? null, createdAt: new Date().toISOString() });
    useLayout.getState().openTab({ kind: 'session', appSessionId: fork });
    return { ok: true };
  }
  const error =
    outcome.status === 'invalid' || outcome.status === 'refused'
      ? outcome.message
      : outcome.status === 'missing_directory'
        ? `Directory not found: ${outcome.directory}`
        : `The fork did not start (${outcome.status})`;
  return { ok: false, error };
}

// A session's record: the shell's copy, else (an archived session, which the shell's list leaves out) main's.
export function useRecord(appSessionId: AppSessionId): SessionRecord | null {
  const held = useSessions((s) => s.records.get(appSessionId) ?? null);
  const [fetched, setFetched] = useState<SessionRecord | null>(null);
  useEffect(() => {
    if (held !== null) return;
    let live = true;
    void ipc.invoke('session.get', { appSessionId }).then((result) => {
      if (live && result.ok) setFetched(result.value);
    });
    return () => {
      live = false;
    };
  }, [appSessionId, held]);
  return held ?? (fetched?.appId === appSessionId ? fetched : null);
}

// Fork in place: no sheet.
export async function forkInPlace(appSessionId: AppSessionId): Promise<void> {
  const answer = await forkSession(appSessionId, { kind: 'inPlace' });
  if (!answer.ok) fail(answer.error);
}
