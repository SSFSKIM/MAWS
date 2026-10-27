// `deployment access-sync` (O11 M3): the people policy `<worker> owner` made exactly the emails of the org-state head
// the hub serves, or the owner alone while it serves none, upserted by name and read back through the Access API. Run
// here against the fake Access API; test/org-members.test.ts feeds it the local hub's own answer.
import { describe, expect, it } from 'vitest';
import { admittedEmails, syncAccess } from '../../deploy/access-sync.ts';
import type { DeployConfig } from '../../deploy/config.ts';
import type { OrgStateView } from '../../src/protocol/identity.ts';
import { fakeAccessApi } from '../support/access-api.ts';
import { accessPlan, reconcileAccess } from '../../deploy/access.ts';

const config: DeployConfig = { account: 'acct', worker: 'desk-hub-staging', host: 'desk-hub-staging.example.workers.dev', ownerEmail: 'owner@example.com', sessionDuration: '24h', org: { id: 'staging-x', name: 'X' } };
const empty = { certs: [], retirements: [], revocations: [] };
const member = (id: string, email: string) => ({ id, email, role: 'member', devices: [] });
const viewOf = (emails: string[]) => ({ head: { state: { members: emails.map((email, i) => member(String(i).padStart(32, '0'), email)) }, sigs: [] }, transitions: [], certificates: empty }) as unknown as OrgStateView;

describe('the emails Access admits', () => {
  it('are the owner alone while the hub serves no state', () => {
    expect(admittedEmails(config, { head: null, transitions: [], certificates: empty })).toEqual(['owner@example.com']);
  });

  it('are exactly the head’s members’ emails, lowercased and sorted, the owner included only if listed', () => {
    expect(admittedEmails(config, viewOf(['Zed@Example.com', 'owner@example.com']))).toEqual(['owner@example.com', 'zed@example.com']);
    expect(admittedEmails(config, viewOf(['new-owner@example.com']))).toEqual(['new-owner@example.com']);
  });
});

describe('syncing the people policy', () => {
  it('rewrites the existing policy the deploy made, in place, and reads it back', async () => {
    const access = fakeAccessApi();
    await reconcileAccess(access.api, accessPlan({ name: config.worker, host: config.host, ownerEmail: config.ownerEmail, sessionDuration: config.sessionDuration }));
    const before = access.policies.size;
    const synced = await syncAccess(access.api, config, viewOf(['owner@example.com', 'b@example.com']));
    expect(synced).toMatchObject({ policy: 'desk-hub-staging owner', emails: ['b@example.com', 'owner@example.com'], readBack: ['b@example.com', 'owner@example.com'] });
    expect(access.policies.size).toBe(before);
    expect(access.calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /access/policies', 'POST /access/policies', 'POST /access/policies', 'POST /access/apps', 'POST /access/apps']);
  });

  it('creates the policy when the account has none', async () => {
    const access = fakeAccessApi();
    const synced = await syncAccess(access.api, config, { head: null, transitions: [], certificates: empty });
    expect(synced.readBack).toEqual(['owner@example.com']);
    expect([...access.policies.values()]).toEqual([expect.objectContaining({ name: 'desk-hub-staging owner', decision: 'allow' })]);
  });
});
