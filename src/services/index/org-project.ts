// A checkout's org project, machine side (P5 O6 M5, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The
// derivation"; OX3, P5 Decision Logs 21 and 27). Each project directory resolves by the first rule that matches:
//
//   1. a `.smns` walking up from it, else its owning repository's      smns:<project>         sminos's own project id
//   2. its repository's remote, `origin` else the only one              remote:<remote key>    enrolled: sminos's uuid5
//   3. a git repository whose remote derives none                       repo:<ref>:<hash>      none
//   4. no repository                                                    folder:<ref>:<id>      none
//
// Rules 1 and 2 are sminos 1.15.0's (`resolve_project`, `smns_at`, `derivation`, `parse_remote`, `remote_key`,
// `remote_name`, `repo_project_id` in skills/sminos/scripts/sminos.py; its vectors are vendored in test/fixtures/sminos/).
// Rules 3 and 4 are OX3's extension, keyed by the machine, since nothing else names them across machines; sminos's
// unenrolled `local-<name>` would merge unrelated repositories that share a basename. The key is the persisted
// identity and enrollment never changes it: sminos's ids hash the org, so they are carried beside it, as `smnsId`, for
// joins (O8). No Electron: O3 moves the index, and this with it, into `mawsd`.
//
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §F.2 and §F.3; its design §8)
// keeps the label (`key`, `name`, `source`) as above and gives `smnsId` by design §8's rule, `deriveProject`: walking up
// from the directory the nearer of a stored statement (a link, then a minted id) and a `.smns` decides, a statement above
// a checkout whose remote derives an id not counting there; else the remote; else the machine's own project (`smnsId`
// null). A linked worktree is in its owning checkout's project. With no statement in force (signed out, not enrolled,
// none made) it is the rule above, which `deriveOrg` keeps answering.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { ProjectDecidedBy, ProjectOrg } from '@shared/ipc/schema/session';
import type { GitFiles } from '@shared/machine/git-reads';
import type { Enrollment } from '@shared/machine/identity'; // P5 O3-D M2 (D16): the enrollment moved to shared
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { repoProjectId } from '@shared/machine/project-ids';
import { gitBinary, gitEnv } from '../git/runner';

// ---- sminos's remote rule -----------------------------------------------------------------------------------------------

const REMOTE_SCHEMES: Record<string, number> = { ssh: 22, 'git+ssh': 22, 'ssh+git': 22, git: 9418, http: 80, https: 443 }; // their default ports
const URL_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)(\/[\s\S]*)?$/;
const HELPER_RE = /^[A-Za-z][A-Za-z0-9+.-]*::/; // git's `<transport>::<address>`
const AUTHORITY_RE = /^(\[[^\]/]+\]|[^[\]:/]*)(?::([0-9]*))?$/;
const SCP_RE = /^(?:[^@/]*@)?(\[[^\]/]+\]|[^[\]:/@]+):([\s\S]*)$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

const validName = (name: string) => name !== '.' && name !== '..' && NAME_RE.test(name);
const safeName = (name: string) => {
  const safe = [...name.replace(/[^A-Za-z0-9._-]/gu, '-')].slice(0, 64).join('');
  return validName(safe) ? safe : '';
};
const NEITHER = 'has a url that is neither scheme://host/path (ssh, git, http, https) nor host:path';
const LOCAL = 'is a local path, which names nothing another machine can agree on';

