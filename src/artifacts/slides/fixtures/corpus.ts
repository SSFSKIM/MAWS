// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M1): the dialect's corpus, every slide the loader must
// take with no slide held and bring to a fixed point (Acceptance 1): Claude's own examples (./claude/, extracted from
// U1's capture by extract-claude.mjs), D's three default systems' layouts (read through D's module, so they stay D's),
// S6's seven bench shapes and the inputs S6 loaded. Later milestones (the publish, the canvas, the exporters, the scale
// gate) read the same lists.
import { DEFAULT_SYSTEMS } from '../../types/design_system/defaults';
import { benchShapes } from './bench';
import { claudeExamples, droppedSlide, messy, noIdsSlide, tokenSlide } from './s6';

export interface CorpusSlide {
  name: string;
  /** Where the slide comes from: a file and lines, or a module. */
  origin: string;
  html: string;
}

const CLAUDE_FILES = import.meta.glob<string>('./claude/*.html', { query: '?raw', import: 'default', eager: true });

/** Claude's examples, one per extracted file; `origin` is the file's provenance line. */
export const CLAUDE_SLIDES: readonly CorpusSlide[] = Object.entries(CLAUDE_FILES)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([path, html]) => ({
    name: `claude/${path.slice('./claude/'.length, -'.html'.length)}`,
    origin: /<!-- provenance: (.*?) -->/.exec(html)?.[1] ?? path,
    html,
  }));

/** D's default systems' `layouts/*.html`, each a slide with `data-ph` placeholders. */
export const LAYOUT_SLIDES: readonly CorpusSlide[] = DEFAULT_SYSTEMS.flatMap((system) =>
  Object.entries(system.files)
    .filter(([path]) => /^layouts\/[^/]+\.html$/.test(path))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, html]) => ({ name: `layout/${system.key}/${path.slice('layouts/'.length, -'.html'.length)}`, origin: `src/artifacts/types/design_system/defaults/${system.key}/${path}`, html })),
);

/** S6's seven bench shapes, one slide each. */
export const BENCH_SLIDES: readonly CorpusSlide[] = benchShapes.map((shape, i) => ({ name: `bench/${i + 1}`, origin: 'spikes/p3-store/s6/exp/bench.ts', html: shape(`b${i + 1}`, i) }));

/** The `https:` image S6's messy slide carries: held under D6, so the corpus's messy slide uploads it instead. */
export const MESSY_IMAGE_URL = 'https://cdn.example.com/x.png';
export const messyLoadable = messy.replace(MESSY_IMAGE_URL, 'assets/x.png');

/** The inputs S6 loaded (its round trip's corpus), the messy slide with its image uploaded. */
export const S6_SLIDES: readonly CorpusSlide[] = [
  ...Object.entries(claudeExamples).map(([name, html]) => ({ name: `s6/${name}`, origin: 'spikes/p3-store/s6/fixtures/claude-examples.ts', html })),
  { name: 's6/messy', origin: 'spikes/p3-store/s6/fixtures/claude-examples.ts (its image src an asset ref)', html: messyLoadable },
  { name: 's6/tokens', origin: 'spikes/p3-store/s6/exp/roundtrip.ts', html: tokenSlide },
  { name: 's6/dropped', origin: 'spikes/p3-store/s6/exp/roundtrip.ts', html: droppedSlide },
  { name: 's6/no-ids', origin: 'spikes/p3-store/s6/exp/roundtrip.ts', html: noIdsSlide },
];

export const CORPUS: readonly CorpusSlide[] = [...CLAUDE_SLIDES, ...LAYOUT_SLIDES, ...BENCH_SLIDES, ...S6_SLIDES];
