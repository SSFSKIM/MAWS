// P3-H H4: what an HTML artifact's tab keeps of its page's connectors (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 24, 80, 83 to 85; X32's lifetime rule: the header's Connectors action and the sheet it opens
// read this, the tab's own state, never the body's). The ByteViewer's tab state holds one per HTML artifact tab.
//
// - A page load (`attach`, from the frame's port) gets a surface of the window's ArtifactHost relayed to the page's port.
//   The surface starts hidden; only `setVisible`, which the viewer drives from the editor's `visible` and the window's
//   document visibility (never anything the page says), shows or hides it. What the load declared and each tool's latest
//   outcome are kept for the sheet and forgotten at the next load.
// - The owner's grants are read from the store (on mount, on a committed change, after each gesture here); a gesture's
//   refusal is kept for its tool. A declaration never opens the sheet.
// - `needsSession`: some tool of the page found no live route (`paused: noRoute`), so the sheet offers the owner's
//   Start (../../../../artifacts/session-context.ts's policy). Once the session it started is ready, the page's watches
//   are refreshed now rather than at their next interval; a setup that fails, meets a card or is held ends the Start
//   with its words, and the next Start retries the session it named. Nothing here starts a session unasked.
// - P3-HD M3c2 (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 29): with the owner's connector
//   dependency (../../../../artifacts/connector-owner.ts, never the ArtifactHost), the sheet also shows MAWS's own
//   per-server rows. They are read when the sheet opens, again on main's `connectors.serversChanged` for this artifact
//   and after a change of its tools while it is open; an older read answering after a newer one, or after the tab went,
//   is dropped. An owner action is acknowledged at once; the rows are read again then and when main says it ended.
import { createStore } from 'zustand/vanilla';
import type { ArtifactHost, ConnectorSurface } from '@artifacts/host';
import { connectorToolKey, type ConnectorCallOutcome, type ConnectorGrant, type ConnectorGrantMode, type ConnectorRefusal, type ConnectorToolRef } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ConnectorOwnerAck, ConnectorServerRow } from '@shared/ipc/schema/connectors';
import type { ConnectorsOwner } from '../../../../artifacts/connector-owner';
import type { ArtifactSessionContext, ArtifactSessionEnd, ArtifactSessionStart } from '../../../../artifacts/session-context';
import { relayPage, type PagePort, type PageRelay } from './relay';

export type StartView =
  | { phase: 'idle' }
  | { phase: 'asking' } // the gesture's answer not in yet
  | { phase: 'starting' | 'ready'; appSessionId: AppSessionId }
  | { phase: 'card' | 'refused'; appSessionId: AppSessionId | null; words: string };

// P3-HD M3c2: the owner's per-server rows as last read. `failed`: the latest read failed (the rows shown, if any, are
// older); `refused`: an owner action main did not accept, by its target (a source handle or a connection id).
export interface ServersView {
  rows: ConnectorServerRow[] | null; // null until read
  saved: 'ok' | 'unavailable';
  withdrawnUnattributed: boolean;
  failed: boolean;
  refused: { target: string; why: Extract<ConnectorOwnerAck, { accepted: false }>['why'] } | null;
}

export interface ConnectorsView {
  declared: ConnectorToolRef[]; // the current page load's
  last: Readonly<Record<string, ConnectorCallOutcome>>; // by connectorToolKey, the load's latest outcome per tool
  grants: ConnectorGrant[] | null; // null until read
  refusals: Readonly<Record<string, ConnectorRefusal>>; // by tool, the owner's last gesture's refusal
  busy: string | null; // the tool a gesture is in flight for
  needsSession: boolean;
  sheet: boolean;
  start: StartView;
  servers: ServersView; // P3-HD M3c2
  serverBusy: string | null; // P3-HD M3c2: the row an owner action is being acknowledged for
}

export interface ConnectorsTabDeps {
  host: Pick<ArtifactHost, 'openConnectors' | 'connectorGrants' | 'grantConnectorTool' | 'revokeConnectorTool'>;
  startSession(context: ArtifactSessionContext, previous: AppSessionId | null): Promise<ArtifactSessionStart>;
  log?(line: string): void;
  owner?: ConnectorsOwner; // P3-HD M3c2: absent, the sheet shows no server rows (H's engine-only tab)
}

const initialView = (): ConnectorsView => ({
  declared: [], last: {}, grants: null, refusals: {}, busy: null, needsSession: false, sheet: false, start: { phase: 'idle' },
  servers: { rows: null, saved: 'ok', withdrawnUnattributed: false, failed: false, refused: null }, serverBusy: null, // P3-HD M3c2
});

