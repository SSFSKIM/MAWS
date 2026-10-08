// One cua host's connection to an app session's socket (the in-app browser spec of 2026-10-08, "The MAWS primitive
// server"; P1 A-51, A-52): the extension protocol's primitives served over MAWS's TabStore and each tab's TabDebugger.
// Everything here is per connection: the integer tab ids (minted 1, 2, … and never reused), the leases, the commands in
// flight, the auto-attached children and the group badges. What crosses connections, which tabs are reserved or leased
// to whom, lives in `TabClaims`.
//
// - A connection reaches its app session's tabs and its parent's (P-24); any other id answers Chrome's `No tab with id`.
// - `debugger.attach` takes a lease on the tab's TabDebugger. A tab reserved to another live connection, or leased to
//   one, is refused (`Tab is held by another agent session`): one automation owner per tab. `{targetId}` names a child the tab's auto-attach announced: recorded, no second attachment.
// - `debugger.sendCommand` passes through the filter (filter.ts). `Target.closeTarget` and `Page.close` close the tab
//   through the store, for a tab reserved to this connection only: a person's tab is never closed by a primitive.
// - Each command is held until its reply, and cancelled (`Command cancelled: <why>`) at its deadline, when its tab is
//   detached, closed or destroyed, or when the connection closes.
// - Letting go of a lease (detach, the host's timeout detach, disconnect) first undoes every persistent toggle the
//   connection switched on, so a shared attachment (MAWS's focus emulation) never keeps the agent's state.
//
// - (M3) What the person sees and keeps (presence.ts): an acting command passes the takeover gate before it is sent and
//   makes the tab the agent's; the cursor follows `cursor.move`; letting go returns the tab to idle and hides the cursor.
//   What the agent did is told to the windows (activity.ts); a lease's first acting command tells them
//   `browser.agent.acting`, which opens the session's Browser panel as E4c's tools did (the tab is not selected: the
//   owner's choice for agent tabs; P1 A-54, amended); a tab created through the connection carries the panel's
//   badge (its group's title, else "agent") until the connection lets it go; the agent's downloads are reported to the
//   host as Chrome's would be.
//
// Secrets: params, page content and typed text never reach a log line; errors name methods and tab ids only.
import type { Socket } from 'node:net';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_AGENT_BADGE_MAX_CHARS } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import { personHolds } from '../agent/control';
import type { DebuggerLease, TabDebugger } from '../debugger';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { TabClaims } from './claims';
import { agentCapture, clickLabel, commandActivity, LABEL_LOOKUP_MS, navigatedUrl, within, type ActivityFeed } from './activity';
import { commandClass, noteToggle, noToggles, methodNotAllowed, routeCommand, undoCommands, type AgentToggles } from './filter';
import { createPeer, frameDecoder, type Peer, type RpcHandler } from './framing';
import type { AgentPresence } from './presence';

export const PROTOCOL_VERSION = 1; // cua's src/chrome/extension.mjs PROTOCOL_VERSION
export const PROFILE_NAME = 'MAWS';
export const MAX_FROM_HOST_BYTES = 1024 * 1024; // cua's MAX_TO_EXTENSION_BYTES
export const MAX_TO_HOST_BYTES = 64 * 1024 * 1024; // cua's MAX_FROM_EXTENSION_BYTES
export const DEFAULT_COMMAND_MS = 10_000; // the host's DEFAULT_CDP_TIMEOUT_MS, for a command that carries no deadline
export const RESET_BOUND_MS = 1_000; // the undo of the agent's toggles never holds a release longer
export const DEFAULT_GROUP_TITLE = 'cua'; // the host's name for a session's group until the agent names it
export const AGENT_BADGE = 'agent'; // the panel's badge on an agent tab whose group has no name of its own

export const ERRORS = {
  noTab: (tabId: unknown) => `No tab with id: ${String(tabId)}`,
  noTarget: 'No target with given id found',
  noSession: 'No session with given id',
  notAttached: (tabId: unknown) => `Debugger is not attached to the tab with id: ${String(tabId)}.`,
  targetNotAttached: (targetId: unknown) => `Debugger is not attached to the target with id: ${String(targetId)}.`,
  heldElsewhere: 'Tab is held by another agent session',
  notOwned: 'Tab is not owned by this agent session',
  notLoaded: (tabId: unknown) => `Tab ${String(tabId)} could not be loaded`,
  cancelled: (why: string) => `Command cancelled: ${why}`,
} as const;