// sminos's `parse_remote`: host (lower-cased, a port kept only when it is not the scheme's default) and path (repeated
// `/` collapsed, leading and trailing `/` and one trailing `.git` dropped, its case as written) of a remote URL in one
// of git's two network forms; else empty, with why. The why never quotes the URL, which may carry a credential.
export function parseRemote(raw: string): { host: string; path: string; why: string } {
  const url = raw.trim();
  if (url === '') return { host: '', path: '', why: 'names no url' };
  let host: string;
  let path: string;
  const scheme = URL_RE.exec(url);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === 'file') return { host: '', path: '', why: LOCAL };
    const authority = name in REMOTE_SCHEMES ? AUTHORITY_RE.exec(scheme[2].slice(scheme[2].lastIndexOf('@') + 1)) : null;
    if (!authority || !authority[1]) return { host: '', path: '', why: NEITHER };
    host = authority[1].toLowerCase();
    const port = authority[2];
    if (port && Number.parseInt(port, 10) !== REMOTE_SCHEMES[name]) host += `:${Number.parseInt(port, 10)}`;
    path = scheme[3] ?? '';
  } else if (HELPER_RE.test(url)) {
    return { host: '', path: '', why: NEITHER };
  } else {
    const colon = url.indexOf(':');
    const slash = url.indexOf('/');
    if (colon < 0 || (slash >= 0 && slash < colon)) return { host: '', path: '', why: LOCAL };
    const scp = SCP_RE.exec(url);
    if (!scp) return { host: '', path: '', why: NEITHER };
    host = scp[1].toLowerCase();
    path = scp[2];
  }
  path = path.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (path.slice(-4).toLowerCase() === '.git') path = path.slice(0, -4).replace(/\/+$/, '');
  return path ? { host, path, why: '' } : { host: '', path: '', why: 'has a url that names no repository path' };
}

// sminos's `remote_key`: `host[:port]/path`, the path lower-cased as the forges compare it; '' when none derives.
export function remoteKey(url: string): string {
  const { host, path } = parseRemote(url);
  return host ? `${host}/${path.toLowerCase()}` : '';
}

// sminos's `remote_name`: the path's last segment as written, through `safe_name`; '' when none derives.
export function remoteName(url: string): string {
  const { host, path } = parseRemote(url);
  return host ? safeName(path.slice(path.lastIndexOf('/') + 1)) || 'repo' : '';
}

// ---- reading the checkout -----------------------------------------------------------------------------------------------

// A derivation's first try: short, so a slow git never holds up a start (its caller may give a retry longer).
export const ORG_GIT_TIMEOUT_MS = 2_000;

// What a git call answered: its output, or its exit code; null when git gave no answer (it timed out, or could not
// run), which decides nothing, and is logged with its cause.
type GitAnswer = { code: 0; stdout: string } | { code: number } | null;

// `isolated` (P5 O7 M9 round 3, a remote setup's registration before trust): git reads no configuration of its own at
// start either (`config --file` still reads the system and global files, following their includes, before the one it
// is asked for). In every call the cwd is no checkout's, so its repository discovery reads no folder's config.
const ISOLATED = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function git(args: string[], timeoutMs: number, isolated = false): Promise<GitAnswer> {
  return new Promise((done) => {
    const env = { ...gitEnv(process.env), ...(isolated ? ISOLATED : {}) };
    execFile(gitBinary(process.env), args, { cwd: tmpdir(), env, encoding: 'utf8', timeout: timeoutMs }, (error, stdout) => {
      if (!error) return done({ code: 0, stdout });
      if (typeof error.code === 'number' && !error.killed) return done({ code: error.code });
      const why = error.killed ? `timed out after ${timeoutMs} ms`
        : error.signal ? `it ended on ${error.signal}`
        : typeof error.code === 'string' ? `it could not run (${error.code})`
        : error.message;
      console.warn(`[index] git ${args.join(' ')} gave no answer: ${why}`);
      done(null);
    });
  });
}

// sminos's `common_git_dir`, read off the filesystem as `_common_git_dir_fs` does: from the nearest existing ancestor,
// the nearest `.git` upward; a directory is it, a file (a linked worktree's) points at its gitdir, whose `commondir`
// leads to the main checkout's. '' outside git. A layout that is neither asks git, as sminos does; null when git gave
// no answer. With it, for design §8's rule, the folder holding that `.git` (the checkout's work tree; '' outside git)
// and whether it is a linked worktree's (its gitdir names a `commondir`).
type GitLayout = { common: string; holder: string; linked: boolean };
async function gitLayout(directory: string, timeoutMs: number, io: OrgIo): Promise<GitLayout | null> {
  let d = resolve(directory);
  while ((await io.kind(d)) !== 'directory') {
    if (dirname(d) === d) return { common: '', holder: '', linked: false };
    d = dirname(d);
  }
  for (let at = d; ; at = dirname(at)) {
    const dot = join(at, '.git');
    const kind = await io.kind(dot);
    if (kind === 'directory') return { common: dot, holder: at, linked: false };
    if (kind === 'file') {
      const pointed = await linkedCommonDir(at, dot, io);
      if (pointed !== null) return { common: pointed.common, holder: at, linked: pointed.linked };
      const asked = io.asksGit ? await askedCommonDir(d, timeoutMs) : null;
      return asked === null ? null : { common: asked, holder: asked === '' ? '' : at, linked: false };
    }
    if (dirname(at) === at) return { common: '', holder: '', linked: false };
  }
}

