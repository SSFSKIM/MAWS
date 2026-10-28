// The registry socket (DX3's grid): `/api/registry/socket`. The hub sends the whole grid on every connection and a
// project's summary whenever it changes, so a reconnect needs no resume: the fresh grid replaces what the browser held.
// Each connection is timed from its connecting (or its drop) until its whole grid is in (`latency/latency.ts`).
//
// Once this browser is a `web-cards` device (P5 O13 M3; P5 Decision Log 38) the socket is opened as an app's,
// `?app=1` (OX8): after the grid the hub also sends the org state's head version (`state`, at connect and at each
// accepted state) and every listing it holds (`listings` pages, then a `listing` as each is stored), which go to the
// device's org store and listings store (`app`). The grid is drawn from `grid` and `summary` as before.
import { REGISTRY_APP_PARAM, type ListingFrame, type ListingsFrame, type RegistryAppFrame, type StateNotice } from 'org-protocol';
import type { GridDown, ProjectSummary } from 'desk-hub/protocol';
import { latency } from '../latency/latency';
import { HubSocket, type ConnectionStatus } from './socket';

/** Where an app socket's own frames go. */
export type AppFrames = {
  /** A connection opened: the `listings` pages that follow are the whole set. */
  opened(): void;
  state(frame: StateNotice): void;
  listings(frame: ListingsFrame): void;
  listing(frame: ListingFrame): void;
};

export type GridClientOptions = {
  base: string;
  /** The grid after each frame, in the hub's order; a new project joins the end. */
  projects(projects: ProjectSummary[]): void;
  status?(status: ConnectionStatus): void;
  delay?: (attempt: number) => number;
};

export class GridClient {
  private readonly socket: HubSocket<GridDown | RegistryAppFrame, never>;
  private projects: ProjectSummary[] = [];
  /** When the socket began connecting, until its grid is in. */
  private connecting: number | null = null;
  private app: AppFrames | null = null;
  private started = false;

  constructor(options: GridClientOptions) {
    this.socket = new HubSocket<GridDown | RegistryAppFrame, never>({
      url: () => `${options.base}/api/registry/socket${this.app === null ? '' : `?${REGISTRY_APP_PARAM}=1`}`,
      open: () => this.app?.opened(),
      frame: (frame) => {
        if (frame.t === 'state' || frame.t === 'listings' || frame.t === 'listing') {
          const app = this.app;
          if (app === null) return;
          if (frame.t === 'state') app.state(frame);
          else if (frame.t === 'listings') app.listings(frame);
          else app.listing(frame);
          return;
        }
        if (frame.t === 'grid') {
          this.projects = frame.projects;
          if (this.connecting !== null) latency.record('grid.socket', performance.now() - this.connecting);
          this.connecting = null;
        } else if (frame.t === 'summary') {
          const at = this.projects.findIndex((p) => p.id === frame.project.id);
          this.projects = at < 0 ? [...this.projects, frame.project] : this.projects.with(at, frame.project);
        } else return;
        options.projects(this.projects);
      },
      status: (status) => {
        if (status === 'connecting') this.connecting ??= performance.now();
        options.status?.(status);
      },
      delay: options.delay,
    });
  }

  start(): void {
    this.started = true;
    this.socket.start();
  }

  /** Opens the socket as an app's (`app` given) or as the grid's alone (null), connecting again when that changes. */
  setApp(app: AppFrames | null): void {
    const changed = (app === null) !== (this.app === null);
    this.app = app;
    if (changed && this.started) this.socket.restart();
  }

  stop(): void {
    this.started = false;
    this.socket.stop();
  }
}
