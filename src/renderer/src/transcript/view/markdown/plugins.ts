// Streamdown plugins for every markdown surface (residues *Code highlighting*, *Math*, *Mermaid*). Code and math are
// always present. Mermaid is two separate questions:
// - loading is global and once: the plugin module (which imports mermaid, about 2.5 MB, statically) is imported the
//   first time a completed `mermaid` fence renders in any transcript, live block or not, so sessions without diagrams
//   never load it;
// - drawing is per fence: a fence becomes a diagram only once its closing fence is present in its block's text, and
//   renders as code until then, while streaming included (MermaidFence.tsx, the renderer of every `mermaid` fence).
//   Streamdown's own code renderer picks mermaid for any `mermaid` fence once the plugin exists and consults no
//   completeness flag, so the gate is ours.
import { createMathPlugin } from '@streamdown/math';
import { useEffect, useSyncExternalStore } from 'react';
import type { DiagramPlugin } from 'streamdown';
import type { Plugin } from 'unified';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';
import { createTranscriptCodePlugin } from './code-plugin';

export const code = createTranscriptCodePlugin({ themes: ['github-light', 'github-dark'] });
export const math = createMathPlugin({ singleDollarTextMath: false, errorColor: 'var(--danger)' });

type MermaidModule = typeof import('@streamdown/mermaid');

let mermaidModule: MermaidModule | null = null;
let mermaid: DiagramPlugin | null = null;
let requested = false;
const listeners = new Set<() => void>();

// Which mermaid fences have closed, per fence, from the markdown parser itself (so a fence in a blockquote or a list
// item is seen as CommonMark sees it, and two identical fences are two fences): a remark plugin over each `mermaid`
// code node reads the node's own source range, whose last line is its closing fence (behind any container markers)
// when it has one. An open fence carries OPEN_FENCE in its metastring, the one channel from a code node to Streamdown's
// custom renderer, which MermaidFence reads and strips. The plugin holds no state: Streamdown caches its processors
// by plugin name, across module instances.
export const OPEN_FENCE = 'maws-open-fence';

interface CodeNode extends Node {
  lang?: string | null;
  meta?: string | null;
  data?: { hProperties?: Record<string, unknown> };
}

function fenceClosed(raw: string): boolean {
  const lines = raw.split('\n');
  const opening = /^ *(`{3,}|~{3,})/.exec(lines[0]);
  if (!opening || lines.length < 2) return false;
  const closing = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(lines.at(-1)!);
  return closing !== null && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length;
}

export const remarkMermaidFences: Plugin = () => (tree, file) =>
  visit(tree, 'code', (node: CodeNode) => {
    if (node.lang !== 'mermaid' || node.position?.start.offset === undefined || node.position.end.offset === undefined) return;
    if (fenceClosed(String(file.value).slice(node.position.start.offset, node.position.end.offset))) return;
    const meta = node.meta ? `${node.meta} ${OPEN_FENCE}` : OPEN_FENCE;
    node.meta = meta;
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, metastring: meta } }; // as Streamdown's codeMeta does
  });

// A fence's metastring without the open mark, and whether it had one.
export function openFenceOf(meta: string | undefined): { open: boolean; meta: string | undefined } {
  const words = (meta ?? '').split(/\s+/).filter(Boolean);
  const rest = words.filter((word) => word !== OPEN_FENCE);
  return { open: rest.length < words.length, meta: rest.length > 0 ? rest.join(' ') : undefined };
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

// Loads the mermaid module once a fence that has closed renders (MermaidFence), whether its block is live or not.
export function useMermaidLoader(complete: boolean): void {
  useEffect(() => {
    if (complete) requestMermaid();
  }, [complete]);
}
