// redeploy-check's RL1 leg (O11 M8; acceptance 3's deploy clause): a code update drops every hibernatable socket, so
// after a deploy both the endpoint's RL1 socket and an app's Machine socket must drop, the endpoint come back under a
// higher generation, and the app reach the endpoint again through a channel. The leg holds a listed v2 machine's
// endpoint (reconnecting, as O10's will) and an app socket with a channel proved by an echo, watches both across the
// redeploy, reopens the app's socket and a channel as an app would, and says when each dropped and how long each took
// to come back.
import { RelayApp } from 'org-protocol/test-support';
import type { FakeEndpoint } from '../fake-machine/endpoint';
import type { V2Machine } from '../fake-machine/org';
import type { Person } from './hub';
import type { OrgAdmin } from './org-admin';
import type { Cleanup } from './proof';
import { connectEndpoint, EchoReader, echoingEndpoint, openedChannel, sameBytes, sealedFrame } from './rl1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One end of a socket, or its coming back, at a time since the epoch. */
type Seen = { at: number; code?: number; reason?: string; generation?: number };

export class Rl1Watch {
  /** The endpoint's connections (`welcome`s) and ends, in order. */
  private readonly endpointUps: Seen[] = [];
  private readonly endpointDowns: Seen[] = [];
  /** The app's socket ends, and the moments a channel echoed again after each. */
  private readonly appDowns: Seen[] = [];
  private readonly appBacks: Seen[] = [];
  private redeployAt: number | undefined;
  private generationBefore = 0;
  private stopped = false;
  private following: Promise<void> = Promise.resolve();
  private seq = 0;
  private endsSeen = 0;
  private generationSeen = 0;
  private endpoint!: FakeEndpoint;

  private constructor(
    private readonly person: Person,
    private readonly machine: V2Machine,
    private app: RelayApp,
  ) {}

  /**
   * Lists `name` in the org state (its undoing on `cleanup`), connects its endpoint, opens the app's socket and proves a
   * channel with an echo; the app's socket is then followed until `stop`.
   */
  static async start(person: Person, admin: OrgAdmin, name: string, cleanup: Cleanup, log: (line: string) => void = console.log): Promise<Rl1Watch> {
    const machine = await admin.listedMachine(name, cleanup);
    const seen: { watch?: Rl1Watch } = {};
    const endpoint = echoingEndpoint(person.hub, machine, { reconnect: true, build: 'redeploy-check', log: () => seen.watch?.observe() });
    cleanup.add(`close ${name}'s endpoint`, async () => endpoint.close());
    await connectEndpoint(endpoint);
    const app = await RelayApp.open(person.hub, machine.ref, person.headers);
    const watch = new Rl1Watch(person, machine, app);
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
          if (this.app.ended) this.app = await RelayApp.open(this.person.hub, this.machine.ref, this.person.headers);
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

  /** Whether everything the redeploy should cause has happened and come back. */
  private settled(): boolean {
    const downs = this.since(this.appDowns);
    return (
      this.since(this.endpointDowns).length > 0 &&
      this.endpoint.isOpen &&
      this.endpoint.generation > this.generationBefore &&
      downs.length > 0 &&
      this.since(this.appBacks).some((back) => back.at >= downs.at(-1)!.at)
    );
  }

  /** Waits until the redeploy's cut has come and gone on both sockets, or `until`; what did not happen, as problems. */
  async settle(until: number): Promise<string[]> {
    while (!this.settled() && Date.now() < until) await sleep(250);
    const problems: string[] = [];
    if (this.since(this.endpointDowns).length === 0) problems.push(`the redeploy never cut ${this.machine.name}'s RL1 socket (still generation ${this.endpoint.generation}): not exercised`);
    else if (!this.endpoint.isOpen || this.endpoint.generation <= this.generationBefore) problems.push(`${this.machine.name}'s endpoint did not come back under a higher generation (generation ${this.generationBefore} before, ${this.endpoint.isOpen ? this.endpoint.generation : 'not connected'} now)`);
    const downs = this.since(this.appDowns);
    if (downs.length === 0) problems.push(`the redeploy never cut the app's socket to ${this.machine.name}: not exercised`);
    else if (!this.since(this.appBacks).some((back) => back.at >= downs.at(-1)!.at)) problems.push(`the app's channel to ${this.machine.name} was not re-opened after its socket dropped`);
    return problems;
  }

  /** What the redeploy did to each socket, relative to its start, and how long each took to come back. */
  report(): string[] {
    const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const from = this.redeployAt ?? 0;
    const lines: string[] = [];
    for (const down of this.since(this.endpointDowns)) {
      const up = this.endpointUps.find((u) => u.at >= down.at);
      lines.push(
        `rl1: the endpoint's socket closed ${down.code} ${down.reason || '(no reason)'} at +${s(down.at - from)} (generation ${down.generation}); ` +
          (up ? `welcomed again under generation ${up.generation} ${s(up.at - down.at)} after` : 'not welcomed again'),
      );
    }
    for (const down of this.since(this.appDowns)) {
      const back = this.appBacks.find((b) => b.at >= down.at);
      lines.push(`rl1: the app's socket closed ${down.code} ${down.reason || '(no reason)'} at +${s(down.at - from)}; ` + (back ? `a new channel to the endpoint echoed ${s(back.at - down.at)} after` : 'no channel echoed again'));
    }
    return lines.length > 0 ? lines : ['rl1: neither socket was cut'];
  }

  /** Stops following and closes the app's socket. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.following;
    this.app.close();
  }
}
