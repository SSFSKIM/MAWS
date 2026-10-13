// Code highlighting for an export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the editor's shiki
// highlighter (../shiki.ts, the same engine, grammars and two themes) awaited for every code block before the
// page is written, and the theme picked by the governing system's ground, not the app's (one theme per system,
// Decision Log 39): a dark `--ds-color-bg` takes shiki's dark colours.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { ThemedToken } from 'shiki';
import { highlightCode, languageOf } from '../shiki';
import { hexOf } from './design-system';

export type CodeTokens = (code: string, language: unknown) => ThemedToken[][] | null;

const keyOf = (code: string, language: string) => `${language}\u0000${code}`;

/** Every code block's tokens, highlighted ahead; an unknown language stays plain, a failing highlighter rejects. */
export async function codeTokensFor(bodies: PMNode[]): Promise<CodeTokens> {
  const tokens = new Map<string, ThemedToken[][]>();
  const pending: Array<Promise<void>> = [];
  for (const body of bodies) {
    body.descendants((node) => {
      if (node.type.name !== 'codeBlock') return !node.isTextblock && !node.isLeaf;
      const language = languageOf(node.attrs.language);
      const code = node.textContent;
      const key = language && keyOf(code, language);
      if (language && key && code && !tokens.has(key)) {
        tokens.set(key, []);
        pending.push(
          highlightCode(code, language).then((lines) => void tokens.set(key, lines)),
        );
      }
      return false;
    });
  }
  await Promise.all(pending);
  return (code, language) => {
    const id = languageOf(language);
    return (id && tokens.get(keyOf(code, id))) || null;
  };
}

/** Whether a ground colour is dark (relative luminance under 0.5); an unreadable colour is taken as light. */
export function isDarkGround(css: string | null): boolean {
  const hex = hexOf(css);
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ** 2.2;
}
