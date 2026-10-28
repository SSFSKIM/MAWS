// The staging phone run's pieces that need no hub (P5 O13 M7): the run read from the runner's environment, the report's
// lines, lane B's gate, the sweep's reading of what a run left in an org state and its undoing, and the checks'
// judgements of the notices a device read, the phone among the owner's devices and a web-cards entry.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateSigningKey, type Device, type OrgState, type SignedOrgState } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { BoundedPerson, within } from './bounded';
import { phoneOf, pushProblems, webCardsProblems } from './items';
import { Report } from './report';
import { cardsCredentialId, cardsRunOf, laneBLeg, LANE_B_WAITING, machineName, memberEmail, readRun, stopLine } from './run';
import type { Person } from '../../../apps/desk-hub/deploy/hub';
import type { OrgAdmin } from '../../../apps/desk-hub/deploy/org-admin';
import { isRunSubscription, residueLines, residueOf, sweepRun, undoRun } from './sweep';

const env = (over: Record<string, string | undefined> = {}) => ({
  DESK_STAGING_PHONE: '1',
  DESK_STAGING_PHONE_RUN: '7',
  DESK_STAGING_PHONE_MODE: 'rehearse',
  DESK_STAGING_ADMIN_KEYS: '/keys/keys.json',
  DESK_ACCESS_TOKEN: 'eyJ.synthetic',
  ...over,
});

describe('the run, from the runner’s environment', () => {
  it('reads a rehearsal with its sink, and a phone run without one', () => {
    expect(readRun(env({ DESK_STAGING_PHONE_SINK: 'https://a.trycloudflare.com/staging-run', DESK_STAGING_PHONE_SINK_PORT: '18744', DESK_STAGING_PHONE_SCAN: '/state/phone-7.scan', DESK_STAGING_PHONE_PROFILE: '/state/phone-7.profile' }))).toEqual({
      n: '7',
      mode: 'rehearse',
      keysFile: '/keys/keys.json',
      token: 'eyJ.synthetic',
      phoneDevice: null,
      sink: { url: 'https://a.trycloudflare.com/staging-run', port: 18744 },
      laneB: 'probe',
      answerMs: 600_000,
      profileDir: '/state/phone-7.profile',
      scanList: '/state/phone-7.scan',
    });
    const phone = readRun(env({ DESK_STAGING_PHONE_MODE: 'phone', DESK_STAGING_PHONE_NO_SINK: 'the quick tunnel did not come up in 3 tries', DESK_STAGING_PHONE_LANE_B: 'required', DESK_STAGING_PHONE_DEVICE: 'AbC-_9' }));
    expect(phone).toMatchObject({ mode: 'phone', sink: { none: 'the quick tunnel did not come up in 3 tries' }, laneB: 'required', phoneDevice: 'AbC-_9' });
    expect(readRun(env({ DESK_STAGING_PHONE: 'cleanup', DESK_STAGING_PHONE_MODE: undefined })).mode).toBe('cleanup');
  });

  it('refuses a run id, a mode or a sink out of grammar, and a missing token or keys file, naming each', () => {
    expect(() => readRun(env({ DESK_STAGING_PHONE_RUN: 'A/1', DESK_STAGING_PHONE_MODE: 'other', DESK_ACCESS_TOKEN: '', DESK_STAGING_ADMIN_KEYS: undefined }))).toThrow(
      /DESK_STAGING_PHONE_RUN is a run id .*; DESK_STAGING_PHONE_MODE is phone or rehearse.*; DESK_STAGING_ADMIN_KEYS .*; DESK_ACCESS_TOKEN/,
    );
    expect(() => readRun(env({ DESK_STAGING_PHONE_SINK: 'http://a.example', DESK_STAGING_PHONE_SINK_PORT: '0' }))).toThrow(/https URL; DESK_STAGING_PHONE_SINK_PORT is a port number/);
    expect(() => readRun(env({ DESK_STAGING_PHONE_DEVICE: 'a b' }))).toThrow(/a device id/);
  });

  it('names the second device by its passkey’s credential id, and reads the run back from it alone', () => {
    expect(cardsRunOf(cardsCredentialId('7'))).toBe('7');
    expect(cardsRunOf(cardsCredentialId('run-12'))).toBe('run-12');
    // The phone's credential (the authenticator's random bytes), and names that are not this harness's.
    for (const other of [btoa('x'.repeat(16)).replace(/=+$/, ''), cardsCredentialId('7').slice(1), 'AAEC', Buffer.from('o13-c-A/1').toString('base64url')]) expect(cardsRunOf(other), other).toBeNull();
  });

  it('runs lane B’s leg once the endpoint feeds its counts, and otherwise waits, or fails when the feed is required', () => {
    expect(laneBLeg(true, 'probe')).toBe('run');
    expect(laneBLeg(true, 'required')).toBe('run');
    expect(laneBLeg(false, 'probe')).toBe('wait');
    expect(laneBLeg(false, 'required')).toBe('fail');
  });
});

