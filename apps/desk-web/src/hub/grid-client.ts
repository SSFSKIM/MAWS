// The registry socket (DX3's grid): `/api/registry/socket`. The hub sends the whole grid on every connection and a
// project's summary whenever it changes, so a reconnect needs no resume: the fresh grid replaces what the browser held.
import type { GridDown, ProjectSummary } from 'desk-hub/protocol';
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

  constructor(options: GridClientOptions) {
    this.socket = new HubSocket<GridDown, never>({
      url: `${options.base}/api/registry/socket`,
      open: () => {},
      frame: (frame) => {
        if (frame.t === 'grid') this.projects = frame.projects;
        else if (frame.t === 'summary') {
          const at = this.projects.findIndex((p) => p.id === frame.project.id);
          this.projects = at < 0 ? [...this.projects, frame.project] : this.projects.with(at, frame.project);
        } else return;
        options.projects(this.projects);
      },
      status: (status) => options.status?.(status),
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
