// The machine's default route as Settings › Gateway reads and chooses it (P5 O7 M9, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "The default, without a v2"; Interfaces §U `machine-route.json`). The renderer's
// `settings.*` carries only the legacy field (`gateway.defaultRoute`, two routes), so the resolved default and its choice
// go through this machine's own `machineSettings.*`, whose answers carry `defaultRoute` from M9 on: absent, the daemon
// predates the machine route and acts on the legacy field alone, which the legacy control still writes. Choosing a route
// writes `machine-route.json` and the legacy field together on the daemon (an older build there keeps reading a valid
// file); this page never writes the legacy field for it.
import { useEffect, useState } from 'react';
import type { Route } from '@shared/engine/route';
import type { MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { GATEWAY } from './copy';

/** A machine's resolved default route (this machine's unless one is named: a session's is its own machine's); null when
 *  its daemon predates the machine route or the read failed. */
export async function readDefaultRoute(client: MawsBridge = ipc, machine: MachineRef = client.localMachine): Promise<Route | null> {
  const result = await client.invoke('machineSettings.get', undefined, { machine });
  if (!result.ok) {
    console.warn('[settings] machineSettings.get failed', result.error);
    return null;
  }
  return result.value.defaultRoute ?? null;
}

/** `machine`'s resolved default route, read once per mount and machine: undefined until the read answers, null when
 *  its daemon predates the machine route or the read failed (the legacy control's signal). A session's consumer names the
 *  session's machine (`machineOf`): another machine's tab runs on that machine's daemon and default. */
export function useResolvedDefaultRoute(machine: MachineRef, client: MawsBridge = ipc): Route | null | undefined {
  const [read, setRead] = useState<{ machine: MachineRef; route: Route | null } | null>(null);
  useEffect(() => {
    let live = true;
    void readDefaultRoute(client, machine).then((route) => live && setRead({ machine, route }));
    return () => {
      live = false;
    };
  }, [client, machine]);
  return read !== null && read.machine === machine ? read.route : undefined;
}

/** Whether `machine`'s daemon honours the machine route (its `machineSettings.get` answers a `defaultRoute`); null until
 *  the read answers. */
export function useMachineRouteHonoured(machine: MachineRef, client: MawsBridge = ipc): boolean | null {
  const route = useResolvedDefaultRoute(machine, client);
  return route === undefined ? null : route !== null;
}

/** Chooses the machine's default route; a daemon that answers without one dropped the choice. */
export async function chooseDefaultRoute(route: Route, client: MawsBridge = ipc): Promise<{ ok: true; route: Route } | { ok: false; error: string }> {
  const result = await client.invoke('machineSettings.set', { patch: {}, defaultRoute: route }, { machine: client.localMachine });
  if (!result.ok) return { ok: false, error: result.error.message };
  return result.value.defaultRoute === undefined ? { ok: false, error: GATEWAY.routeDropped } : { ok: true, route: result.value.defaultRoute };
}
