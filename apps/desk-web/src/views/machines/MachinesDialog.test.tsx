// @vitest-environment happy-dom
// The machine list says what DX7's record says: `active` is a machine that completed its first authenticated
// connection — enrolled — not one that is online now (presence is the registry's, later). An admin removes a machine
// from it, past a confirmation that says what removal means, and the list then lists it no more; a member who is not an
// admin is offered no removal, and the hub's refusals are explained where the owner confirmed.
//
// Provisioning keys (the provisioning-keys spec, §5): every member sees them listed under the machines, each with its
// uses over its cap and the machines enrolled through it, revoked ones last; an admin holding the org key creates one —
// checked in the browser, confirmed with one of the org key's methods, its code shown once — and revokes one past a
// confirmation naming the machines that stay. At a cheap Argon2id cost.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64urlEncode, decodeCode, type MemberRecord } from 'desk-hub/protocol';
import { MachinesDouble } from '../../../test/double/machines';
import { OrgKeysDouble } from '../../../test/double/org-keys';
import { ME } from '../../../test/me';
import { VECTOR_KEY } from '../../../test/vectors';
import { BOOT_COMMAND } from '../../enroll/enrollment';
import type { Me } from '../../hub/me';
import { unlock, useKeyHolder } from '../../key/holder';
import { memoryKeyStore } from '../../key/org-key';
import { prepareMethod } from '../../key/unlock';
import { MachinesDialog } from './MachinesDialog';

vi.mock('../../key/derive', async (original) => ({ ...(await original<typeof import('../../key/derive')>()), PASSPHRASE_COST: { t: 1, m: 64, p: 1 } }));

/** A gate a test can hold: `reached` settles once something waits at it, `open` lets it through. */
function gate() {
  let reach!: () => void;
  let open!: () => void;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { reached, opened, reach, open };
}
type Gate = ReturnType<typeof gate>;

// The org key's bytes, each time they are opened (to see them wiped), and held at the moment they open when a test asks.
const opening = vi.hoisted(() => ({ gate: null as { reach: () => void; opened: Promise<void> } | null, bytes: [] as Uint8Array[] }));
vi.mock('../../key/wrap', async (original) => {
  const actual = await original<typeof import('../../key/wrap')>();
  return {
    ...actual,
    unwrapKeyBytes: async (...args: Parameters<typeof actual.unwrapKeyBytes>) => {
      const raw = await actual.unwrapKeyBytes(...args);
      opening.bytes.push(raw);
      if (opening.gate) {
        opening.gate.reach();
        await opening.gate.opened;
      }
      return raw;
    },
  };
});

let hub: MachinesDouble;
let orgKeys: OrgKeysDouble;
/** Every request the dialog made, as `METHOD path`. */
let calls: string[];
/** Holds the hub's answer to requests of `METHOD path` until the test opens it. */
let held: Map<string, Gate>;
/** The machines' endpoints and the org key's, as `member`. */
const serve =
  (member: MemberRecord): typeof fetch =>
  async (input, init) => {
    const path = new URL(String(input), 'http://double').pathname;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const hold = held.get(`${method} ${path}`);
    if (hold) {
      hold.reach();
      await hold.opened;
    }
    const answer = (await orgKeys.handle(member, method, path, body)) ?? hub.handle(member, method, path, body) ?? { status: 404, body: { error: 'not-found' } };
    return Response.json(answer.body, { status: answer.status });
  };
