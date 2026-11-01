// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I; acceptance 3): whether the session's agent
// has a browser on its machine, from the session's capabilities (`session.capabilities`, then each
// `session.capabilitiesChanged`), never from its lane: on the daemon shape `mawsd` offers the agent's browser while a tab
// engine is attached and says why when none is. The Browser tool shows that sentence over its chrome; a machine that
// answers no capabilities (an older `mawsd`) shows nothing, as before.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SessionCapability } from '@shared/ipc/schema/session-capabilities';
import { ipc } from '../../../ipc/client';
import { BROWSER_COPY } from '../copy';

// The session's `browser` entry; null while it is not known (asked, or not answered). A reading is kept with the session
// it is of, so a view that moves to another session shows nothing of the last one's.
export function useAgentBrowser(appSessionId: AppSessionId, client: MawsBridge = ipc): SessionCapability | null {
  const [reading, setReading] = useState<{ appSessionId: AppSessionId; entry: SessionCapability | null } | null>(null);
  useEffect(() => {
    let live = true;
    let heard = false; // this effect heard the session's event: newer than its answer
    const off = client.on('session.capabilitiesChanged', (payload) => {
      if (payload.appSessionId !== appSessionId) return;
      heard = true;
      setReading({ appSessionId, entry: payload.capabilities.browser ?? null });
    });
    void client.invoke('session.capabilities', { appSessionId }).then((result) => {
      if (live && !heard && result.ok) setReading({ appSessionId, entry: result.value.browser ?? null });
    });
    return () => {
      live = false;
      off();
    };
  }, [appSessionId, client]);
  return reading?.appSessionId === appSessionId ? reading.entry : null;
}

export function AgentBrowserNotice({ appSessionId, client = ipc }: { appSessionId: AppSessionId; client?: MawsBridge }) {
  const entry = useAgentBrowser(appSessionId, client);
  if (entry === null || entry.available) return null;
  return (
    <p role="status" data-browser-agent-unavailable="" className="shrink-0 border-b border-border px-3 py-1.5 text-ui-sm text-fg-muted">
      {BROWSER_COPY.agentUnavailable(entry.reason ?? null)}
    </p>
  );
}
