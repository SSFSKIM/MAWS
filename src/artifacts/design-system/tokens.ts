// The token file, `tokens.tokens.json` (D1, D2): W3C DTCG 2025.10 (designtokens.org/tr/2025.10/format). Reading is
// lenient and writing canonical: `parseTokens` reads the file into a `TokenSet` (one entry per token path and per
// group), `serializeTokens` writes it back in canonical form (a fixed point after one pass), `validateTokenFile` runs
// the whole check (structure, values, references, the roles, the CSS names, the limits) and names every problem by its
// path. Resolution (aliases, `$ref` pointers, `$extends`, `$type` inheritance) is `resolve.ts`'s.
import { DECK_KEY, OFFICE_KEY, PAGE_KEY, readExtensions } from './extensions';
import { resolveTokens, resolveValueAgainst, type ResolvedTokens } from './resolve';
import { comparePaths, cssNamesOf, ROLES, splitPath } from './roles';
import { aliasPath, FAIL, isAlias, isPointer, isTokenType, KEEP, normalizeValue, pointerAsAlias, pointerSegments, type RefHandler, type TokenType } from './values';

/** One token as written (canonical): its value keeps its references. `$type` only when the token sets it itself. */
export interface Token {
  $type?: TokenType;
  $value: unknown;
  $description?: string;
  $deprecated?: boolean | string;
  $extensions?: Record<string, unknown>;
}

/** A group's own properties. `$extends` is an alias to another group (`"{path}"`); `$schema` only on the root. */
export interface GroupProps {
  $schema?: string;
  $type?: TokenType;
  $description?: string;
  $extends?: string;
  $deprecated?: boolean | string;
  $extensions?: Record<string, unknown>;
}

/** A token file as data: tokens by path (`color.accent.$root`), groups by path (`''` is the file's root). */
export interface TokenSet {
  readonly tokens: ReadonlyMap<string, Token>;
  readonly groups: ReadonlyMap<string, GroupProps>;
}

/** A problem, at a token's or group's path (`''` for the file itself). */
export interface TokenProblem {
  path: string;
  message: string;
}

export { comparePaths, cssIdent, cssNamesOf, ROLES, splitPath, TYPE_ROLES, type Role, type TypeRole } from './roles';

// --- Reading ---------------------------------------------------------------------------------------------------------

const parentPath = (path: string) => splitPath(path).slice(0, -1).join('.');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const TOKEN_PROPS = new Set(['$type', '$value', '$description', '$deprecated', '$extensions']);
const GROUP_PROPS = new Set(['$type', '$description', '$extends', '$deprecated', '$extensions']);

/** The parse keeps every reference as written. */
const keepingHandler = (path: string, problems: TokenProblem[]): RefHandler => ({
  mode: 'parse',
  alias: (alias) => alias,
  pointer: () => KEEP,
  problem: (message) => problems.push({ path, message }),
});

function navigate(root: unknown, segments: readonly string[]): unknown {
  let node = root;
  for (const segment of segments) {
    if (Array.isArray(node) && /^\d+$/.test(segment)) node = node[Number(segment)];
    else if (isObject(node) && Object.hasOwn(node, segment)) node = node[segment];
    else return undefined;
  }
  return node;
}

function badName(name: string): string | null {
  if (name === '') return 'an empty name';
  if (name.startsWith('$') && name !== '$root') return null; // a property, handled by the caller
  if (/[{}.]/.test(name)) return `name ${JSON.stringify(name)} must not contain "{", "}" or "."`;
  return null;
}

/**
 * Reads a token file (JSON text or parsed JSON). `tokens` is null only when the input is not a JSON object; otherwise
 * it holds every token and group that read cleanly, and `problems` names the rest.
 */
