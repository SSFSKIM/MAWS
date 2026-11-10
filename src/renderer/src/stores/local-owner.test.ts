// This Mac's one owner in the held head (P5 O8 M5b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, the
// architect's rulings on M5b's refresh, item 1): a member list of one, or an org-owned Mac with one admin, names its
// owner; two owners, two admins, no entry for this Mac, or no view name none. The store reads `org.view` at connect and
// again at each `org.changed`, the latest read kept.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgView } from '@shared/ipc/schema/org';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { connectLocalOwner, soleOwnerOf, useLocalOwner } from './local-owner';

const member = (id: string, role: 'admin' | 'member'): OrgView['members'][number] => ({ id, email: `${id}@northwind.example`, name: id, role, you: false, devices: [] });
const machine = (ref: string, owners: string[] | 'org'): OrgView['machines'][number] => ({ name: ref, ref, owners, keyId: 'k', certified: false, delegation: null, mayGrant: false });
const view = (machines: OrgView['machines'], members = [member('me', 'admin'), member('ana', 'member')]): OrgView => ({
  version: 3,
  issued: '2026-11-09T10:00:00Z',
  maySign: false,
  recoveryKid: 'kid',
  members,
  machines,
  roots: [],
  delegations: [],
  strayKeys: [],
  hubKeys: { at: null, failed: false },
});

afterEach(() => useLocalOwner.setState({ owner: null }));

describe('soleOwnerOf', () => {
  it('names the one member a list of one names', () => {
    expect(soleOwnerOf(view([machine(TEST_MACHINE, ['me'])]), TEST_MACHINE)).toBe('me');
  });

  it("names none for two owners, this Mac's absence, or another machine's entry alone", () => {
    expect(soleOwnerOf(view([machine(TEST_MACHINE, ['me', 'ana'])]), TEST_MACHINE)).toBeNull();
    expect(soleOwnerOf(view([]), TEST_MACHINE)).toBeNull();
    expect(soleOwnerOf(view([machine(OTHER_MACHINE, ['me'])]), TEST_MACHINE)).toBeNull();
    expect(soleOwnerOf(null, TEST_MACHINE)).toBeNull();
  });

  it("resolves an org-owned Mac to its admins: one admin is its owner, two are none's", () => {
    expect(soleOwnerOf(view([machine(TEST_MACHINE, 'org')]), TEST_MACHINE)).toBe('me');
    expect(soleOwnerOf(view([machine(TEST_MACHINE, 'org')], [member('me', 'admin'), member('ana', 'admin')]), TEST_MACHINE)).toBeNull();
  });
});

describe('connectLocalOwner', () => {
  it('reads the view at connect and again at each org.changed, keeping the latest read', async () => {
    const fake = fakeClient();
    const off = connectLocalOwner(fake.client);
    await fake.reply('org.view', view([machine(TEST_MACHINE, ['me'])]));
    expect(useLocalOwner.getState().owner).toBe('me');

    // two changes: the second's read answers first, and the first's, answering after it, is older and applies nothing
    fake.event('org.changed', { state: 'none' });
    fake.event('org.changed', { state: 'none' });
    await fake.reply('org.view', view([machine(TEST_MACHINE, ['me', 'ana'])]), 1);
    expect(useLocalOwner.getState().owner).toBeNull();
    await fake.reply('org.view', view([machine(TEST_MACHINE, ['ana'])]));
    expect(useLocalOwner.getState().owner).toBeNull();

    fake.event('org.changed', { state: 'none' });
    await fake.reply('org.view', null);
    expect(useLocalOwner.getState().owner).toBeNull();
    off();
  });

  it('names none when the read fails, and applies nothing once disconnected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeClient();
    useLocalOwner.setState({ owner: 'me' });
    const off = connectLocalOwner(fake.client);
    await fake.fail('org.view');
    expect(useLocalOwner.getState().owner).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    fake.event('org.changed', { state: 'none' });
    off();
    await fake.reply('org.view', view([machine(TEST_MACHINE, ['me'])]));
    expect(useLocalOwner.getState().owner).toBeNull();
  });
});
