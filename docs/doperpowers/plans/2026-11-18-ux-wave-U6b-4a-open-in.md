# UX wave · U6, landing U6b-4a: "Open in"

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, *the child's file*), its item "l5-code-10 · l9-browser-delivery-08 · 'Open in'" and acceptance A4. **The cut:** `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section U6b-4, decisions 8, 9 and 10; its line "Two parts that can be cut off again" names "Open in" as the part of U6b-4 that may land alone, and this landing is that part (**U6b-4a**). The rest of U6b-4 (the link forms, the notices, localhost) is not here.
>
> **Parent pin:** master `8a7f308ff`, the commit every statement about the code below was checked against. **Branch:** `ux-wave/U6b-4a`. **Not in this landing:** a remembered editor, a chord, JetBrains IDEs, another machine's folder in a local editor (the child's "Not included").

## Purpose

Nothing in MAWS hands a file or a folder to an editor today. After this landing one menu, "Open in", stands in three places: in a file's bar (the file, at the line the cursor or the view is on), in the session's menu in the title bar and in the menu of its sidebar row (the session's working folder, UC-4). Its rows are the editors installed on this Mac among VS Code, VS Code Insiders, Cursor, Windsurf, Zed and Xcode, then Terminal (with iTerm and Ghostty when installed), then Finder, which reveals. Main starts the app; the window never names the path main hands it: the path is the daemon's answer, after the same admission any read of the session's folder passes.

How to see it working: open a session in a git checkout, open the title bar's "More surfaces" menu, then Session actions, then "Open in": the installed editors, Terminal and Finder. Choose VS Code: it opens the checkout. Open a file beside the chat, put the cursor on line 40, choose "Open in" in the file's bar, then Zed: Zed opens the file at line 40. For a session on another machine the item reads "Open in (the folder is on <machine>)" and is disabled.

## Progress

- [x] (2026-11-18) Document written against master `8a7f308ff`; the external facts verified and cited (Decision 2).
- [x] (2026-11-18) M1 built: the daemon's read, main's finder and launcher, the three menus, the unit tests, the scenes written. The menus' pinned lists in `app/Shell.test.tsx`, `sidebar/Sidebar.test.tsx` and `sidebar/reach.test.tsx` gain the item (Decision Log 5).
- [x] (2026-11-18) Proof on the build VM: `pnpm typecheck` 0, eslint on the changed files 0, vitest over the touched directories green but for `src/shared/machine/git-reads.test.ts`'s two cases (the VM's git, ticket 756). The script tests and the whole suite: see Outcomes.
- [x] (2026-11-18) Class 1a (`--label u6b4a`, run 44439568341): static, probes, cross-build and unit 1 to 3 green; unit 4/4 failed one case of `src/shared/host/detached-transport.test.ts` (see Outcomes). Desk-web e2e on Linux (`--label u6b4a-dw`, run 44439559594): green.
- [ ] Not by the builder: the scenes on a Mac (§E), the review, the owner's look.

## Acceptance

1. **The rows.** On a Mac with VS Code and Zed installed and nothing else of the list, every "Open in" menu lists, in order: VS Code, Zed, Terminal, Finder. An app that is not installed has no row. Terminal and Finder are always there.
2. **A folder.** From the title bar's session menu or the sidebar row's menu, choosing an editor opens the session's working folder in it; Terminal, iTerm or Ghostty opens a new window or tab in that folder; Finder shows the folder selected in its parent.
3. **A file.** From the file's bar, choosing an editor opens the file at the line the cursor is on, or, when the cursor is scrolled out of view, at the first line shown. A view with no lines (a rendered Markdown file, an image) opens the file with no line. A terminal opens in the file's folder (never the file: a terminal runs a script it is handed). Finder selects the file.
4. **The admission.** A folder or file the daemon does not admit for the session opens nothing and says why, in a notice: the working folder that has not passed U8c-2's admission, a file outside the folders that MAWS would not save for the session.
5. **An older daemon.** With this Mac's daemon on build F (which has no `files.admit`), choosing a row opens nothing and the notice says the background service is older.
6. **Another machine.** For a session on another machine the item is drawn disabled in all three places, reading "Open in (the folder is on <machine>)". Main refuses `layout.openIn` for such a session whatever the window sends.
7. **Nothing stored.** No layout key, setting or file is written; nothing is remembered between two opens.

