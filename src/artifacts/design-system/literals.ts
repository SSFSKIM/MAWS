// The literal values of a design system's tokens with a consumer's overrides on top, and CSS text with its `var(--ds-*)`
// replaced by them (D8 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; P3-D's export helpers). P3-C (M3 fix
// wave 1; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md) moved them here from `apply.ts`, unchanged but for
// `overrideLiterals` split out of `literalValues`, so a host-side consumer (the deck's mirror) resolves exactly as the
// renderer does without importing React; `apply.ts` re-exports `resolveDsVars`. Portable (§4.10).
import { tokenProperties, type Medium } from './css';
import type { TokenSet } from './tokens';
import { safeOverrides, type TokenOverrides } from './view';

/** Each `var(…)` in `text` in order: its span, the name and the fallback text (null without one). Unclosed: not listed. */
export function varsIn(text: string): { at: number; end: number; name: string; inner: string; fallback: string | null }[] {
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

/** `literalValues` over values already read (`tokenProperties`'s): the overrides set over `values`, resolved likewise. */
export function overrideLiterals(values: ReadonlyMap<string, string>, overrides: TokenOverrides | undefined): Map<string, string> {
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
  const merged = new Map(values);
  for (const name of raw.keys()) {
    const literal = overrideValue(name);
    if (literal !== null) merged.set(name, literal);
  }
  return merged;
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
