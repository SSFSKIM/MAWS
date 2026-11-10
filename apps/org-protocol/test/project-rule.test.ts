// The project registry's shared rule vectors (vectors/project-rule.json; Interfaces §B of
// docs/doperpowers/plans/2026-11-10-project-registry.md): the file holds §B's format exactly, every case §B lists, and
// no case that contradicts itself (an answer by a source the case does not hold, a path outside its tree). The expected
// values are the design's, written by hand; the two implementations' harnesses (sminos, MAWS) are what run them.
import { describe, expect, it } from 'vitest';
import { PROJECT_RULE, type RuleAsk, type RuleCase, type RuleEntry } from '../vectors/index.ts';

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `v` has every one of `required` and nothing beyond `optional`. */
const shaped = (v: unknown, required: string[], optional: string[] = []): v is Fields =>
  isObject(v) && required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isDecimal = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
/** A relative path: no leading `/`, no empty, `.` or `..` segment. */
const isRelative = (v: unknown): v is string => isText(v) && v.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
const isId = (v: unknown) => isText(v) && /^[A-Za-z0-9._-]{1,64}$/.test(v);

/** What is wrong with one tree entry's shape, or null. */
function entryProblem(e: unknown): string | null {
  if (shaped(e, ['dir'])) return isRelative(e.dir) ? null : 'dir';
  if (shaped(e, ['repo'], ['remote', 'remotes'])) {
    if (!isRelative(e.repo)) return 'repo';
    if (e.remote !== undefined && !isText(e.remote)) return 'remote';
    if (e.remotes !== undefined && !(isObject(e.remotes) && Object.values(e.remotes).every(isText))) return 'remotes';
    return e.remote !== undefined && e.remotes !== undefined ? 'both remote and remotes' : null;
  }
  if (shaped(e, ['worktree', 'of'])) return isRelative(e.worktree) && isRelative(e.of) ? null : 'worktree';
  if (shaped(e, ['smns', 'project'], ['name', 'hub'])) {
    return isRelative(e.smns) && isId(e.project) && (e.name === undefined || isText(e.name)) && [undefined, true, false, 'other-org'].includes(e.hub as never) ? null : 'smns';
  }
  if (shaped(e, ['symlink', 'to'])) return isRelative(e.symlink) && isRelative(e.to) ? null : 'symlink';
  return 'an unknown entry';
}

function statementProblem(s: unknown): string | null {
  if (!shaped(s, ['path'], ['minted', 'linked', 'removed', 'replaced']) || !isRelative(s.path)) return 'path';
  if (s.minted === undefined && s.linked === undefined) return 'neither minted nor linked';
  if ((s.minted !== undefined && !isId(s.minted)) || (s.linked !== undefined && !isId(s.linked))) return 'id';
  return [s.removed, s.replaced].every((f) => f === undefined || f === true) ? null : 'flags';
}

function askProblem(a: unknown): string | null {
  if (!shaped(a, ['dir', 'project', 'by'], ['at']) || !isRelative(a.dir)) return 'dir';
  const remote = shaped(a.project, ['remote']) && isText(a.project.remote);
  if (!(remote || a.project === 'machine' || isId(a.project))) return 'project';
  if (!['link', 'minted', 'smns', 'remote', 'machine'].includes(a.by as string)) return 'by';
  if ((a.by === 'machine') !== (a.project === 'machine') || (a.by === 'remote') !== remote) return 'by against project';
  return (a.by === 'machine') === (a.at === undefined) && (a.at === undefined || isRelative(a.at)) ? null : 'at';
}

function caseProblems(c: unknown): string[] {
  if (!shaped(c, ['name', 'tree', 'statements', 'ask'], ['platform', 'under'])) return ['not a case'];
  const problems: string[] = [];
  if (!isText(c.name)) problems.push('name');
  if (c.platform !== undefined && c.platform !== 'darwin' && c.platform !== 'linux') problems.push('platform');
  if (c.under !== undefined && !(isText(c.under) && c.under.startsWith('/'))) problems.push('under');
  for (const [list, check] of [
    [c.tree, entryProblem],
    [c.statements, statementProblem],
    [c.ask, askProblem],
  ] as const) {
    if (!Array.isArray(list)) problems.push('a list');
    else for (const item of list) if (check(item) !== null) problems.push(`${check(item)}: ${JSON.stringify(item)}`);
  }
  if (Array.isArray(c.ask) && c.ask.length === 0) problems.push('no ask');
  return problems;
}

