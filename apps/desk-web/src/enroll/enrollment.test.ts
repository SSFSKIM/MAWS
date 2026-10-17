// Enrollment from the browser (DX7; the DC5 plan's M2): the hub's one-time token asked for, and the code built around
// it in the browser — the only way the org key leaves it — and a machine removed (revoked). The endpoints themselves are
// proved against the local hub (e2e-hub/); here, what the browser asks and makes of their answers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64urlEncode, decodeEnrollmentCode } from 'desk-hub/protocol';
import { MachinesDouble } from '../../test/double/machines';
import { ME } from '../../test/me';
import { VECTOR_KEY } from '../../test/vectors';
import { HubRequestError } from '../hub/http';
import { createEnrollment, enrollmentCode, listMachines, machineNameProblem, removeMachine } from './enrollment';

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
