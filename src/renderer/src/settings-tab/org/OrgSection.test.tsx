// P5 O8 M1: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"; M1's Proves),
// the shell's cases: the status read and followed, the states before a registration (the code field, the sign-in's
// steps, development), and no code shown back. M4a (the split): the page is in Q1's four groups, the view read again at
// each `org.changed`, and a refusal that names no attempt kept in a place of its own. The groups' cases are in their own
// suites (YouGroup, PeopleGroup, MachinesGroup, OrgGroup, ChangeSheet, PairSheet).
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { OrgStatusSchema } from '@shared/ipc/schema/org';
import { OrgSection } from './OrgSection';
import { CODE, REGISTERED, emit, found, group, renderSection, resetHarness, row, sent, signing, ROOT } from './test-support';

// The file's own clock: Date is frozen before any module loads, so `app/use-now`'s module-level `now` equals every
// `Date.now()` here (see YouGroup.test.tsx). Only Date is faked; timers stay real for the waits.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(resetHarness);

describe('Settings › Org', () => {
  it('none: the code field signs in with the trimmed code, clears the field and never shows the code back', async () => {
    renderSection({ state: 'none' });
    expect(await screen.findByText('This Mac isn’t signed in to an org.')).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/deployment admin pair --class native-mac/)).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/an admin pairs it from their Org page \(Pair a device\)/)).toBeTruthy();
    const field = within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }) as HTMLInputElement;
    const button = within(row('Pairing code')).getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(field, { target: { value: `  ${CODE}\n ` } });
    fireEvent.click(button);
    await vi.waitFor(() => expect(sent('org.register')).toEqual([{ code: CODE }]));
    expect(field.value).toBe('');
    // the sign-in runs: the status moves on, and nothing on the page carries the code
    emit({ state: 'registering', step: 'browser', org: 'org-1f2e', hub: 'https://hub.example.com', fingerprint: null, expires: null });
    expect(screen.getByText('Finish signing in in the browser.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('one Sign in under StrictMode sends one org.register and no org.cancel, through the browser, checking and approval', async () => {
    renderSection({ state: 'none' }, {}, true);
    const field = (await screen.findByRole('textbox', { name: 'Pairing code' })) as HTMLInputElement;
    fireEvent.change(field, { target: { value: CODE } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(sent('org.register')).toHaveLength(1));
    const at = (step: 'browser' | 'checking' | 'approval') =>
      emit({ state: 'registering', step, org: 'org-1f2e', hub: 'https://hub.example.com', fingerprint: step === 'approval' ? '65u7k-rscy7' : null, expires: step === 'approval' ? new Date(Date.now() + 600_000).toISOString() : null });
    at('browser');
    at('checking');
    at('approval');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(sent('org.register')).toHaveLength(1);
    expect(sent('org.signIn')).toEqual([]);
    expect(sent('org.cancel')).toEqual([]);
  });

  it('Enter sends too; a refusal from the command is one line under the field, worded by its code', async () => {
    renderSection({ state: 'none' }, { 'org.register': () => ({ ok: false, reason: { code: 'not-member', detail: 'someone@example.com' } }) });
    const field = (await screen.findByRole('textbox', { name: 'Pairing code' })) as HTMLInputElement;
    fireEvent.change(field, { target: { value: CODE } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect((await within(row('Pairing code')).findByRole('alert')).textContent).toBe('someone@example.com isn’t a member of this org.');
    expect(sent('org.register')).toEqual([{ code: CODE }]);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('none: the status’s own refusal shows under the field', async () => {
    // M4a: the status names the attempt its refusal ended (`refused.attempt`), here the sign-in's `register`.
    renderSection({ state: 'none', refused: { code: 'expired', attempt: 'register' } });
    expect(within(await found('Pairing code')).getByRole('alert').textContent).toBe('The approval wasn’t given in time. Start again with a new code.');
  });

  it('registering: the step in words with Cancel; at approval, the fingerprint and where to compare it', async () => {
    renderSection({ state: 'registering', step: 'checking', org: 'org-1f2e', hub: 'https://hub.example.com', fingerprint: null, expires: null });
    expect(within(await found('Signing in')).getByText('Checking the org…')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Fingerprint' })).toBeNull();
    fireEvent.click(within(row('Signing in')).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(sent('org.cancel')).toEqual([undefined]));

    emit({ state: 'registering', step: 'approval', org: 'org-1f2e', hub: 'https://hub.example.com', fingerprint: 'B7-4K-9Q-2M', expires: '2026-10-28T10:30:00.000Z' });
    expect(within(row('Signing in')).getByText(/^Waiting for approval until /)).toBeTruthy();
    const fingerprint = within(row('Fingerprint')).getByText('B7-4K-9Q-2M');
    expect(fingerprint.className).toContain('font-mono');
    expect(within(row('Fingerprint')).getByText('Compare it with the approving device, then approve there.')).toBeTruthy();
  });

  it('development: the session comes from MAWS_DEV_ORG', async () => {
    renderSection({ state: 'development', org: 'org-dev', member: 'dev-member', device: 'dev-device' });
    expect(within(await found('Development')).getByText('This session comes from MAWS_DEV_ORG.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('no prop carries a token: the section takes none, and no status member names a code, token, key or secret', () => {
    expect(OrgSection.length).toBe(0);
    const members = OrgStatusSchema.options.flatMap((option) => Object.keys(option.shape));
    expect(members.filter((name) => /code|token|key|secret|nonce|credential/i.test(name))).toEqual([]);
  });

  it('an org.changed before the read answers is kept over the read', async () => {
    renderSection({ state: 'none' });
    emit({ ...REGISTERED, session: 'removed' });
    await vi.waitFor(() => expect(sent('org.status')).toHaveLength(1));
    await act(async () => {});
    expect(screen.getByText('This Mac is no longer in the org.')).toBeTruthy();
    expect(screen.queryByText('This Mac isn’t signed in to an org.')).toBeNull();
  });
});

describe('Settings › Org: the page (M4a)', () => {
  it('a registered Mac’s page is in Q1’s four groups, in order: You, People, Machines, Org', async () => {
    renderSection(signing(ROOT));
    await group('machines');
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['You', 'People', 'Machines', 'Org']);
    expect(within(await group('you')).getByRole('group', { name: 'Account' })).toBeTruthy();
    expect(within(await group('org')).getByRole('group', { name: 'Org state' })).toBeTruthy();
  });

  it('without a verified head there is no view: You and Org only', async () => {
    renderSection({ ...REGISTERED, problem: 'held-chain', head: null }, { 'org.view': () => null });
    await group('org');
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(1));
    await act(async () => {});
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['You', 'Org']);
  });

  it('the view is read again at each org.changed, and not before a registration', async () => {
    renderSection({ state: 'none' });
    await found('Pairing code');
    expect(sent('org.view')).toEqual([]);
    emit(signing(ROOT));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(1));
    emit(signing(ROOT, { head: { version: 13, issued: new Date().toISOString() } }));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(2));
  });

  it('a refusal that names no attempt still shows, in a row of its own, never under a control', async () => {
    renderSection({ state: 'none', refused: { code: 'keys', detail: 'keys.json is gone' } });
    expect(within(await found('Refused')).getByRole('alert').textContent).toBe('This Mac’s device keys couldn’t be used. · keys.json is gone');
    expect(within(row('Pairing code')).queryByRole('alert')).toBeNull();
  });
});
