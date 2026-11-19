// "Open in" in main (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decisions 1, 3 and 6):
// `layout.openInApps`, the rows this Mac has, and `layout.openIn`, the hand-off. The window names an app, the session and,
// from a file's bar, the path it shows; main asks this Mac's daemon to admit it (`files.admit`, main's alone) and launches
// with the real path the daemon answers, never with the window's string. A daemon of an older build does not know the
// command and answers `unknown_command`: nothing is opened. `layout.*` is graded `client`, so the router refuses a session
// of another machine before this runs, and the app registers `appPageOnly` for `layout.openIn`.
//
// The apps are found by bundle id through Spotlight, as ClaudeUsage is (../gateway/claude-usage-app.ts), and the answer is
// kept for a minute. Under MAWS_E2E=1 the seam stands in for both: the rows are MAWS_E2E_OPEN_IN_APPS (a comma list of row
// ids; Terminal and Finder always), and a launch appends `open-in <row> <path>[:<line>]` to MAWS_E2E_OPEN_LOG and starts
// nothing (with no log, nothing at all).
import fs from 'node:fs';
import { dirname } from 'node:path';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { OPEN_IN_APP_IDS, type OpenInApp, type OpenInAppId, type OpenInOutput } from '@shared/ipc/schema/layout';
import { appSpec, installedApps, launchCommand, seamLine, type OpenInTarget } from './apps';

// The daemon's refusal of a path it does not admit (FILES_REFUSAL, src/services/files/service.ts; the test pins the two)
export const DAEMON_REFUSAL = "path outside the session's directories";
export const LAUNCH_TIMEOUT_MS = 10_000;
export const MDFIND_TIMEOUT_MS = 5_000;
export const INSTALLED_TTL_MS = 60_000;

// The sentences the window shows for an open that did not happen.
export const OPEN_IN_WORDS = {
  notInstalled: (app: string) => `${app} is not installed on this Mac`,
  older: 'Nothing was opened: this Mac’s MAWS service is an older version, which cannot check the folder first',
  folderRefused: 'Nothing was opened: this folder is not one this session works in',
  fileRefused: 'This file is outside the folders this session works in',
  failed: (app: string) => `${app} did not open`,
  // a file the daemon admits alone, outside the folders: its folder is not one the session works in (Decision Log 8)
  terminalOutside: 'A terminal opens a folder this session works in, and this file is outside them',
  refused: (message: string) => `Nothing was opened: ${message}`,
} as const;

export interface OpenInDeps {
  run(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string }>; // execFile; rejects on a non-zero exit
  admit(input: CommandInput<'files.admit'>): Promise<CommandResult<'files.admit'>>; // main's own send to this Mac's daemon
  env: NodeJS.ProcessEnv;
  now?(): number;
}

export interface OpenIn {
  apps(): Promise<OpenInApp[]>;
  open(input: CommandInput<'layout.openIn'>): Promise<OpenInOutput>;
  // UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decision 11): a file
  // its caller has already admitted by a rule of its own (a skill's file the inventory lists), handed to an installed row
  launchFile(app: OpenInAppId, realPath: string): Promise<OpenInOutput>;
}

const seamApps = (value: string | undefined): Set<string> => new Set((value ?? '').split(',').map((id) => id.trim()));

export function createOpenIn(deps: OpenInDeps): OpenIn {
  const now = deps.now ?? Date.now;
  const e2e = deps.env.MAWS_E2E === '1';
  let found: { ids: OpenInAppId[]; at: number } | null = null;

  const has = async (bundleId: string): Promise<boolean> => {
    if (e2e) {
      const listed = seamApps(deps.env.MAWS_E2E_OPEN_IN_APPS);
      return OPEN_IN_APP_IDS.some((id) => listed.has(id) && appSpec(id).bundleId === bundleId);
    }
    return (await deps.run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`], MDFIND_TIMEOUT_MS)).stdout.trim() !== '';
  };
  const installed = async (): Promise<OpenInAppId[]> => {
    if (found !== null && now() - found.at < INSTALLED_TTL_MS) return found.ids;
    const ids = await installedApps(has);
    found = { ids, at: now() };
    return ids;
  };

  const launch = async (id: OpenInAppId, target: OpenInTarget): Promise<boolean> => {
    const app = appSpec(id);
    if (e2e) {
      const log = deps.env.MAWS_E2E_OPEN_LOG;
      if (log) await fs.promises.appendFile(log, `${seamLine(app, target)}\n`);
      return true;
    }
    const { file, args } = launchCommand(app, target);
    try {
      await deps.run(file, args, LAUNCH_TIMEOUT_MS);
      return true;
    } catch (error) {
      // Xcode's line goes through xed, which cannot run while the Command Line Tools are the selected developer folder
      // (or another Xcode is): Xcode is then opened on the file, at no line (Decision Log 9)
      if (file === '/usr/bin/xed' && target.kind === 'file') {
        try {
          await deps.run('/usr/bin/open', ['-b', app.bundleId!, target.path], LAUNCH_TIMEOUT_MS);
          return true;
        } catch (fallback) {
          console.error(`[open-in] ${app.name} did not open`, error, fallback);
          return false;
        }
      }
      console.error(`[open-in] ${app.name} did not open`, error);
      return false;
    }
  };

  return {
    async apps() {
      return (await installed()).map((id) => ({ id, name: appSpec(id).name }));
    },
    async open({ appSessionId, app, path, line }) {
      const { name } = appSpec(app);
      if (!(await installed()).includes(app)) return { opened: false, message: OPEN_IN_WORDS.notInstalled(name) };
      const refusal = (error: { code: string; message: string }, refused: string): OpenInOutput => {
        if (error.code === 'unknown_command') return { opened: false, message: OPEN_IN_WORDS.older };
        return { opened: false, message: error.message === DAEMON_REFUSAL ? refused : OPEN_IN_WORDS.refused(error.message) };
      };
      const admitted = await deps.admit(path === undefined ? { appSessionId } : { appSessionId, path });
      if (!admitted.ok) return refusal(admitted.error, path === undefined ? OPEN_IN_WORDS.folderRefused : OPEN_IN_WORDS.fileRefused);
      const { path: real, kind } = admitted.value;
      let target: OpenInTarget = kind === 'file' ? { kind, path: real, line: line ?? null } : { kind, path: real };
      // A terminal is handed a folder, never a file: for a file, its folder, admitted by the daemon in its own right (a
      // folder only under the session's roots), so a file admitted alone hands no terminal its folder (Decision Log 8)
      if (appSpec(app).kind === 'terminal' && target.kind === 'file') {
        const folder = await deps.admit({ appSessionId, path: dirname(real) });
        if (!folder.ok) return refusal(folder.error, OPEN_IN_WORDS.terminalOutside);
        if (folder.value.kind !== 'folder') return { opened: false, message: OPEN_IN_WORDS.terminalOutside };
        target = { kind: 'folder', path: folder.value.path };
      }
      return (await launch(app, target)) ? { opened: true } : { opened: false, message: OPEN_IN_WORDS.failed(name) };
    },
    async launchFile(app, realPath) {
      const { name } = appSpec(app);
      if (!(await installed()).includes(app)) return { opened: false, message: OPEN_IN_WORDS.notInstalled(name) };
      return (await launch(app, { kind: 'file', path: realPath, line: null })) ? { opened: true } : { opened: false, message: OPEN_IN_WORDS.failed(name) };
    },
  };
}
