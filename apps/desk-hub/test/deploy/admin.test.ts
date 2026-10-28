// `deployment admin` (P5 O13 M2, §F; RL DL28) against the suites' local hub, and its refusals offline: the admin
// device's keys file and where it may live, a genesis whose recovery key goes only to its destination and is checked
// back, a genesis interrupted between its POST and its anchor finished by a rerun, the adoption of an org rooted before
// it, the refresh, a pairing (the code, the MAC, the fingerprint, the two-entries refusal) and a revocation; and,
// against a deployment, the stop at /dev/tty before any request when the shell has no controlling terminal.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  base64urlDecode,
  base64urlEncode,
  canonicalize,
  decodePairingCode,
  generateSigningKey,
  keyId,
  pairingFingerprint,
  pairingMac,
  signOrgState,
  stateHash,
  verifySuccessor,
  type Device,
  type PairingCode,
  type SignedOrgState,
} from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchorFile, ageLine, genesisFile, isRpId, judgeEntry, printable, runAdmin, type AdminIo } from '../../deploy/admin.ts';
import { keysPlacementProblem, machinePlacement, newRecoveryKey, readAdminKeys, readText, recoveryFileText, volumeOf } from '../../deploy/admin-device.ts';
import { deviceEntry, successor } from '../../deploy/org-admin.ts';
import type { PendingDevice } from '../../src/protocol/identity';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';
import { adminKeysFile } from '../support/local-person';
import { endorsed, genesis as genesisOf, next, signedBy, type TestDevice } from '../support/org';

