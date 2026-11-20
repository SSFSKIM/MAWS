// "Open in"'s rows and how each is handed a file or a folder (UX wave U6b-4a,
// docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 2).
import { describe, expect, it } from 'vitest';
import { OPEN_IN_APP_IDS } from '@shared/ipc/schema/layout';
import { appSpec, fileUrl, installedApps, launchCommand, OPEN_IN_APPS, seamLine, type OpenInTarget } from './apps';

const FILE: OpenInTarget = { kind: 'file', path: '/work/app/src/main.ts', line: 42 };
const FOLDER: OpenInTarget = { kind: 'folder', path: '/work/app' };

describe('the rows', () => {
  it('are the editors, then Terminal with iTerm and Ghostty, then Finder, in the schema’s order', () => {
    expect(OPEN_IN_APPS.map((app) => app.id)).toEqual([...OPEN_IN_APP_IDS]);
    expect(OPEN_IN_APPS.map((app) => app.name)).toEqual(['VS Code', 'VS Code Insiders', 'Cursor', 'Windsurf', 'Zed', 'Xcode', 'Terminal', 'iTerm', 'Ghostty', 'Finder']);
  });

  it('lists what is installed in the table’s order whatever order the lookups answer in, Terminal and Finder always', async () => {
    const delays: Record<string, number> = { 'dev.zed.Zed': 1, 'com.microsoft.VSCode': 20, 'com.mitchellh.ghostty': 5 };
    const asked: string[] = [];
    const has = (bundleId: string) => {
      asked.push(bundleId);
      return new Promise<boolean>((resolve) => setTimeout(() => resolve(bundleId in delays), delays[bundleId] ?? 0));
    };
    expect(await installedApps(has)).toEqual(['vscode', 'zed', 'terminal', 'ghostty', 'finder']);
    expect(asked).not.toContain('com.apple.Terminal'); // a system app is not looked for
  });

  it('counts a lookup that fails as not installed', async () => {
    expect(await installedApps(async (bundleId) => (bundleId === 'dev.zed.Zed' ? Promise.reject(new Error('mdfind: no index')) : bundleId === 'com.apple.dt.Xcode'))).toEqual(['xcode', 'terminal', 'finder']);
  });
});

describe('a file URL', () => {
  it('is `<scheme>://file<path>:<line>` with each segment percent-encoded', () => {
    expect(fileUrl('vscode', '/work/app/src/main.ts', 42)).toBe('vscode://file/work/app/src/main.ts:42');
    expect(fileUrl('zed', '/work/my app/#notes?.md', 3)).toBe('zed://file/work/my%20app/%23notes%3F.md:3');
    expect(fileUrl('cursor', '/work/100%/a.ts', 1)).toBe('cursor://file/work/100%25/a.ts:1');
  });

  it('is none for a path it cannot carry whole: a colon, a control character, a relative path', () => {
    expect(fileUrl('vscode', '/work/a:12.ts', 5)).toBeNull();
    expect(fileUrl('vscode', '/work/a\nb.ts', 5)).toBeNull();
    expect(fileUrl('vscode', 'work/a.ts', 5)).toBeNull();
  });
});

describe('the launch', () => {
  const command = (id: (typeof OPEN_IN_APP_IDS)[number], target: OpenInTarget) => launchCommand(appSpec(id), target);

  it('hands an editor a file at its line through its own bundle id, and a folder as a path', () => {
    expect(command('vscode', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.microsoft.VSCode', 'vscode://file/work/app/src/main.ts:42'] });
    expect(command('vscodeInsiders', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.microsoft.VSCodeInsiders', 'vscode-insiders://file/work/app/src/main.ts:42'] });
    expect(command('cursor', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.todesktop.230313mzl4w4u92', 'cursor://file/work/app/src/main.ts:42'] });
    expect(command('windsurf', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.exafunction.windsurf', 'windsurf://file/work/app/src/main.ts:42'] });
    expect(command('zed', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'dev.zed.Zed', 'zed://file/work/app/src/main.ts:42'] });
    expect(command('zed', FOLDER)).toEqual({ file: '/usr/bin/open', args: ['-b', 'dev.zed.Zed', '/work/app'] });
  });

  it('hands an editor a file with no line, or one its URL cannot carry, as a path', () => {
    expect(command('vscode', { ...FILE, line: null })).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.microsoft.VSCode', '/work/app/src/main.ts'] });
    expect(command('vscode', { kind: 'file', path: '/work/a:b.ts', line: 7 })).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.microsoft.VSCode', '/work/a:b.ts'] });
  });

  it('hands Xcode a line through xed, and a folder or a file with no line through open', () => {
    expect(command('xcode', FILE)).toEqual({ file: '/usr/bin/xed', args: ['--line', '42', '/work/app/src/main.ts'] });
    expect(command('xcode', { ...FILE, line: null })).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.apple.dt.Xcode', '/work/app/src/main.ts'] });
    expect(command('xcode', FOLDER)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.apple.dt.Xcode', '/work/app'] });
  });

  it('hands a terminal the folder, and for a file the file’s folder, never the file', () => {
    expect(command('terminal', FOLDER)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.apple.Terminal', '/work/app'] });
    expect(command('terminal', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.apple.Terminal', '/work/app/src'] });
    expect(command('iterm', FILE)).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.googlecode.iterm2', '/work/app/src'] });
    expect(command('ghostty', { kind: 'file', path: '/work/app/run.sh', line: 1 })).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.mitchellh.ghostty', '/work/app'] });
  });

  it('reveals in Finder, the file or the folder', () => {
    expect(command('finder', FILE)).toEqual({ file: '/usr/bin/open', args: ['-R', '/work/app/src/main.ts'] });
    expect(command('finder', FOLDER)).toEqual({ file: '/usr/bin/open', args: ['-R', '/work/app'] });
  });

  it('writes the seam’s line with what the row is handed', () => {
    expect(seamLine(appSpec('zed'), FILE)).toBe('open-in zed /work/app/src/main.ts:42');
    expect(seamLine(appSpec('terminal'), FILE)).toBe('open-in terminal /work/app/src');
    expect(seamLine(appSpec('finder'), FILE)).toBe('open-in finder /work/app/src/main.ts');
    expect(seamLine(appSpec('vscode'), FOLDER)).toBe('open-in vscode /work/app');
  });
});
