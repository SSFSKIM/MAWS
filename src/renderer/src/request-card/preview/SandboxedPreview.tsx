// A question option's `preview`, rendered as the model wrote it inside an isolated frame (§5.3): `<iframe sandbox
// srcdoc>` with no `allow-scripts` and no `allow-same-origin`, so the content runs nothing and reaches nothing of the
// app; C1's CSP applies inside. The frame cannot read the app's CSS variables, so its colours are the current theme's
// token values, read from the document (no literal colour here, X7). The theme is followed through the root's
// `data-theme` attribute, which App sets from the settings store's resolved theme (and the harness sets directly):
// observing the attribute rather than the store means the token values are read after the switch has applied.
import { useMemo, useSyncExternalStore } from 'react';

const escapeCss = (value: string) => value.replace(/[<>]/g, '');

function themeCss(): string {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => escapeCss(style.getPropertyValue(name).trim());
  return `body{margin:8px;font-family:${token('--font-ui')};font-size:${token('--text-ui-sm')};color:${token('--fg')};background:${token('--bg')};white-space:pre-wrap;overflow-wrap:anywhere}`;
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const currentTheme = () => document.documentElement.dataset.theme ?? null;

export function SandboxedPreview({ preview, title }: { preview: string; title: string }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the theme is what changes the token values themeCss reads
  const srcDoc = useMemo(() => `<!doctype html><meta charset="utf-8"><style>${themeCss()}</style>${preview}`, [preview, theme]);
  return <iframe sandbox="" srcDoc={srcDoc} title={title} className="h-36 w-full min-w-0 rounded-sm border border-border bg-bg" />;
}
