// Streamdown plugins for every markdown surface (residues *Code highlighting*, *Math*, *Mermaid*). Code and math are
// always present. Mermaid is two separate questions:
// - loading is global and once: the plugin module (which imports mermaid, about 2.5 MB, statically) is imported the
//   first time a completed `mermaid` fence is seen in any transcript, live block or not, so sessions without diagrams
//   never load it;
// - drawing is per fence: a fence becomes a diagram only once its closing fence is present in its block's text, and
//   renders as code until then, while streaming included (MermaidFence.tsx). Streamdown's own code renderer picks
//   mermaid for any `mermaid` fence once the plugin exists and consults no completeness flag, so the gate is ours.
import { createMathPlugin } from '@streamdown/math';
import { useEffect, useSyncExternalStore } from 'react';
import type { DiagramPlugin } from 'streamdown';
import { createTranscriptCodePlugin } from './code-plugin';

export const code = createTranscriptCodePlugin({ themes: ['github-light', 'github-dark'] });
export const math = createMathPlugin({ singleDollarTextMath: false, errorColor: 'var(--danger)' });

type MermaidModule = typeof import('@streamdown/mermaid');

let mermaidModule: MermaidModule | null = null;
let mermaid: DiagramPlugin | null = null;
let requested = false;
const listeners = new Set<() => void>();

// CommonMark fences: up to three spaces of indent, three or more backticks or tildes; a closing fence uses the same
// character, at least as many, and nothing else on its line.
const OPENING = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;

export interface MermaidFences {
  closed: number; // mermaid fences with their closing fence present
  open: string | null; // the source of a trailing mermaid fence that has not closed, if the text ends inside one
}

export function mermaidFences(markdown: string): MermaidFences {
  let closed = 0;
  let fence: { marker: string; mermaid: boolean; lines: string[] } | null = null;
  for (const line of markdown.split('\n')) {
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.marker[0] === '`' ? '`' : '~'}{${fence.marker.length},}\\s*$`);
      if (closing.test(line)) {
        if (fence.mermaid) closed += 1;
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    const opening = OPENING.exec(line);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      fence = { marker: opening[1], mermaid: /^\s*mermaid\b/.test(opening[2]), lines: [] };
    }
  }
  return { closed, open: fence?.mermaid ? fence.lines.join('\n') : null };
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
  mermaid = mermaidModule.createMermaidPlugin({
    config: { securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: mermaidThemeVariables() },
  });
  for (const listener of listeners) listener();
}

function requestMermaid(): void {
  if (requested) return;
  requested = true;
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

// The loaded mermaid plugin, or null until the first completed fence anywhere has loaded it.
export function useMermaidPlugin(): DiagramPlugin | null {
  return useSyncExternalStore(subscribe, () => mermaid);
}

// Loads the mermaid module when this surface's text holds a completed mermaid fence, whether the block is live or not.
export function useMermaidLoader(closedFences: number): void {
  useEffect(() => {
    if (closedFences > 0) requestMermaid();
  }, [closedFences]);
}