const APP = join(import.meta.dirname, '../..');
const BIN = join(APP, 'deploy/bin.ts');
const scratch = mkdtempSync(join(tmpdir(), 'deployment-admin-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A directory of its own under the scratch directory. */
let dirs = 0;
const dir = (name: string) => {
  const path = join(scratch, `${name}-${++dirs}`);
  mkdirSync(path, { recursive: true });
  return path;
};
/** The scratch directory stands outside every refused place: its own home and temporary roots are elsewhere. */
const placement = { home: join(scratch, 'home'), tmpRoots: [join(scratch, 'swept')] };

type Fake = { io: AdminIo; out: string[]; err: string[]; term: string[]; execs: Array<{ command: string; args: string[]; input?: string }>; requests: string[] };

/** The command's world, recorded: what it printed, wrote to the terminal and ran; `answers` are typed at the terminal. */
function fake(answers: string[] = [], over: Partial<AdminIo> = {}): Fake {
  const f: Fake = { out: [], err: [], term: [], execs: [], requests: [], io: undefined as unknown as AdminIo };
  f.io = {
    out: (line) => f.out.push(line),
    err: (line) => f.err.push(line),
    openTerminal: () => ({ write: (text) => void f.term.push(text), readLine: async () => answers.shift() ?? '' }),
    secrets: async () => ({ DESK_ACCESS_TOKEN: 'eyJ.not-a-token' }),
    exec: async (command, args, input) => void f.execs.push({ command, args, input }),
    volumeOf,
    removableVolume: () => false,
    readText,
    placement,
    env: {},
    appDir: APP,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
    ...over,
  };
  return f;
}

/** A deployment's config naming a host no request can reach (`.invalid`): a run that sent one would fail otherwise. */
function unreachableConfig(): string {
  const file = join(dir('config'), 'config.json');
  writeFileSync(file, JSON.stringify({ account: 'acct', worker: 'admin-test', host: 'admin-test.example.invalid', ownerEmail: ADMIN, sessionDuration: '720h', org: { id: 'admin-test', name: 'admin test' } }));
  return file;
}

describe('init', () => {
  it('writes the keys 0600, never over a file, and asks Time Machine to leave them out', async () => {
    const keys = join(dir('keys'), 'admin', 'keys.json');
    const f = fake();
    expect(await runAdmin(['init', '--keys', keys], f.io)).toBe(0);
    expect(statSync(keys).mode & 0o777).toBe(0o600);
    const file = JSON.parse(readFileSync(keys, 'utf8')) as { device: string; keys: Record<string, JsonWebKey> };
    expect(file.device).toMatch(/^deployment-admin-[0-9a-f]{12}$/);
    expect(Object.keys(file.keys).sort()).toEqual([`${file.device}.channel`, `${file.device}.stepUp`]);
    expect(f.out[0]).toBe(`keys written: ${keys} (device ${file.device})`);
    expect(f.execs).toEqual([{ command: 'tmutil', args: ['addexclusion', keys], input: undefined }]);
    // Never written over.
    const before = readFileSync(keys, 'utf8');
    const again = fake();
    expect(await runAdmin(['init', '--keys', keys], again.io)).toBe(1);
    expect(again.err.join('\n')).toMatch(/exists: an admin device's keys are never written over/);
    expect(readFileSync(keys, 'utf8')).toBe(before);
    expect(again.execs).toEqual([]);
  });

  it('asks Time Machine to leave the file out while it is still empty, and writes no key when it cannot', async () => {
    const keys = join(dir('keys'), 'keys.json');
    const seen: string[] = [];
    const f = fake([], { exec: async (_command, args) => void seen.push(readFileSync(args[1], 'utf8')) });
    expect(await runAdmin(['init', '--keys', keys], f.io)).toBe(0);
    expect(seen).toEqual(['']);
    expect(statSync(keys).mode & 0o777).toBe(0o600);
    expect((await readAdminKeys(keys)).id).toMatch(/^deployment-admin-/);

    const failing = join(dir('keys'), 'keys.json');
    const refused = fake([], {
      exec: async () => {
        throw new Error('tmutil exited 1: not permitted');
      },
    });
    expect(await runAdmin(['init', '--keys', failing], refused.io)).toBe(1);
    expect(refused.err.join('\n')).toMatch(/tmutil addexclusion .* failed \(tmutil exited 1: not permitted\): no key was written and the file was removed/);
    expect(existsSync(failing)).toBe(false);
    expect(refused.out).toEqual([]);
  });

  it('refuses a path a sweep, a commit, a sync or a backup would carry, and writes nothing there', async () => {
    const repo = dir('repo');
    mkdirSync(join(repo, '.git'));
    const refused = [
      [join(placement.tmpRoots[0], 'keys.json'), /a sweep empties/],
      [join(repo, 'nested', 'keys.json'), /inside the git work tree/],
      [join(placement.home, '.claude', 'keys.json'), /synced or backed up/],
      [join(placement.home, 'Library', 'Mobile Documents', 'keys.json'), /synced or backed up/],
      [join(placement.home, '.config', 'claude-secrets', 'admin', 'keys.json'), /synced or backed up/],
    ] as const;
    for (const [keys, why] of refused) {
      const f = fake();
      expect(await runAdmin(['init', '--keys', keys], f.io), keys).toBe(1);
      expect(f.err.join('\n'), keys).toMatch(why);
      expect(existsSync(keys), keys).toBe(false);
      expect(f.execs).toEqual([]);
    }
  });

  it("takes the machine's own temporary roots: /tmp, /private/tmp and $TMPDIR", () => {
    expect(machinePlacement({ TMPDIR: '/var/folders/xy/T/' }, '/Users/someone')).toEqual({ home: '/Users/someone', tmpRoots: ['/tmp', '/private/tmp', '/var/folders/xy/T/'] });
    expect(keysPlacementProblem('/tmp/admin/keys.json', machinePlacement({}, '/Users/someone'))).toMatch(/a sweep empties/);
  });
});

describe('the options', () => {
  it('takes --yes only at the local hub, and the local hub only on loopback', async () => {
    const keys = join(dir('keys'), 'keys.json');
    for (const [args, why] of [
      [['refresh', '--keys', keys, '--yes'], /--yes answers the confirmations only at the local hub/],
      [['refresh', '--keys', keys, '--config', unreachableConfig(), '--yes'], /--yes answers the confirmations only at the local hub/],
      [['refresh', '--keys', keys, '--hub', 'https://desk-hub-staging.opencognita-platform.workers.dev', '--user', ADMIN, '--yes'], /names the suites' local hub on loopback/],
      [['refresh', '--keys', keys, '--hub', 'http://127.0.0.1:1'], /--hub and --user go together/],
      [['genesis', '--keys', keys, '--class', 'web-cards', '--hub', 'http://127.0.0.1:1', '--user', ADMIN], /--class is pair's option/],
      [['devices', '--keys', keys, '--keys', keys, '--hub', 'http://127.0.0.1:1', '--user', ADMIN], /name one --config and one --keys/],
    ] as const) {
      const f = fake();
      expect(await runAdmin([...args], f.io), args.join(' ')).toBe(1);
      expect(f.err.join('\n'), args.join(' ')).toMatch(why);
    }
    const f = fake();
    expect(await runAdmin(['forge', '--keys', keys], f.io)).toBe(2);
    expect(f.err[0]).toMatch(/^usage: deployment admin <init \| genesis \| adopt \| refresh \| pair \| devices \| remove-device>/);
  });
});

describe('against a deployment', () => {
  /** The command as the owner's shell runs it, but with no controlling terminal (a new session), as an agent's has none. */
  const detached = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', BIN, 'admin', ...args], {
        cwd: APP,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, DESK_ADMIN_KEYS: '' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.stdin.end('DESK_ACCESS_TOKEN=eyJ.not-a-token\n');
      const timer = setTimeout(() => (child.kill('SIGKILL'), reject(new Error(`admin ${args[0]} still running after 60 s`))), 60_000);
      child.on('close', (code) => (clearTimeout(timer), resolve({ code, stdout, stderr })));
    });

  it('stops genesis, pair and remove-device at /dev/tty when the shell has none, before any request', async () => {
    const config = unreachableConfig();
    const keys = join(dir('keys'), 'keys.json');
    const recovery = join(dir('volume'), 'recovery.json');
    const runs = await Promise.all([
      detached(['genesis', '--config', config, '--keys', keys, '--recovery', recovery]),
      detached(['pair', '--class', 'web-cards', '--config', config, '--keys', keys]),
      detached(['remove-device', 'phone-1', '--config', config, '--keys', keys]),
    ]);
    for (const run of runs) {
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(/cannot open \/dev\/tty \(Device not configured: no controlling terminal\): (genesis|pair|remove-device) asks the owner there before it signs anything; nothing was sent/);
      expect(run.stdout).toBe('');
    }
    expect(existsSync(recovery)).toBe(false);
  }, 120_000);

  it("refuses a recovery destination on the keys' volume, on internal media, beside the keys, or in a sync or backup scope, before any request", async () => {
    const config = unreachableConfig();
    const keys = join(dir('keys'), 'keys.json');
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    const volume = dir('volume');
    const cases: Array<[string, Partial<AdminIo>, RegExp]> = [
      [join(volume, 'recovery.json'), { removableVolume: () => true }, /on the same volume as the admin keys/],
      // Another volume, but an internal disk's (a second APFS volume, say) or a mounted disk image: not the owner's medium.
      [join(volume, 'recovery.json'), { volumeOf: (path) => (path.startsWith(volume) ? 'other' : 'internal') }, /is not on removable or external media/],
      [
        join(volume, 'recovery.json'),
        {
          volumeOf: (path) => (path.startsWith(volume) ? 'other' : 'internal'),
          removableVolume: () => {
            throw new Error('diskutil: no such disk');
          },
        },
        /could not tell whether .* is on removable media \(diskutil: no such disk\)/,
      ],
      [join(volume, 'recovery.json'), { volumeOf: (path) => (path.startsWith(volume) ? 'removable' : 'internal'), removableVolume: (path) => path.startsWith(volume) }, /^$/],
      [join(keys, '..', 'recovery.json'), { volumeOf: () => 'any' }, /beside the admin keys/],
      [join(placement.home, '.claude', 'recovery.json'), { volumeOf: (path) => (path.startsWith(placement.home) ? 'removable' : 'internal') }, /synced or backed up/],
    ];
    for (const [recovery, over, why] of cases) {
      const f = fake([], {
        ...over,
        secrets: async () => {
          f.requests.push('secrets');
          return {};
        },
      });
      const status = await runAdmin(['genesis', '--config', config, '--keys', keys, '--recovery', recovery], f.io);
      if (why.source === '^$') {
        // A destination on another, removable volume passes: the run goes on to read the token, which this one lacks.
        expect(f.err.join('\n')).toMatch(/DESK_ACCESS_TOKEN on stdin/);
        expect(f.requests).toEqual(['secrets']);
        continue;
      }
      expect(status, recovery).toBe(1);
      expect(f.err.join('\n'), recovery).toMatch(why);
      expect(f.requests, recovery).toEqual([]);
      expect(existsSync(recovery)).toBe(false);
    }
  });
});

describe('on the local hub', () => {
  let hub: LocalHub;
  const asLocal = (keys: string) => ['--hub', hub.url, '--user', ADMIN, '--keys', keys];
  const served = async () => (await hub.fetchAs(ADMIN, '/api/org/state?since=0').then((r) => r.json())) as { head: SignedOrgState | null; chain: SignedOrgState[] };

  beforeAll(async () => {
    hub = await startLocalHub();
  });
  afterAll(() => hub?.close());

  const keys = join(scratch, 'owner-keys', 'keys.json');
  let member: string;
  let genesisHash: string;

  it('roots the org only once the recovery key reads back as recoveryPub, a corrupted file refused with nothing posted', async () => {
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    member = ((await hub.fetchAs(ADMIN, '/api/me').then((r) => r.json())) as { member: { id: string } }).member.id;
    const recovery = join(dir('volume'), 'recovery.json');
    // The file is corrupted between its write and its read-back: another key's scalar in its place.
    const other = (await crypto.subtle.exportKey('jwk', (await generateSigningKey(true)).privateKey)) as JsonWebKey;
    const f = fake([], {
      readText: (path) => {
        const file = JSON.parse(readText(path)) as { key: JsonWebKey };
        writeFileSync(path, JSON.stringify({ ...file, key: { ...file.key, d: other.d } }));
        return readText(path);
      },
    });
    expect(await runAdmin(['genesis', '--recovery', recovery, ...asLocal(keys), '--yes'], f.io)).toBe(1);
    expect(f.out[0]).toBe('head: none');
    expect(f.err.join('\n')).toMatch(/is not recoveryPub's pair: nothing was signed/);
    expect((await served()).head).toBeNull();
    expect(existsSync(anchorFile(keys)) || existsSync(genesisFile(keys))).toBe(false);
  });

  it('takes a paper recovery key typed back, refusing a wrong one, and prints the genesis hash', async () => {
    const wrong = fake(['AAAA BBBB']);
    expect(await runAdmin(['genesis', '--recovery', 'paper', ...asLocal(keys), '--yes'], wrong.io)).toBe(1);
    expect(wrong.err.join('\n')).toMatch(/the key typed back is not the recovery key shown: nothing was signed/);
    expect((await served()).head).toBeNull();

    const answers: string[] = [];
    const f = fake(answers);
    // The terminal shows the key once; the owner types it back from the paper.
    f.io.openTerminal = () => ({
      write: (text) => {
        f.term.push(text);
        const shown = /\n\n {4}([A-Za-z0-9_\- ]+)\n\n/.exec(text);
        if (shown) answers.push(shown[1]);
      },
      readLine: async () => answers.shift() ?? '',
    });
    expect(await runAdmin(['genesis', '--recovery', 'paper', ...asLocal(keys), '--yes'], f.io)).toBe(0);
    expect(f.out[0]).toBe('head: none');
    expect(f.out).toContain('recovery key typed back: matches recoveryPub');
    expect(f.out).toContain(`root ${ORG} at ${hub.url}? [y/N] yes (--yes)`);
    const { head, chain } = await served();
    genesisHash = await stateHash(head!.state);
    expect(f.out).toContain(`genesis posted: version 1, orgGenesis ${genesisHash}`);
    expect(chain).toHaveLength(1);
    expect(head!.state.members).toEqual([{ id: member, email: ADMIN, role: 'admin', devices: [expect.objectContaining({ class: 'native-mac', keyStorage: 'software' })] }]);
    // The anchor holds recoveryPub alone of the recovery key, and nothing of the private half is beside the keys.
    const anchor = JSON.parse(readFileSync(anchorFile(keys), 'utf8')) as Record<string, unknown>;
    expect(anchor).toEqual({ hub: hub.url, org: ORG, genesis: genesisHash, version: 1, roots: head!.state.root.keys, recoveryPub: head!.state.root.recoveryPub });
    const shown = f.term.join('').match(/\n\n {4}([A-Za-z0-9_\- ]+)\n\n/)![1].replace(/ /g, '');
    for (const name of readdirSync(join(keys, '..'))) expect(readFileSync(join(keys, '..', name), 'utf8')).not.toContain(shown);
    expect(f.out.join('\n')).not.toContain(shown);
  });

  it('refuses a genesis where the hub holds a state', async () => {
    const second = join(dir('second'), 'keys.json');
    expect(await runAdmin(['init', '--keys', second], fake().io)).toBe(0);
    const f = fake();
    expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...asLocal(second), '--yes'], f.io)).toBe(1);
    expect(f.out[0]).toBe('head version 1, issued 0 days ago');
    expect(f.err.join('\n')).toMatch(/the hub holds a state \(version 1\): genesis roots an org with none/);
    const again = fake();
    expect(await runAdmin(['genesis', '--recovery', 'paper', ...asLocal(keys), '--yes'], again.io)).toBe(1);
    expect(again.err.join('\n')).toMatch(/this device anchors an org already, and genesis runs once/);
  });

  it('refreshes with a no-change successor, the head age first', async () => {
    const before = (await served()).head!;
    const f = fake();
    expect(await runAdmin(['refresh', ...asLocal(keys)], f.io)).toBe(0);
    expect(f.out).toEqual(['head version 1, issued 0 days ago', 'refreshed: version 2 (no change)']);
    const after = (await served()).head!;
    expect(after.state.version).toBe(2);
    expect(after.state.prev).toBe(await stateHash(before.state));
    const { version, prev, issued, ...rest } = after.state;
    const { version: v1, prev: p1, issued: i1, ...was } = before.state;
    expect([version, prev === p1, issued >= i1, v1]).toEqual([2, false, true, 1]);
    expect(rest).toEqual(was);
    expect(JSON.parse(readFileSync(anchorFile(keys), 'utf8')).version).toBe(2);
  });

  /** A phone's pending entry under `code`, posted as the owner's member; `device` overrides its fields. */
  async function phone(code: PairingCode, id: string, k = base64urlDecode(code.k), override: Partial<Omit<Device, 'endorsement'>> = {}) {
    const channel = await generateSigningKey();
    const passkey = await generateSigningKey();
    const device: Omit<Device, 'endorsement'> = {
      id,
      class: 'web-cards',
      keyStorage: 'webcrypto',
      channelPub: channel.pub,
      passkey: { credentialId: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), publicKey: passkey.pub, rpId: new URL(code.hub).hostname },
      ...override,
    };
    return { device, post: async (d = device, key = k) => postEntry(d, await pairingMac(key, { org: code.org, member: code.member, device: d })) };
  }
  const postEntry = async (device: Omit<Device, 'endorsement'>, mac: string) => {
    const { id, ...rest } = device;
    return hub.fetchAs(ADMIN, '/api/devices/pending', { body: { deviceId: id, ...rest, mac } });
  };

  /** `pair` running, and the code it printed once it has. */
  async function pairing(f: Fake, extra: string[] = ['--yes'], cls = 'web-cards', ttl = '20') {
    const running = runAdmin(['pair', '--class', cls, '--ttl', ttl, ...asLocal(keys), ...extra], f.io);
    const deadline = Date.now() + 15_000;
    let line: string | undefined;
    while (!(line = f.out.find((l) => l.startsWith('pairing code: '))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const code = decodePairingCode(line?.slice('pairing code: '.length) ?? '');
    expect(code).not.toBeNull();
    return { running, code: code! };
  }

  let phoneDevice: Omit<Device, 'endorsement'>;

  it('pairs a phone: the code carries the pins, another secret is ignored, the fingerprint shown is the package\'s, and the head lists it endorsed', async () => {
    const before = (await served()).head!;
    const f = fake();
    const { running, code } = await pairing(f);
    expect(code).toEqual({ hub: hub.url, org: ORG, member, roots: before.state.root.keys, recoveryPub: before.state.root.recoveryPub, k: expect.any(String) });
    const decoy = await phone(code, 'decoy-phone', crypto.getRandomValues(new Uint8Array(16)));
    expect((await decoy.post()).status).toBe(201);
    const real = await phone(code, 'owner-phone');
    expect((await real.post()).status).toBe(201);
    expect(await running).toBe(0);
    expect(f.out[0]).toBe('head version 2, issued 0 days ago');
    expect(f.out).toContain("not this pairing's: decoy-phone (its MAC is not under this code's secret)");
    const print = await pairingFingerprint(ORG, member, real.device);
    expect(f.out).toContain(`pending: owner-phone web-cards webcrypto rpId 127.0.0.1 fingerprint ${print}`);
    expect(f.out.at(-1)).toBe('listed: version 3');
    const { head } = await served();
    const listed = head!.state.members[0].devices.find((d) => d.id === 'owner-phone')!;
    const { endorsement, ...bare } = listed;
    expect(bare).toEqual(real.device);
    expect(endorsement?.kid).toBe(await keyId(head!.state.members[0].devices[0].stepUpPub!));
    // The endorsement and the root signature verify as the package checks a successor.
    const chain = (await served()).chain;
    expect(await verifySuccessor(chain[1], chain[2], [])).toEqual({ ok: true });
    // The successor dropped the phone's entry from the pending list.
    const pending = ((await hub.fetchAs(ADMIN, '/api/devices/pending').then((r) => r.json())) as { pending: PendingDevice[] }).pending;
    expect(pending.map((p) => p.deviceId)).toEqual(['decoy-phone']);
    phoneDevice = real.device;
  });

  it("shows another fingerprint for an entry that kept the phone's channel key and swapped its passkey under a leaked k, and signs nothing when not approved", async () => {
    const before = (await served()).head!;
    const f = fake(['n']);
    const { running, code } = await pairing(f, []);
    const own = await phone(code, 'second-phone');
    const swapped: Omit<Device, 'endorsement'> = { ...own.device, passkey: { ...own.device.passkey!, publicKey: (await generateSigningKey()).pub } };
    // The hub serves only the swapped entry, its MAC recomputed under the leaked `k`.
    expect((await own.post(swapped)).status).toBe(201);
    expect(await running).toBe(1);
    const shown = f.out.find((l) => l.startsWith('pending: second-phone'))!;
    const phoneShows = await pairingFingerprint(ORG, member, own.device);
    expect(shown).toBe(`pending: second-phone web-cards webcrypto rpId 127.0.0.1 fingerprint ${await pairingFingerprint(ORG, member, swapped)}`);
    expect(shown).not.toContain(phoneShows);
    expect(f.term.join('')).toBe('compare the fingerprint with the device\'s, then approve? [y/N] ');
    expect(f.err.join('\n')).toMatch(/not approved: nothing was signed/);
    expect((await served()).head!.state.version).toBe(before.state.version);
  });

  it('refuses two entries answering one code, and spends the code', async () => {
    const before = (await served()).head!;
    const f = fake();
    const { running, code } = await pairing(f);
    const one = await phone(code, 'twin-one');
    const two = await phone(code, 'twin-two');
    await Promise.all([one.post(), two.post()]);
    expect(await running).toBe(1);
    expect(f.err.join('\n')).toMatch(/two devices answered this code: start over \(the code is spent\)/);
    expect((await served()).head!.state.version).toBe(before.state.version);
  });

  it("takes no entry whose id or relying party is out of grammar, and prints what the hub supplied with its controls escaped", async () => {
    const before = (await served()).head!;
    const f = fake();
    const { running, code } = await pairing(f, ['--yes'], 'web-cards', '3');
    // Under a leaked `k`: an id carrying a forged line and the controls that would hide the real one, and a relying
    // party carrying a color change. Both MACs verify; the hub stores both (its device id and rpId are free text).
    const forged = '\x1b[2K\rpending: x fingerprint aaaaa-aaaaa\x1b[8m';
    const hostileId = await phone(code, forged);
    expect((await hostileId.post()).status).toBe(201);
    const good = await phone(code, 'rp-phone');
    const hostileRp = { ...good.device, passkey: { ...good.device.passkey!, rpId: 'evil\x1b[31m.example' } };
    expect((await good.post(hostileRp)).status).toBe(201);
    expect(await running).toBe(1);
    expect(f.err.join('\n')).toMatch(/no web-cards device answered this code within 3 s/);
    const printed = [...f.out, ...f.err, ...f.term].join('\n');
    // eslint-disable-next-line no-control-regex -- no control character may reach the screen
    expect(printed).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/);
    expect(f.out).toContain(`not this pairing's: ${printable(forged)} (its id is outside the device id grammar (base64url))`);
    expect(f.out).toContain("not this pairing's: rp-phone (its passkey's rpId is not a host name)");
    expect(f.out.some((line) => line.startsWith('pending: '))).toBe(false);
    expect((await served()).head!.state.version).toBe(before.state.version);
    expect(printable('a\x1b[2K\\b\u2028')).toBe('a\\u001b[2K\\u005cb\\u2028');
    expect([isRpId('127.0.0.1'), isRpId('desk-hub.opencognita-platform.workers.dev'), isRpId('Evil.example'), isRpId('evil..example'), isRpId('a b')]).toEqual([true, true, false, false, false]);
  });

  it('never takes a web-cards entry with a step-up key: the hub refuses it, and the command names it so', async () => {
    const code: PairingCode = { hub: hub.url, org: ORG, member, roots: ['AAAAAAAAAAAAAAAAAAAAAA'], recoveryPub: phoneDevice.channelPub, k: base64urlEncode(new Uint8Array(16)) };
    const k = new Uint8Array(16);
    const stepUp = { ...(await phone(code, 'stepup-phone')).device, stepUpPub: (await generateSigningKey()).pub };
    expect((await postEntry(stepUp, base64urlEncode(new Uint8Array(32)))).status).toBe(400);
    const entry = { deviceId: stepUp.id, class: stepUp.class, keyStorage: stepUp.keyStorage, channelPub: stepUp.channelPub, stepUpPub: stepUp.stepUpPub, passkey: stepUp.passkey, mac: base64urlEncode(new Uint8Array(32)), member, created: '', expires: '' } as PendingDevice;
    expect(await judgeEntry(entry, { org: ORG, member, k, class: 'web-cards', listed: new Set() })).toEqual({ ok: false, why: 'a web-cards entry with a step-up key, which the class never holds (RL 5.10)' });
    const native = { ...entry, class: 'native-mac' as const, keyStorage: 'software' as const, passkey: undefined };
    expect(await judgeEntry(native, { org: ORG, member, k, class: 'web-cards', listed: new Set() })).toEqual({ ok: false, why: 'of class native-mac, not web-cards' });
  });

  it('lists the member\'s devices, and revokes the phone into `revoked`', async () => {
    const list = fake();
    expect(await runAdmin(['devices', ...asLocal(keys)], list.io)).toBe(0);
    expect(list.out[0]).toBe('head version 3, issued 0 days ago');
    const admin = JSON.parse(readFileSync(keys, 'utf8')).device as string;
    expect(list.out.slice(1)).toEqual([`${admin} native-mac software rpId - (this admin device)`, 'owner-phone web-cards webcrypto rpId 127.0.0.1']);

    const self = fake();
    expect(await runAdmin(['remove-device', admin, ...asLocal(keys), '--yes'], self.io)).toBe(1);
    expect(self.err.join('\n')).toMatch(/is this admin device/);

    const f = fake();
    expect(await runAdmin(['remove-device', 'owner-phone', ...asLocal(keys), '--yes'], f.io)).toBe(0);
    expect(f.out).toEqual(['head version 3, issued 0 days ago', 'revoke owner-phone web-cards webcrypto rpId 127.0.0.1? [y/N] yes (--yes)', 'revoked: version 4']);
    const { head } = await served();
    expect(head!.state.members[0].devices.map((d) => d.id)).toEqual([admin]);
    expect(head!.state.revoked).toEqual([{ keyId: await keyId(phoneDevice.channelPub), holder: { member, device: 'owner-phone', class: 'web-cards', key: 'channel' } }]);
  });

  it('refuses a head older than the anchor has seen, and a chain of another genesis', async () => {
    const file = anchorFile(keys);
    const held = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, JSON.stringify({ ...JSON.parse(held), version: 9 }));
      const older = fake();
      expect(await runAdmin(['devices', ...asLocal(keys)], older.io)).toBe(1);
      expect(older.err.join('\n')).toMatch(/the hub's head is version 4, older than the version 9 this device has seen/);
      writeFileSync(file, JSON.stringify({ ...JSON.parse(held), genesis: 'x'.repeat(43) }));
      const other = fake();
      expect(await runAdmin(['devices', ...asLocal(keys)], other.io)).toBe(1);
      expect(other.err.join('\n')).toMatch(/not the anchor's x{43}: not this org's chain/);
    } finally {
      writeFileSync(file, held);
    }
    const none = fake();
    expect(await runAdmin(['pair', '--class', 'web-cards', ...asLocal(join(dir('unanchored'), 'keys.json'))], none.io)).toBe(1);
    expect(none.err.join('\n')).toMatch(/no anchor: run genesis or adopt/);
  });
});

