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
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { ProjectOrg } from '@shared/ipc/schema/session';
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

function git(args: string[], timeoutMs: number): Promise<GitAnswer> {
  return new Promise((done) => {
    execFile(gitBinary(process.env), args, { env: gitEnv(process.env), encoding: 'utf8', timeout: timeoutMs }, (error, stdout) => {
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
// no answer.
async function commonGitDir(directory: string, timeoutMs: number): Promise<string | null> {
  let d = resolve(directory);
  while (!isDirectory(d)) {
    if (dirname(d) === d) return '';
    d = dirname(d);
  }
  for (let at = d; ; at = dirname(at)) {
    const dot = join(at, '.git');
    if (isDirectory(dot)) return dot;
    if (isFile(dot)) return linkedCommonDir(at, dot) ?? (await askedCommonDir(d, timeoutMs));
    if (dirname(at) === at) return '';
  }
}

function linkedCommonDir(at: string, dot: string): string | null {
  let line: string;
  try {
    line = readFileSync(dot, 'utf8').split('\n')[0].trim();
  } catch {
    return null;
  }
  if (!line.startsWith('gitdir:')) return null;
  const gitdir = resolve(at, line.slice('gitdir:'.length).trim()); // Python's os.path.join: an absolute part wins
  try {
    return resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? resolve(gitdir) : null;
  }
}

async function askedCommonDir(directory: string, timeoutMs: number): Promise<string | null> {
  const answer = await git(['-C', directory, 'rev-parse', '--git-common-dir'], timeoutMs);
  if (answer === null) return null;
  const common = 'stdout' in answer ? answer.stdout.trim() : '';
  return common === '' ? '' : resolve(isAbsolute(common) ? common : join(directory, common));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// The remotes of a repository's config, in the order it names them, each with its first `url` ('' for none): sminos's
// `git_config_remotes`, read by git's own parser with sminos's no-includes semantics. Every key of a remote section
// counts, as it does for sminos, so a remote with only a `fetch` still makes two remotes. A config git refuses, and a
// missing one, have no remote here (sminos derives no project from either); null when git gave no answer.
async function configRemotes(common: string, timeoutMs: number): Promise<Map<string, string> | null> {
  const answer = await git(['config', '--file', join(common, 'config'), '--no-includes', '-z', '--get-regexp', '^remote\\.'], timeoutMs);
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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// sminos's `read_smns`: the file's `project` (a valid name) and `name` (else the project), or null for one that is
// unreadable or names no valid project, which sminos passes over with a warning.
function readSmns(path: string): { project: string; name: string } | null {
  if (!isFile(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
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
  return { project, name: pyText(file.name) || project };
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
function smnsAt(directory: string, owningRepo: string): { project: string; name: string } | null {
  for (let d = resolve(directory); ; d = dirname(d)) {
    const found = readSmns(join(d, '.smns'));
    if (found) return found;
    if (dirname(d) === d) break;
  }
  return owningRepo === '' ? null : readSmns(join(owningRepo, '.smns'));
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
}

// The directory's org project; null when git gave no answer within `gitTimeoutMs` (a timeout), which decides nothing:
// the row keeps what it had, and is asked again, so a slow git never moves a project's key.
export async function deriveOrg(
  { directory, machine, projectId, name }: OrgSubject,
  enrollment: Enrollment | null,
  gitTimeoutMs: number = ORG_GIT_TIMEOUT_MS,
): Promise<ProjectOrg | null> {
  const common = await commonGitDir(directory, gitTimeoutMs);
  if (common === null) return null;
  const owningRepo = common === '' ? '' : dirname(common);
  const smns = smnsAt(directory, owningRepo);
  if (smns) return { key: `smns:${smns.project}` as OrgKey, name: smns.name, source: 'smns', smnsId: smns.project };
  if (owningRepo === '') return { key: `folder:${machine}:${projectId}` as OrgKey, name, source: 'folder', smnsId: null };
  const remotes = await configRemotes(common, gitTimeoutMs);
  if (remotes === null) return null;
  const remote = remotes.has('origin') ? 'origin' : remotes.size === 1 ? [...remotes.keys()][0] : undefined;
  const url = remote === undefined ? '' : remotes.get(remote)!;
  const key = remoteKey(url);
  if (key !== '') return { key: `remote:${key}` as OrgKey, name: remoteName(url), source: 'remote', smnsId: enrollment ? repoProjectId(enrollment.org, key) : null };
  const repo = canonical(owningRepo);
  return { key: `repo:${machine}:${createHash('sha256').update(repo).digest('hex').slice(0, 16)}` as OrgKey, name: basename(repo), source: 'repository', smnsId: null };
}
