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
// - P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, acceptance 6): on another machine's artifact the
//   rows are that machine's, read and acted on only while both lists hold what they need (../../../../artifacts/
//   remote-surfaces.ts, `SERVER_NEEDS`: the device's `machine-admin` there, and the machine's offer); a greyed sheet says
//   why instead. A refusal there is kept in words (a `busy` acknowledgment, or the machine's own word), never read as a
//   changed row. A declaration the page made that found no lease is kept (`leaseRefused`), so the header can show why
//   when the machine offers no leases. The rows there are read only once the owner asks for them in this opening of the
//   sheet (`askServers`; the architect's ruling): reading them is `machine-admin`, which asks for Touch ID, and a
//   confirmation belongs to a deliberate act, never to opening a sheet. Once shown, nothing reads them again unasked
//   (M5c review 1): what would read this Mac's rows again (main's word, the page's tools, the grants, an owner action, the
//   rights heard again) marks another machine's rows stale (`serversMoved`), and the owner's Refresh reads them, each
//   Refresh a confirmation of its own.
import { createStore } from 'zustand/vanilla';
import type { ArtifactHost, ConnectorSurface } from '@artifacts/host';
import { connectorToolKey, type ConnectorCallOutcome, type ConnectorGrant, type ConnectorGrantMode, type ConnectorRefusal, type ConnectorToolRef } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ConnectorOwnerAck, ConnectorServerRow } from '@shared/ipc/schema/connectors';
import type { ConnectorsOwner } from '../../../../artifacts/connector-owner';
import { artifactMachineOf } from '../../../../artifacts/machines';
import { machineNameOf, remoteGreyedOf, remoteRefusalWords, SERVER_NEEDS } from '../../../../artifacts/remote-surfaces';
import { ArtifactCommandError } from '../../../../artifacts/command-error';
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
  // P5 O7 M5c: `words` (why null), a refusal that was no acknowledgment, as the artifact's machine said it
  refused: { target: string; why: Extract<ConnectorOwnerAck, { accepted: false }>['why'] } | { target: string; why: null; words: string } | null;
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
  leaseRefused: boolean; // P5 O7 M5c: the current load declared a tool and found no lease
  serversAsked: boolean; // P5 O7 M5c: the owner asked for another machine's rows in this opening of the sheet
  serversStale: boolean; // P5 O7 M5c review 1: another machine's rows may have changed since the owner's last read
  refusalWords: Readonly<Record<string, string>>; // P5 O7 M5c: by tool, another machine's refusal of the owner's last gesture, in its words
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
  leaseRefused: false, serversAsked: false, serversStale: false, refusalWords: {}, // P5 O7 M5c
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
        if (this.view.getState().sheet) void this.serversMoved(); // P3-HD M3c2: its tools changed
      },
      outcome: (tool, outcome) => this.page?.relay === relay && this.update({ last: { ...this.view.getState().last, [connectorToolKey(tool)]: outcome } }),
      declareRefused: (outcome) => this.page?.relay === relay && outcome.reason === 'lease' && this.update({ leaseRefused: true }), // P5 O7 M5c
    });
    this.page = { relay, surface };
    this.update({ declared: [], last: {}, leaseRefused: false });
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
      if (this.view.getState().sheet) void this.serversMoved(); // P3-HD M3c2: its tools may have changed
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
      if (artifactId === this.artifactId && this.view.getState().sheet) void this.serversMoved();
    });
    void this.serversMoved();
  }

  // P3-HD M3c2 start: the owner's per-server rows and actions
  get owned(): boolean {
    return this.deps.owner !== undefined;
  }

  /**
   * The rows may have changed (the sheet opened, main's word, the page's tools or the grants, an owner action, the sheet
   * no longer greyed): this Mac's are read again; another machine's are read only on the owner's word (`askServers`), so
   * once shown they are marked stale instead (P5 O7 M5c review 1).
   */
  serversMoved(): Promise<void> {
    if (artifactMachineOf(this.artifactId) === null) return this.readServers();
    if (this.view.getState().serversAsked && !this.disposed) this.update({ serversStale: true });
    return Promise.resolve();
  }

  private async readServers(): Promise<void> {
    const { owner } = this.deps;
    if (!owner || this.disposed || remoteGreyedOf(this.artifactId, SERVER_NEEDS) !== null) return; // P5 O7 M5c: the sheet says why
    const serial = ++this.serverReads;
    const current = () => !this.disposed && serial === this.serverReads;
    try {
      const answer = await owner.servers(this.artifactId, sheetTools(this.view.getState()));
      if (!current()) return;
      this.update({ servers: { ...this.view.getState().servers, rows: answer.servers, saved: answer.saved, withdrawnUnattributed: answer.withdrawnUnattributed, failed: false } });
    } catch (error) {
      if (!current()) return;
      this.deps.log?.(`the connector servers of ${this.artifactId} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      // P5 O7 M5c review 1: another machine's read failed, so its rows (if any) are older, and only Refresh reads again
      this.update({ servers: { ...this.view.getState().servers, failed: true }, ...(artifactMachineOf(this.artifactId) === null ? {} : { serversStale: true }) });
    }
  }

  /**
   * P5 O7 M5c: the owner's explicit read of another machine's rows, for this opening of the sheet: its Show, then each
   * Refresh (review 1). A change heard while it is out leaves them stale.
   */
  askServers(): Promise<void> {
    this.update({ serversAsked: true, serversStale: false });
    return this.readServers();
  }

  connectServer(sourceHandle: string): Promise<void> {
    return this.ownerGesture(sourceHandle, (owner) => owner.connect(this.artifactId, sourceHandle));
  }

  reconnectServer(sourceHandle: string): Promise<void> {
    return this.ownerGesture(sourceHandle, (owner) => owner.reconnect(this.artifactId, sourceHandle));
  }

  disconnectServer(connectionId: string): Promise<void> {
    return this.ownerGesture(connectionId, (owner) => owner.disconnect(this.artifactId, connectionId));
  }

  private async ownerGesture(target: string, run: (owner: ConnectorsOwner) => Promise<ConnectorOwnerAck>): Promise<void> {
    const { owner } = this.deps;
    if (!owner || this.disposed || this.view.getState().serverBusy !== null || remoteGreyedOf(this.artifactId, SERVER_NEEDS) !== null) return;
    this.update({ serverBusy: target });
    let refused: ServersView['refused'];
    try {
      const ack = await run(owner);
      refused = ack.accepted ? null : { target, why: ack.why };
    } catch (error) {
      this.deps.log?.(`a connector server action failed: ${error instanceof Error ? error.message : String(error)}`);
      // P5 O7 M5c: another machine's refusal in its own words (a right it lacks, a cancelled confirmation, the link down)
      const machine = artifactMachineOf(this.artifactId);
      refused = machine !== null && error instanceof ArtifactCommandError ? { target, why: null, words: remoteRefusalWords(error.error, machineNameOf(machine)) } : { target, why: 'stale' };
    }
    if (this.disposed) return;
    this.update({ serverBusy: null, servers: { ...this.view.getState().servers, refused } });
    await this.serversMoved();
  }
  // P3-HD M3c2 end

  closeSheet(): void {
    this.update({ sheet: false, serversAsked: false, serversStale: false }); // P5 O7 M5c: the next opening asks again
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
    let words: string | null = null;
    try {
      refusal = await run();
    } catch (error) {
      this.deps.log?.(`a connector gesture on ${tool.server} · ${tool.tool} failed: ${error instanceof Error ? error.message : String(error)}`);
      refusal = { ok: false, state: 'failed', reason: 'routeFailed' };
      // P5 O7 M5c: another machine's refusal in its own words (a right it lacks, a cancelled confirmation, the link down)
      const machine = artifactMachineOf(this.artifactId);
      if (machine !== null && error instanceof ArtifactCommandError) words = remoteRefusalWords(error.error, machineNameOf(machine));
    }
    if (this.disposed) return;
    const refusals = { ...this.view.getState().refusals };
    if (refusal === null) delete refusals[key];
    else refusals[key] = refusal;
    const refusalWords = { ...this.view.getState().refusalWords };
    if (words === null) delete refusalWords[key];
    else refusalWords[key] = words;
    this.update({ busy: null, refusals, refusalWords });
    await this.readGrants();
  }

  private update(patch: Partial<ConnectorsView>): void {
    const next = { ...this.view.getState(), ...patch };
    const needsSession = Object.values(next.last).some(noRoute) || Object.values(next.refusals).some(noRoute);
    this.view.setState({ ...patch, needsSession });
  }
}
