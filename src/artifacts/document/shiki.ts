// The code blocks' highlighter (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): shiki with its JavaScript
// regex engine and the transcript's two themes (github-light, github-dark; the transcript's
// `createTranscriptCodePlugin` is a Streamdown plugin, so this is its sibling, not an import of it), one highlighter per
// language with its grammar loaded on first use, tokens cached by the full (language, code) pair. `null` first, then
// `onReady` once the tokens exist.
import { bundledLanguages, bundledLanguagesInfo, createHighlighter, type BundledLanguage, type HighlighterGeneric, type ThemedToken } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;
const CACHE_LIMIT = 500;

const engine = createJavaScriptRegexEngine({ forgiving: true });
const aliases = new Map(bundledLanguagesInfo.flatMap((info) => (info.aliases ?? []).map((alias) => [alias, info.id] as const)));
const languages = new Set(Object.keys(bundledLanguages));

type Highlighter = HighlighterGeneric<BundledLanguage, string>;
const highlighters = new Map<string, Promise<Highlighter>>();
const cache = new Map<string, ThemedToken[][]>(); // insertion-ordered; the oldest goes past CACHE_LIMIT
const waiting = new Map<string, Set<() => void>>();

/** The bundled language a block's `language` names, or null for plain text and anything unknown. */
export function languageOf(language: unknown): BundledLanguage | null {
  const name = typeof language === 'string' ? language.trim().toLowerCase() : '';
  const id = aliases.get(name) ?? name;
  return languages.has(id) ? (id as BundledLanguage) : null;
}

/** Tokens per line, each with its light colour and `--shiki-dark` in `htmlStyle`; null until they are ready. */
export function codeTokens(code: string, language: BundledLanguage, onReady: () => void): ThemedToken[][] | null {
  const key = `${language}\u0000${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = waiting.get(key);
  if (pending) {
    pending.add(onReady);
    return null;
  }
  const callbacks = new Set([onReady]);
  waiting.set(key, callbacks);
  let highlighter = highlighters.get(language);
  if (!highlighter) {
    highlighter = createHighlighter({ themes: Object.values(THEMES), langs: [language], engine }) as Promise<Highlighter>;
    highlighters.set(language, highlighter);
  }
  highlighter
    .then((h) => {
      cache.set(key, h.codeToTokens(code, { lang: language, themes: THEMES }).tokens);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      for (const notify of callbacks) notify();
    })
    .catch((error: unknown) => console.error('[document] code highlighting failed', error))
    .finally(() => waiting.delete(key));
  return null;
}
