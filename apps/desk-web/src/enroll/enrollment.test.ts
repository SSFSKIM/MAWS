// Enrollment from the browser (DX7; the DC5 plan's M2): the hub's one-time token asked for, and the code built around
// it in the browser — the only way the org key leaves it — and a machine removed (revoked). The endpoints themselves are
// proved against the local hub (e2e-hub/); here, what the browser asks and makes of their answers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64urlEncode, decodeCode, decodeEnrollmentCode } from 'desk-hub/protocol';
import { MachinesDouble } from '../../test/double/machines';
import { ME } from '../../test/me';
import { VECTOR_KEY } from '../../test/vectors';
import { HubRequestError } from '../hub/http';
import {
  BOOT_COMMAND,
  createEnrollment,
  createProvisioningKey,
  enrollmentCode,
  listMachines,
  listProvisioningKeys,
  machineNameProblem,
  prefixProblem,
  provisioningCode,
  removeMachine,
  revokeProvisioningKey,
} from './enrollment';

afterEach(() => vi.unstubAllGlobals());

describe('enrollmentCode', () => {
  it('is DX7\'s code — hub, org, token, machine, and the key — and wipes the key\'s bytes once built', () => {
    const key = Uint8Array.from(VECTOR_KEY);
    const code = enrollmentCode({ hub: 'http://127.0.0.1:8747', org: 'local', token: 'tok', machine: 'mini', key });
    expect(decodeEnrollmentCode(code)).toEqual({ hub: 'http://127.0.0.1:8747', org: 'local', token: 'tok', machine: 'mini', key: base64urlEncode(VECTOR_KEY) });
    expect(key.every((b) => b === 0)).toBe(true);
  });

  it('wipes the key even when the code cannot be built', () => {
    const key = Uint8Array.from(VECTOR_KEY);
    expect(() => enrollmentCode({ hub: 'http://example.com', org: 'local', token: 'tok', machine: 'mini', key })).toThrow(/https/);
    expect(key.every((b) => b === 0)).toBe(true);
  });
});

describe('machineNameProblem', () => {
  const machines = [{ name: 'Mini' }];
  it('admits a name DX7 admits that no enrolled machine holds, compared without case', () => {
    expect(machineNameProblem('studio', machines)).toBeNull();
    expect(machineNameProblem('mini', machines)).toMatch(/already/);
    expect(machineNameProblem('hub', machines)).toMatch(/letters, digits/);
    expect(machineNameProblem('my mac', machines)).toMatch(/letters, digits/);
    expect(machineNameProblem('', machines)).toMatch(/Name the machine/);
  });
});

describe('createEnrollment', () => {
  it('asks the hub for a one-time token', async () => {
    const fetch = vi.fn(async () => Response.json({ enrollment: { id: 'e1', expires: '2026-10-15T10:15:00.000Z' }, token: 'tok' }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    expect(await createEnrollment()).toMatchObject({ token: 'tok' });
    expect(fetch).toHaveBeenCalledWith('/api/enrollments', expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('carries the hub\'s refusal by its code', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'not-admin' }, { status: 403 }));
    const refused = await createEnrollment().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HubRequestError);
    expect(refused).toMatchObject({ status: 403, code: 'not-admin' });
  });
});

describe('removeMachine', () => {
  it("asks the hub to revoke the machine by its name, and answers the name revoked", async () => {
    const fetch = vi.fn(async () => Response.json({ revoked: 'Mini.local' }));
    vi.stubGlobal('fetch', fetch);
    expect(await removeMachine('Mini.local')).toEqual({ revoked: 'Mini.local' });
    expect(fetch).toHaveBeenCalledWith('/api/machines/Mini.local', expect.objectContaining({ method: 'DELETE' }));
  });

  it('takes the machine off the list the hub serves, matched without case as the hub matches names', async () => {
    const hub = new MachinesDouble();
    hub.add('mini');
    hub.add('studio');
    vi.stubGlobal('fetch', hub.fetch(ME.member));
    expect(await removeMachine('MINI')).toEqual({ revoked: 'mini' });
    expect((await listMachines()).map((m) => m.name)).toEqual(['studio']);
  });

  it("carries the hub's refusals by their codes: not an admin, and a machine it does not hold", async () => {
    const hub = new MachinesDouble();
    hub.add('mini');
    vi.stubGlobal('fetch', hub.fetch({ ...ME.member, role: 'member' }));
    expect(await removeMachine('mini').catch((error: unknown) => error)).toMatchObject({ status: 403, code: 'not-admin' });
    expect(hub.machines.map((m) => m.name)).toEqual(['mini']);

    vi.stubGlobal('fetch', hub.fetch(ME.member));
    const unknown = await removeMachine('studio').catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(HubRequestError);
    expect(unknown).toMatchObject({ status: 404, code: 'unknown-machine' });
  });
});

