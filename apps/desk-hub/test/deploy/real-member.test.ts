// P5 O8 M6b's real-member sitting, the staging harness's layer 2 (deploy/real-member.ts; docs/doperpowers/plans/
// 2026-10-28-p5-o8-org-interface.md, Decision Log "The real-member sitting"): the owner's second email added as a
// member, and its first device listed once a second scratch MAWS profile has signed in with the harness's pairing code;
// then both undone. What the steps refuse, staging's hub above all, the files they read and write (0600, outside any git
// checkout), and that no line they print holds the email or the code.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { constants as os } from 'node:os';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { join } from 'node:path';
import { base64urlDecode, base64urlEncode, decodePairingCode, encodePairingCode, generateSigningKey, keyId, pairingFingerprint, pairingMac, type Device, type OrgState, type SignedOrgState } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, STAGING_HOST, STAGING_ORG } from '../../deploy/config.ts';
import { codeFileRefusal, privateFileRefusal, readEmail, realMemberHubRefusal, realMemberMode, runRealMember, scrubbingIo, type RealMemberAdmin, type RealMemberOptions } from '../../deploy/real-member.ts';
import type { PendingDevice } from '../../src/protocol/identity.ts';

const EMAIL = 'second.person@example.org';
const ADMIN_MEMBER = 'a'.repeat(32);
const staging = { host: STAGING_HOST, org: STAGING_ORG };
const stagingConfig = { worker: 'desk-hub-staging', host: STAGING_HOST, org: { id: STAGING_ORG } };
/** The head's root key and recovery key, as a pairing code names them. */
const ROOT = await generateSigningKey();
const ROOT_KID = await keyId(ROOT.pub);

/** A fresh directory outside any git checkout (the system's temporary one). */
const scratch = () => mkdtempSync(join(tmpdir(), 'real-member-'));
/** `EMAIL` in a 0600 file outside any checkout. */
function emailFile(mode = 0o600, body = `${EMAIL}\n`): string {
  const path = join(scratch(), 'second-email');
  writeFileSync(path, body);
  chmodSync(path, mode);
  return path;
}

/** The staging admin, faked: a head the steps amend, each successor kept. */
function fakeAdmin(members: OrgState['members'] = []): RealMemberAdmin & { states: OrgState[]; opened: number } {
  const state = {
    org: STAGING_ORG,
    version: 7,
    root: { keys: [ROOT_KID], recoveryPub: ROOT.pub },
    members: [{ id: ADMIN_MEMBER, email: 'owner@example.org', role: 'admin', devices: [] }, ...members],
    revoked: [],
  } as unknown as OrgState;
  const admin = {
    member: ADMIN_MEMBER,
    states: [state],
    opened: 1,
    read: async () => ({ state: structuredClone(admin.states.at(-1)!) }) as SignedOrgState,
    amend: async (_what: string, edit: (s: OrgState) => boolean | void) => {
      const next = structuredClone(admin.states.at(-1)!);
      next.version += 1;
      if (edit(next) === false) return null;
      admin.states.push(next);
      return { state: next } as SignedOrgState;
    },
  };
  return admin;
}

/** The steps' options over a fake admin and pending list, every line printed kept, every secret heard kept. */
function options(o: Partial<RealMemberOptions> & { admin?: ReturnType<typeof fakeAdmin> } = {}) {
  const lines: string[] = [];
  const secrets: string[] = [];
  const admin = o.admin ?? fakeAdmin();
  let opened = 0;
  let pendingAsked = 0;
  const base: RealMemberOptions = {
    verb: 'add',
    hub: staging,
    hubUrl: `https://${STAGING_HOST}`,
    waitS: 5,
    open: async () => {
      opened++;
      return admin;
    },
    pending: async () => {
      pendingAsked++;
      return [];
    },
    io: { print: (line) => void lines.push(line), secret: (value) => void secrets.push(value), sleep: async () => {}, write: (fd, text) => writeFileSync(fd, text) },
    ...o,
  };
  return { o: base, lines, secrets, admin, opened: () => opened, pendingAsked: () => pendingAsked };
}