export function parseTokens(input: unknown): { tokens: TokenSet | null; problems: TokenProblem[] } {
  const problems: TokenProblem[] = [];
  let root = input;
  if (typeof input === 'string') {
    try {
      root = JSON.parse(input);
    } catch (error) {
      return { tokens: null, problems: [{ path: '', message: `not JSON: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
  if (!isObject(root)) return { tokens: null, problems: [{ path: '', message: 'a token file is a JSON object of groups and tokens' }] };

  const tokens = new Map<string, Token>();
  const groups = new Map<string, GroupProps>();
  const problem = (path: string, message: string) => problems.push({ path, message });

  // `$ref` on an object without `$value` (the format's §6.4.1, §6.6.2): `#/…/$value` and a pointer to a token object are
  // that token's alias; a pointer to a group is `$extends`; a pointer into a value is a property reference.
  const classifyRef = (node: Record<string, unknown>): { alias: string } | { extends: string } | { pointer: string } | { error: string } => {
    const pointer = node.$ref;
    if (typeof pointer !== 'string') return { error: '$ref must be a JSON pointer string' };
    const alias = pointerAsAlias(pointer);
    if (alias) return { alias };
    const segments = pointerSegments(pointer);
    if (!segments) return { error: `the pointer ${JSON.stringify(pointer)} must start with "#/" (a place in this file)` };
    if (segments.includes('$value')) return { pointer };
    const target = navigate(root, segments);
    if (!isObject(target)) return { error: `the pointer ${JSON.stringify(pointer)} reaches no token or group` };
    const path = `{${segments.join('.')}}`;
    return '$value' in target || ('$ref' in target && !hasChildren(target)) ? { alias: path } : { extends: path };
  };
  const hasChildren = (node: Record<string, unknown>) => Object.keys(node).some((key) => !key.startsWith('$') || key === '$root');

  const readToken = (path: string, node: Record<string, unknown>, inherited: TokenType | undefined) => {
    const before = problems.length;
    const token: Token = { $value: undefined };
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$') || key === '$root') problem(path, `a token cannot hold children: it has both $value and child "${key}"`);
      else if (!TOKEN_PROPS.has(key)) problem(path, `unknown property "${key}" on a token`);
    }
    let type: TokenType | undefined;
    if ('$type' in node) {
      if (isTokenType(node.$type)) type = token.$type = node.$type;
      else problem(path, `unknown $type ${JSON.stringify(node.$type)}`);
    }
    const effective = type ?? inherited;
    const raw = node.$value;
    if (isAlias(raw)) token.$value = raw;
    else if (isPointer(raw) && pointerAsAlias(raw.$ref)) token.$value = pointerAsAlias(raw.$ref);
    else if (isPointer(raw) && !effective) token.$value = raw; // a property pointer takes its type when resolved, or fails there
    else if (!('$type' in node) && !effective) problem(path, 'no $type: set one on the token or on a group above it');
    else if (effective) {
      const value = normalizeValue(effective, raw, '$value', keepingHandler(path, problems));
      if (value !== FAIL) token.$value = value;
    }
    if ('$description' in node) {
      if (typeof node.$description === 'string') token.$description = node.$description;
      else problem(path, '$description must be a string');
    }
    if ('$deprecated' in node) {
      if (typeof node.$deprecated === 'boolean' || typeof node.$deprecated === 'string') token.$deprecated = node.$deprecated;
      else problem(path, '$deprecated must be true, false or a string');
    }
    if ('$extensions' in node) {
      if (!isObject(node.$extensions)) problem(path, '$extensions must be an object');
      else {
        const extensions = readExtensions(node.$extensions, keepingHandler(path, problems));
        if (extensions !== FAIL) token.$extensions = extensions;
      }
    }
    if (problems.length === before) tokens.set(path, token);
  };

  const pending: [string, Record<string, unknown>][] = []; // tokens, read once every group's type is known
  const readGroup = (path: string, node: Record<string, unknown>) => {
    const props: GroupProps = {};
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$') || key === '$root' || key === '$ref') continue;
      if (key === '$schema' && path === '') {
        if (typeof node.$schema === 'string') props.$schema = node.$schema;
        else problem(path, '$schema must be a string');
      } else if (!GROUP_PROPS.has(key)) problem(path, `unknown property "${key}" on a group`);
    }
    if ('$type' in node) {
      if (isTokenType(node.$type)) props.$type = node.$type;
      else problem(path, `unknown $type ${JSON.stringify(node.$type)}`);
    }
    if ('$description' in node) {
      if (typeof node.$description === 'string') props.$description = node.$description;
      else problem(path, '$description must be a string');
    }
    let extendsRef: unknown = node.$extends;
    if ('$ref' in node) {
      const kind = classifyRef(node);
      if ('extends' in kind) extendsRef = kind.extends;
      else problem(path, 'error' in kind ? kind.error : `$ref on a group must name a group`);
    }
    if (extendsRef !== undefined) {
      const pointer = typeof extendsRef === 'string' ? pointerSegments(extendsRef) : null;
      if (isAlias(extendsRef)) props.$extends = extendsRef;
      else if (pointer) props.$extends = `{${pointer.join('.')}}`;
      else problem(path, '$extends must name a group, as "{group.path}"');
    }
    if ('$deprecated' in node) {
      if (typeof node.$deprecated === 'boolean' || typeof node.$deprecated === 'string') props.$deprecated = node.$deprecated;
      else problem(path, '$deprecated must be true, false or a string');
    }
    if ('$extensions' in node) {
      if (!isObject(node.$extensions)) problem(path, '$extensions must be an object');
      else {
        const extensions = readExtensions(node.$extensions, keepingHandler(path, problems));
        if (extensions !== FAIL) props.$extensions = extensions;
      }
    }
    groups.set(path, props);
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith('$') && name !== '$root') continue;
      const nameProblem = badName(name);
      if (nameProblem) {
        problem(path, nameProblem);
        continue;
      }
      const childPath = path === '' ? name : `${path}.${name}`;
      if (!isObject(child)) {
        problem(childPath, `neither a token nor a group: ${Array.isArray(child) ? 'a list' : JSON.stringify(child)}`);
        continue;
      }
      let token: Record<string, unknown> | null = '$value' in child ? child : null;
      if (!token && '$ref' in child && !hasChildren(child)) {
        const kind = classifyRef(child);
        if ('error' in kind) {
          problem(childPath, kind.error);
          continue;
        }
        // A token written as a pointer is read as the token with that value: the alias it equals, or the pointer itself.
        const rest = { ...child };
        delete rest.$ref;
        if ('alias' in kind) token = { ...rest, $value: kind.alias };
        else if ('pointer' in kind) token = { ...rest, $value: { $ref: kind.pointer } };
      }
      if (token) pending.push([childPath, token]);
      else if (name === '$root') problem(childPath, '$root names a group’s base token, so it must be a token (an object with $value)');
      else readGroup(childPath, child);
    }
  };
  readGroup('', root);

  // A group's own type after extension (§6.7.3): its $type, else what the nearest extending group (itself or an
  // ancestor) inherits at its place from the group it extends. resolve.ts's merged groups give the same answer.
  const ownType = (path: string, seen: Set<string>): TokenType | undefined => {
    if (seen.has(path)) return undefined; // a cycle; resolve.ts reports it
    seen.add(path);
    const own = groups.get(path)?.$type;
    if (own) return own;
    for (let at = path; ; at = parentPath(at)) {
      const ref = groups.get(at)?.$extends;
      if (ref) {
        const rel = path.slice(at.length).replace(/^\./, '');
        const counterpart = [aliasPath(ref), rel].filter(Boolean).join('.');
        return groups.has(counterpart) ? ownType(counterpart, seen) : undefined;
      }
      if (at === '') return undefined;
    }
  };
  // A token's inherited type: the closest group above it with one.
  const groupType = (path: string): TokenType | undefined => {
    for (let at = path; ; at = parentPath(at)) {
      const type = ownType(at, new Set());
      if (type || at === '') return type;
    }
  };
  for (const [path, node] of pending) readToken(path, node, groupType(parentPath(path)));
  return { tokens: { tokens, groups }, problems };
}

// --- Writing ---------------------------------------------------------------------------------------------------------

const WIDTH = 120;
const TOKEN_ORDER = ['$type', '$value', '$description', '$deprecated', '$extensions'] as const;
const GROUP_ORDER = ['$schema', '$type', '$description', '$extends', '$deprecated', '$extensions'] as const;

// An ordered JSON tree: groups, tokens and extension data are entry lists, so a key such as "1" keeps its place (a
// plain object would move integer-like keys first). `expand` writes one entry per line however short it is.
class Ordered {
  constructor(
    readonly entries: [string, unknown][] = [],
    readonly expand = false,
  ) {}
}

// Extension data is written with its keys sorted at every depth; values the model built keep their own key order.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return new Ordered(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

const entriesOf = (value: Ordered | Record<string, unknown>): [string, unknown][] => (value instanceof Ordered ? value.entries : Object.entries(value));

function compact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (value instanceof Ordered || isObject(value)) {
    const entries = entriesOf(value);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

// One value at `indent` after a `prefix`-long key: inline when it fits the line, else one entry per line.
function write(value: unknown, indent: string, prefix: number): string {
  const container = Array.isArray(value) || value instanceof Ordered || isObject(value);
  const expand = value instanceof Ordered && value.expand;
  if (!container) return JSON.stringify(value);
  if (!expand) {
    const inline = compact(value);
    if (indent.length + prefix + inline.length <= WIDTH) return inline;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + write(v, inner, 0)).join(',\n')}\n${indent}]` : '[]';
  const entries = entriesOf(value as Ordered | Record<string, unknown>);
  if (!entries.length) return '{}';
  const lines = entries.map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return inner + key + write(v, inner, key.length);
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** The token file in canonical form: keys in canonical order, values in their object forms, 2-space indented. */
export function serializeTokens(set: TokenSet): string {
  const props = (source: object | undefined, order: readonly string[]) =>
    order.flatMap((key): [string, unknown][] => {
      const value = (source as Record<string, unknown> | undefined)?.[key];
      return value === undefined ? [] : [[key, key === '$extensions' ? sortKeys(value) : value]];
    });
  const root = new Ordered(props(set.groups.get(''), GROUP_ORDER), true);
  const children = new Map<Ordered, Map<string, Ordered>>();
  const groupAt = (segments: readonly string[]): Ordered => {
    let node = root;
    segments.forEach((segment, i) => {
      const known = children.get(node) ?? children.set(node, new Map()).get(node)!;
      let child = known.get(segment);
      if (!child) {
        child = new Ordered(props(set.groups.get(segments.slice(0, i + 1).join('.')), GROUP_ORDER), true);
        known.set(segment, child);
        node.entries.push([segment, child]);
      }
      node = child;
    });
    return node;
  };
  const paths = [...new Set([...set.tokens.keys(), ...set.groups.keys()])].filter((p) => p !== '').sort(comparePaths);
  for (const path of paths) {
    const segments = splitPath(path);
    const token = set.tokens.get(path);
    if (token) groupAt(segments.slice(0, -1)).entries.push([segments.at(-1)!, new Ordered(props(token, TOKEN_ORDER), true)]);
    else groupAt(segments);
  }
  return `${write(root, '', 0)}\n`;
}

// --- Validation ------------------------------------------------------------------------------------------------------

export const LIMITS = { tokens: 512, tokensPerGroup: 64 } as const;

/** Every role present, at its type. A role whose path already has a problem is not reported again as missing. */
export function validateRoles(resolved: ResolvedTokens, set: TokenSet, reported: ReadonlySet<string> = new Set()): TokenProblem[] {
  const problems: TokenProblem[] = [];
  for (const role of ROLES) {
    const token = resolved.tokens.get(role.path);
    const names = cssNamesOf(role.path, role.type).join(', ');
    if (token) {
      if (token.type !== role.type) problems.push({ path: role.path, message: `the role ${role.path} (${names}) must be a ${role.type}, not a ${token.type}` });
      continue;
    }
    if (reported.has(role.path)) continue;
    let hint = '';
    const segments = splitPath(role.path);
    for (let i = segments.length - 1; i > 0; i--) {
      const ancestor = segments.slice(0, i).join('.');
      if (!set.tokens.has(ancestor)) continue;
      hint = role.path === `${ancestor}.$root` ? `; ${ancestor} is a token; the role needs ${ancestor}.$root (a group’s base token)` : `; ${ancestor} is a token, so it cannot hold ${role.path}`;
      break;
    }
    problems.push({ path: role.path, message: `missing role ${role.path} (${names}), a ${role.type}${hint}` });
  }
  return problems;
}

/**
 * The whole check of a token file: it reads, every reference resolves without a cycle, every role is there at its type,
 * no two tokens write one CSS name, MAWS's extensions resolve, and the file keeps to the limits.
 */
export function validateTokenFile(input: unknown): { ok: boolean; tokens: TokenSet | null; resolved: ResolvedTokens | null; problems: TokenProblem[] } {
  const parsed = parseTokens(input);
  if (!parsed.tokens) return { ok: false, tokens: null, resolved: null, problems: parsed.problems };
  const set = parsed.tokens;
  const problems = [...parsed.problems];
  const resolved = resolveTokens(set, new Set(parsed.problems.map((p) => p.path)));
  problems.push(...resolved.problems);
  problems.push(...validateRoles(resolved, set, new Set(problems.map((p) => p.path))));

  const written = new Map<string, string>();
  for (const token of resolved.tokens.values()) {
    for (const name of cssNamesOf(token.path, token.type)) {
      const owner = written.get(name);
      if (owner) problems.push({ path: token.path, message: `${name} is already written by ${owner}; rename one of them` });
      else written.set(name, token.path);
    }
  }

  // MAWS's extensions may name tokens: each such alias must reach a token of the right type.
  const check = (path: string, raw: unknown, type: TokenType, at: string) => {
    for (const message of resolveValueAgainst(resolved, type, raw, at).problems) problems.push({ path, message });
  };
  const office = set.groups.get('')?.$extensions?.[OFFICE_KEY] as { theme?: Record<string, unknown> } | undefined;
  for (const [slot, value] of Object.entries(office?.theme ?? {})) check('', value, 'color', `$extensions["${OFFICE_KEY}"].theme.${slot}`);
  const page = set.groups.get('')?.$extensions?.[PAGE_KEY] as { margin?: unknown } | undefined;
  if (page?.margin !== undefined) check('', page.margin, 'dimension', `$extensions["${PAGE_KEY}"].margin`);
  for (const [path, token] of set.tokens) {
    const deck = token.$extensions?.[DECK_KEY] as { fontSize?: unknown; lineHeight?: unknown } | undefined;
    if (deck?.fontSize !== undefined) check(path, deck.fontSize, 'dimension', `$extensions["${DECK_KEY}"].fontSize`);
    if (deck?.lineHeight !== undefined) check(path, deck.lineHeight, 'number', `$extensions["${DECK_KEY}"].lineHeight`);
  }

  if (set.tokens.size > LIMITS.tokens) problems.push({ path: '', message: `${set.tokens.size} tokens; a system holds at most ${LIMITS.tokens}` });
  const perGroup = new Map<string, number>();
  for (const path of set.tokens.keys()) {
    const parent = splitPath(path).slice(0, -1).join('.');
    perGroup.set(parent, (perGroup.get(parent) ?? 0) + 1);
  }
  for (const [group, count] of perGroup) {
    if (count > LIMITS.tokensPerGroup) problems.push({ path: group, message: `${count} tokens in one group; a group holds at most ${LIMITS.tokensPerGroup}` });
  }
  return { ok: problems.length === 0, tokens: set, resolved, problems };
}
