# UX wave · U6a · the keymap's shape (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U6**, first landing (**U6a**), parent pin `25942f5d1`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`: Edges → Blocks (which defines this landing); Contracts → "UC-6 · One keymap (owned)"; acceptance A13, A9 and the first sentence of A7; the items l7-shell-07 and l5-code-08; under "Rulings reversed", the entry l5-code-08. In the root: Purpose, the wave's laws, UC-6, UC-8, UC-10, UC-11, UC-14, and "Ordering and dependency map", step 0. Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code needs, the decisions the section left open, and the execution. **Branch:** `ux-wave/U6a`, from master `25942f5d1`. **Board:** #574 (the wave's epic is #573).

## Purpose

After this landing ⌘J, ⇧⌘D and ⇧⌘F show and hide Terminal, Review and Files from wherever the keyboard is; the View menu reads in groups, with Tabs, More surfaces, Comments, Appearance and Developer folded into submenus; and the shortcut sheet (⌘/) and Settings ▸ Keyboard list the keys under the same groups.

Behind that, the action table (`ACTIONS` in `src/shared/keymap/actions.ts`, the one list of the app's keys) gains the three fields of UC-6, and the menu, the sheet, Settings and the table's tests are driven by them. That is why it lands first and alone (root, step 0): U1, U3, U4, U11 and U6's own second landing each add rows to the table, and from this master a row is all they add in U6's files.

How to see it working: the tests named under Acceptance fail at the commit that adds them and pass at the head; in a running build, the View menu, ⌘/, Settings ▸ Keyboard and the three chords read as "Interfaces and Dependencies" draws them.

## Progress

- [x] (2026-11-12 22:33Z) Execution document written; the section checked against the code at `25942f5d1`; six points reported to the wave's architect (Surprises & Discoveries).
- [ ] Adversarial review of this document, dispatched by the architect; its findings and the architect's rulings on the reported points folded in.
- [ ] The tests of Acceptance 1 to 3 committed first and run on the VM; the failing summary lines recorded here.
- [ ] The table: the three fields, the rows of View and Go in menu order with their `submenu`, the nine surface titles, the three defaults, `effectiveChord`'s rules.
- [ ] `menuTemplate`: nesting, the Edit placement, Developer ▸, separators.
- [ ] `keymapGroups` and the capture's conflict rule; Settings ▸ Keyboard's fixed row; the dispatcher and the palette blind to fixed rows.
- [ ] The three Shift conditions with their tests; the two filter pins of A7.
- [ ] The e2e edits written and typechecked (not run by the executor).
- [ ] The record: the charter's two sentences.
- [ ] On the VM: typecheck, lint on the changed paths, the whole unit suite. Then class 1a once. Hand-back.

## The landing's edge

| part of U6 | satisfied by this landing | stays for U6b, or for the child named |
|---|---|---|
| UC-6, "The shape" (`'edit'`, `submenu`, `fixed`) | in full | nothing |
| UC-6, "How the sheet and the menus are drawn" | in full | nothing |
| UC-6, "The table", U6's rows | the defaults of `surface.terminal`, `surface.review`, `surface.files` | `files.goToFile`, `terminal.attachSelection`, `go.back`, `go.forward`, `zoom.in`, `zoom.out`, `zoom.reset` and their handlers (U6b) |
| UC-6, "Collisions found" | the three Shift conditions the table names for ⇧⌘D and ⇧⌘F | every other row of that table, with the landing that adds its chord (the file editor giving up ⌘[ and ⌘] is U6b) |
| UC-6, focus first; F6 | as built today, unchanged | F6 stops for new regions (each child; l7-shell-13 in U6b) |
| A13 | in full for the rows that exist; the test already holds UC-6's defaults for the rows to come (decision 9) | U6b adds its seven ids to the rows that must exist |
| A9 | the View menu in groups with the five submenus; the sheet and Settings under the same groups; the test that fails before: all in full. "The composer's own keys included": the mechanism, proved on a sample `fixed` row | the composer's keys themselves show when U4 adds its `fixed` rows |
| A7, first sentence | in full as far as a test reaches: the chords are menu accelerators, the terminal's and the in-app browser's key filters leave them to the menu, and the three handlers stop taking them | the hands-on check that macOS delivers them from a terminal and from a web page, and under the Korean input source (the child's Probes, 6; arranged by the architect); the rest of A7 (⇧⌘L, "Attach selection to chat") is U6b |
| l7-shell-07 | View in the stated order, without the zoom rows, its surface rows titled by the surface's name; Go in the stated order, without Back, Forward and Go to file; Edit able to take table rows; the sheet; Settings ▸ Keyboard | the zoom rows, Back, Forward, Go to file, "Attach selection to chat" (U6b); Edit ▸ Find's rows (U3) |
| l5-code-08 | "Chords", in part: the three defaults, showing and hiding | giving the surface the keyboard and returning it to the composer, "Attach selection to chat", the starting folder (U6b) |
| "Rulings reversed", l5-code-08 | in full: the charter's two places | its other four entries (U6b) |
| l7-shell-06, -08, -09, -13, l5-code-11, -09, -10, l9-browser-delivery-03 and -08, O-37, Probes 1 to 5 and 7 to 9 | nothing | U6b |

The keyboard hand-off of l5-code-08 stays out because the code that shows and hides a surface (`toggleSurface` in `src/renderer/src/panel/SurfaceRow.tsx`) is U8's file (UC-8), U8b replaces the stacking under it with tabs, and this landing has no dependency on U8.

## Today, and what each part needs

Read at `25942f5d1`. The executor reads the code itself; this table says where the work is. A row's *placement* is the value of its `menu` field (which menu it sits in); its *sink* says whether the menu (`menu`) or the page's key dispatcher (`renderer`) hears its chord.

| part | today | needs |
|---|---|---|
| `ActionSpec` and `ACTIONS`, `src/shared/keymap/actions.ts` | `title`, `chord`, `sink`, `menu` (no `'edit'`), `scope`, `hold`. The nine `surface.*` rows are unbound and titled "Toggle … surface". `effectiveChord` answers the override, else the default | the three fields; the rows of View and Go in menu order with their `submenu`; nine titles, three defaults; `effectiveChord`'s two new rules (decisions 7 and 10) |
| `menuTemplate`, `src/main/menu.ts` | `section(placement)` lists a placement's `menu`-sink rows in table order with a separator where the id's prefix changes (`sidebar.` and `panel.` count as one group); the nine tab items sit inline; the three theme rows are gathered into an Appearance submenu appended last; Edit is written by hand and takes no rows; View ends with three developer roles inline and Toggle Full Screen; chords come from its own `chordOf` | nesting by `submenu` where the submenu's first row stands; Appearance placed by its rows like any other (its radio marks and short labels kept); `'edit'` rows after Edit's own items; the developer roles under Developer ▸; chords through `effectiveChord` |
| `keymapGroups`, `src/renderer/src/settings-tab/keymap.ts` | a group per placement (MAWS menu, File, View, Go, Help), then a group per scope for rows no menu holds; within a group by scope, then table order | the Edit placement; a group per submenu; `fixed` on each row; the capture's conflict rule (decisions 7 and 10) |
| the sheet, `src/renderer/src/keymap/KeyboardShortcuts.tsx` | one table per group of `keymapGroups`, searched by title, id and chord | no change expected in the component: groups and fixed rows arrive through `keymapGroups`. Its test gains the cases |
| Settings ▸ Keyboard, `src/renderer/src/settings-tab/KeymapSection.tsx` | the same groups, each row with a Change control | no control on a fixed row |
| the dispatcher, `src/renderer/src/keymap/dispatcher.ts` | tries every `renderer` row in table order (`dispatchKey`); `keymapBinds` asks whether any row holds a key | neither ever counts a fixed row |
| the palette, `src/renderer/src/palette/CommandPalette.tsx` | lists every row | not a fixed row |
| three artifact handlers | each tests ⌘D or ⌘F without looking at Shift and takes the key | Shift up required |

## Decisions settled at authoring

Each is a means the section left open, with its reason and what lost.

1. **One milestone, tests first.** The parts are meaningless apart (a field nothing draws, a menu with no rows to nest) and one reviewer reads the diff in one pass. The tests of Acceptance 1 to 3 are committed before the code they test, so "fails before" is a recorded run, not a claim.
2. **Table order is menu order.** The section draws each menu "in table order", so the rows of View and Go are reordered in the table to the order l7-shell-07 states (Interfaces, B). `renderer` rows keep today's relative order: the dispatcher tries them in table order, and that order is the priority between two rows on one chord. Lost: an order list in `menu.ts`, a second list of keys by another name.
3. **Which rows name which submenu** (Interfaces, B). Appearance becomes a `submenu` value like the others and the special case in `menu.ts` shrinks to its radio marks and short labels, so the sheet shows it as the menu does. `tab.next` and `tab.previous` (renderer rows placed in View) name Tabs too, so the sheet's Tabs group is whole. Developer holds role items only and is the menu's own.
4. **`artifacts.open` stays directly under Overview.** The section's order for View does not place it; it opens a place, as Overview does, and U7 keeps View ▸ Artifacts. Lost: inside More surfaces ▸, which is for tools beside the chat.
5. **Separators follow groups of ids, as today.** A separator stands between two neighbours (items or submenus) whose group differs. A row's group is the prefix of its id, except where the section's own words make one group of several prefixes; those aliases are for rows that exist today and are listed in Interfaces, C. A row a later child adds groups by its prefix with no edit to `menu.ts`. Lost: a `group` field on `ActionSpec` ("gains three things, and nothing else changes").
6. **The sheet and Settings get flat groups.** A submenu is a group of its own, labelled with its path (`View › Tabs`) and placed after its placement's group, in the order the submenus appear in the table. Both views already draw `group.label`, so neither component needs a second level. The label uses `›` because the app's own copy writes a menu path that way ("Settings › Browser"). Lost: nested groups, a new shape for two components to draw for no gain in reading.
7. **A fixed row is listed and otherwise absent.** By rule it is `sink: 'renderer'`, `menu: null`, with a chord and the scope of the surface that handles it. `effectiveChord` answers its default whatever the settings hold; the dispatcher and `keymapBinds` skip it; the palette does not list it (it is not an act that can run); the sheet and Settings list it under its scope; Settings draws no Change control and nothing in its place (law 3); the capture's conflict check does not count it as a holder. Lost: counting it as a holder, so that nothing can be bound onto Enter. That needs a refusal sentence in U11's copy and guards a hole that is open today for every key an editor owns (⇧Enter can be bound to a composer action now); it is residue for the landing that adds the first fixed row.
8. **A13's second assertion, as the root's table needs it.** A13 reads "no two dispatched rows share a default chord". UC-6 in the root gives ⌘Enter to `composer.queue` and `composer.send`, and U1 adds `request.allowOnce` on it. The root binds, so the test asserts what the dispatcher can honour: two dispatched rows share a default only if both are `renderer` rows and at most one of them has scope `app`. A `menu` chord is held window-wide and an `app` row is reached from anywhere, so neither can share; rows of scope `pane` and `composer` are told apart by where the focus is. Reported to the architect as a difference between A13 and the root.
9. **How A13's first assertion grows.** The test holds UC-6's table once, by id (Interfaces, E): every key the wave adds and every chord UC-6 says does not move. A row is checked from the moment it exists, so a child's landing is tested with no edit to U6's test. The rows of landed children must exist: this landing's three now; U6b adds its seven. The `fixed` rows of U4 are not in the list because the spec gives them no ids. A child whose execution settles another id or chord amends the list in its own pull request, which is the contract changing where it is written.
10. **A stored rebinding wins over a default added later.** If the settings bind action X to a chord and a later build gives action Y that chord as its default, both would hold it, and which of the two the key reached would be an accident of menu and table order. `effectiveChord` answers null for Y while X's override holds the chord, so the person's key keeps doing what they bound it to, Settings shows Y unbound, and binding Y elsewhere or freeing X restores it. Nothing stored changes, which is what UC-14 and the `keep` on the rebindable keymap (l7-shell-12) ask. Conversely the capture never refuses an action its own default because another row holds that chord by default: the table's own sharing (decision 8) must be restorable. Lost: rewriting the settings at first read (a write build F then reads, and a rule that cannot be undone by freeing the key); doing nothing (a kept binding silently broken).
11. **Nothing new is stored.** This landing adds, removes and renames no action id, so `settings.keymap` holds nothing build F's reader refuses (UC-14). Its reader is strict about ids: see Surprises & Discoveries, 3, for what that means for the children that add ids.
12. **The tests of U6's files are generic over the table.** A literal expectation is kept only for rows that exist now, by id or as a subsequence. Each generic assertion is also run over a table extended with sample rows shaped as the siblings' will be (Interfaces, F), which is the proof that a later row needs no edit here. An assertion that a row of Interfaces, E would fail is a defect of this landing. So `menuTemplate` and `keymapGroups` take the table as an argument (as `menuTemplate` does today) and walk that table's rows, not the global list of ids.
13. **The record is the charter's two places**, as the child's file names them. The line in C5's plan (`docs/doperpowers/plans/2026-09-28-c5-shell.md`, "⌘J (bottom dock) is P1 and has no action") is the record of what C5 built and stays.
14. **Titles.** The nine `surface.*` rows are titled by the name inside today's title: Terminal, Review, Browser, Files, Source control, Subagents, Background work, Session info, Questions. The palette, the sheet and the title bar's tooltips follow from the table.

## Acceptance

1. **A13.** `src/shared/keymap/actions.test.ts` fails at the commit that adds the tests and passes at the head. It asserts: every id of Interfaces, E that is a row holds that default, and the three surface ids are rows; decision 8's rule over every chord a dispatched row holds (the nine of Select tab included); no default is a chord of `MENU_ROLE_CHORDS`; the row rules of Interfaces, A; `effectiveChord`'s rules.
2. **A9.** `src/main/menu.test.ts`: every `menu`-sink row is in the built menu once (nine times for Select tab), under its placement and, when it names one, its submenu; an `'edit'` row comes after Edit's own items; View's submenus are Tabs, More surfaces, Comments, Appearance, Developer, in that order; no menu starts or ends with a separator or has two in a row; the rows of View and Go that exist now stand in the order of Interfaces, B and C, checked as a subsequence so that a later row may stand between them. `src/renderer/src/settings-tab/keymap.test.ts`: every row is in exactly one group, and the group's label is its placement's, its submenu's path, or its scope's. The sheet's and Settings' tests: a submenu's group is drawn under its path; a fixed row is listed with its key; Settings draws no Change control on it.
3. **A7, first sentence.** `src/renderer/src/terminal/keys.test.ts`: the terminal's filter leaves ⌘J, ⇧⌘D and ⇧⌘F to the app. `src/main/menu.test.ts`: the in-app browser's `keyAction` takes none of the three. The deck stage's, the design canvas's and the document editor's tests: with Shift down the key is neither acted on nor prevented, and without Shift ⌘D and ⌘F do what they did.
4. **In a running build** (the architect's run on a Mac, then the owner's sitting; not the executor's): the View and Go menus read as Interfaces, C; ⌘/ lists the keys under View, View › Tabs, View › More surfaces, View › Comments, View › Appearance and the rest; Settings ▸ Keyboard shows the same groups; ⌘J, ⇧⌘D and ⇧⌘F show and hide the three surfaces with the keyboard in the composer, in a terminal and in a page of the in-app browser; the title bar's Terminal, Review and Files buttons name their chords in their tooltips.
5. **Keep** (law 8, l7-shell-12). No existing chord moved (the kept list of Interfaces, E); a stored override applies as before and wins over a new default (decision 10).
6. **The record.** `docs/charter.md` carries the sentence of "The record" below at both places.
7. **Nothing gated got worse.** On the VM: `pnpm typecheck`, eslint on the changed paths and `pnpm test` pass. Class 1a on GitHub Actions is green on the branch's head.

## Constraints that bind the work

- **The design binds.** The child's file and the root, at the places the header names. A point where the code contradicts the section, where the work needs an edit in another child's file beyond the insertions named below, where a contract would have to change, or where the owner would see something the section does not say: stop on it and hand it back to the architect with the evidence. Everything else is decided in the spirit of the section and recorded in the Decision Log.
- **Law 8 and UC-6.** No existing chord moves and no existing id changes.
- **UC-8, ownership.** U6's: `src/shared/keymap/`, `src/main/menu.ts`, `src/renderer/src/keymap/`, `src/renderer/src/palette/`, `src/renderer/src/terminal/`, `src/renderer/src/settings-tab/keymap.ts`, and their tests. Insertions in other children's files, each the smallest that does it: one Shift condition in each of `src/artifacts/slides/editor/transform/Overlay.tsx`, `src/artifacts/design/editor/World.tsx` and `src/artifacts/document/editor/DocumentEditor.tsx` (U10's, named by the child's file) with a case in each one's test; one condition in `src/renderer/src/settings-tab/KeymapSection.tsx` with a case in its test (U11's; the section asks for the behaviour, UC-8's table does not list the file: reported).
- **UC-14.** Decision 11. No change to the settings' schema or to `RETIRED_ACTION_IDS`.
- **UC-11, the repository is public.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages, documents or pull-request text. Fixtures use invented content.
- **Where checks run (UC-10).** On the MacBook the worktree carries no `node_modules` and nothing is installed, typechecked, linted, tested, built or launched. Every check runs on the wave's build VM in a checkout of the pushed head (Concrete Steps). Class 1a on GitHub Actions is the gate of record: once, when the branch is complete, started in the background. Its runs are never polled in a loop. Electron e2e is not the executor's to start.
- **Git.** Commit as you go and push `ux-wave/U6a`. Never commit to master or to `ux-wave-spec`, and never edit the spec's files. No attribution trailer but the `Sminos-Session:` line the dispatch gives, which ends every commit message and the pull request's body. A pull request is opened only when the dispatch says so; its body opens with the root's path, "U6, first landing" and the parent pin, and names its class 1a run, its review verdict and its residue.

## Plan of Work

### M1 — The table's shape, the grouped menus and sheet, and the three surface chords

**What exists at its end.** What Purpose describes: the three chords, the View and Go menus in groups, the sheet and Settings ▸ Keyboard under the same groups, and a table whose next row needs no edit in U6's other files. Acceptance 1 to 7 are its checks.

**What it touches.**

- `src/shared/keymap/actions.ts` and its test: Interfaces, A, B and E.
- `src/main/menu.ts` and its test: Interfaces, C. `src/main/menu-roles.test.ts` should pass unchanged (it walks submenus).
- `src/renderer/src/settings-tab/keymap.ts` and its test: Interfaces, D.
- `src/renderer/src/settings-tab/KeymapSection.tsx` and its test: the one condition.
- `src/renderer/src/keymap/dispatcher.ts`, `key-dispatch.test.tsx`, `KeyboardShortcuts.test.tsx`; `src/renderer/src/palette/CommandPalette.tsx` and its test.
- `src/renderer/src/terminal/keys.test.ts`: the pin of Acceptance 3 (no change to `keys.ts` is expected).
- The three artifact handlers and their tests (`transform.dom.test.tsx` beside the stage; the design editor's and the document editor's `*.dom.test.tsx`).
- `e2e/shell.spec.ts` and `e2e/ux2-shell.spec.ts`: below.
- `docs/charter.md`: "The record" below.

**Decisions that belong here and nowhere above.**

- *The Shift conditions.* In each of the three handlers the branch for ⌘D (or ⌘F) also requires Shift up, and with Shift down the handler leaves the event alone: no `preventDefault`, no `stopPropagation`, so the key goes on to the menu. Read the whole handler first: a later branch must not take the key instead.
- *Stale comments.* The comments in `actions.ts` and `menu.ts` that say the table has no submenu, or that describe the old View, are corrected where they stand. The comment that View has no zoom roles stays true until U6b.
- *The e2e edits.* `e2e/shell.spec.ts`, the palette step: it counts and reads the rows the palette lists, which are now the rows that are not fixed. `e2e/ux2-shell.spec.ts` gains one scene with a session's tab in front: the installed menu's items `surface.terminal`, `surface.review` and `surface.files` carry `Cmd+J`, `Cmd+Shift+D` and `Cmd+Shift+F`; clicking each by id (`e2e/support/menu.ts`) shows its surface and clicking it again hides it; View's submenus are the five of Acceptance 2; `shortcuts.open` opens the sheet with a table named "View › Tabs". Keep the scene free of how two surfaces arrange, which U8b changes. A key equivalent cannot be pressed through Playwright (the helper's own comment), so the scene clicks items and reads accelerators. Both files must typecheck (`pnpm typecheck` covers `tsconfig.e2e.json`); neither is run by the executor. The hand-back names them and the group `e2e:layout`.
- *Pitfalls seen while reading.* `ACTIONS` is `as const`, so an optional field is read through `ActionSpec` (as `hold` is today). The nine tab chords are expanded in four places (`menu.ts`, `settings-tab/keymap.ts`, `dispatcher.ts`, `terminal/keys.ts`); one shared helper may replace them, and need not. Several existing tests pin an exact list over the real table (the group labels and the "In a pane" rows in `keymap.test.ts`, "no chord is ⌥Enter" in `actions.test.ts`, the palette's count): by decision 12 each becomes generic, the last two over dispatched rows, or a sibling's row would fail it.

**What it does not touch.** `toggleSurface` and everything under `src/renderer/src/panel/` (U8). `SHELL_FOCUS_ACTIONS`. Any handler for a new action. The palette beyond not listing fixed rows (l7-shell-06 is U6b). `src/renderer/src/settings-tab/` beyond `keymap.ts` and the one condition, and its `copy.ts`. `src/main/browser/` (the pin of Acceptance 3 imports `keyAction` into U6's own test). `src/artifacts/` beyond the three conditions and their tests: the two further handlers of Surprises & Discoveries, 2 are not edited unless a dated line in the Decision Log adds them. The settings' schema. The spec's files.

**What it proves.** Acceptance 1 to 3 and 5 to 7 by its own runs; Acceptance 4 is the architect's run and the owner's sitting. Its tests also pin, beyond what acceptance states: a table extended with the sample rows of Interfaces, F passes every generic assertion; an override of a fixed row's id changes nothing; `effectiveChord` yields a default to another row's override and returns it when the override goes; the capture accepts an action's own default where another row shares it by default.

### The record (in the same pull request, UC-10)

l5-code-08 reverses the charter's ⌘J where it stands. Append this sentence, exactly, to the end of the paragraph of `docs/charter.md` §5.8 (Keyboard) and to the end of §3's P1 bullet "Bottom dock for the auxiliary panel host (terminal drawer).":

> Amended 2026-11-12 (UX wave, l5-code-08): ⌘J shows and hides the Terminal side surface, as in Claude Desktop; the bottom dock stays deferred and holds no chord.

The register's rows, the board ticket and the tracking map are updated at landing by the sessions that keep them, not by the executor.

## Concrete Steps

From the worktree of branch `ux-wave/U6a`. Push before every check: the VM sees only what is on origin.

    git push -u origin ux-wave/U6a
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec vitest run src/shared/keymap src/main/menu.test.ts src/main/menu-roles.test.ts src/renderer/src/settings-tab/keymap.test.ts src/renderer/src/settings-tab/KeymapSection.test.tsx src/renderer/src/keymap src/renderer/src/palette src/renderer/src/terminal/keys.test.ts'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec vitest run src/artifacts/slides/editor/transform/transform.dom.test.tsx src/artifacts/design/editor src/artifacts/document/editor/DocumentEditor.dom.test.tsx'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm typecheck'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec eslint src/shared/keymap src/main/menu.ts src/main/menu.test.ts src/renderer/src/settings-tab src/renderer/src/keymap src/renderer/src/palette src/renderer/src/terminal src/artifacts/slides/editor/transform src/artifacts/design/editor src/artifacts/document/editor e2e/shell.spec.ts e2e/ux2-shell.spec.ts'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm test'

The first call for the branch installs dependencies on the VM and takes a few minutes. Each call prints `vmcheck: ux-wave/U6a at <short sha>` and then the command's output; its exit status is the command's. At the tests-first commit the first two commands fail, with lines such as `expected null to be 'Cmd+J'` for a surface row; at the head each prints vitest's `Test Files … passed` with no failure, `pnpm typecheck` prints no error, and eslint prints nothing.

When the branch is complete, once, in the background, waiting for its notification (up to half an hour):

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6a

It prints each job's conclusion and the run's URL and exits 0 only when the run is green. That run is the one the pull request's body names.

The hand-back says: what exists and the command and result that showed it; what is not verified (Acceptance 4, and the two e2e files, written and typechecked but not run: group `e2e:layout`; the groups whose scenes cross the code touched, for the architect to run on a Mac, are `e2e:settings` for Settings ▸ Keyboard, and `e2e:presentations`, `e2e:design` and `e2e:document` for the three handlers); the decisions made; anything that contradicts the spec; and the residue. Residue known at authoring: the two further ⌘D handlers, unless ruled in (Surprises & Discoveries, 2); the hands-on check of the three chords from a terminal, from a web page and under the Korean input source (the child's Probes, 6); a fixed key can still be taken by a rebinding (decision 7); the hint "all bindings editable" in Settings ▸ Keyboard (Surprises & Discoveries, 5); stored rebindings of new ids against build F (Surprises & Discoveries, 3).

## Interfaces and Dependencies

### A. The row's shape (`src/shared/keymap/actions.ts`)

    export interface ActionSpec {
      title: string;
      chord: string | null;
      sink: Sink;
      menu: 'app' | 'file' | 'edit' | 'view' | 'go' | 'help' | null; // 'edit': after the Edit menu's own items
      submenu?: string; // the submenu of its menu the row sits in
      scope: 'app' | 'pane' | 'composer';
      hold?: true;
      fixed?: true;     // a key its own editing surface handles: listed, never dispatched, not rebindable
    }
    export type ActionTable = Readonly<Record<ActionId, ActionSpec>>;
    export function effectiveChord(id: ActionId, overrides: KeymapOverrides, table?: ActionTable): string | null;

Row rules, tested over every row: a row that names a `submenu` has a `menu`; a `fixed` row is `sink: 'renderer'`, `menu: null`, with a chord and no `hold`; a `menu`-sink row has a `menu` (today's rule); a row whose scope is not `app` is a `renderer` row (today's rule); every chord parses.

`effectiveChord`, in this order: a fixed row answers its default, whatever `overrides` holds. A row with an override of its own answers it (null unbinds). Any other row answers its default, or null while another dispatched row's own override holds that chord (for Select tab 1–9 on either side, any of the nine it expands to). A *dispatched* row is one that is not fixed.

### B. The rows of View and Go, in table order

Order within a placement binds; where rows of different placements stand relative to each other in the file is free, except decision 2 on `renderer` rows. Titles and chords not shown are today's.

| View, in order | title | default | submenu |
|---|---|---|---|
| `tab.overview` | Overview | `Cmd+0` | |
| `artifacts.open` | Artifacts | | |
| `tab.select`; `tab.next`, `tab.previous` (renderer) | | | Tabs |
| `pane.split`, `pane.focusOther`, `main.expandArtifactPane` | | | |
| `sidebar.toggle`, `panel.toggle`, `panel.maximize`, `panel.float` | | | |
| `surface.terminal` | Terminal | `Cmd+J` | |
| `surface.review` | Review | `Cmd+Shift+D` | |
| `surface.files` | Files | `Cmd+Shift+F` | |
| `surface.browser` | Browser | none | |
| `surface.source-control`, `surface.subagents`, `surface.background`, `surface.session-info`, `surface.ask-sheet` | Source control, Subagents, Background work, Session info, Questions | none | More surfaces |
| `artifact.moveToPanel`, `artifact.moveToTab` | | | |
| `comments.expand`, `comments.minimize`, `comments.hide` | | | Comments |
| `theme.light`, `theme.dark`, `theme.system` | | | Appearance |
| `accounts.open` | Usage | | |

Go, in order: `palette.open`; `session.previous`, `session.next`, `session.markUnread`, `attention.next`; `tab.stripNext`, `tab.stripPrevious`; `region.focusNext`, `region.focusPrevious`, `sidebar.focus`.

### C. The menu (`menuTemplate`, signature unchanged)

A placement's `menu`-sink rows in table order. Rows that name the same submenu fold into one submenu item, labelled with that name, where the first of them stands. A separator between neighbours whose group differs (decision 5); a submenu has the group of its rows. Aliases, for today's rows only: `sidebar.`, `panel.` and `region.` are one group; `main.` joins `pane.`; `artifacts.open` joins `tab.`; `attention.` joins `session.`; `comments.`, `theme.` and `accounts.` are one group. Edit: its own items as today, then a separator and its `'edit'` rows when there are any. View ends, after its rows: a separator, Developer ▸ (the roles `reload`, `forceReload`, `toggleDevTools`), a separator, the role `togglefullscreen`. Item ids are unchanged (`<action id>`, `tab.select:<n>`), so every e2e helper that finds an item by id still does.

What the two menus read at this landing (│ is a separator):

- **View:** Overview, Artifacts, Tabs ▸ │ Split / move to other pane, Focus other pane, Expand pane │ Toggle sidebar, Toggle session cards, Expand surface, Float conversation over surface │ Terminal ⌘J, Review ⇧⌘D, Files ⇧⌘F, Browser, More surfaces ▸ │ Move to side surface, Move to tab │ Comments ▸, Appearance ▸, Usage │ Developer ▸ │ Toggle Full Screen.
- **Go:** Command palette │ Previous session, Next session, Mark session unread, Next Needs-you │ Next tab in strip, Previous tab in strip │ Focus next region, Focus previous region, Focus sidebar.

### D. The groups (`src/renderer/src/settings-tab/keymap.ts`)

    export interface KeymapRow { id: ActionId; title: string; chord: string | null; display: string; overridden: boolean; fixed: boolean }
    export function keymapGroups(overrides: KeymapOverrides, table?: ActionTable): KeymapGroup[];

Groups in this order, empty ones dropped: for each placement of MAWS menu, File, Edit, View, Go, Help, the group of its rows that name no submenu, then one group per submenu in the order the submenus first appear in the table, labelled `<placement> › <submenu>`; then App-wide, In a pane, In the composer for the rows no menu holds, fixed rows among them. Within a group: by scope, then table order, as today.

The capture's conflict rule (`conflictOf`): a fixed row is never a holder; and when the chord asked for is the action's own default, a row that holds it as its own default is not a conflict (decision 10).

### E. UC-6's table, as the test holds it (`src/shared/keymap/actions.test.ts`)

Ids and chords as the spec's files give them at the parent pin (the root's UC-6; U1, U3, U4, U6 and U11 under their "UC-6" entries).

    // checked for every id that is a row
    const WAVE_DEFAULTS: Record<string, string | null> = {
      // U6a
      'surface.terminal': 'Cmd+J', 'surface.review': 'Cmd+Shift+D', 'surface.files': 'Cmd+Shift+F',
      // U6b
      'files.goToFile': 'Cmd+P', 'terminal.attachSelection': 'Cmd+Shift+L', 'go.back': 'Cmd+[', 'go.forward': 'Cmd+]',
      'zoom.in': 'Cmd+=', 'zoom.out': 'Cmd+-', 'zoom.reset': null,
      // U3
      'transcript.find': 'Cmd+F', 'transcript.findNext': 'Cmd+G', 'transcript.findPrevious': 'Cmd+Shift+G',
      'transcript.previousPrompt': 'Cmd+Alt+Up', 'transcript.nextPrompt': 'Cmd+Alt+Down',
      // U4
      'composer.queue': 'Cmd+Enter', 'composer.send': 'Cmd+Enter', 'composer.modelMenu': 'Cmd+Shift+I',
      'composer.effortMenu': 'Cmd+Shift+E', 'composer.modeMenu': 'Cmd+Shift+M', 'composer.historySearch': 'Ctrl+R',
      // U1
      'request.allowOnce': 'Cmd+Enter', 'request.allowLasting': 'Cmd+Shift+Enter', 'request.decline': 'Escape', 'request.accept': 'Enter',
      // U11
      'channel.open': null,
      // "Existing chords do not move"
      'tab.overview': 'Cmd+0', 'palette.open': 'Cmd+K', 'composer.focus': 'Cmd+L', 'composer.stop': 'Cmd+.', 'attention.next': 'Cmd+Shift+J',
      'shortcuts.open': 'Cmd+/', 'sidebar.toggle': 'Cmd+B', 'panel.toggle': 'Cmd+Shift+B', 'pane.split': 'Cmd+\\',
    };
    // rows of landed children: each must exist
    const LANDED = ['surface.terminal', 'surface.review', 'surface.files'];

### F. Sample rows for decision 12 (test data only, never in `ACTIONS`)

    'sample.find':    { title: 'Find…', chord: 'Cmd+F', sink: 'menu', menu: 'edit', submenu: 'Find', scope: 'app' }
    'sample.newline': { title: 'New line', chord: 'Shift+Enter', sink: 'renderer', menu: null, scope: 'composer', fixed: true }
    'sample.queue':   { title: 'Queue for after the turn', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'composer' }

With them: Edit ends in a separator and Find ▸ holding the first; the groups gain "Edit › Find" and list the second under "In the composer" with `fixed: true`; the dispatcher never runs the second and the palette does not list it; the third shares ⌘Enter with `composer.send` and the sharing rule passes. `menuTemplate` and `keymapGroups` are handed the extended table (decision 12); how a test supplies the rows to the dispatcher, the palette and the capture (an argument, a module mock) is the executor's.

### G. For a child that adds a key after this landing

Add the row to `ACTIONS` where the menu should show it (table order is menu order), with its `menu` and, where it sits in one, its `submenu`; or with `fixed: true` under the row rules of A. The menu nests it, the sheet and Settings group it, the palette lists it unless it is fixed, and the tests cover it. Two rows share a default only under decision 8. Nothing else in U6's files changes.

## Surprises & Discoveries

Found while checking the section against the code at `25942f5d1`, before any building. Each was reported to the wave's architect on 2026-11-12; none is resolved here beyond what the entry says.

1. Observation: A13's "no two dispatched rows share a default chord" cannot hold once U4 and U1 land. This document follows the root (decision 8).
   Evidence: the root's UC-6 table, "Queue for after the turn | ⌘Enter … (`composer.queue`; the reply fields keep `composer.send`)"; U1's file, "`request.allowOnce` (⌘↩)"; the child's own collision table, "the two rows share the default chord".
2. Observation: two more handlers take ⌘D without looking at Shift, in the same two editors: a slide's thumbnail in the deck's filmstrip and a board's row in the design editor's list. With the keyboard on either, ⇧⌘D duplicates the slide or the board and never reaches Review. The section's collision table names three handlers; these two are not edited by this landing without the architect's word.
   Evidence: `src/artifacts/slides/editor/Filmstrip.tsx` and `src/artifacts/design/editor/BoardList.tsx`, each `event.key === 'd' && (event.metaKey || event.ctrlKey)` followed by `preventDefault`. On macOS a key held with ⌘ and Shift reports its unshifted `key` (the note in `w3c-keyname`, the key-name library CodeMirror and ProseMirror use here: "On macOS, keys held with Shift and Cmd don't reflect the effect of Shift in `.key`"), so `'d'` matches. Not run in Electron here.
3. Observation: build F's reader of `settings.json` refuses the whole file when `keymap` holds an id it does not know, shows the defaults and then refuses every write of a client setting. This landing adds no id (decision 11). Every later child that adds a row adds an id, and a rebinding of it, stored by the wave's build, is such a value; UC-14 does not yet say where it is stored.
   Evidence: `keymap: z.partialRecord(z.enum(ACTION_IDS), …)` in `src/shared/ipc/schema/settings.ts`, inside the strict `ClientSettingsSchema`; `src/shared/ipc/schema/settings.test.ts`, "rejects an unknown action id"; the read and write rules in `src/shared/settings/file-store.ts`; these files are the same at build F (`f1852de3a`).
4. Observation: U4's file describes its editor keys as "a short fixed list beside the action table"; the root's UC-6 makes them `fixed` rows of the table, which is what this landing builds.
   Evidence: U4's file, Contracts, "UC-6, consumed", last bullet; the root's UC-6, "`fixed` (a key its own editor handles, listed and never dispatched)".
5. Observation: "no rebinding for a fixed row" lands in `src/renderer/src/settings-tab/KeymapSection.tsx`, which UC-8 gives to U11 with no insertion by U6 listed. It is planned here as one condition. The same section's hint, "all bindings editable" (`KEYBOARD.hint` in U11's `copy.ts`), stops being exact when the first fixed row lands.
   Evidence: the root's UC-8 table, the rows for `settings-tab/` and for U6.
6. Observation: the section's order for the View menu does not place `artifacts.open` (decision 4), and View is not wholly flat today: the three theme rows are already an Appearance submenu.
   Evidence: `section()` and `APPEARANCE` in `src/main/menu.ts`.

The collision table's other statements about the three chords hold: no row or menu role holds them; the terminal's filter and the in-app browser's `keyAction` leave them to the menu; CodeMirror's search binds ⌘D and ⌘F without Shift and its matcher does not fall back from ⇧⌘D to ⌘D; the composer's and the document's editors bind none of them.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before the executor starts, dispatched by the wave's architect. The branch gets `doperpowers:review-code` at medium, or the xhigh panel if the session that keeps master asks for it; it asks at about twenty changed files or a couple of thousand changed lines, and this landing is expected to touch about 24 files (9 product, 11 unit-test, 2 e2e, the charter and this document) and fewer than 1,200 changed lines, this document's own included. Class 1a on GitHub Actions (`static,unit,probes`) is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue.
  Rationale: the root's UC-10 and its Decision Log, "Verification"; the landing is the size the root calls single-reviewer, with a file count at the keeper's mark, so the number is stated for the keeper to judge.
  Date/Author: 2026-11-12, the author of this document, for the wave's architect.

## Outcomes & Retrospective

Pending — written at finish.
