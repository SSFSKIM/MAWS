// `/fork [prompt]` (UX wave U4a, decision 18; O-48): a panel MAWS draws with nothing to draw. It forks the conversation in
// place through `forkSession`, which opens the fork's tab, with the prompt as the fork's first message when there is
// one. Typed with a prompt it acts through its `apply`, as `/btw <question>` does; picked from the palette or typed bare,
// its component acts and closes, as `/rename`'s does. A refusal is a toast in the host's words, as the session menu's
// Fork shows one. Where U9's helper answers a sentence for the session (another machine), nothing is forked: the typed
// form opens the panel, which says why.
import { useLayoutEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { remoteUnavailableOf, useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { forkSession } from '../sessions/record-ops';
import { toast } from '../stores/notices';
import { WIDGET_TITLE } from './copy';
import type { TypedApply } from './typed';
import { WidgetFrame } from './WidgetFrame';

async function forkConversation(appSessionId: AppSessionId, prompt: string): Promise<void> {
  const text = prompt.trim();
  const answer = await forkSession(appSessionId, { kind: 'inPlace' }, { message: text === '' ? null : { content: text, display: text }, rewindTo: null });
  if (!answer.ok) toast({ level: 'danger', text: answer.error, actions: [], dismissible: true });
}

export const applyFork: TypedApply = async (appSessionId, args) => {
  if (remoteUnavailableOf(appSessionId, 'session.fork') !== null) return false; // the panel opens and says why
  void forkConversation(appSessionId, args);
  return true;
};

export function ForkWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const unavailable = useRemoteUnavailable(appSessionId, 'session.fork');
  // once, on open, before the dialog is drawn: fork and close
  const started = useRef(false);
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    if (unavailable !== null) return;
    close();
    void forkConversation(appSessionId, args);
  });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.fork} command="fork" state="ready" error={null} close={close}>
      {unavailable !== null && (
        <p role="status" className="m-0 text-ui-sm text-fg-muted">
          {unavailable}
        </p>
      )}
    </WidgetFrame>
  );
}