describe('a root device revoked', () => {
  let hub: LocalHub;
  beforeAll(async () => {
    hub = await startLocalHub();
  });
  afterAll(() => hub?.close());

  it("leaves the root set with its device, in the successor that revokes it", async () => {
    const keys = join(dir('two-roots'), 'keys.json');
    const asLocal = ['--hub', hub.url, '--user', ADMIN, '--keys', keys];
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    const recovery = join(dir('volume'), 'recovery.json');
    expect(await runAdmin(['genesis', '--recovery', recovery, ...asLocal, '--yes'], fake().io)).toBe(0);
    // A second Mac paired as a native-mac device, then made a root by a successor the admin device signs.
    const f = fake();
    const running = runAdmin(['pair', '--class', 'native-mac', '--ttl', '20', ...asLocal, '--yes'], f.io);
    const deadline = Date.now() + 15_000;
    let line: string | undefined;
    while (!(line = f.out.find((l) => l.startsWith('pairing code: '))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const code = decodePairingCode(line!.slice('pairing code: '.length))!;
    const second: Omit<Device, 'endorsement'> = { id: 'second-mac', class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: (await generateSigningKey()).pub };
    const { id, ...rest } = second;
    const mac = await pairingMac(base64urlDecode(code.k), { org: code.org, member: code.member, device: second });
    expect((await hub.fetchAs(ADMIN, '/api/devices/pending', { body: { deviceId: id, ...rest, mac } })).status).toBe(201);
    expect(await running).toBe(0);
    const admin = await readAdminKeys(keys);
    const listed = ((await hub.fetchAs(ADMIN, '/api/org/state').then((r) => r.json())) as { head: SignedOrgState }).head;
    const kid = await keyId(second.stepUpPub!);
    const promoted = await signOrgState(await successor(listed.state, (s) => void s.root.keys.push(kid)), [admin.stepUp]);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: promoted })).status).toBe(201);

    const removed = fake();
    expect(await runAdmin(['remove-device', 'second-mac', ...asLocal, '--yes'], removed.io)).toBe(0);
    expect(removed.out.at(-1)).toBe('revoked: version 4');
    const head = ((await hub.fetchAs(ADMIN, '/api/org/state').then((r) => r.json())) as { head: SignedOrgState }).head;
    expect(head.state.root.keys).toEqual([await keyId(admin.stepUp.pub)]);
    expect(head.state.revoked.map((r) => r.keyId).sort()).toEqual([await keyId(second.channelPub), kid].sort());
  });
});

