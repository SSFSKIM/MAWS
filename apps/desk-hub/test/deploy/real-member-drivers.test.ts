// The real-member runs' drivers (deploy/keep-a1.ts, deploy/sweep-leftovers.ts): what their command lines admit before a
// secret is read or anything reaches the hub or the VM, the commands keep-a1 reads from its control file, and the reach
// items' and keep-a1's log lines with the members' emails masked, and sweep-leftovers's two steps for each name.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, STAGING_HOST } from '../../deploy/config.ts';
import { commandOf, controlReader, keepA1Mode, maskEmails } from '../../deploy/keep-a1.ts';
import { masked } from '../../deploy/reach-items.ts';
import { LEFTOVER, sweepMode, sweepName } from '../../deploy/sweep-leftovers.ts';

const deploy = join(import.meta.dirname, '../../deploy');
const staging = JSON.parse(readFileSync(join(deploy, 'staging.json'), 'utf8')) as { worker: string; host: string };
const production = { worker: 'desk-hub', host: PRODUCTION_HOST };
const B = '2efcca5d0c0e4d6f9a1b3c5d7e9f0a1b';
const good = { 'device-keys': '/k/keys.json', vm: 'dc-o8-m6b-1a2b', 'direct-url': 'ws://100.64.0.7', member: B, control: '/c/keep-a1.control' };
const there = (path: string) => path === good.control;

describe('keep-a1’s command line', () => {
  it('runs at staging with every argument given', () => {
    expect(staging.host).toBe(STAGING_HOST);
    expect(keepA1Mode(good, staging, there)).toEqual({ run: { vm: good.vm, host: '100.64.0.7', member: B, control: good.control, deviceKeys: good['device-keys'] } });
    expect(keepA1Mode({ ...good, 'direct-url': 'wss://vm.tail.ts.net:47841' }, staging, there)).toMatchObject({ run: { host: 'vm.tail.ts.net' } });
  });

  it('is refused for production’s config, by worker or by host, before any other argument is read', () => {
    expect(keepA1Mode(good, production, there)).toEqual({ refused: expect.stringMatching(/names production .* staging alone/) });
    expect(keepA1Mode(good, { ...staging, worker: 'desk-hub' }, there)).toEqual({ refused: expect.stringMatching(/names production/) });
    expect(keepA1Mode({}, { ...staging, host: PRODUCTION_HOST }, there)).toEqual({ refused: expect.stringMatching(/names production/) });
  });

  it('is refused without the admin device, a devcloud VM, the VM’s direct address, a member id or an existing control file', () => {
    const refused = (values: Record<string, string | undefined>, why: RegExp) => expect(keepA1Mode({ ...good, ...values }, staging, there), JSON.stringify(values)).toEqual({ refused: expect.stringMatching(why) });
    refused({ 'device-keys': undefined }, /--device-keys/);
    for (const vm of [undefined, 'o8-vm', 'dc-', 'dc-Upper', 'dc-a;rm -rf', `dc-${'a'.repeat(62)}`]) refused({ vm }, /--vm/);
    for (const url of [undefined, 'http://100.64.0.7', 'ws://', 'ws://a b', 'ws://h/path']) refused({ 'direct-url': url }, /--direct-url/);
    for (const member of [undefined, B.toUpperCase(), B.slice(1), `${B}0`, 'owner@example.invalid']) refused({ member }, /--member/);
    refused({ control: undefined }, /--control/);
    refused({ control: '/c/elsewhere' }, /--control/);
  });
});

describe('keep-a1’s control lines', () => {
  it('reads each command with its arguments', () => {
    expect(commandOf('down')).toEqual({ verb: 'down' });
    expect(commandOf('  access org-view S ')).toEqual({ verb: 'access', level: 'org-view', target: 'S' });
    expect(commandOf('share converse L')).toEqual({ verb: 'share', grade: 'converse', target: 'L' });
    expect(commandOf('share none S')).toEqual({ verb: 'share', grade: null, target: 'S' });
    expect(commandOf('policy L')).toEqual({ verb: 'policy', target: 'L' });
    expect(commandOf('adraft A’s  draft, kept')).toEqual({ verb: 'adraft', text: 'A’s draft, kept' });
    expect(commandOf('aread')).toEqual({ verb: 'aread' });
    expect(commandOf('terminal-share')).toEqual({ verb: 'terminal-share' });
  });

  it('reads nothing else as one: an unknown verb, level, grade or session, or a word too many or too few', () => {
    for (const line of ['', 'up', 'down now', 'access public S', 'access listed T', 'access listed', 'share edit S', 'share view', 'share view S L', 'policy', 'policy B', 'adraft', 'aread L', 'terminal-share S']) {
      expect(commandOf(line), line).toBeNull();
    }
  });
});

