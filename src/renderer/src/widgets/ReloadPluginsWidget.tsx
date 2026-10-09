// `/reload-plugins` (E11's sitting, owner-notes 00-consolidated-plan §2.2): the engine lists it among the commands it
// runs only in its terminal, so the palette read "Terminal only"; MAWS runs it as its own action over the existing
// `reload_plugins` control (E8's Reload plugins). Choosing it reloads at once and the frame says what the reload did
// (`Working…`, then the reload summarised, or the refusal in its words); Reload plugins runs it again. Without a ready
// process the frame says the session is not running and nothing is asked of the engine.
import { useEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { PLUGIN_MANAGEMENT, WIDGET_TITLE } from './copy';
import { TextButton } from './parts';
import { useReloads } from './plugins/reload';
import { WidgetFrame } from './WidgetFrame';

export function ReloadPluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const reloads = useReloads(appSessionId);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    reloads.reloadMods();
  }, [ready, reloads]);

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE['reload-plugins']} command="reload-plugins" state={ready ? 'ready' : 'not_running'} error={null} close={close}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <TextButton onClick={reloads.reloadMods} disabled={reloads.busy}>
          {PLUGIN_MANAGEMENT.reloadMods}
        </TextButton>
        {reloads.line !== null && (
          <span role="status" className={`min-w-0 text-ui-sm ${reloads.failed ? 'text-danger' : 'text-fg-muted'}`}>
            {reloads.line}
          </span>
        )}
      </div>
    </WidgetFrame>
  );
}
