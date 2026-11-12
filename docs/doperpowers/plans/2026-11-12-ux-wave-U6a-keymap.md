# UX wave · U6a · the keymap's shape (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U6**, first landing (**U6a**), parent pin `25942f5d1`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`: Edges → Blocks (which defines this landing); Contracts → "UC-6 · One keymap (owned)"; acceptance A13, A9 and the first sentence of A7; the items l7-shell-07 and l5-code-08; under "Rulings reversed", the entry l5-code-08. In the root: Purpose, the wave's laws, UC-6, UC-8, UC-10, UC-11, UC-14, and "Ordering and dependency map", step 0. Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code needs, the decisions the section left open, and the execution. The architect's rulings of 2026-11-12 on the six points reported at authoring, and the adversarial review's findings of the same day, are folded in (Surprises & Discoveries, Decision Log); the architect writes them into the spec's files, so where the child's file at the pin and a ruling differ, the ruling is the later word. **Branch:** `ux-wave/U6a`, from master `25942f5d1`; master is merged in before anything is built (Concrete Steps, 1). **Board:** #574 (the wave's epic is #573).

## Purpose

After this landing ⌘J, ⇧⌘D and ⇧⌘F show and hide Terminal, Review and Files from wherever the keyboard is; the View menu reads in groups, with Tabs, More surfaces, Comments, Appearance and Developer folded into submenus; and the shortcut sheet (⌘/) and Settings ▸ Keyboard list the keys under the same groups.

