// What a cua lease is told of its tab's CDP events (P5 O17 M2, condition 6 of O5's M7 verdict;
// docs/doperpowers/plans/2026-11-01-p5-o17-browser.md §J): only what its own commands asked for. The tab's attachment is
// shared (debugger.ts): MAWS's focus emulation, an import, a crop or a screencast of another consumer all raise events on
// the one attachment, and unscoped every one of them reached the agent's host (the U3 probe's CDP-source collision
// forwarded 104 to 141 MB to it). One scope per lease, kept per CDP session: the page's own (null) and each child session
// apart, never one set for all.
//
// - `X.enable` admits the X domain's ordinary events and `X.disable` ends them; `DOM.getDocument` turns DOM's on, as
//   Chromium does. An event of a domain with no enable and no rule below is never admitted.
// - What a specialised producer emits follows the lease's own request for it, never its domain's enable: a screencast's
//   frames its `Page.startScreencast` (so `Page.enable` alone never subscribes frames), Fetch interception its
//   `Fetch.enable` (auth challenges only with `handleAuthRequests`), target attach events its auto-attach or an explicit
//   attach, the file chooser and lifecycle events their switches, a binding's calls its `Runtime.addBinding`, tracing its
//   `Tracing.start` until the completion is told.
// - A command is scoped before it is sent, since an enable can emit before it answers, and settles at its answer: kept,
//   or rolled back if it failed. A disable or stop takes effect at once, so nothing after it is forwarded, and is undone
//   if it fails. Commands on one CDP session answer in the order they were sent, so each answer settles that method's
//   oldest unanswered command.
// - A child's detach discards its scope; the lease's end discards every scope.
//
// The scope gates the outgoing notification only: the connection's own bookkeeping (target tracking, `debugger.detached`)
// reads every event.

export interface CuaEventScope {
  willSend(childSession: string | null, method: string, params: unknown): () => void; // scope provisionally; returns the rollback
  answered(childSession: string | null, method: string, ok: boolean): void; // settle or roll back
  admits(childSession: string | null, event: string): boolean; // read before each outgoing notification
  detached(childSession: string): void;
  released(): void; // the lease ended
}

// A switch one command sets; an event is admitted while the switch it reads is on.
type Change = [flag: string, on: boolean];

interface Command {
  method: string;
  changes: Change[];
}

interface SessionScope {
  settled: Map<string, boolean>;
  pending: Command[]; // sent, unanswered, in the order sent
}

const BINDING = 'binding:';
const ATTACH_EVENTS = new Set(['Target.attachedToTarget', 'Target.detachedFromTarget']);

const on = (params: unknown, key: string) => (params as Record<string, unknown> | null)?.[key] === true;
const named = (params: unknown) => {
  const name = (params as Record<string, unknown> | null)?.name;
  return typeof name === 'string' ? name : null;
};

// The switches a command sets, none for a command that subscribes nothing.
function changesOf(method: string, params: unknown): Change[] {
  switch (method) {
    case 'Page.startScreencast':
    case 'Page.stopScreencast':
      return [['screencast', method === 'Page.startScreencast']];
    case 'Page.setInterceptFileChooserDialog':
      return [['fileChooser', on(params, 'enabled')]];
    case 'Page.setLifecycleEventsEnabled':
      return [['lifecycle', on(params, 'enabled')]];
    case 'Target.setAutoAttach':
      return [['autoAttach', on(params, 'autoAttach')]];
    case 'Target.attachToTarget':
      return [['attached', true]]; // its session's events stay told until the lease ends or the child detaches
    case 'Fetch.enable':
      return [['fetch', true], ['fetchAuth', on(params, 'handleAuthRequests')]];
    case 'Fetch.disable':
      return [['fetch', false], ['fetchAuth', false]];
    case 'Runtime.addBinding':
    case 'Runtime.removeBinding': {
      const name = named(params);
      return name === null ? [] : [[`${BINDING}${name}`, method === 'Runtime.addBinding']];
    }
    case 'Tracing.start':
      return [['tracing', true]]; // until its completion is told, past Tracing.end
    case 'DOM.getDocument':
    case 'DOM.getFlattenedDocument':
      return [['domain:DOM', true]];
  }
  const [domain, verb] = method.split('.', 2);
  if (verb === 'enable' || verb === 'disable') return [[`domain:${domain}`, verb === 'enable']];
  return [];
}

export function createEventScope(): CuaEventScope {
  const sessions = new Map<string | null, SessionScope>();

  const sessionOf = (child: string | null): SessionScope => {
    let scope = sessions.get(child);
    if (!scope) sessions.set(child, (scope = { settled: new Map(), pending: [] }));
    return scope;
  };

  // The switch as the session reads it now: settled, then every unanswered command over it in the order sent.
  const isOn = (scope: SessionScope, flag: string): boolean => {
    let value = scope.settled.get(flag) ?? false;
    for (const command of scope.pending) for (const [f, v] of command.changes) if (f === flag) value = v;
    return value;
  };

  const anyBinding = (scope: SessionScope): boolean => {
    const flags = new Set([...scope.settled.keys(), ...scope.pending.flatMap((command) => command.changes.map(([flag]) => flag))]);
    return [...flags].some((flag) => flag.startsWith(BINDING) && isOn(scope, flag));
  };

  // The switch an event reads.
  const admitted = (scope: SessionScope, event: string): boolean => {
    switch (event) {
      case 'Page.screencastFrame':
      case 'Page.screencastVisibilityChanged':
        return isOn(scope, 'screencast');
      case 'Page.fileChooserOpened':
        return isOn(scope, 'fileChooser');
      case 'Page.lifecycleEvent':
        return isOn(scope, 'lifecycle');
      case 'Fetch.requestPaused':
        return isOn(scope, 'fetch');
      case 'Fetch.authRequired':
        return isOn(scope, 'fetchAuth');
      case 'Runtime.bindingCalled':
        return anyBinding(scope);
    }
    if (ATTACH_EVENTS.has(event)) return isOn(scope, 'autoAttach') || isOn(scope, 'attached');
    const domain = event.split('.', 1)[0]!;
    if (domain === 'Tracing') {
      const tracing = isOn(scope, 'tracing');
      if (tracing && event === 'Tracing.tracingComplete') scope.settled.set('tracing', false); // the trace is over: told once
      return tracing;
    }
    if (domain === 'Fetch') return false; // interception's events are the two above
    return isOn(scope, `domain:${domain}`);
  };

  return {
    willSend(child, method, params) {
      const changes = changesOf(method, params);
      if (changes.length === 0) return () => {};
      const scope = sessionOf(child);
      const command: Command = { method, changes };
      scope.pending.push(command);
      return () => {
        const at = scope.pending.indexOf(command);
        if (at >= 0) scope.pending.splice(at, 1);
      };
    },
    answered(child, method, ok) {
      const scope = sessions.get(child);
      const at = scope?.pending.findIndex((command) => command.method === method) ?? -1;
      if (!scope || at < 0) return;
      const [command] = scope.pending.splice(at, 1);
      if (ok) for (const [flag, value] of command!.changes) scope.settled.set(flag, value);
    },
    admits(child, event) {
      const scope = sessions.get(child);
      return scope !== undefined && admitted(scope, event);
    },
    detached(child) {
      sessions.delete(child);
    },
    released() {
      sessions.clear();
    },
  };
}
