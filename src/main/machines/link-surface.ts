// The link surface (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The link surface"): what a
// machine's services answer for another machine's app, as one derived `WireRegistry`. It is the same for the stand-in
// (serve-standin.ts), for O3's `mawsd` and for O7's channels.
//
// - Commands: every command whose route class is not `client` (src/shared/ipc/routes.ts), and no `internal` one (main's
//   own, which no caller holds), each presented with owner `machine` and its own schemas.
// - Events: the link events, whose payload names a session, a pty or a path in a session's checkout, or reports the
//   machine's engine or pty host. Every other event is the app's own until the child that spans its surface moves it.
//   `ownerChannel.changed` is a link event: its payload names its session (`appSessionId`).
//
// Main-owned schemas cross the link outside the wire manifest (the O6 document's Constraints, "The wire"), so a link joins
// two profiles of one build; cross-build machine links come when O3 brings the moved namespaces into the manifest.
import { gradeOf } from '@shared/ipc/grades';
import { REGISTRY, type WireRegistry } from '@shared/ipc/registry';
import { routeOf } from '@shared/ipc/routes';
import type { CommandName, EventName } from '@shared/ipc/schema';

// Each event is placed by one rule: a namespace (`session.*`) or one name. link-surface.test.ts holds the two sides to a
// partition of the registry's events, so a new event lands on the side its author chose.
const LINK_RULES = {
  namespaces: ['session', 'fs'],
  names: ['attention.changed', 'engine.hostState', 'pty.hostState', 'pty.data', 'pty.exit', 'git.changed', 'files.changed', 'scm.remote.output', 'ownerChannel.changed'],
};
const CLIENT_RULES = {
  // `maws.*` are the host-to-app bridges, which the machine's own app answers
  namespaces: ['layout', 'voice', 'browser', 'maws', 'settings', 'catalog', 'connectors', 'delivery', 'library', 'spaces', 'artifacts', 'plugins', 'machines', 'org'],
  names: ['attention.navigate', 'attention.notified', 'engine.budget', 'host.status', 'host.supervisorStatus'],
};

const placedBy = (rules: { namespaces: string[]; names: string[] }) => (name: string) => rules.names.includes(name) || rules.namespaces.includes(name.slice(0, name.indexOf('.')));
const eventNames = Object.keys(REGISTRY.events) as EventName[];
export const LINK_EVENTS: readonly EventName[] = eventNames.filter(placedBy(LINK_RULES));
export const CLIENT_EVENTS: readonly EventName[] = eventNames.filter(placedBy(CLIENT_RULES));

// Whether a command crosses a machine link.
export function onLink(name: string): boolean {
  if (!Object.hasOwn(REGISTRY.commands, name) || REGISTRY.mainOnly.has(name)) return false;
  return routeOf(name as CommandName) !== 'client' && gradeOf(name) !== 'internal';
}

export const LINK_REGISTRY: WireRegistry = {
  commands: Object.fromEntries(
    Object.entries(REGISTRY.commands)
      .filter(([name]) => onLink(name))
      .map(([name, spec]) => [name, { ...spec, owner: 'machine' as const }]),
  ),
  events: Object.fromEntries(LINK_EVENTS.map((name) => [name, REGISTRY.events[name]])),
  hostEvents: [],
  mainOnly: new Set(),
};
