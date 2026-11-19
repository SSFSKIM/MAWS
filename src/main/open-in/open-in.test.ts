// "Open in" in main (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decisions 1, 3 and 6):
// main launches with the daemon's admitted real path and nothing else, and every refusal opens nothing and says why.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { FILES_REFUSAL } from '../../services/files/service';
import { createOpenIn, DAEMON_REFUSAL, INSTALLED_TTL_MS, OPEN_IN_WORDS, type OpenInDeps } from './open-in';

const S = 'session-1' as AppSessionId;
type Admitted = CommandResult<'files.admit'>;
const ok = (path: string, kind: 'file' | 'folder'): Admitted => ({ ok: true, value: { path, kind } });
const failed = (code: 'unknown_command' | 'internal', message: string): Admitted => ({ ok: false, error: { code, message } }) as Admitted;

let runs: [string, string[]][];
let clock: number;
function openIn({ installed = ['dev.zed.Zed', 'com.microsoft.VSCode'], admit = async () => ok('/real/app', 'folder'), env = {}, launchFails = false, failing = [] }: { installed?: string[]; admit?: (input: CommandInput<'files.admit'>) => Promise<Admitted>; env?: NodeJS.ProcessEnv; launchFails?: boolean; failing?: string[] } = {}) {
  const admits = vi.fn(admit);
  const run: OpenInDeps['run'] = async (file, args) => {
    runs.push([file, args]);
    if (file === '/usr/bin/mdfind') return { stdout: installed.some((id) => args[0] === `kMDItemCFBundleIdentifier == '${id}'`) ? '/Applications/Some.app\n' : '' };
    if (launchFails || failing.includes(file)) throw Object.assign(new Error('exit 1'), { code: 1 });
    return { stdout: '' };
  };
  return { openIn: createOpenIn({ run, admit: admits, env, now: () => clock }), admits };
}
const launches = () => runs.filter(([file]) => file !== '/usr/bin/mdfind');

beforeEach(() => {
  runs = [];
  clock = 1_000;
});

describe('the rows', () => {
  it('are the installed editors, then Terminal, then Finder, looked for once a minute', async () => {
    const { openIn: o } = openIn();
    expect(await o.apps()).toEqual([
      { id: 'vscode', name: 'VS Code' },
      { id: 'zed', name: 'Zed' },
      { id: 'terminal', name: 'Terminal' },
      { id: 'finder', name: 'Finder' },
    ]);
    const looked = runs.length;
    await o.apps();
    expect(runs.length).toBe(looked);
    clock += INSTALLED_TTL_MS;
    await o.apps();
    expect(runs.length).toBe(looked * 2);
  });
});

