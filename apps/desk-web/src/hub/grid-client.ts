// The registry socket (DX3's grid): `/api/registry/socket`. The hub sends the whole grid on every connection and a
// project's summary whenever it changes, so a reconnect needs no resume: the fresh grid replaces what the browser held.
// Each connection is timed from its connecting (or its drop) until its whole grid is in (`latency/latency.ts`).
import type { GridDown, ProjectSummary } from 'desk-hub/protocol';
import { latency } from '../latency/latency';
import { HubSocket, type ConnectionStatus } from './socket';

export type GridClientOptions = {
  base: string;
  /** The grid after each frame, in the hub's order; a new project joins the end. */
  projects(projects: ProjectSummary[]): void;
  status?(status: ConnectionStatus): void;
  delay?: (attempt: number) => number;
};

export class GridClient {
  private readonly socket: HubSocket<GridDown, never>;
  private projects: ProjectSummary[] = [];
  /** When the socket began connecting, until its grid is in. */
  private connecting: number | null = null;

  constructor(options: GridClientOptions) {
    this.socket = new HubSocket<GridDown, never>({
      url: `${options.base}/api/registry/socket`,
      open: () => {},
      frame: (frame) => {
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
    this.socket.start();
  }

  stop(): void {
    this.socket.stop();
  }
}
