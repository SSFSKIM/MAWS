import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));
const handlers = new Map<string, (input: unknown) => unknown>();
vi.mock('../ipc/router', () => ({
  registerMainHandler: (name: string, handler: (input: unknown) => unknown) => handlers.set(name, handler),
  interceptCommand: () => () => {},
}));

import { startSessions } from '.';

const hosts = { onEvent: () => () => {}, onState: () => () => {} }; // C12: onState

describe('launch mode reaches the page', () => {
  afterEach(() => handlers.clear());

  it('session.launchMode answers the mode decided at start', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const index = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts });
    expect(handlers.get('session.launchMode')!(undefined)).toEqual({ mode: 'index' });
    index.stop();

    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    const scenario = startSessions({ env, packaged: false, appRoot: process.cwd(), hosts });
    expect(handlers.get('session.launchMode')!(undefined)).toEqual({ mode: 'scenario' });
    scenario.stop();
    log.mockRestore();
  });
});

describe('C4’s index source attaches through the read model', () => {
  afterEach(() => handlers.clear());

  const indexSource = () => {
    const stop = vi.fn();
    return { stop, start: vi.fn(() => stop) };
  };

  it('starts in launch mode index and stops with the sessions', () => {
    const source = indexSource();
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts, indexSource: source });
    expect(source.start).toHaveBeenCalledOnce();
    sessions.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it('is refused unstarted in launch mode scenario, so the index never scans', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const source = indexSource();
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    startSessions({ env, packaged: false, appRoot: process.cwd(), hosts, indexSource: source }).stop();
    expect(source.start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('read-model: scenario mode, source ignored');
    log.mockRestore();
  });
});