beforeEach(() => {
  hub = new MachinesDouble();
  orgKeys = new OrgKeysDouble();
  calls = [];
  held = new Map();
  opening.gate = null;
  opening.bytes = [];
  vi.stubGlobal('fetch', serve(ME.member));
  useKeyHolder.setState({ state: 'locked', key: null, kept: null, fingerprint: null, forgetError: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(me: Me = ME) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MachinesDialog me={me} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const row = (container: HTMLElement, name: string) => container.querySelector(`[data-machine="${name}"]`);

describe('MachinesDialog', () => {
  it('draws an active machine as enrolled and a pending one as enrolling, never as connected', async () => {
    hub.add('mini');
    hub.add('studio', 'pending');
    const { container } = open();
    await screen.findByText('mini');
    expect(row(container, 'mini')!.textContent).toContain('enrolled');
    expect(row(container, 'studio')!.textContent).toContain('enrolling');
    expect(screen.getByRole('dialog').textContent).not.toContain('connected');
  });

  it('removes a machine only once the admin confirms what removal means, then lists it no more', async () => {
    hub.add('mini');
    hub.add('studio');
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    const confirm = screen.getByTestId('remove-confirm');
    expect(within(confirm).getByTestId('remove-machine').textContent).toBe('mini');
    const meaning = within(confirm).getByTestId('remove-meaning').textContent;
    expect(meaning).toContain('disconnects it at once');
    expect(meaning).toContain('deletes its credential');
    expect(meaning).toContain('enroll it again');
    expect(hub.removals).toEqual([]);

    // Cancel keeps it.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Remove mini' });
    expect(hub.removals).toEqual([]);
    expect(row(container, 'mini')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove mini' }));
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByTestId('machines-notice')).textContent).toBe('Removed mini. To use it with the desk again, enroll it again.');
    expect(hub.removals).toEqual(['mini']);
    await waitFor(() => expect(row(container, 'mini')).toBeNull());
    expect(row(container, 'studio')).not.toBeNull();
  });

  it("says of a machine still enrolling that it never connected, not that it is disconnected", async () => {
    hub.add('studio', 'pending');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove studio' }));
    const meaning = screen.getByTestId('remove-meaning').textContent;
    expect(meaning).toContain('has not connected yet');
    expect(meaning).not.toContain('disconnects');
  });

  it("explains the hub's refusal of a member it no longer holds as an admin, and keeps the machine", async () => {
    hub.add('mini');
    vi.stubGlobal('fetch', hub.fetch({ ...ME.member, role: 'member' })); // demoted since the page loaded
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only an admin of the org removes machines.');
    expect(screen.getByTestId('remove-confirm')).toBeTruthy();
    expect(hub.machines.map((m) => m.name)).toEqual(['mini']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(row(container, 'mini')).not.toBeNull());
  });

  it('says a machine removed meanwhile elsewhere was already removed, and refreshes the list', async () => {
    hub.add('mini');
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    hub.machines = []; // another admin removed it first
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByTestId('machines-notice')).textContent).toBe('mini was already removed.');
    await waitFor(() => expect(row(container, 'mini')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("says when the hub did not answer, and lets the admin try again", async () => {
    hub.add('mini');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const confirm = screen.getByTestId('remove-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The hub did not answer: Failed to fetch.');
    expect(within(confirm).getByRole('button', { name: 'Remove mini' })).toHaveProperty('disabled', false);
  });

  it('offers a member who is not an admin no removal', async () => {
    hub.add('mini');
    const { container } = open({ ...ME, member: { ...ME.member, role: 'member' } });
    await screen.findByText('mini');
    expect(within(row(container, 'mini') as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('An admin of the org enrolls and removes machines.');
  });

  // The desk's one display locale (P4 Decision Log 4): this project runs under a Korean system locale
  // (vitest.config.ts), where a formatter on the default locale writes the deadline "PM 02:05" (a Korean browser, "오후 02:05").
  it("says by when the one machine's code must be pasted, as an English clock time", async () => {
    await unlocked();
    const expires = new Date(2026, 9, 6, 14, 5).toISOString();
    const doubles = serve(ME.member);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input), 'http://double').pathname === '/api/enrollments' ? Response.json({ enrollment: { id: 'e1', expires }, token: 'tok' }, { status: 201 }) : doubles(input, init),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Enroll a machine' }));
    fireEvent.change(within(screen.getByRole('form', { name: 'Machine name' })).getByRole('textbox'), { target: { value: 'studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = screen.getByTestId('enroll-confirm');
    fireEvent.change(await within(confirm).findByLabelText('The passphrase'), { target: { value: PASSPHRASE } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    const shown = await screen.findByTestId('enroll-code', {}, { timeout: 5000 });
    expect(shown.textContent!.replace(/\s/g, ' ')).toContain('paste this code when it asks, before 2:05 PM:');
  });
});

const PASSPHRASE = 'correct horse battery staple';
const keyRow = (container: HTMLElement, label: string) => container.querySelector(`[data-key-label="${label}"]`) as HTMLElement | null;

/** The org key set up elsewhere with a passphrase copy, and held unlocked in this tab: the vector key's bytes. */
async function unlocked() {
  await orgKeys.seedPassphraseCopy(ME.member, ME.org.id, Uint8Array.from(VECTOR_KEY), await prepareMethod(ME.org.id, { kind: 'passphrase', passphrase: PASSPHRASE }), 'Passphrase');
  await unlock(ME.org.id, Uint8Array.from(VECTOR_KEY), 'session', memoryKeyStore());
}

describe('MachinesDialog: provisioning keys', () => {
  it('lists each key with its prefix, uses over cap, expiry and the machines enrolled through it, revoked ones after the active', async () => {
    const old = hub.addKey('first', 'vm-', { created: '2026-10-01T00:00:00.000Z', revoked: '2026-10-10T00:00:00.000Z' });
    const devcloud = hub.addKey('devcloud', 'dc-', { max_uses: 5 });
    hub.addKey('builds', 'build-', { created: '2026-10-22T00:00:00.000Z' });
    hub.enrollThrough(devcloud.id, 'dc-a-0001', 'active');
    hub.enrollThrough(devcloud.id, 'dc-a-0002', 'pending');
    hub.enrollThrough(old.id, 'vm-1', 'active');
    hub.add('mini');
    const { container } = open();

    const section = await screen.findByTestId('provisioning-keys');
    await waitFor(() => expect(keyRow(container, 'devcloud')).not.toBeNull());
    expect([...section.querySelectorAll('[data-key-label]')].map((k) => k.getAttribute('data-key-label'))).toEqual(['devcloud', 'builds', 'first']);
    const row = keyRow(container, 'devcloud')!;
    expect(row.textContent).toContain('devcloud · dc- · 2 / 5');
    expect(row.textContent).toContain('expires');
    expect(within(row).getByTestId('key-machine-dc-a-0001').textContent).toBe('dc-a-0001');
    expect(within(row).getByTestId('key-machine-dc-a-0002').textContent).toBe('dc-a-0002 enrolling…');
    expect(within(row).getByRole('button', { name: 'Revoke devcloud' })).toBeTruthy();
    expect(keyRow(container, 'builds')!.textContent).toContain('builds · build- · 0 / ∞');

    const revoked = keyRow(container, 'first')!;
    expect(revoked.textContent).toContain('revoked');
    expect(within(revoked).queryByRole('button')).toBeNull();

    // A machine enrolled through a key says which; one enrolled by hand says nothing of keys.
    await waitFor(() => expect(row.ownerDocument.querySelector('[data-machine="dc-a-0001"]')!.textContent).toContain('via devcloud'));
    expect(container.querySelector('[data-machine="vm-1"]')!.textContent).toContain('via first');
    expect(container.querySelector('[data-machine="mini"]')!.textContent).not.toContain('via');
  });

  it('creates a key confirmed with the org key, shows its code once with the boot line, and lists it after Done', async () => {
    await unlocked();
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create a key' }));

    // Checked in the browser, the grammar in words, before anything goes to the hub.
    const form = screen.getByTestId('key-form');
    fireEvent.change(within(form).getByLabelText('Label'), { target: { value: 'devcloud' } });
    fireEvent.change(within(form).getByLabelText('Prefix'), { target: { value: 'dc/' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Continue' }));
    expect(within(form).getByRole('alert').textContent).toContain('letters, digits, dots, dashes, and underscores');
    fireEvent.change(within(form).getByLabelText('Prefix'), { target: { value: 'dc-' } });
    fireEvent.change(within(form).getByLabelText(/Max uses/), { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Continue' }));
    expect(within(form).getByRole('alert').textContent).toContain('a whole number from 1 to 10000');
    fireEvent.change(within(form).getByLabelText(/Max uses/), { target: { value: '' } });
    expect((within(form).getByLabelText('Expires in') as HTMLSelectElement).value).toBe('7776000'); // 90 days, the hub's default
    fireEvent.change(within(form).getByLabelText('Revoke a machine offline for'), { target: { value: '21600' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Continue' }));
    expect(hub.keyRequests).toEqual([]);

    const confirm = screen.getByTestId('enroll-confirm');
    expect(within(confirm).getByTestId('confirm-key').textContent).toBe('devcloud');
    fireEvent.change(await within(confirm).findByLabelText('The passphrase'), { target: { value: PASSPHRASE } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));

    const shown = await screen.findByTestId('enroll-code', {}, { timeout: 5000 });
    expect(hub.keyRequests).toEqual([{ label: 'devcloud', prefix: 'dc-', ttl_s: 7_776_000, max_uses: null, offline_revoke_s: 21_600 }]);
    const code = within(shown).getByTestId('enrollment-code').textContent!;
    expect(decodeCode(code)).toEqual({ kind: 'provision', hub: location.origin, org: ME.org.id, token: expect.any(String), prefix: 'dc-', key: base64urlEncode(VECTOR_KEY) });
    expect(within(shown).getByTestId('boot-command').textContent).toBe(BOOT_COMMAND('dc-'));
    expect(shown.textContent).toContain('secret store');
    expect(shown.textContent).toContain('org key');

    fireEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(keyRow(container, 'devcloud')).not.toBeNull());
    expect(keyRow(container, 'devcloud')!.textContent).toContain('devcloud · dc- · 0 / ∞');
    expect(screen.queryByTestId('enrollment-code')).toBeNull();
    expect(screen.getByRole('dialog').textContent).not.toContain('smns-provision-v1.');
  });

  it('says a key whose time is up expired, and one still enrolling when it expires', async () => {
    hub.addKey('stale', 'old-', { created: '2025-01-01T00:00:00.000Z', expires: '2025-04-01T12:00:00.000Z' });
    hub.addKey('fresh', 'new-', { expires: new Date(Date.now() + 86_400_000).toISOString() });
    const { container } = open();
    await waitFor(() => expect(keyRow(container, 'stale')).not.toBeNull());
    // In English under this project's Korean system locale (vitest.config.ts), where the browser's would write "2025년 4월 1일"
    expect(keyRow(container, 'stale')!.textContent).toContain('expired Apr 1, 2025');
    expect(keyRow(container, 'fresh')!.textContent).toContain('expires');
    expect(keyRow(container, 'fresh')!.textContent).not.toContain('expired');
  });

  it("offers no key while the org key is locked: the code carries it", async () => {
    open();
    const section = await screen.findByTestId('provisioning-keys');
    expect(within(section).getByRole('button', { name: 'Create a key' })).toHaveProperty('disabled', true);
    expect(section.textContent).toContain('Unlock the org key first: the code carries it.');
  });

  it('offers a member who is not an admin the list, with no creation or revocation', async () => {
    hub.addKey('devcloud', 'dc-');
    const { container } = open({ ...ME, member: { ...ME.member, role: 'member' } });
    await waitFor(() => expect(keyRow(container, 'devcloud')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Create a key' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Revoke/ })).toBeNull();
    expect(screen.getByTestId('provisioning-keys').textContent).toContain('An admin of the org creates and revokes keys.');
  });

  it('revokes a key once the admin confirms what it does, naming the machines that stay, and lists it as revoked', async () => {
    const devcloud = hub.addKey('devcloud', 'dc-');
    hub.enrollThrough(devcloud.id, 'dc-a-0001', 'active');
    hub.enrollThrough(devcloud.id, 'dc-a-0002', 'active');
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke devcloud' }));

    const confirm = screen.getByTestId('revoke-key-confirm');
    const meaning = within(confirm).getByTestId('revoke-key-meaning').textContent!;
    expect(meaning).toContain('No new machine enrolls through it');
    expect(meaning).toContain('The 2 machines enrolled through it stay');
    expect(meaning).toContain('dc-a-0001');
    expect(meaning).toContain('dc-a-0002');
    expect(hub.keyRevocations).toEqual([]);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke devcloud' }));
    expect((await screen.findByTestId('machines-notice')).textContent).toContain('Revoked devcloud');
    expect(hub.keyRevocations).toEqual([devcloud.id]);
    await waitFor(() => expect(keyRow(container, 'devcloud')!.textContent).toContain('revoked'));
    expect(within(keyRow(container, 'devcloud')!).queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-machine="dc-a-0001"]')).not.toBeNull();
    expect(container.querySelector('[data-machine="dc-a-0002"]')).not.toBeNull();
  });

  it("explains the hub's refusal of a member it no longer holds as an admin, and keeps the key", async () => {
    hub.addKey('devcloud', 'dc-');
    vi.stubGlobal('fetch', serve({ ...ME.member, role: 'member' })); // demoted since the page loaded
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke devcloud' }));
    fireEvent.click(within(screen.getByTestId('revoke-key-confirm')).getByRole('button', { name: 'Revoke devcloud' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only an admin of the org revokes provisioning keys.');
    expect(hub.keys[0].revoked).toBeNull();
  });
});

/** From the list to a key's confirmation, the passphrase typed: the form filled with `devcloud`, `dc-`. */
async function toKeyConfirm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Create a key' }));
  const form = screen.getByTestId('key-form');
  fireEvent.change(within(form).getByLabelText('Label'), { target: { value: 'devcloud' } });
  fireEvent.change(within(form).getByLabelText('Prefix'), { target: { value: 'dc-' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Continue' }));
  const confirm = screen.getByTestId('enroll-confirm');
  fireEvent.change(await within(confirm).findByLabelText('The passphrase'), { target: { value: PASSPHRASE } });
  return confirm;
}

/** From the list to a one-time enrollment's confirmation for `studio`, the passphrase typed. */
async function toEnrollConfirm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Enroll a machine' }));
  fireEvent.change(screen.getByLabelText(/machine's name/), { target: { value: 'studio' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const confirm = screen.getByTestId('enroll-confirm');
  fireEvent.change(await within(confirm).findByLabelText('The passphrase'), { target: { value: PASSPHRASE } });
  return confirm;
}

const wiped = () => opening.bytes.length > 0 && opening.bytes.every((bytes) => bytes.every((b) => b === 0));
const posts = () => calls.filter((call) => call.startsWith('POST '));

describe('MachinesDialog: a confirmation left before its code arrives', () => {
  it.each([
    ['a provisioning key', toKeyConfirm],
    ['a one-time enrollment', toEnrollConfirm],
  ])('cancelled while the org key opens, %s asks the hub for nothing and draws no code; the bytes are wiped', async (_, toConfirm) => {
    await unlocked();
    open();
    const confirm = await toConfirm();
    const opened = gate();
    opening.gate = opened;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await opened.reached;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await screen.findByTestId('provisioning-keys'); // back on the list
    opened.open();

    // The bytes are wiped as the abandoned confirmation ends, after anything it would have asked the hub.
    await waitFor(() => expect(wiped()).toBe(true));
    expect(posts()).toEqual([]);
    expect(screen.queryByTestId('enroll-code')).toBeNull();
    expect(screen.getByTestId('provisioning-keys')).toBeTruthy();
  });

  it('once the hub is asked for the key, Cancel is off — a made key cannot be unmade — and the code it answers is shown', async () => {
    await unlocked();
    open();
    const confirm = await toKeyConfirm();
    const answered = gate();
    held.set('POST /api/provisioning-keys', answered);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await answered.reached;

    const cancel = within(confirm).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveProperty('disabled', true));
    expect(within(confirm).getByTestId('code-coming').textContent).toContain('shown once');
    fireEvent.click(cancel);
    expect(screen.getByTestId('enroll-confirm')).toBe(confirm);

    answered.open();
    const shown = await screen.findByTestId('enroll-code');
    expect(decodeCode(within(shown).getByTestId('enrollment-code').textContent!)).toMatchObject({ kind: 'provision', prefix: 'dc-' });
    expect(wiped()).toBe(true);
  });

  it('closed while the hub makes the key, draws its answer nowhere and wipes the bytes', async () => {
    await unlocked();
    const view = open();
    const confirm = await toKeyConfirm();
    const answered = gate();
    held.set('POST /api/provisioning-keys', answered);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await answered.reached;
    const errors = vi.spyOn(console, 'error');
    try {
      view.unmount();
      answered.open();
      await waitFor(() => expect(wiped()).toBe(true));
      expect(hub.keys).toHaveLength(1); // made at the hub before the dialog closed; revocable from the list
      expect(document.body.textContent).not.toContain('smns-provision-v1.');
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
