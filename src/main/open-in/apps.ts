// "Open in"'s apps (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 2, where each
// bundle id and each way of taking a line is cited): the rows in the menu's order, which of them this Mac has, and the
// command that hands one of them a file or a folder. Pure but for the lookup it is given.
//
// Three rules. An editor is started with `open -b <its bundle id>`, so a file URL reaches the app that was found and never
// whichever app its scheme's handler is. A file URL is built only for a path it carries whole (no `:`, the line's
// separator, and no control character); any other file opens with no line. A terminal is handed a folder, never a file:
// Terminal, iTerm and Ghostty each open a shell script they are handed by running it, so a file's row opens its folder.
import { dirname } from 'node:path';
import type { OpenInAppId } from '@shared/ipc/schema/layout';

export type OpenInKind = 'editor' | 'xcode' | 'terminal' | 'finder';
export interface OpenInAppSpec {
  id: OpenInAppId;
  name: string;
  bundleId: string | null; // null: Finder, never looked for
  kind: OpenInKind;
  scheme?: string; // an editor's URL scheme, whose `<scheme>://file<path>:<line>` opens a file at a line
  always?: true; // a system app: listed without a lookup
}

export const OPEN_IN_APPS: readonly OpenInAppSpec[] = [
  { id: 'vscode', name: 'VS Code', bundleId: 'com.microsoft.VSCode', kind: 'editor', scheme: 'vscode' },
  { id: 'vscodeInsiders', name: 'VS Code Insiders', bundleId: 'com.microsoft.VSCodeInsiders', kind: 'editor', scheme: 'vscode-insiders' },
  { id: 'cursor', name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', kind: 'editor', scheme: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', bundleId: 'com.exafunction.windsurf', kind: 'editor', scheme: 'windsurf' },
  { id: 'zed', name: 'Zed', bundleId: 'dev.zed.Zed', kind: 'editor', scheme: 'zed' },
  { id: 'xcode', name: 'Xcode', bundleId: 'com.apple.dt.Xcode', kind: 'xcode' },
  { id: 'terminal', name: 'Terminal', bundleId: 'com.apple.Terminal', kind: 'terminal', always: true },
  { id: 'iterm', name: 'iTerm', bundleId: 'com.googlecode.iterm2', kind: 'terminal' },
  { id: 'ghostty', name: 'Ghostty', bundleId: 'com.mitchellh.ghostty', kind: 'terminal' },
  { id: 'finder', name: 'Finder', bundleId: null, kind: 'finder', always: true },
];

export const appSpec = (id: OpenInAppId): OpenInAppSpec => OPEN_IN_APPS.find((app) => app.id === id)!;

// What the daemon admitted: a file (at a line, when the window had one) or a folder, by its real path.
export type OpenInTarget = { kind: 'file'; path: string; line: number | null } | { kind: 'folder'; path: string };

// The rows this Mac has, in the table's order whatever order the lookups answer in. `has` answers whether an app with
// that bundle id is installed; a lookup that fails counts as not installed.
export async function installedApps(has: (bundleId: string) => Promise<boolean>): Promise<OpenInAppId[]> {
  const found = await Promise.all(OPEN_IN_APPS.map(async (app) => app.always === true || (app.bundleId !== null && (await has(app.bundleId).catch(() => false)))));
  return OPEN_IN_APPS.filter((_, i) => found[i]).map((app) => app.id);
}

// `<scheme>://file<path>:<line>`, each segment of the path percent-encoded; null for a path the URL cannot carry whole.
export function fileUrl(scheme: string, path: string, line: number): string | null {
  if (!path.startsWith('/') || path.includes(':') || [...path].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  return `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}:${line}`;
}

// What a row is handed: a terminal a file's folder, Finder and an editor the path itself; a line only by an editor or
// Xcode, for a file.
export function handed(app: OpenInAppSpec, target: OpenInTarget): { path: string; line: number | null } {
  if (target.kind === 'folder') return { path: target.path, line: null };
  if (app.kind === 'terminal') return { path: dirname(target.path), line: null };
  return { path: target.path, line: app.kind === 'finder' ? null : target.line };
}

// The command that hands `target` to `app` (a file to run and its arguments; never a shell).
export function launchCommand(app: OpenInAppSpec, target: OpenInTarget): { file: string; args: string[] } {
  const open = (args: string[]) => ({ file: '/usr/bin/open', args });
  const { path, line } = handed(app, target);
  switch (app.kind) {
    case 'finder':
      return open(['-R', path]);
    case 'terminal':
      return open(['-b', app.bundleId!, path]);
    case 'xcode':
      return line === null ? open(['-b', app.bundleId!, path]) : { file: '/usr/bin/xed', args: ['--line', String(line), path] };
    case 'editor': {
      const url = line === null ? null : fileUrl(app.scheme!, path, line);
      return open(['-b', app.bundleId!, url ?? path]);
    }
  }
}

// The e2e seam's line for a launch (MAWS_E2E_OPEN_LOG): what was handed to which row.
export function seamLine(app: OpenInAppSpec, target: OpenInTarget): string {
  const { path, line } = handed(app, target);
  return `open-in ${app.id} ${path}${line === null ? '' : `:${line}`}`;
}