// The sheet's tools: the page load's declared ones first, then the ones the artifact holds a grant for.
export function sheetTools(view: Pick<ConnectorsView, 'declared' | 'grants'>): ConnectorToolRef[] {
  const tools = new Map<string, ConnectorToolRef>();
  for (const tool of view.declared) tools.set(connectorToolKey(tool), tool);
  for (const grant of view.grants ?? []) if (!tools.has(connectorToolKey(grant))) tools.set(connectorToolKey(grant), { server: grant.server, tool: grant.tool });
  return [...tools.values()];
}

// A view that never changes, for a surface with no connectors to subscribe to (a File artifact's tab).
export const NO_CONNECTORS = createStore<ConnectorsView>()(initialView);

const noRoute = (outcome: ConnectorCallOutcome | ConnectorRefusal | undefined) => outcome?.ok === false && outcome.state === 'paused' && outcome.reason === 'noRoute';

export class ConnectorsTab {
  readonly view = createStore<ConnectorsView>()(initialView);
  private page: { relay: PageRelay; surface: ConnectorSurface } | null = null;
  private visible = false;
  private waiting: (() => void) | null = null; // stops listening for the setup of the session a Start started
  private started: AppSessionId | null = null; // the session the last Start named (one it created, retried rather than another)
  private disposed = false;
  private serverReads = 0; // P3-HD M3c2: the latest rows read's serial
  private unlistenServers: (() => void) | null = null; // P3-HD M3c2

  constructor(
    readonly artifactId: string,
    private readonly deps: ConnectorsTabDeps,
  ) {}

  // A page load's port: answers what ends this load's relay (the frame calls it at the next load or its unmount).
  attach(port: PagePort): () => void {
    const surface = this.deps.host.openConnectors(this.artifactId);
    const relay = relayPage(port, surface, {
      declared: (declared) => {
        if (this.page?.relay !== relay) return;
        this.update({ declared });
        if (this.view.getState().sheet) void this.readServers(); // P3-HD M3c2: its tools changed
      },
      outcome: (tool, outcome) => this.page?.relay === relay && this.update({ last: { ...this.view.getState().last, [connectorToolKey(tool)]: outcome } }),
    });
    this.page = { relay, surface };
    this.update({ declared: [], last: {} });
    if (this.visible) surface.setVisible(true);
    return () => {
      relay.dispose();
      if (this.page?.relay === relay) this.page = null;
    };
  }

