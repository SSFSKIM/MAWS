// One of `mawsd`'s relay sockets (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The relays" and "The
// departure drains both hops, in order"): `engine-host.sock` or `pty-host.sock`, serving one app at a time through the
// socket layer (a second welcome replaces the first, as a supervisor's does), with the host `mawsd` reaches as its
// upstream (the host supervisor's `owner`).
//
// - The handshake reflects the upstream (`admitHello`): once the upstream is connected, the app is welcomed with its facts
//   (its pid, start, build, minor, live counts, and its capabilities with `mawsd`'s), so main's crash detection by pid,
//   its update banner and Diagnostics read the host, as they do today. While the upstream waits for an incompatible host
//   still running sessions, the app gets that host's refusal line as received. While the upstream is starting (a parked
//   host woken by this hello), the hello waits until it is connected or HELLO_HOLD_MS pass, then the connection closes
//   unanswered: the hold spans the app's whole start budget, so the app reads it as a start attempt that got no answer
//   (its transport's start failure), not as a retry within the same budget.
// - Requests are forwarded raw (`forward`), and their answers come back as received, so a field this build does not
//   know passes through; the daemon intercepts what it must (`intercept`). Events reach the app from its own `ready` on,
//   as received (`deliver`, from the supervisor's `onRaw`).
// - The departure: at the app's FIN (a half-open server, the engine relay only) or its close, no more of its requests
//   are taken; with `drain`, the upstream's draining close starts and every event the host wrote before it saw that end
//   is still forwarded to the app, until the upstream has closed or `boundMs` passed; only then is the app's side ended.
//   What arrives past it is counted in one log line.
import { SOCKET_PROTOCOL, type ServerRefuse } from '@shared/host/socket-protocol';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { DocPortEnd, HostPort } from '@shared/host/runtime';
import type { Admission, ServedRuntime, SocketClients } from '@shared/host/socket-server';
import type { HostDoc, HostResponse } from '@shared/ipc/host-protocol';
import { WIRE_CAPABILITIES } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';

export const HELLO_HOLD_MS = 15_000; // a hello waits this long for its upstream to connect: the app's whole start budget (the architect's ruling)
export const DEPARTURE_BOUND_MS = 500; // inside main's 1 s draining-close grace (CLOSE_GRACE_MS), which does not change

export type RelayOwner = 'engine-host' | 'pty-host';

export interface RelayRequest {
  id: string;
  name: string;
  input: unknown;
  client?: string;
}

export interface RelayOptions {
  owner: RelayOwner;
  hosts: HostSupervisor;
  log(line: string): void;
  startedAt(pid: number): string; // the upstream's start, as its lock recorded it
  intercept?(request: RelayRequest): Promise<HostResponse> | null; // a request the daemon answers itself; null forwards it
  onDocument?(message: HostDoc, end: DocPortEnd): void; // a document channel the app opened; without it, closed at once
  onExit(when: 'now' | 'idle', refused: boolean): void; // an `exit` line from the app
  attached(): void; // an app was welcomed, before anything is forwarded to it
  ready(): void; // its `ready` line
  departed(): void; // it left (its FIN or its close, whichever came first), once
  drain?: { start(drained: () => void): void; boundMs?: number }; // the upstream's draining close (the engine relay)
  holdMs?: number;
  between?(): void; // `between()` may have changed
}

interface App {
  port: HostPort;
  ready: boolean;
  leaving: boolean; // its end was seen: none of its requests is taken
  gone: boolean; // its side is ended (or it closed): nothing more reaches it
  lost: number; // events that came for it after it was gone, during its drain
}

export class Relay implements ServedRuntime {
  private current: App | null = null;
  private departing: App | null = null;
  private clients: SocketClients | null = null;
  private admitting = 0; // hellos waiting on their admission

  constructor(private readonly options: RelayOptions) {}

  // The server serving this relay, so a departure can end the app's side.
  bind(clients: SocketClients): void {
    this.clients = clients;
  }

  attachedApp(): boolean {
    return this.current !== null;
  }

  // An app between its socket and `attachedApp` (P5 Decision Log 124: mawsd's quiet): a hello waiting on its admission
  // (a parked host woken for it), or a departed app whose side its drain has not ended yet.
  between(): boolean {
    return this.admitting > 0 || (this.departing !== null && !this.departing.gone);
  }

  // The upstream link ended under an attached app (a crash, a quiet loss): its connection closes too, so main reads the
  // host's pid again, as it does when the supervisor's own socket closes.
  dropApp(why: string): void {
    if (!this.current) return;
    this.options.log(`closing the app's connection: ${why}`);
    this.clients?.closeClient();
  }

  // --- the socket layer's admission (socket-server.ts `admitHello`) ----------------------------------------------------
  async admit(): Promise<Admission> {
    this.admitting += 1;
    this.options.between?.();
    try {
      return await this.admission();
    } finally {
      this.admitting -= 1;
      this.options.between?.();
    }
  }