describe('the stop line', () => {
  /** An error as undici's fetch raises it: `fetch failed`, what happened kept under `cause`. */
  const failed = (cause: unknown) => new TypeError('fetch failed', { cause });
  const coded = (message: string, code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...extra });

  it('names the cause under undici’s `fetch failed`, its code and its message', () => {
    expect(stopLine(failed(coded('read ECONNRESET', 'ECONNRESET', { errno: -54, syscall: 'read' })))).toBe('fetch failed; cause ECONNRESET: read ECONNRESET');
    expect(stopLine(failed(Object.assign(coded('other side closed', 'UND_ERR_SOCKET'), { name: 'SocketError', socket: { localAddress: '10.0.0.2', remoteAddress: '104.16.0.1' } })))).toBe(
      'fetch failed; cause UND_ERR_SOCKET: other side closed',
    );
    expect(stopLine(new TypeError('terminated', { cause: coded('read ECONNRESET', 'ECONNRESET') }))).toBe('terminated; cause ECONNRESET: read ECONNRESET');
  });

  it('reads an AggregateError’s errors when it has no message of its own (both addresses of a host refused)', () => {
    const both = Object.assign(new AggregateError([coded('connect ECONNREFUSED ::1:8787', 'ECONNREFUSED'), coded('connect ECONNREFUSED 127.0.0.1:8787', 'ECONNREFUSED')], ''), { code: 'ECONNREFUSED' });
    expect(stopLine(failed(both))).toBe('fetch failed; cause ECONNREFUSED: connect ECONNREFUSED ::1:8787, connect ECONNREFUSED 127.0.0.1:8787');
  });

  it('follows the chain a few levels, and an error with no cause is its message alone', () => {
    let deep: Error = coded('the bottom', 'E5');
    for (const level of ['E4', 'E3', 'E2', 'E1']) deep = Object.assign(new Error(`level ${level}`, { cause: deep }), { code: level });
    expect(stopLine(new Error('the top', { cause: deep }))).toBe('the top; cause E1: level E1; cause E2: level E2; cause E3: level E3; cause E4: level E4; …');
    expect(stopLine(new Error('no within 30000 ms'))).toBe('no within 30000 ms');
    expect(stopLine(coded('read ECONNRESET', 'ECONNRESET'))).toBe('ECONNRESET: read ECONNRESET');
    expect(stopLine('a string thrown')).toBe('a string thrown');
    expect(stopLine(new Error('the top', { cause: 'a string' }))).toBe('the top; cause a string');
  });

  it('prints no URL and no query string, at any level, since either can carry a token', () => {
    const top = new TypeError('Request cannot be constructed from a URL that includes credentials: https://user:eyJ.secret@desk.example/api?x=1');
    expect(stopLine(top)).toBe('Request cannot be constructed from a URL that includes credentials: <url>');
    expect(stopLine(new Error('GET /api/listings?project=p&token=eyJ.secret: 403 denied', { cause: coded('the socket to wss://desk.example/api/x?t=eyJ.secret was refused', 'E') }))).toBe(
      'GET /api/listings?<query>: 403 denied; cause E: the socket to <url> was refused',
    );
    expect(stopLine(new Error('GET /api/x?t=a:b:c 500'))).toBe('GET /api/x?<query> 500');
    expect(stopLine(new Error('GET /api/x?t=a:b'))).toBe('GET /api/x?<query>');
    // A host and its port are no secret: undici's connect errors keep them.
    expect(stopLine(failed(coded('getaddrinfo ENOTFOUND desk-hub-staging.example', 'ENOTFOUND', { hostname: 'desk-hub-staging.example' })))).toBe(
      'fetch failed; cause ENOTFOUND: getaddrinfo ENOTFOUND desk-hub-staging.example',
    );
  });
});