export interface ServerContext {
  store: Pick<TabStore, 'all' | 'entry' | 'list' | 'open' | 'close' | 'load' | 'update'>;
  claims: TabClaims<CuaConnection>;
  windows(): { id: number; focused: boolean }[];
  reaches(appSessionId: AppSessionId, tabSessionId: AppSessionId): boolean;
  version: string;
  log(line: string): void;
  presence: AgentPresence | null; // M3: control, takeover and the cursor (null: the bare server's tests)
  feed: ActivityFeed | null; // M3: what the agent did, to the windows
  emit: BrowserEmit | null; // the final fix wave: `browser.agent.acting`, to the windows
}

interface Child {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

interface Leased {
  entry: TabEntry;
  dbg: TabDebugger;
  lease: DebuggerLease;
  toggles: AgentToggles;
  children: Map<string, Child>; // by child session id, from the tab's auto-attach
  byTarget: Set<string>; // children the host attached by target id
  stops: (() => void)[];
  closing: boolean; // letting go: no new command is taken
  awaitingFrame: boolean; // the agent's screencast started on the page, its first frame (the screenshot's row) not yet seen
  acted: boolean; // an acting command arrived through this lease: the windows were told `browser.agent.acting`
  released: Promise<void> | null; // the letting go under way, which a new attach waits for
}

interface Held {
  tabId: string;
  cancel(why: string): void;
  closesItsTab?: boolean; // the command closing its own tab: the tab's going never cancels it
}

interface Group {
  id: number;
  title: string;
}

type Record_ = { id: number; windowId: number; url: string; title: string; active: boolean; groupId: number; status: 'loading' | 'complete' };

class PrimitiveError extends Error {
  readonly code = 1;
}
const fail = (message: string): never => {
  throw new PrimitiveError(message);
};

export class CuaConnection {
  private readonly peer: Peer;
  private readonly ids = new Map<number, string>(); // integer → MAWS tab id
  private readonly idsOf = new Map<string, number>(); // MAWS tab id → integer
  private nextId = 1;
  private readonly leases = new Map<string, Leased>();
  private readonly held = new Set<Held>();
  private readonly groups = new Map<string, Group>(); // group key → its id and title
  private readonly groupOf = new Map<string, number>(); // MAWS tab id → group id
  private readonly sentState = new Map<string, string>(); // MAWS tab id → the last tabs.updated told
  private closed = false;

