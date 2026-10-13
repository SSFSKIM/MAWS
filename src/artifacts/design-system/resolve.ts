// Resolution of a token set (DTCG 2025.10 §6.4, §6.7, §7): `$extends` materializes a group's inherited tokens, each
// token's type is its own `$type`, else its alias target's, else the closest group's; aliases (`"{a.b}"`) and `$ref`
// pointers are replaced by what they name, chained, inside composites and lists; cycles in either are refused with
// every member named. The result holds only the tokens that resolved; `problems` names the rest.
import { comparePaths, splitPath } from './roles';
import type { GroupProps, Token, TokenProblem, TokenSet } from './tokens';
import { aliasPath, FAIL, isAlias, isPointer, normalizeValue, pointerSegments, type RefHandler, type ResolvedValueOf, type TokenType } from './values';

export type ResolvedToken = {
  [T in TokenType]: {
    path: string;
    type: T;
    value: ResolvedValueOf[T];
    /** The token as written (its references kept). An inherited token is the extended group's. */
    token: Token;
    /** Materialized by its group's `$extends`. */
    inherited: boolean;
  };
}[TokenType];

export interface ResolvedTokens {
  /** In canonical order: the roles, then every other path. */
  readonly tokens: ReadonlyMap<string, ResolvedToken>;
  readonly problems: readonly TokenProblem[];
}

// The resolution's handler also reaches a token by path for the resolver itself (a whole-value alias's type).
interface Handler extends RefHandler {
  reach(target: string, at: string, shown: string): ResolvedToken | typeof FAIL;
}

interface Entry {
  token: Token;
  inherited: boolean;
  source: string; // the path it was written at
}

const parentOf = (path: string) => splitPath(path).slice(0, -1).join('.');
const join = (base: string, rel: string) => (base === '' ? rel : rel === '' ? base : `${base}.${rel}`);
const relative = (path: string, base: string): string | null => (base === '' ? path : path === base ? '' : path.startsWith(`${base}.`) ? path.slice(base.length + 1) : null);
const tokenTypeOf = (sub: string): TokenType => (sub === 'shadowLayer' ? 'shadow' : sub === 'gradientStop' ? 'gradient' : (sub as TokenType));

