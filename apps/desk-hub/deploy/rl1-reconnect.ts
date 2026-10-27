// redeploy-check's RL1 leg (O11 M8; acceptance 3's deploy clause): a code update drops hibernatable sockets, and after
// a cut the endpoint's RL1 socket must come back under a higher generation and an app reach the endpoint again through
// a channel. The leg holds a listed v2 machine's endpoint (reconnecting, as O10's will) and an app socket with a channel
// proved by an echo, watches both across the redeploy, reopens the app's socket and a channel as an app would, and says
// when each dropped and how long each took to come back. A redeploy cuts the sockets when Cloudflare chooses, if at all
// within the window, so the leg also cuts both itself (`forceCuts`), from the client's end, as many times in a row as
// asked.
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { RelayApp } from 'org-protocol/test-support';
import { credentialHeaders } from '../fake-machine/link';
import { MACHINE_SOCKET_PATH } from '../src/protocol/machine';
import type { FakeEndpoint } from '../fake-machine/endpoint';
import type { V2Machine } from '../fake-machine/org';
import { settledWithin, STOP_WAIT_MS, type Person } from './hub';
import type { OrgAdmin } from './org-admin';
import type { Cleanup } from './proof';
import { connectEndpoint, EchoReader, echoingEndpoint, openedChannel, sameBytes, sealedFrame } from './rl1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Opens an app's Machine socket: `RelayApp.open`, or a suite's stand-in for it. */
export type AppOpener = (hub: string, machine: string, headers: Record<string, string>) => Promise<RelayApp>;

/** One end of a socket, or its coming back, at a time since the epoch. */
type Seen = { at: number; code?: number; reason?: string; generation?: number };

/**
 * What the hub answers an RL1 upgrade with `headers` now: `101` (the socket, closed at once), the status and the error
 * the answer names (Access's page as `access`), `unanswered` after `ms`, or the request's own error. A diagnostic of
 * a failing reconnect: a 101 installs a connection for a moment, so it is asked only while the endpoint is down.
 */
export function upgradeProbe(hub: string, headers: Record<string, string>, ms = 15_000): Promise<string> {
  const url = new URL(MACHINE_SOCKET_PATH, hub);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = send(url, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve('unanswered');
    }, ms);
    req.on('upgrade', (_response, socket) => {
      clearTimeout(timer);
      socket.destroy();
      resolve('101');
    });
    req.on('response', (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => {
        clearTimeout(timer);
        let error: string;
        try {
          error = String((JSON.parse(body) as { error?: unknown }).error);
        } catch {
          error = /Cloudflare Access/i.test(body) ? 'access' : `non-JSON (${body.length} B)`;
        }
        resolve(`${response.statusCode} ${error}`);
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      resolve(`error ${e.message}`);
    });
    req.end();
  });
}

export class Rl1Watch {
  /** The endpoint's connections (`welcome`s) and ends, in order. */
  private readonly endpointUps: Seen[] = [];
  private readonly endpointDowns: Seen[] = [];
  /** The app's socket ends, and the moments a channel echoed again after each. */
  private readonly appDowns: Seen[] = [];
  private readonly appBacks: Seen[] = [];
  /** The endpoint's failed reconnects, each with the hub's answer to a probe made beside it (at most one per 10 s). */
  private readonly failures: Array<{ at: number; message: string; probe?: string }> = [];
  private lastProbe = 0;
  private redeployAt: number | undefined;
  private generationBefore = 0;
  private stopped = false;
  /** When the stops stop waiting for the follow loop (a reopen's upgrade can stall): set by the first. */
  private abandonAt: number | undefined;
  private following: Promise<void> = Promise.resolve();
  private seq = 0;
  private endsSeen = 0;
  private generationSeen = 0;
  private endpoint!: FakeEndpoint;

  private constructor(
    private readonly person: Person,
    private readonly machine: V2Machine,
    private app: RelayApp,
    private readonly openApp: AppOpener,
  ) {}

