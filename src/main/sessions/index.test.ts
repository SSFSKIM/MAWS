import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));
const handlers = new Map<string, (input: unknown) => unknown>();
vi.mock('../ipc/router', () => ({
  registerMainHandler: (name: string, handler: (input: unknown) => unknown) => handlers.set(name, handler),
  interceptCommand: () => () => {},
}));

import { startSessions } from '.';

const hosts = { onEvent: () => () => {} };

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