describe('no two successors of one parent', () => {
  // The anchor's `pending` slot (the spec's Decision Log, 2026-10-28): every signed proposal is written there before
  // its POST and settled before anything else is signed, under the anchor's lock.
  let hub: LocalHub;
  let proxy: Server;
  /** What the proxy does to the next state POST: forwards it (`pass`), forwards it and answers 500 (`stored`), or drops
   * it before the hub sees it (`lost`). */
  let post: 'pass' | 'stored' | 'lost' = 'pass';
  let proxyUrl: string;
  const keys = join(scratch, 'pending-keys', 'keys.json');
  // The command always reaches the hub through the proxy (the anchor names one hub): `post` says what the proxy does.
  const via = () => ['--hub', proxyUrl, '--user', ADMIN, '--keys', keys];
  const head = async () => ((await hub.fetchAs(ADMIN, '/api/org/state').then((r) => r.json())) as { head: SignedOrgState }).head;
  const anchor = () => JSON.parse(readFileSync(anchorFile(keys), 'utf8')) as { version: number; pending?: SignedOrgState };

  beforeAll(async () => {
    hub = await startLocalHub();
    proxy = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const isPost = req.method === 'POST' && req.url === '/api/org/state';
        if (isPost && post === 'lost') return void res.destroy();
        const headers: Record<string, string> = {};
        for (const name of ['x-desk-standin-user', 'content-type']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name] as string;
        const upstream = await fetch(`${hub.url}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined });
        const answer = Buffer.from(await upstream.arrayBuffer());
        if (isPost && post === 'stored' && upstream.status === 201) {
          res.writeHead(500, { 'content-type': 'application/json' });
          return void res.end('{"error":"internal"}');
        }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        res.end(answer);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...via(), '--yes'], fake().io)).toBe(0);
  });
  afterAll(async () => {
    await new Promise((resolve) => proxy?.close(resolve));
    await hub?.close();
  });

  it('adopts a proposal the hub stored but answered an error to, and signs no second successor of its parent', async () => {
    post = 'stored';
    const failed = fake();
    expect(await runAdmin(['refresh', ...via()], failed.io)).toBe(1);
    post = 'pass';
    const stored = await head();
    expect(stored.state.version).toBe(2);
    expect(canonicalize(anchor().pending)).toBe(canonicalize(stored));
    const f = fake();
    expect(await runAdmin(['refresh', ...via()], f.io)).toBe(0);
    expect(f.out).toContain('pending version 2 is the hub\'s: adopted');
    expect(f.out.at(-1)).toBe('refreshed: version 3 (no change)');
    const chain = ((await hub.fetchAs(ADMIN, '/api/org/state?since=0').then((r) => r.json())) as { chain: SignedOrgState[] }).chain;
    expect(chain.map((c) => c.state.version)).toEqual([1, 2, 3]);
    expect(canonicalize(chain[1])).toBe(canonicalize(stored));
    expect(chain[2].state.prev).toBe(await stateHash(stored.state));
    expect(anchor()).toMatchObject({ version: 3 });
    expect(anchor().pending).toBeUndefined();
  });

  it('sends a lost proposal again, byte for byte, before it signs anything else', async () => {
    post = 'lost';
    const lost = fake();
    expect(await runAdmin(['refresh', ...via()], lost.io)).not.toBe(0);
    post = 'pass';
    expect((await head()).state.version).toBe(3);
    const pending = anchor().pending!;
    expect(pending.state.version).toBe(4);
    const f = fake();
    expect(await runAdmin(['devices', ...via()], f.io)).toBe(0);
    expect(f.out).toContain('pending version 4 is not at the hub: sent again');
    // ECDSA signatures are randomized: the same signature is the same bytes, not a second signing.
    expect(canonicalize(await head())).toBe(canonicalize(pending));
    expect(anchor()).toMatchObject({ version: 4 });
    expect(anchor().pending).toBeUndefined();
  });

  it("refuses `fork` when the hub's head is another successor of the pending proposal's parent, and changes nothing", async () => {
    const admin = await readAdminKeys(keys);
    const parent = await head();
    const proposal = await signOrgState(await successor(parent.state, () => {}), [admin.stepUp]);
    const other = await signOrgState(await successor(parent.state, (s) => void s.projects.push({ id: 'p-other', name: 'other' })), [admin.stepUp]);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: other })).status).toBe(201);
    writeFileSync(anchorFile(keys), JSON.stringify({ ...anchor(), pending: proposal }), { mode: 0o600 });
    const held = readFileSync(anchorFile(keys), 'utf8');
    for (const args of [['refresh'], ['devices'], ['remove-device', 'nothing', '--yes']]) {
      const f = fake();
      expect(await runAdmin([...args, ...via()], f.io), args[0]).toBe(1);
      expect(f.err.join('\n'), args[0]).toMatch(/fork: the hub holds version 5 .* where this device signed .*: nothing was signed/);
      expect(readFileSync(anchorFile(keys), 'utf8')).toBe(held);
      expect(canonicalize(await head())).toBe(canonicalize(other));
    }
  });

  it('holds the anchor\'s lock for the whole run: a second invocation stops and names the holder, and a held lock is never taken over', async () => {
    const forked = readFileSync(anchorFile(keys), 'utf8');
    const settled = { ...JSON.parse(forked), version: 5 };
    delete settled.pending;
    writeFileSync(anchorFile(keys), JSON.stringify(settled), { mode: 0o600 });
    const first = fake();
    const pairing = runAdmin(['pair', '--class', 'web-cards', '--ttl', '2', ...via(), '--yes'], first.io);
    const deadline = Date.now() + 15_000;
    while (!first.out.some((l) => l.startsWith('pairing code: ')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const second = fake();
    expect(await runAdmin(['refresh', ...via()], second.io)).toBe(1);
    expect(second.err.join('\n')).toMatch(new RegExp(`another run holds .*keys\\.json\\.org\\.json\\.lock \\(pid ${process.pid} on `));
    expect(await pairing).toBe(1);
    // Released once the first ends; a lock left by a run that died is the operator's to remove, never taken over.
    writeFileSync(`${anchorFile(keys)}.lock`, JSON.stringify({ pid: 99999, host: 'elsewhere', at: '2026-10-28T00:00:00.000Z', token: 't' }));
    const third = fake();
    expect(await runAdmin(['refresh', ...via()], third.io)).toBe(1);
    expect(third.err.join('\n')).toMatch(/another run holds .* \(pid 99999 on elsewhere, since 2026-10-28T00:00:00.000Z\)/);
    rmSync(`${anchorFile(keys)}.lock`);
    const fourth = fake();
    expect(await runAdmin(['refresh', ...via()], fourth.io)).toBe(0);
    expect(fourth.out.at(-1)).toBe('refreshed: version 6 (no change)');
  });
});

describe('a genesis interrupted, then served with a forged head', () => {
  let server: Server;
  let serving: { chain: SignedOrgState[]; head: SignedOrgState };
  const member = 'f9e8d7c6b5a4938271605f4e3d2c1b0a';
  beforeAll(async () => {
    // A hub of the test's own: it names the org and the member, and serves whatever chain and head the case sets.
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/me') return res.end(JSON.stringify({ org: { id: 'org-forged' }, member: { id: member, email: ADMIN } }));
      if (req.url?.startsWith('/api/org/state')) return res.end(JSON.stringify({ head: serving.head, chain: serving.chain, transitions: [], certificates: { certs: [], retirements: [] } }));
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => new Promise((resolve) => server?.close(resolve)));

  it('anchors only a head the verified chain reaches: an unsigned head claiming version 900000 is refused', async () => {
    const keys = join(dir('forged'), 'keys.json');
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    const admin = await readAdminKeys(keys);
    const recovery = join(dir('volume'), 'recovery.json');
    const key = await newRecoveryKey();
    writeFileSync(recovery, recoveryFileText(key, 'org-forged', 'http://127.0.0.1'), { mode: 0o600 });
    const genesis = await signOrgState(
      {
        org: 'org-forged',
        version: 1,
        prev: null,
        issued: new Date().toISOString(),
        root: { keys: [await keyId(admin.stepUp.pub)], recoveryPub: key.pub },
        members: [{ id: member, email: ADMIN, role: 'admin', devices: [deviceEntry(admin)] }],
        machines: [],
        machineNames: [],
        retired: [],
        revoked: [],
        delegations: [],
        projects: [],
      },
      [admin.stepUp],
    );
    writeFileSync(genesisFile(keys), JSON.stringify(genesis));
    const forged: SignedOrgState = { state: { ...genesis.state, version: 900_000, prev: await stateHash(genesis.state) }, sigs: genesis.sigs };
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const run = () => runAdmin(['genesis', '--hub', url, '--user', ADMIN, '--yes', '--keys', keys, '--recovery', recovery], f.io);
    let f = fake();
    for (const chain of [[genesis], [genesis, forged]]) {
      serving = { chain, head: forged };
      f = fake();
      expect(await run(), String(chain.length)).toBe(1);
      expect(f.err.join('\n')).toMatch(/the hub's (head is not its chain's last state|chain breaks at version 2)/);
      expect(existsSync(anchorFile(keys))).toBe(false);
    }
    serving = { chain: [genesis], head: genesis };
    f = fake();
    expect(await run()).toBe(0);
    expect(f.out).toContain(`genesis already at the hub: version 1, orgGenesis ${await stateHash(genesis.state)}`);
    expect(JSON.parse(readFileSync(anchorFile(keys), 'utf8')).version).toBe(1);
  });
});

describe('a genesis interrupted between its POST and its anchor', () => {
  let hub: LocalHub;
  let proxy: Server;
  beforeAll(async () => {
    hub = await startLocalHub();
  });
  afterAll(async () => {
    await new Promise((resolve) => proxy?.close(resolve));
    await hub?.close();
  });

  it('finishes on a rerun with the same hash, and no second genesis', async () => {
    const keys = join(dir('interrupted'), 'keys.json');
    expect(await runAdmin(['init', '--keys', keys], fake().io)).toBe(0);
    const recovery = join(dir('volume'), 'recovery.json');
    let child: ChildProcess | null = null;
    let killed = false;
    // Between the command and the hub: once the hub answers the genesis's POST 201, the command is killed before the
    // answer reaches it, so the genesis is at the hub and the anchor never written.
    proxy = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        for (const name of ['x-desk-standin-user', 'content-type']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name] as string;
        const upstream = await fetch(`${hub.url}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined });
        const answer = Buffer.from(await upstream.arrayBuffer());
        if (req.method === 'POST' && req.url === '/api/org/state' && upstream.status === 201) {
          killed = child?.kill('SIGKILL') ?? false;
          res.destroy();
          return;
        }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        res.end(answer);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>((resolve) => {
      child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', BIN, 'admin', 'genesis', '--hub', proxyUrl, '--user', ADMIN, '--yes', '--keys', keys, '--recovery', recovery], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
      child.on('close', (code, signal) => resolve({ code, signal, stdout }));
    });
    expect([killed, exit.signal]).toEqual([true, 'SIGKILL']);
    expect(exit.stdout).toContain(`recovery key written to ${recovery} and read back: matches recoveryPub`);
    // The genesis committed at the hub; the anchor was never written, the state to post was.
    const first = (await hub.fetchAs(ADMIN, '/api/org/state?since=0').then((r) => r.json())) as { chain: SignedOrgState[] };
    expect(first.chain).toHaveLength(1);
    const hash = await stateHash(first.chain[0].state);
    expect(existsSync(anchorFile(keys))).toBe(false);
    expect(await stateHash((JSON.parse(readFileSync(genesisFile(keys), 'utf8')) as SignedOrgState).state)).toBe(hash);

    // The killed run's lock stays: it is the operator's to remove, once nothing runs (a held lock is never taken over).
    const held = fake();
    expect(await runAdmin(['genesis', '--hub', hub.url, '--user', ADMIN, '--yes', '--keys', keys, '--recovery', recovery], held.io)).toBe(1);
    expect(held.err.join('\n')).toContain(`another run holds ${anchorFile(keys)}.lock (pid ${child!.pid} on `);
    rmSync(`${anchorFile(keys)}.lock`);

    const f = fake();
    expect(await runAdmin(['genesis', '--hub', hub.url, '--user', ADMIN, '--yes', '--keys', keys, '--recovery', recovery], f.io)).toBe(0);
    expect(f.out).toEqual([
      'head version 1, issued 0 days ago',
      `recovery key written to ${recovery} and read back: matches recoveryPub`,
      `genesis already at the hub: version 1, orgGenesis ${hash}`,
      `recoveryPub ${first.chain[0].state.root.recoveryPub} kept in ${anchorFile(keys)}; set orgGenesis in the deployment's config and commit it`,
    ]);
    const after = (await hub.fetchAs(ADMIN, '/api/org/state?since=0').then((r) => r.json())) as { chain: SignedOrgState[] };
    expect(after.chain).toHaveLength(1);
    expect(await stateHash(after.chain[0].state)).toBe(hash);
    expect(existsSync(genesisFile(keys))).toBe(false);
    expect(JSON.parse(readFileSync(anchorFile(keys), 'utf8')).genesis).toBe(hash);
    // The recovery key is at its destination alone.
    const d = (JSON.parse(readFileSync(recovery, 'utf8')) as { key: JsonWebKey }).key.d!;
    for (const name of readdirSync(join(keys, '..'))) expect(readFileSync(join(keys, '..', name), 'utf8')).not.toContain(d);
  }, 120_000);
});