/** `broken` names paths the parse already refused, so a reference to one says why it does not resolve. */
export function resolveTokens(set: TokenSet, broken: ReadonlySet<string> = new Set()): ResolvedTokens {
  const problems: TokenProblem[] = [];
  const entries = new Map<string, Entry>([...set.tokens].map(([path, token]) => [path, { token, inherited: false, source: path }]));
  const groups = new Map<string, GroupProps>([...set.groups].map(([path, props]) => [path, { ...props }]));

  // 1. $extends, deepest chains first; a group in a cycle (or extending its own ancestor) is refused and inherits nothing.
  const state = new Map<string, 'visiting' | 'done' | 'failed'>();
  const extend = (path: string, stack: string[]): boolean => {
    const seen = state.get(path);
    if (seen === 'done') return true;
    if (seen === 'failed') return false;
    if (seen === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(path)), path];
      for (const member of new Set(cycle)) {
        state.set(member, 'failed');
        problems.push({ path: member, message: `circular $extends: ${cycle.join(' → ')}` });
      }
      return false;
    }
    const ref = set.groups.get(path)?.$extends;
    if (!ref) {
      state.set(path, 'done');
      return true;
    }
    const target = aliasPath(ref);
    if (!set.groups.has(target)) {
      state.set(path, 'failed');
      problems.push({ path, message: set.tokens.has(target) ? `$extends must name a group; ${ref} is a token` : `$extends: ${ref} names no group` });
      return false;
    }
    if (relative(path, target) !== null) {
      state.set(path, 'failed');
      problems.push({ path, message: `circular $extends: ${path} extends ${target}, which holds it` });
      return false;
    }
    state.set(path, 'visiting');
    // The target is copied as it resolves: its own chain and every nested group's own $extends expanded first.
    const subtree = [...set.groups.keys()].filter((group) => relative(group, target) !== null).sort(comparePaths);
    if (!subtree.every((group) => extend(group, [...stack, path]))) {
      if (state.get(path) !== 'failed') {
        state.set(path, 'failed');
        problems.push({ path, message: `$extends: ${ref} cannot be extended (it has problems)` });
      }
      return false;
    }
    // Inherit the target's groups' properties (a local property wins) and its tokens (a local token wins, whole, and
    // nothing is inherited beneath it).
    const underToken = (here: string) => splitPath(relative(here, path)!).some((_, i, segments) => entries.has(join(path, segments.slice(0, i + 1).join('.'))));
    for (const [groupPath, props] of [...groups]) {
      const rel = relative(groupPath, target);
      if (rel === null) continue;
      const here = join(path, rel);
      if (underToken(here)) continue;
      const inherited = { ...props };
      delete inherited.$extends; // the target's own chain is already expanded into it
      groups.set(here, { ...inherited, ...groups.get(here) });
    }
    for (const [tokenPath, entry] of [...entries]) {
      const rel = relative(tokenPath, target);
      if (rel === null || rel === '') continue;
      const here = join(path, rel);
      if (!entries.has(here) && !groups.has(here) && !underToken(here)) entries.set(here, { token: entry.token, inherited: true, source: entry.source });
    }
    state.set(path, 'done');
    return true;
  };
  for (const path of [...set.groups.keys()].sort(comparePaths)) extend(path, []);

  // 2. Values (and types: a token's own $type, else its alias target's, else the closest group's).
  const groupType = (path: string): TokenType | undefined => {
    for (let at = parentOf(path); ; at = parentOf(at)) {
      const type = groups.get(at)?.$type;
      if (type) return type;
      if (at === '') return undefined;
    }
  };
  const resolved = new Map<string, ResolvedToken>();
  const failed = new Set<string>();
  const cyclic = new Set<string>();
  const stack: string[] = [];
  const locations: { pointer: string; owner: string }[] = []; // the pointers being resolved, outermost first

  const resolve = (path: string): ResolvedToken | typeof FAIL => {
    const done = resolved.get(path);
    if (done) return done;
    if (failed.has(path)) return FAIL;
    if (stack.includes(path)) {
      const cycle = stack.slice(stack.indexOf(path));
      cycle.forEach((member, i) => {
        if (cyclic.has(member)) return;
        cyclic.add(member);
        problems.push({ path: member, message: `circular reference: ${[...cycle.slice(i), ...cycle.slice(0, i), member].join(' → ')}` });
      });
      return FAIL;
    }
    const entry = entries.get(path)!;
    const h = handler(path);
    stack.push(path);
    let type = entry.token.$type;
    if (!type && isAlias(entry.token.$value)) {
      const target = h.reach(aliasPath(entry.token.$value), '$value', entry.token.$value);
      if (target !== FAIL) type = target.type;
    } else type ??= groupType(path) ?? (entry.inherited ? groupType(entry.source) : undefined);
    if (!type && !isAlias(entry.token.$value)) h.problem('no $type: set one on the token or on a group above it');
    const value = type ? normalizeValue(type, entry.token.$value, '$value', h) : FAIL;
    stack.pop();
    if (value === FAIL || !type) {
      failed.add(path);
      return FAIL;
    }
    const token = { path, type, value, token: entry.token, inherited: entry.inherited } as ResolvedToken;
    resolved.set(path, token);
    return token;
  };

  const handler = (path: string): Handler => {
    const problem = (message: string) => {
      if (!cyclic.has(path)) problems.push({ path, message });
    };
    const reach = (target: string, at: string, shown: string): ResolvedToken | typeof FAIL => {
      if (!entries.has(target)) {
        if (groups.has(target)) {
          const root = entries.has(`${target}.$root`) ? `; did you mean {${target}.$root}?` : '';
          problem(`${at}: ${shown} names a group, not a token${root}`);
        } else if (broken.has(target)) problem(`${at}: ${shown} cannot be resolved: ${target} has problems`);
        else problem(`${at}: ${shown} names no token`);
        return FAIL;
      }
      const result = resolve(target);
      if (result === FAIL) problem(`${at}: ${shown} cannot be resolved: ${target} has problems`);
      return result;
    };
    const handlerFor: Handler = {
      mode: 'resolve',
      problem,
      reach,
      alias(alias, sub, at) {
        const target = reach(aliasPath(alias), at, alias);
        if (target === FAIL) return FAIL;
        const expected = tokenTypeOf(sub);
        if (target.type !== expected) {
          problem(`${at}: ${alias} is a ${target.type}, not a ${expected}`);
          return FAIL;
        }
        return target.value;
      },
      // A pointer is resolved at the location it names, in the written value: a token may point into its own value
      // (components[1] at components[0]), and only a loop of locations is a cycle (the format's §7.3, §6.7.4).
      pointer(pointer, at) {
        const segments = pointerSegments(pointer)!;
        const valueAt = segments.indexOf('$value');
        if (valueAt < 0) {
          const whole = reach(segments.join('.'), at, JSON.stringify(pointer));
          return whole === FAIL ? FAIL : whole.value;
        }
        const tokenPath = segments.slice(0, valueAt).join('.');
        const owner = entries.get(tokenPath);
        if (!owner) return reach(tokenPath, at, JSON.stringify(pointer)); // names the missing target, returns FAIL
        if (locations.some((location) => location.pointer === pointer)) {
          const loop = locations.slice(locations.findIndex((location) => location.pointer === pointer));
          const message = `circular reference: ${[...loop.map((location) => location.pointer), pointer].join(' → ')}`;
          for (const member of new Set(loop.map((location) => location.owner))) {
            if (cyclic.has(member)) continue;
            cyclic.add(member);
            problems.push({ path: member, message });
          }
          return FAIL;
        }
        locations.push({ pointer, owner: tokenPath });
        const before = problems.length;
        const refuse = (): typeof FAIL => {
          // A token outside the loop (or behind a deeper failure) still says why its pointer did not resolve.
          if (!problems.slice(before).some((p) => p.path === path)) problem(`${at}: the pointer ${JSON.stringify(pointer)} cannot be resolved`);
          return FAIL;
        };
        try {
          // Walk the written value, stepping through the references met on the way, then resolve what is reached.
          let node: unknown = owner.token.$value;
          for (const segment of segments.slice(valueAt + 1)) {
            node = deref(node, at);
            if (node === FAIL) return refuse();
            if (Array.isArray(node) && /^\d+$/.test(segment)) node = node[Number(segment)];
            else if (typeof node === 'object' && node !== null && !Array.isArray(node) && Object.hasOwn(node, segment)) node = (node as Record<string, unknown>)[segment];
            else node = undefined;
            if (node === undefined) {
              problem(`${at}: the pointer ${JSON.stringify(pointer)} reaches nothing`);
              return FAIL;
            }
          }
          const value = deepDeref(node, at);
          return value === FAIL ? refuse() : value;
        } finally {
          locations.pop();
        }
      },
    };
    // A reference in a written value, replaced by what it names (an alias by its token's resolved value).
    function deref(node: unknown, at: string): unknown {
      if (isAlias(node)) {
        const target = reach(aliasPath(node), at, node);
        return target === FAIL ? FAIL : target.value;
      }
      return isPointer(node) ? handlerFor.pointer(node.$ref, at) : node;
    }
    function deepDeref(node: unknown, at: string): unknown {
      const value = deref(node, at);
      if (value === FAIL) return FAIL;
      if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (const item of value) {
          const resolvedItem = deepDeref(item, at);
          if (resolvedItem === FAIL) return FAIL;
          out.push(resolvedItem);
        }
        return out;
      }
      if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
          const resolvedItem = deepDeref(item, at);
          if (resolvedItem === FAIL) return FAIL;
          out[key] = resolvedItem;
        }
        return out;
      }
      return value;
    }
    return handlerFor;
  };

  const order = [...entries.keys()].sort(comparePaths);
  for (const path of order) resolve(path);
  const tokens = new Map<string, ResolvedToken>();
  for (const path of order) {
    const token = resolved.get(path);
    if (token) tokens.set(path, token);
  }
  return { tokens, problems };
}

/**
 * Reads a value written outside the tokens (MAWS's extensions: an Office slot, a deck size) against a resolved set: an
 * alias must name a resolved token of `type`. Pointers are not accepted there.
 */
export function resolveValueAgainst<T extends TokenType>(resolved: ResolvedTokens, type: T, raw: unknown, at: string): { value: ResolvedValueOf[T] | null; problems: string[] } {
  const problems: string[] = [];
  const value = normalizeValue(type, raw, at, {
    mode: 'resolve',
    problem: (message) => problems.push(message),
    alias(alias, sub, where) {
      const target = resolved.tokens.get(aliasPath(alias));
      const expected = tokenTypeOf(sub);
      if (!target) problems.push(`${where}: ${alias} names no resolved token`);
      else if (target.type !== expected) problems.push(`${where}: ${alias} is a ${target.type}, not a ${expected}`);
      else return target.value;
      return FAIL;
    },
    pointer(pointer, where) {
      problems.push(`${where}: a $ref pointer is not accepted here; write an alias such as "{color.accent.$root}"`);
      return FAIL;
    },
  });
  return { value: value === FAIL ? null : (value as ResolvedValueOf[T]), problems };
}