  // The trusted visibility: the editor's body on screen and the window's document visible.
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.page?.surface.setVisible(visible);
  }

  lastOf(tool: ConnectorToolRef): ConnectorCallOutcome | null {
    return this.view.getState().last[connectorToolKey(tool)] ?? null;
  }

  async readGrants(): Promise<void> {
    try {
      const grants = await this.deps.host.connectorGrants(this.artifactId);
      if (this.disposed) return;
      this.update({ grants });
      if (this.view.getState().sheet) void this.readServers(); // P3-HD M3c2: its tools may have changed
    } catch (error) {
      this.deps.log?.(`the connector grants of ${this.artifactId} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async grant(tool: ConnectorToolRef, mode: ConnectorGrantMode): Promise<void> {
    await this.gesture(tool, async () => {
      const outcome = await this.deps.host.grantConnectorTool(this.artifactId, { server: tool.server, tool: tool.tool, mode });
      return outcome.ok ? null : outcome;
    });
  }

  async revoke(tool: ConnectorToolRef): Promise<void> {
    await this.gesture(tool, async () => {
      await this.deps.host.revokeConnectorTool(this.artifactId, { server: tool.server, tool: tool.tool });
      return null;
    });
  }

  // The owner's Start: the context's session started or resumed, the page's watches refreshed once it is ready. One at
  // a time; a setup that fails, meets a card or is held ends it with its words, and the next Start retries the same
  // session.
  async start(context: ArtifactSessionContext): Promise<void> {
    const { phase } = this.view.getState().start;
    if (phase === 'asking' || phase === 'starting' || this.disposed) return;
    this.update({ start: { phase: 'asking' } });
    let answer: ArtifactSessionStart;
    try {
      answer = await this.deps.startSession(context, this.started);
    } catch (error) {
      answer = { status: 'refused', appSessionId: this.started, words: error instanceof Error ? error.message : String(error) };
    }
    if (this.disposed) {
      if (answer.status === 'starting') answer.cancel();
      return;
    }
    if (answer.appSessionId !== null) this.started = answer.appSessionId;
    if (answer.status !== 'starting') return this.settle(answer);
    this.update({ start: { phase: 'starting', appSessionId: answer.appSessionId } });
    const { cancel } = answer;
    this.waiting = cancel;
    const end = await answer.settled;
    if (this.waiting !== cancel) return; // the tab went meanwhile
    this.waiting = null;
    this.settle(end);
  }

  openSheet(): void {
    this.update({ sheet: true });
    // P3-HD M3c2: the owner's rows, read on opening and again when main says they changed
    const { owner } = this.deps;
    if (!owner || this.disposed) return;
    this.unlistenServers ??= owner.onServersChanged((artifactId) => {
      if (artifactId === this.artifactId && this.view.getState().sheet) void this.readServers();
    });
    void this.readServers();
  }

  // P3-HD M3c2 start: the owner's per-server rows and actions
  get owned(): boolean {
    return this.deps.owner !== undefined;
  }

  async readServers(): Promise<void> {
    const { owner } = this.deps;
    if (!owner || this.disposed) return;
    const serial = ++this.serverReads;
    const current = () => !this.disposed && serial === this.serverReads;
    try {
      const answer = await owner.servers(this.artifactId, sheetTools(this.view.getState()));
      if (!current()) return;
      this.update({ servers: { ...this.view.getState().servers, rows: answer.servers, saved: answer.saved, withdrawnUnattributed: answer.withdrawnUnattributed, failed: false } });
    } catch (error) {
      if (!current()) return;
      this.deps.log?.(`the connector servers of ${this.artifactId} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      this.update({ servers: { ...this.view.getState().servers, failed: true } });
    }
  }

  connectServer(sourceHandle: string): Promise<void> {
    return this.ownerGesture(sourceHandle, (owner) => owner.connect(this.artifactId, sourceHandle));
  }

  reconnectServer(sourceHandle: string): Promise<void> {
    return this.ownerGesture(sourceHandle, (owner) => owner.reconnect(this.artifactId, sourceHandle));
  }

  disconnectServer(connectionId: string): Promise<void> {
    return this.ownerGesture(connectionId, (owner) => owner.disconnect(connectionId));
  }

  private async ownerGesture(target: string, run: (owner: ConnectorsOwner) => Promise<ConnectorOwnerAck>): Promise<void> {
    const { owner } = this.deps;
    if (!owner || this.disposed || this.view.getState().serverBusy !== null) return;
    this.update({ serverBusy: target });
    let ack: ConnectorOwnerAck;
    try {
      ack = await run(owner);
    } catch (error) {
      this.deps.log?.(`a connector server action failed: ${error instanceof Error ? error.message : String(error)}`);
      ack = { accepted: false, why: 'stale' };
    }
    if (this.disposed) return;
    this.update({ serverBusy: null, servers: { ...this.view.getState().servers, refused: ack.accepted ? null : { target, why: ack.why } } });
    await this.readServers();
  }
  // P3-HD M3c2 end

  closeSheet(): void {
    this.update({ sheet: false });
  }

  // The tab went: its page's relay and any wait for a session end.
  dispose(): void {
    this.disposed = true;
    this.unlistenServers?.(); // P3-HD M3c2
    this.unlistenServers = null;
    this.waiting?.();
    this.waiting = null;
    this.page?.relay.dispose();
    this.page = null;
  }

  private settle(end: ArtifactSessionEnd): void {
    if (end.status !== 'ready') return this.update({ start: { phase: end.status, appSessionId: end.appSessionId, words: end.words } });
    this.update({ start: { phase: 'ready', appSessionId: end.appSessionId } });
    this.page?.relay.refreshWatches();
  }

  private async gesture(tool: ConnectorToolRef, run: () => Promise<ConnectorRefusal | null>): Promise<void> {
    const key = connectorToolKey(tool);
    this.update({ busy: key });
    let refusal: ConnectorRefusal | null;
    try {
      refusal = await run();
    } catch (error) {
      this.deps.log?.(`a connector gesture on ${tool.server} · ${tool.tool} failed: ${error instanceof Error ? error.message : String(error)}`);
      refusal = { ok: false, state: 'failed', reason: 'routeFailed' };
    }
    if (this.disposed) return;
    const refusals = { ...this.view.getState().refusals };
    if (refusal === null) delete refusals[key];
    else refusals[key] = refusal;
    this.update({ busy: null, refusals });
    await this.readGrants();
  }

  private update(patch: Partial<ConnectorsView>): void {
    const next = { ...this.view.getState(), ...patch };
    const needsSession = Object.values(next.last).some(noRoute) || Object.values(next.refusals).some(noRoute);
    this.view.setState({ ...patch, needsSession });
  }
}
