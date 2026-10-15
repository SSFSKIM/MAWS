# Design system: guide

A project's committed visual law: a stance, a token file and DESIGN.md, which the documents, decks and designs that reference it must obey.

## When to use this kind

Make a design system when the user wants a look that several documents or decks should share: a school's handouts, a course's slides, a project's reports. A system is global authority for every artifact that references it; a brief may still override a value for one artifact. Do not make one for a single page that will not be reused: style that page within its own kind.

Before making a new system, call `artifact_list` with `kind: "design_system"`: the user's systems, the built-in ones among them (MAWS's house system is the default), may already fit.

## Creating one

A system is made one of two ways, never by generating its law from its tokens.

- **If the `designer` skill is available, invoke it.** It classifies the source and runs one of its two routes:
  - **Adopt** when the source already has a system: a codebase's CSS variables, Tailwind preset or component library, a deck's files (read them with `artifact_read`), a website (read it with the browser tools). Read the nine stance lines off that system, record "adopted from <system>" in `DESIGN.md` §0, and carry its values into the token file.
  - **Derive** when there is no system to adopt: the sampler or a persona, exactly one stance, and `DESIGN.md` written before any token.
- **Without the skill,** follow the format reference's condensed rules (`artifact_describe_type` with `kind: "design_system"`): the same two routes, the same nine sections.

Then write the system with `artifact_create` and `kind: "design_system"`, a `title`, and `files`, in this order: `DESIGN.md` first, then `tokens.tokens.json`, then the canon (`layouts/*.html`, `components/*.html`, `components/document.css`). Upload font files and logos with `artifact_upload_asset` and refer to them as `assets/<name>`. When the user should choose the system, or may want a new one, ask with the `ask` tool's `design_system` question: the answer names the system they chose (`designSystemId`), or is `create: true`, which asks you to build one with them: the derive route, with the stance and `DESIGN.md` settled with the user before any token.

A system in Claude's shape (`design-system.json`, a list-shaped `tokens.json`, `README.md`, `components/*/README.md`, `fonts/`) is imported by passing its files to `artifact_create` as they are: MAWS converts the tokens and keeps the originals under `sources/claude/`. It arrives with no law: adopt it (the adopt route, "adopted from <its title>") before building on it. `artifact_export` with `format: "claude"` writes a system back in Claude's shape.

## Reading and editing

`artifact_read` returns the system's files and its `revision`: `DESIGN.md`, `tokens.tokens.json`, every canon file, and two generated files, `tokens.css` and `office-theme.json`, marked generated. Generated files are never sent back; a publish that sends one is refused naming it.

To change a system, call `artifact_publish` with the `baseRevision` you read and only the files you changed. The token file merges token by token: a token the user changed since your read and you changed too is a conflict, named in the refusal; read again, keep the user's value unless they asked otherwise, and publish again. `DESIGN.md` merges by text, so an edit elsewhere in the law survives yours. A canon file is replaced whole and conflicts as a whole.

`DESIGN.md` wins for usage and the token file wins for values. When you change a value that the law describes (a colour's contrast, a size in §2's table), change the law in the same publish.

## Working with a design system

- **Read the law before touching anything under it.** A document, deck or design that carries a `designSystemId` is governed by that system; with none set, the Space's default system, then the user's default, then the house system governs, and you honour that chain without asking. `artifact_create` attaches the governing system's `DESIGN.md` when you make a document or deck.
- **Use the tokens by name, never by value.** Documents and the system's page may use every `--ds-*` property the system defines. Slides use only the fixed names (`--ds-color-*`, `--ds-font-*`, `--ds-type-<role>-{size,line,weight}`, `--ds-space-1` to `8`, `--ds-radius-*`, `--ds-shadow-*`); a system's extra tokens never appear in a slide. Inside a deck the `--ds-type-*` sizes are the deck's larger scale.
- **An override is per artifact.** When the brief asks one document for a different value, override that `--ds-*` name on that artifact; do not edit the system for one artifact's sake.
- **Reuse the canon.** Build slides from the system's `layouts/` (fill the `data-ph` placeholders and drop the attribute) and blocks from its `components/`; add a component to the system, named in its §5, before using it twice.

## Before you finish

Check what you built against the system's §8 hard don'ts. The ones tagged `[check: …]` are checked by MAWS ("Check against law" on the system's page); judge the untagged ones yourself and say which you checked. Confirm body text meets 4.5 : 1 and large text and controls 3 : 1 on the grounds they sit on. For a new or changed system, confirm the token file names every role, `DESIGN.md` has its nine sections, and every canon file is named in §5.
