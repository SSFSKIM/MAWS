// Streamdown plugins for every markdown surface (residues *Code highlighting*, *Math*, *Mermaid*). Code and math are
// always present; the mermaid plugin module (which imports mermaid, about 2.5 MB, statically) is imported the first
// time a completed `mermaid` fence is seen in any transcript, so sessions without diagrams never load it. Until then,
// and while a fence is streaming, a diagram renders as code.
import { createMathPlugin } from '@streamdown/math';
import { useEffect, useSyncExternalStore } from 'react';
import type { PluginConfig } from 'streamdown';
import { createTranscriptCodePlugin } from './code-plugin';

const code = createTranscriptCodePlugin({ themes: ['github-light', 'github-dark'] });
const math = createMathPlugin({ singleDollarTextMath: false, errorColor: 'var(--danger)' });

type MermaidModule = typeof import('@streamdown/mermaid');

let plugins: PluginConfig = { code, math };
let mermaidModule: MermaidModule | null = null;
let mermaidRequested = false;
const listeners = new Set<() => void>();

const COMPLETED_MERMAID_FENCE = /^ {0,3}(`{3,}|~{3,})\s*mermaid\b[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/m;

export function hasCompletedMermaidFence(markdown: string): boolean {
  return COMPLETED_MERMAID_FENCE.test(markdown);
}

// Mermaid's `base` theme takes its palette from the X7 tokens as they are computed at this moment.
function mermaidThemeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: token('--bg'),
    primaryColor: token('--bg-raised'),
    primaryTextColor: token('--fg'),
    primaryBorderColor: token('--border-strong'),
    secondaryColor: token('--accent-soft'),
    tertiaryColor: token('--bg-hover'),
    lineColor: token('--fg-muted'),
    textColor: token('--fg'),
    fontFamily: token('--font-ui'),
  };
}

function rebuildMermaid(): void {
  if (!mermaidModule) return;
  const mermaid = mermaidModule.createMermaidPlugin({
    config: { securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: mermaidThemeVariables() },
  });
  plugins = { code, math, mermaid };
  for (const listener of listeners) listener();
}

function requestMermaid(): void {
  if (mermaidRequested) return;
  mermaidRequested = true;
  void import('@streamdown/mermaid').then((module) => {
    mermaidModule = module;
    rebuildMermaid();
    // Theme changes (C1's signal is `data-theme` on <html>) rebuild the plugin so diagrams re-render in the new palette.
    new MutationObserver(rebuildMermaid).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const current = () => plugins;

// The plugin set for one markdown surface; a completed mermaid fence in a settled block triggers the lazy import.
export function useMarkdownPlugins(markdown: string, live: boolean): PluginConfig {
  useEffect(() => {
    if (!live && !mermaidRequested && hasCompletedMermaidFence(markdown)) requestMermaid();
  }, [markdown, live]);
  return useSyncExternalStore(subscribe, current);
}
