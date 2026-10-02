// The title-bar toolbar's usage pill and its popover (W6, E1) over the committed ClaudeUsage fixture as C7's reader answers it at
// the fixture's clock: the pill's reading and colour, the popover's sections in ClaudeUsage's panel order, the four
// account actions disabled under the one hint, the hand-off to ClaudeUsage's own panel, and the absent case. The
// retired Accounts tab's own suite moved here with its content (its order, geometry, states and hand-off). W6 route
// executor: the same actions through ClaudeUsage's control route, as main answers it.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, UsageAction, UsageActionResult, UsageControlsAnswer } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import type { UsageSnapshot } from '@shared/usage/types';
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { useGateway } from '../gateway/store';
import { closeDialog, useDialogs } from '../sessions/dialogs';
import { useNotices } from '../stores/notices';
import { useUsage } from '../stores/usage';
import { isActionEnabled, runAction } from '../keymap/actions-runtime';
import { READ_ONLY_CONTROLS, useUsageControlState } from './controls';
import { registerUsage } from '.';
import { UsagePill, useUsagePopover } from './UsagePill';

const NOW = Date.parse('2026-09-29T07:36:17Z');
const HINT = "Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now";
let fixture: UsageSnapshot;
let calls: { name: string; input: unknown }[];
let usageChanged: ((payload: unknown) => void)[];
let installed: boolean;
let controls: UsageControlsAnswer; // W6 route executor: what main answers for ClaudeUsage's control route
let answerAction: (action: UsageAction) => UsageActionResult | Promise<UsageActionResult>;

beforeAll(async () => {
  fixture = await new ClaudeUsageReader({ dir: join(__dirname, '../../../../test/fixtures/claude-usage'), emit: () => {}, log: () => {}, now: () => NOW }).snapshot([]);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  calls = [];
  usageChanged = [];
  installed = true;
  controls = { available: false, reason: 'no_route', state: null };
  answerAction = () => ({ ok: false, reason: 'no_route', message: 'not there' });
  window.maws = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name as never, input);
      if (!checked.ok) return checked;
      switch (name) {
        case 'engine.relayHealth':
          return { ok: true, value: { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 2.6, checkedAt: new Date(NOW - 12_000).toISOString(), error: null } };
        case 'settings.claudeUsage.status':
          return { ok: true, value: { installed, running: true, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: new Date(NOW).toISOString() } };
        case 'settings.claudeUsage.open':
          return { ok: true, value: { opened: true, reason: null, instruction: 'ClaudeUsage is in the menu bar · click its icon' } };
        case 'settings.usageControls':
          return { ok: true, value: controls };
        case 'settings.usageAction':
          return { ok: true, value: await answerAction(input as UsageAction) };
        default:
          return { ok: true, value: undefined };
      }
    }),
    on: (name: string, listener: (payload: unknown) => void) => {
      if (name === 'settings.usageChanged') usageChanged.push(listener);
      return () => void (usageChanged = usageChanged.filter((l) => l !== listener));
    },
    pathForFile: () => '',
  } as unknown as MawsBridge;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUsage.setState({ snapshot: null, routed: null });
  useGateway.setState({ relay: null, claudeUsage: null });
  useNotices.setState({ notices: [] });
  useUsagePopover.setState({ open: false });
  useUsageControlState.setState({ answer: null, notice: null, busy: false });
  closeDialog();
  delete (window as { maws?: MawsBridge }).maws;
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const pill = () => document.querySelector<HTMLButtonElement>('[data-usage-pill]')!;
async function openPanel(snapshot: UsageSnapshot | null = fixture) {
  useUsage.setState({ snapshot });
  render(<UsagePill />);
  fireEvent.click(pill());
  await settle();
  return screen.getByRole('dialog', { name: 'Claude Usage' });
}
const card = (panel: HTMLElement, email: string) => within(panel).getByRole('region', { name: email });