const nfc = (p: string) => p.normalize('NFC');
const pathOf = (e: RuleEntry) => ('dir' in e ? e.dir : 'repo' in e ? e.repo : 'worktree' in e ? e.worktree : 'smns' in e ? e.smns : e.symlink);
const within = (p: string, folder: string) => p === folder || p.startsWith(`${folder}/`);
/** `p` with a symlink entry's spelling replaced by its target's, as a real path names it. */
function real(c: RuleCase, p: string): string {
  for (const e of c.tree) if ('symlink' in e && within(p, e.symlink)) return e.to + p.slice(e.symlink.length);
  return p;
}
/** The remote key of an `https` URL, the only kind the cases write: host and path, the path lower-cased, `.git` off. */
const httpsKey = (url: string) => {
  const m = /^https:\/\/([^/]+)\/(.+?)(\.git)?$/.exec(url);
  return m === null ? null : `${m[1]}/${m[2].toLowerCase()}`;
};

/** Where a case contradicts itself: an answer the tree and statements cannot give. */
function coherence(c: RuleCase): string[] {
  const problems: string[] = [];
  const folders = c.tree.filter((e) => !('symlink' in e)).map((e) => nfc(pathOf(e)));
  // An entry makes its folder and every folder above it.
  const exists = (p: string) => folders.some((f) => within(f, nfc(real(c, p))));
  const repos = new Map(c.tree.flatMap((e) => ('repo' in e ? [[e.repo, e] as const] : [])));
  for (const e of c.tree) if ('worktree' in e && !repos.has(e.of)) problems.push(`worktree ${e.worktree} of no repository`);
  for (const s of c.statements) if (!exists(s.path)) problems.push(`statement ${s.path} on no folder`);
  for (const a of c.ask as RuleAsk[]) {
    const where = a.dir;
    if (!exists(a.dir)) problems.push(`${where}: no such folder`);
    if (a.at !== undefined && !within(nfc(real(c, a.dir)), nfc(a.at)) && !c.tree.some((e) => 'worktree' in e && within(a.dir, e.worktree))) problems.push(`${where}: decided at ${a.at}, not above it`);
    const at = a.at === undefined ? undefined : nfc(a.at);
    const stated = c.statements.find((s) => at !== undefined && nfc(s.path) === at);
    if (a.by === 'link' && stated?.linked !== a.project) problems.push(`${where}: no link to ${String(a.project)} at ${a.at}`);
    if (a.by === 'minted' && stated?.minted !== a.project) problems.push(`${where}: no minted ${String(a.project)} at ${a.at}`);
    if ((a.by === 'link' || a.by === 'minted') && (stated?.removed || stated?.replaced)) problems.push(`${where}: decided by a statement that does not count`);
    if (a.by === 'smns' && !c.tree.some((e) => 'smns' in e && e.smns === a.at && e.project === a.project)) problems.push(`${where}: no .smns of ${String(a.project)} at ${a.at}`);
    if (a.by === 'remote') {
      const repo = repos.get(a.at as string);
      const urls = repo === undefined ? [] : repo.remote !== undefined ? [repo.remote] : Object.entries(repo.remotes ?? {}).filter(([n], _, all) => n === 'origin' || all.length === 1).map(([, u]) => u);
      const key = (a.project as { remote: string }).remote;
      if (urls.length !== 1 || httpsKey(urls[0]) !== key) problems.push(`${where}: ${a.at} derives no remote key ${key}`);
    }
  }
  return problems;
}

