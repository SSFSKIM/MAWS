// The mixed fleet's baseline oracle (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, Interfaces §K): one
// scripted session lane run against a real endpoint and desk-hub's Worker in Miniflare, by an sminos whose hello never
// lists `channels`, and every frame the endpoint sends compared with the frames the endpoint of 77af813a4 sent for the
// same script (mixed-fleet-baseline.json, written by this file's capture mode on that commit, never by hand). `down` is
// every frame the scripted sminos received on its RL10 socket; `up` every frame handed to the hub link's `send`, watched
// as conversation.local.test.ts watches it. Each half is grouped by the frame's `t`, the kinds in name order and a kind's
// frames in the order they were sent, and normalized by §K's rules: the run's identities, signatures, clocks and the
// host's addresses, and nothing else.
//
// Two variants of the script: in `without` no member frame carries `channels`, in `with` S1's and S2's carry C, a
// declared channel's id. Both must equal the baseline (the oracle), and each other (the field isolation). The file
// imports nothing this work added, so it runs on 77af813a4 as on this build: with MAWS_MIXED_FLEET_CAPTURE=<path> it
// writes the baseline there, and otherwise compares with the one beside it.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, type OrgState, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { DeclaredRow, ProjectsSource } from '../../src/shared/machine/registry';
import { fakeServices } from './fake-services';
import { ADMIN, ORG, startMiniflareHub } from './miniflare-hub';
import { genesis, newDevice, successor, type TestDevice } from './org-fixtures';
import { FakeSminos, type Frame } from './rl10/fake-sminos';

/** The commit the baseline was captured on, and the version of the normalization rules it was captured under. */
const FROM = '77af813a4a4a642d747f7511a343448db489a9ab';
const NORMALIZATION = 1;
const BASELINE = join(__dirname, 'mixed-fleet-baseline.json');
const CAPTURE = process.env.MAWS_MIXED_FLEET_CAPTURE;

// The script's constants: invented ids and names.
const NAME = 'fleet-host';
const BUILD = 'mixed-fleet-suite';
const DEVICE = 'fleet-device';
const P = '3f6c1a2e-5b4d-4e7f-9a1b-2c3d4e5f6a7b';
const Q = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const R = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
/** A declared channel's id (version 8, variant 9): the shared vectors' first. */
const C = '5c2a9e10-7b3d-8f41-9a6c-2d4e6f8a0b1c';
const S1 = '51515151-5151-4151-8151-515151515151';
const S2 = '52525252-5252-4252-8252-525252525252';
const FOLDER = '/srv/fleet/plain';
/** How long no frame may come, either way, before a step's effects count as complete. */
const QUIET_MS = 750;