## What the code holds today (at `8a7f308ff`)

1. `src/main/gateway/claude-usage-app.ts` finds an app by bundle id (`mdfind kMDItemCFBundleIdentifier == '<id>'`, cached for 60 s) and starts it with `open -b`; under the e2e harness `open` answers as if it had run (`src/main/app.ts`).
2. `src/services/files/allowlist.ts` `admittedFolder(record, 'path')` is UC-4's admission of the working folder (U8c-2), in the daemon. The files service's `precheck` (`src/services/files/service.ts`) is the admission of a path, with the outside rule of U6e, whose save purpose (`OUTSIDE_SAVE`) admits a file outside the folders only when the person chose it, the agent sent it or the transcript names it by a counted form.
3. `files.grant` (U6e) is the model of a daemon read only main sends: `mainOnlyCommands` in `src/shared/ipc/names/files.ts`, graded `internal`, so no link carries it (`onLink`, `src/main/machines/link-surface.ts`) and it needs no row in `REMOTE_UNAVAILABLE`; main calls it with `invokeOwn(..., { client: mainClient, target: local })`.
4. `layout.openFile` (U6e, `src/main/files/open-file.ts`) is the model of main's own command that ends in a daemon read: `layout.*` is graded `client`, so the router answers `host_unavailable` for a session of another machine before the handler runs (`src/main/ipc/router.ts`), and `guardCommand([...], appPageOnly(appUrl))` refuses any asker that is not a page of an app window.
5. The title bar's session menu is a submenu "Session actions" inside the surface row's overflow (`SessionMenuOverflow`, `src/renderer/src/app/Toolbar.tsx`); the sidebar's session menu is `SessionItems` (`src/renderer/src/sidebar/menus.tsx`), drawn as a context menu or a dropdown. A file's bar is `FileViewer` (`src/renderer/src/tools/code/viewer/FileViewer.tsx`), whose `controls` slot holds the editor's controls. The code view knows its cursor line (`registerCursorComment` in `CodeView.tsx` reads it for "Comment on this line").
6. `MAWS_E2E_OPEN_LOG` is the e2e's seam for every open main or the daemon hands the OS: one line per act, nothing opened.

## Decisions settled at authoring

