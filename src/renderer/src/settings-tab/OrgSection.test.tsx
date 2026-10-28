// P5 O8 M1: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"; M1's Proves):
// each status drawn; Sign in sends `org.register` with the trimmed code and clears the field; Cancel, Sign out and Sign
// in again; the fingerprint at approval; Re-anchor in `held-chain`; a refusal's line; and no code shown back.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import { OrgStatusSchema, type OrgAttempt, type OrgStatus } from '@shared/ipc/schema/org';
import { validateCommandInput } from '@shared/ipc/validate';
import { useNotices } from '../stores/notices';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { OrgSection } from './OrgSection';

const CODE = 'mawspair-7Hq2xVb9-secret';
const DEVICE = 'k9F3aQ2mZt7bW1xYc0dE';
const DAY = 86_400_000;

const REGISTERED: OrgStatus = {
  state: 'registered',
  org: 'org-1f2e',
  hub: 'https://hub.example.com',
  member: { id: '0123456789abcdef0123456789abcdef', email: 'owner@example.com' },
  device: DEVICE,
  session: 'signed-in',
  hubAccess: 'connected',
  head: { version: 12, issued: new Date(Date.now() - 3 * DAY).toISOString() },
  problem: null,
};

let calls: { name: string; input: unknown }[];
let emit: (status: OrgStatus) => void;

function renderSection(status: OrgStatus, answers: Partial<Record<CommandName, () => unknown>> = {}) {
  calls = [];
  const listeners = new Set<(payload: unknown) => void>();
  emit = (next) => act(() => listeners.forEach((listener) => listener(OrgStatusSchema.parse(next))));
  const answer: Partial<Record<CommandName, () => unknown>> = {
    'org.status': () => status,
    'org.register': () => ({ ok: true }) satisfies OrgAttempt,
    'org.signIn': () => ({ ok: true }) satisfies OrgAttempt,
    'org.reanchor': () => ({ ok: true }) satisfies OrgAttempt,
    'org.cancel': () => undefined,
    'org.signOut': () => undefined,
    ...answers,
  };
  window.maws = {
    invoke: vi.fn(async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name, input);
      if (!checked.ok) return checked;
      const reply = answer[name];
      return reply ? { ok: true, value: reply() } : { ok: false, error: { code: 'internal', message: `no answer for ${name}` } };
    }),
    on: (name: string, listener: (payload: unknown) => void) => {
      if (name !== 'org.changed') return () => {};
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pathForFile: () => '',
    localMachine: TEST_MACHINE,
  } as unknown as PreloadBridge;
  return render(<OrgSection />);
}
const row = (label: string) => screen.getByRole('group', { name: label });
const found = (label: string) => screen.findByRole('group', { name: label }); // once the status has been read
const sent = (name: string) => calls.filter((c) => c.name === name).map((c) => c.input);

afterEach(() => {
  cleanup();
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('Settings › Org', () => {
  it('none: the code field signs in with the trimmed code, clears the field and never shows the code back', async () => {
    renderSection({ state: 'none' });
    expect(await screen.findByText('This Mac isn’t signed in to an org.')).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/deployment admin pair --class native-mac/)).toBeTruthy();
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
    renderSection({ state: 'none', refused: { code: 'expired' } });
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

  it('registered and signed in: org, account, the device id’s first 8, the hub, the org state’s age, Sign out', async () => {
    renderSection(REGISTERED);
    expect(within(await found('Org')).getByText('org-1f2e')).toBeTruthy();
    expect(within(row('Account')).getByText('owner@example.com')).toBeTruthy();
    expect(within(row('This Mac')).getByText(DEVICE.slice(0, 8))).toBeTruthy();
    expect(screen.queryByText(DEVICE)).toBeNull();
    expect(within(row('Hub')).getByText('Connected')).toBeTruthy();
    expect(within(row('Hub')).queryByRole('button')).toBeNull();
    const age = within(row('Org state')).getByText('Version 12 · 3 days old');
    expect(age.className).not.toContain('text-warning');
    expect(within(row('Org state')).getByText(/30 days old/)).toBeTruthy(); // the backstop named
    expect(screen.queryByRole('group', { name: 'Problem' })).toBeNull();
    fireEvent.click(within(row('Account')).getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(sent('org.signOut')).toEqual([undefined]));
  });

  it('the org state turns to the warning tone at 21 days; a held problem is said in words', async () => {
    renderSection({ ...REGISTERED, head: { version: 40, issued: new Date(Date.now() - 22 * DAY).toISOString() }, problem: 'rollback' });
    expect(within(await found('Org state')).getByText('Version 40 · 22 days old').className).toContain('text-warning');
    expect(within(row('Problem')).getByText('The hub served an older org state than this Mac holds. It was refused.')).toBeTruthy();
    emit({ ...REGISTERED, head: null });
    expect(within(row('Org state')).getByText('Not verified yet')).toBeTruthy();
  });

  it('a lapsed sign-in (expired, or the hub no longer admitting this person) offers Sign in again', async () => {
    renderSection({ ...REGISTERED, hubAccess: 'expired' }, { 'org.signIn': () => ({ ok: false, reason: { code: 'hub', detail: '502' } }) });
    expect(within(await found('Hub')).getByText('Sign-in expired')).toBeTruthy();
    fireEvent.click(within(row('Hub')).getByRole('button', { name: 'Sign in again' }));
    await vi.waitFor(() => expect(sent('org.signIn')).toEqual([undefined]));
    expect((await within(row('Hub')).findByRole('alert')).textContent).toBe('Couldn’t reach the hub. · 502');

    emit({ ...REGISTERED, hubAccess: 'denied' });
    expect(within(row('Hub')).getByText('The hub no longer admits this account')).toBeTruthy();
    expect(within(row('Hub')).getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    for (const [hubAccess, words] of [['connecting', 'Connecting…'], ['unreachable', 'Can’t reach the hub'], ['signing-in', 'Signing in…']] as const) {
      emit({ ...REGISTERED, hubAccess });
      expect(within(row('Hub')).getByText(words)).toBeTruthy();
      expect(within(row('Hub')).queryByRole('button', { name: 'Sign in again' })).toBeNull();
    }
  });

  it('held-chain: the problem in words, a code field and Re-anchor sending org.reanchor', async () => {
    renderSection({ ...REGISTERED, problem: 'held-chain', head: null });
    expect(within(await found('Problem')).getByText(/stays closed here until you re-anchor/)).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/replaces the org state this Mac trusted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    const field = within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: ` ${CODE} ` } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Re-anchor' }));
    await vi.waitFor(() => expect(sent('org.reanchor')).toEqual([{ code: CODE }]));
    expect(field.value).toBe('');
    expect(sent('org.register')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('registered and signed out: Sign in sends org.signIn', async () => {
    renderSection({ ...REGISTERED, session: 'signed-out' });
    expect(within(await found('Hub')).getByText('Signed out')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    fireEvent.click(within(row('Hub')).getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(sent('org.signIn')).toEqual([undefined]));
  });

  it('registered and removed: this Mac is no longer in the org', async () => {
    renderSection({ ...REGISTERED, session: 'removed' });
    expect(await screen.findByText('This Mac is no longer in the org.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
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