type Half = Record<string, Frame[]>;
type Transcript = { down: Half; up: Half };
type Variant = 'without' | 'with';
type Baseline = { about: string; from: string; normalization: number; variants: Record<Variant, Transcript> };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(check: () => T | Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

/** The index's side as mawsd hands it: one declared folder of project P, a minted plain folder with no anchor. */
class OneFolder implements ProjectsSource {
  readonly #row: DeclaredRow = {
    pid: 'pfleetplain',
    path: FOLDER,
    name: 'plain',
    org: { key: `folder:x:${FOLDER}` as DeclaredRow['org']['key'], name: 'plain', source: 'folder', smnsId: P },
    stated: 'minted',
    statedAt: FOLDER,
  };
  snapshot() {
    return { indexId: 'index-fleet', rows: [structuredClone(this.#row)], statements: [{ path: FOLDER, minted: P, linked: null, anchor: null, name: 'plain', nameRev: null, hidden: false }] };
  }
  restore() {}
  onChange() {
    return () => {};
  }
}

/** S1's or S2's `member` frame, as sminos sends it; `channels` only when given. */
const member = (session: string, project: string, cwd: string, title: string, channels?: string[]) => ({
  t: 'member',
  session,
  alias: session === S1 ? 'main' : 'other',
  project,
  lane: 'A',
  state: 'idle',
  title,
  cwd,
  owners: ['@machine'],
  ownersProof: [],
  origin: { kind: 'terminal' },
  principal: '@machine',
  inference: { kind: 'slot', configDir: '/srv/fleet/config' },
  controller: { lane: 'A', since: '2026-01-02T03:04:05.000Z' },
  access: 'listed',
  shares: [],
  policyRev: 0,
  ...(channels === undefined ? {} : { channels }),
});

/** What one run gives: its frames both ways, raw, and the values rule 1 replaces. */
type Run = { down: Frame[]; up: Frame[]; identities: Record<string, string>; start: number };

/** §K's script, once, on a hub of its own: one endpoint enrolled and listed, and a scripted sminos without `channels`. */
async function runScript(variant: Variant): Promise<Run> {
  const start = Date.now();
  const { hub, stop } = await startMiniflareHub();
  const services = fakeServices();
  let endpoint: Endpoint | null = null;
  let sminos: FakeSminos | null = null;
  try {
    const admin = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    const device: TestDevice = await newDevice(DEVICE);
    const recovery = await generateSigningKey();
    let head: SignedOrgState = await genesis(ORG, admin, device, recovery);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    const accept = async (edit: (s: OrgState) => void) => {
      const next = await successor(head, [device], edit);
      const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
      if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
      head = next;
    };

    // 1. The endpoint, enrolled and listed, connected to the hub, its projects snapshot ended and its record sent.
    const up: Frame[] = [];
    // The endpoint's clock never answers one millisecond twice, so two values in the transcript are equal only when one
    // reading made both, never by two signings landing in the same millisecond (rule 3 names equal values alike).
    let last = 0;
    const now = () => (last = Math.max(Date.now(), last + 1));
    const started = createEndpoint({ build: BUILD, env: {}, now, sleep: (ms) => sleep(Math.min(ms, 50)), projectsSource: new OneFolder() });
    const send = started.hub.send.bind(started.hub);
    started.hub.send = (frame) => {
      up.push(JSON.parse(JSON.stringify(frame)) as Frame);
      return send(frame);
    };
    endpoint = started;
    await started.start(services);
    const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
    const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(device.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
    const enrolling = started.cli('enroll', ['--name', NAME, '--wait', '30', '--json'], code);
    const key = await until(async () => {
      const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
      return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
    }, 'the posted key');
    await accept((s) => {
      s.machines.push({ name: NAME, ref: services.machine.ref, pub: key.pub, owners: [admin] });
      s.machineNames.push({ name: NAME, ref: services.machine.ref });
    });
    expect((await enrolling).code).toBe(0);
    const rl10Path = join(services.machine.stateDir, 'rl10.json');
    await until(() => started.hub.connected && started.registry.directory().complete && up.some((f) => f.t === 'projects') && started.rl10.serving && fs.existsSync(rl10Path), 'the hub link, its snapshot, the record and rl10.json');

    const down = (): Frame[] => sminos?.received ?? [];
    /**
     * Waits for `done` (what a step causes, seen), then until no frame has come either way for QUIET_MS: the counts are
     * sampled after each wait and before the window is judged, so a frame in the window's last wait restarts it.
     */
    const settled = async (done: () => boolean, what: string) => {
      await until(done, what);
      const sample = () => `${down().length}/${up.length}`;
      let counts = sample();
      let quiet = Date.now();
      for (;;) {
        await sleep(25);
        const now = sample();
        if (now !== counts) [counts, quiet] = [now, Date.now()];
        else if (Date.now() - quiet >= QUIET_MS) return;
      }
    };
    await settled(() => true, 'the endpoint at rest');

    // 2. sminos's hello, listing audience, record and locations, and never channels.
    const info = JSON.parse(fs.readFileSync(rl10Path, 'utf8')) as { socket: string; token: string };
    const s = await FakeSminos.open(info.socket);
    sminos = s;
    s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['audience', 'record', 'locations'], token: info.token, sminos: { version: 'mixed-fleet' }, policy: { read_only: false, ceiling: 'settings' } });
    // sminos's responders: each kept org frame acknowledged, each `snapshots?` answered as a log with no remote snapshot.
    const asks: string[] = [];
    let seen = 0;
    const responder = setInterval(() => {
      for (; seen < s.received.length; seen++) {
        const frame = s.received[seen];
        const gen = (frame.locations as { gen?: number } | undefined)?.gen;
        if (frame.t === 'org' && typeof gen === 'number') s.send({ t: 'locations-kept', gen });
        if (frame.t === 'snapshots?') {
          asks.push(frame.id as string);
          s.send({ t: 'snapshots', id: frame.id, project: frame.project, events: [], next: null, done: true });
        }
      }
    }, 10);
    try {
      const has = (t: string, match: (f: Frame) => boolean = () => true, n = 1) => s.received.filter((f) => f.t === t && match(f)).length >= n;
      await settled(() => has('welcome') && has('org'), 'the welcome and the org frame');
      const listings = (session: string) => up.filter((f) => f.t === 'listing' && (f.record as { body: { session: string } }).body.session === session).length;
      const records = () => up.filter((f) => f.t === 'projects').length;

      // 3. P's machine presence; S1 (lane A, project P); S2 (lane A, project Q, which has no folder here); restated.
      // Each waits on what it is seen to cause: the checkout held, each session held and its audience told, the
      // restatement closed.
      const members = started.rl10.members;
      const audienceOf = (session: string) => has('audience', (f) => f.session === session);
      s.send({ t: 'session', message: { project: P, machine: NAME, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'settings' }, checkouts: [{ path: FOLDER, branch: 'main' }] } } });
      await settled(() => members.projectOfCheckout(FOLDER) === P, 'the presence’s checkout held');
      const channels = variant === 'with' ? [C] : undefined;
      s.send(member(S1, P, FOLDER, 'the main session', channels));
      await settled(() => members.get(S1) !== null && audienceOf(S1), 'S1 held and its audience told');
      s.send(member(S2, Q, '/srv/fleet/elsewhere', 'another session', channels));
      await settled(() => members.get(S2) !== null && audienceOf(S2), 'S2 held and its audience told');
      s.send({ t: 'restated' });
      await settled(() => started.rl10.sminosView()?.restating === false, 'the restatement closed');

      // 4. Log-plane hellos, one at a time: P and Q without follow, R following, and C, a channel's id, without follow.
      // P's opening lists S1, a session of a project the endpoint now relays; Q's lists S2, and makes Q known, so the
      // record is signed again and the directory names Q.
      const orgNames = (id: string) => (f: Frame) => (f.projects as Array<{ id: string }>).some((p) => p.id === id);
      for (const [project, follow] of [[P, false], [Q, false], [R, true], [C, false]] as const) {
        const before = records();
        s.send({ t: 'hello', project, name: `log-${project.slice(0, 4)}`, have: {}, ...(follow ? { follow: true } : {}) });
        const caused = () =>
          (project === P ? listings(S1) > 0 : true) && (project === Q ? listings(S2) > 0 && records() > before && has('org', orgNames(Q)) : true);
        await settled(() => has('have', (f) => f.project === project) && caused(), `the have of ${project} and what it causes`);
      }

      // 5. S1's member frame again, under another title.
      const s1 = listings(S1);
      s.send(member(S1, P, FOLDER, 'the main session, renamed', channels));
      await settled(() => listings(S1) > s1, 'S1’s second listing');

      // 6. S2 gone: its listing withdrawn, Q no longer known.
      const [s2, before, told] = [listings(S2), records(), s.received.length];
      s.send({ t: 'member', session: S2, gone: true });
      const orgAfter = () => s.received.slice(told).some((f) => f.t === 'org' && !orgNames(Q)(f));
      await settled(() => listings(S2) > s2 && records() > before && orgAfter(), 'S2’s withdrawal, the record without Q and the directory without it');
    } finally {
      clearInterval(responder);
    }

    const enrollment = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'enrollment.json'), 'utf8')) as { at: string };
    const machineKey = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'machine-key.json'), 'utf8')) as { keyId: string };
    const identities: Record<string, string> = {
      org: ORG,
      hub: hub.url,
      name: NAME,
      ref: services.machine.ref,
      kid: machineKey.keyId,
      enrolled: enrollment.at,
      build: BUILD,
      token: info.token,
      member: admin,
      device: DEVICE,
      root: fs.realpathSync(services.machine.profileDir),
    };
    asks.forEach((id, i) => (identities[`ask:${i + 1}`] = id));
    return { down: structuredClone(s.received), up: structuredClone(up), identities, start };
  } finally {
    sminos?.close();
    await endpoint?.stop();
    services.cleanup();
    await stop();
  }
}