const printedSecrets = (lines: readonly string[], ...secrets: string[]) => lines.filter((line) => secrets.some((s) => line.includes(s)));

describe('the command line', () => {
  it('runs a verb on staging with the admin device’s keys and the email’s file; production never', () => {
    const values = { 'device-keys': '/k.json', 'email-file': '/e' };
    expect(realMemberMode(['add'], values, stagingConfig)).toEqual({ verb: 'add' });
    expect(realMemberMode(['pair'], { ...values, 'code-file': '/c' }, stagingConfig)).toEqual({ verb: 'pair' });
    expect(realMemberMode(['remove'], values, stagingConfig)).toEqual({ verb: 'remove' });
    expect(realMemberMode(['remove'], { 'device-keys': '/k.json', member: 'b'.repeat(32) }, stagingConfig)).toEqual({ verb: 'remove' });
    expect(realMemberMode(['add'], { ...values, production: true }, stagingConfig)).toEqual({ refused: expect.stringMatching(/staging alone/) });
    expect(realMemberMode(['add'], values, { worker: 'desk-hub', host: PRODUCTION_HOST, org: { id: 'ssfskim' } })).toEqual({ refused: expect.stringMatching(/names production/) });
    expect(realMemberMode(['add'], values, { worker: 'desk-hub-staging', host: STAGING_HOST, org: { id: 'staging-probe-3' } })).toEqual({ refused: expect.stringMatching(/staging's org/) });
    expect(realMemberMode(['add'], values, null)).toEqual({ refused: expect.stringMatching(/--config/) });
    expect(realMemberMode(['add'], { 'email-file': '/e' }, stagingConfig)).toEqual({ refused: expect.stringMatching(/--device-keys/) });
    expect(realMemberMode(['add'], { 'device-keys': '/k.json' }, stagingConfig)).toEqual({ refused: expect.stringMatching(/--email-file/) });
    expect(realMemberMode(['add'], { ...values, member: 'b'.repeat(32) }, stagingConfig)).toEqual({ refused: expect.stringMatching(/--member is remove's alone/) });
    expect(realMemberMode(['pair'], values, stagingConfig)).toEqual({ refused: expect.stringMatching(/--code-file/) });
    expect(realMemberMode(['enroll'], values, stagingConfig)).toEqual({ refused: expect.stringMatching(/add \| pair \| remove/) });
    expect(realMemberMode([], values, stagingConfig)).toEqual({ refused: expect.stringMatching(/add \| pair \| remove/) });
  });
});

describe('the hub', () => {
  it('is staging’s alone, by host and by org', () => {
    expect(realMemberHubRefusal(staging)).toBeNull();
    for (const hub of [
      { host: PRODUCTION_HOST, org: 'ssfskim' },
      { host: PRODUCTION_HOST, org: STAGING_ORG },
      { host: STAGING_HOST, org: 'ssfskim' },
      { host: '127.0.0.1:8787', org: STAGING_ORG },
    ]) expect(realMemberHubRefusal(hub), JSON.stringify(hub)).toMatch(/staging .* alone/);
  });

  it('refuses every step for any other hub before the admin is opened or anything is asked of it', async () => {
    for (const verb of ['add', 'pair', 'remove'] as const) {
      for (const hub of [{ host: PRODUCTION_HOST, org: 'ssfskim' }, { host: '127.0.0.1:8787', org: STAGING_ORG }, { host: STAGING_HOST, org: 'other' }]) {
        const codeFile = join(scratch(), 'code');
        const run = options({ verb, hub, emailFile: emailFile(), codeFile });
        expect(await runRealMember(run.o), `${verb} at ${hub.host}`).toBe(2);
        expect(run.opened()).toBe(0);
        expect(run.pendingAsked()).toBe(0);
        expect(existsSync(codeFile)).toBe(false);
        expect(run.lines.join('\n')).toMatch(/staging .* alone/);
      }
    }
  });
});

describe('the files', () => {
  it('reads the email only from a 0600 file of its own, outside any git checkout', () => {
    expect(privateFileRefusal(emailFile())).toBeNull();
    expect(privateFileRefusal(emailFile(0o644))).toMatch(/mode 0600, not 0644/);
    expect(privateFileRefusal(emailFile(0o400))).toMatch(/mode 0600, not 0400/);
    expect(privateFileRefusal(join(scratch(), 'none'))).toMatch(/does not exist/);
    expect(privateFileRefusal(scratch())).toMatch(/not a regular file/);
    const link = join(scratch(), 'link');
    symlinkSync(emailFile(), link);
    expect(privateFileRefusal(link)).toMatch(/a symlink/);
    for (const marker of ['dir', 'file'] as const) {
      // a checkout's `.git` is a directory, a worktree's a file: either makes the file one of the checkout's
      const repo = scratch();
      if (marker === 'dir') mkdirSync(join(repo, '.git'));
      else writeFileSync(join(repo, '.git'), 'gitdir: /elsewhere\n');
      mkdirSync(join(repo, 'a', 'b'), { recursive: true });
      const inside = join(repo, 'a', 'b', 'second-email');
      writeFileSync(inside, EMAIL, { mode: 0o600 });
      expect(privateFileRefusal(inside), marker).toMatch(/inside a git checkout/);
    }
  });

  it('refuses a mode with a special bit beside 0600', () => {
    const path = emailFile(0o4600);
    expect(statSync(path).mode & 0o7777).toBe(0o4600);
    expect(privateFileRefusal(path)).toMatch(/mode 0600, not 04600/);
    expect(() => readEmail(path)).toThrow(/mode 0600, not 04600/);
  });

  it('reads the file it checked: a file swapped in at the path after it is opened is never read', () => {
    // The race the one descriptor closes: the path checked, then another file put in its place before the read.
    const path = emailFile();
    const other = 'someone.else@example.org';
    const swap = () => {
      renameSync(path, `${path}.checked`);
      writeFileSync(path, `${other}\n`, { mode: 0o600 });
    };
    let thrown: Error | null = null;
    try {
      readEmail(path, swap);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toMatch(/changed while it was read/);
    expect(thrown?.message).not.toContain(other);
    // with nothing swapped, the same seam reads the file
    expect(readEmail(emailFile(), () => {})).toBe(EMAIL);
  });

  it('names no email file in any refusal, by path or directory: its name, or a directory above it, may be the address', async () => {
    // Every case's file is named after the address, in a directory named after it too.
    const home = () => {
      const dir = join(scratch(), EMAIL);
      mkdirSync(dir);
      return dir;
    };
    const named = (mode: number, body = `${EMAIL}\n`) => {
      const path = join(home(), EMAIL);
      writeFileSync(path, body);
      chmodSync(path, mode);
      return { path };
    };
    const cases: Array<{ path: string; swap?: () => void }> = [named(0o644), named(0o4600), named(0o600, 'not an email\n'), { path: join(home(), EMAIL) }];
    const linked = join(home(), EMAIL);
    symlinkSync(named(0o600).path, linked);
    cases.push({ path: linked });
    const folder = join(home(), EMAIL);
    mkdirSync(folder);
    cases.push({ path: folder });
    const repo = home();
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, EMAIL), EMAIL, { mode: 0o600 });
    cases.push({ path: join(repo, EMAIL) });
    const swapped = named(0o600);
    cases.push({ ...swapped, swap: () => renameSync(swapped.path, `${swapped.path}.gone`) });
    for (const { path, swap } of cases) {
      let refusal = '';
      try {
        readEmail(path, swap);
      } catch (error) {
        refusal = (error as Error).message;
      }
      expect(refusal, path).toMatch(/^the email file /);
      expect(refusal, path).not.toContain(EMAIL);
      expect(refusal, path).not.toContain(tmpdir());
      // and through a step, whose lines are printed before the email is known
      const run = options({ verb: 'add', emailFile: path });
      expect(await runRealMember(run.o), path).toBe(2);
      expect(printedSecrets(run.lines, EMAIL), path).toEqual([]);
    }
  });

  it('reads one email, its words never in a refusal', () => {
    expect(readEmail(emailFile())).toBe(EMAIL);
    expect(readEmail(emailFile(0o600, EMAIL))).toBe(EMAIL);
    for (const body of ['not an email\n', `${EMAIL}\n${EMAIL}\n`, `${EMAIL} x\n`, '']) {
      const path = emailFile(0o600, body);
      expect(() => readEmail(path)).toThrow(/one email address/);
      try {
        readEmail(path);
      } catch (error) {
        if (body !== '') expect((error as Error).message).not.toContain(body.trim());
      }
    }
    expect(() => readEmail(emailFile(0o644))).toThrow(/mode 0600/);
  });

  it('writes the pairing code only to a new file outside any git checkout', () => {
    const dir = scratch();
    expect(codeFileRefusal(join(dir, 'code'))).toBeNull();
    writeFileSync(join(dir, 'there'), 'x');
    expect(codeFileRefusal(join(dir, 'there'))).toMatch(/exists/);
    expect(codeFileRefusal(join(dir, 'no', 'code'))).toMatch(/no directory/);
    const repo = scratch();
    mkdirSync(join(repo, '.git'));
    expect(codeFileRefusal(join(repo, 'code'))).toMatch(/inside the git checkout/);
  });
});

describe('add', () => {
  it('adds the email as a member with no device, its id printed and its address never', async () => {
    const run = options({ verb: 'add', emailFile: emailFile() });
    expect(await runRealMember(run.o)).toBe(0);
    const added = run.admin.states.at(-1)!.members.find((m) => m.email === EMAIL)!;
    expect(added).toMatchObject({ role: 'member', devices: [] });
    expect(added.id).toMatch(/^[0-9a-f]{32}$/);
    expect(run.lines.join('\n')).toContain(added.id);
    expect(run.lines.join('\n')).toMatch(/access-sync/);
    expect(printedSecrets(run.lines, EMAIL)).toEqual([]);
    expect(run.secrets).toContain(EMAIL);
  });

  it('refuses an email already a member’s, the admin’s own above all, and changes nothing', async () => {
    for (const admin of [fakeAdmin([{ id: 'c'.repeat(32), email: EMAIL.toUpperCase(), role: 'member', devices: [] }]), fakeAdmin()]) {
      const run = options({ verb: 'add', admin, emailFile: admin.states[0].members.length > 1 ? emailFile() : emailFile(0o600, 'owner@example.org\n') });
      expect(await runRealMember(run.o)).toBe(1);
      expect(run.admin.states).toHaveLength(1);
      expect(run.lines.join('\n')).toMatch(/already a member|the admin's own/);
      expect(printedSecrets(run.lines, EMAIL, 'owner@example.org')).toEqual([]);
    }
  });

  it('refuses an email file that is not 0600 before the admin is opened', async () => {
    const run = options({ verb: 'add', emailFile: emailFile(0o644) });
    expect(await runRealMember(run.o)).toBe(2);
    expect(run.opened()).toBe(0);
  });
});

/** A native-mac device's pending entry, as an app posts it once signed in with the code: its MAC under the code's `k`. */
async function entryFor(code: string, member: string): Promise<PendingDevice & { device: Device }> {
  const decoded = decodePairingCode(code)!;
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  const device: Device = { id: await keyId(channel.pub), class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub };
  const mac = await pairingMac(base64urlDecode(decoded.k), { org: decoded.org, member, device });
  const now = new Date().toISOString();
  return { deviceId: device.id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub, mac, member, created: now, expires: now, device };
}

describe('pair', () => {
  const B = 'b'.repeat(32);
  const withB = () => fakeAdmin([{ id: B, email: EMAIL, role: 'member', devices: [] }]);

  it('writes a code naming the member to a 0600 file, lists the device that answers it unendorsed, and removes the file', async () => {
    const codeFile = join(scratch(), 'pairing-code');
    let code = '';
    let answered: Awaited<ReturnType<typeof entryFor>> | null = null;
    let stranger: Awaited<ReturnType<typeof entryFor>> | null = null;
    const admin = withB();
    const run = options({
      verb: 'pair',
      admin,
      emailFile: emailFile(),
      codeFile,
      // the second profile, given the code from the file, posts its entry; a stranger's entry is beside it
      pending: async (member) => {
        expect(member).toBe(B);
        if (!existsSync(codeFile)) return [];
        expect(statSync(codeFile).mode & 0o777).toBe(0o600);
        code = readFileSync(codeFile, 'utf8').trim();
        answered ??= await entryFor(code, B);
        // another device's entry, its MAC under a secret not this code's: not this pairing's
        stranger ??= await entryFor(encodePairingCode({ ...decodePairingCode(code)!, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) }), B);
        return [stranger, answered];
      },
    });
    expect(await runRealMember(run.o)).toBe(0);
    expect(decodePairingCode(code)).toMatchObject({ hub: `https://${STAGING_HOST}`, org: STAGING_ORG, member: B, roots: [ROOT_KID], recoveryPub: ROOT.pub });
    const listed = admin.states.at(-1)!.members.find((m) => m.id === B)!.devices;
    expect(listed).toEqual([answered!.device]);
    expect(listed[0]).not.toHaveProperty('endorsement');
    expect(existsSync(codeFile)).toBe(false);
    expect(run.lines.join('\n')).toContain(await pairingFingerprint(STAGING_ORG, B, answered!.device));
    expect(run.lines.join('\n')).toMatch(new RegExp(`not this pairing's: ${stranger!.deviceId} \\(its MAC is not under this code's secret\\)`));
    expect(printedSecrets(run.lines, EMAIL, code)).toEqual([]);
    expect(run.secrets).toEqual(expect.arrayContaining([EMAIL, code]));
  });

  it('lists nothing, and removes the code’s file, when no device answers within the wait', async () => {
    const codeFile = join(scratch(), 'pairing-code');
    const admin = withB();
    const run = options({ verb: 'pair', admin, emailFile: emailFile(), codeFile, waitS: 0 });
    expect(await runRealMember(run.o)).toBe(1);
    expect(admin.states).toHaveLength(1);
    expect(existsSync(codeFile)).toBe(false);
    expect(run.lines.join('\n')).toMatch(/no device answered/);
  });

  it('refuses a member who isn’t there or lists a device already, and a code file inside a checkout, writing nothing', async () => {
    const repo = scratch();
    mkdirSync(join(repo, '.git'));
    for (const [admin, codeFile] of [
      [fakeAdmin(), join(scratch(), 'code')],
      [fakeAdmin([{ id: B, email: EMAIL, role: 'member', devices: [{ id: 'd1', class: 'native-mac', keyStorage: 'software', channelPub: 'p' }] }]), join(scratch(), 'code')],
      [withB(), join(repo, 'code')],
    ] as const) {
      const run = options({ verb: 'pair', admin, emailFile: emailFile(), codeFile });
      expect(await runRealMember(run.o)).not.toBe(0);
      expect(admin.states).toHaveLength(1);
      expect(existsSync(codeFile)).toBe(false);
      expect(run.pendingAsked()).toBe(0);
    }
  });
});

describe('remove', () => {
  it('takes the member out and revokes every key of its devices; by the email’s file or the member’s id', async () => {
    const B = 'b'.repeat(32);
    const channel = await generateSigningKey();
    const stepUp = await generateSigningKey();
    const device: Device = { id: 'd-b', class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub };
    for (const by of [{ emailFile: emailFile() }, { member: B }]) {
      const admin = fakeAdmin([{ id: B, email: EMAIL, role: 'member', devices: [device] }]);
      const run = options({ verb: 'remove', admin, ...by });
      expect(await runRealMember(run.o)).toBe(0);
      const after = admin.states.at(-1)!;
      expect(after.members.map((m) => m.id)).toEqual([ADMIN_MEMBER]);
      expect(after.revoked).toEqual([
        { keyId: await keyId(channel.pub), holder: { member: B, device: 'd-b', class: 'native-mac', key: 'channel' } },
        { keyId: await keyId(stepUp.pub), holder: { member: B, device: 'd-b', class: 'native-mac', key: 'step-up' } },
      ]);
      expect(run.lines.join('\n')).toMatch(/access-sync/);
      expect(printedSecrets(run.lines, EMAIL)).toEqual([]);
    }
  });

  it('removes the member as the head being amended lists it: a device listed or a promotion after the first read counts', async () => {
    // The head moves between remove's read and its amend: the edit the amend replays sees the new head, and what it
    // revokes, and whether it removes at all, is that head's.
    const B = 'b'.repeat(32);
    const keys = await Promise.all([0, 1, 2, 3].map(() => generateSigningKey()));
    const first: Device = { id: 'd-1', class: 'native-mac', keyStorage: 'software', channelPub: keys[0].pub, stepUpPub: keys[1].pub };
    const second: Device = { id: 'd-2', class: 'native-mac', keyStorage: 'software', channelPub: keys[2].pub, stepUpPub: keys[3].pub };
    const moving = (move: (b: OrgState['members'][number]) => void) => {
      const admin = fakeAdmin([{ id: B, email: EMAIL, role: 'member', devices: [first] }]);
      const amend = admin.amend;
      let moved = false;
      admin.amend = async (what, edit) => {
        if (!moved) {
          moved = true;
          const next = structuredClone(admin.states.at(-1)!);
          next.version += 1;
          move(next.members.find((m) => m.id === B)!);
          admin.states.push(next);
        }
        return amend(what, edit);
      };
      return admin;
    };

    const listed = moving((b) => void b.devices.push(second));
    const run = options({ verb: 'remove', admin: listed, member: B });
    expect(await runRealMember(run.o)).toBe(0);
    const after = listed.states.at(-1)!;
    expect(after.members.map((m) => m.id)).toEqual([ADMIN_MEMBER]);
    expect(after.revoked.map((r) => r.holder).map((h) => ('device' in h ? [h.device, h.key] : h))).toEqual([['d-1', 'channel'], ['d-1', 'step-up'], ['d-2', 'channel'], ['d-2', 'step-up']]);
    expect(after.revoked.map((r) => r.keyId)).toEqual(await Promise.all(keys.map((k) => keyId(k.pub))));
    expect(run.lines.join('\n')).toMatch(/its 2 device\(s\)' 4 key\(s\) revoked/);

    const promoted = moving((b) => {
      b.role = 'admin';
      b.devices.push(second);
    });
    const refused = options({ verb: 'remove', admin: promoted, member: B });
    expect(await runRealMember(refused.o)).toBe(1);
    expect(refused.lines.join('\n')).toMatch(/is an admin/);
    expect(promoted.states.at(-1)!.members.map((m) => m.id)).toEqual([ADMIN_MEMBER, B]);
    expect(promoted.states.at(-1)!.revoked).toEqual([]);
  });

  it('says there is nothing to remove for a member the head no longer lists, and never removes the admin’s own', async () => {
    const gone = options({ verb: 'remove', emailFile: emailFile() });
    expect(await runRealMember(gone.o)).toBe(0);
    expect(gone.admin.states).toHaveLength(1);
    expect(gone.lines.join('\n')).toMatch(/nothing to remove/);
    const own = options({ verb: 'remove', member: ADMIN_MEMBER });
    expect(await runRealMember(own.o)).toBe(1);
    expect(own.admin.states).toHaveLength(1);
  });
});

describe('the printer the command prints through', () => {
  it('keeps the email of a member removed by its id out of every line, the hub’s own words included, and lists it for the search', async () => {
    const lines: string[] = [];
    const scan = join(scratch(), 'scan');
    const io = { ...scrubbingIo((line) => void lines.push(line), scan), sleep: async () => {} };
    const member = { id: 'b'.repeat(32), email: EMAIL, role: 'member' as const, devices: [] };
    const admin = fakeAdmin([member]);
    // the hub refuses the successor, quoting the state it was sent (the address in another case among it)
    admin.amend = async () => {
      throw new Error(`org state (removal): 400 {"error":"bad member ${EMAIL.toUpperCase()}","state":{"email":"${EMAIL}"}}`);
    };
    const run = options({ verb: 'remove', member: member.id, admin, io });
    expect(await runRealMember(run.o)).toBe(1);
    expect(lines.join('\n')).toMatch(/failed: org state \(removal\): 400/);
    expect(lines.filter((line) => line.toLowerCase().includes(EMAIL))).toEqual([]);
    expect(readFileSync(scan, 'utf8').split('\n')).toContain(EMAIL);
  });
});

describe('the pairing code’s file, however pair ends', () => {
  // `pair` in a process of its own, as the sitting runs it (in the background, stopped by SIGTERM): the step over a fake
  // admin whose member B has no device, a pending list that never answers, and the code's write either whole or failing
  // partway. Bundled as bin.ts bundles a command (org-protocol's imports name no extension).
  const driver = async () => {
    const dir = scratch();
    const outfile = join(dir, 'pair.mjs');
    const deploy = join(import.meta.dirname, '../../deploy');
    const contents = `
      import { writeFileSync, writeSync } from 'node:fs';
      import { generateSigningKey, keyId } from 'org-protocol';
      import { STAGING_HOST, STAGING_ORG } from './config.ts';
      import { runRealMember } from './real-member.ts';
      const [mode, emailFile, codeFile] = process.argv.slice(2);
      const root = await generateSigningKey();
      const state = { org: STAGING_ORG, version: 3, root: { keys: [await keyId(root.pub)], recoveryPub: root.pub }, revoked: [],
        members: [{ id: '${ADMIN_MEMBER}', email: 'owner@example.org', role: 'admin', devices: [] }, { id: '${'b'.repeat(32)}', email: '${EMAIL}', role: 'member', devices: [] }] };
      const admin = { member: '${ADMIN_MEMBER}', read: async () => ({ state }), amend: async () => null };
      const write = mode === 'partial' ? (fd, text) => { writeSync(fd, text.slice(0, 12)); throw new Error('the disk filled'); } : (fd, text) => writeFileSync(fd, text);
      const status = await runRealMember({ verb: 'pair', hub: { host: STAGING_HOST, org: STAGING_ORG }, hubUrl: 'https://' + STAGING_HOST, emailFile, codeFile, waitS: 120,
        open: async () => admin, pending: async () => [],
        io: { print: (line) => process.stdout.write(line + '\\n'), secret: () => {}, sleep: (ms) => new Promise((done) => setTimeout(done, ms)), write } });
      process.stdout.write('status ' + status + '\\n');
      process.exit(status);`;
    await build({ stdin: { contents, resolveDir: deploy, loader: 'ts', sourcefile: 'pair-driver.ts' }, outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'error' });
    return outfile;
  };
  let bundled: Promise<string> | null = null;
  const run = (mode: 'whole' | 'partial', codeFile: string) => {
    bundled ??= driver();
    return bundled.then((file) => spawn(process.execPath, [file, mode, emailFile(), codeFile], { stdio: ['ignore', 'pipe', 'inherit'] }));
  };
  const ended = (child: ReturnType<typeof spawn>) => new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>((resolve) => {
    let out = '';
    child.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.once('exit', (code, signal) => resolve({ code, signal, out }));
  });

  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)('is removed when %s stops the wait, and the exit is not 0', async (signal) => {
    const codeFile = join(scratch(), 'code');
    const child = await run('whole', codeFile);
    const end = ended(child);
    try {
      await new Promise<void>((resolve, reject) => {
        let seen = '';
        child.stdout!.on('data', (chunk: Buffer) => (seen += chunk.toString()).includes('waiting up to') && resolve());
        void end.then(({ out }) => reject(new Error(`pair ended before its wait: ${out}`)));
      });
      expect(statSync(codeFile).mode & 0o7777).toBe(0o600);
      expect(readFileSync(codeFile, 'utf8')).toMatch(/\n$/);
      child.kill(signal);
      const { code } = await Promise.race([end, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`pair still running 10 s after ${signal}`)), 10_000))]);
      expect(code).toBe(128 + os.signals[signal]);
      expect(existsSync(codeFile)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);

  it('is removed when its write fails partway, and the step fails', async () => {
    const codeFile = join(scratch(), 'code');
    const { code, out } = await ended(await run('partial', codeFile));
    expect(code).toBe(1);
    expect(out).toContain('failed: the disk filled');
    expect(out).not.toContain('waiting up to');
    expect(existsSync(codeFile)).toBe(false);
  }, 60_000);
});