/**
 * Whether a folder is in a linked worktree as design §8's rule reads it (its checkout's `.git` a file whose gitdir names
 * a `commondir`), through `files`; null when the layout gives no answer. A statement at a linked worktree's own folder
 * does not decide its project: the owning checkout does (M9's re-review, Fix 2c).
 */
export async function inLinkedWorktree(directory: string, files: GitFiles): Promise<boolean | null> {
  const io = checkedIo(files);
  const layout = await gitLayout(await io.real(directory), ORG_GIT_TIMEOUT_MS, io);
  return layout === null ? null : layout.linked;
}

async function linkedCommonDir(at: string, dot: string, io: OrgIo): Promise<{ common: string; linked: boolean } | null> {
  let line: string;
  try {
    const text = await io.read(dot);
    if (text === null) return null;
    line = text.split('\n')[0].trim();
  } catch {
    return null;
  }
  if (!line.startsWith('gitdir:')) return null;
  const gitdir = await io.pointer(at, line.slice('gitdir:'.length).trim());
  if (gitdir === null) return null;
  try {
    const common = await io.read(join(gitdir, 'commondir'));
    if (common === null) return { common: resolve(gitdir), linked: false };
    const pointed = await io.pointer(gitdir, common.trim());
    return pointed === null ? null : { common: pointed, linked: true };
  } catch {
    return null;
  }
}

async function askedCommonDir(directory: string, timeoutMs: number): Promise<string | null> {
  const answer = await git(['-C', directory, 'rev-parse', '--git-common-dir'], timeoutMs);
  if (answer === null) return null;
  const common = 'stdout' in answer ? answer.stdout.trim() : '';
  return common === '' ? '' : resolve(isAbsolute(common) ? common : join(directory, common));
}

// How a derivation reads the checkout: the file system as it stands (every start's refresh), or, for a remote setup's
// registration before the folder's trust is accepted (P5 O7 M9 round 3), its checked reader: each read through the
// home's walk (src/shared/machine/git-reads.ts), a link followed only where it may be, and no git asked for a layout the
// files don't answer (no org then; the next start's refresh derives it). `read` answers null when there is no file and
// throws when there is one it can't read.
interface OrgIo {
  kind(path: string): Promise<'file' | 'directory' | null>;
  read(path: string): Promise<string | null>;
  canonical(path: string): Promise<string>;
  // the real path `path` leads to, links followed, as the filesystem spells it (no normalization), so it reads on any
  // filesystem; `path` itself where it leads nowhere
  real(path: string): Promise<string>;
  // the path a pointer's content names from `base`: sminos's lexical join (Python's os.path.join: an absolute part
  // wins); under the setup, the walk's resolution (a `..` after a link climbing from its target), null when it names
  // nowhere, so what is read from then on is what was checked
  pointer(base: string, target: string): Promise<string | null>;
  // the config file `config --file` is handed: under the setup, the walk's resolution of it (null: none)
  config(common: string): Promise<string | null>;
  asksGit: boolean;
}