// ---- The transcript and its normalization (§K, version 1) ----------------------------------------------------------

/** Frames grouped by `t`, the kinds in name order, a kind's frames in the order they were sent. */
function grouped(frames: readonly Frame[]): Half {
  const half: Half = {};
  for (const t of [...new Set(frames.map((f) => f.t))].sort()) half[t] = frames.filter((f) => f.t === t);
  return half;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `value` with `leaf` applied to every string and number, and `key` to every object key; keys walked in name order. */
function mapped(value: unknown, leaf: (v: string | number) => unknown, key: (k: string) => string = (k) => k): unknown {
  if (Array.isArray(value)) return value.map((v) => mapped(v, leaf, key));
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [key(k), mapped(value[k], leaf, key)]));
  return typeof value === 'string' || typeof value === 'number' ? leaf(value) : value;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** §K's normalization of one run: identities, signatures, clocks, the host's addresses, in that order, and nothing else. */
function normalized(run: Run): Transcript {
  // 1. Identities: each value the run made or was given, wherever it occurs in a string or a key, the longest first.
  const named = Object.entries(run.identities)
    .filter(([, value]) => value !== '')
    .sort(([, a], [, b]) => b.length - a.length);
  const replace = (text: string) => named.reduce((t, [name, value]) => t.split(value).join(`{{${name}}}`), text);
  let value = mapped({ down: grouped(run.down), up: grouped(run.up) }, (v) => (typeof v === 'string' ? replace(v) : v), replace) as Transcript;
  // 2. Signatures: a `sig`'s non-empty `value`.
  const signatures = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(signatures);
    if (!isObject(v)) return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, signatures(x)]));
    if (isObject(out.sig) && typeof out.sig.value === 'string' && out.sig.value !== '') out.sig = { ...out.sig, value: '{{sig}}' };
    return out;
  };
  value = signatures(value) as Transcript;
  // 3. Clocks: instants and millisecond counts from the run's start on, numbered in the walk's order of first meeting.
  const times = new Map<string, string>();
  const clocks = new Map<number, string>();
  value = mapped(value, (v) => {
    if (typeof v === 'string' && ISO_INSTANT.test(v) && Date.parse(v) >= run.start) {
      if (!times.has(v)) times.set(v, `{{time:${times.size + 1}}}`);
      return times.get(v);
    }
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= run.start) {
      if (!clocks.has(v)) clocks.set(v, `{{clock:${clocks.size + 1}}}`);
      return clocks.get(v);
    }
    return v;
  }) as Transcript;
  // 4. The host: an endpoint record's addresses, by position.
  for (const frame of value.up.endpoint ?? []) {
    const body = (frame.record as { body?: { addresses?: unknown } } | undefined)?.body;
    if (body !== undefined && Array.isArray(body.addresses)) body.addresses = body.addresses.map((_, i) => `{{address:${i + 1}}}`);
  }
  return value;
}

