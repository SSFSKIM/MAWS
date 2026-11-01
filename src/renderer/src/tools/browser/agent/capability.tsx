// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I; acceptance 3): whether the session's agent
// has a browser on its machine, from the session's capabilities (`session.capabilities`, then each
// `session.capabilitiesChanged`), never from its lane: on the daemon shape `mawsd` offers the agent's browser while a tab
// engine is attached and says why when none is. The Browser tool shows that sentence over its chrome; a machine that
// answers no capabilities (an older `mawsd`) shows nothing, as before.
// The panel's scalpel-4#1: a machine's link replays no event it missed while it was away, so the reading is asked again
// whenever the session's machine is back: another machine's link up as a new generation (`machines.changed`), the local
// machine's host heard (`host.status`, main's at each ready of its daemon). A refused asking is asked again there too.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SessionCapability } from '@shared/ipc/schema/session-capabilities';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { BROWSER_COPY } from '../copy';

// The session's machine link as far as asking goes: the generation it is up as, null while it is not up. The local
// machine (and one the roster does not name) is up for the app's life: its returns are its host's (`host.status`).
function useLinkGeneration(appSessionId: AppSessionId): number | null {
  const machine = machineOf(appSessionId);
  return useMachines((state) => {
    const link = state.machines.get(machine);
    if (link === undefined || link.local) return 0;
    return link.state === 'up' ? link.generation : null;
  });
}

// How often the session's machine's host has been heard (`host.status`): each a return to ask again at.
function useHostHeard(appSessionId: AppSessionId, client: MawsBridge): number {
  const [heard, setHeard] = useState(0);
  const machine = machineOf(appSessionId);
  useEffect(() => client.on('host.status', (_status, from) => void (from.machine === machine && setHeard((n) => n + 1))), [client, machine]);
  return heard;
}

// The session's `browser` entry; null while it is not known (asked, or not answered). A reading is kept with the session
// it is of, so a view that moves to another session shows nothing of the last one's.
export function useAgentBrowser(appSessionId: AppSessionId, client: MawsBridge = ipc): SessionCapability | null {
  const [reading, setReading] = useState<{ appSessionId: AppSessionId; entry: SessionCapability | null } | null>(null);
  const generation = useLinkGeneration(appSessionId);
  const hostHeard = useHostHeard(appSessionId, client);
  useEffect(() => {
    let live = true;
    let heard = false; // this effect heard the session's event: newer than its answer
    const off = client.on('session.capabilitiesChanged', (payload) => {
      if (payload.appSessionId !== appSessionId) return;
      heard = true;
      setReading({ appSessionId, entry: payload.capabilities.browser ?? null });
    });
    // while the link is down nothing is asked: the reading stands as last known, and is asked for at the return
    if (generation !== null)
      void client.invoke('session.capabilities', { appSessionId }).then((result) => {
        if (live && !heard && result.ok) setReading({ appSessionId, entry: result.value.browser ?? null });
      });
    return () => {
      live = false;
      off();
    };
  }, [appSessionId, client, generation, hostHeard]);
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
