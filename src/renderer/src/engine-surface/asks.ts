// The engine's requests to MAWS as its desktop surface, answered by this window (R2; the waves plan's R2 rulings): a
// plugin's `$.ui.copy` writes the clipboard and says "Copied"; its `$.prompt.read`, `$.prompt.fill` and
// `$.prompt.suggest` read, fill and suggest through the composer of the session, as a pane of this window shows it (the
// composer's prompt port, stores/composer.ts). A session shown with no composer mounted refuses at once; one no pane of
// this window shows is left to the host, which refuses for it just inside the engine's 5 s. Live batches only: a
// snapshot never answers a request twice.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SurfaceAnswer } from '@shared/engine/surface';
import type { MawsBridge } from '@shared/ipc/schema';
import { shownHere } from '../app/plugin-toasts';
import { ipc } from '../ipc/client';
import { useComposerStore } from '../stores/composer';
import { toast } from '../stores/notices';

export const ASK_COPY = { copied: 'Copied' };

type Ask = Extract<SessionEvent, { kind: 'plugin.ask' }>;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// The answer this window gives, or null when the request is not this window's to answer.
async function answerOf(appSessionId: AppSessionId, ask: Ask): Promise<SurfaceAnswer | null> {
  if (ask.ask === 'copy') {
    const copied = await copy(ask.text ?? '');
    if (copied) toast({ id: `plugin-copy:${ask.id}`, level: 'info', text: ASK_COPY.copied, actions: [], dismissible: true, durationMs: 2000 });
    return { ask: 'copy', copied };
  }
  if (!shownHere(appSessionId)) return null;
  const prompt = useComposerStore.getState().focusTargets.get(appSessionId)?.prompt;
  switch (ask.ask) {
    case 'prompt_read':
      return { ask: 'prompt_read', ...(prompt?.read() ?? { text: '', cursor: 0 }) };
    case 'prompt_fill':
      return { ask: 'prompt_fill', filled: prompt?.fill(ask.text ?? '', ask.mode ?? 'replace') ?? false };
    case 'prompt_suggest':
      return { ask: 'prompt_suggest', shown: prompt?.suggest(ask.text ?? '') ?? false };
  }
}

export function connectSurfaceAsks(client: MawsBridge = ipc): () => void {
  return client.on('session.eventBatch', ({ appSessionId, events }) => {
    for (const event of events) {
      if (event.kind !== 'plugin.ask') continue;
      void answerOf(appSessionId as AppSessionId, event).then(async (answer) => {
        if (answer === null) return;
        const result = await client.invoke('session.ui.answer', { appSessionId, requestId: event.requestId, answer });
        if (!result.ok) console.warn(`[engine-surface] ${event.ask} not answered: ${result.error.message}`);
      });
    }
  });
}