  /**
   * Lists `name` in the org state (its undoing on `cleanup`), connects its endpoint, opens the app's socket and proves a
   * channel with an echo; the app's socket is then followed until `stop`.
   */
  static async start(
    person: Person,
    admin: OrgAdmin,
    name: string,
    cleanup: Cleanup,
    log: (line: string) => void = console.log,
    openApp: AppOpener = (hub, machine, headers) => RelayApp.open(hub, machine, headers),
  ): Promise<Rl1Watch> {
    const machine = await admin.listedMachine(name, cleanup);
    const seen: { watch?: Rl1Watch } = {};
    const endpoint = echoingEndpoint(person.hub, machine, {
      reconnect: true,
      build: 'redeploy-check',
      log: (line) => {
        seen.watch?.observe();
        if (line.startsWith('reconnect failed: ')) seen.watch?.failed(line.slice('reconnect failed: '.length));
      },
    });
    cleanup.add(`close ${name}'s endpoint`, async () => endpoint.close());
    await connectEndpoint(endpoint);
    const app = await openApp(person.hub, machine.ref, person.headers);
    const watch = new Rl1Watch(person, machine, app, openApp);
    watch.endpoint = endpoint;
    watch.observe();
    seen.watch = watch;
    cleanup.add(`stop ${name}'s app socket`, () => watch.stop());
    await watch.echo(app, 10_000);
    log(`rl1: ${name} (ref ${machine.ref}) holds RL1 under generation ${endpoint.generation}; an app's channel to it echoes`);
    watch.following = watch.follow();
    return watch;
  }

  /** Records the endpoint's newest end or connection: called by the endpoint at each. */
  private observe(): void {
    const at = Date.now();
    const { ends } = this.endpoint;
    for (; this.endsSeen < ends.length; this.endsSeen++) this.endpointDowns.push({ at, code: ends[this.endsSeen].code, reason: ends[this.endsSeen].reason, generation: ends[this.endsSeen].generation });
    if (this.endpoint.isOpen && this.endpoint.generation !== this.generationSeen) {
      this.generationSeen = this.endpoint.generation;
      this.endpointUps.push({ at, generation: this.endpoint.generation });
    }
  }

  /** A failed reconnect of the endpoint, kept with a probe of what the hub answers an upgrade now. */
  private failed(message: string): void {
    const failure: { at: number; message: string; probe?: string } = { at: Date.now(), message: message.replace(/ at wss?:\/\/\S+/, '') };
    this.failures.push(failure);
    if (failure.at - this.lastProbe < 10_000 || this.endpoint.isOpen) return;
    this.lastProbe = failure.at;
    void upgradeProbe(this.person.hub, credentialHeaders(this.machine.credentials)).then((answer) => (failure.probe = answer));
  }

  /** One sealed frame through a new channel and back, byte-identical, within `ms`. */
  private async echo(app: RelayApp, ms: number): Promise<void> {
    const channel = await openedChannel(app, ms);
    const reader = new EchoReader(app, channel);
    try {
      const frame = sealedFrame(1024, this.seq++);
      app.send(channel, frame);
      if (!sameBytes(await reader.next(ms), frame)) throw new Error('the echo came back altered');
    } finally {
      reader.stop();
      if (!app.ended) app.closeChannel(channel);
    }
  }

  /** Follows the app's socket: each time it drops, it is opened again and a channel tried until one echoes. */
  private async follow(): Promise<void> {
    while (!this.stopped) {
      if (!this.app.ended) {
        await sleep(50);
        continue;
      }
      this.appDowns.push({ at: Date.now(), code: this.app.ended.code, reason: this.app.ended.reason });
      while (!this.stopped) {
        try {
          if (this.app.ended) {
            const app = await this.openApp(this.person.hub, this.machine.ref, this.person.headers);
            // Opened after a stop that no longer waited for it: nobody holds it but this loop.
            if (this.stopped) return app.close();
            this.app = app;
          }
          await this.echo(this.app, 5000);
          this.appBacks.push({ at: Date.now() });
          break;
        } catch {
          await sleep(1000);
        }
      }
    }
  }

