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
//   attach of a target until that target's child detaches, the file chooser and lifecycle events their switches, a
//   binding's calls its `Runtime.addBinding`, tracing its `Tracing.start` until that trace's completion is told.
// - A command is scoped as it is sent, since an enable can emit before it answers, and settled by its own answer through
//   what `willSend` returns: kept, or rolled back if it failed. Send order decides, whatever order the answers come in
//   (neither the RPC dispatcher nor TabDebugger.send orders completions): a switch reads the most recently sent command
//   that set it and has not failed, answered or not. So a disable or stop takes effect at once and an earlier enable
//   answered after it never undoes it. A child's detach and a trace's completion are newer than every command sent
//   before them: an attach or a start still unanswered then never brings its subscription back.
// - A child's detach discards its scope and ends the explicit attach of its target; the lease's end discards every
//   scope.
//
// The scope gates the outgoing notification only: the connection's own bookkeeping (target tracking, `debugger.detached`)
// reads every event.

export interface CuaEventScope {
  // scope provisionally as the command is sent; returns its settlement, called with its answer: kept, or rolled back
  willSend(childSession: string | null, method: string, params: unknown): (ok: boolean) => void;
  admits(childSession: string | null, event: string): boolean; // read before each outgoing notification
  detached(childSession: string, targetId: string | null): void; // the child and its target, from Target.detachedFromTarget
  released(): void; // the lease ended
}

// A switch one command sets; an event is admitted while the switch it reads is on.
type Change = [flag: string, on: boolean];

interface Command {
  seq: number; // its place in send order, the scope's whole
  changes: Change[];
}

interface SessionScope {
  settled: Map<string, { seq: number; on: boolean }>; // per switch, the newest answered command or terminal event
  pending: Command[]; // sent and unanswered, in send order
}

const BINDING = 'binding:';
const ATTACHED = 'attached:'; // an explicit attach, by its target
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
    case 'Target.attachToTarget': {
      const targetId = (params as Record<string, unknown> | null)?.targetId;
      return typeof targetId === 'string' ? [[`${ATTACHED}${targetId}`, true]] : []; // until that target's child detaches
    }
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
      return [['tracing', true]]; // until that trace's completion is told, past Tracing.end
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
  let sent = 0; // the send order, shared by every session's commands and terminal events

  const sessionOf = (child: string | null): SessionScope => {
    let scope = sessions.get(child);
    if (!scope) sessions.set(child, (scope = { settled: new Map(), pending: [] }));
    return scope;
  };

  // The switch as the session reads it now: the most recently sent command or terminal event that set it, answered or not.
  const isOn = (scope: SessionScope, flag: string): boolean => {
    let newest = scope.settled.get(flag) ?? { seq: -1, on: false };
    for (const command of scope.pending) {
      for (const [f, on] of command.changes) if (f === flag && command.seq > newest.seq) newest = { seq: command.seq, on };
    }
    return newest.on;
  };

  // Every switch with a prefix the session has heard of, read as above.
  const anyOn = (scope: SessionScope, prefix: string): boolean => {
    const flags = new Set([...scope.settled.keys(), ...scope.pending.flatMap((command) => command.changes.map(([flag]) => flag))]);
    return [...flags].some((flag) => flag.startsWith(prefix) && isOn(scope, flag));
  };

  // A terminal event: the switch is off from now on, newer than every command sent before it.
  const end = (scope: SessionScope, flag: string) => void scope.settled.set(flag, { seq: ++sent, on: false });

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
        return anyOn(scope, BINDING);
    }
    if (ATTACH_EVENTS.has(event)) return isOn(scope, 'autoAttach') || anyOn(scope, ATTACHED);
    const domain = event.split('.', 1)[0]!;
    if (domain === 'Tracing') {
      const tracing = isOn(scope, 'tracing');
      if (tracing && event === 'Tracing.tracingComplete') end(scope, 'tracing'); // the trace is over, its start answered or not
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
      const command: Command = { seq: ++sent, changes };
      scope.pending.push(command);
      return (ok) => {
        const at = scope.pending.indexOf(command);
        if (at < 0) return; // settled already, or its session discarded
        scope.pending.splice(at, 1);
        if (!ok) return;
        for (const [flag, on] of changes) {
          // an answer settles only what nothing sent later has set since
          if (command.seq > (scope.settled.get(flag)?.seq ?? -1)) scope.settled.set(flag, { seq: command.seq, on });
        }
      };
    },
    admits(child, event) {
      const scope = sessions.get(child);
      return scope !== undefined && admitted(scope, event);
    },
    detached(child, targetId) {
      sessions.delete(child);
      if (targetId !== null) for (const scope of sessions.values()) end(scope, `${ATTACHED}${targetId}`);
    },
    released() {
      sessions.clear();
    },
  };
}