describe('the usage pill', () => {
  it("reads the routing account's most binding percent in its severity's colour", () => {
    useUsage.setState({ snapshot: fixture });
    render(<UsagePill />);
    expect(pill().textContent).toBe('82'); // 3@'s Fable week, above its 5h 53 % and weekly 63 %
    expect(pill().getAttribute('data-severity')).toBe('warning');
    expect(pill().querySelector('[data-dot]')!.className).toContain('bg-warning');
    expect(pill().getAttribute('aria-label')).toBe('Usage · Fable 82% · 3@example.test');
  });

  it('is a muted dash without ClaudeUsage data, and before the first read', () => {
    useUsage.setState({ snapshot: { ...fixture, available: false, accounts: [] } });
    const { unmount } = render(<UsagePill />);
    expect(pill().textContent).toBe('--');
    expect(pill().querySelector('[data-dot]')!.className).toContain('bg-fg-muted');
    expect(pill().getAttribute('aria-label')).toBe('Usage · ClaudeUsage has no data');
    unmount();
    useUsage.setState({ snapshot: null });
    render(<UsagePill />);
    expect(pill().textContent).toBe('--');
  });
});

describe('the usage popover', () => {
  it("copies ClaudeUsage's panel: header, accounts with activity and limits, add, Codex, toggle, relay and health", async () => {
    const panel = await openPanel();
    expect(within(panel).getByRole('heading', { name: 'Claude Usage' })).toBeTruthy();
    expect(panel.textContent).toContain('updated 2m ago');
    expect(panel.textContent).toContain('Usage includes all machines. Activity below is from this Mac.');
    const accounts = within(panel).getAllByRole('region').filter((r) => r.hasAttribute('data-account') && !r.closest('[data-codex]'));
    expect(accounts.map((r) => r.getAttribute('aria-label'))).toEqual(['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test']);
    expect(panel.querySelector('[data-columns]')!.getAttribute('data-columns')).toBe('2');
    const routing = card(panel, '3@example.test');
    expect(routing.textContent).toContain('Routing here · weekly resets soonest of the usable accounts');
    expect(routing.textContent).toContain('8 saved sessions');
    expect(routing.querySelector('[data-serving="latest"]')!.textContent).toBe('5 requests · 97% cached · just now');
    expect(card(panel, '1@example.test').querySelector('[data-serving="recent"]')!.textContent).toBe('1 request · 63% cached · 3m ago');
    expect(within(routing).getAllByRole('meter').map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Five-hour usage', '53'],
      ['Weekly usage', '63'],
      ['Fable weekly usage', '82'],
    ]);
    // bars in their severity's colour: 4@'s five-hour window at 100 % critical, 3@'s Fable week at 82 % a warning
    expect(within(card(panel, '4@example.test')).getByRole('meter', { name: 'Five-hour usage' }).querySelector('[data-full]')!.className).toContain('bg-danger');
    expect(within(routing).getByRole('meter', { name: 'Fable weekly usage' }).firstElementChild!.className).toContain('bg-warning');
    expect(within(routing).getByRole('meter', { name: 'Five-hour usage' }).firstElementChild!.className).toContain('bg-success');

    const codex = within(panel).getByRole('region', { name: 'Codex accounts' });
    expect(codex.textContent).toContain('Used by GPT models routed through this app.');
    expect(within(codex).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['6@example.test', '7@example.test']);
    expect(card(codex, '6@example.test').textContent).toContain('Routing here · chosen by the relay');
    expect(card(codex, '6@example.test').textContent).toContain("Limits show in ClaudeUsage's own panel");
    expect(card(codex, '7@example.test').getAttribute('data-state')).toBe('needs_reauth');

    const toggle = within(panel).getByRole('checkbox', { name: 'Route Claude Code through this app' });
    expect([(toggle as HTMLInputElement).checked, (toggle as HTMLInputElement).disabled]).toEqual([true, true]);
    expect(panel.querySelector('[data-relay-line]')!.textContent).toBe('Relay listening on 127.0.0.1:8641 · checked just now · 3 ms');
    expect(panel.querySelector('[data-health]')!.textContent).toBe('Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held');
    expect(panel.querySelector('[data-health]')!.getAttribute('data-health')).toBe('degraded');
  });

  it('renders Route requests here, Add, Reconnect and Remove disabled under the one hint', async () => {
    const reauth = { ...fixture, accounts: fixture.accounts.map((a) => (a.email === '5@example.test' ? { ...a, needsReauthentication: true } : a)) };
    const panel = await openPanel(reauth);
    const hint = within(panel).getByText(HINT);
    expect(within(panel).getAllByText(HINT)).toHaveLength(1);
    const actions = [
      ...within(panel).getAllByRole('button', { name: 'Route requests here' }),
      ...within(panel).getAllByRole('button', { name: 'Remove account…' }),
      within(panel).getByRole('button', { name: 'Add account…' }),
      within(panel).getByRole('button', { name: 'Reconnect…' }),
    ];
    expect(actions).toHaveLength(3 + 5 + 2); // Route on the three usable accounts that are not routing; Remove on all five
    for (const button of actions) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    }
    expect(within(card(panel, '3@example.test')).queryByRole('button', { name: 'Route requests here' })).toBeNull();
    expect(within(card(panel, '5@example.test')).getByRole('button', { name: 'Reconnect…' })).toBeTruthy();
    expect(within(card(panel, '5@example.test')).queryByRole('button', { name: 'Route requests here' })).toBeNull();
    expect(READ_ONLY_CONTROLS.unavailable).toBe(HINT);
    // nothing reached main but the reads the popover makes on open
    expect([...new Set(calls.map((c) => c.name))].sort()).toEqual(['engine.relayHealth', 'settings.claudeUsage.status', 'settings.usageControls']);
  });

  it("hands off to ClaudeUsage's own panel and waits for its rewrite; Refresh re-checks the relay; Esc closes", async () => {
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    await settle();
    expect(calls.filter((c) => c.name === 'settings.claudeUsage.open').map((c) => c.input)).toEqual([{ intent: 'panel' }]);
    expect(useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => n.text)).toContain('ClaudeUsage is in the menu bar · click its icon');
    expect(within(panel).getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
    act(() => usageChanged.forEach((l) => l(fixture)));
    await settle();
    expect(within(panel).queryByRole('status')).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(calls.filter((c) => c.name === 'engine.relayHealth').map((c) => c.input)).toEqual([{ force: false }, { force: true }]);

    fireEvent.keyDown(panel, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUsagePopover.getState().open).toBe(false);
  });

  it('without ClaudeUsage data says so and offers Open ClaudeUsage; the store opens it too', async () => {
    useUsagePopover.setState({ open: true });
    useUsage.setState({ snapshot: { ...fixture, available: false, accounts: [], gateway: null, codex: null, activity: null } });
    render(<UsagePill />);
    await settle();
    const panel = screen.getByRole('dialog', { name: 'Claude Usage' });
    expect(panel.textContent).toContain('ClaudeUsage is not installed or has no data');
    expect(within(panel).getAllByRole('button', { name: 'Open ClaudeUsage' })).toHaveLength(1);
    expect(panel.querySelector('[data-account]')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add account…' })).toBeNull();
    expect(panel.querySelector('[data-codex]')).toBeNull();
  });

  // W6: from the retired Accounts tab's suite (C11 M5 pins), now the popover's
  it('shows each account’s saved sessions and a reset that passed as 0 % with no reading since', async () => {
    const panel = await openPanel();
    expect(card(panel, '1@example.test').textContent).toContain('1 saved session');
    expect(card(panel, '1@example.test').textContent).not.toContain('Routing here');
    const twoFive = within(card(panel, '2@example.test')).getByRole('meter', { name: 'Five-hour usage' });
    expect(twoFive.getAttribute('aria-valuenow')).toBe('0');
    expect(card(panel, '2@example.test').textContent).toContain('5h · no reading since the window reset');
    expect(card(panel, '3@example.test').textContent).toContain('Max · default_claude_max_20x');
  });

  it('a second hand-off while waiting restarts the 60 s wait', async () => {
    const panel = await openPanel();
    const open = () => fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    open();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    open();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(within(panel).getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(within(panel).queryByRole('status')).toBeNull();
  });

  it('offers Install ClaudeUsage when it is not installed', async () => {
    installed = false;
    const panel = await openPanel({ ...fixture, available: false, accounts: [] });
    fireEvent.click(within(panel).getByRole('button', { name: 'Install ClaudeUsage' }));
    await settle();
    expect(calls.at(-1)).toEqual({ name: 'layout.openExternal', input: { url: 'https://github.com/SSFSKIM/claude-usage-menubar#readme' } });
  });

  it('the Usage action (the retired Accounts tab’s id, kept for keymap overrides) opens the popover', async () => {
    const off = registerUsage();
    try {
      useUsage.setState({ snapshot: fixture });
      render(<UsagePill />);
      expect(isActionEnabled('accounts.open')).toBe(true);
      act(() => runAction('accounts.open'));
      await settle();
      expect(screen.getByRole('dialog', { name: 'Claude Usage' })).toBeTruthy();
    } finally {
      off();
    }
    expect(isActionEnabled('accounts.open')).toBe(false);
  });
});

