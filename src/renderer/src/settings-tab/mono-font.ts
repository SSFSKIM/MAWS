// `appearance.monoFont` (C11 execution document, Settings v3 and the Appearance row; ruled 2026-09-29): a font family
// prepended to `--font-mono` at the document root, so the terminal (which reads the token at start and on change) and
// every code block (Tailwind's `font-mono`) draw in it, and a glyph the family lacks falls back through the token stack.
// null leaves the token as tokens.css declares it.
import { useSettings } from '../stores/settings';

// tokens.css's `--font-mono`, which the override keeps after the family (pinned against the file in the test).
export const TOKEN_MONO_STACK = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// The family as a CSS string: surrounding quotes a user typed are dropped, a quote or backslash inside is escaped, and a
// line break (which a CSS string cannot hold) becomes a space.
export function monoFontStack(family: string | null): string | null {
  const name = family
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  if (!name) return null;
  const quoted = `"${name.replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, '\\$&')}"`;
  return `${quoted}, ${TOKEN_MONO_STACK}`;
}

export function applyMonoFont(family: string | null, root: HTMLElement = document.documentElement): void {
  const stack = monoFontStack(family);
  if (stack === null) root.style.removeProperty('--font-mono');
  else root.style.setProperty('--font-mono', stack);
}

// Keeps the root override on the settings' value: from App.tsx for the app, and from the terminal harness pages.
export function connectMonoFont(settings: typeof useSettings = useSettings, root: HTMLElement = document.documentElement): () => void {
  let applied: string | null | undefined;
  const follow = () => {
    const family = settings.getState().state?.settings.appearance.monoFont ?? null;
    if (family === applied) return;
    applied = family;
    applyMonoFont(family, root);
  };
  follow();
  return settings.subscribe(follow);
}