describe('the report', () => {
  it('prints each check as it ends, then one line per item: PASS, FAIL, or what it could not show and why', async () => {
    const lines: string[] = [];
    const report = new Report((line) => lines.push(line));
    expect(await report.check('registration', 'the entry', async () => 'listed at version 30')).toBe(true);
    expect(await report.check('round-trip lane A', 'the answers', async () => Promise.reject(new Error('no answer within 600 s')))).toBe(false);
    await report.check('round-trip lane A', 'the refusals', async () => 'replayed, step-up, grade');
    report.hold('round-trip lane B', 'NOT RUN', LANE_B_WAITING);
    await report.check('class-bound', 'every act', async () => 'class ×10');
    report.hold('push-owner-only', 'NOT SHOWN', 'tunnel');
    report.note('freeze-seam', 'the drawn view stands on e2e-hub/cards-landing.spec.ts');
    expect(report.summary()).toBe(false);
    expect(lines).toEqual([
      '  ok    registration · the entry: listed at version 30',
      '  FAIL  round-trip lane A · the answers: no answer within 600 s',
      '  ok    round-trip lane A · the refusals: replayed, step-up, grade',
      '  ok    class-bound · every act: class ×10',
      '  note  freeze-seam: the drawn view stands on e2e-hub/cards-landing.spec.ts',
      'PASS registration',
      'FAIL round-trip lane A',
      "NOT RUN round-trip lane B: waiting on O10's lane B notifier feed",
      'PASS class-bound',
      'NOT SHOWN push-owner-only: tunnel',
      'FAIL freeze-seam: nothing was checked',
    ]);
  });

  it('passes a run whose every item passed or was held for its stated reason', async () => {
    const report = new Report(() => {});
    for (const item of ['registration', 'round-trip lane A', 'class-bound', 'push-owner-only', 'freeze-seam'] as const) await report.check(item, 'it', async () => 'ok');
    report.hold('round-trip lane B', 'NOT RUN', LANE_B_WAITING);
    expect(report.summary()).toBe(true);
  });
});

