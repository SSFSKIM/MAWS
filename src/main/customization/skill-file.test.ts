import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_CLIENT } from '@shared/client/port';
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

// `show` stands for Finder; `asked` records each place whose inventory main read.
function deps({ answer, show = vi.fn<(path: string) => void>(), asked = [] as (string | null)[] }: { answer?: (cwd: string | null) => InventoryAnswer; show?: (path: string) => void; asked?: (string | null)[] } = {}) {
  const listed = (cwd: string | null): InventoryAnswer => ({ ok: true, skillPaths: cwd === project ? [projectSkill, mine] : [mine] });
  return {
    inventory: async (cwd: string | null) => (asked.push(cwd), (answer ?? listed)(cwd)),
    port: { reveal: async (_client: unknown, path: string) => (show(path), { revealed: true as const }) },
  };
}

describe('customization.skillFile reveals only a skill file the inventory lists', () => {
  it("shows a person's skill from the user page and a project's skill from its page, each read for its own place", async () => {
    const show = vi.fn<(path: string) => void>();
    const asked: (string | null)[] = [];
    expect(await skillFile({ cwd: null, path: mine, action: 'reveal' }, null, deps({ show, asked }))).toEqual({ status: 'revealed' });
    expect(await skillFile({ cwd: project, path: projectSkill, action: 'reveal' }, null, deps({ show, asked }))).toEqual({ status: 'revealed' });
    expect(show.mock.calls).toEqual([[mine], [projectSkill]]);
    expect(asked).toEqual([null, project]);
  });

  it("refuses a path the place's inventory does not list, though another place's does, and a file no skill is", async () => {
    const show = vi.fn<(path: string) => void>();
    for (const path of [projectSkill, unlisted, '/etc/passwd']) {
      expect(await skillFile({ cwd: null, path, action: 'reveal' }, null, deps({ show })), path).toEqual({ status: 'refused', reason: 'missing', message: null });
    }
    expect(show).not.toHaveBeenCalled();
  });

  it('refuses a listed path that is gone or is no regular file, and shows the real path of a listed link', async () => {
    const folder = join(root, 'config', 'skills', 'folder');
    mkdirSync(folder);
    const gone = join(root, 'config', 'skills', 'gone', 'SKILL.md');
    const link = join(root, 'config', 'skills', 'linked', 'SKILL.md');
    mkdirSync(join(link, '..'));
    symlinkSync(mine, link);
    const show = vi.fn<(path: string) => void>();
    const answer = (): InventoryAnswer => ({ ok: true, skillPaths: [folder, gone, link] });
    expect(await skillFile({ cwd: null, path: folder, action: 'reveal' }, null, deps({ answer, show }))).toEqual({ status: 'refused', reason: 'missing', message: null });
    expect(await skillFile({ cwd: null, path: gone, action: 'reveal' }, null, deps({ answer, show }))).toEqual({ status: 'refused', reason: 'missing', message: null });
    expect(await skillFile({ cwd: null, path: link, action: 'reveal' }, null, deps({ answer, show }))).toEqual({ status: 'revealed' });
    expect(show.mock.calls).toEqual([[mine]]);
  });

  it("says why when the inventory can't be read, and shows nothing", async () => {
    const show = vi.fn<(path: string) => void>();
    const answer = (): InventoryAnswer => ({ ok: false, message: 'engine host unavailable' });
    expect(await skillFile({ cwd: null, path: mine, action: 'reveal' }, null, deps({ answer, show }))).toEqual({ status: 'refused', reason: 'unreadable', message: 'engine host unavailable' });
    expect(show).not.toHaveBeenCalled();
  });

  it('answers no-window when no window can show Finder', async () => {
    const d = { ...deps(), port: { reveal: async () => NO_CLIENT } };
    expect(await skillFile({ cwd: null, path: mine, action: 'reveal' }, null, d)).toEqual({ status: 'refused', reason: 'no-window', message: null });
  });
});

describe('customization.skillFile on the wire', () => {
  it('takes an absolute path and an absolute place or null, and the one action', () => {
    expect(validateCommandInput('customization.skillFile', { cwd: null, path: '/a/SKILL.md', action: 'reveal' }).ok).toBe(true);
    expect(validateCommandInput('customization.skillFile', { cwd: '/repo', path: '/a/SKILL.md', action: 'reveal' }).ok).toBe(true);
    expect(validateCommandInput('customization.skillFile', { cwd: null, path: 'a/SKILL.md', action: 'reveal' }).ok).toBe(false);
    expect(validateCommandInput('customization.skillFile', { cwd: null, path: '/a/SKILL.md', action: 'open' }).ok).toBe(false);
    expect(validateCommandOutput('customization.skillFile', { status: 'revealed' }).ok).toBe(true);
    expect(validateCommandOutput('customization.skillFile', { status: 'refused', reason: 'missing', message: null }).ok).toBe(true);
    expect(validateCommandOutput('customization.skillFile', { status: 'refused', reason: 'other', message: null }).ok).toBe(false);
  });
});