  constructor(
    private readonly ctx: ServerContext,
    readonly appSessionId: AppSessionId,
    private readonly socket: Socket,
    private readonly onClosed: (connection: CuaConnection) => void,
  ) {
    const decode = frameDecoder(MAX_FROM_HOST_BYTES);
    this.peer = createPeer({ send: (frame) => void socket.write(frame), handlers: this.handlers(), maxFrameBytes: MAX_TO_HOST_BYTES });
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const message of decode(chunk)) this.peer.receive(message);
      } catch (error) {
        ctx.log(`a cua host sent an unreadable frame on ${appSessionId}'s socket; closing it: ${(error as Error).message}`);
        socket.destroy();
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => this.close());
    this.peer.notify('hello', { extensionId: 'maws', extensionInstanceId: `maws:${appSessionId}`, version: ctx.version, protocolVersion: PROTOCOL_VERSION, profileName: PROFILE_NAME });
  }

  get heldCount(): number {
    return this.held.size;
  }

  leasedTabs(): string[] {
    return [...this.leases.keys()];
  }

  disconnect(): void {
    this.socket.destroy();
  }

  // ---- what the store tells every connection -------------------------------------------------------------------------

  // The tab is gone (closed, its session removed): the host forgets it.
  tabRemoved(tabId: string): void {
    const leased = this.leases.get(tabId);
    if (leased) this.lost(leased);
    this.cancelHeld(tabId, 'tab closed');
    const id = this.idsOf.get(tabId);
    this.sentState.delete(tabId);
    this.groupOf.delete(tabId);
    if (id !== undefined) this.notify('tabs.removed', { tabId: id });
  }

  // A download the agent started on a tab this connection leases (cua/downloads.ts), in Chrome's shape.
  downloadCreated(download: { id: number; url: string; finalUrl: string; filename: string }): void {
    this.notify('downloads.created', { ...download, state: 'in_progress' });
  }

  downloadChanged(change: { id: number; filename: string; state: 'complete' | 'interrupted'; error?: string }): void {
    this.notify('downloads.changed', change);
  }

  // An activity on one of this connection's tabs, in its session's transcript.
  tell(entry: TabEntry, activity: Parameters<ActivityFeed['tell']>[2]): void {
    this.ctx.feed?.tell(this.appSessionId, entry.tab.tabId, activity);
  }

  // A tab changed: a committed URL, a title or its loading state, told for tabs the host has seen.
  tabUpdated(entry: TabEntry): void {
    const id = this.idsOf.get(entry.tab.tabId);
    if (id === undefined || !this.reachable(entry)) return;
    const status = entry.tab.loading ? 'loading' : 'complete';
    const state = JSON.stringify([entry.tab.url, entry.tab.title, status]);
    if (this.sentState.get(entry.tab.tabId) === state) return;
    this.sentState.set(entry.tab.tabId, state);
    this.notify('tabs.updated', { tabId: id, url: entry.tab.url, title: entry.tab.title, status });
  }

  // A page this connection drives opened a window MAWS adopted as a tab: it is this connection's, announced by id.
  adopted(opener: TabEntry, child: TabEntry): void {
    if (this.closed || !this.leases.has(opener.tab.tabId) || this.idsOf.has(child.tab.tabId)) return;
    this.ctx.claims.reserve(child.tab.tabId, this);
    const group = this.groupOf.get(opener.tab.tabId);
    if (group !== undefined) this.join(child.tab.tabId, group); // the opener's badge: the agent's page opened it
    const url = child.tab.url || 'about:blank';
    this.notify('tabs.adopted', { openerTabId: this.idOf(opener.tab.tabId), tabId: this.idOf(child.tab.tabId), url });
    this.tell(child, { kind: 'tabOpened', url });
  }

  // ---- the primitives ------------------------------------------------------------------------------------------------

  private handlers(): Record<string, RpcHandler> {
    return {
      'tabs.query': () => this.reachableEntries().map((entry) => this.record(entry)),
      'tabs.get': ({ tabId }) => this.record(this.tab(tabId)),
      'tabs.create': ({ url, group }) => this.create(url, group),
      'tabs.remove': ({ tabId }) => {
        const entry = this.tab(tabId);
        if (this.ctx.claims.reservedTo(entry.tab.tabId) !== this) fail(ERRORS.notOwned);
        this.closeTab(entry);
        return {};
      },
      'tabs.ungroup': ({ tabId }) => {
        const entry = this.tab(tabId);
        if (this.groupOf.delete(entry.tab.tabId)) this.badge(entry.tab.tabId, null);
        return {};
      },
      // Electron's debugger has no "another extension's frame" refusal: nothing to sweep
      'tabs.guard': ({ tabId }) => (this.tab(tabId), {}),
      'tabs.unguard': ({ tabId }) => (this.tab(tabId), {}),
      'group.title': ({ key, title }) => (this.retitle(key, title), {}),
      'windows.query': () => this.ctx.windows().map(({ id, focused }) => ({ id, focused, type: 'normal' })),
      // an agent tab always lives in its session's panel: the window that shows it is answered, none is created
      'windows.create': () => ({ id: this.windowId(null) }),
      'debugger.attach': (debuggee) => this.attach(debuggee),
      'debugger.detach': (debuggee) => this.detach(debuggee),
      'debugger.sendCommand': (params) => this.sendCommand(params),
      'debugger.getTargets': () => this.inventory(),
      // the pointer where the agent aims, on a tab this connection leases (a cursor nobody's lease would hide is never drawn)
      'cursor.move': ({ tabId, x, y }) => {
        const entry = this.tab(tabId);
        const leased = this.leases.get(entry.tab.tabId);
        if (leased && !leased.closing && typeof x === 'number' && typeof y === 'number') this.ctx.presence?.cursorMove(entry, x, y);
        return {};
      },
      hostRefused: ({ code }) => void this.ctx.log(`cua's host refused MAWS on ${this.appSessionId}'s socket: ${String(code)}`),
    };
  }

  private create(url: unknown, group: unknown): Record_ {
    const target = typeof url === 'string' && url !== '' ? url : 'about:blank';
    if (target !== 'about:blank' && !validateBrowserUrl(target).ok) fail(`Invalid url: only http and https pages open in MAWS`);
    const { tab } = this.ctx.store.open({ appSessionId: this.appSessionId, url: target, select: false });
    this.ctx.claims.reserve(tab.tabId, this);
    const { key, title } = (typeof group === 'object' && group !== null ? group : {}) as { key?: unknown; title?: unknown };
    if (typeof key === 'string') this.join(tab.tabId, this.groupFor(key, typeof title === 'string' ? title : null).id);
    const entry = this.ctx.store.entry(tab.tabId)!;
    this.tell(entry, { kind: 'tabOpened', url: target });
    return this.record(entry);
  }

  // ---- groups and the panel's badge ----------------------------------------------------------------------------------

  private groupFor(key: string, title: string | null): Group {
    let group = this.groups.get(key);
    if (!group) this.groups.set(key, (group = { id: this.groups.size + 1, title: title ?? DEFAULT_GROUP_TITLE }));
    return group;
  }

  private join(tabId: string, groupId: number): void {
    this.groupOf.set(tabId, groupId);
    const group = [...this.groups.values()].find((candidate) => candidate.id === groupId);
    this.badge(tabId, badgeText(group?.title ?? DEFAULT_GROUP_TITLE));
  }

  // `group.title`: the host names the session's group (the vendor's nameSession); every tab in it shows the name.
  private retitle(key: unknown, title: unknown): void {
    if (typeof key !== 'string' || typeof title !== 'string') return;
    const group = this.groupFor(key, title);
    group.title = title;
    for (const [tabId, groupId] of this.groupOf) if (groupId === group.id) this.badge(tabId, badgeText(title));
  }

  private badge(tabId: string, agentBadge: string | null): void {
    if (this.ctx.store.entry(tabId)?.tab.agentBadge !== agentBadge && this.ctx.store.entry(tabId)) this.ctx.store.update(tabId, { agentBadge });
  }

  private async attach(debuggee: Record<string, unknown>): Promise<unknown> {
    if (typeof debuggee.targetId === 'string') {
      const owner = this.childOwner(debuggee.targetId);
      if (!owner) fail(ERRORS.noTarget);
      owner!.byTarget.add(debuggee.targetId);
      return {};
    }
    const entry = this.tab(debuggee.tabId);
    const tabId = entry.tab.tabId;
    // a lease still being let go (its undo bounded by RESET_BOUND_MS, the window a host's timeout falls in) is not held:
    // the attach waits for that release, then takes a fresh lease
    const releasing = this.leases.get(tabId);
    if (releasing?.closing) {
      await releasing.released;
      return this.attach(debuggee);
    }
    if (this.leases.has(tabId)) return { alreadyHeld: true };
    this.refuseHeld(entry);
    if (!entry.view && entry.tab.url !== '') this.ctx.store.load(tabId, entry.tab.url); // a suspended tab resumes, as Chrome reloads a discarded one
    const dbg = entry.debugger;
    if (!entry.view || !dbg) fail(ERRORS.notLoaded(debuggee.tabId));
    const lease = await dbg!.lease();
    const stale = this.closed || this.ctx.store.entry(tabId) !== entry || entry.debugger !== dbg || this.leases.has(tabId);
    if (stale || this.ctx.claims.heldByOther(tabId, this)) {
      lease.release();
      if (stale && this.leases.has(tabId)) return { alreadyHeld: true };
      this.refuseHeld(entry);
      fail(ERRORS.notLoaded(debuggee.tabId));
    }
    const leased: Leased = { entry, dbg: dbg!, lease, toggles: noToggles(), children: new Map(), byTarget: new Set(), stops: [], closing: false, awaitingFrame: false, acted: false, released: null };
    leased.stops.push(
      dbg!.on('*', (params, sessionId, method) => this.forward(leased, params, sessionId, method)),
      dbg!.onDetach(() => {
        if (this.leases.get(tabId) === leased) this.lost(leased);
      }),
    );
    this.leases.set(tabId, leased);
    this.ctx.claims.lease(tabId, this);
    return { alreadyHeld: false };
  }

  private async detach(debuggee: Record<string, unknown>): Promise<unknown> {
    if (typeof debuggee.targetId === 'string') {
      const owner = [...this.leases.values()].find((leased) => leased.byTarget.has(debuggee.targetId as string));
      if (!owner) fail(ERRORS.targetNotAttached(debuggee.targetId));
      owner!.byTarget.delete(debuggee.targetId);
      return {};
    }
    const entry = this.tab(debuggee.tabId);
    const leased = this.leases.get(entry.tab.tabId);
    if (!leased || leased.closing) fail(ERRORS.notAttached(debuggee.tabId));
    await this.letGo(leased!, 'detached');
    return {};
  }

  private async sendCommand(params: Record<string, unknown>): Promise<unknown> {
    const { debuggee, sessionId, method, timeoutMs } = params as { debuggee?: { tabId?: unknown; targetId?: unknown }; sessionId?: unknown; method?: unknown; timeoutMs?: unknown };
    const commandParams = typeof params.params === 'object' && params.params !== null ? (params.params as Record<string, unknown>) : {};
    if (typeof method !== 'string') return fail('debugger.sendCommand requires a method');
    const { leased, session } = this.debuggeeOf(debuggee, sessionId);
    const deadline = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_COMMAND_MS;
    switch (routeCommand(method)) {
      case 'refuse':
        return fail(methodNotAllowed(method));
      case 'getTargets':
        return { targetInfos: this.inventory() };
      case 'closeTarget': {
        const closing = this.closingTarget(commandParams.targetId);
        return this.hold(closing, deadline, true, async (self) => this.closePage(closing, self));
      }
      case 'target':
        this.checkTarget(leased, method, commandParams);
        break;
      case 'pass':
        if (method === 'Page.close') {
          this.ownedPage(leased);
          return this.hold(leased, deadline, true, async (self) => this.closePage(leased, self));
        }
    }
    const sent = method === 'Target.attachToTarget' ? { ...commandParams, flatten: true } : commandParams;
    const acting = commandClass(method) === 'acting';
    if (acting) this.acting(leased);
    return this.hold(leased, deadline, acting, async (self) => {
      // an agent's screenshot, a capture or the screencast the vendor's starts with, never carries the cursor's overlay
      // (presence.ts, activity.ts `agentCapture`); a command cancelled meanwhile is not sent
      if (agentCapture(method, commandParams) && this.ctx.presence) {
        await this.ctx.presence.beforeCapture(leased.entry);
        if (!this.held.has(self)) return {};
      }
      if (session === '') noteToggle(leased.toggles, method, commandParams);
      this.observe(leased, method, commandParams, session);
      return leased.dbg.send(method, sent, session || undefined);
    });
  }

  // What a command the agent sends on the page's own session did, for the windows: a press is told once its node is
  // named (looked up through this lease, before the press reaches the page, hit-testing as the press does: an element
  // with pointer-events none, the agent cursor's own overlay among them, is not what it clicked), typed characters as a
  // count. The agent's screencast screenshot is told at its first frame (`forward`), so a start that yields none and the
  // vendor's fallback capture after it are one row.
  private observe(leased: Leased, method: string, params: Record<string, unknown>, session: string): void {
    if (session !== '' || !this.ctx.feed) return;
    if (method === 'Page.startScreencast' || method === 'Page.stopScreencast') {
      leased.awaitingFrame = agentCapture(method, params);
      return;
    }
    const activity = commandActivity(method, params);
    if (!activity) return;
    const { entry, dbg } = leased;
    switch (activity.kind) {
      case 'typed':
        return this.ctx.feed.typed(this.appSessionId, entry.tab.tabId, activity.chars);
      case 'press': {
        const { x, y } = activity;
        const node = dbg.send('DOM.getNodeForLocation', { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: false });
        node.catch(() => {});
        const label = within(clickLabel((m, p) => dbg.send(m, p), node), LABEL_LOOKUP_MS);
        return this.tell(entry, label.then((named) => ({ kind: 'clicked' as const, x, y, label: named })));
      }
      default:
        return this.tell(entry, activity);
    }
  }

  // A lease's first acting command arrived (closing a tab is not one: it never comes here): the windows open the
  // session's Browser panel, as E4c's tools had them do, before the takeover gate, as E4c's pause point came after it.
  // The tab is not selected, so the panel shows the session's selection, the person's tab when they hold one.
  private acting(leased: Leased): void {
    if (leased.acted) return;
    leased.acted = true;
    const { appSessionId, tabId } = leased.entry.tab;
    this.ctx.emit?.('browser.agent.acting', { appSessionId, tabId, actingSessionId: this.appSessionId });
  }

  // The debuggee's lease and the CDP session the command goes to ('' for the page's own).
  private debuggeeOf(debuggee: { tabId?: unknown; targetId?: unknown } | undefined, sessionId: unknown): { leased: Leased; session: string } {
    if (typeof debuggee?.targetId === 'string') {
      const targetId = debuggee.targetId;
      const leased = [...this.leases.values()].find((candidate) => candidate.byTarget.has(targetId));
      if (!leased || leased.closing) return fail(ERRORS.targetNotAttached(targetId));
      const session = [...leased.children].find(([, child]) => child.targetId === targetId)?.[0];
      if (session === undefined) return fail(ERRORS.targetNotAttached(targetId));
      return { leased, session };
    }
    const entry = this.tab(debuggee?.tabId);
    const leased = this.leases.get(entry.tab.tabId);
    if (!leased || leased.closing) return fail(ERRORS.notAttached(debuggee?.tabId));
    if (sessionId === undefined || sessionId === null || sessionId === '') return { leased, session: '' };
    if (typeof sessionId !== 'string' || !leased.children.has(sessionId)) return fail(ERRORS.noSession);
    return { leased, session: sessionId };
  }

  // Target methods are kept within the tab: its own page target and the children its auto-attach announced.
  private checkTarget(leased: Leased, method: string, params: Record<string, unknown>): void {
    const targetId = params.targetId;
    const known = (id: unknown) => typeof id === 'string' && (id === this.pageTargetId(leased.entry) || [...leased.children.values()].some((child) => child.targetId === id));
    if (method === 'Target.attachToTarget' && !(typeof targetId === 'string' && [...leased.children.values()].some((child) => child.targetId === targetId))) fail(ERRORS.noTarget);
    if (method === 'Target.getTargetInfo' && targetId !== undefined && !known(targetId)) fail(ERRORS.noTarget);
  }

  // One command, held until its reply; cancelled at its deadline or by its tab or the connection going. An acting command
  // first passes the takeover gate (presence.ts), which may hold it while the person has the tab and refuse it at the
  // bound; it is sent only once the gate opens and nothing cancelled it meanwhile.
  // `run` is given the command's own hold, so the command that closes its tab is not cancelled by the tab's going.
  private hold(leased: Leased, deadline: number, acting: boolean, run: (self: Held) => Promise<unknown>): Promise<unknown> {
    const { entry } = leased;
    const presence = acting ? this.ctx.presence : null;
    return new Promise((resolve, reject) => {
      const gate = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      const settle = (answer: () => void) => {
        if (!this.held.delete(held)) return;
        clearTimeout(timer);
        answer();
      };
      const held: Held = {
        tabId: entry.tab.tabId,
        cancel: (why) => {
          if (!this.held.has(held)) return;
          settle(() => reject(new PrimitiveError(ERRORS.cancelled(why))));
          gate.abort(new Error(why));
        },
      };
      this.held.add(held);
      timer = setTimeout(() => held.cancel('deadline'), deadline);
      let marked = false;
      const sent = (async () => {
        if (presence) {
          await presence.beforeActing(entry, deadline, gate.signal);
          marked = true;
        }
        gate.signal.throwIfAborted(); // cancelled while it waited: never sent
        return run(held);
      })();
      sent
        .then(
          (result) => settle(() => resolve(result ?? {})),
          (error: unknown) => settle(() => reject(new PrimitiveError(error instanceof Error ? error.message : String(error)))),
        )
        .finally(() => {
          if (marked) presence!.acted(entry);
        });
    });
  }

  // The vendor's tab.close() sends Target.closeTarget whenever it knows the target id: the leased page it names, which
  // must be this connection's own (closing is acting: it waits out the person like any other action).
  private closingTarget(targetId: unknown): Leased {
    const leased = [...this.leases.values()].find((candidate) => targetId === this.pageTargetId(candidate.entry) || targetId === syntheticTargetId(candidate.entry));
    if (!leased) return fail(ERRORS.noTarget);
    this.ownedPage(leased);
    return leased;
  }

  private ownedPage(leased: Leased): void {
    if (this.ctx.claims.reservedTo(leased.entry.tab.tabId) !== this) fail(ERRORS.notOwned);
  }

  private closePage(leased: Leased, self: Held): unknown {
    this.ownedPage(leased);
    self.closesItsTab = true;
    this.closeTab(leased.entry);
    return { success: true };
  }

  // Closes a tab of this connection's: its commands cancelled and its lease dropped first (the page is going, so nothing
  // is undone), then the store closes it; `tabs.removed` follows from the store.
  private closeTab(entry: TabEntry): void {
    const leased = this.leases.get(entry.tab.tabId);
    if (leased) this.unregister(leased);
    this.cancelHeld(entry.tab.tabId, 'tab closed');
    leased?.lease.release();
    if (leased) this.ctx.presence?.released(entry);
    this.tell(entry, { kind: 'tabClosed', url: liveUrl(entry) });
    if (this.ctx.store.entry(entry.tab.tabId) === entry) this.ctx.store.close(entry.tab.tabId);
  }

  // ---- events --------------------------------------------------------------------------------------------------------

  private forward(leased: Leased, params: unknown, sessionId: string, method: string): void {
    if (this.leases.get(leased.entry.tab.tabId) !== leased) return;
    const p = (params ?? {}) as { sessionId?: unknown; targetInfo?: { targetId?: unknown; type?: unknown; title?: unknown; url?: unknown } };
    if (sessionId === '' && method === 'Target.attachedToTarget' && typeof p.sessionId === 'string' && typeof p.targetInfo?.targetId === 'string') {
      const info = p.targetInfo;
      leased.children.set(p.sessionId, { targetId: info.targetId as string, type: String(info.type ?? 'other'), title: String(info.title ?? ''), url: String(info.url ?? '') });
    }
    if (sessionId === '' && method === 'Page.frameNavigated') this.navigated(leased.entry, params);
    if (sessionId === '' && method === 'Page.screencastFrame' && leased.awaitingFrame) {
      leased.awaitingFrame = false;
      this.tell(leased.entry, { kind: 'screenshot' });
    }
    const tabId = this.idOf(leased.entry.tab.tabId);
    this.notify('debugger.event', { debuggee: { tabId }, ...(sessionId ? { sessionId } : {}), method, params });
    const child = sessionId ? leased.children.get(sessionId) : undefined;
    if (child && leased.byTarget.has(child.targetId)) this.notify('debugger.event', { debuggee: { targetId: child.targetId }, method, params });
    if (sessionId === '' && method === 'Target.detachedFromTarget' && typeof p.sessionId === 'string') {
      const gone = leased.children.get(p.sessionId);
      leased.children.delete(p.sessionId);
      if (gone && leased.byTarget.delete(gone.targetId)) this.notify('debugger.detached', { debuggee: { targetId: gone.targetId }, reason: 'target_closed' });
    }
  }

  // A committed navigation of the leased page, for the windows; not the person's own: while control's `personHolds` is
  // true (the tab is `human`, or they touched it within the hand-back window), as the takeover gate decides.
  private navigated(entry: TabEntry, params: unknown): void {
    const url = navigatedUrl(params);
    if (url === null || url === 'about:blank' || personHolds(entry, Date.now())) return;
    this.tell(entry, { kind: 'navigated', url, title: '' });
  }

  // The attachment ended under the lease (the page closed, crashed or was suspended): the host hears target_closed and
  // re-attaches when it needs the tab again.
  private lost(leased: Leased): void {
    this.unregister(leased);
    this.ctx.presence?.released(leased.entry);
    this.ctx.feed?.flush(leased.entry.tab.tabId);
    this.cancelHeld(leased.entry.tab.tabId, 'tab detached');
    const id = this.idsOf.get(leased.entry.tab.tabId);
    for (const targetId of leased.byTarget) this.notify('debugger.detached', { debuggee: { targetId }, reason: 'target_closed' });
    if (id !== undefined) this.notify('debugger.detached', { debuggee: { tabId: id }, reason: 'target_closed' });
  }

  // ---- letting go ----------------------------------------------------------------------------------------------------

  // The agent lets go of the tab: what it held is cancelled, what it switched on is undone (bounded), then the lease is
  // released; the attachment ends only when no other lease remains.
  private letGo(leased: Leased, why: string): Promise<void> {
    leased.released ??= this.release(leased, why);
    return leased.released;
  }

  private async release(leased: Leased, why: string): Promise<void> {
    leased.closing = true;
    this.cancelHeld(leased.entry.tab.tabId, why);
    const undo = undoCommands(leased.toggles, { mawsFocusEmulation: leased.dbg.heldBy('focus') });
    if (undo.length > 0 && leased.dbg.attached) {
      const sends = Promise.allSettled(undo.map(([method, params]) => leased.dbg.send(method, params)));
      await Promise.race([sends, new Promise((resolve) => setTimeout(resolve, RESET_BOUND_MS))]);
    }
    if (this.leases.get(leased.entry.tab.tabId) !== leased) return; // the attachment ended meanwhile
    this.unregister(leased);
    leased.lease.release();
    this.ctx.presence?.released(leased.entry);
    this.ctx.feed?.flush(leased.entry.tab.tabId);
  }

  private unregister(leased: Leased): void {
    const tabId = leased.entry.tab.tabId;
    if (this.leases.get(tabId) !== leased) return;
    this.leases.delete(tabId);
    for (const stop of leased.stops.splice(0)) stop();
    this.ctx.claims.unlease(tabId, this);
  }

  private cancelHeld(tabId: string | null, why: string): void {
    for (const held of [...this.held]) if ((tabId === null || held.tabId === tabId) && !(held.closesItsTab && why === 'tab closed')) held.cancel(why);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelHeld(null, 'disconnected');
    this.ctx.claims.dropReservations(this);
    for (const tabId of this.groupOf.keys()) this.badge(tabId, null); // its tabs are the person's now
    const letting = [...this.leases.values()].map((leased) => this.letGo(leased, 'disconnected'));
    this.peer.close();
    void Promise.allSettled(letting).then(() => this.onClosed(this));
  }

  // ---- reading tabs --------------------------------------------------------------------------------------------------

  private reachable(entry: TabEntry): boolean {
    return this.ctx.reaches(this.appSessionId, entry.tab.appSessionId);
  }

  private reachableEntries(): TabEntry[] {
    return this.ctx.store.all().filter((entry) => this.reachable(entry));
  }

  // The tab an integer id names, when this connection reaches it.
  private tab(tabId: unknown): TabEntry {
    const mawsId = typeof tabId === 'number' ? this.ids.get(tabId) : undefined;
    const entry = mawsId === undefined ? undefined : this.ctx.store.entry(mawsId);
    if (!entry || !this.reachable(entry)) return fail(ERRORS.noTab(tabId));
    return entry;
  }

  // The tab's integer id in this connection, minted at first sight.
  private idOf(mawsId: string): number {
    let id = this.idsOf.get(mawsId);
    if (id === undefined) {
      id = this.nextId++;
      this.idsOf.set(mawsId, id);
      this.ids.set(id, mawsId);
    }
    return id;
  }

  private record(entry: TabEntry): Record_ {
    const { tabId, appSessionId, title, loading } = entry.tab;
    return {
      id: this.idOf(tabId),
      windowId: this.windowId(entry),
      url: liveUrl(entry),
      title,
      active: this.ctx.store.list(appSessionId).selected[appSessionId] === tabId,
      groupId: this.groupOf.get(tabId) ?? -1,
      status: loading ? 'loading' : 'complete',
    };
  }

  private windowId(entry: TabEntry | null): number {
    if (entry?.host && !entry.host.isDestroyed()) return entry.host.id;
    const windows = this.ctx.windows();
    return (windows.find((w) => w.focused) ?? windows[0])?.id ?? 0;
  }

  // The page target of a tab is its main frame's id while attached (Chromium's own), else a stable stand-in.
  private pageTargetId(entry: TabEntry): string {
    return entry.debugger?.mainFrameId ?? syntheticTargetId(entry);
  }

  // `debugger.getTargets`: the reachable tabs' pages and the children their auto-attach announced to this connection;
  // never a MAWS shell renderer, the import's temporary view or a DevTools target.
  private inventory(): unknown[] {
    const out: unknown[] = [];
    for (const entry of this.reachableEntries()) {
      if (!entry.view) continue;
      const tabId = this.idOf(entry.tab.tabId);
      out.push({ targetId: this.pageTargetId(entry), type: 'page', title: entry.tab.title, url: liveUrl(entry), attached: this.leases.has(entry.tab.tabId), tabId });
      for (const child of this.leases.get(entry.tab.tabId)?.children.values() ?? []) out.push({ ...child, attached: true, tabId });
    }
    return out;
  }

  private childOwner(targetId: string): Leased | undefined {
    return [...this.leases.values()].find((leased) => !leased.closing && [...leased.children.values()].some((child) => child.targetId === targetId));
  }

  private refuseHeld(entry: TabEntry): void {
    if (this.ctx.claims.heldByOther(entry.tab.tabId, this)) fail(ERRORS.heldElsewhere);
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    try {
      this.peer.notify(method, params);
    } catch (error) {
      this.ctx.log(`could not tell cua's host ${method} on ${this.appSessionId}'s socket: ${(error as Error).message}`);
    }
  }
}

const syntheticTargetId = (entry: TabEntry) => `maws-page-${entry.tab.tabId}`;

// The badge a group's tabs show: the name the agent gave its session, else "agent" (the host's default name means
// nothing to the person).
function badgeText(title: string): string {
  const name = title.replace(/\s+/g, ' ').trim();
  return name === '' || name === DEFAULT_GROUP_TITLE ? AGENT_BADGE : [...name].slice(0, BROWSER_AGENT_BADGE_MAX_CHARS).join('');
}

// The URL the page shows now (Chrome's tab.url), else the one the store kept.
function liveUrl(entry: TabEntry): string {
  const contents = entry.view?.webContents;
  const live = contents && !contents.isDestroyed() ? contents.getURL() : '';
  return live || entry.tab.url || 'about:blank';
}