  private async admission(): Promise<Admission> {
    const { hosts, owner } = this.options;
    const answered = () => {
      const { state } = hosts.snapshot(owner);
      return (state === 'ready' && hosts.welcome(owner) !== null) || hosts.refusal(owner) !== null || (state === 'crashed' && !hosts.parked(owner));
    };
    if (hosts.parked(owner)) hosts.wake(owner); // on demand: the app's hello is a need
    else if (owner === 'engine-host' && hosts.snapshot(owner).state === 'crashed' && hosts.refusal(owner) === null && hosts.facts(owner).reason !== 'held_lock') {
      // crashed for good (its crash limit): an app attaching asks for it again, as the banner's Restart now would
      void hosts.restartSupervisor({ stopSessions: false });
    }
    const holdMs = this.options.holdMs ?? HELLO_HOLD_MS;
    if (!answered()) await this.until(answered, holdMs);
    const welcome = hosts.welcome(owner);
    if (hosts.snapshot(owner).state === 'ready' && welcome) {
      const { peer } = welcome;
      return {
        kind: 'welcome',
        identity: {
          protocol: SOCKET_PROTOCOL,
          minor: peer.minor,
          buildId: peer.build,
          capabilities: [...new Set([...peer.capabilities, ...WIRE_CAPABILITIES])],
          wire: wireFingerprint(),
          pid: welcome.pid,
          startedAt: this.options.startedAt(welcome.pid),
        },
        counts: { liveSessions: welcome.liveSessions, rows: welcome.rows },
      };
    }
    const refusal: ServerRefuse | null = hosts.refusal(owner);
    if (refusal) return { kind: 'refuse', line: refusal };
    return { kind: 'close', why: `the ${owner} is ${hosts.snapshot(owner).state}; no welcome within ${holdMs / 1000} s` };
  }

  private until(check: () => boolean, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(done, ms);
      const off = this.options.hosts.onState(this.options.owner, () => {
        if (check()) done();
      });
    });
  }

  // --- ServedRuntime -----------------------------------------------------------------------------------------------
  serve(port: HostPort): void {
    const replaced = this.current;
    if (replaced) {
      replaced.gone = true; // the socket layer closed it with `refuse replaced`
      replaced.leaving = true;
      this.options.log('a second app replaced the attached one');
    }
    const app: App = { port, ready: false, leaving: false, gone: false, lost: 0 };
    this.current = app;
    this.options.attached();
    port.on('message', ({ data }) => this.receive(app, data));
    port.start();
  }

  detach(): void {
    const app = this.current ?? this.departing;
    if (!app) return;
    app.gone = true;
    if (app === this.current) this.depart(app);
  }

  docPort(message: HostDoc, end: DocPortEnd): void {
    if (this.options.onDocument) return this.options.onDocument(message, end);
    this.options.log(`closed document channel ${message.channel}: the ${this.options.owner} serves no documents`);
    end.close();
  }

  // The app's FIN, on a half-open server (socket-server.ts `onClientEnd`).
  ended(): void {
    if (this.current) this.depart(this.current);
  }

  exit(when: 'now' | 'idle', from?: { refused: boolean }): void {
    this.options.onExit(when, from?.refused ?? false);
  }

  // --- what the upstream sends ---------------------------------------------------------------------------------------
  // An event, as received: to the departing app while its drain runs, else to the attached app once it said ready.
  deliver(message: { name: string; payload: unknown }): void {
    const to = this.departing ?? this.current;
    if (!to) return;
    if (to.gone) {
      if (to === this.departing) to.lost += 1;
      return;
    }
    if (!to.ready) return;
    if (to.port.postMessage({ t: 'evt', name: message.name, payload: message.payload }) === false && to === this.departing) to.lost += 1;
  }

  private receive(app: App, data: unknown): void {
    if (app.gone) return;
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    if (record?.t === 'ready') {
      if (app.ready || app.leaving) return;
      app.ready = true;
      this.options.ready();
      return;
    }
    if (record?.t === 'clientGone') return; // main sends it to a `machine` host only; nothing here carried a client
    if (record?.t !== 'req' || typeof record.id !== 'string' || typeof record.name !== 'string') return;
    if (app.leaving) return; // the departure: no more of its requests
    const request: RelayRequest = { id: record.id, name: record.name, input: record.input, ...(typeof record.client === 'string' && { client: record.client }) };
    const answer = this.options.intercept?.(request) ?? this.options.hosts.forward(this.options.owner, { name: request.name, input: request.input, client: request.client });
    void answer.then((response) => {
      if (!app.gone) app.port.postMessage({ ...response, id: request.id });
    });
  }

  private depart(app: App): void {
    this.current = null;
    app.leaving = true;
    this.options.departed();
    const drain = this.options.drain;
    if (!drain) return;
    this.departing = app;
    this.options.between?.();
    let ended = false;
    // Ends the app's side once the upstream has closed or the bound passed, unless a new app took the socket meanwhile
    // (the socket layer already closed this one then).
    const endApp = () => {
      if (ended) return;
      ended = true;
      clearTimeout(bound);
      const closing = !app.gone;
      app.gone = true;
      if (closing && this.current === null) this.clients?.closeClient();
      this.options.between?.();
    };
    const bound = setTimeout(endApp, drain.boundMs ?? DEPARTURE_BOUND_MS);
    drain.start(() => {
      endApp();
      if (this.departing === app) this.departing = null;
      if (app.lost > 0) this.options.log(`${app.lost} events the ${this.options.owner} wrote before it saw the app's end came after its side ended and were lost`);
    });
  }
}
