# P3-D — Design systems: execution document (2026-10-12)

> **Parent:** `docs/doperpowers/plans/2026-10-12-p3-co-work.md` (the P3 composite spec), child id **P3-D**, parent pin git blob `dda3d0b467e1e0e022484faa2ca2d28fd557f9a0` (the file at master 4a51531b, Decision Log through 38). **Interface ledger:** `docs/doperpowers/plans/2026-10-12-p3-interface-ledger.md`, blob `7385743053dcbc8b5ff1cecb3a1e4f193cd3ddbc` at the same commit, §4's X28 row (the `--ds-*` names, the type classes, `dev.maws.office`), §6 (the settings slot). **Grain:** plan. **Edges:** blocked-by P3-A for the artifact kind, the store, the IPC and `ArtifactHost` (A's branch `worktree-agent-a421d878947a3ead3` is merged into this branch and re-merged when something newer is needed; A's files are never edited here); P3-G for X32 (the page's header registration waits for G on master); blocks P3-C (the token names and one default); P3-B consumes the names only. **Owns:** X28. **Consumes:** X23, X24, X25 (the tools' shapes), X29's pin, X32. **Design inheritance:** the parent's §4.6 (binding: the object's shape, the token format, the CSS names), §4.3 (binding: the tool namespace, the guides under `src/artifacts/types/<kind>/`), §4.10 (binding: `src/artifacts/` portable), §2 item 6, §5 P3-D; Decision Log 7, 12, 21, 22, 26, 28, 36. The definition of the object is the owner's designer skill (`~/Developer/GitHub/designer/skills/designer/SKILL.md` 2.3.1, `references/guidelines-authoring.md`, `examples/`; read-only reference). Claude's design-system shape is `research/p3-claude-type-formats.md` §"Design System" (U1); the vendor files stay outside the repository.

## Purpose

After this child a design system is a thing the owner and the agent make, choose and apply, not a theme hard-coded in an editor.

- **The object.** A Design System artifact holds the designer skill's triad: `DESIGN.md`, the law (nine sections, authored, never generated); `tokens.tokens.json`, the values (W3C DTCG 2025.10, with the 12 Office theme slots and the major and minor fonts under `$extensions["dev.maws.office"]`); and the canon, `layouts/*.html` and `components/*.html` in the slide dialect plus `components/document.css` for documents. Generated beside them, never edited: `tokens.css` (the ledger's `--ds-*` properties and `.ds-type-<role>` classes) and the Office theme.
- **Three built-in defaults**, authored in that shape: MAWS's own look (the document default, Decision Log 7) and two the owner chooses for school and teaching work. They appear in the library as ordinary Design System artifacts the owner may edit.
- **The routes.** The agent adopts a system from a codebase, a deck or a website, or derives one for a brief, through the designer skill when the engine has it and through this kind's format reference when it does not; a system made in Claude's shape imports through a converter, and exports back for transfer.
- **The page.** Opening a Design System shows its palette, type scale, spacing, radii and shadows with their values editable in place, the canon and layouts rendered with the system, and `DESIGN.md` rendered (edited in P3-B's document editor once it lands). Editing a colour restyles the page at once. A check runs a system's hard don'ts against its own canon (and against a deck or a document once their editors register).
- **Applying.** A document or deck carries `designSystemId` and restyles by token swap when the system changes; with none set, the Space's default, then the owner's default, then the house system applies, and the agent honours that chain without asking. A retained version of a document or deck renders with the system's revision it pinned. A system that artifacts reference cannot be deleted until they move.
- **The `ask` sheet** gains a design-system question: the agent can ask the owner to pick a system, or to build one together.

To see it working once landed: `pnpm -C <worktree> dev` against a scratch user-data directory (never the owner's), open the Artifacts library, open "MAWS" under Design System, change the accent and watch the page follow.

What does not change: the engine and the wire (D-1); the app's own theme (`src/renderer/src/styles/tokens.css` stays the app's; the house system is a separate artifact that starts from its values); the document and slide editors' internals (B, C); the library (L).

## Progress

- [x] (2026-10-12 21:20 PDT) Grounding at master 4a51531b with A's branch merged (65f9a0f5 + fac0d0e1): the parent's §4 and §5, the ledger, A's execution document and its M1 code (`src/artifacts/host.ts`, the binding module, the guides' placeholders under `src/artifacts/types/design_system/`, `src/shared/artifacts/`), the `ask` tool's schema (`src/shared/maws/tools.ts`), the settings schema at version 13, the app's tokens, the designer skill's `SKILL.md`, `guidelines-authoring.md` and the FRAME example, U1's record of Claude's shape, the DTCG 2025.10 format (designtokens.org/tr/2025.10/format).
- [x] (2026-10-12 21:40 PDT) This document written; the three stances commissioned for the owner (§D11).
- [x] (2026-10-12 23:05 PDT) M1 — The token core: the DTCG model, the roles, `tokens.css`, the Office mapping. Commits 53a9d07f, fixes d124f508..87603f16 (the task review's four Important findings: an opaque-alpha fixed point, nested `$extends`, location-level `$ref` cycles, type classes through whole-typography aliases); re-review clean. 57/57 in `src/artifacts/design-system`; typecheck and lint green.
- [x] (2026-10-13 PDT) M2 — The law, the canon, the hard-don'ts check and the Claude-shape converter. Commits 41508243..f61d8e90; fix wave 1 17b956a0..025f4b38 and fix wave 2 582c9cec (the review's findings: prototype-safe import, `.ds-doc` containment at the selector's top level, assets-only URLs decoded and normalized and on SVG paint attributes, Claude's caps and one style namespace with `ClaudeShapeError` refusals, aliases over the deduplicated namespace, notes excluded from `accent-max`); re-review clean. `src/artifacts` 232/232 after A's re-merge (6647ff9b).
- [x] (2026-10-13 PDT) M3 — The document model and the kind adapter. Commits 6647ff9b..9a5aa388; fix wave 1 6336e62a..037d5c66 (merged hierarchies validated before serialization, metadata derived from the law, `force` per unit, setter bounds); fix wave 2 13878868..9e9e61a0 (a token's identity, `$root` on read, publish keyed by identity from the stored attributes); fix wave 3 3455fba2..ddf4dd52 (a moved token keeps its inherited `$type`; overlaps tested over real replicas). Third re-review: the original findings are closed; its one Important, a false conflict that fails safe, is carried into M4 (Decision Log 20). `model.test.ts` 41 tests; the covering suites 199/199.
- [ ] M4 — The apply-and-restyle API and the Design System page.
- [x] (2026-10-13 PDT) M5 — The three defaults and the kind's guide and format reference. Built 6a435e9a, 3503701a (merged d166892f); fix wave 7d747b62, fd922ef1 (the canon in the dialect's shape, the law-against-canon test); the round trip over every default f8ce239b; re-reviews clean.
- [ ] M6 — Store-backed: registration, seeding, settings, defaults, the pin, deletion, the agent's routes and the `ask` input (after A lands on master).
- [ ] M7 — Acceptance: the e2e group, the live run, the gates.
- [ ] Whole-branch review, its fix wave, Outcomes, hand-back.

## Terms

- **System**: a Design System artifact (kind `design_system`). **House system**: the built-in default keyed `maws`.
- **Law**: the system's `DESIGN.md`. **Token file**: its `tokens.tokens.json`. **Canon**: its `layouts/*.html`, `components/*.html` and `components/document.css`.
- **Role**: a token path every system must define, mapped one-to-one to a ledger CSS name (§D2).
- **Scope**: the element a consumer wraps its rendering in so one system's `--ds-*` values apply inside it and nowhere else (§D3).
- **Governing system** of an artifact: its own `designSystemId`, else its Space's default, else the owner's default, else the house system (§D9).
- **Pin**: a retained version's `designSystemRef {id, versionSeq}` (X29).

## Acceptance

Observable in unit tests and in the e2e group `e2e:design-systems` on a scratch instance (each line a test or a step):

