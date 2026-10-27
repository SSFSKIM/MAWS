// One channel suite, run unchanged over both carriers (O10 M4; acceptance 9, and the admission half of acceptance 3's
// last case): a listed endpoint's channels as a device meets them. The handshake and `caps`; an unknown device, a wrong
// class and a revoked device refused; a device added in a state the endpoint hasn't seen admitted through `h3`'s
// successors; a catch-up spanning two pages over two connections, the first closed `behind`; a channel closed `removed`
// when a new state drops its device, by the hub or over another device's channel, and the device refused after; and a
// frame a hostile relay altered closing the channel.
//
// The carrier is the only thing a run supplies (`dial`); everything the suite asserts is the endpoint's, or the
// device's sealed messages, which both carriers carry alike. A refusal before a channel exists closes the carrier, and
// the carriers word that differently (the hub's multiplex has no reason text), so the suite reads the endpoint's own
// word for it from its log.
import { canonicalize, memoryOrgView, type ByteDuplex, type Channel, type ChannelMessage, type OrgState, type SignedOrgState } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import type { Endpoint } from '../../src/endpoint';
import { throughTamper } from './carriers';
import type { FakeServices } from './fake-services';
import { endorsed, newDevice, retiredDevice, revokedDevice, type TestDevice } from './org-fixtures';

export type SuiteContext = {
  carrier: 'relayed' | 'direct';
  /** One carrier to the endpoint. */
  dial(): Promise<ByteDuplex>;
  endpoint: Endpoint;
  services: FakeServices;
  ref: string;
  org: string;
  /** The machine's owner, an admin, and the device that signs the org's states. */
  admin: { member: string; device: TestDevice };
  /** A member who owns nothing on the machine, and the device of theirs that endorses each new one. */
  member: string;
  memberDevice: TestDevice;
  /** Every state published so far, from the genesis. */
  chain(): SignedOrgState[];
  /** The state after `after` (the published head unless given), changed by `edit` and signed by the admin's device; not published. */
  next(edit: (s: OrgState) => void | Promise<void>, after?: SignedOrgState): Promise<SignedOrgState>;
  /** Publishes the next state to the hub (whose notice brings it to the endpoint). */
  publish(state: SignedOrgState): Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false && value !== null) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(20);
  }
}

/** Messages a channel received, in order, and its close. */
function watch(channel: Channel): { messages: ChannelMessage[]; closed: Promise<string> } {
  const messages: ChannelMessage[] = [];
  channel.onMessage((m) => void messages.push(m));
  const closed = new Promise<string>((resolve) => channel.onClose((reason) => resolve(reason)));
  return { messages, closed };
}