Behind that, the action table (`ACTIONS` in `src/shared/keymap/actions.ts`, the one list of the app's keys) gains the three fields of UC-6, and the menu, the sheet, Settings and the table's tests are driven by them. That is why it lands first and alone (root, step 0): U1, U3, U4, U11 and U6's own second landing each add rows to the table, and from this master a row is all they add in U6's files.

It also holds what the settings may store to what build F can read (UC-14): a rebinding is kept only for an action F knows, so a row added after this landing is listed in Settings ▸ Keyboard without a Change control until F is no longer a build to go back to.

How to see it working: the tests named under Acceptance fail at the commit that adds them and pass at the head; in a running build, the View menu, ⌘/, Settings ▸ Keyboard and the three chords read as "Interfaces and Dependencies" draws them.

## Progress

- [x] (2026-11-12 22:33Z) Execution document written; the section checked against the code at `25942f5d1`; six points reported to the wave's architect (Surprises & Discoveries).
- [x] (2026-11-12 22:45Z) The architect's rulings on the six points folded in (Decision Log): five Shift conditions, the rebinding guard and the hint are in scope; decisions 4, 8 and 10 stand.
- [x] (2026-11-12 22:59Z) Adversarial review of the revised document: two findings (the order of `effectiveChord`'s rules; the sample rows against U3's row), both fixed here, and three additions from the architect folded in (Decision Log).
- [x] (2026-11-12) Master merged into the branch (Concrete Steps, 1): `origin/master` `48619c824`, merge `12236850c`; it brought `docs/` only (the root and the register), nothing outside `docs/`.
- [x] (2026-11-12) The tests of Acceptance 1 to 3 and 8 committed first (`d61674b96`, with the constant of build F's ids and the sample rows they read: decision 16) and run on the VM. The failing summary lines, at `d61674b96`:
  - the first command of Concrete Steps 2: `Test Files  11 failed | 13 passed (24)`, `Tests  39 failed | 448 passed (487)`, exit 1. Among the failures: `surface.terminal: expected null to be 'Cmd+J'`; `expected [ 'Toggle Terminal surface', …(8) ] to deeply equal [ 'Terminal', 'Review', 'Files', …(6) ]`; `expected [ 'Appearance' ] to deeply equal [ 'Tabs', 'More surfaces', …(3) ]`; `expected 'Cmd+Y' to be 'Cmd+Enter'` (an override of a row that is not rebindable read); `expected 'Cmd+1' to be null` (Select tab not yielding to a stored rebinding); `Unable to find an accessible element with the role "table" and name "View › Tabs"`; and `TypeError: idsOf is not a function` / `isRebindable is not a function` where a test reaches a helper the head adds.
  - the second: `Test Files  8 failed | 13 passed (21)`, `Tests  10 failed | 411 passed (421)`, exit 1: each of the five handlers takes ⇧⌘D or ⇧⌘F (`d: expected false to be true`, the key prevented; the design canvas `{ kept: [ false, false ], reached: +0 }`, prevented and stopped), in both of the artifact projects.
  - Not red, by construction: the schema test of Acceptance 8 (the table's ids and the constant are the same 58 at this landing, so it pins the guard for the first row added after it) and the two filter pins of Acceptance 3 (the terminal's filter and `keyAction` already leave the three chords to the menu).
- [x] (2026-11-12) The table: the three fields, the rows of View and Go in menu order with their `submenu`, the nine surface titles, the three defaults, `effectiveChord`'s rules (`9038349ff`).
- [x] (2026-11-12) `menuTemplate`: nesting, the Edit placement, Developer ▸, separators.
- [x] (2026-11-12) The rebinding guard: the constant of build F's ids (`src/shared/keymap/build-f.ts`), the stored keymap's keys, `isRebindable`.
- [x] (2026-11-12) `keymapGroups` and the capture's conflict rule; Settings ▸ Keyboard's row that is not rebindable, and its hint; the dispatcher and the palette blind to fixed rows.
- [x] (2026-11-12) The five Shift conditions with their tests; the two filter pins of A7.
- [x] (2026-11-12) The e2e edits written (`e2e/shell.spec.ts`'s palette step; one scene in `e2e/ux2-shell.spec.ts`) and typechecked (not run by the executor).
- [x] (2026-11-12) The record: the charter's two sentences, three insertions.
- [ ] On the VM: typecheck, lint on the changed paths, the whole unit suite. Hand-back: the executor stops here.
- [ ] The architect's: class 1a green on the head the executor hands back; the xhigh panel, run by the session that keeps master; its findings settled; class 1a again on the final head if the panel changed the branch; the pull request.

## The landing's edge

| part of U6 | satisfied by this landing | stays for U6b, or for the child named |
|---|---|---|
| UC-6, "The shape" (`'edit'`, `submenu`, `fixed`) | in full | nothing |
| UC-6, "How the sheet and the menus are drawn" | in full | nothing |
| UC-6, "The table", U6's rows | the defaults of `surface.terminal`, `surface.review`, `surface.files` | `files.goToFile`, `terminal.attachSelection`, `go.back`, `go.forward`, `zoom.in`, `zoom.out`, `zoom.reset` and their handlers (U6b) |
| UC-6, "Collisions found" | the five Shift conditions for ⇧⌘D and ⇧⌘F: the three the table names at the pin and the two ruled in on 2026-11-12 | every other row of that table, with the landing that adds its chord (the file editor giving up ⌘[ and ⌘] is U6b) |
| UC-6, focus first; F6 | as built today, unchanged | F6 stops for new regions (each child; l7-shell-13 in U6b) |
| A13 | in full for the rows that exist; the test already holds UC-6's defaults for the rows to come (decision 9) | U6b adds its seven ids to the rows that must exist |
| A9 | the View menu in groups with the five submenus; the sheet and Settings under the same groups; the test that fails before: all in full. "The composer's own keys included": the mechanism, proved on a sample `fixed` row | the composer's keys themselves show when U4 adds its `fixed` rows |
| A7, first sentence | in full as far as a test reaches: the chords are menu accelerators, the terminal's and the in-app browser's key filters leave them to the menu, and the five handlers stop taking them | the hands-on check that macOS delivers them from a terminal and from a web page, and under the Korean input source (the child's Probes, 6; arranged by the architect); the rest of A7 (⇧⌘L, "Attach selection to chat") is U6b |
| l7-shell-07 | View in the stated order, without the zoom rows, its surface rows titled by the surface's name; Go in the stated order, without Back, Forward and Go to file; Edit able to take table rows; the sheet; Settings ▸ Keyboard, its hint without "all bindings editable" | the zoom rows, Back, Forward, Go to file, "Attach selection to chat" (U6b); Edit ▸ Find's rows (U3) |
| l5-code-08 | "Chords", in part: the three defaults, showing and hiding | giving the surface the keyboard and returning it to the composer, "Attach selection to chat", the starting folder (U6b) |
| "Rulings reversed": l5-code-08, and "The settings guard" (added by the architect on 2026-11-12) | in full: three insertions in the charter | its other four entries (U6b) |
| UC-14, with the rule the architect adds on 2026-11-12 (neither settings file changes its schema or its version while F may run) | in full for the keymap: the stored keys are held to build F's ids, and a row F does not know is not rebindable yet (decision 11) | deleting the constant and the rule when F is no longer a build to go back to (the owner's word) |
| l7-shell-06, -08, -09, -13, l5-code-11, -09, -10, l9-browser-delivery-03 and -08, O-37, Probes 1 to 5 and 7 to 9 | nothing | U6b |

The keyboard hand-off of l5-code-08 stays out because the code that shows and hides a surface (`toggleSurface` in `src/renderer/src/panel/SurfaceRow.tsx`) is U8's file (UC-8), U8b replaces the stacking under it with tabs, and this landing has no dependency on U8.

## Today, and what each part needs

Read at `25942f5d1`. The executor reads the code itself; this table says where the work is. A row's *placement* is the value of its `menu` field (which menu it sits in); its *sink* says whether the menu (`menu`) or the page's key dispatcher (`renderer`) hears its chord.

| part | today | needs |
|---|---|---|
| `ActionSpec` and `ACTIONS`, `src/shared/keymap/actions.ts` | `title`, `chord`, `sink`, `menu` (no `'edit'`), `scope`, `hold`. The nine `surface.*` rows are unbound and titled "Toggle … surface". `effectiveChord` answers the override, else the default | the three fields; the rows of View and Go in menu order with their `submenu`; nine titles, three defaults; `effectiveChord`'s two new rules (decisions 10 and 11) |
| `menuTemplate`, `src/main/menu.ts` | `section(placement)` lists a placement's `menu`-sink rows in table order with a separator where the id's prefix changes (`sidebar.` and `panel.` count as one group); the nine tab items sit inline; the three theme rows are gathered into an Appearance submenu appended last; Edit is written by hand and takes no rows; View ends with three developer roles inline and Toggle Full Screen; chords come from its own `chordOf` | nesting by `submenu` where the submenu's first row stands; Appearance placed by its rows like any other (its radio marks and short labels kept); `'edit'` rows after Edit's own items; the developer roles under Developer ▸; chords through `effectiveChord` |
| `keymapGroups`, `src/renderer/src/settings-tab/keymap.ts` | a group per placement (MAWS menu, File, View, Go, Help), then a group per scope for rows no menu holds; within a group by scope, then table order | the Edit placement; a group per submenu; `rebindable` on each row; the capture's conflict rule (decisions 7 and 10) |
| the sheet, `src/renderer/src/keymap/KeyboardShortcuts.tsx` | one table per group of `keymapGroups`, searched by title, id and chord | no change expected in the component: groups and fixed rows arrive through `keymapGroups`. Its test gains the cases |
| Settings ▸ Keyboard, `src/renderer/src/settings-tab/KeymapSection.tsx` and the hint in `copy.ts` | the same groups, each row with a Change control; the hint reads "all bindings editable · ⇧Tab cycles permission mode as in the terminal" | no control on a row that is not rebindable; the hint without its first clause (decisions 11 and 15) |
| the stored keymap: `SettingsSchema` in `src/shared/ipc/schema/settings.ts` (its `keymap` is reused by the client file's schema and by the patch `settings.set` takes) and `SettingsV2Schema` in `src/shared/settings/defaults.ts` | the keys are the table's ids (`z.enum(ACTION_IDS)`), so what the file may hold widens with every new row | the keys are build F's ids, from one constant (decision 11) |
| the dispatcher, `src/renderer/src/keymap/dispatcher.ts` | tries every `renderer` row in table order (`dispatchKey`); `keymapBinds` asks whether any row holds a key | neither ever counts a fixed row |
| the palette, `src/renderer/src/palette/CommandPalette.tsx` | lists every row | not a fixed row |
| five artifact handlers | each tests ⌘D or ⌘F without looking at Shift and takes the key | Shift up required |

## Decisions settled at authoring

Each is a means the section left open, or the architect's ruling of 2026-11-12 on a point reported, with its reason and what lost.

1. **One milestone, tests first.** The parts are meaningless apart (a field nothing draws, a menu with no rows to nest) and one reviewer reads the diff in one pass. The tests of Acceptance 1 to 3 are committed before the code they test, so "fails before" is a recorded run, not a claim.
2. **Table order is menu order.** The section draws each menu "in table order", so the rows of View and Go are reordered in the table to the order l7-shell-07 states (Interfaces, B). `renderer` rows keep today's relative order: the dispatcher tries them in table order, and that order is the priority between two rows on one chord. Lost: an order list in `menu.ts`, a second list of keys by another name.
3. **Which rows name which submenu** (Interfaces, B). Appearance becomes a `submenu` value like the others and the special case in `menu.ts` shrinks to its radio marks and short labels, so the sheet shows it as the menu does. `tab.next` and `tab.previous` (renderer rows placed in View) name Tabs too, so the sheet's Tabs group is whole. Developer holds role items only and is the menu's own.
4. **`artifacts.open` stays directly under Overview.** The section's order for View does not place it; it opens a place, as Overview does, and U7 keeps View ▸ Artifacts. Lost: inside More surfaces ▸, which is for tools beside the chat.
5. **Separators follow groups of ids, as today.** A separator stands between two neighbours (items or submenus) whose group differs. A row's group is the prefix of its id, except where the section's own words make one group of several prefixes; those aliases are for rows that exist today and are listed in Interfaces, C. A row a later child adds groups by its prefix with no edit to `menu.ts`. Lost: a `group` field on `ActionSpec` ("gains three things, and nothing else changes").
6. **The sheet and Settings get flat groups.** A submenu is a group of its own, labelled with its path (`View › Tabs`) and placed after its placement's group, in the order the submenus appear in the table. Both views already draw `group.label`, so neither component needs a second level. The label uses `›` because the app's own copy writes a menu path that way ("Settings › Browser"). Lost: nested groups, a new shape for two components to draw for no gain in reading.
7. **A fixed row is listed and otherwise absent.** By rule it is `sink: 'renderer'`, `menu: null`, with a chord and the scope of the surface that handles it. It takes no rebinding and yields to none: `effectiveChord` answers its default always (the key is its editor's, not the table's to move), and Settings draws no Change control on it and nothing in its place (law 3). The dispatcher and `keymapBinds` skip it; the palette does not list it (it is not an act that can run); the sheet and Settings list it under its scope; the capture's conflict check does not count it as a holder. Lost: counting it as a holder, so that nothing can be bound onto Enter. That needs a refusal sentence in U11's copy and guards a hole that is open today for every key an editor owns (⇧Enter can be bound to a composer action now); it is residue for the landing that adds the first fixed row.
8. **A13's second assertion, as the root's table needs it.** A13 reads "no two dispatched rows share a default chord". UC-6 in the root gives ⌘Enter to `composer.queue` and `composer.send`, and U1 adds `request.allowOnce` on it. The root binds, so the test asserts what the dispatcher can honour: two dispatched rows share a default only if both are `renderer` rows and at most one of them has scope `app`. A `menu` chord is held window-wide and an `app` row is reached from anywhere, so neither can share; rows of scope `pane` and `composer` are told apart by where the focus is. Ruled by the architect on 2026-11-12, who amends A13's sentence in the child's file to this rule.
9. **How A13's first assertion grows.** The test holds UC-6's table once, by id (Interfaces, E): every key the wave adds and every chord UC-6 says does not move. A row is checked from the moment it exists, so a child's landing is tested with no edit to U6's test. The rows of landed children must exist: this landing's three now; U6b adds its seven. The `fixed` rows of U4 are not in the list because the spec gives them no ids; U4's own document names them and amends the list (the architect's ruling of 2026-11-12). A child whose execution settles another id or chord amends the list in its own pull request, which is the contract changing where it is written.
10. **A stored rebinding wins over a default added later.** If the settings bind action X to a chord and a later build gives action Y that chord as its default, both would hold it, and which of the two the key reached would be an accident of menu and table order. `effectiveChord` answers null for Y while X's override holds the chord, so the person's key keeps doing what they bound it to, Settings shows Y unbound, and binding Y elsewhere or freeing X restores it. Y is any dispatched row, whether or not it can itself be rebound: the rows the wave adds are the ones that cannot yet (decision 11), and they are the rows this rule exists for. A profile that holds `palette.open` on ⌘P must find U6b's Go to file unbound, not a second owner of ⌘P. Nothing stored changes, which is what UC-14 and the `keep` on the rebindable keymap (l7-shell-12) ask. Conversely the capture never refuses an action its own default because another row holds that chord by default: the table's own sharing (decision 8) must be restorable. Lost: rewriting the settings at first read (a write build F then reads, and a rule that cannot be undone by freeing the key); doing nothing (a kept binding silently broken). The architect adds the rule to the child's UC-6 (ruling of 2026-11-12). One consequence is residue: a row that yields this way and is not rebindable yet (decision 11) stays unbound until the person frees the key.
11. **A row build F does not know is not rebindable yet.** UC-14, with the rule the architect adds on 2026-11-12: while F may run on the same profile, neither settings file changes its schema or its version. `settings.keymap` is part of that schema, and F refuses the whole of `settings.json` when it holds an id F does not know (Surprises & Discoveries, 3). So:
    - *The constant.* One constant under `src/shared/keymap/` lists the action ids build F knows: the 58 of today's table (the table is the same at `f1852de3a`). Its comment says it is deleted, with this rule, when F is no longer a build to go back to, on the owner's word.
    - *Where the refusal sits: in the settings schema.* The keys of `keymap` are the constant's ids instead of the table's, at the one definition every reader and writer shares: the client file's schema, which the store applies to the file it reads and again before every write, and the patch `settings.set` takes, which the IPC boundary applies to every caller. The capture writes through that patch, so neither it nor any other patch can store a rebinding of another id, and what the file may hold no longer widens when a child adds a row. The version 2 schema of the unified file takes the same keys, so there is one definition.
    - *Rebindable.* A row is rebindable when it is not fixed and its id is in the constant. An override of a row that is not rebindable is never read, and Settings ▸ Keyboard draws no Change control on it. It is otherwise an ordinary row: dispatched, in the menu, the sheet and the palette, and it yields its default to a stored rebinding of another row as any dispatched row does (decision 10): a row that cannot take a rebinding still cannot take a key the person gave away. `KeymapRow` carries one flag, `rebindable`, for both cases, so the insertion in U11's `KeymapSection.tsx` stays one condition.
    - *Today's rows.* This landing adds, removes and renames no id, so all 58 stay rebindable and nothing a profile holds reads differently.

    Lost: a second store for the rebindings of new ids (the architect's ruling: complexity for keys nobody has yet rebound, law 4); a check in the capture or in main's settings service instead (it guards one caller and leaves the schema widening with every row, which is the schema changing); dropping such a key when the file is read (no route writes one, and a strict read is today's rule for an unknown id). The charter's "All bindings editable" (§5.8) gains a dated sentence for the limit (The record).
12. **The tests of U6's files are generic over the table.** A literal expectation is kept only for rows that exist now, by id or as a subsequence. Each generic assertion is also run over a table extended with sample rows shaped as the siblings' will be (Interfaces, F), which is the proof that a later row needs no edit here; none of the sample ids is in the constant of decision 11, so the same rows prove that decision. The samples are chosen so that this run stays green with every row of Interfaces, E present, or the first sibling to land would have to repair U6's test: the sample `menu` row holds a chord that no row of today's table, no row of Interfaces, E, none of the nine tab chords and no menu role holds, and sits in a submenu no real row names; the sample that shares a chord on purpose is a `renderer` row of scope `composer`, which decision 8 lets share with any `renderer` row. A test holds the first: the sample `menu` row's chord is no value of `WAVE_DEFAULTS`; the run over the extended table covers the real table, the tab chords and the roles. An assertion that a row of Interfaces, E would fail is a defect of this landing. So `menuTemplate` and `keymapGroups` take the table as an argument (as `menuTemplate` does today) and walk that table's rows, not the global list of ids.
13. **The record is the charter**: l5-code-08's sentence at its two places, as the child's file names them, and the settings guard's sentence in §5.8 (the architect's ruling of 2026-11-12; the child's file lists it under "Rulings reversed" as "The settings guard"). The line in C5's plan (`docs/doperpowers/plans/2026-09-28-c5-shell.md`, "⌘J (bottom dock) is P1 and has no action") is the record of what C5 built and stays.
14. **Titles.** The nine `surface.*` rows are titled by the name inside today's title: Terminal, Review, Browser, Files, Source control, Subagents, Background work, Session info, Questions. The palette, the sheet and the title bar's tooltips follow from the table.
15. **The hint.** `KEYBOARD.hint`, the line under Settings ▸ Keyboard's heading, loses its clause "all bindings editable · " and reads "⇧Tab cycles permission mode as in the terminal". The architect's ruling of 2026-11-12: by decision 11 the clause stops being true at the first row F does not know, and a hint that says less is right by law 3. One string in U11's `copy.ts`. No test pins it today and none is added for one string.

## Acceptance

1. **A13.** `src/shared/keymap/actions.test.ts` fails at the commit that adds the tests and passes at the head. It asserts: every id of Interfaces, E that is a row holds that default, and the three surface ids are rows; decision 8's rule over every chord a dispatched row holds (the nine of Select tab included); no default is a chord of `MENU_ROLE_CHORDS`; the row rules of Interfaces, A; `effectiveChord`'s rules.
2. **A9.** `src/main/menu.test.ts`: every `menu`-sink row is in the built menu once (nine times for Select tab), under its placement and, when it names one, its submenu; an `'edit'` row comes after Edit's own items; View's submenus are Tabs, More surfaces, Comments, Appearance, Developer, in that order; no menu starts or ends with a separator or has two in a row; the rows of View and Go that exist now stand in the order of Interfaces, B and C, checked as a subsequence so that a later row may stand between them. `src/renderer/src/settings-tab/keymap.test.ts`: every row is in exactly one group, and the group's label is its placement's, its submenu's path, or its scope's. The sheet's and Settings' tests: a submenu's group is drawn under its path; a fixed row is listed with its key; Settings draws no Change control on it.
3. **A7, first sentence.** `src/renderer/src/terminal/keys.test.ts`: the terminal's filter leaves ⌘J, ⇧⌘D and ⇧⌘F to the app. `src/main/menu.test.ts`: the in-app browser's `keyAction` takes none of the three. The tests of the five handlers (the deck's stage and its filmstrip, the design canvas and its board list, the document editor): with Shift down the key is neither acted on nor prevented, and without Shift ⌘D and ⌘F do what they did.
4. **In a running build** (the architect's run on a Mac, then the owner's sitting; not the executor's): the View and Go menus read as Interfaces, C; ⌘/ lists the keys under View, View › Tabs, View › More surfaces, View › Comments, View › Appearance and the rest; Settings ▸ Keyboard shows the same groups; ⌘J, ⇧⌘D and ⇧⌘F show and hide the three surfaces with the keyboard in the composer, in a terminal and in a page of the in-app browser; the title bar's Terminal, Review and Files buttons name their chords in their tooltips; the line under Settings ▸ Keyboard's heading reads "⇧Tab cycles permission mode as in the terminal" and every row there still has its Change control.
5. **Keep** (law 8, l7-shell-12). No existing chord moved (the kept list of Interfaces, E); a stored override applies as before and wins over a new default (decision 10).
6. **The record.** `docs/charter.md` carries the two sentences of "The record" below, the first at both of its places.
7. **Nothing gated got worse.** On the VM: `pnpm typecheck`, eslint on the changed paths and `pnpm test` pass (the executor's). Class 1a on GitHub Actions is green on the head the panel reviews and on the final head (the architect's runs: one before the panel, and one more after its findings are settled if they changed the branch).
8. **The rebinding guard** (UC-14, decision 11). `src/shared/ipc/schema/settings.test.ts`: the keys the client file's schema and the patch accept under `keymap` are exactly the constant's ids, each accepted and any other id refused. `src/shared/keymap/actions.test.ts`: the constant holds 58 ids, each once and each a row; an override of a row whose id is outside it, or of a fixed row, is not read; and on the extended table of Interfaces, F a stored override of one of today's actions that holds a new action's default leaves the new action unbound, in `effectiveChord` and in the built menu, which carries that accelerator once. The groups' and Settings' tests: such a row is listed with `rebindable: false` and no Change control, and every row of today's table keeps its control.

## Constraints that bind the work

- **The design binds.** The child's file and the root, at the places the header names. A point where the code contradicts the section, where the work needs an edit in another child's file beyond the insertions named below, where a contract would have to change, or where the owner would see something the section does not say: stop on it and hand it back to the architect with the evidence. Everything else is decided in the spirit of the section and recorded in the Decision Log.
- **Law 8 and UC-6.** No existing chord moves and no existing id changes.
- **UC-8, ownership.** U6's: `src/shared/keymap/`, `src/main/menu.ts`, `src/renderer/src/keymap/`, `src/renderer/src/palette/`, `src/renderer/src/terminal/`, `src/renderer/src/settings-tab/keymap.ts`, and their tests. Insertions in other children's files, each the smallest that does it, all named by the child's file or ruled in by the architect on 2026-11-12 (who adds them to UC-8 and to the collision table). In U10's files, one Shift condition with a test case each: `src/artifacts/slides/editor/transform/Overlay.tsx`, `src/artifacts/slides/editor/Filmstrip.tsx`, `src/artifacts/design/editor/World.tsx`, `src/artifacts/design/editor/BoardList.tsx`, `src/artifacts/document/editor/DocumentEditor.tsx`. In U11's files: one condition in `src/renderer/src/settings-tab/KeymapSection.tsx` with a case in its test, and one string in `src/renderer/src/settings-tab/copy.ts` (decision 15). The stored keymap's keys in `src/shared/ipc/schema/settings.ts` and `src/shared/settings/defaults.ts` have no owner in UC-8's table and are this landing's by the ruling on UC-14.
- **UC-14.** While build F may run on the same profile, neither settings file changes its schema or its version: F's reader is strict, and an unknown key, an unknown action id or another version makes F show the defaults for every client setting and refuse to write them (the rule the architect adds on 2026-11-12). Decision 11 is how the keymap keeps it. Its one edit to the schema's source replaces the keys' list and leaves what the schema accepts today unchanged; nothing else in either schema, no version and not `RETIRED_ACTION_IDS` is touched.
- **UC-11, the repository is public.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages, documents or pull-request text. Fixtures use invented content.
- **Where checks run (UC-10).** On the MacBook the worktree carries no `node_modules` and nothing is installed, typechecked, linted, tested, built or launched. Every check runs on the wave's build VM in a checkout of the pushed head (Concrete Steps). Class 1a on GitHub Actions is the gate of record, and it is the architect's to run: on the head the executor hands back, before the panel, and again on the final head if the panel's findings changed the branch. The executor does not start it, and does not start Electron e2e.
- **Git.** Commit as you go and push `ux-wave/U6a`. Never commit to master or to `ux-wave-spec`, and never edit the spec's files. No attribution trailer but the `Sminos-Session:` line the dispatch gives, which ends every commit message and the pull request's body. The pull request is the architect's to open, after the gate; its body opens with the root's path, "U6, first landing" and the parent pin, and names its class 1a run, its review verdict and its residue, which the executor's hand-back supplies.

## Plan of Work

### M1 — The table's shape, the grouped menus and sheet, the three surface chords and the rebinding guard

**What exists at its end.** What Purpose describes: the three chords, the View and Go menus in groups, the sheet and Settings ▸ Keyboard under the same groups, a table whose next row needs no edit in U6's other files, and a stored keymap build F can always read. Acceptance 1 to 8 are its checks.

**What it touches.**

- `src/shared/keymap/actions.ts` and its test: Interfaces, A, B and E. A new file beside it for the constant of build F's ids.
- `src/shared/ipc/schema/settings.ts` and its test, `src/shared/settings/defaults.ts`: the stored keymap's keys (decision 11), and nothing else in them.
- `src/main/menu.ts` and its test: Interfaces, C. `src/main/menu-roles.test.ts` should pass unchanged (it walks submenus).
- `src/renderer/src/settings-tab/keymap.ts` and its test: Interfaces, D.
- `src/renderer/src/settings-tab/KeymapSection.tsx` and its test: the one condition. `src/renderer/src/settings-tab/copy.ts`: the hint.
- `src/renderer/src/keymap/dispatcher.ts`, `key-dispatch.test.tsx`, `KeyboardShortcuts.test.tsx`; `src/renderer/src/palette/CommandPalette.tsx` and its test.
- `src/renderer/src/terminal/keys.test.ts`: the pin of Acceptance 3 (no change to `keys.ts` is expected).
- The five artifact handlers and their tests (`transform.dom.test.tsx` beside the stage, `Filmstrip.dom.test.tsx`, the design editor's and the document editor's `*.dom.test.tsx`).
- `e2e/shell.spec.ts` and `e2e/ux2-shell.spec.ts`: below.
- `docs/charter.md`: "The record" below.

**Decisions that belong here and nowhere above.**

- *The Shift conditions.* In each of the five handlers the branch for ⌘D (or ⌘F) also requires Shift up, and with Shift down the handler leaves the event alone: no `preventDefault`, no `stopPropagation`, so the key goes on to the menu. Read the whole handler first: a later branch must not take the key instead.
- *The constant.* A literal list in today's table order, never derived from the table (it would grow with it); `git show f1852de3a:src/shared/keymap/actions.ts` is what it is compared with. The stored keymap's type narrows to those ids while `KeymapOverrides` stays keyed by every id; the first is assignable to the second, so the readers of `settings.keymap` need no change.
- *Stale comments.* The comments in `actions.ts` and `menu.ts` that say the table has no submenu, or that describe the old View, and the one in `settings-tab/keymap.ts` that says every action is editable, are corrected where they stand. The comment that View has no zoom roles stays true until U6b.
- *The e2e edits.* `e2e/shell.spec.ts`, the palette step: it counts and reads the rows the palette lists, which are now the rows that are not fixed. `e2e/ux2-shell.spec.ts` gains one scene with a session's tab in front: the installed menu's items `surface.terminal`, `surface.review` and `surface.files` carry `Cmd+J`, `Cmd+Shift+D` and `Cmd+Shift+F`; clicking each by id (`e2e/support/menu.ts`) shows its surface and clicking it again hides it; View's submenus are the five of Acceptance 2; `shortcuts.open` opens the sheet with a table named "View › Tabs". Keep the scene free of how two surfaces arrange, which U8b changes. A key equivalent cannot be pressed through Playwright (the helper's own comment), so the scene clicks items and reads accelerators. Both files must typecheck (`pnpm typecheck` covers `tsconfig.e2e.json`); neither is run by the executor. The hand-back names them and the group `e2e:layout`.
- *Pitfalls seen while reading.* `ACTIONS` is `as const`, so an optional field is read through `ActionSpec` (as `hold` is today). The nine tab chords are expanded in four places (`menu.ts`, `settings-tab/keymap.ts`, `dispatcher.ts`, `terminal/keys.ts`); one shared helper may replace them, and need not. Several existing tests pin an exact list over the real table (the group labels and the "In a pane" rows in `keymap.test.ts`, "no chord is ⌥Enter" in `actions.test.ts`, the palette's count): by decision 12 each becomes generic, the last two over dispatched rows, or a sibling's row would fail it.

**What it does not touch.** `toggleSurface` and everything under `src/renderer/src/panel/` (U8). `SHELL_FOCUS_ACTIONS`. Any handler for a new action. The palette beyond not listing fixed rows (l7-shell-06 is U6b). `src/renderer/src/settings-tab/` beyond `keymap.ts`, the one condition and the one string. `src/main/browser/` (the pin of Acceptance 3 imports `keyAction` into U6's own test). `src/artifacts/` beyond the five conditions and their tests. Either settings schema beyond the keymap's keys, and either file's version. The charter beyond the three insertions of "The record". The spec's files. The class 1a gate and the pull request.

**What it proves.** Acceptance 1 to 3, 5, 6, 8 and the VM's half of 7 by its own runs; Acceptance 4 and the gate of 7 are the architect's, and 4 is also the owner's sitting. Its tests also pin, beyond what acceptance states: a table extended with the sample rows of Interfaces, F passes every generic assertion; an override of a row that is not rebindable changes nothing; `effectiveChord` yields a default to another row's override and returns it when the override goes, for a row that is rebindable and for one that is not; the capture accepts an action's own default where another row shares it by default.

### The record (in the same pull request, UC-10)

Two sentences, each exactly as written.

l5-code-08 reverses the charter's ⌘J where it stands. Append to the end of the paragraph of `docs/charter.md` §5.8 (Keyboard) and to the end of §3's P1 bullet "Bottom dock for the auxiliary panel host (terminal drawer).":

> Amended 2026-11-12 (UX wave, l5-code-08): ⌘J shows and hides the Terminal side surface, as in Claude Desktop; the bottom dock stays deferred and holds no chord.

The settings guard limits §5.8's "All bindings editable" (decision 11). Append to the end of §5.8's paragraph, after the ⌘J sentence:

> Amended 2026-11-12 (UX wave, UC-14): an action added after build `f1852de3a` takes no rebinding while that build can still be gone back to, because its reader of the settings refuses an action it does not know; the limit goes when that build is retired.

The register's rows, the board ticket and the tracking map are updated at landing by the sessions that keep them, not by the executor.

## Concrete Steps

From the worktree of branch `ux-wave/U6a`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Expect a merge with no conflict that brings in files under `docs/` and nothing else (`git diff --name-only 25942f5d1 origin/master | grep -v '^docs/'` prints nothing; if it prints a path this document names, read that file again against "Today, and what each part needs" before building on it). After it the spec's files in the tree are master's.

2. **The checks**, on the VM. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U6a
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec vitest run src/shared/keymap src/shared/ipc/schema/settings.test.ts src/shared/settings src/main/menu.test.ts src/main/menu-roles.test.ts src/renderer/src/settings-tab/keymap.test.ts src/renderer/src/settings-tab/KeymapSection.test.tsx src/renderer/src/keymap src/renderer/src/palette src/renderer/src/terminal/keys.test.ts'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec vitest run src/artifacts/slides/editor/transform/transform.dom.test.tsx src/artifacts/slides/editor/Filmstrip.dom.test.tsx src/artifacts/design/editor src/artifacts/document/editor/DocumentEditor.dom.test.tsx'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm exec eslint src/shared/keymap src/shared/ipc/schema/settings.ts src/shared/ipc/schema/settings.test.ts src/shared/settings src/main/menu.ts src/main/menu.test.ts src/renderer/src/settings-tab src/renderer/src/keymap src/renderer/src/palette src/renderer/src/terminal src/artifacts/slides/editor src/artifacts/design/editor src/artifacts/document/editor e2e/shell.spec.ts e2e/ux2-shell.spec.ts'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6a -- 'pnpm test'

   The first call for the branch installs dependencies on the VM and takes a few minutes. Each call prints `vmcheck: ux-wave/U6a at <short sha>` and then the command's output; its exit status is the command's. At the tests-first commit the first two commands fail, with lines such as `expected null to be 'Cmd+J'` for a surface row; at the head each prints vitest's `Test Files … passed` with no failure, `pnpm typecheck` prints no error, and eslint prints nothing.

3. **Stop and hand back.** The executor runs no gate and opens no pull request. The hand-back says: what exists and the command and result that showed it; what is not verified (Acceptance 4, and the two e2e files, written and typechecked but not run: group `e2e:layout`; the groups whose scenes cross the code touched, for the architect to run on a Mac, are `e2e:settings` for Settings ▸ Keyboard, and `e2e:presentations`, `e2e:design` and `e2e:document` for the five handlers); the decisions made; anything that contradicts the spec; and the residue. Residue known at authoring: the hands-on check of the three chords from a terminal, from a web page and under the Korean input source (the child's Probes, 6); a fixed key can still be taken by a rebinding (decision 7); a row build F does not know cannot be rebound until the constant and its rule are deleted on the owner's word, and one that yields its default to a stored rebinding stays unbound meanwhile (decisions 10 and 11).

4. **The architect's, after the hand-back.** Class 1a runs first, on the head handed back, in the background (it waits for its run, up to half an hour):

       scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6a

   It prints each job's conclusion and the run's URL and exits 0 only when the run is green. When it is green the session that keeps master is handed the base sha, the head sha and the worktree path and runs the xhigh panel on that range (Decision Log). If the panel's findings change the branch, the same command runs again on the final head; the run on the final head is the one the pull request's body names.

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
    export function isRebindable(id: ActionId, table?: ActionTable): boolean; // not fixed, and an id build F knows
    export function effectiveChord(id: ActionId, overrides: KeymapOverrides, table?: ActionTable): string | null;

    // src/shared/keymap/build-f.ts (new): the 58 ids of the table at build F, a literal list
    export const BUILD_F_ACTION_IDS: readonly [ActionId, ...ActionId[]];

Row rules, tested over every row: a row that names a `submenu` has a `menu`; a `fixed` row is `sink: 'renderer'`, `menu: null`, with a chord and no `hold`; a `menu`-sink row has a `menu` (today's rule); a row whose scope is not `app` is a `renderer` row (today's rule); every chord parses.

`effectiveChord`, in this order:

1. A fixed row answers its default, always: it takes no override and yields to none.
2. A rebindable row with an override of its own answers that override (null unbinds). An override of a row that is not rebindable is not read.
3. Every other case, which is every dispatched row with no override that counts, rebindable or not: its default, or null while another rebindable row's own override holds that chord (for Select tab 1–9 on either side, any of the nine it expands to).

A *dispatched* row is one that is not fixed; a *rebindable* row is a dispatched row whose id is in `BUILD_F_ACTION_IDS` (decision 11).

The stored keymap: the key list of `keymap` in `SettingsSchema` (`src/shared/ipc/schema/settings.ts`) and in `SettingsV2Schema` (`src/shared/settings/defaults.ts`) is `BUILD_F_ACTION_IDS`, from one definition. The two IPC messages in `src/shared/ipc/schema/layout.ts` that carry action ids (`layout.action`, `layout.setEnabledActions`) are not stored and keep following the table.

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

    export interface KeymapRow { id: ActionId; title: string; chord: string | null; display: string; overridden: boolean; rebindable: boolean }
    export function keymapGroups(overrides: KeymapOverrides, table?: ActionTable): KeymapGroup[];

Groups in this order, empty ones dropped: for each placement of MAWS menu, File, Edit, View, Go, Help, the group of its rows that name no submenu, then one group per submenu in the order the submenus first appear in the table, labelled `<placement> › <submenu>`; then App-wide, In a pane, In the composer for the rows no menu holds, fixed rows among them. Within a group: by scope, then table order, as today. `rebindable` is `isRebindable` of the row; Settings ▸ Keyboard draws the Change control only where it is true.

The capture's conflict rule (`conflictOf`): a fixed row is never a holder; and when the chord asked for is the action's own default, a row that holds it as its own default is not a conflict (decision 10).

### E. UC-6's table, as the test holds it (`src/shared/keymap/actions.test.ts`)

Ids and chords as the spec's files give them at the parent pin (the root's UC-6; U1, U3, U4, U6 and U11 under their "UC-6" entries). U4's document adds the ids of its `fixed` rows.

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

    'sample.menu':   { title: 'Sample menu row', chord: 'Ctrl+Alt+Shift+F12', sink: 'menu', menu: 'edit', submenu: 'Sample', scope: 'app' }
    'sample.fixed':  { title: 'Sample fixed key', chord: 'Shift+Enter', sink: 'renderer', menu: null, scope: 'composer', fixed: true }
    'sample.shared': { title: 'Sample shared chord', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'composer' }

The first is shaped as U3's Edit ▸ Find rows will be, on a chord and in a submenu nothing real holds or names (decision 12); the second as U4's editor keys; the third shares ⌘Enter on purpose, as U4's `composer.queue` will.

With them: Edit holds, after its own items, a Sample ▸ submenu with the first; the groups gain "Edit › Sample" and list the second under "In the composer"; all three read `rebindable: false`, Settings draws no Change control on them, and an override of any of them is not read; with `palette.open` stored on the first one's chord, the first reads unbound and the built menu carries that accelerator once; the dispatcher never runs the second and the palette does not list it; the third shares ⌘Enter with `composer.send` and the sharing rule passes. `menuTemplate` and `keymapGroups` are handed the extended table (decision 12); how a test supplies the rows to the dispatcher, the palette and the capture (an argument, a module mock) is the executor's.

### G. For a child that adds a key after this landing

Add the row to `ACTIONS` where the menu should show it (table order is menu order), with its `menu` and, where it sits in one, its `submenu`; or with `fixed: true` under the row rules of A. The menu nests it, the sheet and Settings group it, the palette lists it unless it is fixed, and the tests cover it. Two rows share a default only under decision 8. Until the constant of decision 11 is deleted the new row is not rebindable, and the child does nothing for that. Nothing else in U6's files changes.

## Surprises & Discoveries

Found while checking the section against the code at `25942f5d1`, before any building. Each was reported to the wave's architect on 2026-11-12 and ends with the ruling given the same day.

1. Observation: A13's "no two dispatched rows share a default chord" cannot hold once U4 and U1 land.
   Evidence: the root's UC-6 table, "Queue for after the turn | ⌘Enter … (`composer.queue`; the reply fields keep `composer.send`)"; U1's file, "`request.allowOnce` (⌘↩)"; the child's own collision table, "the two rows share the default chord".
   Ruling: decision 8 is the rule; the architect amends A13's sentence in the child's file to it.
2. Observation: two more handlers take ⌘D without looking at Shift, in the same two editors: a slide's thumbnail in the deck's filmstrip and a board's row in the design editor's list. With the keyboard on either, ⇧⌘D duplicates the slide or the board and never reaches Review. The section's collision table names three handlers.
   Evidence: `src/artifacts/slides/editor/Filmstrip.tsx` and `src/artifacts/design/editor/BoardList.tsx`, each `event.key === 'd' && (event.metaKey || event.ctrlKey)` followed by `preventDefault`. On macOS a key held with ⌘ and Shift reports its unshifted `key` (the note in `w3c-keyname`, the key-name library CodeMirror and ProseMirror use here: "On macOS, keys held with Shift and Cmd don't reflect the effect of Shift in `.key`"), so `'d'` matches. Not run in Electron here.
   Ruling: both are in this landing, the same condition and a test case each, as insertions in U10's files; the architect adds them to the collision table. Five Shift conditions.
3. Observation: build F's reader of `settings.json` refuses the whole file when `keymap` holds an id it does not know, shows the defaults and then refuses every write of a client setting. This landing adds no id. Every later child that adds a row adds an id, and a rebinding of it, stored by the wave's build, would be such a value; UC-14 at the pin does not say where it is stored.
   Evidence: `keymap: z.partialRecord(z.enum(ACTION_IDS), …)` in `src/shared/ipc/schema/settings.ts`, inside the strict `ClientSettingsSchema`; `src/shared/ipc/schema/settings.test.ts`, "rejects an unknown action id"; the read and write rules in `src/shared/settings/file-store.ts`; these files are the same at build F (`f1852de3a`).
   Ruling: the guard is built in this landing (decision 11). UC-14 gains the general rule that neither settings file changes its schema or its version while F may run. Rejected by the architect: a second store for such rebindings (law 4), and accepting the risk (it breaks UC-14's promise silently).
4. Observation: U4's file describes its editor keys as "a short fixed list beside the action table"; the root's UC-6 makes them `fixed` rows of the table, which is what this landing builds.
   Evidence: U4's file, Contracts, "UC-6, consumed", last bullet; the root's UC-6, "`fixed` (a key its own editor handles, listed and never dispatched)".
   Ruling: the architect corrects U4's file to `fixed` rows of the table; U4's document names their ids and amends Interfaces, E.
5. Observation: "no rebinding for a fixed row" lands in `src/renderer/src/settings-tab/KeymapSection.tsx`, which UC-8 gives to U11 with no insertion by U6 listed. The same section's hint, "all bindings editable" (`KEYBOARD.hint` in U11's `copy.ts`), stops being exact when the first fixed row lands.
   Evidence: the root's UC-8 table, the rows for `settings-tab/` and for U6.
   Ruling: the insertion is in; the architect adds it to UC-8. This landing also drops the clause from the hint (decision 15), since by decision 11 it stops being true at the first row F does not know.
6. Observation: the section's order for the View menu does not place `artifacts.open`, and View is not wholly flat today: the three theme rows are already an Appearance submenu.
   Evidence: `section()` and `APPEARANCE` in `src/main/menu.ts`.
   Ruling: decision 4 stands; the architect corrects the wording in the child's file, and U3's file, which after this landing adds rows and does not edit `menu.ts`.

The collision table's other statements about the three chords hold: no row or menu role holds them; the terminal's filter and the in-app browser's `keyAction` leave them to the menu; CodeMirror's search binds ⌘D and ⌘F without Shift and its matcher does not fall back from ⇧⌘D to ⌘D; the composer's and the document's editors bind none of them.

## Decision Log

- Decision: verification for this landing. This document is reviewed adversarially before the executor starts (done on 2026-11-12, on the revision that carries the rulings; the third entry). The branch is reviewed by the xhigh panel of `doperpowers:review-code`, which the session that keeps master runs itself; no single reviewer runs first. Class 1a on GitHub Actions (`static,unit,probes`) is the gate of record, and that session asked for it green before its panel starts (2026-11-12): when the branch is complete and its checks on the VM are green, the wave's architect runs class 1a on that head and, once it is green, hands that session the base sha, the head sha and the worktree path; if the panel's findings change the branch, class 1a runs again on the final head; then the architect opens the pull request, whose body names its class 1a run, its review verdict and its residue. The landing is expected to touch about 32 files (15 product, 13 unit-test, 2 e2e, the charter and this document) and fewer than 1,500 changed lines, this document's own included.
  Rationale: the root's UC-10 and its Decision Log, "Verification". At authoring this entry read "medium, or the panel if the session that keeps master asks"; the architect settled it on 2026-11-12, the landing being past that session's mark of about twenty files.
  Date/Author: 2026-11-12, the author of this document at authoring; the wave's architect for what is settled.
- Decision: the architect's rulings on the six points reported at authoring, folded in. (1) The two further ⌘D handlers are in scope: five Shift conditions. (2) Decision 8 is the rule and A13's sentence is amended to it in the child's file. (3) The rebinding guard is built in this landing (decision 11), under the rule added to UC-14 and stated in Constraints; decision 10 stands and joins the child's UC-6. (4) U4's editor keys are `fixed` rows; U4's document names their ids and amends Interfaces, E. (5) The insertion in `KeymapSection.tsx` is in UC-8, and the hint loses "all bindings editable" (decision 15). (6) Decision 4 stands. Under ruling 3 two things were left to this document and are decided in decision 11: the refusal sits in the settings schema's keys for `keymap`, and `KeymapRow` carries one flag, `rebindable`.
  Rationale: each ruling as the wave's architect gave it; what lost is with the decision it shaped (decision 11: a second store, a check outside the schema, a lenient read).
  Date/Author: 2026-11-12, the wave's architect (the rulings), the author of this document (the fold).
- Decision: the adversarial review's two findings and the architect's three additions, folded in. (1) `effectiveChord`'s order (Interfaces, A; decisions 7, 10 and 11): only a fixed row answers its default always; a row that is not rebindable has its own override ignored and still yields its default to another row's stored rebinding. (2) The sample rows (Interfaces, F; decision 12): the `menu` sample moves off ⌘F and out of the Find submenu, and the samples must stay green with every row of Interfaces, E present. (3) Verification is settled as the first entry now reads. (4) The charter gains a second sentence, for the settings guard (The record; decision 13). (5) Master is merged first; the executor stops after the checks on the VM; the class 1a gate and the pull request are the architect's.
  Rationale: (1) as first written, a row that is not rebindable returned its default before the yield was looked at. Every row the wave adds is such a row, so a stored `palette.open` on ⌘P and U6b's Go to file would both have held ⌘P: decision 10 defeated for exactly the rows it exists for. (2) U3's `transcript.find` is a `menu` row on ⌘F; a `menu` sample on the same chord would have failed the sharing rule on a correct table the day U3 landed, and U3 would have had to repair U6's test. (3) to (5) as the architect gave them: one gate, on the final head.
  Date/Author: 2026-11-12, the adversarial reviewer (the findings), the wave's architect (the additions), the author of this document (the fold).

- Decision: the executor's choices on means the document left open (2026-11-12, M1), numbered after the decisions settled at authoring.
  16. The tests-first commit carries `src/shared/keymap/build-f.ts` and `src/shared/keymap/sample-rows.ts`, both data, so the red run fails on assertions rather than on a missing module; the code those tests test (`idsOf`, `isRebindable`, `heldChords`, the table's rows and every consumer) lands after. Rationale: "fails before" should name what is missing.
  17. `BUILD_F_ACTION_IDS` is an `as const` literal tuple that `satisfies readonly [ActionId, ...ActionId[]]`, not a value annotated with that type, so `z.enum` over it narrows the stored keymap's type to F's ids, as Constraints ask; `KeymapOverrides` stays keyed by every id. At this landing the two key sets are equal, so no reader or writer changes.
  18. The version 2 file's schema takes `SettingsSchema.shape.keymap` itself, so the stored keys have one definition without a new export.
  19. How the tests reach the extended table: `dispatchKey`, `keymapBinds`, `paletteEntries`, `captureChord` and `conflictOf` take the table as an optional last argument (defaulting to `ACTIONS`), as `menuTemplate` and `keymapGroups` do; the sheet's and Settings ▸ Keyboard's tests mock `keymapGroups` to hand it the extended table, so neither component changes. Rationale: one pattern for the pure functions; no prop added to U11's component.
  20. `heldChords(id, chord)` in `actions.ts` is the one expansion of Select tab's nine chords for `effectiveChord`, the capture and `keymapBinds`; `menu.ts` keeps its own (it numbers and labels the nine items) and `terminal/keys.ts` is unchanged, as the document expects.
  21. A row whose override is not read reports `overridden: false` in `keymapGroups`, so nothing on screen suggests a binding that does not apply.
  22. `artifacts.open` joins the `tab.` group by its id, not by the prefix `artifacts.`, so a later `artifacts.*` row groups by its own prefix (Interfaces C: aliases for today's rows only). Separators inside a submenu follow the same rule as in a menu.
  23. The handlers' tests press both `d` and `D` (and `f`, `F`) with Shift, since macOS reports the unshifted key with ⌘ held and other layouts may not; and they check the key reaches `document` unstopped, besides not prevented.
  Date/Author: 2026-11-12, the executor.

## Outcomes & Retrospective

Pending — written at finish.
