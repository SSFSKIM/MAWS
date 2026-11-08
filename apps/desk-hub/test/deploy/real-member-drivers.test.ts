// The real-member runs' drivers (deploy/keep-a1.ts, deploy/sweep-leftovers.ts): what their command lines admit before a
// secret is read or anything reaches the hub or the VM, the commands keep-a1 reads from its control file, and the reach
// items' log lines with the members' emails masked.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, STAGING_HOST } from '../../deploy/config.ts';
import { commandOf, keepA1Mode } from '../../deploy/keep-a1.ts';
import { masked } from '../../deploy/reach-items.ts';
import { LEFTOVER, sweepMode } from '../../deploy/sweep-leftovers.ts';

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

describe('the reach items’ log lines', () => {
  it('mask A’s and B’s emails wherever a row names them', () => {
    const scene = { a: { email: 'admin@example.invalid' }, b: { email: 'second@staging.invalid' } } as Parameters<typeof masked>[0];
    expect(masked(scene, '[sminos chat p from o18-u (admin@example.invalid) → @s] hi; second@staging.invalid, admin@example.invalid')).toBe('[sminos chat p from o18-u (<A’s email>) → @s] hi; <B’s email>, <A’s email>');
  });
});