const LOCAL_IO: OrgIo = {
  async kind(path) {
    try {
      const stat = statSync(path);
      return stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : null;
    } catch {
      return null;
    }
  },
  async read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async canonical(path) {
    return canonical(path);
  },
  async real(path) {
    try {
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  },
  async pointer(base, target) {
    return resolve(base, target);
  },
  async config(common) {
    return join(common, 'config');
  },
  asksGit: true,
};

/** A pointer or a `.smns` is small; a larger file is no read here. */
const CHECKED_READ_MAX = 1024 * 1024;

function checkedIo(files: GitFiles): OrgIo {
  return {
    async kind(path) {
      const at = await files.real(path);
      const kind = at === null ? null : await files.entry(at);
      return kind === 'file' || kind === 'directory' ? kind : null;
    },
    async read(path) {
      if ((await files.real(path)) === null) return null;
      const bytes = await files.read(path, CHECKED_READ_MAX);
      if (bytes === null) throw new Error(`${path} is no file to read`);
      return bytes.toString('utf8');
    },
    async canonical(path) {
      return (await files.real(path))?.normalize('NFC') ?? path;
    },
    async real(path) {
      return (await files.real(path)) ?? resolve(path);
    },
    pointer: (base, target) => files.real(isAbsolute(target) ? target : `${base}${sep}${target}`),
    config: (common) => files.real(join(common, 'config')),
    asksGit: false,
  };
}

// The remotes of a repository's config, in the order it names them, each with its first `url` ('' for none): sminos's
// `git_config_remotes`, read by git's own parser with sminos's no-includes semantics. Every key of a remote section
// counts, as it does for sminos, so a remote with only a `fetch` still makes two remotes. A config git refuses, and a
// missing one, have no remote here (sminos derives no project from either); null when git gave no answer.
async function configRemotes(common: string, timeoutMs: number, io: OrgIo): Promise<Map<string, string> | null> {
  const file = await io.config(common);
  if (file === null) return new Map(); // no config: no remote, as git's exit 1 for a missing file says
  const answer = await git(['config', '--file', file, '--no-includes', '-z', '--get-regexp', '^remote\\.'], timeoutMs, !io.asksGit);
  if (answer === null) return null;
  if (!('stdout' in answer)) return new Map(); // 1: nothing matched or no file; 128: a file git refuses
  const remotes = new Map<string, string | null>();
  for (const entry of answer.stdout.split('\0')) {
    if (entry === '') continue;
    const newline = entry.indexOf('\n');
    const name = newline === -1 ? entry : entry.slice(0, newline); // `remote.<name>.<key>`; no newline: a key with no value
    const value = newline === -1 ? '' : entry.slice(newline + 1);
    const remote = name.slice('remote.'.length, name.lastIndexOf('.'));
    if (remote === '') continue;
    if (!remotes.has(remote)) remotes.set(remote, null);
    if (name.slice(name.lastIndexOf('.') + 1) === 'url' && remotes.get(remote) === null) remotes.set(remote, value);
  }
  return new Map([...remotes].map(([remote, url]) => [remote, url ?? '']));
}


// sminos's `read_smns`: the file's `project` (a valid name) and `name` (else the project), or null for one that is
// unreadable or names no valid project, which sminos passes over with a warning.
// `hub` is the org the file's `hub` names ('' for a `hub` naming none), null when it has no `hub` (a git-mirrored project).
type SmnsFile = { project: string; name: string; hub: string | null };
async function readSmns(path: string, io: OrgIo): Promise<SmnsFile | null> {
  if ((await io.kind(path)) !== 'file') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse((await io.read(path)) ?? '');
  } catch {
    console.warn(`[index] ignoring unreadable ${path}`);
    return null;
  }
  const file = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const project = pyText(file.project);
  if (!validName(project)) {
    console.warn(`[index] ignoring ${path}: it names no valid project id`);
    return null;
  }
  const hub = !('hub' in file) ? null : typeof file.hub === 'object' && file.hub !== null && typeof (file.hub as Record<string, unknown>).org === 'string' ? ((file.hub as Record<string, unknown>).org as string) : '';
  return { project, name: pyText(file.name) || project, hub };
}

// sminos's `str(value or "")` over a JSON value: a falsy one ("", 0, false, null, [], {}) is "", a truthy one its Python
// text. A JSON number reads as Python's int when it is whole (JSON.parse cannot tell `42.0` from `42`, which Python
// would print as `42.0`), else as JavaScript prints it.
function pyText(value: unknown): string {
  const falsy = !value || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && Object.keys(value as object).length === 0);
  return falsy ? '' : typeof value === 'string' ? value : pyRepr(value);
}

function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
}

// sminos's `smns_at`: the first `.smns` walking up from the directory; else, for a linked worktree at a head that
// predates the file, its owning repository's, so an old branch never splits the repository into two projects.
async function smnsAt(directory: string, owningRepo: string, io: OrgIo): Promise<SmnsFile | null> {
  for (let d = resolve(directory); ; d = dirname(d)) {
    const found = await readSmns(join(d, '.smns'), io);
    if (found) return found;
    if (dirname(d) === d) break;
  }
  return owningRepo === '' ? null : readSmns(join(owningRepo, '.smns'), io);
}

