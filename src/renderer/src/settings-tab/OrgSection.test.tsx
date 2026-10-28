// P5 O8 M1: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"; M1's Proves):
// each status drawn; Sign in sends `org.register` with the trimmed code and clears the field; Cancel, Sign out and Sign
// in again; the fingerprint at approval; Re-anchor in `held-chain`; a refusal's line; and no code shown back.
// M3's Proves (the signer's lines): the root line, and no `root add` guidance for an unmarked device; the quiet weekly
// line and Re-sign now; the superseded offer; owing machines; the pending slot with Discard behind its confirmation;
// `signing` with Reset behind its confirmation; the rekey offer with its code field; the old device still listed.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import { OrgStatusSchema, type DiscardResult, type OrgAttempt, type OrgSignerStatus, type OrgStatus, type SignResult } from '@shared/ipc/schema/org';
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
  signer: null,
};

type Signer = NonNullable<OrgSignerStatus>;
const FINGERPRINT = '65u7k-rscy7';
const OLD_DEVICE = 'Zo1dDevice9xYc0dEk9F3';
const MINI = 'maws-mini-ref-000001';
const VM = 'devcloud-vm-ref-0002';
const SIGNER: Signer = {
  root: false,
  maySign: false,
  fingerprint: FINGERPRINT,
  stepUpKid: 'stepUpKid0001',
  due: false,
  ageDays: 3,
  pending: null,
  offer: null,
  owing: [],
  abandoned: [],
  rekey: null,
  rekeying: null,
  oldDevice: null,
};
const signing = (signer: Partial<Signer>, rest: Partial<Extract<OrgStatus, { state: 'registered' }>> = {}): OrgStatus => ({ ...REGISTERED, ...rest, signer: { ...SIGNER, ...signer } });
const ROOT: Partial<Signer> = { root: true, maySign: true };

let calls: { name: string; input: unknown }[];
let emit: (status: OrgStatus) => void;