// Provisioning keys (the provisioning-keys spec, §5): the key asked for, and its code built in the browser as the
// one-time code is — the org key in it, the hub never seeing it.
describe('provisioningCode', () => {
  it("is the provisioning code — hub, org, the key's secret, its prefix, and the org key — and wipes the key's bytes once built", () => {
    const key = Uint8Array.from(VECTOR_KEY);
    const code = provisioningCode({ hub: 'http://127.0.0.1:8747', org: 'local', token: 'secret', prefix: 'dc-', key });
    expect(code.startsWith('smns-provision-v1.')).toBe(true);
    expect(decodeCode(code)).toEqual({ kind: 'provision', hub: 'http://127.0.0.1:8747', org: 'local', token: 'secret', prefix: 'dc-', key: base64urlEncode(VECTOR_KEY) });
    expect(key.every((b) => b === 0)).toBe(true);
  });

  it('wipes the key even when the code cannot be built', () => {
    const key = Uint8Array.from(VECTOR_KEY);
    expect(() => provisioningCode({ hub: 'http://example.com', org: 'local', token: 'secret', prefix: 'dc-', key })).toThrow(/https/);
    expect(key.every((b) => b === 0)).toBe(true);
  });
});

describe('prefixProblem', () => {
  it('admits a prefix the hub admits, and says the grammar in words otherwise', () => {
    expect(prefixProblem('dc-')).toBeNull();
    expect(prefixProblem('build.')).toBeNull();
    expect(prefixProblem('')).toMatch(/Name the prefix/);
    for (const refused of ['hub', 'Legacy', '-x', '.x', 'my vm', 'x'.repeat(64), 'dc/'])
      expect(prefixProblem(refused), refused).toBe(
        'A prefix starts every machine name: letters, digits, dots, dashes, and underscores, starting with a letter or digit, at most 63 characters, and not "hub" or "legacy".',
      );
  });
});

describe('BOOT_COMMAND', () => {
  it('pipes the code into the enrollment under a name the prefix starts, never on the command line', () => {
    expect(BOOT_COMMAND('dc-')).toBe('printf %s "$CODE" | sminos hub enroll --name dc-<machine>');
  });
});

describe('provisioning keys at the hub', () => {
  it('asks for a key with the request as given, and answers the record with its secret', async () => {
    const hub = new MachinesDouble();
    vi.stubGlobal('fetch', hub.fetch(ME.member));
    const issued = await createProvisioningKey({ label: 'devcloud', prefix: 'dc-', ttl_s: 2_592_000, max_uses: 5, offline_revoke_s: 21_600 });
    expect(hub.keyRequests).toEqual([{ label: 'devcloud', prefix: 'dc-', ttl_s: 2_592_000, max_uses: 5, offline_revoke_s: 21_600 }]);
    expect(issued.key).toMatchObject({ label: 'devcloud', prefix: 'dc-', uses: 0, max_uses: 5, offline_revoke_s: 21_600, revoked: null, machines: [] });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('lists every key with the machines enrolled through it, and the secret in none', async () => {
    const hub = new MachinesDouble();
    const key = hub.addKey('devcloud', 'dc-');
    hub.enrollThrough(key.id, 'dc-a-0001', 'active');
    vi.stubGlobal('fetch', hub.fetch(ME.member));
    const keys = await listProvisioningKeys();
    expect(keys).toEqual([expect.objectContaining({ id: key.id, label: 'devcloud', uses: 1, machines: [{ name: 'dc-a-0001', state: 'active' }] })]);
    expect(JSON.stringify(keys)).not.toContain('token');
  });

  it('revokes a key by its id, and carries the refusals by their codes: not an admin, and a key it does not hold', async () => {
    const hub = new MachinesDouble();
    const key = hub.addKey('devcloud', 'dc-');
    vi.stubGlobal('fetch', hub.fetch({ ...ME.member, role: 'member' }));
    expect(await revokeProvisioningKey(key.id).catch((error: unknown) => error)).toMatchObject({ status: 403, code: 'not-admin' });
    expect(await createProvisioningKey({ label: 'x', prefix: 'x-' }).catch((error: unknown) => error)).toMatchObject({ status: 403, code: 'not-admin' });

    vi.stubGlobal('fetch', hub.fetch(ME.member));
    expect(await revokeProvisioningKey(key.id)).toEqual({ revoked: key.id });
    expect(hub.keys[0].revoked).not.toBeNull();
    const unknown = await revokeProvisioningKey('f'.repeat(32)).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(HubRequestError);
    expect(unknown).toMatchObject({ status: 404, code: 'unknown-key' });
  });
});