1. **The daemon read** (the cut's decision 8). `files.admit { appSessionId, path? }`, owner `machine`, main-only, graded `internal`, answering `{ path, kind: 'file' | 'folder' }`. Without `path` it admits the session's working folder: `admittedFolder(record, 'path')`, then the folder's real path, which must be a directory. With `path` it runs the files service's `precheck` with the save purpose (`OUTSIDE_SAVE`), then takes a regular file or a directory, and refuses one of MAWS's own folders (`own`) as a save does. Why the save purpose: an editor writes, so a file is handed to one exactly when MAWS itself would save it; a file only a tool's result names, or only a record of the Library admits, is read-only in MAWS and stays so. A caller from another machine is refused (`remote`), as `files.grant` is. The wire minor moves by one (52). A daemon of build F answers `unknown_command`, which main turns into the notice and no launch.
2. **The apps and how each takes a target** (the cut's decision 9). Verified on 2026-11-18 against the sources named; where an app is installed on the authoring Mac its Info.plist was read too (`CFBundleIdentifier`, `CFBundleURLTypes`), and no app was launched.

   | Row | Bundle id | Verified | A file at a line | A folder |
   |---|---|---|---|---|
   | VS Code | `com.microsoft.VSCode` | Info.plist (installed; scheme `vscode`); GitHub Desktop's editor list (`desktop/desktop`, `app/src/lib/editors/darwin.ts`) | `open -b <id> vscode://file<path>:<line>`: "Open a file to line and column: `vscode://file/{full path to file}:line:column`" (code.visualstudio.com/docs/configure/command-line, "Opening VS Code with URLs") | `open -b <id> <folder>` |
   | VS Code Insiders | `com.microsoft.VSCodeInsiders` | GitHub Desktop's editor list; scheme `vscode-insiders` in Claude Desktop's table (`main-process/index.chunk-BjORVu2_.js:6459-6462`) | the same, scheme `vscode-insiders` | the same |
   | Cursor | `com.todesktop.230313mzl4w4u92` | Info.plist (installed; scheme `cursor`); GitHub Desktop | the same, scheme `cursor` (a fork of VS Code; Claude Desktop builds `${scheme}file/<path>:<line>` for it, `index.chunk-BjORVu2_.js:6715-6738`) | the same |
   | Windsurf | `com.exafunction.windsurf` | GitHub Desktop; scheme `windsurf` in Claude Desktop's table (`:6474`) | the same, scheme `windsurf` | the same |
   | Zed | `dev.zed.Zed` | `zed-industries/zed`, `crates/zed/Cargo.toml` (`[package.metadata.bundle-stable] identifier`); GitHub Desktop | `open -b <id> zed://file<path>:<line>`: Zed strips `zed://file`, decodes the rest and parses a `:row` suffix (`crates/zed/src/zed/open_listener.rs`, `strip_prefix("zed://file")`, `derive_paths_with_position`) | the same as VS Code |
   | Xcode | `com.apple.dt.Xcode` | Info.plist (installed); GitHub Desktop | `/usr/bin/xed --line <line> <path>` (`man xed`: "-l, --line <number> Selects the given line in the last file opened") | `open -b <id> <folder>` |
   | Terminal | `com.apple.Terminal` | Info.plist (installed) | its folder | `open -b <id> <folder>` (GitHub Desktop's shell launcher, `app/src/lib/shells/darwin.ts`, `launch`: `open -b <bundleID> <path>` for Terminal, iTerm2 and Ghostty) |
   | iTerm | `com.googlecode.iterm2` | GitHub Desktop's shell list | its folder | the same |
   | Ghostty | `com.mitchellh.ghostty` | `ghostty-org/ghostty`, `macos/Ghostty.xcodeproj/project.pbxproj` (`PRODUCT_BUNDLE_IDENTIFIER`); GitHub Desktop | its folder | the same; its `Ghostty-Info.plist` declares folders (`public.directory`) as a document type, and `open -a Ghostty <folder>` opens a tab there (ghostty-org/ghostty discussion 5910) |
   | Finder | none (always) | — | `open -R <path>` | `open -R <folder>` |

   Three rules follow. A terminal is never handed a file: Terminal, iTerm and Ghostty each declare shell scripts among their documents (Ghostty's Info.plist: `sh`, `zsh`, `command`, `tool`), so opening a file in one runs it; a file's terminal row opens the file's folder. A file URL is built only for a path it carries without ambiguity: each segment percent-encoded, and a path holding `:` (the line's separator) or a control character opened with no line (`open -b <id> <path>`). An editor's launch goes through `open -b <id>`, so the URL reaches the app that was found, never whichever app the scheme's handler is.
3. **Finding the apps.** One `mdfind` per bundle id, run together, the answer cached for 60 s as `claude-usage-app.ts` does; Terminal and Finder are not looked for (system apps). Spotlight unavailable: no editor rows. The list is asked by the window when a menu opens (`layout.openInApps`), and main checks the chosen app again before it launches.
4. **Where the item sits** (the cut's decision 10). Title bar: a submenu "Open in" inside "Session actions" (whose top-level items `e2e/panel.spec.ts` pins), after the session's actions and before Share, for a session with a record and for another machine's terminal session. Sidebar row: the same submenu at the same place. File's bar: a small "Open in" menu button at the head of the bar's controls. A terminal-held session (D-12: its menus offer only the opens) gains it too, since the child's file gives a terminal session on this Mac the same behaviour; the title bar's Session actions is then enabled for it. For a session on another machine each is drawn disabled and its label carries the reason, since these menus draw a reason only as a tooltip today. "Another machine" is the session address's machine not being this Mac's.
5. **The line** (A3). A registry in the viewer (`tools/code/viewer/shown-line.ts`, U6's) that the code view fills as `registerCursorComment` is filled: the cursor's line when it is inside the shown part of the view, else the first line shown; no code view mounted, no line.
6. **The seam.** Under `MAWS_E2E=1` the found list is `MAWS_E2E_OPEN_IN_APPS` (bundle ids are not consulted; a comma list of the rows' ids, Terminal and Finder always added), and a launch appends `open-in <app> <path>[:<line>]` to `MAWS_E2E_OPEN_LOG` and starts nothing; with no log nothing starts either.
7. **Not in `REMOTE_UNAVAILABLE`.** The cut's decision 8 names an insertion in U9's `src/shared/ipc/remote-unavailable.ts`. The code makes it unneeded: `files.admit` is main-only and `internal`, so no link carries it and offer-coverage does not count it (`onLink`), as for `files.grant`; and the disabled item names the machine, which that table's sentences do not. No insertion in U9's file.

## Constraints

1. **UC-4.** The folder is read through the selector (`workingFolder`, by `admittedFolder`), and only the daemon's answer reaches `open`. The window sends an app id, a session and, from a file's bar, the path it shows; main never launches with that path.
2. **UC-7.** Three routes: a session MAWS runs and a terminal session on this Mac behave the same (the daemon has no branch on who holds the session); a session on another machine has the item disabled with its sentence, its single file keeping "Open externally". No offer and no capability.
3. **UC-8.** U6's own: `tools/code/viewer/` and the new `src/renderer/src/open-in/`, `src/main/open-in/`. Named insertions: the "Open in" submenu in U7's two menus (`app/Toolbar.tsx`, `sidebar/menus.tsx`; the child's file's UC-8 line names this insertion); `files.admit` in `src/services/files/` (the cut's X8 names "the admit read"); the shared IPC tables (`schema/files.ts`, `schema/layout.ts`, `names/`, `grades/files.ts`, `routes.json`, `wire.ts` and its manifest, `address-paths.json`), main's composition (`src/main/app.ts`). A need beyond these stops the build.
4. **UC-14.** Nothing stored; no schema of the settings files touched.
5. **UC-11.** Fixtures use invented paths under a temporary folder.

## Plan of Work

### M1 — "Open in", whole

1. Red first: `src/main/open-in/apps.test.ts` (the table's order; the found list's order whatever `mdfind` answers first; the launch argv for each kind of row and target; the URL's encoding and its fallback with `:`; a terminal handed a file's folder), `src/main/open-in/open-in.test.ts` (not installed, not admitted, an older daemon's `unknown_command`, a launch that fails, the seam's line), `src/services/files/service.test.ts` and `register.test.ts` cases for `files.admit` (the working folder admitted and not, a file inside, outside and admitted by a grant, outside and only a result's, a remote caller, a page's call refused as main-only), the schema and wire tables, the line rule, the renderer's menu model (rows in order, the disabled label).
2. The shared tables and the wire minor; the daemon's `files.admit`; main's `open-in` and its registration with the guard; the renderer's store, menus and the line registry.
3. The scenes (§E), written, not run.

## Interfaces

**§A. The commands.**

- `files.admit` — input `{ appSessionId, path?: string }`; output `{ path: string, kind: 'file' | 'folder' }`; refusals are thrown as the files service throws them (`path outside the session's directories`, `unknown app session: …`).
- `layout.openInApps` — input `{}`; output `{ apps: { id: OpenInAppId, name: string }[] }`, in the table's order.
- `layout.openIn` — input `{ appSessionId, app: OpenInAppId, path?: string, line?: number }`; output `{ opened: true } | { opened: false, message: string }`. Guarded `appPageOnly`. `OpenInAppId` is `'vscode' | 'vscodeInsiders' | 'cursor' | 'windsurf' | 'zed' | 'xcode' | 'terminal' | 'iterm' | 'ghostty' | 'finder'`.

**§B. Main** (`src/main/open-in/`): `apps.ts`, the table, `findApps`, `launchArgs(app, target)`; `open-in.ts`, `createOpenIn({ run, admit, env })` with `apps()` and `open(input)`.

**§C. The window** (`src/renderer/src/open-in/`): `copy.ts`; `apps.ts`, the asked list; `OpenInMenu.tsx`, the submenu for a dropdown or a context menu and the file bar's button; `open.ts`, the call and its notice.

**§D. The line** (`tools/code/viewer/shown-line.ts`): `registerShownLine(tabId, read)`, `shownLine(tabId)`, and the pure rule `lineToOpen`.

**§E. The scenes** (written in this landing, run on a Mac by the architect): `e2e:panel` (`e2e/panel.spec.ts`, "Open in, in the title bar and in a session row’s menu, hands the working folder to the app chosen": Session actions ▸ Open in lists the seam's apps in order, VS Code writes the working folder's real path to the open log, then the row's menu ▸ Open in ▸ Finder); `e2e:code` (`e2e/code-tools.spec.ts`, "Open in, in a file’s bar, …": Zed at the cursor's line 5, then Terminal with the file's folder); `e2e:remote` (`e2e/remote.spec.ts`, the listed row's menu step of U7a: "Open in (the folder is on B)" is in the menu, disabled, and the acts' assertion leaves it out).

## Proof

On the build VM: `pnpm typecheck`; eslint on the changed files; vitest on `src/main/open-in`, `src/services/files`, `src/shared/ipc`, `src/shared/machine`, `src/renderer/src/open-in`, `src/renderer/src/tools/code/viewer`, `src/renderer/src/sidebar`, `src/renderer/src/app`, `src/main/daemon-root.test.ts`, `test/cross-build`, `test/lane-b`, `test/support/tokens-guard.test.ts`; the script tests (`node --test .github/scripts/*.test.mjs scripts/*.test.mjs`); then `pnpm test` once. Class 1a and desk-web e2e on Linux, in the background. Not by the builder: the scenes of §E on a Mac; a hands-on pass that each installed editor opens at the line.

## Surprises & Discoveries

- The child's file says Claude Desktop "lists no Xcode" (citing `web/app/v1/c856385e2-DPBwiU-E.js:717`). Its main process at the cited build has Xcode in its table (`main-process/index.chunk-BjORVu2_.js:6477-6481`, `protocol: "xcode://"`, `platform: "darwin"`) and opens a folder's `.xcworkspace`, `.xcodeproj` or `Package.swift` with it (`findXcodeProjectFile`, `:6579`). Nothing here changes: MAWS lists Xcode either way. Reported for the spec's next batch.

## Decision Log

1. 2026-11-18 (UTC) · The admission of a file is the save purpose (Decision 1), not the read's: an editor writes. Lost: a file only a tool's result names cannot be opened in an editor; "Open externally" still opens a document of it.
2. 2026-11-18 (UTC) · Xcode takes a line through `xed`, which opens the Xcode `xcode-select` names; with several Xcodes installed that may be another than the one found. Accepted: the row is shown when an Xcode is installed, and `xed` is the documented way to give Xcode a line.
3. 2026-11-18 (UTC) · A folder is handed to Xcode as a folder, not searched for a project file as Claude Desktop does: the child's file asks for the working folder, and a search reads the folder in main, which this landing avoids.
4. 2026-11-18 (UTC) · No row in `REMOTE_UNAVAILABLE` (Decision 7).
5. 2026-11-18 (UTC) · The tests that pin the session menus' items (`app/Shell.test.tsx`, `sidebar/Sidebar.test.tsx`, `sidebar/reach.test.tsx`, U7's and U9's) gain "Open in" where it now stands, and the title bar's terminal-held case now finds Session actions enabled with "Open in" alone; `e2e/remote.spec.ts`'s listed-row step leaves the disabled item out of the acts it compares and asserts it apart. These follow from the insertion the child's file names; no other line of those files moved.
6. 2026-11-18 (UTC) · The red-first order was kept per file but not per commit: the tests and the code were committed together (`4d34ffbb5`, `af67f629d`), since every run is on the build VM and a red run there buys nothing a reviewer cannot read from the cases.

## Outcomes & Retrospective

At `3ee86d713`: `pnpm typecheck` and eslint on every changed file clean on the build VM; the touched suites green. The gate's script tests on the VM: one case of `gate-copy.test.mjs` failed in the whole set under load and passed alone (no file of `.github/` or `scripts/` is changed). The whole unit suite on the VM ran beside another branch's (load about 16) and failed 117 cases in 31 files; each file that is not on the build brief's VM list was run again alone, 82 files at once with four workers, and all passed but `src/shared/host/detached-transport.test.ts` ("a host killed mid-drain, …"), which then passed four runs of four alone at the head and four of four at the base `8a7f308ff`. The same case is class 1a's one failure. This change touches nothing of the host transport; the case is timing-bound and deserves a row of its own (not this landing's). Not run by the builder: the scenes of §E on a Mac, and a hands-on pass that each installed editor opens at the line.
