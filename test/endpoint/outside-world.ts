// The callers of the UX wave's U6f differential (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md,
// condition (a)), for an authorizer taken without a channel: the real `Authorizer` over a signed head, the machine's
// policy, the grant ledger's rights and the offer and grade seams, asked about one act of one name from one caller at a
// time. Read by test/endpoint/outside-rows.test.ts and test/endpoint/outside-offers.test.ts.
//
// The org: A, an admin who owns the machine (a1); B, a member a grant names with `shell` (b1; b2 is a device the head
// no longer lists); C, a member whose grant names `spawn` alone (c1); D, a member who holds `view` on the session the
// acts name and no right on the machine (d1, and dw, a web-cards device). Paths and text are invented.
import { base64urlEncode, generateSigningKey, memoryOrgView, NO_CERTIFICATES, type Right, type SignedOrgState, type SigningKey } from 'org-protocol';
import { SoftwareAuthenticator } from '../../apps/org-protocol/test-support/authenticator.ts';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import type { GradeSpec } from '@shared/ipc/grades';
import { Authorizer, type AuthorizeContext, type Decision, type Who } from '../../src/endpoint/authorize';
import { MACHINE_RIGHTS } from '../../src/endpoint/grants';
import type { Offers } from '../../src/endpoint/offers';
import type { SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { endorsed, genesis, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-u6f';
const HUB = 'http://127.0.0.1:9';
const RP_ID = 'hub.example';
export const APP = 'app-elsewhere';
const ENGINE = 'eng-elsewhere';

/** A schema-valid input of each name the differential asks about: the terminal's spawn and the four outside acts. */
export const INPUTS: Readonly<Record<string, Record<string, unknown>>> = {
  'pty.spawn': { appSessionId: APP, label: 't1', cwd: '/work/u6f', cols: 80, rows: 24 },
  'files.readOutside': { appSessionId: APP, path: '/srv/elsewhere/notes.txt' },
  'files.listOutside': { appSessionId: APP, path: '/srv/elsewhere' },
  'files.chooseOutside': { appSessionId: APP, path: '/srv/elsewhere/notes.txt' },
  'files.writeOutside': { appSessionId: APP, path: '/srv/elsewhere/notes.txt', content: 'an invented line\n', expectedHash: 'a'.repeat(64), real: '/srv/elsewhere/notes.txt' },
};

/** One caller: the member and device the channel proved, its class, and whether its act carries a step-up. */
export type Caller = { name: string; member: string; device: TestDevice; stepUp: boolean };

export type World = {
  callers: { owner: Caller; shell: Caller; shellSteppedUp: Caller; spawnOnly: Caller; viewOnly: Caller; webCards: Caller; removed: Caller };
  /** The decision on an act of `name` (its input from INPUTS unless given) from `caller`, without `stands` (a function). */
  decide(name: string, caller: Caller, input?: unknown, kind?: 'act' | 'call' | 'stream'): Promise<Omit<Extract<Decision, { ok: true }>, 'stands'> | Extract<Decision, { ok: false }>>;
};

export type WorldOptions = { offers?: Offers; gradeOf?(name: string): GradeSpec | undefined; readOnly?: boolean; tooOld?: boolean };

let org: Promise<{ A: string; B: string; C: string; D: string; a1: TestDevice; b1: TestDevice; b2: TestDevice; c1: TestDevice; d1: TestDevice; dw: TestDevice; passkey: SoftwareAuthenticator; recovery: SigningKey }> | null = null;

function members() {
  org ??= (async () => {
    const [A, B, C, D] = [memberId(), memberId(), memberId(), memberId()];
    const [a1, b1, b2, c1, d1] = await Promise.all([newDevice('a1'), newDevice('b1'), newDevice('b2'), newDevice('c1'), newDevice('d1')]);
    const phone = await newDevice('dw', 'web-cards');
    const passkey = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), RP_ID);
    const card = { ...phone.device, passkey: passkey.passkey };
    delete card.stepUpPub;
    const dw = await endorsed(ORG, D, { ...phone, device: card }, d1);
    return { A, B, C, D, a1, b1, b2, c1, d1, dw, passkey, recovery: await generateSigningKey() };
  })();
  return org;
}