/** Where `got` differs from `expected`, each difference a path that opens with its half and its kind (`up.projects[1]…`). */
function differences(expected: unknown, got: unknown, path = ''): string[] {
  if (Array.isArray(expected) || Array.isArray(got)) {
    if (!Array.isArray(expected) || !Array.isArray(got)) return [`${path}: ${JSON.stringify(got)?.slice(0, 200)}, expected ${JSON.stringify(expected)?.slice(0, 200)}`];
    if (expected.length !== got.length) return [`${path}: ${got.length} entries, expected ${expected.length}`];
    return expected.flatMap((e, i) => differences(e, got[i], `${path}[${i}]`));
  }
  if (isObject(expected) || isObject(got)) {
    if (!isObject(expected) || !isObject(got)) return [`${path}: ${JSON.stringify(got)?.slice(0, 200)}, expected ${JSON.stringify(expected)?.slice(0, 200)}`];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(got)])].sort();
    return keys.flatMap((k) => differences(expected[k], got[k], path === '' ? k : `${path}.${k}`));
  }
  return expected === got ? [] : [`${path}: ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`];
}

/** JSON with every object's keys in name order, two spaces, a trailing newline. */
const written = (value: unknown) => `${JSON.stringify(mapped(value, (v) => v), null, 2)}\n`;