describe('keep-a1’s control file', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const file = (initial: string) => {
    dir = mkdtempSync(join(tmpdir(), 'keep-a1-control-'));
    const path = join(dir, 'keep-a1.control');
    writeFileSync(path, initial);
    return path;
  };

  it('reads only what is appended after it starts, and the command after a non-ASCII line whole', () => {
    const path = file('adraft from an earlier run, é\n');
    const read = controlReader(path);
    expect(read()).toEqual([]);
    appendFileSync(path, 'adraft A’s café — naïve 🙂\n');
    expect(read()).toEqual(['adraft A’s café — naïve 🙂']);
    appendFileSync(path, 'down\n');
    expect(read()).toEqual(['down']);
    appendFileSync(path, 'adraft ü\n  share view S \n\ndown\n');
    expect(read()).toEqual(['adraft ü', 'share view S', 'down']);
  });

  it('holds a line until its newline lands, a character split across the appends included', () => {
    const path = file('');
    const read = controlReader(path);
    appendFileSync(path, 'do');
    expect(read()).toEqual([]);
    appendFileSync(path, 'wn\naccess list');
    expect(read()).toEqual(['down']);
    appendFileSync(path, 'ed S\n');
    expect(read()).toEqual(['access listed S']);
    const e = Buffer.from('é');
    appendFileSync(path, Buffer.concat([Buffer.from('adraft caf'), e.subarray(0, 1)]));
    expect(read()).toEqual([]);
    appendFileSync(path, Buffer.concat([e.subarray(1), Buffer.from('\n')]));
    expect(read()).toEqual(['adraft café']);
    expect(read()).toEqual([]);
  });
});

describe('keep-a1’s printed lines', () => {
  it('mask every member email the head lists, however short, and print as given before the head is read', () => {
    const line = '> adraft ask jo@ex.io, or kjo@ex.io (cc owner@example.invalid)';
    expect(maskEmails([], line)).toBe(line);
    expect(maskEmails(['jo@ex.io', 'owner@example.invalid', 'kjo@ex.io', ''], line)).toBe('> adraft ask <a member’s email>, or <a member’s email> (cc <a member’s email>)');
  });
});

describe('sweep-leftovers’s command line', () => {
  it('sweeps only the reach run’s scene and probe machines, each once', () => {
    expect(sweepMode({ 'device-keys': '/k' }, ['o18-a1-5eb586', 'o18-pa-3c09d1', 'o18-a1-5eb586'], staging)).toEqual({ names: ['o18-a1-5eb586', 'o18-pa-3c09d1'] });
    for (const name of ['o18-a1-5eb586', 'o18-a2-000000', 'o18-a3-abcdef', 'o18-b1-123456', 'o18-pb-ffffff']) expect(LEFTOVER.test(name), name).toBe(true);
  });

  it('is refused for production, without the admin device, with no name, or with any other machine’s name', () => {
    expect(sweepMode({ 'device-keys': '/k' }, ['o18-a1-5eb586'], production)).toEqual({ refused: expect.stringMatching(/names production/) });
    expect(sweepMode({}, ['o18-a1-5eb586'], staging)).toEqual({ refused: expect.stringMatching(/--device-keys/) });
    expect(sweepMode({ 'device-keys': '/k' }, [], staging)).toEqual({ refused: expect.stringMatching(/name the reach run/) });
    for (const name of ['macbook', 'mini', 'o10-acceptance-1', 'o18-a4-5eb586', 'o18-a1-5EB586', 'o18-a1-5eb58', 'o18-a1-5eb5867', 'o18-l1-5eb586', ' o18-a1-5eb586']) {
      expect(sweepMode({ 'device-keys': '/k' }, ['o18-a1-5eb586', name], staging), name).toEqual({ refused: expect.stringContaining(name) });
    }
  });
});

describe('sweep-leftovers’s steps for a name', () => {
  const sweep = async (unlist: () => Promise<string>, revoke: () => Promise<void>) => {
    const lines: string[] = [];
    const revoked: string[] = [];
    const held = await sweepName('o18-a1-5eb586', { unlist, revoke: async (name) => (revoked.push(name), revoke()) }, (line) => lines.push(line));
    return { held, lines, revoked };
  };

  it('revokes the hub credential when the unlisting fails, and says both failed or held', async () => {
    expect(await sweep(() => Promise.reject(new Error('the head did not verify')), async () => {})).toEqual({
      held: false,
      lines: ['o18-a1-5eb586: FAILED taking it out of the org state: the head did not verify', 'o18-a1-5eb586: its hub credential revoked'],
      revoked: ['o18-a1-5eb586'],
    });
    expect(await sweep(async () => 'already out', () => Promise.reject(new Error('revoking o18-a1-5eb586: 500')))).toEqual({
      held: false,
      lines: ['o18-a1-5eb586: already out', 'o18-a1-5eb586: FAILED revoking its hub credential: revoking o18-a1-5eb586: 500'],
      revoked: ['o18-a1-5eb586'],
    });
    expect(await sweep(async () => 'taken out, its key retired (version 9)', async () => {})).toMatchObject({ held: true, lines: ['o18-a1-5eb586: taken out, its key retired (version 9)', 'o18-a1-5eb586: its hub credential revoked'] });
  });
});

describe('the reach items’ log lines', () => {
  it('mask A’s and B’s emails wherever a row names them', () => {
    const scene = { a: { email: 'admin@example.invalid' }, b: { email: 'second@staging.invalid' } } as Parameters<typeof masked>[0];
    expect(masked(scene, '[sminos chat p from o18-u (admin@example.invalid) → @s] hi; second@staging.invalid, admin@example.invalid')).toBe('[sminos chat p from o18-u (<A’s email>) → @s] hi; <B’s email>, <A’s email>');
  });
});