export async function outsideWorld(options: WorldOptions = {}): Promise<World> {
  const { A, B, C, D, a1, b1, b2, c1, d1, dw, passkey, recovery } = await members();
  const ref = 'R'.repeat(22);
  const key = await generateSigningKey();
  const s1 = await genesis(ORG, A, a1, recovery);
  // b2 is B's no longer: the head lists b1 alone
  const s2 = await successor(s1, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
    s.members.push({ id: C, email: 'c@example.com', role: 'member', devices: [c1.device] });
    s.members.push({ id: D, email: 'd@example.com', role: 'member', devices: [d1.device, dw.device] });
    s.machines.push({ name: 'studio', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'studio', ref });
  });
  const chain: SignedOrgState[] = [s1, s2];
  const grants: Record<string, readonly Right[]> = { [B]: ['shell'], [C]: ['spawn'] };
  const record: SessionRecord = { lane: 'B', session: ENGINE, owners: [A], shares: [{ member: D, grade: 'view' }] };
  const ctx: AuthorizeContext = {
    ref: () => ref,
    org: () => ({ head: s2.state, certificates: NO_CERTIFICATES, tooOld: options.tooOld === true }),
    rights: async (member) => (member === A ? MACHINE_RIGHTS : (grants[member] ?? [])),
    policy: () => ({ read_only: options.readOnly === true, ceiling: 'settings' }),
    settingsMode: () => 'default',
    records: { record: (t: SessionTarget) => (t.lane === 'B' && t.session === ENGINE ? record : null), onChange: () => () => {} },
    checkouts: { known: () => true },
    // the reads a placement makes, should any row place the session: it is live under ENGINE
    dispatch: async (owner, name, input) => {
      if (owner === 'machine' && name === 'session.get') return { t: 'res', id: '0', ok: true, value: null };
      if (owner === 'engine-host' && name === 'session.status') return { t: 'res', id: '0', ok: true, value: { appSessionId: (input as { appSessionId: string }).appSessionId, engineSessionId: ENGINE, launchId: 'launch-1' } };
      return { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } };
    },
    log: () => {},
    webauthn: { origin: () => HUB, counter: () => 0, setCounter: () => {} },
    ...(options.offers === undefined ? {} : { offers: options.offers }),
    ...(options.gradeOf === undefined ? {} : { gradeOf: options.gradeOf }),
  };
  const authorizer = new Authorizer(ctx);
  const caller = (name: string, member: string, device: TestDevice, stepUp = false): Caller => ({ name, member, device, stepUp });
  return {
    callers: {
      owner: caller('an owner', A, a1),
      shell: caller('a member with a shell grant, no step-up', B, b1),
      shellSteppedUp: caller('a member with a shell grant, stepped up', B, b1, true),
      spawnOnly: caller('a member with a spawn grant only, stepped up', C, c1, true),
      viewOnly: caller('a member with view on the session and no right, stepped up', D, d1, true),
      webCards: caller('a web-cards device', D, dw),
      removed: caller('a device the head removed, stepped up', B, b2, true),
    },
    async decide(name, who, input = INPUTS[name], kind = 'act') {
      const cls = who.device.device.class;
      const device = new Device({
        identity: { org: ORG, member: who.member, device: who.device.device.id, clientClass: cls, channelKey: who.device.channel, build: 'u6f', capabilities: [] },
        org: memoryOrgView({ chain: [...chain] }),
        ...(cls === 'web-cards' ? { authenticator: passkey } : { stepUpKey: who.device.stepUp }),
      });
      const sealed = device.action({ machine: ref, action: name, args: input as Record<string, unknown> });
      const action = who.stepUp ? await device.stepUp(sealed) : sealed;
      const asked: Who = { member: who.member, device: who.device.device.id, clientClass: cls };
      const decision = await authorizer.authorize(kind === 'act' ? { kind, name, input: action.args, action } : { kind, name, input }, asked, Date.now());
      if (!decision.ok) return decision;
      const { stands, ...rest } = decision;
      void stands; // a function, compared by nothing
      return rest;
    },
  };
}
