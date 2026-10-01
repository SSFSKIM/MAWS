import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, type CommandName, type CommandResult, type MawsBridge } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { isActionEnabled, runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { resetShellStores } from '../test-support/shell-stores';
import { openClaudeUsage, registerGatewayActions } from './actions';

// A bridge whose every invoke is parsed by the real command validator (the object C1's router parses with), so an
// action cannot drift from the schema; a refused input answers as main's router would, and never reaches `answer`.
function validatingBridge(answer: (name: CommandName, input: unknown) => unknown) {
  const calls: { name: CommandName; input: unknown }[] = [];
  const bridge = {
    invoke: vi.fn(async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
      const checked = validateCommandInput(name, input);
      if (!checked.ok) return checked;
      calls.push({ name, input: checked.value });
      return { ok: true, value: answer(name, checked.value) as never };
    }),
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return { bridge, calls };
}

const OPENED = { opened: true, reason: null, instruction: 'ClaudeUsage is in the menu bar · click its icon' };
let off: () => void = () => {};
beforeEach(() => {
  resetShellStores();
  useNotices.setState({ notices: [] });
});
afterEach(() => off());

describe('gateway actions pass the command validator', () => {
  it("registers gateway.openClaudeUsage, whose call is the union's account-free arm, and toasts the instruction", async () => {
    const { bridge, calls } = validatingBridge(() => OPENED);
    off = registerGatewayActions(bridge);
    expect(isActionEnabled('gateway.openClaudeUsage')).toBe(true);
    runAction('gateway.openClaudeUsage');
    await vi.waitFor(() => expect(useNotices.getState().notices).toHaveLength(1));
    expect(calls).toEqual([{ name: 'settings.claudeUsage.open', input: { intent: 'panel' } }]);
    expect(useNotices.getState().notices[0]).toMatchObject({ kind: 'toast', level: 'info', text: OPENED.instruction, durationMs: 8000 }); // M4: read for 8 s
  });

  it('warns with the instruction when ClaudeUsage did not open; not installed, it offers Install ClaudeUsage, which opens the README', async () => {
    const { bridge, calls } = validatingBridge((name) => (name === 'layout.openExternal' ? undefined : { opened: false, reason: 'not_installed', instruction: 'ClaudeUsage is not installed · …' }));
    off = registerGatewayActions(bridge);
    runAction('gateway.openClaudeUsage');
    await vi.waitFor(() => expect(useNotices.getState().notices[0]).toMatchObject({ level: 'warning', text: 'ClaudeUsage is not installed · …' }));
    const [install] = useNotices.getState().notices[0]!.actions;
    expect(install?.label).toBe('Install ClaudeUsage');
    install!.run();
    await vi.waitFor(() => expect(calls.at(-1)).toEqual({ name: 'layout.openExternal', input: { url: 'https://github.com/SSFSKIM/claude-usage-menubar#readme' } }));
  });

  it('a launch that failed for another reason warns without the install action', async () => {
    const { bridge } = validatingBridge(() => ({ opened: false, reason: 'launch_failed', instruction: 'ClaudeUsage could not be opened' }));
    expect(await openClaudeUsage({ intent: 'panel' }, bridge)).toMatchObject({ reason: 'launch_failed' });
    expect(useNotices.getState().notices[0]).toMatchObject({ level: 'warning', actions: [] });
  });

  it("the four intents the Accounts tab sends are accepted; an account intent without its email, or a panel with one, is refused", async () => {
    const { bridge, calls } = validatingBridge(() => OPENED);
    for (const intent of [{ intent: 'panel' }, { intent: 'addAccount' }, { intent: 'reconnect', accountEmail: '1@example.test' }, { intent: 'remove', accountEmail: '1@example.test' }] as const) {
      expect(await openClaudeUsage(intent, bridge)).toEqual(OPENED);
    }
    expect(calls).toHaveLength(4);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const bad of [{ intent: 'reconnect' }, { intent: 'panel', accountEmail: null }]) {
      expect(commands['settings.claudeUsage.open'].input.safeParse(bad).success).toBe(false);
      expect(await openClaudeUsage(bad as never, bridge)).toBeNull();
    }
    expect(calls).toHaveLength(4);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
    // a refused call is said in the app, not only in the console
    const refusals = useNotices.getState().notices.filter((n) => n.level === 'warning');
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toMatchObject({ kind: 'toast', text: expect.stringMatching(/^ClaudeUsage could not be opened · .*settings\.claudeUsage\.open/) });
  });

  it('opens the singleton Settings tab (at a section by index); the retired Accounts tab is not among its actions (W6)', () => {
    const { bridge } = validatingBridge(() => OPENED);
    off = registerGatewayActions(bridge);
    runAction('settings.open');
    expect(activeTab(useLayout.getState().main)).toEqual({ id: 'settings', kind: 'settings', section: null, pinned: false });
    runAction('settings.open', 2);
    expect(activeTab(useLayout.getState().main)).toEqual({ id: 'settings', kind: 'settings', section: 'keyboard', pinned: false });
    expect(useLayout.getState().main.panes[0].tabs.filter((t) => t.kind === 'settings')).toHaveLength(1);
    expect(isActionEnabled('accounts.open')).toBe(false);
  });

  it('unregisters both', () => {
    off = registerGatewayActions(validatingBridge(() => OPENED).bridge);
    off();
    for (const id of ['settings.open', 'gateway.openClaudeUsage'] as const) expect(isActionEnabled(id)).toBe(false);
  });
});
