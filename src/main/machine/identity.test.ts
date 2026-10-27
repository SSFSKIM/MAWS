import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codecOf } from '@shared/ipc/validate';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName } from '@shared/ipc/schema';
import { IDENTITY_FILE } from '@shared/machine/identity-file';
import { machineName, startMachineIdentity } from './identity';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-machine-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// What main's startup registers, captured: the one handler, by name.
function start(userData: string, env: NodeJS.ProcessEnv = {}, hostname = 'studio.local') {
  const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
  const identity = startMachineIdentity({ userData, env, hostname, register: (name: CommandName, handler: (input: never, ctx: never) => unknown) => void handlers.set(name, handler as never) });
  return { identity, handlers };
}

describe("main's machine identity", () => {
  it('mints the ref into <userData>/machine.json at the first start and reads the same one at every start after', () => {
    const profile = join(root, 'profile-a');
    const first = start(profile).identity;
    expect(JSON.parse(readFileSync(join(profile, IDENTITY_FILE), 'utf8')).ref).toBe(first.ref);
    expect(start(profile).identity.ref).toBe(first.ref);
    expect(start(join(root, 'profile-b')).identity.ref).not.toBe(first.ref); // a second profile is another machine
  });

  it('answers machine.identity with { ref, name, project }, the machine project until M5 derives more', async () => {
    const { identity, handlers } = start(join(root, 'p'), { MAWS_MACHINE_NAME: 'standin-b' });
    expect([...handlers.keys()]).toEqual(['machine.identity']);
    const answer = await handlers.get('machine.identity')!(undefined, { client: null });
    expect(answer).toEqual({ ref: identity.ref, name: 'standin-b', project: { key: `machine:${identity.ref}`, name: 'standin-b', smnsId: null } });
    expect(codecOf(REGISTRY).validateCommandOutput('machine.identity', answer).ok).toBe(true);
  });

  it('stops startup on a malformed identity file, naming its path, and leaves the file as it was', () => {
    const profile = join(root, 'broken');
    start(profile);
    writeFileSync(join(profile, IDENTITY_FILE), '{"version":1,"ref":"not/a/ref"}');
    expect(() => start(profile)).toThrow(join(profile, IDENTITY_FILE));
    expect(readFileSync(join(profile, IDENTITY_FILE), 'utf8')).toBe('{"version":1,"ref":"not/a/ref"}');
  });
});

describe('the machine name', () => {
  it('is MAWS_MACHINE_NAME when set, else the hostname up to its first dot', () => {
    expect(machineName({ MAWS_MACHINE_NAME: 'standin-a' }, 'studio.local')).toBe('standin-a');
    expect(machineName({}, 'studio.local')).toBe('studio');
    expect(machineName({}, 'mini')).toBe('mini');
    expect(machineName({ MAWS_MACHINE_NAME: '' }, 'a.b.c')).toBe('a'); // an empty variable is unset
  });
});