function renderSection(status: OrgStatus, answers: Partial<Record<CommandName, () => unknown>> = {}, strict = false) {
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
    'org.resign': () => ({ ok: true, version: 13 }) satisfies SignResult,
    'org.revokeSuperseded': () => ({ ok: true, version: 13 }) satisfies SignResult,
    'org.rekey': () => ({ ok: true }) satisfies OrgAttempt,
    'org.discardPending': () => ({ ok: true, unsent: false, hubVersion: 12 }) satisfies DiscardResult,
    'org.resetSigning': () => undefined,
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
  return render(strict ? <StrictMode><OrgSection /></StrictMode> : <OrgSection />);
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

describe('Settings › Org: this Mac as the org’s signer (M3)', () => {
  it('a marked device not yet a root: its fingerprint and id beside the root add command; a root signs; no signer lines signed out', async () => {
    renderSection(signing({}));
    const signer = await found('Signer');
    expect(within(signer).getByText('Make this Mac a root: run')).toBeTruthy();
    expect(within(signer).getByText(`deployment admin root add ${DEVICE}`).className).toContain('font-mono');
    expect(within(signer).getByText(new RegExp(FINGERPRINT))).toBeTruthy();
    expect(within(signer).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull(); // a marked, listed device is offered no new keys

    emit(signing(ROOT));
    expect(within(row('Signer')).getByText('This Mac signs the org state.')).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-sign now' })).toBeNull(); // not due

    emit(signing(ROOT, { session: 'signed-out' }));
    expect(screen.queryByRole('group', { name: 'Signer' })).toBeNull();
  });

  it('an unmarked device gets no root add guidance, as a root or not: the new-keys offer instead, sending org.rekey', async () => {
    renderSection(signing({ rekey: 'unmarked' }));
    expect(within(await found('Signer')).getByText(/weren’t kept out of Time Machine backups/)).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    emit(signing({ rekey: 'unmarked', root: true }));
    expect(within(row('Signer')).getByText(/weren’t kept out of Time Machine backups/)).toBeTruthy();
    expect(screen.queryByText(/root add/)).toBeNull();
    expect(screen.queryByText('This Mac signs the org state.')).toBeNull();

    expect(within(row('Pairing code')).getByText(/stays signed in on its old keys/)).toBeTruthy();
    const field = within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: ` ${CODE} ` } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    await vi.waitFor(() => expect(sent('org.rekey')).toEqual([{ code: CODE }]));
    expect(field.value).toBe('');
    expect(sent('org.register')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('a rekey under way: its step with Cancel, the new fingerprint at approval, then the promotion; a refusal under its field only', async () => {
    renderSection(signing({ rekey: 'unmarked', rekeying: { step: 'checking', fingerprint: null, expires: null } }));
    expect(within(await found('New keys')).getByText('Checking the org…')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(within(row('New keys')).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(sent('org.cancel')).toEqual([undefined]));

    emit(signing({ rekey: 'unmarked', rekeying: { step: 'approval', fingerprint: 'n3wfp-12345', expires: '2026-10-28T10:30:00.000Z' } }));
    expect(within(row('New keys')).getByText(/^Waiting for approval until /)).toBeTruthy();
    expect(within(row('Fingerprint')).getByText('n3wfp-12345').className).toContain('font-mono');
    emit(signing({ rekey: 'unmarked', rekeying: { step: 'promoting', fingerprint: null, expires: null } }));
    expect(within(row('New keys')).getByText('Switching to the new keys…')).toBeTruthy();
    expect(within(row('New keys')).queryByRole('button')).toBeNull(); // past its intent, a rekey can't be cancelled

    cleanup();
    renderSection(signing({ rekey: 'unmarked' }), { 'org.rekey': () => ({ ok: false, reason: { code: 'other-org' } }) });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Pairing code' }), { target: { value: CODE } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    expect((await within(row('Pairing code')).findByRole('alert')).textContent).toBe('That code is for a different org from the one this Mac is in.');
    expect(within(row('Hub')).queryByRole('alert')).toBeNull();
  });

  it('a removed device: no longer in the org, with the new-keys offer', async () => {
    renderSection(signing({}, { session: 'removed' }));
    expect(await screen.findByText('This Mac is no longer in the org.')).toBeTruthy();
    expect(within(row('Pairing code')).getByText(/To rejoin, make new keys/)).toBeTruthy();
    fireEvent.change(within(row('Pairing code')).getByRole('textbox', { name: 'Pairing code' }), { target: { value: CODE } });
    fireEvent.click(within(row('Pairing code')).getByRole('button', { name: 'Make new keys' }));
    await vi.waitFor(() => expect(sent('org.rekey')).toEqual([{ code: CODE }]));
  });

  it('the quiet weekly line: the org state’s age with Re-sign now, and the sign’s outcome in one line', async () => {
    renderSection(signing({ ...ROOT, due: true, ageDays: 8 }), { 'org.resign': () => ({ ok: false, reason: 'hub', detail: '503' }) });
    const signer = await found('Signer');
    expect(within(signer).getByText('This Mac signs the org state.')).toBeTruthy();
    const line = within(signer).getByText('Org state is 8 days old');
    expect(line.className).not.toContain('text-warning'); // a quiet line, not a banner
    fireEvent.click(within(signer).getByRole('button', { name: 'Re-sign now' }));
    await vi.waitFor(() => expect(sent('org.resign')).toEqual([undefined]));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toBe('Not signed · The hub didn’t take it. · 503');
  });

  it('Re-sign now: a signed version says so; a Touch ID cancel says nothing', async () => {
    let answer: SignResult = { ok: true, version: 13 };
    renderSection(signing({ ...ROOT, due: true, ageDays: 7 }), { 'org.resign': () => answer });
    fireEvent.click(within(await found('Signer')).getByRole('button', { name: 'Re-sign now' }));
    expect(await within(row('Signer')).findByText('Signed version 13.')).toBeTruthy();
    answer = { ok: false, reason: 'cancelled' };
    fireEvent.click(within(row('Signer')).getByRole('button', { name: 'Re-sign now' }));
    await vi.waitFor(() => expect(sent('org.resign')).toHaveLength(2));
    await act(async () => {});
    expect(within(row('Signer')).queryByText('Signed version 13.')).toBeNull();
    expect(within(row('Signer')).queryByRole('alert')).toBeNull();
  });

  it('the superseded offer: Revoke again only when there is something to sign; the withheld names always', async () => {
    const withheld = 'device 7Hq2xVb9 of owner@example.com (stepUpKid0001)';
    renderSection(signing({ ...ROOT, offer: { superseded: 2, withheld: [withheld] } }));
    const revocations = await found('Revocations');
    expect(within(revocations).getByText('A recovery dropped the revocation of 2 keys.')).toBeTruthy();
    expect(within(revocations).getByText((text) => text.startsWith(`Not offered: ${withheld}.`))).toBeTruthy();
    fireEvent.click(within(revocations).getByRole('button', { name: 'Revoke again' }));
    await vi.waitFor(() => expect(sent('org.revokeSuperseded')).toEqual([undefined]));
    expect(await within(row('Signer')).findByText('Signed version 13.')).toBeTruthy();

    emit(signing({ ...ROOT, offer: { superseded: 0, withheld: [withheld] } }));
    expect(within(row('Revocations')).queryByRole('button')).toBeNull();
    expect(within(row('Revocations')).queryByText(/A recovery dropped/)).toBeNull();
    expect(within(row('Revocations')).getByText((text) => text.startsWith(`Not offered: ${withheld}.`))).toBeTruthy();

    emit(signing({ offer: { superseded: 2, withheld: [] } })); // not a root: nothing shown would sign
    expect(within(row('Revocations')).getByText('A recovery dropped the revocation of 2 keys.')).toBeTruthy();
    expect(within(row('Revocations')).queryByRole('button')).toBeNull();
  });

  it('owing machines per version, a too-large one named; a discarded proposal where it may still be held', async () => {
    renderSection(
      signing({
        ...ROOT,
        owing: [{ version: 7, machines: [MINI, VM], tooLarge: [VM] }],
        abandoned: [
          { version: 5, hub: true, machines: [MINI] },
          { version: 6, hub: false, machines: [] }, // never sent: nothing can hold it
        ],
      }),
    );
    const deliveries = await found('Deliveries');
    expect(within(deliveries).getByText(`Version 7 · waiting for ${MINI} to acknowledge · too large to send to ${VM}, which catches up from the hub`)).toBeTruthy();
    expect(within(row('Discarded')).getByText(`Version 5 · the hub and ${MINI} may still hold it`)).toBeTruthy();
    expect(within(row('Discarded')).queryByText(/Version 6/)).toBeNull();

    emit(signing({ ...ROOT, abandoned: [{ version: 6, hub: false, machines: [] }] }));
    expect(screen.queryByRole('group', { name: 'Deliveries' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Discarded' })).toBeNull();
  });

  it('pending-fork: Discard behind a confirmation with the fork warning; Cancel sends nothing; Discard sends it confirmed', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, fork: true, exposed: true, refused: null } }), {
      'org.discardPending': () => ({ ok: true, unsent: false, hubVersion: 13, forkAt: 13 }),
    });
    const pending = await found('Pending');
    expect(within(pending).getByText('Version 13 conflicts with another version 13 at the hub: a fork.').className).toContain('text-warning');
    fireEvent.click(within(pending).getByRole('button', { name: 'Discard…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('The hub holds another version 13: a fork.')).toBeTruthy();
    expect(within(sheet).getByText(/A later sign may make another successor of version 12, which a hub or machine that kept these bytes could show as a fork/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.discardPending')).toEqual([]);

    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => expect(sent('org.discardPending')).toEqual([{ confirmed: true }]));
    expect(await within(row('Signer')).findByText('Discarded version 13. The hub holds another version 13 (a fork); its head is version 13.')).toBeTruthy();
  });

  it('a refused slot that isn’t a fork offers Discard too; a never-sent one is worded so; a slot merely waiting offers none', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, fork: false, exposed: true, refused: 'key-purged' } }), {
      'org.discardPending': () => ({ ok: true, unsent: true, hubVersion: 12 }),
    });
    expect(within(await found('Pending')).getByText('The hub refused version 13 · key-purged')).toBeTruthy();
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('Version 13 isn’t at the hub.')).toBeTruthy();
    expect(within(sheet).getByText(/could show as a fork: discard it only once you know why the hub refused it/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    emit(signing({ ...ROOT, pending: { version: 13, fork: false, exposed: false, refused: 'key-purged' } }));
    fireEvent.click(within(row('Pending')).getByRole('button', { name: 'Discard…' }));
    sheet = await screen.findByRole('dialog', { name: 'Discard version 13?' });
    expect(within(sheet).getByText('Version 13 was never sent: nothing was posted, so nothing can show it as a fork.')).toBeTruthy();
    expect(within(sheet).queryByText(/A later sign/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    expect(await within(row('Signer')).findByText('Discarded version 13. It was never sent.')).toBeTruthy();

    emit(signing({ ...ROOT, pending: { version: 14, fork: false, exposed: true, refused: null } }));
    expect(within(row('Pending')).getByText('Version 14 is signed and waits for the hub.')).toBeTruthy();
    expect(within(row('Pending')).queryByRole('button')).toBeNull();
  });

  it('a discard the hub overtook says so, and nothing was discarded', async () => {
    renderSection(signing({ ...ROOT, pending: { version: 13, fork: true, exposed: true, refused: null } }), { 'org.discardPending': () => ({ ok: false, reason: 'held' }) });
    fireEvent.click(within(await found('Pending')).getByRole('button', { name: 'Discard…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard version 13?' })).getByRole('button', { name: 'Discard' }));
    expect((await within(row('Signer')).findByRole('alert')).textContent).toBe('Not discarded · The hub holds version 13 now: it settled.');
  });

  it('signing: the problem in words, a successor sent before the damage named; Reset behind its confirmation', async () => {
    renderSection(signing(ROOT, { problem: 'signing' }));
    const problem = await found('Problem');
    expect(within(problem).getByText(/signs nothing until you reset it/)).toBeTruthy();
    expect(within(problem).getByText(/sent before the damage could still surface as a fork/)).toBeTruthy();
    fireEvent.click(within(problem).getByRole('button', { name: 'Reset…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Reset the signing record?' });
    expect(within(sheet).getByText(/could still surface as a fork/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.resetSigning')).toEqual([]);
    fireEvent.click(within(row('Problem')).getByRole('button', { name: 'Reset…' }));
    sheet = await screen.findByRole('dialog', { name: 'Reset the signing record?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => expect(sent('org.resetSigning')).toEqual([{ confirmed: true }]));
    // another problem carries no Reset
    emit(signing(ROOT, { problem: 'rollback' }));
    expect(within(row('Problem')).queryByRole('button')).toBeNull();
  });

  it('the old device, still listed after a rekey: its id with the remove-device command', async () => {
    renderSection(signing({ ...ROOT, oldDevice: OLD_DEVICE }));
    const old = await found('Old device');
    expect(within(old).getByText(`deployment admin remove-device ${OLD_DEVICE}`).className).toContain('font-mono');
    emit(signing(ROOT));
    expect(screen.queryByRole('group', { name: 'Old device' })).toBeNull();
  });
});