describe('the sweep, by the run’s names', () => {
  const OWNER = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  async function device(id: string, over: Partial<Device> = {}): Promise<Device> {
    return { id, class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: (await generateSigningKey()).pub, ...over };
  }
  async function cards(id: string, credentialId: string): Promise<Device> {
    return { id, class: 'web-cards', keyStorage: 'webcrypto', channelPub: (await generateSigningKey()).pub, passkey: { credentialId, publicKey: (await generateSigningKey()).pub, rpId: 'desk-hub-staging.opencognita-platform.workers.dev' } };
  }
  async function state(): Promise<OrgState> {
    const machineKey = (await generateSigningKey()).pub;
    return {
      org: 'staging-ssfskim',
      version: 40,
      prev: 'p'.repeat(43),
      issued: '2026-10-28T00:00:00.000Z',
      root: { keys: ['k1'], recoveryPub: 'r' },
      members: [
        { id: OWNER, email: 'owner@example.com', role: 'admin', devices: [await device('a1'), await cards('phone-real', 'cmVhbC1waG9uZQ'), await cards('c-7', cardsCredentialId('7')), await cards('c-8', cardsCredentialId('8'))] },
        { id: B, email: memberEmail('7'), role: 'member', devices: [await device('b1')] },
        { id: 'c'.repeat(32), email: memberEmail('8'), role: 'member', devices: [await device('b1')] },
      ],
      machines: [
        { name: machineName('7'), ref: 'REF7REF7REF7REF7REF7RE', pub: machineKey, owners: [OWNER] },
        { name: 'mini', ref: 'MINIMINIMINIMINIMINIMI', pub: (await generateSigningKey()).pub, owners: [OWNER] },
      ],
      machineNames: [{ name: machineName('7'), ref: 'REF7REF7REF7REF7REF7RE' }],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
  }

  it('finds run 7’s machine, member and second device, and nothing of the phone, the admin device or run 8', async () => {
    const s = await state();
    const residue = residueOf(s, '7', OWNER);
    expect(residue.machines.map((m) => m.name)).toEqual(['o13-phone-7']);
    expect(residue.members.map((m) => m.email)).toEqual(['o13-b-7@staging.invalid']);
    expect(residue.devices.map((d) => d.id)).toEqual(['c-7']);
    expect(residueLines(residue)).toEqual([
      'the state still lists the machine o13-phone-7 (ref REF7REF7REF7REF7REF7RE)',
      'the state still lists the member o13-b-7@staging.invalid',
      "the state still lists the owner's device c-7 (passkey o13-c-7)",
    ]);
    expect(residueLines(residueOf(s, '9', OWNER))).toEqual([]);
  });

  it('takes the residue out in one edit: the machine retired, the member’s and the device’s keys revoked, nothing else moved', async () => {
    const s = await state();
    const undo = (await undoRun(s, '7', OWNER, new Date('2026-10-28T01:00:00.000Z')))!;
    const next = structuredClone(s);
    expect(undo.edit(next)).toBe(true);
    expect(next.machines.map((m) => m.name)).toEqual(['mini']);
    expect(next.members.map((m) => m.email)).toEqual(['owner@example.com', 'o13-b-8@staging.invalid']);
    expect(next.members[0].devices.map((d) => d.id)).toEqual(['a1', 'phone-real', 'c-8']);
    expect(next.retired).toEqual([{ keyId: expect.any(String), pub: s.machines[0].pub, notAfter: '2026-10-28T01:00:00.000Z', holder: { machine: 'REF7REF7REF7REF7REF7RE' } }]);
    expect(next.revoked.map((k) => k.holder as { member: string; device: string; key: string }).map((h) => [h.member, h.device, h.key])).toEqual([
      [B, 'b1', 'channel'],
      [B, 'b1', 'step-up'],
      [OWNER, 'c-7', 'channel'],
    ]);
    // A head that already lacks them: the edit posts nothing; and a state with nothing of the run, no undo at all.
    expect(undo.edit(next)).toBe(false);
    expect(await undoRun(next, '7', OWNER, new Date())).toBeNull();
  });

  // A run that ends after its second device posted its pairing entry, before the admin listed it: the entry stays at the
  // hub, unlisted, until it expires (no route removes one), and the sweep says so instead of reading the run clean.
  async function hub(s: OrgState, pending: unknown[]) {
    const log: string[] = [];
    const admin = { member: OWNER, read: async () => ({ state: s }), amend: async (_why: string, edit: (x: OrgState) => boolean) => void edit(s) } as unknown as OrgAdmin;
    const routes: Record<string, unknown> = { '/api/devices/pending': { pending }, '/api/machines': { machines: [] }, '/api/push/subscriptions': { subscriptions: [] } };
    const person = {
      hub: 'https://hub.test',
      headers: {},
      fetch: async () => new Response(null, { status: 404 }),
      json: async (path: string) => {
        if (!(path in routes)) throw new Error(`no route ${path}`);
        return routes[path];
      },
    } as unknown as Person;
    return { left: await sweepRun(admin, person, '7', (line) => log.push(line)), log };
  }
  const entry = async (deviceId: string, credentialId: string) => ({ ...(await cards(deviceId, credentialId)), id: undefined, deviceId, mac: 'm'.repeat(43), member: OWNER, created: '2026-10-28T08:00:00.000Z', expires: '2026-10-28T08:10:00.000Z' });

  it('reports a pairing entry of the run still pending at the hub, with its expiry, and never reads the run clean then', async () => {
    const s = await state();
    const { left, log } = await hub(s, [await entry('c-7-pending', cardsCredentialId('7')), await entry('c-8-pending', cardsCredentialId('8')), await entry('phone', 'cmVhbC1waG9uZQ')]);
    expect(left).toEqual(["the hub still holds o13-c-7's pairing entry (device c-7-pending), unlisted, until it expires at 2026-10-28T08:10:00.000Z"]);
    expect(log.join('\n')).not.toContain('nothing of the run is current');
    expect(residueLines(residueOf(s, '7', OWNER))).toEqual([]);
    expect((await hub(await state(), [])).log).toEqual([expect.stringContaining('nothing of the run is current')]);
  });

  it('knows the run’s push subscriptions by their device or their sink endpoint', () => {
    const devices = new Set(['c-7']);
    expect(isRunSubscription({ endpoint: 'https://gone.trycloudflare.com/staging-run/o13-c-7', device: 'other' }, '7', devices)).toBe(true);
    expect(isRunSubscription({ endpoint: 'https://web.push.apple.com/x', device: 'c-7' }, '7', devices)).toBe(true);
    expect(isRunSubscription({ endpoint: 'https://web.push.apple.com/x', device: 'phone-real' }, '7', devices)).toBe(false);
    expect(isRunSubscription({ endpoint: 'https://gone.trycloudflare.com/staging-run/o13-c-70' }, '7', devices)).toBe(false);
    expect(isRunSubscription({ endpoint: 'not a url' }, '7', devices)).toBe(false);
  });
});

describe('the checks’ judgements', () => {
  const at = { project: 'proj-m8', machine: 'REF7REF7REF7REF7REF7RE' };
  const notice = (session: string, over: Record<string, unknown> = {}) => ({ project: at.project, machine: at.machine, session, kind: 'waiting', ...over });

  it('takes one exact notice per owner’s session and none for another member’s, naming whatever else came', () => {
    expect(pushProblems([notice('la-2'), notice('la-1')], at, ['la-1', 'la-2'], ['la-b'])).toEqual([]);
    expect(pushProblems([notice('la-1'), notice('la-1'), notice('la-b'), notice('la-2', { title: 'leaked' })], at, ['la-1', 'la-2'], ['la-b'])).toEqual([
      '2 notices for la-1',
      `la-2's notice read ${JSON.stringify([notice('la-2', { title: 'leaked' })])}`,
      "1 notice(s) for la-b, not the owner's",
    ]);
    expect(pushProblems([], at, ['la-1'], ['la-b'])).toEqual(['0 notices for la-1']);
  });

  async function cards(id: string, over: Partial<Device> = {}): Promise<Device> {
    return { id, class: 'web-cards', keyStorage: 'webcrypto', channelPub: (await generateSigningKey()).pub, passkey: { credentialId: 'cmVhbA', publicKey: (await generateSigningKey()).pub, rpId: 'desk-hub-staging.opencognita-platform.workers.dev' }, endorsement: { keyId: 'k', sig: 's' } as unknown as Device['endorsement'], ...over };
  }
  const head = (devices: Device[]) => ({ state: { members: [{ id: 'owner', email: 'o', role: 'admin', devices }] } }) as unknown as SignedOrgState;

  it('finds the phone: the device named, else the owner’s one web-cards device no run made', async () => {
    const phone = await cards('phone');
    const harness = await cards('c-7', { passkey: { ...phone.passkey!, credentialId: cardsCredentialId('7') } });
    expect(phoneOf(head([harness, phone]), 'owner', null).id).toBe('phone');
    expect(phoneOf(head([harness, phone]), 'owner', 'c-7').id).toBe('c-7');
    expect(() => phoneOf(head([harness]), 'owner', null)).toThrow(/pair the phone first/);
    const tablet = await cards('tablet');
    expect(() => phoneOf(head([phone, tablet]), 'owner', null)).toThrow(/2 web-cards devices \(phone, tablet\): name the phone with --device <id>/);
    expect(() => phoneOf(head([phone]), 'owner', 'gone')).toThrow(/no device gone/);
  });

  it('holds a web-cards entry to acceptance 1: its class and storage, a passkey for the hub, endorsed, no step-up key', async () => {
    const rpId = 'desk-hub-staging.opencognita-platform.workers.dev';
    expect(webCardsProblems(await cards('phone'), rpId)).toEqual([]);
    const wrong = await cards('phone', { keyStorage: 'software', stepUpPub: (await generateSigningKey()).pub, endorsement: undefined, passkey: { credentialId: 'x', publicKey: 'y', rpId: 'localhost' } });
    expect(webCardsProblems(wrong, rpId)).toEqual(['keyStorage software', 'a stepUpPub', 'passkey rpId localhost', 'no endorsement']);
  });
});

describe('bounded waits', () => {
  it('ends a wait whose probe never settles at its deadline, aborting the probe’s signal', async () => {
    let seen: AbortSignal | null = null;
    const started = Date.now();
    await expect(within((signal) => ((seen = signal), new Promise<never>(() => {})), 'a stalled probe', 300)).rejects.toThrow('no a stalled probe within 300 ms');
    expect(Date.now() - started).toBeLessThan(2000);
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    expect(await within(async () => 'here', 'a probe', 300)).toBe('here');
  });

  it('ends a request whose response trickles, its body’s reading included', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"a":');
      const drip = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(drip));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const person = new BoundedPerson(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'eyJ.synthetic', () => {}, 400);
      const started = Date.now();
      await expect(person.json('/slow')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