const canonical = (path: string) => {
  try {
    return realpathSync.native(path).normalize('NFC');
  } catch {
    return path;
  }
};

// ---- the rule -----------------------------------------------------------------------------------------------------------

export interface OrgSubject {
  directory: string; // the project's directory (a realpath)
  machine: MachineRef; // this machine, which rules 3 and 4 key by
  projectId: string; // the project's bare id, which rule 4 keys by
  name: string; // the project's name, which rule 4 takes
  files?: GitFiles; // P5 O7 M9 round 3: a remote setup's registration's checked reader, before trust (`OrgIo`)
}

// The directory's org project; null when git gave no answer within `gitTimeoutMs` (a timeout), which decides nothing:
// the row keeps what it had, and is asked again, so a slow git never moves a project's key. No stored statement is read.
export async function deriveOrg(subject: OrgSubject, enrollment: Enrollment | null, gitTimeoutMs: number = ORG_GIT_TIMEOUT_MS): Promise<ProjectOrg | null> {
  return (await deriveProject(subject, enrollment, { gitTimeoutMs }))?.org ?? null;
}

/** A folder's stored statement in force (Interfaces §F.2), looked up by its canonical path (the real path, NFC). */
export type StatementLookup = (path: string) => { minted: string | null; linked: string | null } | null;
export const NO_STATEMENTS: StatementLookup = () => null;

/** How design §8's rule decided (Interfaces §F.3). */
export interface OrgDerivation {
  org: ProjectOrg; // the label as above; `smnsId` the rule's project, null for the machine's own
  by: ProjectDecidedBy;
  at: string | null; // the deciding folder, canonical; null for the machine's own project
  smnsFolder: string | null; // where `by` is `smns`, the folder holding the deciding file (the main checkout's for a worktree)
  remote: string | null; // the repository's remote key, whatever decided
  hub: boolean; // false when a `.smns` decides that names no hub of the enrollment's org
}

type Decision = { by: ProjectDecidedBy; at: string | null; id: string | null; smns?: SmnsFile };

const nfc = (path: string) => path.normalize('NFC');
/**
 * One act's reads of the repositories' remotes, by common dir: the derivations an act makes of one folder (the row it
 * would publish, then the row's own, before and after its statement) spend one git process on its config, as one
 * derivation does (a remote setup's untrusted path is one isolated config read; M8's Fix 3). An answer of no answer is
 * not kept, so a later derivation asks again.
 */
export type RemoteReads = Map<string, Promise<Map<string, string> | null>>;

function readRemotes(common: string, timeoutMs: number, io: OrgIo, reads: RemoteReads | undefined): Promise<Map<string, string> | null> {
  if (reads === undefined) return configRemotes(common, timeoutMs, io);
  const kept = reads.get(common);
  if (kept !== undefined) return kept;
  const read = configRemotes(common, timeoutMs, io);
  reads.set(common, read);
  void read.then(
    (remotes) => remotes === null && reads.delete(common),
    () => reads.delete(common),
  );
  return read;
}

// `folder` is `path` or lies above it
const holds = (folder: string, path: string) => folder === path || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/**
 * Design §8's rule for a directory, with the label (Interfaces §F.3); null when git gave no answer in time. Stored
 * statements count only on an enrolled machine (constraint 7): with none, `statements` is not asked.
 */
