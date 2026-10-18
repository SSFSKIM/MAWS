// The export helpers of D8 (the ledger's X28): `resolveDsVars`, a system's `var(--ds-*)` as literals. Apart from
// apply.ts's React and DOM so main's export service, which runs B's document exporters under Node, resolves through the
// same function as a renderer; apply.ts re-exports it, where the ledger names it. P3-C
// (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 16, 27 (2)): `literalValues` and
// `overrideLiterals` exported, the latter split out of the former, so the deck's mirror and Theme panel resolve exactly
// as a scope and an export do (its M3 `literals.ts` reconciled here, the one home). P3-F: the overrides' one filter,
// `safeOverrides` and `acceptedOverrides`, lives here too, and a scope's stylesheet (view.ts) sets what it accepts.
import { tokenProperties, type Medium } from './css';
import type { TokenSet } from './tokens';
import type { TokenOverrides } from './view';

const OVERRIDE_NAME = /^--ds-[A-Za-z0-9_-]+$/;
// A value that could end the declaration, the rule or the element, fetch anything, or carry a priority (`!important`,
// which a scope reads as the declaration's and an export would write into the property's value), is not an override.
const UNSAFE_VALUE = /[;{}<>\\!\n\r]|\/\*|\b(?:url|image|image-set|cross-fade|element|src)\s*\(|@import/i;
const balancedQuotes = (value: string) => (value.match(/"/g)?.length ?? 0) % 2 === 0 && (value.match(/'/g)?.length ?? 0) % 2 === 0;

/** The overrides a scope may set: `--ds-*` names with plain values, in name order (byte-stable). */
export function safeOverrides(overrides: TokenOverrides | undefined): [string, string][] {
  return Object.entries(overrides ?? {})
    .filter(([name, value]) => OVERRIDE_NAME.test(name) && typeof value === 'string' && value.trim() !== '' && !UNSAFE_VALUE.test(value) && balancedQuotes(value))
    .map(([name, value]): [string, string] => [name, value.trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Each `var(…)` in `text` in order: its span, the name and the fallback text (null without one). Unclosed: not listed. */
function varsIn(text: string): { at: number; end: number; name: string; inner: string; fallback: string | null }[] {
  const found: { at: number; end: number; name: string; inner: string; fallback: string | null }[] = [];
  let i = 0;
  for (let at = text.indexOf('var(', i); at >= 0; at = text.indexOf('var(', i)) {
    let depth = 1;
    let end = at + 4;
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
    }
    if (depth > 0) break; // unclosed: left as written
    const inner = text.slice(at + 4, end - 1);
    const comma = inner.indexOf(',');
    found.push({ at, end, name: (comma < 0 ? inner : inner.slice(0, comma)).trim(), inner, fallback: comma < 0 ? null : inner.slice(comma + 1) });
    i = end;
  }
  return found;
}

/** `text` with every `var()` replaced by its value (`lookup`), else its fallback resolved the same way; null as soon as
 * one resolves to nothing, so what comes back is literal. */
function literalOf(text: string, lookup: (name: string) => string | undefined): string | null {
  let out = '';
  let i = 0;
  for (const ref of varsIn(text)) {
    const value = ref.name.startsWith('--ds-') ? lookup(ref.name) : undefined;
    const replaced = value ?? (ref.fallback === null ? null : literalOf(ref.fallback, lookup)?.trim() ?? null);
    if (replaced === null) return null;
    out += text.slice(i, ref.at) + replaced;
    i = ref.end;
  }
  const rest = text.slice(i);
  return rest.includes('var(') ? null : out + rest; // an unclosed var() reads as nothing
}

/**
 * The values a scope sets, as literals: the system's at the medium's scale with the overrides on top (`safeOverrides`),
 * each override's references resolved against that merged map, following chains (M6 fix wave 1, I1). An override in a
 * reference cycle, or with a reference that resolves to nothing, is dropped, and its name keeps the system's value.
 */
export function literalValues(tokens: TokenSet, medium: Medium, overrides: TokenOverrides | undefined): Map<string, string> {
  return overrideLiterals(tokenProperties(tokens, medium), overrides);
}

/** P3-C: `literalValues` over values already read (`tokenProperties`'s): the overrides set over `values`, resolved likewise. */
export function overrideLiterals(values: ReadonlyMap<string, string>, overrides: TokenOverrides | undefined): Map<string, string> {
  return new Map([...values, ...acceptedOverrides(values, overrides)]);
}

/**
 * P3-F: the overrides taken over `values`, by name in name order, each as its literal: `safeOverrides`, each one's
 * references resolved against `values` with the overrides on top, following chains; one in a reference cycle, or with a
 * reference that resolves to nothing, left out. The one filter of a scope (view.ts), an export and the mirrors.
 */
export function acceptedOverrides(values: ReadonlyMap<string, string>, overrides: TokenOverrides | undefined): Map<string, string> {
  const raw = new Map(safeOverrides(overrides));
  const settled = new Map<string, string | null>(); // an override's literal, or null when dropped
  const stack: string[] = []; // the overrides being resolved, outermost first
  const cyclic = new Set<string>(); // every override found on a cycle
  const overrideValue = (name: string): string | null => {
    if (settled.has(name)) return settled.get(name)!;
    stack.push(name);
    const literal = literalOf(raw.get(name)!, (ref) => {
      if (!raw.has(ref)) return values.get(ref);
      const at = stack.indexOf(ref);
      if (at >= 0) {
        for (const member of stack.slice(at)) cyclic.add(member); // the whole cycle is dropped, wherever it was entered
        return undefined;
      }
      return overrideValue(ref) ?? values.get(ref);
    });
    stack.pop();
    const result = cyclic.has(name) ? null : literal;
    settled.set(name, result);
    return result;
  };
  const accepted = new Map<string, string>();
  for (const name of raw.keys()) {
    const literal = overrideValue(name);
    if (literal !== null) accepted.set(name, literal);
  }
  return accepted;
}

/**
 * CSS text with every `var(--ds-*)` the system defines replaced by its value at the medium's scale (the Claude-shaped
 * deck of §4.5, which carries no custom properties). A name the system does not define takes its fallback, resolved the
 * same way, else stays as written; any other `var()` stays, its fallback resolved. `overrides` set after the system's
 * values, as a scope sets them (the same names and values a scope accepts; Decision Log 25), resolved to literals
 * themselves, so a deck's overrides reach its literals.
 */
export function resolveDsVars(cssText: string, tokens: TokenSet, medium: Medium, overrides?: TokenOverrides): string {
  const values = literalValues(tokens, medium, overrides);
  const resolve = (text: string): string => {
    let out = '';
    let i = 0;
    for (const { at, end, name, inner, fallback } of varsIn(text)) {
      const value = name.startsWith('--ds-') ? values.get(name) : undefined;
      out += text.slice(i, at);
      if (value !== undefined) out += value;
      else if (fallback !== null && name.startsWith('--ds-')) out += resolve(fallback).trim();
      else out += fallback === null ? `var(${inner})` : `var(${name},${resolve(fallback)})`;
      i = end;
    }
    return out + text.slice(i);
  };
  return resolve(cssText);
}
