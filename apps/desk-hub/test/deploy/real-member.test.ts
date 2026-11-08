// P5 O8 M6b's real-member sitting, the staging harness's layer 2 (deploy/real-member.ts; docs/doperpowers/plans/
// 2026-10-28-p5-o8-org-interface.md, Decision Log "The real-member sitting"): the owner's second email added as a
// member, and its first device listed once a second scratch MAWS profile has signed in with the harness's pairing code;
// then both undone. What the steps refuse, staging's hub above all, the files they read and write (0600, outside any git
// checkout), and that no line they print holds the email or the code.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlDecode, base64urlEncode, decodePairingCode, encodePairingCode, generateSigningKey, keyId, pairingFingerprint, pairingMac, type Device, type OrgState, type SignedOrgState } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, STAGING_HOST, STAGING_ORG } from '../../deploy/config.ts';
import { codeFileRefusal, privateFileRefusal, readEmail, realMemberHubRefusal, realMemberMode, runRealMember, type RealMemberAdmin, type RealMemberOptions } from '../../deploy/real-member.ts';
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
    io: { print: (line) => void lines.push(line), secret: (value) => void secrets.push(value), sleep: async () => {} },
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
    expect(privateFileRefusal(join(scratch(), 'none'))).toMatch(/no file/);
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
      expect(privateFileRefusal(inside), marker).toMatch(/inside the git checkout/);
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
