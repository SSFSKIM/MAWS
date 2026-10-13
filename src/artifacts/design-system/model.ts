// A design system's document model, format version 1 (D7 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md):
// one Y.Doc per system with four root nodes, through the binding module only.
//   `meta`   attributes: `formatVersion`, `origin`, and `name` only for a system whose law had no title at creation.
//            Derived metadata is never stored (Decision Log 12): the persona and the titled name are read off the
//            converged law, so replicas that edited the law concurrently cannot disagree about them.
//   `tokens` one attribute per token, keyed by its path (`color.accent.$root`), holding the canonical token, and one per
//            group's own properties, keyed `<path>/$group` (`/$group` for the file's root). A token is the unit of merge.
//   `law`    the `DESIGN.md` source as text, edited by character diff so a concurrent edit elsewhere survives.
//   `files`  attributes: canon path to source text, replaced whole; also Claude's files under `sources/claude/`, which
//            an import keeps read-only.
// Generated files are never stored: `readFiles` derives `tokens.css` and `office-theme.json` from the tokens. Assets are
// the store's (`artifact_upload_asset`). The publish is the kind's part of A's three layers (the P3-A document's Decision
// Log 10): token-, hunk- and file-level conflicts, all or nothing; layer 1 (`baseRevision`) is A's.
import diff from 'fast-diff';
import { transact, type Doc, type Node } from '../yjs';
import { CANON_LIMITS, canonKind, validateCanon, type HtmlParser } from './canon';
import { CLAUDE_SOURCES, ClaudeShapeError, fromClaude, isClaudeShape } from './claude';
import { generateTokensCss } from './css';
import { LAW_LIMIT_BYTES, parseLaw } from './law';
import { officeTheme } from './office';
import { comparePaths } from './roles';
import { parseTokens, serializeTokens, validateTokenFile, type GroupProps, type Token, type TokenSet } from './tokens';

import type { KindAdapter } from '../host';

export const FORMAT_VERSION = 1;
const UNTITLED = 'Untitled design system';
export const LAW_PATH = 'DESIGN.md';
export const TOKENS_PATH = 'tokens.tokens.json';
/** The files `readFiles` derives from the tokens: read by the agent, never sent back. */
export const GENERATED_PATHS = ['tokens.css', 'office-theme.json'] as const;
export const isGeneratedPath = (path: string): boolean => (GENERATED_PATHS as readonly string[]).includes(path);

export type OriginRoute = 'default' | 'adopted' | 'derived' | 'imported' | 'blank';
/** How a system came to exist: `key` names a bundled default, `from` the system it was adopted or imported from. */
export interface SystemOrigin {
  route: OriginRoute;
  key?: string;
  from?: string;
  at: number;
}
export interface SystemMeta {
  formatVersion: typeof FORMAT_VERSION;
  name: string;
  origin: SystemOrigin;
  persona?: string;
}
export interface SystemState {
  /** Null while the doc holds no system (not yet written or not yet synced). */
  meta: SystemMeta | null;
  tokens: TokenSet;
  law: string;
  /** Canon and kept sources by path, in path order. */
  files: Record<string, string>;
}