export async function deriveProject(
  { directory, machine, projectId, name, files }: OrgSubject,
  enrollment: Enrollment | null,
  { statements = NO_STATEMENTS, gitTimeoutMs = ORG_GIT_TIMEOUT_MS, remoteReads }: { statements?: StatementLookup; gitTimeoutMs?: number; remoteReads?: RemoteReads } = {},
): Promise<OrgDerivation | null> {
  const io = files === undefined ? LOCAL_IO : checkedIo(files);
  const lookup = enrollment === null ? NO_STATEMENTS : statements;
  const start = await io.real(directory);
  const layout = await gitLayout(start, gitTimeoutMs, io);
  if (layout === null) return null;
  const owningRepo = layout.common === '' ? '' : dirname(layout.common);
  const remotes = owningRepo === '' ? new Map<string, string>() : await readRemotes(layout.common, gitTimeoutMs, io, remoteReads);
  if (remotes === null) return null;
  const remote = remotes.has('origin') ? 'origin' : remotes.size === 1 ? [...remotes.keys()][0] : undefined;
  const url = remote === undefined ? '' : remotes.get(remote)!;
  const key = remoteKey(url);

  // the label, as before the registry
  const smns = await smnsAt(start, owningRepo, io);
  let label: ProjectOrg;
  if (smns) label = { key: `smns:${smns.project}` as OrgKey, name: smns.name, source: 'smns', smnsId: null };
  else if (owningRepo === '') label = { key: `folder:${machine}:${projectId}` as OrgKey, name, source: 'folder', smnsId: null };
  else if (key !== '') label = { key: `remote:${key}` as OrgKey, name: remoteName(url), source: 'remote', smnsId: null };
  else {
    const repo = await io.canonical(owningRepo);
    label = { key: `repo:${machine}:${createHash('sha256').update(repo).digest('hex').slice(0, 16)}` as OrgKey, name: basename(repo), source: 'repository', smnsId: null };
  }

  // the rule. The checkout's root R: the main checkout for a linked worktree, else the folder holding `.git`.
  const root = layout.common === '' ? '' : layout.linked ? await io.real(owningRepo) : await io.real(layout.holder);
  const remoteId = key === '' ? null : enrollment ? repoProjectId(enrollment.org, key) : null;
  const ruleAt = async (from: string): Promise<Decision> => {
    for (let folder = from; ; folder = dirname(folder)) {
      // a statement above R does not count when R derives a remote: a project folder does not take the clones beneath it
      const stated = root !== '' && key !== '' && !holds(root, folder) ? null : lookup(nfc(folder));
      if (stated?.linked) return { by: 'link', at: folder, id: stated.linked };
      if (stated?.minted) return { by: 'minted', at: folder, id: stated.minted };
      const file = await readSmns(join(folder, '.smns'), io);
      if (file) return { by: 'smns', at: folder, id: file.project, smns: file };
      if (dirname(folder) === folder) break;
    }
    if (root !== '' && key !== '') return { by: 'remote', at: root, id: remoteId };
    return { by: 'machine', at: null, id: null };
  };
  let decided: Decision;
  let smnsFolder: string | null = null;
  if (root !== '' && layout.linked) {
    // a linked worktree is in its owning checkout's project: R's own statement decides for it before any `.smns` in it;
    // else a `.smns` on its own path, up to the first folder R lies in; else the rule at R
    const worktree = await io.real(layout.holder);
    const atRoot = await ruleAt(root);
    decided = atRoot;
    if (!((atRoot.by === 'link' || atRoot.by === 'minted') && atRoot.at === root)) {
      for (let folder = start; !holds(folder, root); folder = dirname(folder)) {
        const file = await readSmns(join(folder, '.smns'), io);
        if (file) {
          decided = { by: 'smns', at: folder, id: file.project, smns: file };
          smnsFolder = holds(worktree, folder) ? root + folder.slice(worktree.length) : folder;
          break;
        }
        if (dirname(folder) === folder) break;
      }
    }
    if (decided === atRoot && decided.by === 'smns') smnsFolder = decided.at;
  } else {
    decided = await ruleAt(start);
    if (decided.by === 'smns') smnsFolder = decided.at;
  }
  return {
    org: { ...label, smnsId: decided.id },
    by: decided.by,
    at: decided.at === null ? null : nfc(decided.at),
    smnsFolder: smnsFolder === null ? null : nfc(smnsFolder),
    remote: key === '' ? null : key,
    hub: decided.smns === undefined || (enrollment !== null && decided.smns.hub === enrollment.org),
  };
}

/**
 * The `.smns` in the folder itself: the project it names and the org whose hub it names ('' for a `hub` naming none, null
 * for no `hub`), or null (Interfaces §G: a link to its id needs no record). `files`: a remote setup's checked reader.
 */
export async function folderSmns(folder: string, files?: GitFiles): Promise<{ project: string; hub: string | null } | null> {
  const found = await readSmns(join(folder, '.smns'), files === undefined ? LOCAL_IO : checkedIo(files));
  return found === null ? null : { project: found.project, hub: found.hub };
}
