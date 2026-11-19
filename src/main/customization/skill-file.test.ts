import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { skillFile, type InventoryAnswer } from './skill-file';

// A fake configuration home with one person's skill, a project with one skill, and a file beside them no inventory lists.
let root: string;
let mine: string;
let project: string;
let projectSkill: string;
let unlisted: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-skill-file-')));
  mine = join(root, 'config', 'skills', 'notes', 'SKILL.md');
  project = join(root, 'repo');
  projectSkill = join(project, '.claude', 'skills', 'release', 'SKILL.md');
  unlisted = join(root, 'config', 'settings.json');
  for (const file of [mine, projectSkill, unlisted]) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '---\nname: x\n---\n');
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// `launched` records each hand-off to "Open in"'s launcher; `asked` each place whose inventory main read.
function deps({ answer, launched = vi.fn<(app: string, path: string) => void>(), asked = [] as (string | null)[], launch = { opened: true as const } as { opened: true } | { opened: false; message: string } }: { answer?: (cwd: string | null) => InventoryAnswer; launched?: (app: string, path: string) => void; asked?: (string | null)[]; launch?: { opened: true } | { opened: false; message: string } } = {}) {
  const listed = (cwd: string | null): InventoryAnswer => ({ ok: true, skillPaths: cwd === project ? [projectSkill, mine] : [mine] });
  return {
    inventory: async (cwd: string | null) => (asked.push(cwd), (answer ?? listed)(cwd)),
    launcher: { launchFile: async (app: string, path: string) => (launched(app, path), launch) },
  };
}

describe('customization.skillFile hands only a skill file the inventory lists to Open in', () => {
  it("opens a person's skill from the user page and a project's skill from its page, each read for its own place", async () => {
    const launched = vi.fn<(app: string, path: string) => void>();
    const asked: (string | null)[] = [];
    expect(await skillFile({ cwd: null, path: mine, app: 'zed' }, deps({ launched, asked }))).toEqual({ status: 'opened' });
    expect(await skillFile({ cwd: project, path: projectSkill, app: 'finder' }, deps({ launched, asked }))).toEqual({ status: 'opened' });
    expect(launched.mock.calls).toEqual([['zed', mine], ['finder', projectSkill]]);
    expect(asked).toEqual([null, project]);
  });

  it("refuses a path the place's inventory does not list, though another place's does, and a file no skill is", async () => {
    const launched = vi.fn<(app: string, path: string) => void>();
    for (const path of [projectSkill, unlisted, '/etc/passwd']) {
      expect(await skillFile({ cwd: null, path, app: 'finder' }, deps({ launched })), path).toEqual({ status: 'refused', reason: 'missing', message: null });
    }
    expect(launched).not.toHaveBeenCalled();
  });

  it('refuses a listed path that is gone or is no regular file, and hands on the real path of a listed link', async () => {
    const folder = join(root, 'config', 'skills', 'folder');
    mkdirSync(folder);
    const gone = join(root, 'config', 'skills', 'gone', 'SKILL.md');
    const link = join(root, 'config', 'skills', 'linked', 'SKILL.md');
    mkdirSync(join(link, '..'));
    symlinkSync(mine, link);
    const launched = vi.fn<(app: string, path: string) => void>();
    const answer = (): InventoryAnswer => ({ ok: true, skillPaths: [folder, gone, link] });
    expect(await skillFile({ cwd: null, path: folder, app: 'vscode' }, deps({ answer, launched }))).toEqual({ status: 'refused', reason: 'missing', message: null });
    expect(await skillFile({ cwd: null, path: gone, app: 'vscode' }, deps({ answer, launched }))).toEqual({ status: 'refused', reason: 'missing', message: null });
    expect(await skillFile({ cwd: null, path: link, app: 'vscode' }, deps({ answer, launched }))).toEqual({ status: 'opened' });
    expect(launched.mock.calls).toEqual([['vscode', mine]]);
  });

  it("says why when the inventory can't be read, and hands nothing on", async () => {
    const launched = vi.fn<(app: string, path: string) => void>();
    const answer = (): InventoryAnswer => ({ ok: false, message: 'engine host unavailable' });
    expect(await skillFile({ cwd: null, path: mine, app: 'finder' }, deps({ answer, launched }))).toEqual({ status: 'refused', reason: 'unreadable', message: 'engine host unavailable' });
    expect(launched).not.toHaveBeenCalled();
  });

  it("carries the launcher's sentence when the row did not open", async () => {
    const launch = { opened: false as const, message: 'Zed is not installed on this Mac' };
    expect(await skillFile({ cwd: null, path: mine, app: 'zed' }, deps({ launch }))).toEqual({ status: 'refused', reason: 'launch', message: 'Zed is not installed on this Mac' });
  });
});

describe('customization.skillFile on the wire', () => {
  it('takes an absolute path, an absolute place or null, and an editor or Finder, never a terminal', () => {
    expect(validateCommandInput('customization.skillFile', { cwd: null, path: '/a/SKILL.md', app: 'finder' }).ok).toBe(true);
    expect(validateCommandInput('customization.skillFile', { cwd: '/repo', path: '/a/SKILL.md', app: 'cursor' }).ok).toBe(true);
    expect(validateCommandInput('customization.skillFile', { cwd: null, path: 'a/SKILL.md', app: 'finder' }).ok).toBe(false);
    for (const app of ['terminal', 'iterm', 'ghostty', 'other']) expect(validateCommandInput('customization.skillFile', { cwd: null, path: '/a/SKILL.md', app }).ok, app).toBe(false);
    expect(validateCommandOutput('customization.skillFile', { status: 'opened' }).ok).toBe(true);
    expect(validateCommandOutput('customization.skillFile', { status: 'refused', reason: 'launch', message: 'Zed did not open' }).ok).toBe(true);
    expect(validateCommandOutput('customization.skillFile', { status: 'refused', reason: 'other', message: null }).ok).toBe(false);
  });
});