export function channelSuite(name: string, context: () => SuiteContext): void {
  describe(name, () => {
    let serial = 0;
    const fresh = (prefix: string) => `${prefix}-${name.replace(/\W+/g, '-')}-${++serial}`;

    function device(ctx: SuiteContext, member: string, who: TestDevice, options: { clientClass?: 'native-mac' | 'web-cards'; chain?: SignedOrgState[] } = {}): Device {
      return new Device({
        identity: { org: ctx.org, member, device: who.device.id, clientClass: options.clientClass ?? who.device.class, channelKey: who.channel, build: 'channel-suite', capabilities: [] },
        org: memoryOrgView({ chain: [...(options.chain ?? ctx.chain())] }),
      });
    }

    /** How many times the endpoint has logged a refusal on this carrier for `reason`. */
    const refusals = (ctx: SuiteContext, reason: string) => ctx.services.lines.filter((line) => line === `endpoint: a ${ctx.carrier} channel was refused: ${reason}`).length;

    const headVersion = (ctx: SuiteContext) => ctx.endpoint.status().stateVersion;

    /** A new device of the plain member, endorsed by their first one. */
    const memberDevice = async (ctx: SuiteContext, prefix: string) => endorsed(ctx.org, ctx.member, await newDevice(fresh(prefix)), ctx.memberDevice);

    /** A new device of the plain member, added in a published state the endpoint has adopted. */
    async function enrolledDevice(ctx: SuiteContext, prefix: string): Promise<TestDevice> {
      const added = await memberDevice(ctx, prefix);
      const state = await ctx.next((s) => void s.members.find((m) => m.id === ctx.member)!.devices.push(added.device));
      await ctx.publish(state);
      await until(() => headVersion(ctx) === state.state.version, 'the endpoint at the new head');
      return added;
    }

    it('admits a device it holds and sends `caps` first, holding mawsd while the channel is open', async () => {
      const ctx = context();
      const channel = await device(ctx, ctx.admin.member, ctx.admin.device).open(ctx.dial, ctx.ref);
      const seen = watch(channel);
      const caps = await until(() => seen.messages[0], 'caps');
      expect(caps).toEqual({ t: 'caps', member: ctx.admin.member, device: ctx.admin.device.device.id, clientClass: 'native-mac', machine: { grades: ['spawn', 'shell', 'machine-admin'] }, stateVersion: headVersion(ctx) });
      expect(ctx.endpoint.status().channels[ctx.carrier]).toBe(1);
      expect([...ctx.services.holds].some((hold) => hold.startsWith('channel#'))).toBe(true);

      const other = await enrolledDevice(ctx, 'm');
      const second = await device(ctx, ctx.member, other).open(ctx.dial, ctx.ref);
      const secondSeen = watch(second);
      expect(await until(() => secondSeen.messages[0], 'caps')).toMatchObject({ t: 'caps', member: ctx.member, machine: { grades: [] } });

      channel.close('done');
      await until(() => ctx.endpoint.status().channels[ctx.carrier] === 1, 'one channel left');
      expect([...ctx.services.holds].some((hold) => hold.startsWith('channel#'))).toBe(true);
      second.close('done');
      await until(() => ctx.endpoint.status().channels[ctx.carrier] === 0, 'no channel left');
    });

    it('refuses an unknown device, a device claiming another class, and a revoked device', async () => {
      const ctx = context();
      const before = { unknown: refusals(ctx, 'unknown-device'), cls: refusals(ctx, 'class'), revoked: refusals(ctx, 'revoked') };
      const ghost = await newDevice(fresh('ghost'));
      await expect(device(ctx, ctx.admin.member, ghost).open(ctx.dial, ctx.ref)).rejects.toThrow();
      await until(() => refusals(ctx, 'unknown-device') === before.unknown + 1, 'the unknown device refused');

      const own = await enrolledDevice(ctx, 'c');
      await expect(device(ctx, ctx.member, own, { clientClass: 'web-cards' }).open(ctx.dial, ctx.ref)).rejects.toThrow();
      await until(() => refusals(ctx, 'class') === before.cls + 1, 'the wrong class refused');

      const lost = await enrolledDevice(ctx, 'r');
      const revoked = await ctx.next(async (s) => {
        const member = s.members.find((m) => m.id === ctx.member)!;
        member.devices = member.devices.filter((d) => d.id !== lost.device.id);
        s.revoked.push(...(await revokedDevice(ctx.member, lost.device)));
      });
      await ctx.publish(revoked);
      await until(() => headVersion(ctx) === revoked.state.version, 'the revocation adopted');
      await expect(device(ctx, ctx.member, lost).open(ctx.dial, ctx.ref)).rejects.toThrow();
      await until(() => refusals(ctx, 'revoked') === before.revoked + 1, 'the revoked device refused');
      expect(ctx.endpoint.status().channels[ctx.carrier]).toBe(0);
    });

    it('admits a device added in a state it hasn’t seen, adopting the successor `h3` carries', async () => {
      const ctx = context();
      const added = await memberDevice(ctx, 'n');
      const unseen = await ctx.next((s) => void s.members.find((m) => m.id === ctx.member)!.devices.push(added.device));
      const channel = await device(ctx, ctx.member, added, { chain: [...ctx.chain(), unseen] }).open(ctx.dial, ctx.ref);
      const seen = watch(channel);
      expect(await until(() => seen.messages[0], 'caps')).toMatchObject({ t: 'caps', member: ctx.member, device: added.device.id, stateVersion: unseen.state.version });
      expect(headVersion(ctx)).toBe(unseen.state.version);
      channel.close('done');
      await ctx.publish(unseen);
    });

    it('pages a catch-up longer than a handshake page over two connections, the first closed `behind`', async () => {
      const ctx = context();
      const added = await memberDevice(ctx, 'p');
      const first = await ctx.next(() => {});
      const second = await ctx.next((s) => void s.members.find((m) => m.id === ctx.member)!.devices.push(added.device), first);
      // A page holds one of the two states (each over a kilobyte), never both.
      const pageBytes = 1024 + Math.max(canonicalize(first).length, canonicalize(second).length);
      expect(canonicalize(first).length + canonicalize(second).length).toBeGreaterThan(pageBytes);
      const behind = refusals(ctx, 'behind');
      let dials = 0;
      const dial = () => {
        dials++;
        return ctx.dial();
      };
      const channel = await device(ctx, ctx.member, added, { chain: [...ctx.chain(), first, second] }).open(dial, ctx.ref, { pageBytes });
      const seen = watch(channel);
      expect(await until(() => seen.messages[0], 'caps')).toMatchObject({ t: 'caps', device: added.device.id, stateVersion: second.state.version });
      expect(dials).toBe(2);
      expect(refusals(ctx, 'behind')).toBe(behind + 1);
      expect(headVersion(ctx)).toBe(second.state.version);
      channel.close('done');
      await ctx.publish(first);
      await ctx.publish(second);
    });

    it('closes a channel `removed` when a new state drops its device, and refuses the device after', async () => {
      const ctx = context();
      const leaving = await enrolledDevice(ctx, 'x');
      const seen = watch(await device(ctx, ctx.member, leaving).open(ctx.dial, ctx.ref));
      await until(() => seen.messages[0], 'caps');
      const dropped = await ctx.next(async (s) => {
        const member = s.members.find((m) => m.id === ctx.member)!;
        member.devices = member.devices.filter((d) => d.id !== leaving.device.id);
        s.retired.push(...(await retiredDevice(ctx.member, leaving.device, s.issued)));
      });
      await ctx.publish(dropped);
      expect(await seen.closed).toBe('removed');
      const unknown = refusals(ctx, 'unknown-device');
      await expect(device(ctx, ctx.member, leaving).open(ctx.dial, ctx.ref)).rejects.toThrow();
      await until(() => refusals(ctx, 'unknown-device') === unknown + 1, 'the removed device refused');
    });

    it('closes a channel `removed` when the state that drops its device arrives over another device’s channel', async () => {
      const ctx = context();
      const leaving = await enrolledDevice(ctx, 'y');
      const doomed = watch(await device(ctx, ctx.member, leaving).open(ctx.dial, ctx.ref));
      await until(() => doomed.messages[0], 'caps');
      const admin = await device(ctx, ctx.admin.member, ctx.admin.device).open(ctx.dial, ctx.ref);
      const dropped = await ctx.next(async (s) => {
        const member = s.members.find((m) => m.id === ctx.member)!;
        member.devices = member.devices.filter((d) => d.id !== leaving.device.id);
        s.revoked.push(...(await revokedDevice(ctx.member, leaving.device)));
      });
      await admin.send({ t: 'state', states: [dropped], transitions: [] });
      expect(await doomed.closed).toBe('removed');
      expect(headVersion(ctx)).toBe(dropped.state.version);
      expect(admin.closed).toBe(false);
      admin.close('done');
      await ctx.publish(dropped);
    });

    it('closes a channel on a frame a relay in its path altered', async () => {
      const ctx = context();
      let relay: ReturnType<typeof throughTamper>['relay'] | undefined;
      const dial = async () => {
        const spliced = throughTamper(await ctx.dial());
        relay = spliced.relay;
        return spliced.device;
      };
      const channel = await device(ctx, ctx.admin.member, ctx.admin.device).open(dial, ctx.ref);
      const seen = watch(channel);
      await until(() => seen.messages[0], 'caps');
      relay!.tamper('to-endpoint', { flip: -1 });
      await channel.send({ t: 'ping', at: 1 });
      expect(await seen.closed).toBe('tag');
      expect(seen.messages.some((m) => m.t === 'pong')).toBe(false);
      await until(() => ctx.endpoint.status().channels[ctx.carrier] === 0, 'the channel gone at the endpoint');
    });
  });
}
