// The generic file model (X25; the P3-A document's Decision Log 10): a root type `files` whose attributes map a file's
// relative path to its whole text, merged at file level. A's reading and publishing of a file kind whose owner has not
// registered its own `readFiles` and `publish` (`KindAdapter`), so `design`, `presentation`, `dashboard` and any kind's
// `files` root work before their adapters land; the generic reader shows every other root type as JSON. Portable: the
// engine host runs it today, P4's network store the same.
//
// The publish follows the kind adapter's contract (P3-D's `publishSystem` is its model): `base` is the files as the
// agent last read them, `sent` its whole new files (`null` removes one). A sent file equal to the live one, or to the
// one the agent read, is not the agent's change and is left alone, even under `force`; one the live doc changed since the
// read conflicts unless `force`. Any conflict refuses the whole publish, naming each one, and writes nothing; otherwise
// one transaction writes every change. Paths the model cannot hold throw `FilesError` before anything is written.
import { transact, type Doc } from './yjs';

export const FILES_ROOT = 'files';
const MAX_PATH = 512;

export interface PublishOutcome {
  changed: string[]; // the paths written, removals included, sorted
  conflicts: { path: string; detail?: string }[];
  // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D3; the parent's Decision Log 53 (3)): what a kind's
  // loader said of the sent files, which the agent's answer carries: the paths it created (a subset of `changed`), its
  // warnings (what it dropped), how many notes (heals to an equivalent), and the files it held with their reasons
  added?: string[];
  warnings?: PublishWarning[];
  notes?: number;
  held?: { path: string; reasons: string[] }[];
}

// P3-C: one warning of a kind's loader, naming the file and, where it can, the slide, the element and the property
export interface PublishWarning {
  path: string;
  slide?: string;
  element?: string;
  property?: string;
  message: string;
}

export interface FileProblem {
  path: string;
  message: string;
}

// Files the model cannot hold, each named by its path; `code` and `data` are the store's refusal shape.
export class FilesError extends Error {
  readonly code = 'invalid';
  readonly data: { problems: FileProblem[] };
  constructor(readonly problems: FileProblem[]) {
    super(`the files were refused: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    this.name = 'FilesError';
    this.data = { problems };
  }
}

// Why a relative path cannot name a file, or null: '/'-separated segments, none empty, `.` or `..`, no backslash or
// control character, at most MAX_PATH characters.
export function filePathProblem(path: string): string | null {
  if (path.length === 0 || path.length > MAX_PATH) return `a path is 1 to ${MAX_PATH} characters`;
  // eslint-disable-next-line no-control-regex -- the control characters are what is refused
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return 'a path has no backslash or control character';
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return 'a path is relative, its segments not empty, "." or ".."';
  return null;
}

// The doc's files, sorted by path.
export function readFiles(doc: Doc): Record<string, string> {
  const entries = [...doc.get(FILES_ROOT).attrEntries()].flatMap(([path, text]): [string, string][] => (typeof text === 'string' ? [[String(path), text]] : []));
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// Every root type but `files` as its JSON (`{attrs?, children?}`), sorted by name: the generic reader of a kind
// without one of its own. Roots holding nothing are left out.
export function readRoots(doc: Doc): Record<string, unknown> {
  const roots: Record<string, unknown> = {};
  for (const name of [...doc.share.keys()].sort()) {
    if (name === FILES_ROOT) continue;
    const json = doc.get(name).toJSON() as Record<string, unknown>;
    if (Object.keys(json).length > 0) roots[name] = json;
  }
  return roots;
}

export function publishFiles(live: Doc, base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>, force: boolean): PublishOutcome {
  const problems = Object.keys(sent).flatMap((path) => {
    const message = filePathProblem(path);
    return message ? [{ path, message }] : [];
  });
  if (problems.length > 0) throw new FilesError(problems);
  const files = readFiles(live);
  const writes = new Map<string, string | null>();
  const conflicts: PublishOutcome['conflicts'] = [];
  for (const path of Object.keys(sent).sort()) {
    const mine = sent[path] ?? undefined;
    const theirs = files[path];
    if (mine === theirs || mine === base[path]) continue; // not the agent's change, even under force
    if (theirs !== base[path] && !force) {
      conflicts.push({ path, detail: theirs === undefined ? 'removed since your read' : base[path] === undefined ? 'created since your read' : 'changed since your read' });
      continue;
    }
    writes.set(path, mine ?? null);
  }
  if (conflicts.length > 0) return { changed: [], conflicts };
  if (writes.size > 0) {
    const root = live.get(FILES_ROOT);
    transact(live, () => {
      for (const [path, text] of writes) {
        if (text === null) root.deleteAttr(path);
        else root.setAttr(path, text);
      }
    });
  }
  return { changed: [...writes.keys()], conflicts: [] };
}
