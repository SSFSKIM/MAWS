// The proof commands' guards (deploy/proof.ts and every command that enrolls or writes): they run only in a throwaway
// org that is named explicitly, is not the owner's, and is the one the deployment serves, checked before any enrollment
// or write; and they clean up whatever they enrolled or minted, every step attempted, failing when one fails. Run
// against the local hub and stubs only: never the deployment.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main as fakeCheck } from '../../deploy/fake-check.ts';
import { main as frameCost } from '../../deploy/frame-cost.ts';
import { Person } from '../../deploy/hub.ts';
import { main as measure } from '../../deploy/measure.ts';
import { main as probe } from '../../deploy/probe.ts';
import { assertServesOrg, Cleanup, revoke, testOrgArg } from '../../deploy/proof.ts';
import { main as redeployCheck } from '../../deploy/redeploy-check.ts';
import { IDENTITY_HEADER } from '../../local/standin.ts';
import { enroll } from '../support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';

// Where the commands find the app's files (bin.ts defines it when it bundles them).
process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

/** The admin at the local hub, named to the stand-in as a browser's sign-in would. */
class LocalPerson extends Person {
  get headers(): Record<string, string> {
    return { [IDENTITY_HEADER]: ADMIN };
  }
}
const person = () => new LocalPerson(hub.url, 'unused');
const machines = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string }> }).machines.map((m) => m.name);

describe('the throwaway org', () => {
  it('must be named, and must not be the owner’s', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(testOrgArg(undefined, 'ssfskim')).toBeNull();
    expect(testOrgArg('ssfskim', 'ssfskim')).toBeNull();
    expect(testOrgArg('dc3-m5-test', 'ssfskim')).toBe('dc3-m5-test');
    quiet.mockRestore();
  });

  it('must be the org the deployment serves, checked before anything is enrolled', async () => {
    const before = await machines();
    await expect(assertServesOrg(person(), 'dc3-m5-test')).rejects.toThrow(/serves the org org-local/);
    await expect(assertServesOrg(person(), ORG)).resolves.toBeUndefined();
    expect(await machines()).toEqual(before);
  });

  it('is required by every command that enrolls or writes, which refuses before reading a credential', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const command of [probe, fakeCheck, measure, frameCost, redeployCheck]) {
      expect(await command([])).toBe(2);
      expect(await command(['--test-org', 'ssfskim'])).toBe(2);
    }
    expect(quiet.mock.calls.flat().join('\n')).toMatch(/--test-org/);
    quiet.mockRestore();
  });
});

describe('cleaning up', () => {
  it('attempts every step though one fails, and reports the ones that failed', async () => {
    const ran: string[] = [];
    const cleanup = new Cleanup();
    cleanup.add('first', async () => void ran.push('first'));
    cleanup.add('broken', async () => {
      ran.push('broken');
      throw new Error('the API is down');
    });
    cleanup.add('last', async () => void ran.push('last'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await cleanup.run()).toEqual(['broken: the API is down']);
    quiet.mockRestore();
    expect(ran).toEqual(['last', 'broken', 'first']);
  });

  it('revokes an enrolled machine, takes one the hub does not hold as gone, and fails on any other answer', async () => {
    await enroll(hub, ADMIN, 'cleanup-a');
    await revoke(person(), 'cleanup-a');
    expect(await machines()).not.toContain('cleanup-a');
    await expect(revoke(person(), 'cleanup-a')).resolves.toBeUndefined();
    const refused = { fetch: async () => new Response('{"error":"not-admin"}', { status: 403 }) } as unknown as Person;
    await expect(revoke(refused, 'cleanup-b')).rejects.toThrow(/403/);
  });
});