1. A token file in DTCG 2025.10 with every role validates; one missing a role, holding a cycle, a bad colour or an unknown `$type` is refused with every problem named by path (unit).
2. `tokens.css` generated from a system defines exactly the ledger's `--ds-*` names (plus the system's extra tokens as `--ds-<path>`), inside the requested scope selector, and the eight `.ds-type-<role>` classes; aliases resolve; the output is byte-stable for equal input (unit).
3. The Office mapping yields the 12 theme slots and the major and minor fonts (Latin and East Asian) from `dev.maws.office`, derived from the roles when the extension is absent, and a DrawingML theme part that parses as XML (unit).
4. `DESIGN.md` parses into its nine sections in order, the `persona:` line and the hard don'ts with their `[check: …]` tags; a law missing a section is reported (unit).
5. The hard-don'ts check flags a literal colour, a foreign font family, a gradient and an over-limit accent in canon fixtures, passes clean canon, and lists unchecked don'ts as manual (unit).
6. A system in Claude's shape (a synthetic fixture written to U1's grammar) imports to a valid token file with its sources kept; a MAWS system exports to Claude's list-shaped `tokens.json` that satisfies the same grammar; DTCG maps are never emitted in the Claude export (unit).
7. A system's document model round-trips its files: `readFiles(write(files))` equals the canonical files; an agent publish whose sent token changed on both sides is refused naming the token; one whose tokens differ from the human's edited tokens merges and keeps the human's edit; a publish lands whole or not at all (unit, then through A's store in M6).
8. Each of the three defaults validates, passes its own law's mechanical checks on its canon, and meets the contrast floor (body text 4.5:1, large text and controls 3:1) (unit).
9. On the Design System page, editing the accent's value changes the rendered swatch and the page's `--ds-color-accent` within one frame of the doc update, and the canon preview when its frame's next load completes (Decision Log 22); the change persists across a reload (e2e).
10. A document fixture rendered through `tokens.css` in a scope restyles when its system's token changes (e2e); the deck counterpart is P3-C's and is listed for P3-F (hand-back).
11. A document fixture's retained version whose pin names an older system revision renders with that revision's values while the live fixture shows the new ones (e2e).
12. With no `designSystemId`, the governing system follows the Space default, then the owner default, then the house system (unit over the resolver; e2e over the settings).
13. Deleting a system that a live artifact references is refused naming the artifact; after the artifact moves, the delete succeeds and the fixture's retained version still renders with the pinned state (e2e, through A's store).
14. The `ask` tool accepts a `design_system` question; the sheet lists the systems with their swatches and "Build one with me"; the answer returns the chosen id (unit and e2e).
15. In a live run on the installed engine (scratch config home), the agent asked to "make a design system from this project" over a fixture project with a CSS-variables file creates a Design System artifact whose token file validates and whose law has the nine sections (live, M7).
16. Typecheck, lint (the portability rule included), the unit suite, `e2e:design-systems`, and the groups this branch touches pass.

## Design of the residue

The parent decides what a design system is (§4.6), its token format and CSS names (the ledger), and how it applies. This section decides the rest. Each decision gives its reason. Where an alternative was weighed, the losing one is named.

### D1. The token file

