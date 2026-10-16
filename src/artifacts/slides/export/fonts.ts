// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Font variants"; parent Decision Log 21): the face a
// PPTX text run names, from the computed `font-family` stack the export window measured. PowerPoint and Keynote take one
// face per run, so a stack becomes one family:
// - `named` (the default): the stack's first family that is a face, past CSS generics and the system aliases
//   (`system-ui`, `-apple-system`, `BlinkMacSystemFont`), else the basic face of its generic;
// - `basic`: the first of Claude's basic faces the stack names, else the basic face of the stack's generic (sans-serif
//   and system-ui Arial, serif Times New Roman, monospace Courier New, cursive Brush Script MT), else Arial.
// Portable.
import type { ArtifactExportFonts } from '@shared/maws/tools';

/** The request's `fonts` (X31, H2-4): faces named, basic faces, slides as pictures, uploaded faces embedded. */
export type PptxFontVariant = ArtifactExportFonts;

/** Claude's basic faces: present on Windows and macOS alike. */
export const BASIC_FACES = ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Brush Script MT'] as const;

const GENERIC_FACE: Readonly<Record<string, string>> = {
  'sans-serif': 'Arial',
  'system-ui': 'Arial',
  'ui-sans-serif': 'Arial',
  serif: 'Times New Roman',
  'ui-serif': 'Times New Roman',
  monospace: 'Courier New',
  'ui-monospace': 'Courier New',
  cursive: 'Brush Script MT',
  fantasy: 'Arial',
};
// Names a stack may carry that no PPTX reader resolves to a face of its own.
const SYSTEM_ALIASES = new Set(['-apple-system', 'blinkmacsystemfont', 'ui-rounded']);

/** The families of a CSS `font-family` value, unquoted, in order. */
export function fontStack(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      if (current.trim()) out.push(current.trim().replace(/\s+/g, ' '));
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim().replace(/\s+/g, ' '));
  return out;
}

const isGeneric = (family: string) => Object.hasOwn(GENERIC_FACE, family.toLowerCase());
const isFace = (family: string) => !isGeneric(family) && !SYSTEM_ALIASES.has(family.toLowerCase());

/** The basic face standing for a stack's generic (its first generic; sans-serif when it names none). */
function genericFace(stack: readonly string[]): string {
  const generic = stack.find(isGeneric);
  return generic ? GENERIC_FACE[generic.toLowerCase()]! : 'Arial';
}

/** The face a run names in the `named` variant. */
export function namedFace(value: string): string {
  const stack = fontStack(value);
  return stack.find(isFace) ?? genericFace(stack);
}

/** The face a run names in the `basic` variant. */
export function basicFace(value: string): string {
  const stack = fontStack(value);
  for (const family of stack) {
    const basic = BASIC_FACES.find((face) => face.toLowerCase() === family.toLowerCase());
    if (basic) return basic;
  }
  return genericFace(stack);
}

/** The face of a stack under a variant (`pictures` names none: its slides are pictures; `embedded` names as `named`). */
export function faceFor(value: string, variant: PptxFontVariant): string {
  return variant === 'basic' ? basicFace(value) : namedFace(value);
}