export interface FileProblem {
  path: string;
  message: string;
}
/** Files the model cannot hold, each problem named by its path. `code` and `data` are the store's refusal shape. */
export class SystemFilesError extends Error {
  readonly code = 'invalid';
  readonly data: { problems: FileProblem[] };
  constructor(readonly problems: FileProblem[]) {
    super(`the design system's files were refused: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    this.name = 'SystemFilesError';
    this.data = { problems };
  }
}

export interface SystemWriteOptions {
  /** With a parser, canon files are checked structurally (`validateCanon`); without one, only their paths and limits. */
  parser?: HtmlParser;
}

// --- The layout ------------------------------------------------------------------------------------------------------

const GROUP = '/$group';
const groupKey = (path: string) => `${path}${GROUP}`;
const roots = (doc: Doc) => ({ meta: doc.get('meta'), tokens: doc.get('tokens'), law: doc.get('law'), files: doc.get('files') });
/** A JSON-clean copy (no undefined members), as a Yjs attribute holds it. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One entry per token and per group, keyed as the `tokens` node keys them. */
function entriesOf(set: TokenSet): Map<string, Token | GroupProps> {
  const entries = new Map<string, Token | GroupProps>();
  for (const [path, token] of set.tokens) entries.set(path, token);
  for (const [path, props] of set.groups) entries.set(groupKey(path), props);
  return entries;
}

function tokenSetOf(node: Node): TokenSet {
  const tokens: [string, Token][] = [];
  const groups: [string, GroupProps][] = [];
  for (const [key, value] of node.attrEntries() as IterableIterator<[string, unknown]>) {
    if (key.endsWith(GROUP)) groups.push([key.slice(0, -GROUP.length), value as GroupProps]);
    else tokens.push([key, value as Token]);
  }
  const byPath = <T>(list: [string, T][]) => new Map(list.sort(([a], [b]) => comparePaths(a, b)));
  return { tokens: byPath(tokens), groups: byPath(groups) };
}

const lawOf = (node: Node): string =>
  node
    .toArray()
    .filter((part): part is string => typeof part === 'string')
    .join('');

/** The stored meta with the law's title and persona read off the (converged) law. */
function metaOf(node: Node, law: string): SystemMeta | null {
  const formatVersion = node.getAttr('formatVersion');
  if (formatVersion === undefined) return null;
  const { title, persona } = parseLaw(law);
  const name = title ?? (node.getAttr('name') as string | undefined) ?? UNTITLED;
  return { formatVersion: formatVersion as typeof FORMAT_VERSION, name, origin: node.getAttr('origin') as SystemOrigin, ...(persona ? { persona } : {}) };
}

// --- Reading ---------------------------------------------------------------------------------------------------------

export function readSystem(doc: Doc): SystemState {
  const r = roots(doc);
  const files: Record<string, string> = {};
  for (const key of [...r.files.attrKeys()].map(String).sort()) files[key] = r.files.getAttr(key) as string;
  const law = lawOf(r.law);
  return { meta: metaOf(r.meta, law), tokens: tokenSetOf(r.tokens), law, files };
}

/**
 * The agent's file view: `DESIGN.md` (when the system has a law), `tokens.tokens.json` in canonical form, every canon
 * file and kept source, then the generated `tokens.css` (the `:root` document form) and `office-theme.json` (when the
 * tokens resolve every slot Office needs).
 */
export function readFiles(doc: Doc): Record<string, string> {
  const system = readSystem(doc);
  const out: Record<string, string> = {};
  if (system.law) out[LAW_PATH] = system.law;
  out[TOKENS_PATH] = serializeTokens(system.tokens);
  Object.assign(out, system.files);
  out['tokens.css'] = generateTokensCss(system.tokens);
  try {
    out['office-theme.json'] = `${JSON.stringify(officeTheme(system.tokens), null, 2)}\n`;
  } catch {
    // A system mid-edit on the page may not resolve every slot; the theme comes back when it does.
  }
  return out;
}

// --- Checking what is sent -------------------------------------------------------------------------------------------

const byteLength = (text: string) => new TextEncoder().encode(text).length;
const SYSTEM_PATHS = 'a system holds DESIGN.md, tokens.tokens.json, layouts/<name>.html, components/<name>.html and components/document.css';

/** Why a path cannot be written by an author (the agent or a create), or null. */
function pathProblem(path: string, value: string | null): string | null {
  if (path === LAW_PATH || path === TOKENS_PATH) return value === null ? 'cannot be removed' : null;
  if (isGeneratedPath(path)) return `generated from ${TOKENS_PATH}; read it, never send it`;
  if (path.startsWith(CLAUDE_SOURCES)) return 'kept read-only from the Claude import';
  if (path.startsWith('assets/')) return 'an asset: upload it with artifact_upload_asset and refer to it as assets/<name>';
  const kind = canonKind(path);
  if (kind === 'stray') return 'not a canon path: layouts are layouts/<name>.html, components components/<name>.html or components/document.css';
  if (kind === null) return `not a design-system file; ${SYSTEM_PATHS}`;
  return null;
}

/**
 * Where the entries could not be one token file: a token where a group is, or beneath another token. The serializer
 * writes such a pair as two equal JSON keys, and a read keeps only one, so it is caught on the model, before any text.
 */
function hierarchyProblems(entries: ReadonlyMap<string, unknown>): string[] {
  const tokens = [...entries.keys()].filter((key) => !key.endsWith(GROUP));
  const groups = [...entries.keys()].filter((key) => key.endsWith(GROUP)).map((key) => key.slice(0, -GROUP.length));
  const problems: string[] = [];
  for (const path of tokens) {
    const below = `${path}.`;
    const inside = [...tokens.filter((other) => other.startsWith(below)), ...groups.filter((group) => group === path || group.startsWith(below))];
    if (inside.length) problems.push(`the token ${path} and ${[...new Set(inside)].sort(comparePaths).join(', ')} cannot both exist: a token holds no tokens or groups`);
  }
  return problems;
}

/** A token file read and fully checked, or its problems named by token path. */
function readTokenFile(text: string): { set: TokenSet | null; problems: FileProblem[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { set: null, problems: [{ path: TOKENS_PATH, message: `not JSON: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const checked = validateTokenFile(json);
  const problems = checked.problems.map((p) => ({ path: TOKENS_PATH, message: `${p.path || '(the root)'}: ${p.message}` }));
  for (const path of checked.tokens?.tokens.keys() ?? []) {
    if (path.endsWith(GROUP)) problems.push({ path: TOKENS_PATH, message: `${path}: a token's name may not end with "${GROUP}"` });
  }
  return { set: problems.length ? null : checked.tokens, problems };
}

function lawProblems(law: string): FileProblem[] {
  const size = byteLength(law);
  return size > LAW_LIMIT_BYTES ? [{ path: LAW_PATH, message: `${size} bytes; the law holds at most ${LAW_LIMIT_BYTES}` }] : [];
}

/** The canon's limits over the files the system would hold, and each written file's structure (with a parser) or size. */
function canonProblems(result: Readonly<Record<string, string>>, written: Readonly<Record<string, string>>, tokens: TokenSet, parser?: HtmlParser): FileProblem[] {
  const problems: FileProblem[] = [];
  const count = Object.keys(result).filter((path) => canonKind(path) !== null).length;
  if (count > CANON_LIMITS.files) problems.push({ path: '', message: `${count} canon files; a system holds at most ${CANON_LIMITS.files}` });
  if (parser) {
    problems.push(...validateCanon(written, parser, tokens).filter((p) => p.path !== ''));
  } else {
    for (const [path, text] of Object.entries(written)) {
      const size = byteLength(text);
      if (size > CANON_LIMITS.fileBytes) problems.push({ path, message: `${size} bytes; a canon file holds at most ${CANON_LIMITS.fileBytes}` });
    }
  }
  return problems;
}

// --- Writing ---------------------------------------------------------------------------------------------------------

/**
 * Writes a whole system into `doc` (a create, a seeded default, an import), replacing whatever it held, in one
 * transaction; or refuses with every problem and writes nothing. Files in Claude's shape are converted (D12): the
 * tokens from Claude's list form, Claude's files kept under `sources/claude/`, no law, the origin `imported` from the
 * system's title. The name is the law's title, read off the law on every read; a system whose law has no title stores
 * `options.name`, else Claude's title, once. Returns the name and the import's
 * warnings.
 */
export function writeSystem(doc: Doc, files: Readonly<Record<string, string>>, origin: SystemOrigin, options: SystemWriteOptions & { name?: string } = {}): { name: string; warnings: string[] } {
  const law = files[LAW_PATH] ?? '';
  let set: TokenSet | null = null;
  let canon: Record<string, string> = {};
  let warnings: string[] = [];
  let claudeTitle: string | null = null;
  const problems: FileProblem[] = [];

  if (isClaudeShape(files)) {
    try {
      const imported = fromClaude(files);
      set = imported.tokens;
      canon = imported.sources;
      warnings = imported.warnings;
      claudeTitle = imported.title;
      origin = { ...origin, route: 'imported', ...(imported.title && !origin.from ? { from: imported.title } : {}) };
    } catch (error) {
      if (!(error instanceof ClaudeShapeError)) throw error;
      problems.push(...error.reasons.map((reason) => ({ path: 'tokens.json', message: reason })));
    }
  } else {
    for (const [path, text] of Object.entries(files)) {
      const problem = pathProblem(path, text);
      if (problem) problems.push({ path, message: problem });
      else if (path !== LAW_PATH && path !== TOKENS_PATH) canon[path] = text;
    }
    const tokenText = files[TOKENS_PATH];
    if (tokenText === undefined) problems.push({ path: TOKENS_PATH, message: `missing; every system has a token file with every role` });
    else {
      const read = readTokenFile(tokenText);
      set = read.set;
      problems.push(...read.problems);
    }
    problems.push(...lawProblems(law));
  }
  if (set) problems.push(...canonProblems(canon, Object.fromEntries(Object.entries(canon).filter(([path]) => canonKind(path) !== null)), set, options.parser));
  if (problems.length || !set) throw new SystemFilesError(problems);

  const tokens = set;
  const lawTitle = parseLaw(law).title;
  const name = lawTitle ?? options.name ?? claudeTitle ?? UNTITLED;
  const r = roots(doc);
  transact(doc, () => {
    r.meta.clearAttrs();
    r.meta.setAttr('formatVersion', FORMAT_VERSION);
    r.meta.setAttr('origin', plain(origin));
    if (!lawTitle) r.meta.setAttr('name', name);
    r.tokens.clearAttrs();
    for (const [key, value] of entriesOf(tokens)) r.tokens.setAttr(key, plain(value));
    applyHunks(r.law, hunks(lawOf(r.law), law));
    r.files.clearAttrs();
    for (const path of Object.keys(canon).sort()) r.files.setAttr(path, canon[path]!);
  });
  return { name, warnings };
}

/**
 * The page's edit of one token: `token` as the canonical object (`$value` in its object form), or null to remove it.
 * One attribute, one transaction: the token's authorship stays per token.
 */
export function setToken(doc: Doc, path: string, token: Token | null): void {
  if (path.endsWith(GROUP)) throw new SystemFilesError([{ path: TOKENS_PATH, message: `${path}: a token's name may not end with "${GROUP}"` }]);
  const node = roots(doc).tokens;
  if (token) {
    const keys = [...node.attrKeys()].map(String);
    const holder = keys.find((key) => !key.endsWith(GROUP) && path.startsWith(`${key}.`));
    const inside = keys.filter((key) => key !== path && (key === groupKey(path) || key.startsWith(`${path}.`)));
    if (holder) throw new SystemFilesError([{ path: TOKENS_PATH, message: `${path}: the token ${holder} cannot hold a token` }]);
    if (inside.length) {
      const names = [...new Set(inside.map((key) => (key.endsWith(GROUP) ? key.slice(0, -GROUP.length) : key)))].sort(comparePaths);
      throw new SystemFilesError([{ path: TOKENS_PATH, message: `${path}: ${names.join(', ')} already there; a token holds no tokens or groups` }]);
    }
  }
  transact(doc, () => (token ? node.setAttr(path, plain(token)) : node.deleteAttr(path)));
}

/** The law replaced by `text`, written as the character diff from the current law. */
export function setLaw(doc: Doc, text: string): void {
  const problems = lawProblems(text);
  if (problems.length) throw new SystemFilesError(problems);
  const node = roots(doc).law;
  transact(doc, () => applyHunks(node, hunks(lawOf(node), text)));
}

/** A canon file replaced whole, or removed with null; bounded as create and publish are (with a parser, checked too). */
export function setFile(doc: Doc, path: string, text: string | null, options: SystemWriteOptions = {}): void {
  const problem = path === LAW_PATH || path === TOKENS_PATH ? `not a canon file; edit it with ${path === LAW_PATH ? 'setLaw' : 'setToken'}` : pathProblem(path, text);
  if (problem) throw new SystemFilesError([{ path, message: problem }]);
  if (text !== null) {
    const state = readSystem(doc);
    const problems = canonProblems({ ...state.files, [path]: text }, { [path]: text }, state.tokens, options.parser);
    if (problems.length) throw new SystemFilesError(problems);
  }
  const node = roots(doc).files;
  transact(doc, () => (text === null ? node.deleteAttr(path) : node.setAttr(path, text)));
}

// --- The law's hunks -------------------------------------------------------------------------------------------------

/** One change from a text `a` to `b`: `a`'s range [start, end) replaced by `text`. */
interface Hunk {
  start: number;
  end: number;
  text: string;
}

/** The hunks from `a` to `b`, in order, from a character diff cleaned up to word-sized runs. */
function hunks(a: string, b: string): Hunk[] {
  const out: Hunk[] = [];
  let at = 0;
  let open: Hunk | null = null;
  for (const [op, text] of diff(a, b, undefined, true)) {
    if (op === diff.EQUAL) {
      if (open) out.push(open);
      open = null;
      at += text.length;
      continue;
    }
    open ??= { start: at, end: at, text: '' };
    if (op === diff.DELETE) open.end = at += text.length;
    else open.text += text;
  }
  if (open) out.push(open);
  return out;
}

/** Writes hunks (in the node's own coordinates, in order) last first, so each index still holds when it is reached. */
function applyHunks(node: Node, list: readonly Hunk[]): void {
  for (const hunk of [...list].reverse()) {
    if (hunk.end > hunk.start) node.delete(hunk.start, hunk.end - hunk.start);
    if (hunk.text) node.insert(hunk.start, hunk.text);
  }
}

function spliced(text: string, list: readonly Hunk[]): string {
  let out = text;
  for (const hunk of [...list].reverse()) out = out.slice(0, hunk.start) + hunk.text + out.slice(hunk.end);
  return out;
}

/**
 * Two hunks over one base collide when their ranges share a character, or when one is an insertion inside or at the
 * edge of the other (two insertions at one place, or one beside a replacement, have no order both sides agreed on).
 */
const collide = (a: Hunk, b: Hunk): boolean => (a.start === a.end || b.start === b.end ? a.start <= b.end && b.start <= a.end : a.start < b.end && b.start < a.end);
const sameHunk = (a: Hunk, b: Hunk) => a.start === b.start && a.end === b.end && a.text === b.text;

const delta = (hunk: Hunk) => hunk.text.length - (hunk.end - hunk.start);

/**
 * The agent's base-to-sent hunks rebased over the live doc's base-to-live hunks. Each agent hunk is grouped with the
 * live hunks it collides with, transitively (a cluster). A cluster without live hunks shifts into live coordinates; a
 * cluster with them is a collision, its base range returned, unless `force`: then the agent wins there, the cluster's
 * whole range written as the agent's text, and every live hunk outside a cluster stays. A hunk both sides made
 * identically is already in place.
 */
function rebaseLaw(base: string, sent: string, live: string, force: boolean): { apply: Hunk[]; result: string; collisions: Hunk[] } {
  const theirs = hunks(base, live);
  const mine = hunks(base, sent).filter((hunk) => !theirs.some((other) => sameHunk(hunk, other)));
  let clusters: { mine: Hunk[]; theirs: Hunk[] }[] = [];
  for (const hunk of mine) {
    const hits = theirs.filter((other) => collide(hunk, other));
    const joined = clusters.filter((cluster) => cluster.theirs.some((other) => hits.includes(other)));
    clusters = clusters.filter((cluster) => !joined.includes(cluster));
    clusters.push({ mine: [...joined.flatMap((c) => c.mine), hunk], theirs: [...new Set([...joined.flatMap((c) => c.theirs), ...hits])] });
  }
  const spanOf = (cluster: { mine: Hunk[]; theirs: Hunk[] }): Hunk => {
    const all = [...cluster.mine, ...cluster.theirs];
    return { start: Math.min(...all.map((h) => h.start)), end: Math.max(...all.map((h) => h.end)), text: '' };
  };
  const collisions = clusters.filter((cluster) => cluster.theirs.length).map(spanOf);
  if (collisions.length && !force) return { apply: [], result: live, collisions };
  const apply = clusters
    .map((cluster): Hunk => {
      const span = spanOf(cluster);
      // Live coordinates: every live hunk before the cluster moved it; the cluster's own are inside its range.
      const shift = theirs.filter((other) => other.end <= span.start && !cluster.theirs.includes(other)).reduce((sum, other) => sum + delta(other), 0);
      const local = cluster.mine.map((hunk) => ({ ...hunk, start: hunk.start - span.start, end: hunk.end - span.start }));
      const text = spliced(base.slice(span.start, span.end), local);
      return { start: span.start + shift, end: span.end + shift + cluster.theirs.reduce((sum, other) => sum + delta(other), 0), text };
    })
    .sort((a, b) => a.start - b.start);
  return { apply, result: spliced(live, apply), collisions: [] };
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
function linesOf(base: string, hunk: Hunk): string {
  const first = lineAt(base, hunk.start);
  const last = lineAt(base, Math.max(hunk.start, hunk.end - 1));
  return first === last ? `line ${first}` : `lines ${first} to ${last}`;
}

// --- Publish ---------------------------------------------------------------------------------------------------------

export interface PublishResult {
  changed: string[];
  conflicts: { path: string; detail?: string }[];
}

/** A stable text of a JSON value, keys sorted, so equal tokens compare equal however their keys were ordered. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => (a === undefined || b === undefined ? a === b : stable(a) === stable(b));

/** The token file's entries as an author reads them: the canonical file read back, so equality is by meaning. */
function readEntries(text: string | undefined): Map<string, Token | GroupProps> {
  const set = text === undefined ? null : parseTokens(text).tokens;
  return set ? entriesOf(set) : new Map();
}

function describeKey(key: string): string {
  if (key === GROUP) return "the token file's root properties";
  return key.endsWith(GROUP) ? `the group ${key.slice(0, -GROUP.length)}'s properties` : `the token ${key}`;
}

/**
 * Publishes the agent's files over the live doc (the kind's layers 2 and 3 of A's Decision Log 10). `base` is the file
 * view at the agent's last read, `sent` the files it sends (`null` removes a canon file).
 * - The token file merges token by token (and group by group): a token the agent changed lands unless the live doc
 *   changed it too, to another value; the merged file must still validate.
 * - The law merges by hunks: the agent's hunks land unless one collides with a live change since the base.
 * - A canon file is replaced or removed whole, unless it changed live since the base.
 * Any conflict refuses the whole publish, naming each one, and writes nothing. `force` makes the agent win on the units
 * both sides changed (a token, a law hunk, a canon file); everything else still merges (Decision Log 12). A merged token
 * file that cannot be held (a token where a group is) conflicts even under `force`: no winner makes it representable.
 * Files that cannot be held (a generated or read-only file, a path outside the system, an invalid token file, a limit)
 * throw `SystemFilesError` before anything is written, with or without `force`. One transaction writes everything.
 */
export function publishSystem(live: Doc, base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>, force: boolean, options: SystemWriteOptions = {}): PublishResult {
  const problems: FileProblem[] = [];
  for (const [path, text] of Object.entries(sent)) {
    const problem = pathProblem(path, text);
    if (problem) problems.push({ path, message: problem });
  }
  const tokenText = sent[TOKENS_PATH];
  const sentTokens = typeof tokenText === 'string' ? readTokenFile(tokenText) : null;
  if (sentTokens) problems.push(...sentTokens.problems);
  if (problems.length) throw new SystemFilesError(problems);

  const state = readSystem(live);
  const conflicts: PublishResult['conflicts'] = [];
  const changed: string[] = [];

  // The law.
  let lawHunks: Hunk[] | null = null;
  const lawText = sent[LAW_PATH];
  if (typeof lawText === 'string') {
    const rebased = rebaseLaw(base[LAW_PATH] ?? '', lawText, state.law, force);
    if (rebased.collisions.length) {
      for (const span of rebased.collisions) conflicts.push({ path: LAW_PATH, detail: `${linesOf(base[LAW_PATH] ?? '', span)} of your read changed since, where you changed them too` });
    } else {
      problems.push(...lawProblems(rebased.result));
      if (rebased.apply.length) {
        lawHunks = rebased.apply;
        changed.push(LAW_PATH);
      }
    }
  }

  // The tokens.
  const tokenWrites = new Map<string, Token | GroupProps | null>();
  let merged = state.tokens;
  if (sentTokens?.set) {
    const mine = entriesOf(sentTokens.set);
    const theirs = readEntries(serializeTokens(state.tokens));
    const before = readEntries(base[TOKENS_PATH]);
    const keys = new Set([...mine.keys(), ...theirs.keys(), ...before.keys()]);
    const tokenConflicts: string[] = [];
    for (const key of keys) {
      const sentValue = mine.get(key);
      const liveValue = theirs.get(key);
      if (same(sentValue, liveValue)) continue;
      if (same(sentValue, before.get(key))) continue; // the agent left it as it read it, even under force
      if (!same(liveValue, before.get(key)) && !force) {
        tokenConflicts.push(key);
        continue;
      }
      tokenWrites.set(key, sentValue ?? null); // the agent's change; under force it wins a token both sides changed
    }
    for (const key of tokenConflicts.sort(comparePaths)) conflicts.push({ path: TOKENS_PATH, detail: `${describeKey(key)} changed since your read, and you changed it too` });
    if (!tokenConflicts.length && tokenWrites.size) {
      const entries = entriesOf(state.tokens);
      for (const [key, value] of tokenWrites) {
        if (value) entries.set(key, value);
        else entries.delete(key);
      }
      merged = tokenSetOfEntries(entries);
      // No winner makes these representable, so they conflict under force too; only a holdable file is serialized.
      const shape = hierarchyProblems(entries);
      for (const problem of shape) conflicts.push({ path: TOKENS_PATH, detail: `merged with the live tokens, ${problem}` });
      if (!shape.length) {
        for (const problem of readTokenFile(serializeTokens(merged)).problems) conflicts.push({ path: TOKENS_PATH, detail: `merged with the live tokens, ${problem.message}` });
      }
      changed.push(TOKENS_PATH);
    }
  }

  // The canon.
  const canonWrites = new Map<string, string | null>();
  for (const path of Object.keys(sent).sort()) {
    if (path === LAW_PATH || path === TOKENS_PATH) continue;
    const mine = sent[path] ?? undefined;
    const theirs = state.files[path];
    if (mine === theirs) continue;
    if (mine === base[path]) continue; // sent as read: not the agent's change, even under force
    if (theirs !== base[path] && !force) {
      conflicts.push({ path, detail: theirs === undefined ? 'removed since your read' : base[path] === undefined ? 'created since your read' : 'changed since your read' });
      continue;
    }
    canonWrites.set(path, mine ?? null);
    changed.push(path);
  }
  const files = { ...state.files };
  for (const [path, text] of canonWrites) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  const written = Object.fromEntries([...canonWrites].filter((entry): entry is [string, string] => entry[1] !== null));
  problems.push(...canonProblems(files, written, merged, options.parser));

  if (problems.length) throw new SystemFilesError(problems);
  if (conflicts.length) return { changed: [], conflicts };
  if (!changed.length) return { changed, conflicts };

  const r = roots(live);
  transact(live, () => {
    if (lawHunks) applyHunks(r.law, lawHunks);
    for (const [key, value] of tokenWrites) {
      if (value) r.tokens.setAttr(key, plain(value));
      else r.tokens.deleteAttr(key);
    }
    for (const [path, text] of canonWrites) {
      if (text === null) r.files.deleteAttr(path);
      else r.files.setAttr(path, text);
    }
  });
  return { changed, conflicts };
}

function tokenSetOfEntries(entries: ReadonlyMap<string, Token | GroupProps>): TokenSet {
  const tokens = new Map<string, Token>();
  const groups = new Map<string, GroupProps>();
  for (const [key, value] of entries) {
    if (key.endsWith(GROUP)) groups.set(key.slice(0, -GROUP.length), value as GroupProps);
    else tokens.set(key, value as Token);
  }
  return { tokens, groups };
}

// --- The kind adapter ------------------------------------------------------------------------------------------------

/** The `design_system` kind's adapter for A's document service; with a parser its publish checks canon structure. */
export function createDesignSystemAdapter(options: SystemWriteOptions = {}): KindAdapter {
  return {
    kind: 'design_system',
    readFiles,
    publish: (live, base, sent, force) => publishSystem(live, base, sent, force, options),
  };
}
export const designSystemAdapter: KindAdapter = createDesignSystemAdapter();