describe('the hand-off', () => {
  it('launches with the path the daemon admitted, never the window’s, at the window’s line', async () => {
    const { openIn: o, admits } = openIn({ admit: async () => ok('/real/app/src/main.ts', 'file') });
    expect(await o.open({ appSessionId: S, app: 'zed', path: '/link/app/src/main.ts', line: 12 })).toEqual({ opened: true });
    expect(admits).toHaveBeenCalledWith({ appSessionId: S, path: '/link/app/src/main.ts' });
    expect(launches()).toEqual([['/usr/bin/open', ['-b', 'dev.zed.Zed', 'zed://file/real/app/src/main.ts:12']]]);
  });

  it('asks for the working folder when the window names no path, and drops a line for a folder', async () => {
    const { openIn: o, admits } = openIn();
    expect(await o.open({ appSessionId: S, app: 'vscode', line: 3 })).toEqual({ opened: true });
    expect(admits).toHaveBeenCalledWith({ appSessionId: S });
    expect(launches()).toEqual([['/usr/bin/open', ['-b', 'com.microsoft.VSCode', '/real/app']]]);
  });

  it('opens nothing for an app that is not installed, and asks the daemon nothing', async () => {
    const { openIn: o, admits } = openIn();
    expect(await o.open({ appSessionId: S, app: 'cursor' })).toEqual({ opened: false, message: OPEN_IN_WORDS.notInstalled('Cursor') });
    expect(admits).not.toHaveBeenCalled();
    expect(launches()).toEqual([]);
  });

  it('opens nothing when the daemon does not admit the folder or the file, and says which', async () => {
    expect(DAEMON_REFUSAL).toBe(FILES_REFUSAL);
    const { openIn: o } = openIn({ admit: async () => failed('internal', FILES_REFUSAL) });
    expect(await o.open({ appSessionId: S, app: 'terminal' })).toEqual({ opened: false, message: OPEN_IN_WORDS.folderRefused });
    expect(await o.open({ appSessionId: S, app: 'finder', path: '/elsewhere/notes.md' })).toEqual({ opened: false, message: OPEN_IN_WORDS.fileRefused });
    const gone = openIn({ admit: async () => failed('internal', 'not found: /work/app/gone.ts') }).openIn;
    expect(await gone.open({ appSessionId: S, app: 'finder', path: '/work/app/gone.ts' })).toEqual({ opened: false, message: OPEN_IN_WORDS.refused('not found: /work/app/gone.ts') });
    expect(launches()).toEqual([]);
  });

  it('opens nothing against an older daemon, which answers unknown_command', async () => {
    const { openIn: o } = openIn({ admit: async () => failed('unknown_command', 'unknown command: files.admit') });
    expect(await o.open({ appSessionId: S, app: 'vscode' })).toEqual({ opened: false, message: OPEN_IN_WORDS.older });
    expect(launches()).toEqual([]);
  });

  // Review of 785e66161, finding 2: a terminal is handed a folder the daemon admitted, the file's own folder, asked of it
  // after the file; for a file admitted alone (outside the folders) that folder is refused and nothing opens
  it('hands a terminal the file’s folder only once the daemon admits that folder too', async () => {
    const admit = async (input: CommandInput<'files.admit'>): Promise<Admitted> => (input.path === '/link/app/src/main.ts' ? ok('/real/app/src/main.ts', 'file') : input.path === '/real/app/src' ? ok('/real/app/src', 'folder') : failed('internal', FILES_REFUSAL));
    const { openIn: o, admits } = openIn({ admit });
    expect(await o.open({ appSessionId: S, app: 'terminal', path: '/link/app/src/main.ts', line: 3 })).toEqual({ opened: true });
    expect(admits.mock.calls.map(([input]) => input)).toEqual([{ appSessionId: S, path: '/link/app/src/main.ts' }, { appSessionId: S, path: '/real/app/src' }]);
    expect(launches()).toEqual([['/usr/bin/open', ['-b', 'com.apple.Terminal', '/real/app/src']]]);
  });

  it('opens no terminal for a file outside the folders, whose folder the daemon refuses', async () => {
    const admit = async (input: CommandInput<'files.admit'>): Promise<Admitted> => (input.path === '/elsewhere/notes.md' ? ok('/elsewhere/notes.md', 'file') : failed('internal', FILES_REFUSAL));
    const { openIn: o } = openIn({ admit });
    expect(await o.open({ appSessionId: S, app: 'terminal', path: '/elsewhere/notes.md' })).toEqual({ opened: false, message: OPEN_IN_WORDS.terminalOutside });
    expect(launches()).toEqual([]);
  });

  // Finding 5: with the Command Line Tools selected, xed cannot run; Xcode is then opened on the file with no line
  it('opens the file in Xcode with no line when xed cannot run', async () => {
    const { openIn: o } = openIn({ installed: ['com.apple.dt.Xcode'], admit: async () => ok('/real/app/App.swift', 'file'), failing: ['/usr/bin/xed'] });
    expect(await o.open({ appSessionId: S, app: 'xcode', path: '/real/app/App.swift', line: 9 })).toEqual({ opened: true });
    expect(launches()).toEqual([
      ['/usr/bin/xed', ['--line', '9', '/real/app/App.swift']],
      ['/usr/bin/open', ['-b', 'com.apple.dt.Xcode', '/real/app/App.swift']],
    ]);
  });

  it('says the app did not open when its launch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { openIn: o } = openIn({ launchFails: true });
    expect(await o.open({ appSessionId: S, app: 'zed' })).toEqual({ opened: false, message: OPEN_IN_WORDS.failed('Zed') });
  });
});

describe('the e2e seam', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-open-in-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the seam’s rows and writes a launch to the open log, running nothing', async () => {
    const log = join(dir, 'open.log');
    const { openIn: o } = openIn({ env: { MAWS_E2E: '1', MAWS_E2E_OPEN_IN_APPS: 'zed, ghostty', MAWS_E2E_OPEN_LOG: log }, admit: async () => ok('/real/app/src/main.ts', 'file') });
    expect((await o.apps()).map((app) => app.id)).toEqual(['zed', 'terminal', 'ghostty', 'finder']);
    expect(await o.open({ appSessionId: S, app: 'zed', path: '/real/app/src/main.ts', line: 7 })).toEqual({ opened: true });
    expect(readFileSync(log, 'utf8')).toBe('open-in zed /real/app/src/main.ts:7\n');
    expect(runs).toEqual([]);
  });

  it('starts nothing under the harness with no log', async () => {
    const { openIn: o } = openIn({ env: { MAWS_E2E: '1' } });
    expect(await o.open({ appSessionId: S, app: 'terminal' })).toEqual({ opened: true });
    expect(runs).toEqual([]);
  });
});
