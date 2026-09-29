// Our implementation of Streamdown's `CodeHighlighterPlugin` over shiki (residue *Code highlighting*). It replaces
// @streamdown/code 1.1.1, whose token cache keys on the language, themes, length and first and last hundred
// characters, so two equal-length blocks differing only in the middle showed one another's tokens. Here the key is
// the full (language, light theme, dark theme, code) tuple. Main thread, shiki's JavaScript regex engine, one
// highlighter per language with its grammar loaded on first use; `null` first, then the callback.
import { bundledLanguages, bundledLanguagesInfo, createHighlighter, type BundledLanguage, type HighlighterGeneric, type ThemedToken } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { CodeHighlighterPlugin, ThemeInput } from 'streamdown';

export type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>; // not exported by streamdown
type ShikiThemes = Parameters<typeof createHighlighter>[0]['themes'];

const CACHE_LIMIT = 500;
const PLAIN = 'text';

const engine = createJavaScriptRegexEngine({ forgiving: true });
const aliases = new Map(bundledLanguagesInfo.flatMap((info) => (info.aliases ?? []).map((alias) => [alias, info.id] as const)));
const languages = new Set(Object.keys(bundledLanguages));

const themeName = (theme: ThemeInput) => (typeof theme === 'string' ? theme : (theme.name ?? 'custom'));
const canonical = (language: string) => {
  const name = language.trim().toLowerCase();
  return aliases.get(name) ?? name;
};

type Highlighter = HighlighterGeneric<BundledLanguage, string>;

export function createTranscriptCodePlugin({ themes }: { themes: [ThemeInput, ThemeInput] }): CodeHighlighterPlugin {
  const highlighters = new Map<string, Promise<Highlighter>>(); // per language (and theme pair)
  const tokens = new Map<string, HighlightResult>(); // insertion-ordered; oldest evicted past CACHE_LIMIT
  const waiting = new Map<string, Set<(result: HighlightResult) => void>>();

  const highlighterFor = (language: string, pair: [ThemeInput, ThemeInput]) => {
    const key = `${language}\u0000${themeName(pair[0])}\u0000${themeName(pair[1])}`;
    let highlighter = highlighters.get(key);
    if (!highlighter) {
      highlighter = createHighlighter({ themes: pair as ShikiThemes, langs: language === PLAIN ? [] : [language], engine }) as Promise<Highlighter>;
      highlighters.set(key, highlighter);
    }
    return highlighter;
  };

  const remember = (key: string, result: HighlightResult) => {
    tokens.set(key, result);
    if (tokens.size > CACHE_LIMIT) tokens.delete(tokens.keys().next().value!);
  };

  return {
    name: 'shiki',
    type: 'code-highlighter',
    getThemes: () => themes,
    getSupportedLanguages: () => [...languages] as BundledLanguage[],
    supportsLanguage: (language) => languages.has(canonical(language)),
    highlight({ code, language, themes: pair }, callback) {
      const light = themeName(pair[0]);
      const dark = themeName(pair[1]);
      const lang = languages.has(canonical(language)) ? canonical(language) : PLAIN;
      const key = JSON.stringify([lang, light, dark, code]);
      const cached = tokens.get(key);
      if (cached) return cached;

      const pending = waiting.get(key);
      if (pending) {
        if (callback) pending.add(callback);
        return null;
      }
      const callbacks = new Set<(result: HighlightResult) => void>(callback ? [callback] : []);
      waiting.set(key, callbacks);
      highlighterFor(lang, pair)
        .then((highlighter) => {
          const result = highlighter.codeToTokens(code, { lang: lang as BundledLanguage, themes: { light, dark } });
          const highlighted: HighlightResult = { ...result, tokens: result.tokens as ThemedToken[][] };
          remember(key, highlighted);
          for (const notify of callbacks) notify(highlighted);
        })
        .catch((error: unknown) => console.error('[transcript] code highlighting failed', error))
        .finally(() => waiting.delete(key));
      return null;
    },
  };
}