describe('the rule vectors', () => {
  const raw: unknown = PROJECT_RULE;

  it("hold §B's format", () => {
    expect(shaped(raw, ['about', 'version', 'org', 'machine', 'cases', 'anchors'])).toBe(true);
    expect(PROJECT_RULE.version).toBe(1);
    expect(isText(PROJECT_RULE.org) && isText(PROJECT_RULE.machine)).toBe(true);
    const names = PROJECT_RULE.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of PROJECT_RULE.cases as unknown[]) expect(caseProblems(c), (c as RuleCase).name).toEqual([]);
  });

  it('answer each ask by a source the case holds, at a folder above it', () => {
    for (const c of PROJECT_RULE.cases) expect(coherence(c), c.name).toEqual([]);
  });

  it('hold every case §B lists', () => {
    const names = new Set(PROJECT_RULE.cases.map((c) => c.name));
    for (const name of [
      'a plain folder with no statement',
      'a minted folder and its subfolder',
      'two nested minted folders: the nearer decides',
      'a .smns above a statement: the statement, nearer',
      'a .smns below a statement: the file, nearer',
      'at one folder, a link and a .smns: the link',
      'at one folder, a minted id and a .smns: the minted id',
      'at one folder, a link and a minted id: the link',
      'a clone with a remote under a minted folder: its remote',
      'a repository with no remote under a minted folder: the minted id',
      'a repository with several remotes, none named origin, under a minted folder: the minted id',
      "a statement on a repository's own root: the statement",
      'a subfolder with a .smns inside a linked checkout: the file',
      "a linked worktree inside its repository, without a .smns: its repository's remote",
      'a linked worktree inside its repository, carrying the committed .smns: the file',
      "a linked worktree outside its repository under another project's folder: its repository's project",
      "a linked main checkout with a worktree carrying the committed .smns: both the link's project",
      "a worktree outside its repository whose main checkout has a .smns above it: that file's project",
      "a removed folder with a declared subfolder: the machine's project",
      'a folder linked and then unlinked: its minted project',
      'a replaced folder: its statement does not count',
      'a path asked through a symlink',
      'a statement made under /private/tmp, asked as /tmp',
      'a folder whose name is stored decomposed on disk and stated composed',
    ]) {
      expect(names, name).toContain(name);
    }
    const tmp = PROJECT_RULE.cases.find((c) => c.name === 'a statement made under /private/tmp, asked as /tmp');
    expect(tmp).toMatchObject({ platform: 'darwin', under: '/tmp' });
    // The decomposed folder: stated composed, its tree and its asks decomposed.
    const nfd = PROJECT_RULE.cases.find((c) => c.name === 'a folder whose name is stored decomposed on disk and stated composed') as RuleCase;
    expect(nfd.statements[0].path).toBe('café');
    expect(nfd.tree.every((e) => pathOf(e) !== nfc(pathOf(e)))).toBe(true);
    expect(nfd.ask.every((a) => a.dir !== nfc(a.dir))).toBe(true);
    // Each deciding source, and each rung of the order at one folder, is asked somewhere.
    const by = new Set(PROJECT_RULE.cases.flatMap((c) => c.ask.map((a) => a.by)));
    expect([...by].sort()).toEqual(['link', 'machine', 'minted', 'remote', 'smns']);
  });

  it("hold §D's anchor cases", () => {
    const anchors = PROJECT_RULE.anchors as unknown[];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(shaped(a, ['name', 'anchor', 'reading', 'same']), JSON.stringify(a)).toBe(true);
      const { anchor, reading, same, name } = a as Fields;
      expect(shaped(anchor, ['dev', 'ino', 'birth']) && [anchor.dev, anchor.ino, anchor.birth].every(isDecimal), String(name)).toBe(true);
      expect(shaped(reading, ['dev', 'ino'], ['birthNs', 'birthSeconds']) && isDecimal(reading.dev) && isDecimal(reading.ino), String(name)).toBe(true);
      const r = reading as Fields;
      expect(r.birthNs === undefined || isDecimal(r.birthNs), String(name)).toBe(true);
      expect(r.birthSeconds === undefined || (typeof r.birthSeconds === 'number' && r.birthSeconds > 0), String(name)).toBe(true);
      expect(r.birthNs === undefined || r.birthSeconds === undefined, String(name)).toBe(true);
      expect(typeof same).toBe('boolean');
    }
    const byName = new Map(PROJECT_RULE.anchors.map((a) => [a.name, a]));
    // The pair measured on one folder of the owner's MacBook, as §D quotes it.
    expect(byName.get('the pair measured on one folder by Python 3.12 and Node: the same folder')).toMatchObject({
      anchor: { birth: '197164871453944374' },
      reading: { birthSeconds: 197164871.45394439 },
      same: true,
    });
    for (const name of [
      'a birth 2,000 ns later: another folder',
      'an anchor with birth 0 against a reading with one: device and inode alone',
      'an anchor with a birth against a reading of birth 0: device and inode alone',
      'a reading with no birth time, as Python reads on Linux: device and inode alone',
      'another inode, the same birth: another folder',
      'another device, the same inode and birth: another folder',
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
  });
});
