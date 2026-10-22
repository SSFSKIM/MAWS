# DESIGN.md: remote-architectures explainer

One long Korean article, `remote-architectures.html`, that explains end to end how three families of systems let someone drive a Claude Code session remotely:
- today's desk (the bridge mod);
- Claude's own protocols (Remote Control, the SDK stdio protocol, Desktop's SSH mode, the `--bg` supervisor);
- the session-holder design under research.

Tokens live once, in the `:root` block of that file.

## 0. Stance

**Commitment.** A quiet printed technical paper on a cool off-white ground. Every architecture is drawn on the same three horizontal lanes (클라이언트 / 중계 / 기계), so the eye compares systems by seeing which boxes and arrows move between the same lanes. That lane grammar is the signature. Color in the figures means one thing only: who owns a component. It is not a slide deck, a dashboard, or a marketing page. Tiebreaker: when ambiguous, choose the more legible option.

**Axis position.**
- **Density: standard.** Long-form reading with figures and tables. This is not row operation.
- **Criticality: exploratory.** The reader acts on nothing; they are building a mental model.
- **Energy: quiet.** The content is dense and technical; the figures carry the interest, and the chrome stays out of the way.
- **Type: neutral sans plus mono.** Korean body at reading size needs a sans with good Hangul (Apple SD Gothic Neo behind the system face). Mono marks only identifiers, commands and protocol names, which the text is full of.
- **Material model: printed.** Paper figures with hairlines. Nothing floats over changing content except the narrow-screen contents toggle.
- **Color commitment: full palette, confined to figures.** There are four ownership roles, each with a nameable job. The prose chrome is monochrome.
- **Accent job: none in the chrome.** Links are ink with an underline, focus is a visible ink outline, and the ownership hues appear only inside figures, in legends and in the comparison table's row keys.
- **Ground lightness: light.** The scene is the owner at their MacBook, by day or under a desk lamp, reading slowly and returning to figures. Long reading of small diagram labels favours dark ink on a light ground.
- **Ground temperature: cool neutral.** The subject is software on screens and machines. The ground shares hue 250 with the ink at very low chroma.

