import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { SKILL_FILE_WORDS, skillFile, type InventoryAnswer } from './skill-file';

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

// A skill as the inventory lists it: the file it read, by its real path and identity, taken when it is listed.
const read = (path: string) => {
  const real = realpathSync(path);
  const id = statSync(real, { bigint: true });
  return { path, realPath: real, fileId: `${id.dev}:${id.ino}` };
};
const listing = (paths: string[], complete = true, problem: string | null = null): InventoryAnswer => ({ ok: true, skills: paths.map(read), complete, problem });

// `launched` records each hand-off to "Open in"'s launcher; `asked` each place whose inventory main read.
type Launch = { opened: true } | { opened: false; message: string };
function deps({ answer, launched = vi.fn<(app: string, path: string) => void>(), asked = [] as (string | null)[], launch = { opened: true } as Launch }: { answer?: (cwd: string | null) => InventoryAnswer; launched?: (app: string, path: string) => void; asked?: (string | null)[]; launch?: Launch } = {}) {
  const listed = (cwd: string | null): InventoryAnswer => listing(cwd === project ? [projectSkill, mine] : [mine]);
  return {
    inventory: async (cwd: string | null) => (asked.push(cwd), (answer ?? listed)(cwd)),
    launcher: { launchFile: async (app: string, path: string) => (launched(app, path), launch) },
  };
}
const MISSING = { status: 'refused', reason: 'missing', message: null };

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
    for (const path of [projectSkill, unlisted, '/etc/passwd']) expect(await skillFile({ cwd: null, path, app: 'finder' }, deps({ launched })), path).toEqual(MISSING);
    expect(launched).not.toHaveBeenCalled();
  });

  it('refuses a listed file that is gone, and hands on the real path of a listed link that still leads to the file read', async () => {
    const gone = join(root, 'config', 'skills', 'gone', 'SKILL.md');
    mkdirSync(join(gone, '..'));
    writeFileSync(gone, 'x');
    const link = join(root, 'config', 'skills', 'linked', 'SKILL.md');
    mkdirSync(join(link, '..'));
    symlinkSync(mine, link);
    const launched = vi.fn<(app: string, path: string) => void>();
    const listed = listing([gone, link]);
    rmSync(gone);
    expect(await skillFile({ cwd: null, path: gone, app: 'vscode' }, deps({ answer: () => listed, launched }))).toEqual(MISSING);
    expect(await skillFile({ cwd: null, path: link, app: 'vscode' }, deps({ answer: () => listed, launched }))).toEqual({ status: 'opened' });
    expect(launched.mock.calls).toEqual([['vscode', mine]]);
  });

  it('opens nothing when the file changed after the inventory read it: replaced in place, or a link moved elsewhere', async () => {
    const plugin = join(root, 'cache', 'plugin', 'skills', 'chart', 'SKILL.md');
    const outside = join(root, 'elsewhere', 'SKILL.md');
    for (const file of [plugin, outside]) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'x');
    }
    const link = join(root, 'config', 'skills', 'chart', 'SKILL.md');
    mkdirSync(join(link, '..'));
    symlinkSync(plugin, link);
    const listed = listing([mine, link]);
    const launched = vi.fn<(app: string, path: string) => void>();
    // the same name, another file: written beside and renamed over it
    writeFileSync(`${mine}.new`, 'replaced');
    renameSync(`${mine}.new`, mine);
    expect(await skillFile({ cwd: null, path: mine, app: 'zed' }, deps({ answer: () => listed, launched }))).toEqual(MISSING);
    // the link now leads outside the plugin
    rmSync(link);
    symlinkSync(outside, link);
    expect(await skillFile({ cwd: null, path: link, app: 'finder' }, deps({ answer: () => listed, launched }))).toEqual(MISSING);
    expect(launched).not.toHaveBeenCalled();
  });

  it('opens nothing for a skill an engine host of an earlier build listed, which names no file it read', async () => {
    const launched = vi.fn<(app: string, path: string) => void>();
    const answer = (): InventoryAnswer => ({ ok: true, skills: [{ path: mine }], complete: true, problem: null });
    expect(await skillFile({ cwd: null, path: mine, app: 'zed' }, deps({ answer, launched }))).toEqual({ status: 'refused', reason: 'unreadable', message: SKILL_FILE_WORDS.olderHost });
    expect(launched).not.toHaveBeenCalled();
  });

  it("says why when the inventory can't be read, or a skill is not listed by a read that did not reach every folder", async () => {
    const launched = vi.fn<(app: string, path: string) => void>();
    const failed = (): InventoryAnswer => ({ ok: false, message: 'engine host unavailable' });
    expect(await skillFile({ cwd: null, path: mine, app: 'finder' }, deps({ answer: failed, launched }))).toEqual({ status: 'refused', reason: 'unreadable', message: 'engine host unavailable' });
    const limit = 'Customization inventory reached its read limit; some configured items are not inventoried.';
    expect(await skillFile({ cwd: null, path: projectSkill, app: 'finder' }, deps({ answer: () => listing([mine], false, limit), launched }))).toEqual({ status: 'refused', reason: 'unreadable', message: limit });
    expect(await skillFile({ cwd: null, path: projectSkill, app: 'finder' }, deps({ answer: () => listing([mine], false), launched }))).toEqual({ status: 'refused', reason: 'unreadable', message: SKILL_FILE_WORDS.incomplete });
    expect(launched).not.toHaveBeenCalled();
    // a listed skill opens though the read was incomplete elsewhere
    expect(await skillFile({ cwd: null, path: mine, app: 'finder' }, deps({ answer: () => listing([mine], false, limit), launched }))).toEqual({ status: 'opened' });
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
