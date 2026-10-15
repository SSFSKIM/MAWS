// Enrollment from the browser (DX7; the DC5 plan's M2): the hub's one-time token asked for, and the code built around
// it in the browser — the only way the org key leaves it. The endpoints themselves are proved against the local hub
// (e2e/local-hub.spec.ts); here, what the browser makes of their answers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64urlEncode, decodeEnrollmentCode } from 'desk-hub/protocol';
import { VECTOR_KEY } from '../../test/vectors';
import { createEnrollment, enrollmentCode, HubRequestError, machineNameProblem } from './enrollment';

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