// W6 route executor: the actions through ClaudeUsage's control route, as main answers `settings.usageControls`.
describe('the usage popover’s actions through ClaudeUsage’s control route', () => {
  const ROUTING = { enabled: true, ready: true, port: 8641, drainTarget: '2aca3c4b-1e77-4091-908b-d183f6b0f092', drainTargetIsManual: false };
  const available = (ready = true): UsageControlsAnswer => ({ available: true, reason: null, state: { updatedAt: null, routing: { ...ROUTING, ready }, accounts: [], codex: [] } });
  const uuidOf = (email: string) => fixture.accounts.find((a) => a.email === email)!.uuid;
  const posted = () => calls.filter((c) => c.name === 'settings.usageAction').map((c) => c.input);
  const hintOf = (panel: HTMLElement) => panel.querySelector('[data-controls-hint]')?.textContent ?? null;
  const reopened = () => screen.getByRole('dialog', { name: 'Claude Usage' });
  const closePanel = () => {
    cleanup();
    useUsagePopover.setState({ open: false });
  };
  // The confirm sheet C10's dialogs render: its request, then the answer.
  function answer(yes: boolean) {
    const open = useDialogs.getState().open;
    if (open?.kind !== 'confirm') throw new Error('no confirm is open');
    const request = { title: open.title, body: open.body, confirmLabel: open.confirmLabel, destructive: open.destructive };
    open.answer(yes);
    closeDialog();
    return request;
  }

  it('enables every action while the route answers, and Route only while ClaudeUsage routes Claude Code', async () => {
    controls = available();
    let panel = await openPanel();
    expect(hintOf(panel)).toBeNull();
    const disabled = (p: HTMLElement) => ['Route requests here', 'Remove account…', 'Add account…'].flatMap((name) => within(p).getAllByRole('button', { name })).map((b) => (b as HTMLButtonElement).disabled);
    expect(disabled(panel)).toEqual(Array(4 + 5 + 1).fill(false)); // Route on the four accounts that are not routing
    closePanel();

    controls = available(false);
    panel = await openPanel();
    expect(hintOf(panel)).toBe("Route requests here needs ClaudeUsage's “Route Claude Code through this app”, which its own panel turns on");
    for (const button of within(panel).getAllByRole('button', { name: 'Route requests here' })) expect((button as HTMLButtonElement).disabled).toBe(true);
    for (const button of within(panel).getAllByRole('button', { name: 'Remove account…' })) expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables each account’s actions as ClaudeUsage says, and says when ClaudeUsage is still starting', async () => {
    const accounts = fixture.accounts.map((a) => ({ uuid: a.uuid, email: a.email, status: 'ready', isRoutingHere: false, canRoute: a.email !== '4@example.test', canReconnect: false, canRemove: a.email !== '2@example.test' }));
    controls = { available: true, reason: null, state: { ...available().state!, accounts } };
    let panel = await openPanel();
    const button = (email: string, name: string) => within(card(panel, email)).getByRole('button', { name }) as HTMLButtonElement;
    expect([button('4@example.test', 'Route requests here').disabled, button('1@example.test', 'Route requests here').disabled]).toEqual([true, false]);
    expect([button('2@example.test', 'Remove account…').disabled, button('1@example.test', 'Remove account…').disabled]).toEqual([true, false]);
    expect((within(panel).getByRole('button', { name: 'Add account…' }) as HTMLButtonElement).disabled).toBe(false);
    expect(hintOf(panel)).toBeNull();
    closePanel();

    controls = { available: false, reason: 'starting', state: null };
    panel = await openPanel();
    expect(hintOf(panel)).toBe('ClaudeUsage is still starting');
    expect(button('1@example.test', 'Route requests here').disabled).toBe(true);
  });

  it('keeps today’s hint while the route does not answer and names an unreadable token', async () => {
    controls = { available: false, reason: 'timeout', state: null };
    let panel = await openPanel();
    expect(hintOf(panel)).toBe(HINT);
    closePanel();
    controls = { available: false, reason: 'bad_token', state: null };
    panel = await openPanel();
    expect(hintOf(panel)).toBe("ClaudeUsage's control token could not be read");
    for (const button of within(panel).getAllByRole('button', { name: 'Remove account…' })) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('Route asks first with the panel’s warning, posts, and shows the new routing account at once', async () => {
    controls = available();
    answerAction = (action) => ({ ok: true, drainTarget: action.action === 'route' ? action.uuid : null, drainTargetIsManual: action.action === 'route', shown: null });
    const panel = await openPanel();
    fireEvent.click(within(card(panel, '1@example.test')).getByRole('button', { name: 'Route requests here' }));
    await settle();
    expect(posted()).toEqual([]);
    act(() => useUsagePopover.setState({ open: false })); // the sheet takes the focus, which closes the popover
    expect(answer(true)).toEqual({ title: 'Route requests to 1@example.test?', body: 'Existing sessions move at their next request, which rebuilds their prompt cache.', confirmLabel: 'Route requests here', destructive: false });
    await settle();
    expect(posted()).toEqual([{ action: 'route', uuid: uuidOf('1@example.test') }]);
    expect(useUsagePopover.getState().open).toBe(true);
    const again = reopened();
    expect(card(again, '1@example.test').textContent).toContain('Routing here · chosen in ClaudeUsage');
    expect(card(again, '3@example.test').textContent).not.toContain('Routing here');
    expect(useUsage.getState().snapshot!.drainTarget).toBe(uuidOf('1@example.test'));
    expect(pill().getAttribute('aria-label')).toContain('1@example.test');

    // Snapshots before ClaudeUsage's pins.json write reaches the reader (an event for another file, a reply) still name
    // 3@: the answered routing account holds over them until the reader names it.
    act(() => useUsage.getState().applySnapshot({ ...fixture, readAt: new Date(NOW + 1_000).toISOString() }, 'merge'));
    act(() => useUsage.getState().applySnapshot(fixture));
    expect(card(reopened(), '1@example.test').textContent).toContain('Routing here · chosen in ClaudeUsage');
    expect(card(reopened(), '3@example.test').textContent).not.toContain('Routing here');
    expect(pill().getAttribute('aria-label')).toContain('1@example.test');
    act(() => useUsage.getState().applySnapshot({ ...fixture, drainTarget: uuidOf('1@example.test'), drainTargetIsManual: true }));
    expect(useUsage.getState().routed).toBeNull();
    expect(card(reopened(), '1@example.test').textContent).toContain('Routing here · chosen in ClaudeUsage');
  });

  it('a Route cancelled on the sheet posts nothing and reopens the popover', async () => {
    controls = available();
    const panel = await openPanel();
    fireEvent.click(within(card(panel, '4@example.test')).getByRole('button', { name: 'Route requests here' }));
    await settle();
    act(() => useUsagePopover.setState({ open: false }));
    answer(false);
    await settle();
    expect(posted()).toEqual([]);
    expect(useUsagePopover.getState().open).toBe(true);
    expect(card(reopened(), '3@example.test').textContent).toContain('Routing here');
  });

  it('a refusal’s message is the popover’s notice, and the routing account stays', async () => {
    controls = available();
    answerAction = () => ({ ok: false, reason: 'unusable', message: '4@example.test is at its limit' });
    const panel = await openPanel();
    fireEvent.click(within(card(panel, '4@example.test')).getByRole('button', { name: 'Route requests here' }));
    await settle();
    act(() => useUsagePopover.setState({ open: false })); // the sheet closes the popover; the answer opens it again
    answer(true);
    await settle();
    const again = reopened();
    expect(hintOf(again)).toBe('4@example.test is at its limit');
    expect(card(again, '3@example.test').textContent).toContain('Routing here');
    expect(useUsage.getState().snapshot!.drainTarget).toBe(ROUTING.drainTarget);
  });

  it('Remove names the account on a destructive sheet and posts with confirm', async () => {
    controls = available();
    answerAction = () => ({ ok: true, drainTarget: null, drainTargetIsManual: false, shown: null });
    const panel = await openPanel();
    fireEvent.click(within(card(panel, '4@example.test')).getByRole('button', { name: 'Remove account…' }));
    await settle();
    expect(answer(true)).toEqual({
      title: 'Remove 4@example.test from this Mac?',
      body: "Removes ClaudeUsage's saved sign-in and stops routing new requests to this account. Your Claude subscription and other machines are unchanged. To add it again, sign in again.",
      confirmLabel: 'Remove account',
      destructive: true,
    });
    await settle();
    expect(posted()).toEqual([{ action: 'remove', uuid: uuidOf('4@example.test'), confirm: true }]);
  });

  it('Add and Reconnect open ClaudeUsage’s sign-in sheet at once and say so', async () => {
    controls = available();
    answerAction = () => ({ ok: true, drainTarget: null, drainTargetIsManual: false, shown: null });
    const reauth = { ...fixture, accounts: fixture.accounts.map((a) => (a.email === '5@example.test' ? { ...a, needsReauthentication: true } : a)) };
    const panel = await openPanel(reauth);
    fireEvent.click(within(panel).getByRole('button', { name: 'Add account…' }));
    await settle();
    expect(hintOf(panel)).toBe("ClaudeUsage's sign-in sheet opens to add an account; finish signing in there");
    fireEvent.click(within(card(panel, '5@example.test')).getByRole('button', { name: 'Reconnect…' }));
    await settle();
    expect(hintOf(panel)).toBe("ClaudeUsage's sign-in sheet opens to reconnect 5@example.test; finish signing in there");
    expect(posted()).toEqual([{ action: 'add', email: null }, { action: 'reconnect', uuid: uuidOf('5@example.test') }]);
    expect(useDialogs.getState().open).toBeNull();
  });

  it('a notice lasts while the popover is open', async () => {
    controls = available();
    answerAction = () => ({ ok: false, reason: 'busy', message: 'ClaudeUsage is signing in another account' });
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add account…' }));
    await settle();
    expect(hintOf(panel)).toBe('ClaudeUsage is signing in another account');
    fireEvent.keyDown(panel, { key: 'Escape' });
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(hintOf(reopened())).toBeNull();
  });

  it('an action that ends after its popover closed leaves no notice for the next one', async () => {
    controls = available();
    let finish!: (result: UsageActionResult) => void;
    answerAction = () => new Promise((resolve) => (finish = resolve));
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add account…' }));
    await settle();
    expect(hintOf(panel)).toBe("ClaudeUsage's sign-in sheet opens to add an account; finish signing in there");
    fireEvent.keyDown(panel, { key: 'Escape' });
    await settle();
    finish({ ok: false, reason: 'busy', message: 'ClaudeUsage is signing in another account' });
    await settle();
    fireEvent.click(pill());
    await settle();
    const again = reopened();
    expect(hintOf(again)).toBeNull();
    expect((within(again).getByRole('button', { name: 'Add account…' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks main again on each usage change while open', async () => {
    controls = available();
    await openPanel();
    const asked = () => calls.filter((c) => c.name === 'settings.usageControls').length;
    expect(asked()).toBe(1);
    controls = { available: false, reason: 'no_route', state: null };
    act(() => usageChanged.forEach((l) => l(fixture)));
    await settle();
    expect(asked()).toBe(2);
    expect(hintOf(reopened())).toBe(HINT);
  });

  it('Open ClaudeUsage opens ClaudeUsage’s panel through the route, and falls back to the activation when that fails', async () => {
    controls = available();
    answerAction = () => ({ ok: true, drainTarget: null, drainTargetIsManual: false, shown: null });
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    await settle();
    expect(posted()).toEqual([{ action: 'panel' }]);
    expect(calls.some((c) => c.name === 'settings.claudeUsage.open')).toBe(false);
    expect(useNotices.getState().notices).toEqual([]);
    expect(within(panel).getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');

    answerAction = () => ({ ok: false, reason: 'timeout', message: 'ClaudeUsage did not answer in time' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    await settle();
    expect(calls.filter((c) => c.name === 'settings.claudeUsage.open').map((c) => c.input)).toEqual([{ intent: 'panel' }]);
  });

  it('Open ClaudeUsage asks once more when the toggle hid a panel that was already up', async () => {
    controls = available();
    const shown = [false, true];
    answerAction = () => ({ ok: true, drainTarget: null, drainTargetIsManual: false, shown: shown.shift() ?? true });
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    await settle();
    expect(posted()).toEqual([{ action: 'panel' }, { action: 'panel' }]);
    expect(within(panel).getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
  });
});