**Rejected vector:** quiet · mono-as-display · printed · restrained · directional · dark · cool (the sampler's "terminal"). It lost because monospace Korean prose at article length is tiring, and a dark ground makes four ownership tints muddy.

**Derivation of values.**
- **Engine role (clay, OKLCH h≈40).** Taken from Anthropic's own Claude identity, because the engine is Anthropic's product. It is a literal convention, not decoration.
- **Ours role (ink blue, h≈255).** The ground's own family, deepened: the systems we built share the article's ink.
- **Proposed role (highlighter yellow fill, h≈105, dashed ink outline).** Taken from design-review markup: a reviewer highlights what is new.
- **Rejected hue for proposed: teal (h≈190).** It reads as another existing product rather than an annotation, and it sits too near the ours role.
- **Rejected ground: warm off-white (h≈80, L 0.97).** It is the cream band, and nothing in a protocol explainer earns warmth.

**Clone check.** Another architecture explainer would share the constraints (standard, exploratory). It would not share the ownership palette argued from Anthropic's clay and review highlighter, nor the fixed three-lane grammar.

**Ingredients.**
- **Humanist sans:** kept as the type tradition through the system face.
- **Warm:** rejected as the cream band.
- **Brutalist:** rejected because it cannot carry this density of Korean prose.
- **Gradient canvas:** rejected; it has no job here.
- **Terminal:** kept only as a bounded mutation, mono labels on protocol identifiers inside figures.

## 1. Palette usage

| Token | Job |
|---|---|
| `--ground` | Page background. |
| `--paper` | Figure and table surfaces. White, a plain surface, not a cream token. |
| `--ink` | All body text and strokes. |
| `--ink-2` | Secondary text: captions, lane labels, table notes. |
| `--rule` / `--rule-strong` | Hairlines and figure borders. |
| `--engine` / `--engine-tint` | Claude Code processes (TUI, `claude -p`, the engine's own PTY host and supervisor). |
| `--anthropic` | Anthropic services and apps (api.anthropic.com, claude.ai, Desktop). Clay stroke on paper, no tint, so they read as Anthropic's but not as the engine. |
| `--ours` / `--ours-tint` | Things that exist today on our side: sminos daemon, bridge mod and child, desk-hub, desk-web, MAWS. |
| `--proposed` | Things the holder design adds. Highlighter fill with a dashed ink outline. |

- **Status colors:** none; the article reports no status.
- **Contrast:** every label inside a tinted box is `--ink`.
- **Color literals:** none outside `:root`, including inside the SVGs, which use classes.

## 2. Typography

- **Faces.** `--font-sans` (system-ui, then Apple SD Gothic Neo) for everything. `--font-mono` (SF Mono, ui-monospace) only for commands, flags, file names, protocol frames and identifiers, never for a whole sentence.
- **Scale.** Body 17px, line-height 1.75. h1 40px, weight 800. h2 27px, weight 750. h3 19px, weight 700. Caption and table text 14.5px. Figure labels are 13–14px in SVG units at 1:1.
- **Case and reading width.** Headings in sentence form. Prose measure is at most 40em, about 66 Hangul characters.

## 3. Canvas and material

- **Material: printed.** A flat `--ground`, figures on `--paper` with a 1px `--rule-strong` border and a 10px radius. Shadows: none.
- **The one floating element.** The narrow-screen contents disclosure is a `<details>` with an opaque `--paper` panel, not glass.

## 4. Layout

**Composition lines.**
1. **Posture: narrative.** An authored article read in order.
2. **Activity: read, then compare.** The reader builds a model and then lines systems up.
3. **Units and relations.** The unit is an architecture. The relations are a sequence (chapters) and a matrix (the comparison).
4. **Co-visibility:** each figure sits beside the prose that explains it, and the comparison is one table.
5. **Temporal structure:** static.
6. **Volume and homogeneity:** few (six architectures) and heterogeneous.

**Consequences.**
- **Dominant band:** the first viewport holds the title, the question the article answers, and the overview figure. That figure is three small multiples on the same lanes, because the brief names three things.
- **Order and columns:**
  - Chapters run in order, and the comparison table comes after the systems it compares.
  - One reading column of at most 40em; figures widen to at most 1040px.
  - On viewports of 1200px and wider, a contents rail of 220px sits left of a column of about 760–820px, a ratio above 3:1. Below 1200px the rail becomes a `<details>` at the top.
- **What repeats:** only the lane figures, and they repeat because the systems are compared on the same grammar.

**Ledger.**
- **Owner wants an end-to-end understanding** → systems must be comparable → every architecture figure uses the same three lanes in the same order → each `figure.lanes` SVG has the lane labels 클라이언트/중계/기계 top to bottom → forbidden: a figure with its own ad-hoc layout.
- **"Who owns the process" is the crux** → ownership is the only color meaning → fills come only from the four role classes → no role class appears on non-figure prose except the legend chips and the comparison-table keys → forbidden: decorative color.
- **There are many identifiers** → identifiers must be distinguishable from prose → `<code>` is mono with a light background → forbidden: mono paragraphs.

**Candidates.**
- **Chosen:** a narrative column with wide figures and a left contents rail on wide screens.
- **Rejected:** a two-pane layout with the figure pinned and the text scrolling beside it. The figures differ per chapter, and pinning halves the reading width.
- **Rejected:** a tabbed per-architecture view. It hides the comparison the owner needs.

**Defaults overridden.**
- No three-up feature cards. The overview is one figure.
- No stat row.
- No eyebrow kickers above sections. Chapter numbers are kept because the chapters are a real reading order.

**Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 72.

## 5. Components

The article uses six components; do not hand-roll variants.
- **`figure.lanes` with an SVG and a `figcaption`:** the architecture figure.
- **`.legend`:** ownership chips.
- **`table.compare`:** the comparison table.
- **`.note`:** a tinted aside for "why this matters", with a full hairline border and no side stripe.
- **`.steps`:** an ordered state sequence, for true sequences only.
- **`dl.glossary`:** the glossary.

## 6. Voice

Korean, plain declarative sentences ending in -다, as in the research notes.
- One idea per sentence.
- Numbers come with their source note.
- Facts that were read from code and not run are said so.
- No buzzwords and no rhetorical questions in headings.

## 7. Motion

None, apart from the browser's native `<details>` toggle. `scroll-behavior: smooth` is applied only under `prefers-reduced-motion: no-preference`.

## 8. Hard don'ts

- No color literal outside `:root`.
- No box-shadow.
- No gradient.
- No side-stripe borders.
- No glass.
- No gradient text.
- No ownership hue used as text color for prose.
- No figure without a caption.
- No lane order other than 클라이언트 / 중계 / 기계 from top to bottom.