- **Format.** W3C DTCG 2025.10. Colour `$value` is `{colorSpace, components, alpha?, hex?}`. MAWS writes `srgb` with `hex` for readability. Dimensions are `{value, unit: 'px' | 'rem'}`, durations `{value, unit: 'ms' | 's'}`. `fontFamily` is a string or an array. `fontWeight` is 1 to 1000 or a named alias. `typography` is `{fontFamily, fontSize, fontWeight, lineHeight (number), letterSpacing?}`. `shadow` is one or several `{color, offsetX, offsetY, blur, spread, inset?}`. References are `"{a.b}"`; `$ref` pointers are accepted on read and resolved. `$type` is inherited from groups. `$root` names a group's base token. `$extends`, `$deprecated` and `$extensions` are kept as written (unknown extensions are preserved, as the format requires).
- **Reading is lenient, writing is canonical.** A hex string for a colour and a bare number for a px dimension are accepted on read and written back as the object forms. Key order is canonical (the role order of D2, then the remaining paths alphabetically). The serializer is a fixed point after one pass, so equality is by meaning (the slide dialect's rule, Decision Log 21). Reason: agents write hex by habit, and DTCG tooling reads only the object forms.
- **One theme per system.** A system's colours are the artifact's look and do not follow the app's light or dark theme, just as a Google Doc stays white in a dark browser. DTCG's modes are not used. Reason: a document or deck must look the same in the app, in a PDF and in PowerPoint. Rejected: light and dark pairs per role, which would double every system's values and the law's contrast checks for a surface the exports cannot show. `[parent-impact]`: P3-B's and P3-C's surfaces draw their own ground under a dark app theme.

### D2. Roles and the CSS names

Every system defines these token paths. The CSS name is `--ds-` plus the path's segments joined by `-`, with `$root` dropped. This is exactly the ledger's X28 list:

| CSS name (ledger) | Token path | `$type` |
|---|---|---|
| `--ds-color-bg`, `--ds-color-bg-raised` | `color.bg.$root`, `color.bg.raised` | color |
| `--ds-color-text`, `--ds-color-text-muted` | `color.text.$root`, `color.text.muted` | color |
| `--ds-color-accent`, `--ds-color-accent-text` | `color.accent.$root`, `color.accent.text` | color |
| `--ds-color-border` | `color.border` | color |
| `--ds-color-status-{ok,warn,error,info}` | `color.status.{ok,warn,error,info}` | color |
| `--ds-font-{display,body,mono}` | `font.{display,body,mono}` | fontFamily |
| `--ds-type-<role>-{size,line,weight}` for title, subtitle, h1, h2, h3, body, caption, quote | `type.<role>` | typography (size, line and weight are the composite's fontSize, lineHeight and fontWeight) |
| `--ds-space-{1..8}` | `space.{1..8}` | dimension |
| `--ds-radius-{sm,md,lg,full}` | `radius.{sm,md,lg,full}` | dimension |
| `--ds-shadow-{sm,md,lg}` | `shadow.{sm,md,lg}` | shadow |

The type roles carry document sizes. Decks need larger sizes on the 1920×1080 canvas. Those live under `$extensions["dev.maws.deck"]` on each `type.<role>` token as `{fontSize, lineHeight?}`, and the generator emits them only inside a deck scope (D3). The ledger fixes a single `--ds-type-<role>-size`, so a deck's slides read the same names and get the deck values from their scope. Reason: one name per role for B, C and the agent, with two scales the law can state. Rejected: `--ds-deck-type-*` names, which would put a second name family into the ledger and into every slide. A system may define further tokens (`color.highlight`, `motion.*`). They are emitted as `--ds-<path>` and documented in that system's law, but only the role names are shared across systems.

### D3. `tokens.css` and the scope

`generateTokensCss(tokens, {scope, medium: 'document' | 'deck'})` returns one stylesheet with three parts:

- the `--ds-*` custom properties on `scope`;
- the eight classes `scope .ds-type-<role>`, each setting the role's font-family (the composite's `fontFamily`, normally an alias of `font.display` or `font.body`), font-size, line-height, font-weight and letter-spacing as custom-property references, so an override of a property restyles the class too;
- `word-break: keep-all` on the type classes. The house rule for Hangul, switchable per system with `$extensions["dev.maws.css"].wordBreak`. Reason: Korean breaks mid-word otherwise, and `keep-all` does not change Latin text.

The default `scope` is `:root`, the form a standalone HTML export and a sandboxed frame use. In-app consumers use `[data-ds-scope="<scopeId>"]`, which the apply API (D8) assigns. Generated `tokens.css` read through `artifact_read` is the `:root` document form.

### D4. The Office mapping

`$extensions["dev.maws.office"]` on the token file's root holds two things:

- `theme`: the 12 DrawingML slots `dk1, lt1, dk2, lt2, accent1…accent6, hlink, folHlink`, each a colour value or an alias such as `"{color.text}"`;
- `fonts`: `{major: {latin, ea?, cs?}, minor: {…}}` (major for headings, minor for body; `ea` names the East Asian face that Korean text uses in Word and PowerPoint).

When the extension is absent, every slot is derived:

- `dk1` = text, `lt1` = bg, `dk2` = text-muted flattened onto bg, `lt2` = bg-raised;
- `accent1` = accent, `accent2…5` = status info, ok, warn and error, `accent6` = border flattened onto bg;
- `hlink` = accent, `folHlink` = text-muted;
- the fonts are the first family of `font.display` and `font.body`.

Two functions serve X31's PPTX and DOCX mappers (B, C): `officeTheme(tokens)` returns the resolved object, and `officeThemeXml(tokens, name)` returns the `a:theme` part both formats share. Reason: both exporters post-process the same theme part (§4.5, §4.4). One generator keeps a deck and a document from the same system identical in Office.

### D5. The law and the hard-don'ts check

`parseLaw(markdown)` splits `DESIGN.md` into sections 0 to 8:

- each section's heading number is matched in order, so the title words are free;
- the `persona:` line in §0 is read;
- each bullet of §8 becomes one hard don't;
- sections after 8 are kept as extra sections, as the skill allows.

A don't that is mechanically checkable carries one or more tags at its end, `[check: <rule>]`. The tag is visible in the rendered law, so the owner sees which rules the machine checks. The vocabulary:

| Tag | What it checks |
|---|---|
| `literal-color` | No colour literal whose value is not a token value. |
| `font-family` | No family outside `font.*`. |
| `no-gradient`, `no-shadow` | No gradient; no `box-shadow` outside `shadow.*`. |
| `accent-max:<n>` | At most n elements painted with the accent per slide or component. |
| `radius-max:<px>` | No radius above the given px. |
| `type-scale` | No font-size outside the type roles' sizes. |
| `max-words:<n>` | No more than n words per slide or component. |
| `contrast:<ratio>` | No declared text and ground pair below the ratio. |

A system may record a tag MAWS does not know. The check reports it as unknown rather than ignoring it.

`checkHardDonts(law, tokens, target)` runs over an abstract element stream (`{tag, style, text, children}`):

- canon files supply it now, through an HTML adapter given a DOM parser (the renderer's `DOMParser`, happy-dom in tests);
- a deck's slides and a document's rendered DOM supply it once C and B register.

The result lists violations by file or slide and element, plus the untagged don'ts as manual items for the owner or the agent to judge. Reason: the skill's QA step says "mechanically where they are mechanical". Prose rules cannot be machine-read without a marker, and an inline tag keeps the rule and its check in one sentence. Rejected: a separate checks file, which would split usage from its law.

### D6. The canon

- `layouts/<name>.html` is one slide-dialect `<section id>` (§4.5) whose placeholder elements carry `data-ph="<role>"`. The roles are `title`, `subtitle`, `body`, `image`, `caption`, `notes`, or a name the law defines. C's "new slide from layout" fills them and strips the attribute.
- `components/<name>.html` is one root element in the dialect: a status chip, a callout, a table style.
- `components/document.css` styles document blocks for this system, only under `.ds-doc` with element and attribute selectors (`.ds-doc blockquote`, `.ds-doc table`, `.ds-doc [data-callout-tone="warn"]`) and only with `var(--ds-*)` values. B's editor root carries the class `ds-doc` inside a scope.

Each canon file is named in `DESIGN.md` §5. Validation here is structural only: one root, `var()` only of `--ds-*` names, no script, no URL outside `assets/`. C's parser is the dialect's authority.

`[parent-impact]` names for the ledger: `data-ph` (C's loader must keep it on canon layouts), `.ds-doc` and `data-callout-tone` (B's editor root and callout). Rejected: placeholders by id convention, which collide with C's minted ids and do not survive an id repair.

### D7. The document model (format version 1)

One Y.Doc per system with four root nodes, all through the binding module:

- `meta`, an attribute map: `formatVersion: 1`, `name`, `origin` (`{route: 'default' | 'adopted' | 'derived' | 'imported' | 'blank', key?, from?, at}`) and `persona?` (mirrored from the law for the library).
- `tokens`, an attribute map: one attribute per token keyed by its path (`color.accent.$root`), holding the token object, plus one attribute per group's and the root's own properties keyed `<path>/$group`. A token is the unit of merge and history. Token-level authorship and token-level publish conflicts follow from it (C's property-level merging, Decision Log 26).
- `law`, the `DESIGN.md` source as the node's text. The page's edits and the agent's publishes apply as a character diff, so a concurrent edit elsewhere in the law survives.
- `files`, an attribute map: canon path to source text, replaced whole per file. Canon files are small, and a conflict on one is refused naming it.

Assets are A's (`artifact_upload_asset`, referenced as `assets/<name>`). Generated files are never stored; they are pure functions of the model.

The agent's file view, through `readFiles`, is `DESIGN.md`, `tokens.tokens.json`, every canon file, and the generated `tokens.css` and `office-theme.json`, marked generated. A publish that sends a generated file is refused naming it. A publish is a `KindAdapter.publish` over A's three layers (A's Decision Log 10):

- the sent token file is diffed against the agent's base token by token;
- conflicts are tokens that changed on both sides;
- the law conflicts only when the agent's base-to-sent hunks overlap the human's base-to-live hunks;
- canon conflicts are by file.

**Migration when B lands.** The law becomes editable in B's document editor. That editor binds a ProseMirror fragment, not text, so at B's landing the model goes to format version 2: the `law` text converts once into B's schema through B's Markdown importer, as an `import` update, and `readFiles` serializes it back to `DESIGN.md`. Reason: B's schema module does not exist yet, and writing its node shapes before it lands is the schema-drift risk of §8. Recorded for B and P3-F. Rejected: the law as a separate `document` artifact. The parent makes the system one versioned artifact, and two artifacts would need two pins.

### D8. The apply-and-restyle API (`src/artifacts/design-system/apply.ts`, portable)

Sent to the architect for the ledger before B or C code against it.

    type DesignSystemRef = { id: string; versionSeq?: number };      // live when versionSeq is absent; X29's pin when present
    type TokenOverrides = Record<string /* a --ds-* name */, string /* a CSS value */>;
    function governingSystem(a: { designSystemId?: string; spaceId?: string },
                             d: { owner: string | null; spaces: Record<string, string>; house: string | null }): DesignSystemRef | { builtin: 'maws' };
    interface DesignSystemView {                                     // one open system
      readonly tokens: TokenSet; readonly law: string; readonly name: string;
      css(scope: string, medium: 'document' | 'deck', overrides?: TokenOverrides): string;
      subscribe(listener: () => void): () => void;                   // fires on every change of a live system
      close(): void;
    }
    function openDesignSystem(host: ArtifactHost, ref: DesignSystemRef | { builtin: 'maws' }): Promise<DesignSystemView>;
    // React
    function useDesignSystem(ref: DesignSystemRef | { builtin: 'maws' } | null): { view: DesignSystemView | null; status: 'loading' | 'ready' | 'missing' };
    function DesignSystemScope(props: { system: DesignSystemRef | { builtin: 'maws' } | null; medium: 'document' | 'deck';
                                        overrides?: TokenOverrides; className?: string; children: ReactNode }): JSX.Element;
                                        // a div with data-ds-scope, its <style> injected once per (system, medium, overrides) and refcounted
    // export helpers
    function resolveDsVars(cssText: string, tokens: TokenSet, medium: 'document' | 'deck'): string;  // var(--ds-*) to literals (the Claude-compatible deck, §4.5)
    function officeTheme(tokens: TokenSet): OfficeTheme;  function officeThemeXml(tokens: TokenSet, name: string): string;

**Restyle.** It is by reference. A live ref subscribes to the system's replica, and a change rewrites the scope's `<style>`, so every consumer restyles in the same frame with no write to the consumer's artifact.

**Override per the brief.** This is the chain's first link. A consumer stores a `TokenOverrides` map in its own model: B in a root attribute `dsOverrides`, C in the deck map's design-system entry, their choice. It passes the map to the scope. The pin covers it because it is the consumer's own content.

**A version ref** reads the pinned state once through `ArtifactHost` (D12's request) and never subscribes.

**The built-in floor.** `{builtin: 'maws'}` renders the bundled house tokens with no store access. It is used only when no house artifact exists: the store not yet seeded, or the owner deleted it.

### D9. The default chain and the settings

**Settings version 14** (the slot of the ledger's §6; the architect assigns the number at landing) adds `artifacts: { defaultDesignSystem: string | null, spaceDesignSystems: Record<string, string> }`. Both default to empty. `null` means the house system. A deleted or missing id is skipped down the chain, never an error.

**The host's chain.** The host resolves the chain for the agent from the settings main already pushes to it. If it has no route to read settings, that is a request to A, raised in M6. The chain is used:

- when `artifact_create` makes a document, deck or design without a `designSystemId`, it sets the governing system and attaches that system's `DESIGN.md`. The guide is never generated (Decision Log 22, §4.3's "attached on create without asking");
- when `artifact_describe_type` is asked for a kind that uses one.

**The house system.** It is the earliest-created live system whose `meta.origin.key` is `maws`.

**Seeding.** When the store holds no `design_system` artifact at all, deleted ones included, the host's design-system module creates the three defaults from their bundled sources (`origin: {route: 'default', key}`). An owner who deleted them is never re-seeded, and a fresh store is.

Rejected:
- Settings ids recording the seeded artifacts: a second source of truth.
- The defaults as bundled read-only themes outside the store: the owner could not edit them, and a version could not pin them (X29's pin is `{id, versionSeq}`).

### D10. Deletion and the pin (requests to A through the architect)

- `artifacts.delete` of a `design_system` refuses while any live artifact's `designSystemId` names it: `designSystemInUse {artifactIds}`. The page shows the list with "Move them to…". Defaults in the settings that name it fall through the chain.
- When A writes a version of an artifact with a governing system, the pin's `versionSeq` must name a retained state equal to the system's live state at that moment. If the system moved since its last version, A first writes an `auto` version of the system. That system version is pinned, never thinned, and kept while referenced, per A's Decision Log 8. Reason: pinning "the system's latest version" would render an old document with a system state older than the one it was seen with.
- `ArtifactHost` gains a read of a retained version's state, needed by D8's version refs and by B's history alike: `versionState(artifactId, versionId | {seq})` → V2 bytes.
- `artifact_create`'s attachment of the governing system's law (D9) is a host-side provider this child registers: `designSystemContext(artifact) → {id, name, law, tokensSummary}`.

### D11. The three defaults

The house system (`maws`) adopts the app's values into a document and deck system ("adopted from MAWS's app tokens", Decision Log 7). The other two are the owner's choice:

- the first users are school and teaching documents;
- decks for class and staff come next.

Three stances with rendered previews go to the owner through the architect at the first checkpoint. All three are authored in full (M5) only after the answer, through the designer skill's practice. Each is about 300 lines of law with the nine sections and the rejected candidates, plus a token file, three to six layouts and the components the law names. Faces must render on the owner's Mac. The Office pairing names faces present on school Windows PCs (Malgun Gothic and the like). A bundled OFL face is the owner's call, given its size.

### D12. The agent's routes

The kind's `SKILL.md` and `format.md` are A's placeholders under `src/artifacts/types/design_system/`, filled here.

The guide says, in the skill's words:
- a design system is the project's committed visual law;
- if the `designer` skill is available, invoke it: adopt when the source has a system (record "adopted from <system>", read the nine lines off it), derive otherwise (sampler or persona, one stance, `DESIGN.md` before tokens);
- without the skill, follow the format reference's condensed version of the same rules;
- write the system with `artifact_create {kind: 'design_system', title, files}`: `DESIGN.md` first, then the token file, then the canon;
- read it before touching anything under it, and check built work against its hard don'ts.

The format reference carries the token file's grammar and the roles table, the law's nine sections and the check tags, the canon's conventions, and the limits. The limits are:
- 64 tokens per group;
- 512 tokens;
- 256 KB for the law;
- 64 canon files of at most 64 KB each.

These bounds keep a system readable in one `artifact_read`.

"From a codebase, a deck or a website" (§2 item 6) is the adopt route over whatever the agent can read: files, a deck's files through `artifact_read`, a page through the browser tools. MAWS adds no extractor of its own, because mapping a project's variables onto roles is a judgment the skill already makes.

The Claude-shape import is `artifact_create {kind: 'design_system', files}`. The files are Claude's (`design-system.json`, `tokens.json`, `README.md`, `components/*/README.md`, `fonts/`). The adapter detects that shape and converts it:
- the token file, from Claude's list form;
- `sources/claude/…` kept as read-only files;
- no law, so the page shows "No law yet" and offers "Ask the agent to adopt it", the adopt route with "adopted from <title>". A law is never generated (Decision Log 22).

The export to Claude's shape is `artifact_export {format: 'claude'}`. It writes Claude's list-form `tokens.json` (colours as hex, type as Claude's `fonts`, `families` and `groups` block), `README.md` from the law, and the assets.

### D13. The `ask` input (P1 P-13)

`ASK_MODALITIES` gains `design_system`, and a question of that modality may set `allowCreate?: boolean` (default true). The sheet shows:
- each live system as a row with its name, its five main swatches and its origin;
- "Build one with me" when `allowCreate`;
- the usual "decide for me" and skip.

The answer is `{designSystemId}` or `{create: true}` (the agent then runs the derive route through the session). `[parent-impact]`: the modality name on the P1 `ask` tool (`src/shared/maws/tools.ts`, a shared file appended after A).

### D14. The page

`src/artifacts/design-system/page/` (portable React, app tokens for its chrome, D8's scope for every preview) has six sections:
1. **Palette:** each colour role as a swatch with its hex field and a colour input; editing writes the token in one transaction; contrast badges for the four pairs D11 names.
2. **Type:** each role set in its own class with real Korean and English sample text, size, line and weight editable, document and deck values side by side.
3. **Space, radius, shadow:** as rulers and tiles.
4. **Canon:** each layout rendered at 1920×1080 scaled to fit, each component, and `document.css` applied to a fixed sample document. These render in a sandboxed `srcdoc` frame with `tokens.css` inlined and a CSP of `default-src 'none'; style-src 'unsafe-inline'; img-src` A's asset scheme. Canon is agent-written HTML, untrusted content, which §1 puts in frames.
5. **Law:** `DESIGN.md` rendered through `streamdown` until B's editor lands (D7).
6. **Check:** the hard-don'ts check over the canon, listing violations and manual items.

The header registers with X32 once G lands:
- the title;
- the saved state;
- the actions "Check against law", "Set as my default" and "Export for Claude".

The page is reachable from the library (L's kind-to-editor dispatch) and, until L lands, from the e2e seam this child adds. Who owns the kind-to-editor mount is asked of the architect (checkpoint 1).

## Plan of Work

Milestones are dispatched one executor each (`doperpowers:task-executor`) and reviewed at each dependency frontier (`doperpowers:task-reviewer`). M1 → M2 and M3 (independent) → M4 → M5 (after the owner's answer) → M6 (after A lands on master; G for the header) → M7.

### M1 — The token core

**At its end:** `src/artifacts/design-system/` holds:

| File | What it holds |
|---|---|
| `tokens.ts` | The DTCG 2025.10 model: zod schemas for the token types D1 lists, parse with paths in every error, `$type` inheritance, `$root`, `$extends`, `$ref`, alias resolution with cycle detection, the canonical serializer, the role table and `validateRoles`. |
| `color.ts` | Colour values to CSS (`#rrggbb[aa]` for srgb, `color(…)`/`oklch(…)` otherwise), relative luminance, the WCAG contrast ratio, alpha flattening onto a ground. |
| `css.ts` | `generateTokensCss` per D3. |
| `office.ts` | `officeTheme` and `officeThemeXml` per D4. |
| `index.ts` | Re-exports. |
| `fixtures/` | Test token files. |

The DTCG details are checked against designtokens.org/tr/2025.10 (format and color modules). Where the published text differs from D1, the executor follows the published text and records the difference here.

**Proves:** Acceptance 1 to 3 in unit tests. The canonical serializer is a fixed point over the fixtures and over every lenient form. Generated CSS is snapshot-free: assertions name the properties and values.

**Does not touch:** anything outside `src/artifacts/design-system/`.

### M2 — The law, the canon, the check, the converter

**At its end:** four more files under `src/artifacts/design-system/`:

| File | What it holds |
|---|---|
| `law.ts` | `parseLaw` per D5. |
| `canon.ts` | Structural validation per D6, and `canonElements(html, parser)`, the HTML adapter to the element stream. |
| `check.ts` | `checkHardDonts` with D5's vocabulary. |
| `claude.ts` | `fromClaude(files)` → `{tokens, sources, warnings}` and `toClaude(system)` → files, to U1's grammar, which the executor reads at `~/claude-desktop-re/artifact-types/2026-10-12/design-system/artifact-type/reference/format.md` lines 73 to 118 and `SKILL.md` 99 to 113 (outside the repository; never copied in). |

The test fixtures in Claude's shape are synthetic, written to that grammar.

**Proves:** Acceptance 4 to 6.

### M3 — The document model and the kind adapter

**At its end:** `src/artifacts/design-system/model.ts` (portable, Yjs only through `src/artifacts/yjs/`) holds the D7 layout:
- `writeSystem(doc, files, origin)`;
- `readSystem(doc)` → `{meta, tokens, law, files}`;
- `readFiles(doc)`;
- `setToken`, `setLaw` (as a diff), `setFile`;
- `publishSystem(live, base, sent, force)` → `{changed, conflicts}` with D7's merge rules, all-or-none.

The adapter object `designSystemAdapter: KindAdapter` matches A's `KindAdapter` as it stands on A's branch at the time. If A's M3 has not yet added `readFiles`/`publish` there, the functions ship with the signatures A's document names, and the registration waits for M6.

**Proves:** Acceptance 7 at the model level. Two replicas (a human's and an agent's) over the binding module's docs, with the agent's base captured as A's Decision Log 9 describes. The conflict, merge and atomicity cases. The law's concurrent edit surviving a publish. Generated files refused on publish.

### M4 — The apply-and-restyle API and the page

**At its end:** `apply.ts` (D8) and `page/` (D14), portable React, with the bundled house tokens as the floor (`src/artifacts/types/design_system/defaults/maws/tokens.tokens.json` exists from here; a provisional transcription of the app's values that M5 replaces with the authored file).

**Proves (unit, happy-dom):**
- a scope's `<style>` changes when a live system's token changes, and every consumer of the same system shares one style element;
- a version ref never subscribes;
- overrides apply after the system;
- the page renders all six sections from a fixture doc, and an edit in the palette writes the token;
- the check lists a fixture's violations;
- the canon frame's `srcdoc` carries the CSP.

### M5 — The three defaults, the guide and the format reference

**Waits for:** the owner's answer on D11's stances.

**At its end:** `src/artifacts/types/design_system/defaults/<key>/` for the three systems, each with:
- `DESIGN.md`, the full law in the skill's nine sections with check tags;
- `tokens.tokens.json`;
- layouts and components;
- `components/document.css`.

`src/artifacts/types/design_system/SKILL.md` and `format.md` are written per D12, and a bundle module exposes the defaults' files to the host and the renderer through `?raw` imports, as A's `guides.ts` does.

**Proves:** Acceptance 8. Each default's files pass `writeSystem` → `readFiles` unchanged, and the format reference's examples validate.

### M6 — Store-backed integration

**Waits for:** A on master (re-merged); G on master for the header.

**At its end:**
- the host's design-system module (`src/engine-host/design-systems/`) registers the adapter, seeds the defaults (D9), serves `designSystemContext` (D10), and resolves the chain for the agent's create;
- settings version 14 (D9) with its migration and the Settings › Artifacts rows "Default design system" and the per-Space list;
- the `ask` modality (D13) through the tool schema, the sheet and the result;
- the page mounted (L's dispatch or the seam) and registered with X32;
- deletion's refusal surfaced, the export to Claude's shape registered with A's export service, and the version-ref read through A's `ArtifactHost`.

Every request of D10 that A's landed code does not meet is raised to the architect, not coded around.

**Proves:** Acceptance 7 (through the store), 12 to 14 in unit tests and the first e2e cases.

### M7 — Acceptance

The full `e2e/design-systems.spec.ts` and a package script `e2e:design-systems`, covering Acceptance 9 to 14. A document fixture is a minimal page rendered in a scope through `tokens.css`, standing for B's editor until B lands. The live run of Acceptance 15 is a `test/live/` case under `MAWS_LIVE=1`. The gates: typecheck, lint, units, the e2e group, and `e2e:panel` and `e2e:settings` as touched. The document and deck restyle cases that need B's and C's editors are listed in the hand-back for P3-F's check.

## Concrete Steps

- Run every focused unit test as `/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh env NODE_OPTIONS=--disable-warning=ExperimentalWarning npx vitest run <paths>` from the worktree (`pnpm test -- args` passes no args).
- Run the suite, typecheck, lint, builds and e2e the same way through the slot script, one e2e group at a time, with `MAWS_E2E_QUIET=1`.
- Use absolute paths, `git -C` and `pnpm -C`. Never `cd` into the worktree in a committed script.
- Commit each milestone's work in small commits, each subject line beginning `P3-D …` with the parent pin cited as in this document's header (`docs/doperpowers/plans/2026-10-12-p3-co-work.md`, child P3-D, pin dda3d0b4 at 4a51531b) on milestone-landing commits. No attribution lines.

## Interfaces and Dependencies

No new dependency is planned. The XML for `officeThemeXml` is written by string templating with escaping. The diff for the law's character-level apply uses the `diff` package if it is already in the tree, else a small Myers implementation in `model.ts`; the executor checks first and records which. React and `streamdown` are already dependencies.

Produced for others (to the ledger through the architect):
- D2's role table (already the ledger's names);
- D3's scope attribute `data-ds-scope`;
- D4's `officeTheme`/`officeThemeXml`;
- D6's `data-ph`, `.ds-doc`, `data-callout-tone`;
- D8's API;
- D9's settings fields;
- D13's modality;
- the kind's files layout of D7 (`readFiles` paths).

Requested of A (through the architect): D10's four items, and in M6, if absent, the host's read of the settings.

## Surprises & Discoveries

- 2026-10-12: the harness gave this child no worktree of its own (the session opened in the main checkout on master), so the branch `p3-d-design-systems` was created at `/Users/new/Developer/GitHub/MAWS/.claude/worktrees/p3-d-design-systems` from master 28dd4d9c, with A's branch merged and then master 4a51531b.
- 2026-10-12: DTCG 2025.10 has object-valued colours and dimensions (`{colorSpace, components, hex}`, `{value, unit}`) and a reserved `$root` token name. The second is what lets the ledger's `--ds-color-accent` and `--ds-color-accent-text` be one group's base token and its child.

## Decision Log

1. 2026-10-12: the residue decisions D1 to D14 above, taken at grounding. The `[parent-impact]` items (D1's one theme, D6's three names, D8's API, D10's requests, D13's modality) go to the architect at checkpoint 1 before any sibling codes against them.
3. 2026-10-12 (the architect's ruling, parent Decision Log 39; the ledger's X28, X23, X24, X25, §6 and §7 rows): every `[parent-impact]` item of checkpoint 1 accepted. D1 is binding on B and C. D2's naming rule stands, but **the slide dialect accepts only X28's fixed names**: a system's extra tokens are usable in documents and the page, never in slides, and the law and format reference say so. D3/D8's API is on X28 as written (B and C code against it now). D6 and D7 as proposed; the law's format-2 conversion is a P3-F item and this child writes none of B's node shapes. D9: settings 14 fixed in the P1 ledger (`SETTINGS_DEFAULTS_V13` renamed `V14`, `fromV13`), with the seeding and house-system rules. D10's four requests sent to A with the pin rule as corrected here. D13 recorded as an append to `tools.ts` after A. **The kind-to-editor mount is L's:** `registerArtifactEditor(kind, {Panel, Main?})` in `src/renderer/src/artifacts/registry.ts` (name fixed); this child registers its page into it and keeps the e2e-only seam until L lands (M6).
4. 2026-10-12 (A's answer to D10, through the architect; on the ledger): the context provider registers through `registerDesignSystemContext`; the defaults reach the host as the command `artifacts.setDefaults {owner: string | null, spaces: Record<spaceId, designSystemId>}`, which main pushes at every host connection in the ready burst and on every settings change, and which the store persists in its meta table so a detached host honours them while main is absent (D9's "the host reads the settings" is this command; M6 wires main's push); `ArtifactHost.versionState(artifactId, versionId | {seq})` returns V2 bytes; the pin writes a system `auto` version first when the system moved. M4 and M6 code against these names.
5. 2026-10-12 (X32 amendment from G's M3 review, ledger be4b8ccf §5, binding on D14's page): an editor-host registration lives as long as its tab, not its mounted body; `useEditorHost` keeps it through unmount and the host clears it when the panel instance is disposed or the main tab closed or replaced. The page's `closeGuard` and actions ("Check against law", "Set as my default", "Export for Claude") therefore read the tab's own state (the system's document through its handle, the settings store), never a body component's state.
6. 2026-10-12 (the owner, parent Decision Log 42 and 43, master 707109aa): **the three defaults are approved** as proposed at 7fc65b78 (`maws`, `classroom`, `official`), with these changes:
   - `classroom` is redrawn for high-school and university readers in a mature register: no rounded face, body near 16 px, slides sized for a lecture room, and the copier-and-projector logic and the single filled colour kept.
   - `official` stays one ink, with no school variant.
   - **The product's cultural frame is the United States, or culture-neutral where a choice can be avoided** (charter §19). Specimens and sample content are set in a US high school and university, English first, with Korean kept in the type specimens. `official`'s look stays and its closing and paperwork register become a US institution's.
   - **The default page size is US Letter, A4 selectable, as a token of the system**: the root extension `$extensions["dev.maws.page"] = {size: 'letter' | 'a4', margin: <dimension>}`. DTCG has no page type, and a size is a document setting, not a CSS value, so it is not a `--ds-*` name. It reaches B's print path and DOCX section and C's PDF only as their default. M5 writes it into each default.
   - Noto Serif KR is bundled for `official`'s body as a WOFF2 subset (OFL), Regular and Bold, under that default's `assets/`. M5 ships it and records the size.
   - Pretendard is not bundled.
   - HWP/HWPX export is a tracker row added at landing (residue).
   - M5 is unblocked and starts from the revised previews (`stance-<key>-v2.png`).
7. 2026-10-12 (the owner, parent Decision Log 44): **the defaults matter less than the machinery.** The three ship at a good-enough level from the redraw, with no polish loop. More defaults come later, and a school or a teacher gets their own system and components in P4. So:
   - **Defaults are data.** The defaults are a list of bundled directories under `src/artifacts/types/design_system/defaults/`, enumerated by one bundle module. Seeding, validation tests and the page read that list, never three hard-coded keys, so a fourth default is a new directory and one line.
   - **The house key is the only named default.** `maws` is the one key the code names, and only for the floor of D8 and D9.
   - **A per-school or per-teacher system is an ordinary artifact.** Nothing in the apply API, the chain or `artifacts.setDefaults` distinguishes a seeded system from an authored one.
8. 2026-10-12 (M1's decisions, folded from its report). Where the published DTCG 2025.10 text differs from D1, M1 followed the published text.

   **Where the code lives.** The core is five modules under `src/artifacts/design-system/`: `values.ts`, `resolve.ts`, `roles.ts`, `extensions.ts` and `tokens.ts`. `tokens.ts` re-exports the roles. All 13 DTCG types are accepted.

   **Typography.** `letterSpacing` is a required field of the composite; an absent one is written as `0px`.

   **Colour.** The `hex` field holds 6 digits; alpha is kept apart from it. An srgb `hex` is always recomputed from the components, and `alpha: 1` is dropped.

   **References.**
   - A group's base token is referenced as `{group.$root}`, never `{group}`.
   - `$ref` takes all three of its forms: an alias, `$extends`, and a property pointer.

   **Lenient reading** accepts more than D1 lists:
   - `"12px"` and `"1rem"` strings;
   - durations;
   - CSS font-stack strings;
   - `#rgb` and `#rgba`.

   A numeric string such as `"700"` is refused as a font weight.

   **The canonical writer** is its own JSON writer, because JS objects hoist integer-like keys such as `space."1"` to the front. Keys inside `$extensions` are sorted.

   **`tokens.css`.**
   - The custom properties carry resolved literal values.
   - The type classes always read size, line and weight through `var(--ds-type-<role>-*)`. They read `font-family` and `letter-spacing` through `var()` only when the composite aliases a token that wrote a ledger name; otherwise they write the literal. No names beyond the ledger's are added for those two properties.
   - An extra typography token writes its triple of properties but gets no class.
   - Names and font strings are escaped, so no value can end a `<style>` element.

   **Office mapping.**
   - Font derivation skips generic families and system aliases such as `-apple-system`.
   - Every derived slot is flattened onto `lt1`.
   - A partial `dev.maws.office` extension is filled in slot by slot and face by face.

   **Limits.** D12's limits of 512 tokens and 64 per group are enforced in `validateTokenFile`.
9. 2026-10-12 (the revised previews, 8b538853, `stance-<key>-v2.png`): these are M5's source.
   - **`classroom`** is set in Seravek with Apple SD Gothic Neo. Seravek's tailed l keeps l, I and 1 apart in chemistry text. Body is 16/1.65 on paper and 48 px on decks. Radii are 4, 8 and 12. The Office Latin face is Trebuchet MS. The signature is a square cobalt part tab.
   - **`official`** keeps its look and closes with a US signature block.
   - **Noto Serif KR is bundled as full-Hangul WOFF2 subsets.** The set is 11,172 syllables plus KS X 1001 symbols, jamo, Basic Latin and punctuation, from notofonts/noto-cjk's Korean OTFs via pyftsubset. Regular is 1.81 MB and Bold 1.90 MB, 3.54 MB together. Rejected: the KS X 1001 set (1.13 MB), which fails on rarer syllables the owner types. The OFL text ships beside the fonts. Office names Batang as the East Asian minor face, and US Windows without Korean supplemental fonts substitutes.
   - M5 runs in a sibling worktree on disjoint files (`src/artifacts/types/design_system/`) while M2 and M3 run here. Its law-against-canon test waits for M2's `parseLaw` and `checkHardDonts`.
10. 2026-10-12 (X32's final rule from G's M3, abf3c9b8, ledger §5; supersedes entry 5's detail): a registration lives as long as its tab; a remount of the same tab's body replaces it quietly; a mounted body withdraws only by passing a null or different scope to `useEditorHost`, and unmounting withdraws nothing; the host clears a scope only when the tab itself goes. The page keeps the hook in one stable body component; a retained `closeGuard` or action reads the tab's own state, never an unmounted component's; under 360 px the header folds every action and export into "More actions" (the page adds no menu of its own).
11. 2026-10-13 (M2's decisions, folded from its report; the exported API is in its report).
    - **The element stream.** It is `{tag, attrs, style (a declaration list), text, children, at}`. `at` is a selector-style locator that violations name.
    - **Per-slide counts.** `accent-max` and `max-words` count per slide or component. Speaker notes are excluded.
    - **`literal-color`.** It passes a literal that equals any token's colour. A law wanting every literal refused needs a new tag.
    - **`contrast`.** In HTML, the text and ground pair is inherited down the tree. In a stylesheet, only rules that declare both are checked.
    - **Canon slides and components.** They may `var()` only X28's fixed names (entry 3) and never declare a custom property. `href` falls under the assets-only rule.
    - **D6 amended.** `components/document.css` may hold `@font-face` blocks whose URLs point under `assets/`, anywhere in the file.
    - **D1 amended.** `$extensions["dev.maws.page"]` is validated as `{size: 'letter' | 'a4', margin?: dimension or alias}`.
    - **Claude import.** Claude's tokens are kept under their own names, and each role aliases the token that plays it.
      - A name written like a role's CSS name (`bg-raised`, `status-ok`) fills that role directly.
      - Remaining roles are matched by name, else derived or given a neutral value, with one warning each.
      - Only the first colour theme is read.
      - `deck-<role>` type styles fold into that role's deck scale.
    - **Claude export.** Colours are written as 8-digit hex, and translucent shadow colours as `rgb()`. Importing an export restores every role's value.
    - **Modules.** The CSS reader is `css-read.ts` and Claude's grammar is `claude-grammar.ts`. The mapping in `claude.ts` is about 850 lines; its role tables may move out if it grows.
12. 2026-10-13 (M3's decisions, folded from its report; the API is in it).
    - **The diff.** The law's character diff is `fast-diff` 1.3.0, already in the tree and now declared as a direct devDependency.
    - **What a law conflict is.** Law hunks conflict when they share a character, or when an insertion falls inside or at the edge of the other side's change. A hunk both sides made identically is not a conflict.
    - **Refusal is separate from conflict.** Content the system cannot hold is refused with `SystemFilesError` (`code: 'invalid'`, `data.problems`), and `force` does not get past it. That covers generated files, `sources/claude/`, `assets/`, unknown paths, an invalid token file and the limits.
    - **A failing merge is a conflict.** A merged token file that fails validation is reported as a conflict, for example when the agent deletes a token the human has just aliased.
    - **Only changed tokens are written.** A token whose value did not change is not rewritten, so each token keeps its own author.
    - **Claude imports.** Imported Claude files live read-only under `files` at `sources/claude/`.
    - **The adapter.** `createDesignSystemAdapter({parser?})` checks canon structure only when it is given a parser.
    - **The Yjs boundary.** `model.ts` is not re-exported from `index.ts`, so token-only consumers do not load Yjs.

    **Derived metadata is never stored (the controller's decision after M3's review).** `meta.persona`, and `meta.name` wherever it mirrors the law's title, are computed from the converged law on every read. A stored mirror written by the local replica diverges from the CRDT-merged text: two replicas editing the persona line concurrently converge on a law persona that neither replica's attribute holds. D7's `meta` keeps only `formatVersion`, `origin`, and a `name` set once at creation for a system whose law has no title.

    **A token's identity is its path with a trailing `$root` dropped (the controller's decision after M3's re-review).**
    - Two replicas may converge on a token at `color.branch` and another at `color.branch.light`, each valid on its own replica.
    - The model represents that state without loss: the reader writes a token that has descendants as its group's `$root` (`color.branch.$root`), which DTCG 2025.10 defines for exactly this, and the CSS name is unchanged (`--ds-color-branch`). The token keeps the `$type` it inherited: when the group would give it another (its own `$type` or one through `$extends`), the reader writes the inherited type on the token. An alias keeps its target's type and is not changed (fix wave 3, ddf4dd52).
    - Publish compares base, live and sent token maps keyed by identity, not by raw path, and builds the live map from the stored attributes through that lossless reader, never through a serialize-and-parse round trip. The stored keys come straight from the attributes, and a unit stored under both `x` and `x.$root` with different values counts as changed. So `x` and `x.$root` are one unit, a creation on both sides with different values is a conflict, and no live value is hidden from conflict detection.
    - Roles and references follow the same identity rule. `validateRoles` accepts `color.border` or `color.border.$root`. On read, a reference `{x}` also reaches `x.$root` and the reverse, which goes beyond DTCG's refusal of `{group}` only when reading; files are written as authored, and a group with no `$root` is still refused. The Office slots, the CSS type roles, the check's colour roles and the Claude export find tokens by identity too.
    - Rejected: refusing the read, which would lock the agent out of the system it must repair; and a host repair in M6, which would leave the model lossy until the repair runs.

    **`force` (the controller's decision, overriding the first build):** for this kind, `force` means "the agent wins where both sides changed the same unit, and everything else still merges". The units are a token, a law hunk and a canon file. It does not mean "write the sent file verbatim". A's Decision Log 10 says force skips layers 2 and 3 "for the files sent". This kind merges below the file, so that skip applies to the colliding units. Writing `tokens.tokens.json` verbatim would revert a human's concurrent recolour of a token the agent never touched, which no agent intends by retrying with `force`.
13. 2026-10-13 (from B's M3, through the architect): B's editor puts `.ds-doc` on the page element only; its tabs, toolbar and find bar are app chrome on app tokens. `<DesignSystemScope>` therefore wraps a consumer's page element, not its whole editor. The system's ground, tokens and code-highlight colours apply inside the scope, and the chrome around it stays on the app's tokens. M4 keeps this boundary in the API's documentation and examples, and in its own page: the page's chrome is app tokens, and only its previews sit in scopes.
14. 2026-10-13 (A's M4 at 1227152b on A's branch, under review; on the ledger). Names M6 codes against:
    - `ArtifactRow` is `Artifact` plus the live `revision`, returned by list, get and every write.
    - Refusals are `ArtifactRefusal {reason, data}`, read back by `artifactRefusalOf`.
    - Main's `artifacts.setDefaults` push reads `settings.artifacts` only when it is present, so settings 14 lands without editing A's files.

    Until A's M5, detached mode has two gaps:
    - `artifacts.open` answers `host_unavailable`;
    - the bytes of create, uploadAsset and versionState wait for M5's base64 codec.

    So M6 and M7 e2e run in utility mode until then.
15. 2026-10-13 (B needs the page size for its editor; proposed to the architect for X28): `generateTokensCss` derives three properties from `$extensions["dev.maws.page"]`, emitted in the document medium only. M4 adds them.
    - `--ds-page-width` and `--ds-page-height` come from `size`: `letter` is 8.5in × 11in, `a4` is 210mm × 297mm, and the default is `letter`.
    - `--ds-page-margin` comes from `margin`: a dimension or an alias, defaulting to 1in.
16. 2026-10-13: P3-G landed on master at d4e13f85, and master is merged here (ee1f9dfc). The page's X32 header registration (`registerEditorHost`/`useEditorHost`, entry 10's lifetime rule) and Mark-up's `useRegionMarkupSurface` move from M6 into M4, since they need nothing from A. The page's mount into L's `registerArtifactEditor` stays in M6, because L has not landed. The page-size names of entry 15 are on the ledger's X28 row (master 54f65cb0).
17. 2026-10-13 (the second controller's pre-flight for M4; the first controller retired at its context ceiling with M1, M2 and M5 ticked and M3 in re-review).
    - **The floor is M5's file.** M5 landed before M4, so the built-in floor (D8, D9) reads the `maws` default through the bundle module (`defaultSystem(HOUSE_KEY)` in `src/artifacts/types/design_system/defaults.ts`). M4 writes no provisional transcription.
    - **Two layers for the page.** `src/artifacts/design-system/page/` stays portable (§4.10) and takes what is app-specific as props: the system's `DocumentHandle` and `ArtifactHost`, and the handlers of the header's actions. X32's `useEditorHost` (`src/renderer/src/panel/editor-host.ts`) and Mark-up's `useRegionMarkupSurface` (`src/renderer/src/markup/surface.ts`) are renderer modules, so the registration lives in one renderer-side body component under `src/renderer/src/artifacts/design-system/` that mounts the portable page. That is the component L's `registerArtifactEditor` will mount in M6.
    - **The header in M4.** It registers the title, the saved state (from `DocumentHandle.state()` and `subscribe`, mapped onto X32's `SavedState`), and the three actions. "Check against law" works now. "Export for Claude" calls `ArtifactHost.export(id, 'claude')`, whose format A's export service gains in M6. "Set as my default" takes its handler as an optional prop, absent until M6 wires settings 14, and is shown disabled without one. Every edit writes through to the document, so the page holds no unsaved buffer and needs no `closeGuard`. Per entry 10, nothing the header holds reads body component state.
    - **The canon frame's CSP.** It adds `font-src` beside `img-src`, both the asset scheme taken from `ArtifactHost.assetUrl`. D14's policy would block a system's bundled faces (`official`'s Noto Serif KR under `assets/`). Asset references in canon and in `document.css` are rewritten through `assetUrl` before they enter the `srcdoc`.
    - **The build compiles the page.** electron-vite runs the React Compiler over every `.tsx` the renderer imports, `src/artifacts/` included, so the page is written compiler-safe. Its happy-dom tests need the test runner to pick up `.tsx` under `src/artifacts/design-system/`. That is a one-line edit of the shared `vitest.config.ts`, relayed to the architect, and it stays clear of B's planned `artifacts-dom` project for `src/artifacts/document/**`.
18. 2026-10-13 (L's names relayed by the architect; on the ledger's §7).
    - **The page's mount.** L's mount registry is `registerArtifactEditor(kind, {Panel, Main?, createState?(target: {artifactId, kind, surface}), dispose?(state)}) → unregister`. It renders with the props `{artifactId, state, scope: EditorHostScope}`, and `artifactEditorFor` and `useArtifactEditor` read it. M6 registers the renderer-side page component of entry 17 into it once L's M3 lands; the architect says when. **The final shape** (L's M3, p3-l-library at 70012816, review clean) is `registerArtifactEditor<S>(kind, {Panel, Main?, createState?(target: {artifactId, kind, surface: 'panel' | 'main'}): S, dispose?(state): void}) → unregister`, with the last registration winning. Its props are `ArtifactEditorProps<S> = {artifactId, state, scope: EditorHostScope, onShown(): void}`. The page calls `onShown` once when its content is first on screen, and the surface then calls `artifacts.markViewed`. The editor registers its own X32 header with the scope it is given. M6 merges `p3-l-library` and never edits L's files.
    - **The mirror.** L's linked-directory mirror takes one optional writer per kind: `registerMirrorWriter(kind, writer)` in `src/artifacts/library/mirror.ts`, where `writer({artifact, doc?, bytes?, name?})` returns `{files}` and the files are named by `mirrorSlug(artifact)` (final at L's M3). The design system registers one in M6. It returns `readFiles(doc)`: the law, the token file, the canon, and the generated `tokens.css` and `office-theme.json`. A project linked to a Space then holds the system its code is styled by, in the same shape the agent reads through `artifact_read`, with `tokens.css` ready for a web project to import. Kept Claude sources are mirrored too, since they are part of that view. Rejected: mirroring nothing, which hides the one artifact a codebase most directly consumes.
19. 2026-10-13 (the controller, on M3's third fix wave): `setToken` normalizes its token to the canonical form at the one place it writes. That is the canonical writer's object forms (D1), so a hex string is stored as `{colorSpace, components, hex}`. It refuses a token that does not parse, naming the path, with `SystemFilesError`. Reason: a stored value that differs from its file view makes publish count the token as changed live, and `lossOf` then refuses any merge touching the tokens. One normalizing writer is safer than every caller promising canonical input: the page, M6's host, and a later P4 client. M4 makes the change, with a test of a lenient write followed by a clean publish.
20. 2026-10-13 (the controller, on M3's third re-review). A typed group can converge above an untyped parent token. The reader then makes the inherited `$type` explicit on the live token (entry 12), while the base and the sent file keep the authored form. Publish therefore sees a parent the agent never touched as changed live, and refuses a recolour made from an older read as a conflict. This fails safe: nothing is lost, and the agent's re-read clears it.
    - **Where it is fixed.** M3 is ticked, and the fix moves into M4, which already edits `model.ts` for entry 19.
    - **The fix.** Publish compares each unit's three sides in one form: every token with its effective `$type` made explicit, or with every redundant `$type` stripped, whichever M4 chooses. Writes keep the stored keys and the authored values. A genuine type change on one side still counts.
    - **Its regression.** The parent's base is read before the typed group arrives, and an agent then recolours the parent. The publish merges.
21. 2026-10-13 (M4's decisions, folded from its report; the API and the files are in it).
    - **`setToken` (entry 19)** parses a one-token file at the token's path, borrowing the inherited type and dropping it again, so the stored value is exactly what `parseTokens` yields in the full file. A token with no type from anywhere is refused.
    - **Publish compares with the effective `$type` made explicit (entry 20)** on every side, each against its own groups. Stripping a type cannot equate an implicit colour with the reader's explicit one once a dimension group sits above it. Aliases and pointers are compared as written. A group type changed live under a token the agent then edits is a conflict: that is the genuine type change entry 20 keeps.
    - **The page names are reserved.** No token writes `--ds-page-*` in either medium, and `validateTokenFile` names a token that would.
    - **The system's faces reach in-app scopes.** `view.css()` prepends the system's own top-level `@font-face` blocks from `components/document.css`, but only those whose family a `font.*` or typography token sets, whose every `src` is one of the system's assets (rewritten through `assetUrl`), and whose descriptors are on an allowlist. The Type section, B's pages and C's pages therefore get the bundled faces, and a system can neither fetch from elsewhere nor restyle a family it does not name. The floor has no faces.
    - **Scope ids and views.** A scope id is a 64-bit FNV hash of (ref, medium, sanitized overrides). The style is held in a layout effect, and a view already at hand is written synchronously, so the first paint is styled. There is one view per (host, ref), refcounted. `useDesignSystem` returns a new snapshot per change, so the React Compiler's memos see it.
    - **The page's previews read the page's own replica**, so they restyle in the same update event.
    - **Canon frames** use the deck medium for layouts and components, and the document medium plus `document.css` for the document sample.
    - **The contrast pairs** are text on bg 4.5, muted text on bg 4.5, accent on bg 3, accent text on accent 3. Shadows are shown read-only. A typography role that aliases another is locked. The deck scale is edited through `dev.maws.deck`.
    - **The law** renders through streamdown with sanitize and harden, links limited to http(s) and mailto, no raw HTML and no images. "No law yet" has its copy but no action until a session route exists (M6).
    - **The header.** "Export for Claude" is an X32 `exports` entry, not an action. "Check against law" signals through a store keyed by the tab (entry 10).
    - **The test runner.** One line in `vitest.config.ts` puts `src/artifacts/design-system/**/*.test.tsx` in `renderer-compiled`. `tsconfig.node.json` excludes the design system's React files, because Vite's tsconfig lookup otherwise compiles their JSX with the classic runtime. B's branch makes the same kind of edit, and the merge takes the union.
    - **Names proposed for X28** (to the architect at M4's tick): `DesignSystemHostContext`, through which `useDesignSystem` and `DesignSystemScope` reach the store, provided at the app root in M6; `governingSystem(a, d, live?)` with `live(id) → boolean`, so a deleted id falls through, also exported from the React-free `governing.ts` for the host; `DesignSystemMissing`; and the renderer body `DesignSystemBody({artifactId, handle, host, onSetDefault?, onShown?})`.
22. 2026-10-13 (the controller, on M4's concern about the canon frames). The canon frames stay `sandbox=""`, with no `allow-same-origin`, and a change swaps their `srcdoc`. The canon is agent-written HTML, and §1 puts untrusted content in frames. In-place style updates would need `allow-same-origin`, which gives the frame the app's origin, for a gain of one reload of a small document. **Acceptance 9 is amended:**
    - the swatch and the page's `--ds-color-accent` follow within one frame of the doc update;
    - the canon preview follows when its frame's next load completes.
    M7's e2e asserts it that way.
23. 2026-10-13 (`[parent-impact]`, to the architect at M4's tick). The app's CSP in `src/main/csp.ts` allows `img-src 'self' data: blob:` and `font-src 'self' data:`, and `srcdoc` frames inherit it. `maws-artifact:` assets are therefore blocked in-app (the system's faces, B's images) and in the canon frames alike, on master and on every P3 branch. Before M7's e2e can show a bundled face or a canon image, main's policy must add the asset scheme to `img-src` and `font-src`. The owner is A or L, which serve the scheme, or this child with the architect's leave. **Ruled (the architect, same day):** A's M7 makes the edit, since it already touches `src/main/csp.ts` for `frame-src`, and `maws-artifact:` joins `img-src` and `font-src`. This child does not edit `csp.ts`. M7's e2e cases for bundled faces and canon images wait for A's M7 on master. Until then, unit tests over `view.css()` and the frame's `srcdoc` prove the `@font-face` and image paths. The names of entry 21 are on the ledger's X28 and §7.
2. 2026-10-12: parent pin taken at master 4a51531b (blob dda3d0b4), the spec's head when this document was written. Its only change since the dispatch commit 28dd4d9c is Decision Log 38 (the upstream filing), which does not touch §4.6, X28 or X29.

## Outcomes & Retrospective

Pending.
