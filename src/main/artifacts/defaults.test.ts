// P3-A M4 (its Decision Log 22d and 31b): main pushes the design-system defaults to the engine host at every ready and on
// every change, reading `settings.artifacts` (settings slot 14, P3-D's) when the settings carry it and pushing nothing
// when they do not, so a store's persisted defaults are never overwritten by a build without the slot.
import { describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, Settings } from '@shared/ipc/schema';
import { migrateSettings } from '@shared/settings/defaults';
import { defaultsOf, startArtifactDefaults } from './defaults';

const SYSTEM = '11111111-1111-4111-8111-111111111111';
const SPACE = '22222222-2222-4222-8222-222222222222';
const host = (state: HostState['state']): HostState => ({ state, pid: state === 'ready' ? 1 : null, restarts: 0, revision: 0 });
// Settings as a build without P3-D's slot 14 carries them: this build's defaults (a version 1 file migrates to them),
// the slot taken out where the build has it, so no version's name is needed here.
const { artifacts: _slot14, ...SECTIONS } = migrateSettings({ version: 1, theme: 'light' }) as Settings & { artifacts?: unknown };
void _slot14;
const SLOTLESS = SECTIONS as Settings;
// Settings as a build with the slot carries them.
const withSlot = (defaultDesignSystem: string | null, spaceDesignSystems: Record<string, string> = {}): Settings =>
  ({ ...SLOTLESS, artifacts: { defaultDesignSystem, spaceDesignSystems } }) as unknown as Settings;

function harness(initial: HostState['state'], settings: Settings) {
  let current = host(initial);
  let now = settings;
  const settingsListeners = new Set<(s: Settings) => void>();
  const stateListeners = new Set<(s: HostState) => void>();
  const dispatch = vi.fn(async (): Promise<CommandResult<'artifacts.setDefaults'>> => ({ ok: true, value: undefined }));
  const stop = startArtifactDefaults({
    settings: () => now,
    onSettingsChanged: (l) => (settingsListeners.add(l), () => void settingsListeners.delete(l)),
    hostState: () => current,
    onHostState: (l) => (stateListeners.add(l), () => void stateListeners.delete(l)),
    dispatch,
  });
  return {
    dispatch,
    stop,
    moveHost(state: HostState['state']) {
      current = host(state);
      stateListeners.forEach((l) => l(current));
    },
    change(next: Settings) {
      now = next;
      settingsListeners.forEach((l) => l(next));
    },
    listeners: () => settingsListeners.size + stateListeners.size,
  };
}

describe('the design-system defaults main relays (Decision Log 22d)', () => {
  it('reads the owner’s and the Spaces’ defaults from slot 14, and nothing from settings without it or with a malformed one', () => {
    expect(defaultsOf(withSlot(SYSTEM, { [SPACE]: SYSTEM }))).toEqual({ owner: SYSTEM, spaces: { [SPACE]: SYSTEM } });
    expect(defaultsOf(withSlot(null))).toEqual({ owner: null, spaces: {} });
    expect(defaultsOf(SLOTLESS)).toBeNull();
    expect(defaultsOf({ ...SLOTLESS, artifacts: { defaultDesignSystem: 'nope' } } as unknown as Settings)).toBeNull();
  });

  it('pushes at the ready and again at every later ready (a restart is a new connection), and on a change while ready', () => {
    const h = harness('starting', withSlot(SYSTEM));
    expect(h.dispatch).not.toHaveBeenCalled();
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenLastCalledWith({ owner: SYSTEM, spaces: {} });
    h.change(withSlot(SYSTEM, { [SPACE]: SYSTEM }));
    expect(h.dispatch).toHaveBeenLastCalledWith({ owner: SYSTEM, spaces: { [SPACE]: SYSTEM } });
    h.change(withSlot(SYSTEM, { [SPACE]: SYSTEM })); // nothing changed in the slot: nothing pushed
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    h.moveHost('restarting');
    h.moveHost('ready');
    expect(h.dispatch).toHaveBeenCalledTimes(3);
  });

  it('pushes at once when started with the host already ready, and never while it is not', () => {
    const h = harness('ready', withSlot(null));
    expect(h.dispatch).toHaveBeenCalledWith({ owner: null, spaces: {} });
    h.moveHost('crashed');
    h.change(withSlot(SYSTEM));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('pushes nothing at all from settings without the slot, so the store keeps what it last held', () => {
    const h = harness('ready', SLOTLESS);
    h.moveHost('restarting');
    h.moveHost('ready');
    h.change({ ...SLOTLESS });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('forgets a push whose dispatch failed, so the next notification of the same defaults retries it', async () => {
    const h = harness('starting', withSlot(SYSTEM));
    h.dispatch.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'restarting' } });
    h.dispatch.mockRejectedValueOnce(new Error('the bridge closed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.moveHost('ready'); // refused
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    h.change(withSlot(SYSTEM)); // the same defaults: retried, and rejected
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    h.change(withSlot(SYSTEM)); // retried again, and this one lands
    expect(h.dispatch).toHaveBeenCalledTimes(3);
    await Promise.resolve();
    h.change(withSlot(SYSTEM)); // delivered: deduplicated from here on
    expect(h.dispatch).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('a failed push does not forget a newer one that replaced it', async () => {
    const h = harness('starting', withSlot(SYSTEM));
    let refuse!: (result: CommandResult<'artifacts.setDefaults'>) => void;
    h.dispatch.mockReturnValueOnce(new Promise((resolve) => (refuse = resolve)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.moveHost('ready'); // the first push is in flight
    h.change(withSlot(null)); // a newer one replaces it, and lands
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    refuse({ ok: false, error: { code: 'internal', message: 'disk full' } });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    h.change(withSlot(null)); // the newer push stands: nothing re-sent
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('stops listening when stopped', () => {
    const h = harness('ready', withSlot(SYSTEM));
    expect(h.listeners()).toBe(2);
    h.stop();
    expect(h.listeners()).toBe(0);
  });
});