  /** The redeploy starts now: what follows is its doing. */
  mark(at = Date.now()): void {
    this.redeployAt = at;
    this.generationBefore = this.endpoint.generation;
  }

  private since = (seen: Seen[]) => seen.filter((s) => s.at >= (this.redeployAt ?? Infinity));

  /** Since the mark, which socket was cut and whether each has come back: the endpoint under a higher generation than
   * at the mark, the app with a new channel echoing after its last drop. */
  private cutAndBack() {
    const appDowns = this.since(this.appDowns);
    return {
      endpointCut: this.since(this.endpointDowns).length > 0,
      endpointBack: this.endpoint.isOpen && this.endpoint.generation > this.generationBefore,
      appCut: appDowns.length > 0,
      appBack: appDowns.length > 0 && this.since(this.appBacks).some((back) => back.at >= appDowns.at(-1)!.at),
    };
  }

  /**
   * Waits until the redeploy's cut has come and gone on both sockets, or `until`; what did not happen, as problems. With
   * `cutRequired` false (the leg forces its own cuts, `forceCuts`), a socket the redeploy did not cut is no problem and is
   * not waited for; one it cut must still come back.
   */
  async settle(until: number, { cutRequired = true }: { cutRequired?: boolean } = {}): Promise<string[]> {
    const done = () => {
      const now = this.cutAndBack();
      return (now.endpointCut ? now.endpointBack : !cutRequired) && (now.appCut ? now.appBack : !cutRequired);
    };
    while (!done() && Date.now() < until) await sleep(250);
    const { endpointCut, endpointBack, appCut, appBack } = this.cutAndBack();
    const problems: string[] = [];
    if (!endpointCut) {
      if (cutRequired) problems.push(`the redeploy never cut ${this.machine.name}'s RL1 socket (still generation ${this.endpoint.generation}): not exercised`);
    } else if (!endpointBack) problems.push(`${this.machine.name}'s endpoint did not come back under a higher generation (generation ${this.generationBefore} before, ${this.endpoint.isOpen ? this.endpoint.generation : 'not connected'} now)`);
    if (!appCut) {
      if (cutRequired) problems.push(`the redeploy never cut the app's socket to ${this.machine.name}: not exercised`);
    } else if (!appBack) problems.push(`the app's channel to ${this.machine.name} was not re-opened after its socket dropped`);
    return problems;
  }

  /** Which RL1 sockets the redeploy left uncut, since the mark: for the run's verdict, since only a deploy's own cut of
   * both proves acceptance 3's "after a deploy". */
  uncut(): Array<'endpoint' | 'app'> {
    const { endpointCut, appCut } = this.cutAndBack();
    return [...(endpointCut ? [] : ['endpoint' as const]), ...(appCut ? [] : ['app' as const])];
  }

