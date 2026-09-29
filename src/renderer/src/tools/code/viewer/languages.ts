// The code view's language by filename (C8c execution document, Interfaces *Viewer kinds and caps*): CodeMirror's own
// table (`@codemirror/language-data`), each language a separate chunk loaded on first use. A language that cannot load
// leaves the view as plain text (R8's fallback); the view paints before any language arrives.
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { basename } from '../files/tree';

export const languageDescriptionFor = (path: string): LanguageDescription | null => LanguageDescription.matchFilename(languages, basename(path));

export const languageNameFor = (path: string): string | null => languageDescriptionFor(path)?.name ?? null;

export function languageFor(path: string): Promise<LanguageSupport | null> {
  const description = languageDescriptionFor(path);
  return description ? description.load().catch(() => null) : Promise.resolve(null);
}