// ---- The suite -----------------------------------------------------------------------------------------------------

describe('the mixed fleet: an sminos without channels', () => {
  const runs = new Map<Variant, Transcript>();
  const transcript = async (variant: Variant) => {
    if (!runs.has(variant)) runs.set(variant, normalized(await runScript(variant)));
    return runs.get(variant)!;
  };

  if (CAPTURE !== undefined) {
    it('captures the baseline: master’s frames for the script, which are the same with channels on the member frames', async () => {
      const without = await transcript('without');
      const withChannels = await transcript('with');
      expect(differences(without, withChannels)).toEqual([]);
      const from = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
      const baseline: Baseline = {
        about: 'The endpoint’s frames for an sminos whose hello does not list `channels` (MAWS docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, Interfaces §K): one scripted session lane against desk-hub’s Worker in Miniflare, `down` every frame sminos received on RL10 and `up` every frame handed to the hub link’s `send`, grouped by `t` and normalized by the rules of version `normalization`. Written by test/endpoint/mixed-fleet.local.test.ts’s capture mode on commit `from`, never by hand.',
        from,
        normalization: NORMALIZATION,
        variants: { without, with: withChannels },
      };
      fs.writeFileSync(CAPTURE, written(baseline));
    }, 240_000);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;

  it('holds a baseline captured from 77af813a4 under this file’s normalization, with what the refusal cases need', () => {
    expect(baseline.from).toBe(FROM);
    expect(baseline.normalization).toBe(NORMALIZATION);
    const { down, up } = baseline.variants.without;
    expect(down.org?.length).toBeGreaterThan(0);
    expect(up.projects?.some((f) => ((f.record as { body: { known: unknown[] } }).body.known.length > 0))).toBe(true);
  });

  it('gives master’s frames, both ways, for the script without channels', async () => {
    expect(differences(baseline.variants.without, await transcript('without'))).toEqual([]);
  }, 120_000);

  it('gives master’s frames, both ways, with channels on the member frames', async () => {
    expect(differences(baseline.variants.with, await transcript('with'))).toEqual([]);
  }, 120_000);

  it('gives the same frames with channels on the member frames as without (the field isolation)', async () => {
    expect(differences(await transcript('without'), await transcript('with'))).toEqual([]);
  }, 240_000);

  it('refuses a transcript with a field added, a known entry altered or added, or a frame dropped, naming the kind', async () => {
    const own = await transcript('without');
    const refused = (kind: string, change: (t: Transcript) => void) => {
      const altered = structuredClone(own);
      change(altered);
      const found = differences(baseline.variants.without, altered);
      expect(found.length, kind).toBeGreaterThan(0);
      for (const difference of found) expect(difference.startsWith(`${kind}[`) || difference.startsWith(`${kind}:`), difference).toBe(true);
    };
    type Body = { known: Array<{ id: string; name: string }> } & Record<string, unknown>;
    const knownRecord = (t: Transcript) => t.up.projects.map((f) => (f.record as { body: Body }).body).find((body) => body.known.length > 0)!;
    refused('down.welcome', (t) => void (t.down.welcome[0].added = true));
    refused('up.projects', (t) => void ((t.up.projects[0].record as { body: Body }).body.added = true));
    refused('up.projects', (t) => void (knownRecord(t).known[0].id = R));
    refused('up.projects', (t) => void knownRecord(t).known.push({ id: C, name: 'log-5c2a' }));
    refused('up.listing', (t) => void t.up.listing.pop());
  }, 120_000);
});