  /**
   * Cuts both sockets from this end, `count` times in a row, as a client whose network went away: the endpoint drops its
   * RL1 socket and the app its Machine socket. Each time the endpoint must be welcomed again under a higher generation
   * and a new channel echo within `ms`, before the next cut is made. Logs a line per cut; what did not come back, as
   * problems, and no cut after it.
   */
  async forceCuts(count: number, log: (line: string) => void = console.log, ms = 60_000): Promise<string[]> {
    for (let n = 1; n <= count; n++) {
      const at = Date.now();
      const generation = this.endpoint.generation;
      this.endpoint.drop(1000, 'forced cut');
      this.app.close();
      const welcomed = () => (this.endpoint.isOpen ? this.endpointUps.find((up) => up.at >= at && up.generation! > generation) : undefined);
      const dropped = () => this.appDowns.find((down) => down.at >= at);
      const echoed = () => {
        const down = dropped();
        return down && this.appBacks.find((back) => back.at >= down.at);
      };
      while (!(welcomed() && echoed()) && Date.now() < at + ms) await sleep(100);
      const up = welcomed();
      const back = echoed();
      const problems: string[] = [];
      if (!up) problems.push(`forced cut ${n}: ${this.machine.name}'s endpoint was not welcomed again under a higher generation within ${seconds(ms)} (generation ${generation} before, ${this.endpoint.isOpen ? this.endpoint.generation : 'not connected'} now)`);
      if (!back) problems.push(`forced cut ${n}: no new channel to ${this.machine.name} echoed within ${seconds(ms)} of the app's drop`);
      log(
        `rl1: forced cut ${n}: the endpoint dropped its socket at generation ${generation} and ` +
          (up ? `was welcomed again under generation ${up.generation} ${seconds(up.at - at)} after` : `was not welcomed again within ${seconds(ms)}`) +
          '; the app dropped its socket and ' +
          (back ? `a new channel to the endpoint echoed ${seconds(back.at - at)} after` : `no new channel echoed within ${seconds(ms)}`),
      );
      if (problems.length > 0) {
        const failures = this.failuresSummary(at);
        if (failures) log(failures);
        return problems;
      }
    }
    return [];
  }

  /** The endpoint's failed reconnects from `from` on, each kind counted, with what the hub answered the probes beside
   * them; times relative to `from`. */
  private failuresSummary(from: number): string | undefined {
    const failures = this.failures.filter((f) => f.at >= from);
    if (failures.length === 0) return undefined;
    const counted = (values: string[]) => [...new Set(values)].map((v) => `${v} ×${values.filter((x) => x === v).length}`).join(', ');
    return (
      `rl1: the endpoint's reconnects failed ${failures.length} time(s), from +${seconds(failures[0].at - from)} to +${seconds(failures.at(-1)!.at - from)}: ${counted(failures.map((f) => f.message))}; ` +
      `the hub answered an upgrade beside them: ${counted(failures.flatMap((f) => (f.probe ? [f.probe] : []))) || 'no probe made'}`
    );
  }

  /** What the redeploy did to each socket, relative to its start, and how long each took to come back. */
  report(): string[] {
    const from = this.redeployAt ?? 0;
    const lines: string[] = [];
    for (const down of this.since(this.endpointDowns)) {
      const up = this.endpointUps.find((u) => u.at >= down.at);
      lines.push(
        `rl1: the endpoint's socket closed ${down.code} ${down.reason || '(no reason)'} at +${seconds(down.at - from)} (generation ${down.generation}); ` +
          (up ? `welcomed again under generation ${up.generation} ${seconds(up.at - down.at)} after` : 'not welcomed again'),
      );
    }
    for (const down of this.since(this.appDowns)) {
      const back = this.appBacks.find((b) => b.at >= down.at);
      lines.push(`rl1: the app's socket closed ${down.code} ${down.reason || '(no reason)'} at +${seconds(down.at - from)}; ` + (back ? `a new channel to the endpoint echoed ${seconds(back.at - down.at)} after` : 'no channel echoed again'));
    }
    const failures = this.failuresSummary(this.redeployAt ?? Infinity);
    if (failures) lines.push(failures);
    return lines.length > 0 ? lines : ['rl1: neither socket was cut'];
  }

  /**
   * Stops following and closes the app's socket. A reopen still in progress (its upgrade stalled, say) is waited for
   * until `waitMs` after the first stop, and no longer by any later one, as `LogFollower.stop` does: past that, the
   * stopped loop closes the socket when it opens.
   */
  async stop(waitMs = STOP_WAIT_MS): Promise<void> {
    this.stopped = true;
    this.abandonAt ??= Date.now() + waitMs;
    await settledWithin(this.following, this.abandonAt - Date.now());
    this.app.close();
  }
}
