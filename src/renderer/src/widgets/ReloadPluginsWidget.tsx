// `/reload-plugins` (E11's sitting, owner-notes 00-consolidated-plan §2.2): the engine lists it among the commands it
// runs only in its terminal, so the palette read "Terminal only"; MAWS runs it as its own action over the existing
// `reload_plugins` control (E8's Reload plugins). Choosing it reloads at once under the quiet spinner; when the reload
// answers, a toast says what it did ("Plugins reloaded", with the engine's error count when it has one, or the failure
// in its words) and the dialog closes (word cut P751: the receipt dialog becomes a toast; the dialog stays for the
// moment the reload runs, since a toast-only command would need the composer's widget dispatch). Without a ready
// process the frame offers Load now (P2-A), and nothing is asked of the engine until the owner chooses it.
// P5 O7 M8: for a session on a machine that doesn't offer it (lane-b/remote-unavailable.ts) nothing runs: Reload plugins
// is greyed, its reason beside it.
import { useEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ReloadPluginsResponseSchema } from '@shared/wire/control';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { QuietSpinner } from '../ui/spinner';
import { PLUGIN_MANAGEMENT, RELOAD, WIDGET_TITLE } from './copy';
import { outcomeWords, useOperation } from './operation';
import { TextButton } from './parts';
import { useDormant } from './read';
import { WidgetFrame } from './WidgetFrame';

const toastSummary = (value: unknown): string => {
  const parsed = ReloadPluginsResponseSchema.safeParse(value);
  return RELOAD.pluginsReloaded(parsed.success ? parsed.data.error_count : 0);
};

export function ReloadPluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const { state, unavailable, run } = useOperation(appSessionId, 'session.reloadPlugins');
  const dormant = useDormant(appSessionId); // P2-A: Load now starts the session, and the reload asked for runs at ready
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current || unavailable !== null) return;
    started.current = true;
    void run({});
  }, [ready, unavailable, run]);

  // the first answer, or a refused invoke, is said once as a toast, and the dialog closes
  const said = useRef(false);
  useEffect(() => {
    if (said.current || (state.phase !== 'settled' && state.phase !== 'unsent')) return;
    said.current = true;
    const failed = state.phase === 'unsent' || !state.outcome.ok;
    const text = state.phase === 'unsent' ? state.error : outcomeWords(state.outcome, toastSummary);
    toast({ level: failed ? 'danger' : 'info', text, actions: [], dismissible: true });
    close();
  }, [state, close]);

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE['reload-plugins']} command="reload-plugins" state={dormant?.state ?? 'ready'} error={dormant?.words ?? null} close={close}>
      {unavailable !== null ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <TextButton onClick={() => {}} unavailable={unavailable}>
            {PLUGIN_MANAGEMENT.reloadMods}
          </TextButton>
          <span className="min-w-0 text-ui-sm text-fg-muted">{unavailable}</span>
        </div>
      ) : (
        state.phase === 'working' && <QuietSpinner label={RELOAD.reloading} />
      )}
    </WidgetFrame>
  );
}