describe('adopt', () => {
  let hub: LocalHub;
  let pinned: string;
  let owner: { file: string; device: TestDevice };
  let second: { file: string; device: TestDevice };
  const config = (orgGenesis?: string) => {
    const file = join(dir('config'), 'config.json');
    writeFileSync(file, JSON.stringify({ account: 'acct', worker: 'local-hub', host: 'local-hub.example.invalid', ownerEmail: ADMIN, sessionDuration: '720h', org: { id: ORG, name: 'Local org' }, ...(orgGenesis ? { orgGenesis } : {}) }));
    return file;
  };
  /** A keys file in the staging test device's shape (org-admin.ts), naming its device when it is not `a1`. */
  const testDevice = async (id: string) => {
    const made = await adminKeysFile(id);
    if (id !== 'a1') writeFileSync(made.file, JSON.stringify({ device: id, ...JSON.parse(readFileSync(made.file, 'utf8')) }), { mode: 0o600 });
    return { file: made.file, device: { device: deviceEntry(made.device), channel: made.device.channel, stepUp: made.device.stepUp }, recovery: made.device.recovery };
  };

  beforeAll(async () => {
    hub = await startLocalHub();
    // An org rooted before the command, as staging's was (O11 M3): its test device's genesis, and a second device of
    // the owner's, endorsed, that is no root.
    const made = await testDevice('a1');
    owner = made;
    const member = ((await hub.fetchAs(ADMIN, '/api/me').then((r) => r.json())) as { member: { id: string } }).member.id;
    const head = await signedBy(await genesisOf(ORG, member, ADMIN, owner.device, made.recovery), owner.device);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    pinned = await stateHash(head.state);
    const other = await testDevice('b2');
    second = { file: other.file, device: await endorsed(ORG, member, other.device, owner.device) };
    const v2 = await signedBy(await next(head, (s) => s.members[0].devices.push(second.device.device)), owner.device);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: v2 })).status).toBe(201);
  });
  afterAll(() => hub?.close());

  const asLocal = (keys: string, cfg?: string) => ['--hub', hub.url, '--user', ADMIN, '--keys', keys, ...(cfg ? ['--config', cfg] : [])];

  it('refuses a config with no pin, another pin, a device the head does not list and a device that is no root', async () => {
    const stranger = await testDevice('a1');
    for (const [args, why] of [
      [asLocal(owner.file), /this config has no orgGenesis/],
      [asLocal(owner.file, config()), /this config has no orgGenesis/],
      [asLocal(owner.file, config('y'.repeat(43))), /not the config's orgGenesis y{43}: not this org's chain/],
      [asLocal(stranger.file, config(pinned)), /does not list device a1 with these keys/],
      [asLocal(second.file, config(pinned)), /device b2's step-up key is not a root key of the head \(version 2\)/],
    ] as const) {
      const f = fake();
      expect(await runAdmin(['adopt', ...args], f.io), String(why)).toBe(1);
      expect(f.err.join('\n'), String(why)).toMatch(why);
    }
    expect(existsSync(anchorFile(owner.file))).toBe(false);
  });

  it("writes the anchor for an org whose genesis the config pins, after which the device signs its successors", async () => {
    const cfg = config(pinned);
    const f = fake();
    expect(await runAdmin(['adopt', ...asLocal(owner.file, cfg)], f.io)).toBe(0);
    expect(f.out).toEqual(['head version 2, issued 0 days ago', `adopted: genesis ${pinned} (config's orgGenesis), head version 2, device a1 signs`]);
    const anchor = JSON.parse(readFileSync(anchorFile(owner.file), 'utf8')) as Record<string, unknown>;
    expect(anchor).toMatchObject({ hub: hub.url, org: ORG, genesis: pinned, version: 2 });
    const refreshed = fake();
    expect(await runAdmin(['refresh', ...asLocal(owner.file, cfg)], refreshed.io)).toBe(0);
    expect(refreshed.out).toEqual(['head version 2, issued 0 days ago', 'refreshed: version 3 (no change)']);
    const again = fake();
    expect(await runAdmin(['adopt', ...asLocal(owner.file, cfg)], again.io)).toBe(1);
    expect(again.err.join('\n')).toMatch(/this device anchors an org already/);
  });
});

describe('the head age', () => {
  it('counts whole days since the head was issued', () => {
    const head = { state: { version: 7, issued: '2026-10-01T00:00:00.000Z' } } as SignedOrgState;
    expect(ageLine(head, new Date('2026-10-23T12:00:00.000Z'))).toBe('head version 7, issued 22 days ago');
    expect(ageLine(head, new Date('2026-10-02T00:00:00.000Z'))).toBe('head version 7, issued 1 day ago');
    expect(ageLine(null)).toBe('head: none');
  });
});
