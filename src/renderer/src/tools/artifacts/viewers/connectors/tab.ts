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
//   Start (./session-context.ts's policy). Once the session it started is ready, the page's watches are refreshed now
//   rather than at their next interval. Nothing here starts a session unasked.
import { createStore } from 'zustand/vanilla';
import type { ArtifactHost, ConnectorSurface } from '@artifacts/host';
import { connectorToolKey, type ConnectorCallOutcome, type ConnectorGrant, type ConnectorGrantMode, type ConnectorRefusal, type ConnectorToolRef } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionContext, ArtifactSessionStart } from '../../../../artifacts/session-context';
import { relayPage, type PagePort, type PageRelay } from './relay';

export type StartView =
  | { phase: 'idle' }
  | { phase: 'asking' } // the gesture's answer not in yet
  | { phase: 'starting' | 'ready'; appSessionId: AppSessionId }
  | { phase: 'card' | 'refused'; appSessionId: AppSessionId | null; words: string };

export interface ConnectorsView {
  declared: ConnectorToolRef[]; // the current page load's
  last: Readonly<Record<string, ConnectorCallOutcome>>; // by connectorToolKey, the load's latest outcome per tool
  grants: ConnectorGrant[] | null; // null until read
  refusals: Readonly<Record<string, ConnectorRefusal>>; // by tool, the owner's last gesture's refusal
  busy: string | null; // the tool a gesture is in flight for
  needsSession: boolean;
  sheet: boolean;
  start: StartView;
}

export interface ConnectorsTabDeps {
  host: Pick<ArtifactHost, 'openConnectors' | 'connectorGrants' | 'grantConnectorTool' | 'revokeConnectorTool'>;
  startSession(context: ArtifactSessionContext, previous: AppSessionId | null): Promise<ArtifactSessionStart>;
  whenReady(appSessionId: AppSessionId, run: () => void): () => void; // calls `run` once the session's process is ready
  log?(line: string): void;
}

const initialView = (): ConnectorsView => ({ declared: [], last: {}, grants: null, refusals: {}, busy: null, needsSession: false, sheet: false, start: { phase: 'idle' } });

// A view that never changes, for a surface with no connectors to subscribe to (a File artifact's tab).
export const NO_CONNECTORS = createStore<ConnectorsView>()(initialView);

const noRoute = (outcome: ConnectorCallOutcome | ConnectorRefusal | undefined) => outcome?.ok === false && outcome.state === 'paused' && outcome.reason === 'noRoute';

export class ConnectorsTab {
  readonly view = createStore<ConnectorsView>()(initialView);
  private page: { relay: PageRelay; surface: ConnectorSurface } | null = null;
  private visible = false;
  private stopWaiting: (() => void) | null = null;
  private disposed = false;

  constructor(
    readonly artifactId: string,
    private readonly deps: ConnectorsTabDeps,
  ) {}

  // A page load's port: answers what ends this load's relay (the frame calls it at the next load or its unmount).
  attach(port: PagePort): () => void {
    const surface = this.deps.host.openConnectors(this.artifactId);
    const relay = relayPage(port, surface, {
      declared: (declared) => this.page?.relay === relay && this.update({ declared }),
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
      if (!this.disposed) this.update({ grants });
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

  // The owner's Start: the context's session started or resumed, and the page's watches refreshed once it is ready.
  async start(context: ArtifactSessionContext): Promise<void> {
    const current = this.view.getState().start;
    const previous = current.phase === 'idle' || current.phase === 'asking' ? null : current.appSessionId;
    this.update({ start: { phase: 'asking' } });
    this.stopWaiting?.();
    this.stopWaiting = null;
    const answer = await this.deps.startSession(context, previous);
    if (this.disposed) return;
    if (answer.status === 'card' || answer.status === 'refused') return this.update({ start: { phase: answer.status, appSessionId: answer.appSessionId, words: answer.words } });
    if (answer.status === 'ready') return this.ready(answer.appSessionId);
    this.update({ start: { phase: 'starting', appSessionId: answer.appSessionId } });
    this.stopWaiting = this.deps.whenReady(answer.appSessionId, () => this.ready(answer.appSessionId));
  }

  openSheet(): void {
    this.update({ sheet: true });
  }

  closeSheet(): void {
    this.update({ sheet: false });
  }

  // The tab went: its page's relay and any wait for a session end.
  dispose(): void {
    this.disposed = true;
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.page?.relay.dispose();
    this.page = null;
  }

  private ready(appSessionId: AppSessionId): void {
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.update({ start: { phase: 'ready', appSessionId } });
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
