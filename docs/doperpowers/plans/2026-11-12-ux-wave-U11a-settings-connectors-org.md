# UX wave · U11a · Settings, connectors and the Org pages (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11**, first landing (**U11a**), parent pin `e0df32e3f` (branch `ux-wave-spec`).
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`: its ten items that have a design section (l8-settings-01, l8-settings-04, l8-settings-03, l8-settings-06, #540, #523, #505, #456, S-09, S-10), acceptance A1 to A15, "Probes and checks" and "Rulings reversed". In the root: Purpose, the wave's laws, UC-1, UC-6, UC-7, UC-8, UC-10, UC-11, UC-12, UC-14 and "Ordering and dependency map". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code says today, the decisions the section left open, and the execution. Twelve points where the code contradicts the section, or where a decision would change what the owner sees beyond the section's words, were reported to the wave's architect and are ruled ("Reported to the architect, and ruled"). The document was revised once on those rulings, on the adversarial review's findings and on what the drawn Settings page showed (Decision Log). Where the child's file at the pin and a ruling differ, the ruling is the later word; the architect writes it into the spec's files. **Branch:** `ux-wave/U11a`, from master `48619c824`; master is merged in before anything is built (Concrete Steps, 1). **Board:** #583 (the wave's epic is #573).

## Purpose

After this landing four smaller surfaces stop getting in the way.

A connector that says "Sign in needed" can be signed in from the chat that uses it, whichever kind it is: one a configuration file names (as today), one a plugin brings, or one added under Settings › Sessions › MCP servers. The dialog that lists a chat's connectors is called Connectors, shows one line per connector, and says once what its switch reaches. A new chat shows its plugins, connectors and skills before the first message.

Settings opens on everyday preferences; its Engine section is split into Sessions, Engine and Supervisor; a row's note is one line, with the rest behind "More"; and "Search settings" finds a row by its words.

On the Org pages every refusal says what to do next or who can act, every sheet dims the window by the same amount, and the project Channel says "Offline · retrying" when it is, lines up under classic scrollbars, cuts names in one order, and opens from the command palette and the View menu.

How to see it working: the unit tests named under each milestone fail before its change and pass after; the e2e scenes each milestone writes are run by the architect on a Mac ("Proof that an executor does not run"); and in a running build the scenes of Acceptance read as written there.

## Progress

- [x] (2026-11-12) Execution document written; the ten sections checked against the code at `48619c824` and against build F (`f1852de3a`); twelve points reported to the wave's architect (`6bf2b00ce`).
- [x] (2026-11-12) The drawn example of the regrouped Settings built and measured by the architect; its findings decided.
- [x] (2026-11-12) Adversarial review of the document: needs-attention, three findings, all accepted.
- [x] (2026-11-12) One revision: the architect's rulings on the twelve points, the review's three findings and its note on rows made at run time, and the decisions on the drawing's findings, folded in (Decision Log).
- [x] (2026-11-12) The owner's look at the drawn page: three answers, each the one the document was written to (Decision Log). M9 and M10 are released, after M8.
- [x] (2026-11-12) Master `6e8c72738` merged into the branch (`eb0290ce8`). U6a is not on master yet (no `BUILD_F_ACTION_IDS`), so M5 waits; U13a's `sessionRow` is not there either; master still holds the `settings` tab kind. Of the files this document names, the merge changed `composer/Composer.tsx` and `ipc/events.ts` (U8a's working folder, `useWorkingFolder`): M5 and M7 read them again before building.
- [x] (2026-11-12 01:40Z) M1 — the sign-in probe's two questions written (`bf946d2bc`), reviewed clean; handed to the architect for the gate job on the mini.
- [x] (2026-11-12 02:10Z) M1's follow-up at the architect's request: a refused custom callback or reconnect is followed by a sign-in through the engine's own listener, reported as `fallback` (`2aac33196`), reviewed clean. P1 runs at `2aac33196`.
- [x] (2026-11-12) P2 and P3 answered by the architect's probes (branch `ux-wave/probe3-u11` at `7f3f6c692`); the rulings are written into §C's `<place>`, §D's Skills, §H and the Decision Log, and M6 and M7 are built to them.
- [x] (2026-11-12 02:08Z) M2 — Org sheets: refusals that name a next step; the grant sheet's read; the paused live query (`18bf9a01b`, `dd6626fd5`), reviewed clean.
- [x] (2026-11-12 03:55Z) M3 — one scrim, also where dialogs stack; the Channel's gutter and names (`ba1ffbf36`, `1478db973`, `22b9fa856`; the review's two fix waves, `744dec08e`, `66dc8ad00`, `f0845e1d9`, `2350849f1`), reviewed clean.
- [x] (2026-11-12 03:55Z) Master `e71334239` merged (`b622bdc1a`): U6a's keymap is on the branch, so M5 is released.
- [x] (2026-11-12 03:41Z) M4 — the Channel says it is offline, or refused (`d3c3fa456`, `e1d925148`, `0adbfd07c`; the review's fix, a refusal that stands through another tab's open, `3ffc6dd65`, `8a6a631c2`), reviewed clean. P4 waits for a Mac.
- [x] (2026-11-12 04:50Z) M5 — the Channel from the palette and the View menu (`7f1590056` to `139c6038b`; the review's fix, a listed-only lane A session, `f03ac349b`, `205a869ea`), reviewed clean. (`f0994be8c`, a debugging commit of the test, lacks the trailer; it is not amended, the branch is never force-pushed.)
- [x] (2026-11-12) P6, first scenes (the architect's, on the mini): e2e:settings passed at `9412a40e1` (run 43362983335: the Channel's edges, its 420 px names, its footer's words); e2e:widgets 30 of 30 and e2e:composer 26 of 26 at `0be74a6ea` (run 43367397788, after run 43359967651's two fixes). The photographs show the session pane's footer keeping the composer's shadow whole under classic scrollbars and one wash over the window and the Plugins dialog under the Uninstall confirmation. §E's gutter, edges and footer, the stacked scrim and the focus rule are proved on a Mac.
- [x] (2026-11-12 05:25Z) M6 — the Connectors dialog (`627d912aa`, `2f3202ebe`; the review's fix, the switch waits for the head's sentence, `539b2ab30`, `e45d064ec`), reviewed clean.
- [x] (2026-11-12 06:20Z) M7 — Plugins, Connectors and Skills before the first message (`33ee139fa`, `21a97619f`, `289b52763` the wire at minor 37, `8f860a0e4`; the review's fix, a plugin change marks the inventory stale while no reader fetches, `4185f38e2`, `9cbe9cdf7`), reviewed clean.
- [x] (2026-11-12) P1's verdict: both kinds promote as designed (runs 43357272365, 43358963647); M8 is released, after M7 in the order.
- [x] (2026-11-12 07:29Z) M8 — Sign in for a dynamic connector (`aa433b9d6`, `9ffe81c35`, `9a1a2be29` the wire at minor 37, `f82dc582b`, `e6946c799`, `d5179df51`), reviewed clean. P7's first run (43384468214 at `e0813cb92`) failed the scene at the sidebar (the session's row is not drawn while its project is collapsed); the scene expands the project first (`8feaa7a7f`); the rerun is the architect's. The run did show the plugin's server and both own-list servers reading needs-auth in a session MAWS started.
- [x] (2026-11-13 08:17Z) M9 — Settings regrouped, a note on one line (`17042eac0`, `21e5af652`, `c4b948405`, `3a1fc191d`, `85b190c73`), reviewed clean (law 8, UC-14 and A6's table read against the diff).
- [x] (2026-11-13 09:09Z) M10 — Search settings (`ab103d6be`, `94042a370`, `3e5648236`, `fdc9436ed`, `cfd86e288`, `52d1be5d6`), reviewed clean. The architect accepted its two behaviour choices: every Settings row a focus stop outside the Tab order, ⌘F only from the view's own DOM.
- [x] (2026-11-13 09:09Z) P6 and P7 on the Mac (the architect's): e2e:settings green at `85b190c73` (run 43391255930: M9's three-width measure holds at 18.5 px and 22.5 px); e2e:discover green at `e186cb343` (run 43392298473: M8's scene, a plugin's connector and two of MAWS's own list signed in, with no Keychain prompt).
- [x] (2026-11-13 10:20Z) M11 — master `c0e7b2ae8` merged (`1672fa149`, no conflict; none of U4a, U13a, U7 or U9 is on master yet); the wire's files made again with master's manifest restored, no diff (minor 37 over master's 36: the command, `pluginName`, `revision`, one route and one address path, fingerprint `86fd1f8530531e00`, nothing under the event); the record's five amendments (`0baf35b74`). At `0baf35b74`: `pnpm typecheck` clean over the six projects, eslint clean, the app scan 8 of 8, `pnpm test` once: the brief's known files and one real failure, `src/main/machines/remote/boundary.test.ts`, whose text guard read M5's tab opener `openChannel(` as the remote module's call; ruled a rename, `openProjectChannel` (`2f0fe04a8`, with the scene fix of Mac run 43400320662), and at `2f0fe04a8` the guard, `channel`, `palette` and `settings-tab` pass, 855 of 855.
- [x] (2026-11-13 11:40Z) The branch panel's three findings and the task review's three on its fix wave fixed (`237c2c60e`, `2eccce051`, `21764a481`, `db7b971c9`; `37eea6057`, `2f4fd8b42`, `7ff5db5a6`), the delta reviewed clean. Mac run 43405665313 at `2f0fe04a8` (the architect's): e2e:settings 27 of 27, e2e:composer green, e2e:widgets one failure and one flaky press, both scene faults, fixed (`6f073a6af`, `da413c89b`).
- [x] (2026-11-13 11:45Z) Master `9df6b4493` (U13a, one strip) merged (`787fd7178`, no conflict). The merge changed three of this landing's files: `customize/CustomizeView.tsx` (the page's project is the current row, `useCurrentRow`), its test, and `harness/composer/ComposerHarness.tsx` (the one strip's panes); it left the wire alone (master 36, this branch 37). P7's second half, U13a's cross-build "settings, both ways" scene, needs no edit on this build: every section draws in one body under `settings.open`, Appearance is a named region, and the idle textbox keeps its name; the round trip with build `f1852de3a` is the architect's run. The merge broke tsc web in M5's `channel/open-action.ts` (the layout's stored shape where U13a's `activeTab` takes the strip), fixed through `sessionRow` (`47480e042`, `9f2268573`; Decision Log), reviewed clean. At `9f2268573` on the VM: `pnpm typecheck` clean over the six projects; eslint on the 230 files changed since `c0e7b2ae8`, clean; vitest over the renderer's channel, palette, customize, widgets, settings-tab, keymap, stores, main, sessions, harness, composer and ipc folders with `src/shared/ipc`, `src/shared/machine`, `test/layout` and the lane B coverage test, 4758 passed and 2 failed, both `src/shared/machine/git-reads.test.ts` (failing on master, the brief's list); the gate's script tests 556 of 556; the wire's files made again with master's restored, no diff.
- [x] (2026-11-13 12:40Z) The chain (the wave's landings reach master one after another, each branch holding the ones before it). The chain head `ec73a220e` (master with U13a and the moved transcript, U1a, U7a and U12a) merged (`c0892d362`): conflicts in `session/SessionPane.tsx` (U12a's computer-use strip line and M3's scroller class, both kept), `settings-tab/keymap.test.ts` and `KeymapSection.test.tsx` (the rows that take no rebinding: U1a's two and `channel.open`, both kept in the chain head's form) and the wire (the chain head's 38 stands; this landing's additions move to 39, the manifest and fingerprint made again on the VM from the chain head's, so 39 records only this landing's command and two properties). The merged tree failed tsc with TS7056 on `REGISTRY` (the composite projects' declaration of its inferred type grew past what tsc writes); `REGISTRY` is annotated with its values named by `typeof` (`b54cd7aeb`). Then the chain head `7b01976bd` (U7a's `d49aa6911`, U1a's final `7b2d9931d`, master `7b9ef8291`) merged (`74b9bb9c3`): one conflict, `harness/composer/ComposerHarness.tsx`'s connections (M3's `connectTranscript` and U1a's hosts store), both kept; the wire unchanged at 39. Each merge's four VM checks: typecheck of node, web and e2e, eslint on the files both sides changed, vitest over their folders with `src/shared/machine` (only `src/shared/machine/git-reads.test.ts`'s two known cases fail: 2344 of 2346 at `b54cd7aeb`, 1065 of 1067 at `74b9bb9c3`), the gate's script tests 556 of 556 at `b54cd7aeb` and 558 of 558 at `74b9bb9c3` (master's PR 624 added two).
- [x] (2026-11-13 12:40Z) The tracker: this landing's 16 residue rows written (Concrete Steps 6); the rows of 2026-10-21 (no sign-in from MAWS for a server of its own list that needs one; M8) and 2026-11-12 (the Channel tab never said offline; M4, pinned by `channel/ChannelView.test.tsx`'s unreachable cases) closed; the row of 2026-11-08 (a damaged grants record) stays open with a note: this landing built its copy naming the other device, not the repair its exit condition also names.
- [ ] The architect's: the e2e runs, class 1a, the xhigh panel, the pull request.

## The landing's edge

One pull request holds the ten items. They are independent of each other, each is small, and together they are about 112 files and 7,000 changed lines, inside what the wave's panels already hold (U8b: 115 files, 9,000 lines). Splitting by surface was weighed and lost. Only two things can hold part of the landing back, the owner's look (M9, M10) and the mini's probe (M8), and the order of the milestones answers both: what waits on nobody is built first, and the cut below is there if a wait is long. A second pull request would cost its own gate, panel and board ticket for nothing else.

| part of U11 | in this landing | left, and to what |
|---|---|---|
| l8-settings-01, a session MAWS runs on this Mac; Customize's row for MAWS's own list | in full (A1 for this Mac, A2) | — |
| l8-settings-01, a session MAWS runs on another machine | Sign in on a dynamic connector is drawn disabled with one sentence (Interfaces §A, "The route to another machine") | **U11f**, after U9 has landed (the names U11b to U11e are taken by the landings of the owner's answered items): the offer row, the name in the adapter's machine acts and consent commands, the capability with its `REMOTE_NEEDS` entry and RL2 minor, the act's words, the entry removed from `REMOTE_UNAVAILABLE`, and the tests U9's document lists (its Interfaces 2). U9 reviews it. A1's clause "and for a session MAWS runs on another machine" is proved there. |
| l8-settings-04, "After, now" | in full (A3) | "After, once the #476 probe has answered": its own design |
| l8-settings-03, "After, now" | in full (A4) | "After, once #476 is designed" |
| l8-settings-06 | in full (A5, A6, A7), as a tab until U7's dialog lands | U7's Usage section and its dialog |
| #540, #523, #505, #456, S-09, S-10 | in full (A8 to A14) | S-09's fix in main, only if the reproduction shows the open's answer was late (Proof, P4) |
| A15 (keeps) | proved by tests that are not edited where they pin a write (Constraints) | — |
| "Rulings reversed": the five entries | amended in the documents that hold them (M11) | — |
| "Waiting": O-14, X-184, l8-settings-05, l8-settings-07, l8-settings-11, #455, #476, l8-settings-12, #342 | nothing | later landings of U11, the visual renewal |

**A cut the architect may take.** The milestones that wait on nobody come first, and each leaves the tree green. If the mini's probe (P1) or the owner's look (P5) is late, M2 to M7 with the amendments of #505, S-09 and l8-settings-04 are a pull request by themselves, and M8 to M10 follow as a second from the same branch. The results of P2, P3 and P4 travel with the first, which holds the milestones they decide. Nothing in this document changes for that but M11's list.

**Where the owner's four answers of 2026-11-12 find their place.** They are built by a later landing; this landing leaves the place.

- *Customize's outer level becomes My items / Discover.* Settings names no kind of Customize item: its index ends in one link, "Customize ›", and the search has one result for it with the kinds as other words. The link opens Customize where Customize opens by default, so the later landing changes no word in Settings.
- *A switch for fetching connector icons, starting on.* It is an App preference about how items are drawn: a row "Connector icons" at the end of **Appearance**, with what the fetch tells Google behind its More. The row table (Interfaces §G) takes a row whose value is not in a settings file, which this one needs: by UC-14 it is stored under a layout key of its own.
- *"Make this the default" writes the Claude Code user settings.* If that landing adds rows for the default model and mode, they sit under **Engine**, after Config home (ruled, point 12): the line under Sessions' heading says "your Claude Code settings files are not changed", and it stays true only if those rows sit elsewhere. Nothing is built for it here, and the index's footer stays as it is.
- *An administrator reads another machine's connector list without Touch ID.* No row of Settings is involved. The `machine-admin` line this landing writes (#540) names no Touch ID and stays true.

## Words used here

- **Dynamic connector:** an MCP server the engine reports with scope `dynamic`: one a plugin brings (the engine names it `plugin:<plugin>:<server>`) or one of **MAWS's own list** (the HTTP servers under Settings › MCP servers, passed to every session MAWS runs at launch). A **file-scope** connector is one a configuration file names (scope `user`, `project` or `local`).
- **The inventory:** what is configured on disk for a folder, read with no session running (`customization.inventory`, answered by the engine host; this Mac only).
- **An unstarted tab:** a New chat with nothing sent. It has a setup intent (`useSetupIntent(id)` is non-null exactly then) and no session record or engine.
- **The services:** `src/services/`, the part of the machine's daemon (`mawsd`) that runs a sign-in. **The endpoint** (`src/endpoint/`) is the door of that daemon to other machines; its **offer table** (`OFFERS` in `src/endpoint/offers.ts`) lists the acts it accepts over the machine link.
- **The wire:** the commands and events between the app and the machine's daemon and engine host. `src/shared/ipc/wire-manifest.json` records it; a change within a major must be additive and moves `WIRE_MINOR` (`src/shared/ipc/wire.ts`).
- **A note** is the muted sentence under a Settings row's control. **A state line** is a line that reports a condition the person must act on (a supervisor waiting on an older version, a helper not found, a permission off); it is not a note and is never cut.
- **Reach** (S-09): whether the channel's own connection to the hub is being tried or has failed, said while the channel is not live. **A refusal** is the hub ending the channel's socket for good; the channel then waits and retries nothing.
- **A configuration's revision:** an opaque string the engine host makes for one configuration of a server (its name, transport and address), so that two can be told apart without the address being shown (§A).
- **A modal layer:** a sheet or a dialog that takes the window while it is open. Its **backdrop** is the full-window element under it that dims what is behind (the scrim). Layers *stack* when one opens over another.

## What the code says today, beyond the section

Checked at `48619c824`; build F is an ancestor and none of the files named here differs from F in a line that matters, except where said. Only what the section does not say, or says wrongly, is listed; the rest of each "Today" paragraph was read against the code and holds.

**l8-settings-01.**
- A new machine command enters six tables besides its handler: `src/shared/ipc/names/connectors.ts`, `schema/connectors.ts`, `grades/connectors.ts`, the generated `src/shared/ipc/routes.json` and `src/shared/machine/address-paths.json`, and the wire (`WIRE_MINOR` and the two generated wire files). `test/lane-b/offer-coverage.test.ts` fails unless a command addressed by a session is offered, answered by main, or declared in `REMOTE_UNAVAILABLE` (`src/shared/ipc/remote-unavailable.ts`, U9's file).
- A sign-in's progress is the event `connectors.signInChanged`, sent to every client of the machine and, over the machine link, to a member holding `machine-admin` there. Its `name` is `McpServerNameSchema`: at most 128 characters and the engine's rule for a configured name, which a plugin server's colons fail. The manifest shows that field as `{type: string, maxLength: 128}`: the rule is a refinement the manifest cannot render, and the wire's rule makes a changed length bound a major (`classifyWireChange` in `wire.ts`).
- Every reader of an event drops one that does not validate and logs a line, at head and at F alike: `src/shared/host/host-supervisor.ts` ("dropped … invalid"), `src/main/machines/socket-link.ts`, `src/main/lane-b/remote-artifact-feed.ts` ("doesn't read; left out").
- The renderer never holds a configured server's address: `CustomizationServerSchema` carries name, scope, path and transport, and the address stays in main and the engine host because it may carry a token (`src/shared/ipc/schema/customization.ts`). The renderer binds a sign-in's events by the operation id of its receipt, never by name (`customize/connectors/sign-in.ts`).
- `signInSessionOf` (`customize/connectors/present.ts`) answers null for scope `app`, and a ready session's status in the sessions store lists its servers by name and status only.
- The fingerprint a Customize row holds for its configuration is main's own (`configurationFingerprint` in `src/main/catalog/postures.ts`, an HMAC under a key that lives as long as main). It decides which row shows a finished result (`resultFor`) and never reaches the operation, which runs in another process and could not check it.
- The spike that proved the engine's sign-in (`spikes/p4-aggregator/m4-signin-spike.mjs`, run from `e2e/discover-connectors.spec.ts` under `MAWS_SIGNIN_SPIKE=1`) asked its questions of servers added with `claude mcp add --scope user`; none completed a return for a `--mcp-config` server or a plugin's.

**l8-settings-04.**
- The palette's description of `/mcp` is in `composer/mentions/widgets.ts`, but `slashItems` (`composer/mentions/items.ts`) shows the engine's own description for every name the engine's catalogue lists, and it lists `mcp` ("Manage MCP servers", `spikes/protocol-probe/fixtures/reads.jsonl`). Both files are U4's.
- `present` and `McpServerView` (`widgets/McpWidget.tsx`) are also read by Session info (`tools/session-info/model.ts`).
- A `failed` row today shows "On · not connected · <error>" under it with no act taken, and the error again in its detail.
- The engine records the switch under its own `projects` key: the nearest ancestor folder holding a `.git` directory, else the session's folder (seen on the wire for a repository root, a child folder and a folder outside any repository; `src/engine-host/connectors/local-key.ts`). For a linked worktree (a `.git` file) the key was read in the engine's source and never seen.
- The Connectors card of the card column (`panel/summary/Connectors.tsx`, U8's) shows the engine's raw status and is titled "Manage this session's MCP servers".

**l8-settings-03.**
- The sentence "Available once the session starts" is `NOT_YET` in `composer/submit/submit-state.ts` (U4's), read in about ten other places through `availabilityRefusal`; `e2e/composer.spec.ts` pins it on the submit control. It is not changed.
- The Plugins dialog's loaded line also draws it for an unstarted tab, beside "Not observed yet" (`widgets/plugins/LoadedLine.tsx` through `DormantGesture`).
- A new chat set to another machine is not in the setup intent, which holds no machine. It is `useSpawnTarget(appSessionId, projectKey)` in `sessions/remote-spawn.ts`, as `composer/Composer.tsx` computes it; the tab's own id stays this Mac's.
- `locationPath` answers a folder that does not exist yet for a worktree not yet made; `settingsDirectoryOf(location)` (`sessions/useSetupIntent.ts`) answers the repository's root there and is what `engine.models` already reads.
- The plugin reads need a folder: with none chosen Customize passes the engine's config home (`plugins.env`'s `configHome`).
- Customize's skill rows are built with no invocation on purpose ("only a verified invocation earns the slash", `widgets/skills/SkillsLibrary.tsx`): no fixture shows that a skill's name on disk is the name the engine lists. The fixtures do show the form `<plugin>:<skill>` for a plugin's skill.
- The inventory lists a name once per scope that configures it, and does not list a plugin's connectors. Its query has no stale time and Customize holds it inline (`customize/CustomizeView.tsx`).

**l8-settings-06.**
- The stored tab's `section` is a closed list of ten names in `src/shared/ipc/schema/layout.ts`, the same at F. `SettingsSection` is derived from it today.
- Nothing opens Settings at the supervisor's rows. The callers that name a section are `settings.open` with a number (`SETTINGS_SECTIONS` in `gateway/actions.ts`: engine, gateway, keyboard, appearance, notifications; one caller, the engine notice, asks for engine) and two callers in the browser's chrome that ask for `browser`.
- The supervisor's rows are a `role="group"` named by an `h4`, "Background supervisor", which also takes the keyboard when a pressed control leaves (`SupervisorSettings.tsx`); `e2e/supervisor.spec.ts` finds the rows by that group's name.
- The body is at most 760 px wide and a row's note sits in its second column, 580 px wide at that width, in 12 px type. The default window with no side surface gives the body its 760 px. Measured on the drawn page: a More button and its gap take 48 px and make the note 22 px high where a plain line is 18.
- One container, the whole view, decides at 32rem both that the index becomes a row of links and that every row stacks (`@container/settings` in `SettingsView.tsx`, `SETTING_ROW` in `parts.tsx`). A view about 520 px wide, a 50/50 split with no side surface, is above it: the index stays a column and a note is left about 150 px beside its label.
- The index has no scroll of its own; its grid row grows with it. Today's index needs 523 px.
- `BrowserImport.tsx` draws a `Setting` per imported Chrome profile and one per extension of each: rows that exist only at run time.
- Direct login's note carries, beside its sentence, the instruction to run `claude /login` and a Copy button (`GatewaySection.tsx`).
- The Voice shortcut is unbound by default, and a test pins that the row then points at the microphone.
- `delivery/copy.ts` (U12's) is the one piece of copy outside Settings that names a moved row.
- The cross-build scene of both settings files (U13a's M5) changes the theme and the supervisor's idle time through this build's Settings.

**#540.**
- The table has fifteen keys, `grantsDamaged` among them; all exist and are plain strings.
- Main's details repeat the sheet's line for more reasons than the four the item names: in the grant sheet `busy`, `invalid` and `no-change` whole, and `refused`, `stale` and `storage` in their last clause; in the enroll sheet `machine-name-taken` and `certified-machine` whole, and `hub`, `cancelled` and `no-machine` in part.
- `storage` is refused on two paths: before anything is sent ("…: nothing was sent"), and after the machine answered when the outcome could not be recorded (`unrecorded` in `src/main/org/grants.ts`).
- Two of `ledger-unread`'s three details name the machine by its ref, not its name.
- The offer table gives a member holding `machine-admin` nine acts: the machine's connectors (list, connect, reconnect, disconnect, the two sign-ins and cancel) and the connector tools a dashboard may use. Settings, plugins, marketplaces and restarts are graded `machine-admin` (`src/shared/ipc/grades/`) and are not offered.
- `enrollProblems` lines are also drawn on the machine rows (`MachineRow.tsx`, `MachinesGroup.tsx`), which offer Show…, not Start over.
- The grant sheet's read: `reload()` keeps the held view, so during a retry the earlier line and Retry stay; only the last read's answer lands.

**#523.**
- Ten overlays dim a window today. The item's seven: `Sheet`, `sidebar/AddProject.tsx` (already `bg-bg-active`), and the five. Three of the five (`WidgetDialog.tsx`, `InlineEdit.tsx`, `resume/host.tsx`) put `opacity-60` on the element, so the class cannot be swapped alone. Not named: the document editor's delete-tab confirm (`.doc-confirm-overlay` in `src/artifacts/document/editor/chrome.css`, U10's, plain CSS), and two dismiss backdrops that are not dialogs (`app/Shell.tsx`, `panel/PanelRegion.tsx`). The command palette is a modal with no overlay.
- `keymap/KeyboardShortcuts.tsx` is U6's by UC-8 and the child's list of insertions does not name it.
- Layers stack today: the Plugins dialog keeps its backdrop while a confirmation opens over it as a `Sheet` with a backdrop of its own (`composer/WidgetDialog.tsx`, `widgets/plugins/ConfirmSheet.tsx`; `e2e/widgets.spec.ts` drives that pair).
- `REFUSALS['not-supported']` is also the words of main's refusal of a save, so the new sentence shows there too.

**#456.** `LiveQuery.tsx` and `live.ts` are under `src/artifacts/`, which the root's UC-8 gives to U10 (the child's file says no child owns the folder). Hiding Allow needs to tell the not-offered pause from `failed` and `watchLimit`, where Allow stays, so `live.ts` exports two names, not one.

**#505.**
- `scrollbar-gutter` acts only on a scroll container, and neither footer is one.
- The transcript's scroller is one component for every transcript (a session's, an agent's, a drill-in), most with no composer under them. It is a query container, so a reserved gutter narrows its wide blocks by a scrollbar's width under classic scrollbars.
- The to-human header does not use `Party` and keeps its chip from shrinking.
- `e2e/channel.spec.ts` launches with classic scrollbars and has one test, with no comparison of edges and no narrow column.

**S-09.**
- The channel's answer and its change event go from main to this app's own windows and nowhere else (`org.*` is graded `client`); both ends are one build, and neither is in the wire manifest.
- The open awaits the cache and nothing of the hub; the unit case that pins it resolves the attestations at once, so it does not pin an answer while they hang.
- `asOf` is null until the channel first catches up and is kept in the cache: "never read on this Mac" is an open channel with no entries and `asOf` null.
- The retry waits 1, 2, 4, 8, 16 then 30 s (±20 %), the handshake and the attestation read time out at 10 s, and nothing listens for the network's return.
- A close that ends the channel's socket for good comes in three codes: the sign-in has ended, the member is no longer admitted, and no such project. For the first two the channel is parked: it opens no socket again until the session next changes (`onClosed` and `reconcile` in `channel.ts`), and the org's own hub status is kept by another component and can still read healthy.

**S-10.**
- An action is enabled in the menu and the palette exactly while a handler is registered for it; the menu has no way to say a sentence beside a greyed item, and the palette has one (`UNAVAILABLE` in `palette/CommandPalette.tsx`).
- U6a's guard makes a row build F does not know not rebindable, so "bound to a chord in Settings › Keyboard" waits until F is retired.
- The rule for "has a channel" is written inline twice in `sidebar/menus.tsx`.
- `waitsOnAnswer` exists in `src/shared/attention/kinds.ts` and the Channel's waiting list already reads it, so U1a's change reaches the count with no edit.

## Reported to the architect, and ruled

Twelve points were reported with the first writing; the architect ruled on 2026-11-12 that every default stands, with the additions in the last column. The one place a later change of a ruling would touch is named as before.

| # | item | the point | what is built | the one place | ruling |
|---|---|---|---|---|---|
| 1 | l8-settings-01 | The section gives the new command's `name` 1 to 256 characters. The event that carries its progress bounds a name at 128, and changing that bound is a major of the wire. | `name` is 1 to 128 characters. The event keeps its bound and loses the configured-name rule, which the manifest does not show; a reader on an older build drops such an event. | §A, the two schemas | stands |
| 2 | l8-settings-01 | "For a press from a Customize row of MAWS's own list the listed server's address must also be the entry's": the press cannot carry the address, and the command as first written could not tell that press from the dialog's. | The press names the entry by an opaque revision of its configuration; the services read the entry, refuse a changed one, and compare its address with the session's. | §A, "The configuration's revision" | stands, and was not enough alone: the review's finding 1 added the revision |
| 3 | l8-settings-01 | Until U9 lands the new command must be declared in `REMOTE_UNAVAILABLE` or the coverage test fails. | One entry in U9's file: "Not on another machine yet: signing in to a connector from a plugin or from MAWS's own list". | §A, "The route to another machine" | stands; the later landing is U11f |
| 4 | l8-settings-04 | The palette's description of `/mcp` takes two insertions in U4's `composer/mentions/`, because the engine's description wins in a started chat. | Both insertions, for the one name `mcp`. | §C, "Names" | stands; §I names U4a's overlaps |
| 5 | l8-settings-04 | "Off here is off for every session in <place>" names the project for a session in a linked worktree; where the engine records the switch there was never seen. | The section's rule, and a wire probe (P2). | §C, "<place>" | stands |
| 6 | l8-settings-03 | "Choosing a skill inserts `/<name> `" rests on a skill's name on disk being the engine's name for it. | `/<name> ` and `/<plugin>:<name> ` after a wire probe (P3); a group it does not confirm is listed without "Use in chat". | §D, "Skills" | stands |
| 7 | #540 | The `machine-admin` line names what the right is graded for; over the link a holder can act on connectors only. | "Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use." | §B, the copy table | stands |
| 8 | #540 | (a) "No line twice" fails for reasons the item does not name. (b) `storage`'s "so nothing was sent" is false after a delivery. (c) Two enroll lines say "Start over" where a row has no such button. | (a) §B's details table for every reason of both sheets. (b) The line without that clause; main's detail stays. (c) As the table gives them; a re-enrollment's `machine-names` is residue. | §B | stands |
| 9 | #523, #456 | (a) The document editor's confirm is in U10's plain CSS. (b) `keymap/KeyboardShortcuts.tsx` is U6's. (c) `src/artifacts/dashboard/editor/` is U10's, and #456 needs two exports. | (a) One declaration in U10's `chrome.css`. (b), (c) Named insertions. | Constraints, "Insertions" | stands |
| 10 | #505 | (a) The element under a scroller must clip, or the property does nothing. (b) A class on the transcript's scroller reaches every transcript. | (a) The footer clips. (b) The rule is scoped from the session pane: two tokens in U1's `SessionPane.tsx`, `Transcript.tsx` untouched. | §E | stands; §I names U4a's edit of the same wrapper |
| 11 | S-10 | (a) The menu cannot say why an item is greyed. (b) The row takes no rebinding while build F stands. (c) The row's place in View is not given. | (a) The menu item is greyed and the palette's row says the sentence. (b) Nothing. (c) After the Tabs rows, before "Split / move to other pane". | §F | stands |
| 12 | l8-settings-06 | (a), (b) There is no deep link to the supervisor's rows, so no new section value can be stored and nothing is held in memory. (c) Binary, Update and Voice › Shortcut have a second state the table's words do not fit. (d) Which lines run over one line. (e) Where a later landing's default model and mode rows go. | (a), (b) The stored list is untouched. (c) §G, "States the table does not give". (d) The drawing's measurements: two lines run over and are cut; `NOTE_LINE_MAX` is gone. (e) Under Engine; nothing built. | §G | (a) to (c) stand; (d) replaced by the measurements; (e) ruled |

## Acceptance

The child's A1 to A15, as this landing proves them. A unit test is named by the behaviour it asserts and runs on the VM. An e2e scene is written and typechecked by the executor and run by the architect on a Mac ("Proof that an executor does not run").

| | what is seen | proved by |
|---|---|---|
| A1 | In a session MAWS runs on this Mac whose plugin brings a connector that needs a sign-in, the Connectors dialog shows the row as "Sign in needed" with Sign in; after consent it reads Connected with its tool count. In a terminal session the dialog lists connected servers only and points at the terminal's `/mcp`. For a session on another machine the same row's Sign in is disabled with §A's sentence. | M8's unit tests; M8's scene in `e2e/discover-connectors.spec.ts`, in a gate job on the mini (P1). The clause for another machine is U11f's. |
| A2 | The same for a server of MAWS's own list; Customize › Connectors › My items offers Sign in on that server's row while a session MAWS runs on this Mac holds it, and "Open a session, then sign in" while none does. | M8's unit tests; the same scene. |
| A3 | With five connectors the dialog shows five one-line rows (switch, name, status in words, tool count); transport, source, scope and tool names only when a row is opened; the switch's reach once, in the head; "Connectors" in the menu entry, the title and Customize. A terminal session's dialog has the title and the status words. | M6's unit tests; the edited scenes of `e2e/widgets.spec.ts` and `e2e/c11-live.spec.ts`. |
| A4 | In New chat with a project chosen and nothing sent, the Plugins dialog lists the installed plugins, "+" › Connectors lists the configured connectors, `/skills` lists the skills on disk and choosing one puts its slash name in the composer. None reads "Available once the session starts" or stays blank. A new chat set to another machine says the lists show once the chat starts there. | M7's unit tests; M7's scene in `e2e/widgets.spec.ts`. |
| A5 | The index shows the two group headings, Org after them and the sections of §G's table; Engine holds three rows; no row is a paragraph with no control. | M9's unit tests; the edited `e2e/settings.spec.ts`; the owner's look (P5). |
| A6 | Where the body has its full 760 px (the default window with no side surface open; U7's dialog), no note of Settings outside the Org page takes more than one line; a row with more ends in "More", which opens the rest in place and closes again. Where the body is narrower than 32rem the rows stack, and no note stands beside its label in a column under 332 px. Every sentence a note had is on the line, behind More, under its section's heading, or listed as dropped. | M9's unit tests (More; the rows' stacking by the body's container); M9's scene in `e2e/settings.spec.ts`, which measures each note at three widths (§G, "The measure"); §G's table of where each note went, read by the milestone's reviewer. |
| A7 | "mcp", "hook", "theme" and "shortcut" each list their rows, each result the row's name with its section under it; choosing one brings the row into view under its section's heading, marks it and gives the row the keyboard; a word that only appears behind the More a row shows now finds the row and opens that More; no match reads "No matching settings"; Esc clears the field. | M10's unit tests; M10's scene in `e2e/settings.spec.ts`. |
| A8 | Each of the fifteen keys reads as §B gives it in the grant sheet, the enroll sheet and the machine row, and no refusal of either sheet says a thing twice. | M2's unit tests. |
| A9 | On a machine every member owns, a grants read that is out reads "Reading <machine>'s grants…", one that failed shows its line and Retry, and "Everyone in the org owns this machine…" shows only once the grants are known. | M2's unit test, which holds the read open. |
| A10 | In the light theme the window behind any sheet or dialog is dimmed by the same amount, also when one opens over another; the Share sheet names the remedy and the machine; hovering the Share or Add owner subtitle shows the whole title and machine name. | M3's unit tests; M3's scene in `e2e/widgets.spec.ts` (the Plugins dialog, then its confirmation); `e2e/share.spec.ts` (its pin holds) and the screenshots it attaches. |
| A11 | With classic scrollbars the Channel's footer and a stream row have the same left and right edges, and so do the session pane's composer and a transcript row. At the default window and in a column about 420 px wide no Channel row overflows, and names give way in §E's order. | M3's scenes in `e2e/channel.spec.ts` and `e2e/composer.spec.ts`; M3's unit tests for the tooltip and the removed cap. |
| A12 | A live query paused because its machine does not offer connectors shows "Connectors on <machine> need its app", offers no Allow and has Refresh disabled. | M2's DOM test. |
| A13 | With the network off a Channel tab shows what this Mac holds; its footer reads "Offline · retrying" with "As of <time>" once the channel's first attempt fails; the composer returns when the channel is live; a Channel the hub has refused says the refusal and never "retrying"; a Channel never read on this Mac says so. | M4's unit tests, which hold each sequence of §F open; the edited `e2e/channel.spec.ts`; the reproduction (P4). |
| A14 | ⌘K, then "channel" or a project's name, lists "<project> · channel" for each project that has one, with "N waiting"; Enter opens the tab. View › Project channel opens the Channel of the focused tab's project. Nothing is added to the sidebar. | M5's unit tests; M5's scene in `e2e/channel.spec.ts`. |
| A15 | The Gateway section, the launch profile's switches and what they write, and the plugin library inside a session behave as before. | No assertion on a `settings.set` payload, a command's input or the plugin library's rows changes in the tests M9 and M7 edit (Constraints, law 8). |

## Constraints that bind every milestone

- **The design binds.** The child's file and the root, at the places the header names. Stop and hand the point back to the architect with the evidence where the code contradicts a statement the work rests on beyond the twelve points above, where the work needs an edit in another child's file beyond the insertions listed here, where a contract or another child would have to change, or where the owner would see something neither the section nor this document says. Everything else is decided in the spirit of the section and recorded in the Decision Log.
- **Laws.** Law 3: no setting is added and one row is removed. Law 5: each connector item behaves as its section says on each route; "not on this route" is the section's, not the executor's. Law 6: nothing depends on an engine behaviour not seen. M8 starts after P1's verdict. M6's head sentence and M7's "Use in chat" are built to P2's and P3's answers (2026-11-12, Decision Log, points 5 and 6); each changed only the one place its row of Proof names. Law 7: today's tokens only; no new token for the scrim or the gutter. Law 8: l8-settings-08, -09 and -10 are `keep`. Moving the launch profile's rows and shortening notes changes no behaviour; in `LaunchProfileSettings.test.tsx`, `McpServersSettings.test.tsx`, the Gateway cases of `SettingsView.test.tsx` and the plugin library's tests, an assertion on what is written or sent is not edited. An executor who finds it must be stops and reports.
- **The child's binds 6 to 11.** No reset for a damaged grants record. Nothing changes in what the Share sheet sends or how it authorises. One sign-in per connector at a time. Customize reads and changes this Mac only, and nothing shows this Mac's configuration as another machine's. The slash name stays `/mcp`. **Every engine sign-in and every Keychain write a test makes runs only in a gate job on the Mac mini runner.** An executor never runs `pnpm e2e:discover`, the spike script, or anything that starts an engine with an OAuth server, on the MacBook, on the VM or anywhere.
- **UC-8, insertions in files other children own.** Each is the smallest that does it. "Named" means the child's file or the root names it; "ruled" means the architect ruled it in on 2026-11-12 (the point's number).

  | owner | file (under `src/renderer/src/` unless it starts with `src/`) | the insertion | milestone | |
  |---|---|---|---|---|
  | U4 | `composer/plus-menu/PlusMenu.tsx` | the two entry labels; the Connectors submenu's rows and its empty line come from one hook of `widgets/`; the Plugins submenu's "unavailable" sentence goes | M6, M7 | named |
  | U4 | `composer/WidgetDialog.tsx`, `composer/InlineEdit.tsx` | the overlay's class from the exported name | M3 | named |
  | U4 | `composer/mentions/widgets.ts`, `composer/mentions/items.ts` | the description of `mcp`, and that one name's declared description winning over the engine's | M6 | ruled, 4 |
  | U3 | `transcript/view/rows/Divider.tsx` | the overlay's class | M3 | named |
  | U3 | `transcript/view/Transcript.tsx` | none: the gutter is scoped from the session pane | — | named, not needed |
  | U1 | `session/SessionPane.tsx` | two tokens: the scope on the transcript's wrapper, the gutter on the composer's wrapper | M3 | named (one line each) |
  | U6 | `src/shared/keymap/actions.ts`, `actions.test.ts` | the row `channel.open`; its id in the test's `LANDED` list, as U6a's document asks of a landed child | M5 | named |
  | U6 | `palette/CommandPalette.tsx` and its test | the channel entries; one entry of `UNAVAILABLE` | M5 | named |
  | U6 | `keymap/KeyboardShortcuts.tsx` | the overlay's class | M3 | ruled, 9 |
  | U7 | `sidebar/AddProject.tsx` | its overlay reads the shared backdrop, so that it yields when a sheet opens over it | M3 | the review's finding 3 |
  | U9 | `src/shared/ipc/remote-unavailable.ts` | one entry | M8 | ruled, 3 |
  | U10 | `src/artifacts/dashboard/editor/LiveQuery.tsx`, `live.ts`, `live-views.dom.test.tsx` | #456: two exports, the sheet's test of a pause, one case | M2 | ruled, 9 |
  | U10 | `src/artifacts/document/editor/chrome.css` | one declaration of `.doc-confirm-overlay` | M3 | ruled, 9 |
  | U12 | `delivery/copy.ts` | "Settings › Engine › MCP servers" becomes "Settings › Sessions › MCP servers" | M9 | named |
  | U13 | `e2e/cross-build.spec.ts` | only if its settings scene finds this build's rows through the Engine region; then the locator by the row's own label, which both builds draw | M9 | this document |

  In files UC-8 gives nobody: `resume/host.tsx` (the overlay's class), `App.tsx` (one mount, M5), `gateway/actions.ts` (one comment, M9), the connectors' names, schema and grades under `src/shared/ipc/`, and the wire's files. In the engine host and in main, which UC-8 gives nobody: `src/engine-host/customization/inventory.ts`, `src/shared/ipc/schema/customization.ts`, `src/main/catalog/postures.ts` and `src/shared/ipc/schema/catalog.ts` (the configuration's revision, M8). Not edited, and left as residue for their owners: the Connectors card (`panel/summary/Connectors.tsx`, U8) and `sidebar/menus.tsx` (U7).
- **UC-14.** Neither settings file changes its schema or its version; no setting moves between the files; every row writes the field it writes today. The stored tab's list of sections is not changed (§G). This landing adds no layout key and stores no revision: the configuration's revision lives in memory, for one run of the engine host. §H says, per thing stored or sent, what build F does with it.
- **UC-7.** At this landing the new command is declared unavailable for a session on another machine: its control is drawn disabled with one sentence, and nothing is sent.
- **The wire.** Additive only: one new command, one optional property on a row of `customization.serverEndpoints`' answer (M8), and one optional property on a skill of `customization.inventory`'s answer, `pluginName` (M7, P3's ruling). One minor for the landing: M7, the first milestone that changes the wire, takes it and makes the generated files again as Concrete Steps 4 says; M8 adds to the same minor and makes them again. Other landings raise the minor too (U3a has taken 37; U1a, U4a, U8b and U12a each take one). So `WIRE_MINOR` takes the next number on the master the branch last merged, with its comment, and the generated files are made again after every later merge of master: at M8 (Concrete Steps 4), at M11, and by whoever merges last before the pull request. The architect tells the session that keeps master of the wire files.
- **Copy.** The words of the child's tables and of Interfaces are exact, apostrophes as each file writes them. A sentence not given by either is not added.
- **UC-11, the repository is public.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages, documents or pull-request text. Fixtures use invented names, paths and text.
- **Where checks run (UC-10).** The worktree on the MacBook carries no `node_modules`; nothing is installed, typechecked, linted, tested, built or launched there. Every check runs on the wave's build VM in a checkout of the pushed head. Class 1a on GitHub Actions, every Electron e2e run and every engine probe are the architect's.
- **Git.** Commit as you go and push `ux-wave/U11a`. Merge master, never rebase or force-push. Never commit to master or to `ux-wave-spec`, and never edit the spec's files. No attribution trailer but the `Sminos-Session:` line the dispatch gives, which ends every commit message.

## Plan of Work

Eleven milestones. Each is one executor's from this document, the child's file and the code, is reviewed at its boundary, and leaves typecheck, lint and the unit suite green. A milestone carries the e2e edits its change forces and the scenes it adds; they are written and typechecked there and run by the architect. The order puts first what waits on nobody: M1 hands the architect a probe to run while M2 to M7 are built; M8 waits for that probe's verdict; M9 and M10 wait for the owner's three answers on the drawn page (P5), and nothing else does. M5 needs U6a on master (Concrete Steps 1).

What consumes what: M7 and M8 consume M6's row and status words; M10 consumes M9's row table; nothing else crosses milestones.

Expected size, lines added plus removed: M1 250, M2 450, M3 600, M4 520, M5 350, M6 650, M7 750, M8 1,050, M9 1,550, M10 750, M11 100. About 7,000 lines over about 112 files.

### M1 — The probe: a dynamic connector's sign-in through MAWS's redirect (prototyping)

**The question.** For a server of the launch's own list (`--mcp-config`) and for a plugin's server: does `mcp_authenticate` with MAWS's redirect answer the `custom` scheme, do `mcp_oauth_callback_url` and then `mcp_reconnect` take the server's name (`plugin:<plugin>:<server>` for the second), does `mcp_status` then read connected, and does a later engine process that loads the same server read it connected?

**What is built.** Two questions, `dynamic` and `plugin`, in `spikes/p4-aggregator/m4-signin-spike.mjs`, each in its own engine process, shaped as the script's `custom` question is. The second loads a scratch plugin whose `.mcp.json` names the OAuth fixture's resource; how a plugin folder is given to the engine is read in the engine's bundle and in MAWS's own launch (`src/engine-host/launch.ts`). The existing case "spike: …" of `e2e/discover-connectors.spec.ts`, which owns the fixture, the scratch config home and the Keychain custody, prints the two answers with the others. No product code.

**How it is run, and by whom.** The architect, in a gate job on the mini (Proof, P1). The executor writes and typechecks; it does not run the script.

**What is observed, and the criteria.** Per question: the scheme answered, each step's answer, the final status, and the next process's status.
- *Promote, as designed:* both kinds complete with the `custom` scheme. M8 is built as §A writes it.
- *Promote, with the engine's own listener:* for a kind the engine answers another scheme, or refuses the callback or the reconnect by that name. M8 gives that kind no redirect (§A, "The redirect"), and the operation's existing path for the engine's own listener carries it.
- *Discard for a kind:* `mcp_authenticate` refuses the name. That kind gets no Sign in in M8, and the architect takes A1 or A2 back to the design.

**Its proof** is the verdict, written as a dated part of `spikes/p4-aggregator/findings-m4.txt` with the engine's version and the run's id, and routed into Surprises & Discoveries with the criteria applied.

### M2 — Org sheets: each refusal names a next step; the grant sheet's read; a paused live query says why

**What exists at its end.** The fifteen lines read as §B gives them. No refusal in the grant or the enroll sheet says a thing twice. The grant sheet with nobody to grant to shows the read's own state. The LiveQuery sheet shows why a query is paused when its machine does not offer connectors, offers no Allow and disables Refresh.

**What it touches.** `settings-tab/copy.ts` (the `ORG` keys of §B), `settings-tab/org/GrantSheet.tsx`, `EnrollSheet.tsx` and their tests, `MachinesGroup.test.tsx`; `src/main/org/grants.ts`, `enroll.ts` and their tests (the cut clauses of §B); U10's `src/artifacts/dashboard/editor/LiveQuery.tsx`, `live.ts`, `live-views.dom.test.tsx`.

**Interfaces.** §B. Exposes nothing.

**Decisions.**
- What follows each line is §B's details table, for every reason main gives to the two sheets' refusal lines (`RefusedLine`, which the re-grant sheet shares, and the enroll sheet's line for a refused start). A reason main gains later shows its detail until the table says otherwise. The approval's refusals in the enroll sheet are worded by `ORG.signReasons`, are not among the fifteen keys and are not changed.
- *The grant sheet with nobody to grant to* (`choices` empty): no read has answered yet, and none failed: "Reading <machine>'s grants…" (`ORG.grantReading`). A read was refused or the first read failed: its line and Retry, the component the other branch already draws. Grants known: `ORG.grantNobody`, or the person picker when an owner still holds a grant. While a retry is out the earlier line and Retry stay, as in the other branch today; a second press starts another read and only the last answer lands.
- *#456.* `live.ts` exports `concrete` and `notOfferedOn`. The sheet's test is: no route, as today, or whatever `concrete` calls concrete. Allow is not offered and Refresh is disabled only for the not-offered pause; `failed` and `watchLimit` keep theirs.
- Main's strings change only by losing a clause the sheet's line says; no reason, code or order of checks changes.

**What it does not touch.** What is signed, sent or refused. `MachineRow.tsx`'s logic. The People rows. A reset or repair of a damaged record. The other pause lines.

**What it proves.** A8, A9, A12. Tests assert: each of the fifteen keys' text; for every reason of each sheet, given the detail as main words it after this milestone, the exact text drawn (§B's details table); main's tests, the details as cut; the `ineligible` list drawn once; the nobody state through this sequence, the read held open: reading, a refused read's line with Retry, Retry pressed and held (the line stays), the answer (the nobody sentence, and in a second case the picker); the not-offered pause's line with no Allow and Refresh disabled, and Allow kept for `failed`.

### M3 — One scrim for every sheet, also where they stack; the Channel's gutter and names

**What exists at its end.** Every sheet and dialog dims the window with one value from one place, and where one opens over another only the top one's backdrop paints, so the window behind is dimmed once. The Share sheet's line names the remedy and the machine, and the Share and Add owner subtitles show the whole title and machine name on hover. Under classic scrollbars the Channel's footer lines up with its rows and the session pane's composer with its transcript. Every Channel row lets names give way in one order and never overflows.

**What it touches.** A new `sessions/scrim.ts` and its test; `sessions/ui.ts`; `sessions/Sheet.tsx`, `sessions/share/ShareSheet.tsx`, `AddOwnerSheet.tsx`, `sessions/share/copy.ts` and their tests; the overlays of the Constraints table, `resume/host.tsx` and U7's `sidebar/AddProject.tsx`; `app/dialog-focus.ts` and its test (the e2e run's fix, 2026-11-12); `harness/composer/ComposerHarness.tsx` (the transcript slot); `styles/app.css`; `channel/ChannelView.tsx`, `parts.tsx`, `Exchange.tsx`, `Entries.tsx`, `ToHumanEntry.tsx` and their tests; U1's `session/SessionPane.tsx`; `e2e/widgets.spec.ts` (the stacked scene), `e2e/channel.spec.ts`, `e2e/composer.spec.ts`. `e2e/share.spec.ts` is not edited: its pin of the scrim's class holds and its sentence follows the copy.

**Interfaces.** §E. Exposes `SCRIM`, `useScrim` and the gutter classes.

**Decisions.**
- *Which backdrop paints where layers stack* is §E's: the top layer's, and every one under it is clear while covered. Two washes of the value would dim the window by about 15% where one sheet dims it by 8%, which is the defect #523 names, moved one layer up. Rejected: the bottom layer alone painting, because the dialog under a sheet would then not read as behind it.
- `Sheet`'s `scrim` prop goes and its overlay keeps `data-sheet-scrim`, which `e2e/share.spec.ts` reads. The three overlays that carry `opacity-60` lose it with the swap, or the dim would be 0.6 of 0.08.
- The command palette keeps no overlay, and the two dismiss backdrops (`app/Shell.tsx`, `panel/PanelRegion.tsx`) are not dialogs. U10's document confirm keeps its plain CSS at the same value and stays out of the stack: nothing opens over it, and a modal layer already blocks the editor it belongs to.
- Focus and dismissal where layers stack are the dialog library's and are not rebuilt: Esc and a press outside close the top layer only, and the keyboard returns to the layer under it. The scene asserts both. If a pair of layers fails either, stop and report it with the pair; do not patch one dialog's own handling.
- The remedy sentence replaces `REFUSALS['not-supported']`, so main's refusal of a save in the same words reads it too. `REFUSALS.unsupported` is another sentence and stays.
- The gutter and the order of names are §E's. The order is by shrink weights far apart, so it is exact in practice and approximate in principle; the e2e scene at 420 px is its proof, since jsdom measures nothing.
- The say row's recipients and owners labels stand after the title and before the chip in the order.

**What it does not touch.** What the Channel shows or folds. The transcript's rows or its scroller's file. A new token. What the Share sheet sends. `sidebar/` beyond the one overlay.

**What it proves.** A10, A11. Unit tests assert: one mounted layer paints `SCRIM`; a second mounted over it paints and the first is clear; the second leaves and the first paints again; three layers, the same; `Sheet`'s overlay takes its class from `useScrim` and no caller passes a scrim; the Share sentence with a machine's name; both subtitles' tooltip "<title> · <machine>"; an alias with no 24-character cap; a party's tooltip holding alias, title and machine; the to-human header's chip able to shrink. The stacked scene, in `e2e/widgets.spec.ts`: the Plugins dialog, then a plugin's "Uninstall…" confirmation over it: exactly one backdrop paints and it is the confirmation's; a point of the window outside both reads the colour it reads under one sheet alone; Esc closes the confirmation, the dialog stays and holds the keyboard; Esc again closes the dialog. The other e2e scenes measure: the footer's and a stream row's left and right edges equal under classic scrollbars; the session pane's composer and a transcript row the same (a scene of `e2e/composer.spec.ts` launched with classic scrollbars); no row overflowing in a 420 px column with a long alias, title and machine; a screenshot of each footer under classic and overlay scrollbars, for the frame's shadow.

### M4 — The Channel says it is offline, or refused

**What exists at its end.** The channel's answer and its changes carry the channel's own reach while it is not live, and the hub's own refusal of the channel while that stands. The footer reads signed out, a sign-in that ended or is not admitted, "Offline · retrying", or "Connecting…", in that order, after "As of <time>". A channel never read on this Mac says so.

**What it touches.** `src/shared/ipc/schema/org.ts` (the two open shapes), `src/main/org/channel/channel.ts` and `channel.test.ts`, `channel/state.ts`, `ChannelView.tsx`, `channel/copy.ts` and their tests, `e2e/channel.spec.ts`.

**Interfaces.** §F, "The channel's reach and refusal": the two fields, the events, the table of transitions and the footer's order, fixed before the code.

**Decisions.**
- Reach is told as a change whenever it moves while the channel is not live, also when nothing else changed. `ChannelsDeps.reach` already names the network-path object in `channel.ts`; the new state takes another name inside.
- *A close that ends the channel is the channel's own word, kept apart from reach.* The hub ends a channel's socket for good when the sign-in has ended or the member is no longer admitted; the channel then waits for the session's next change and retries nothing, and the org's own hub status can still read healthy. So the channel tells that refusal itself, and the footer reads it before reach. Rejected: leaving it to the org status's lines, which would let "Offline · retrying" stand over a channel that is not retrying.
- Sign-out, a new hub and a released channel start again at `connecting` with no refusal, so a stale word never shows after signing back in.
- The composer's return follows the channel's own retry, up to about 36 s after the network is back; no listener for the network is added (the section's "Not included" rules out a Retry; this is the same choice).
- If P4 shows the open's answer itself was late, its cause is fixed in main here, under a dated Decision Log entry that names what the open waited on. Without P4's result the milestone is complete as written, and A13's first clause waits for P4.

**What it does not touch.** The hub notice in the sidebar and `org-session.ts`. The channel's retry timing. The cache file. X-194.

**What it proves.** A13. Main's tests hold these sequences open with a held attestations promise and the fake socket: (a) attestations held: the open answers at once from the cache with `reach: 'connecting'`; (b) attestations fail: a change to `unreachable`; a socket error before the welcome leaves it; welcome then caught-up: live, no reach; (c) live, then a close after the welcome: `connecting`; the next socket fails before its welcome: `unreachable`; (d) a second open during (b) answers `unreachable` and opens no second socket; (e) sign-out and back in: `connecting`; (f) released during the backoff: no socket afterwards; (g) from `connecting`, a close with the sign-in's code: `refused: 'credentials'`, and no socket afterwards; (h) a wake that drops a live socket: `connecting`; (i) the review's case: attestations fail (`unreachable`), then the next attempt closes with the sign-in's code while the org's hub status still reads connected: the change carries `refused: 'credentials'` beside the unchanged reach, no further socket is opened, and a session change then clears the refusal, reads `connecting` and opens one; (j) the same with the code for a member no longer admitted: `refused: 'removed'`. The renderer's tests assert the footer for each combination of org status, refusal and reach, among them refusal with reach `unreachable` and a healthy hub status reading the refusal's line and not "Offline · retrying"; the composer back on live; and the "no copy" sentence for an open channel with no entries and no `asOf`.

### M5 — The Channel opens from the command palette and the View menu

**What exists at its end.** The palette lists "<project> · channel" for each project that has one, with "N waiting"; Enter opens or brings forward its tab. View › Project channel opens the Channel of the focused tab's project and is greyed where that project has none.

**What it touches.** U6's `src/shared/keymap/actions.ts` (one row) and `palette/CommandPalette.tsx` with its test; `channel/project.ts` and its test; a new `channel/open-action.ts` with its test; one mount in `App.tsx`; `e2e/channel.spec.ts`.

**Interfaces.** §F, "The Channel's entries". Consumes U6a's table (§I).

**Decisions.**
- The row's place and the greyed item's words are §F's (ruled, 11).
- "Has a channel" becomes one function in `channel/project.ts` that answers what the sidebar's two menus answer today; a test holds it equal to both on the same fixtures. `sidebar/menus.tsx` is not edited.
- The count on an entry is the length of the Channel's own waiting list for that project (`waitingFor`), so it reads UC-1's predicate and nothing else.
- With a Channel tab in front the action's project is that tab's, so the action stays enabled there.
- The row is not rebindable while build F stands (U6a's guard); this landing does nothing for that.

**What it does not touch.** `src/main/menu.ts`, the dispatcher, the shortcut sheet. The sidebar and the project row. A default chord.

**What it proves.** A14. Tests assert: an entry per project with a channel and none for a project without; matching by the project's name and by "channel"; "N waiting" from the waiting list and no count at zero; Enter opening the tab and, with it open, bringing it forward without a second tab; the action registered while the front's project has a channel and unregistered when the front changes to one without; the palette's sentence for the unregistered action. The e2e scene presses the menu item by its id and opens the Channel from the palette.

### M6 — The Connectors dialog: one line per connector, one name, the switch's reach said once

**What exists at its end.** The dialog a chat opens is titled "Connectors" with "MCP servers" muted beside it. Each connector is one line: the switch, the name, the status in words, the tool count; opening a row shows the rest. Sign in and Reconnect sit on the line of a row that needs a sign-in or failed. The head says once what the switch reaches. The "+" menu's entries read "Connectors in this chat…" and "Plugins in this chat…".

**What it touches.** `widgets/McpWidget.tsx`, `McpDriven.tsx`, `WidgetFrame.tsx`, `widgets/copy.ts` and their tests; a new `widgets/connector-status.ts`; `customize/CustomizeView.tsx` (the live list's call); U4's `PlusMenu.tsx`, `composer/mentions/widgets.ts` and `items.ts`; `e2e/widgets.spec.ts`, `e2e/c11-live.spec.ts`.

**Interfaces.** §C. Exposes `connectorStatusWords` and the row to M7 and M8.

**Decisions.**
- One body. `McpBody`'s default branch goes and the compact row gains the actions; Customize's live list is the same row with no actions. Where no switch is drawn, a disabled connector reads "Off".
- No control sits inside the row's `summary`: the switch stands before the disclosure and the line's actions after it, so a press on either never opens the row.
- Reconnect is on the line for `needs-auth` and `failed`, and in the opened part for every other status.
- The line under a row is the answer of a toggle or a reconnect, and "Read again" when the switch is unconfirmed. A failed row with nothing done shows "Failed" on its line and its error in the opened part, not the idle line it has today.
- Session info reads `present`; its shape does not change.
- A row's switch and Reconnect stay disabled while either of that row's operations is out, as today. The answer lands under its row whether the person opened or closed the row meanwhile, and an answer that never comes leaves the operation's own words there, as today.
- The head's sentence and its `<place>` are §C's, as P2's answer corrected the fallback (2026-11-12): the project's name, else the main root of the repository holding the session's folder, else the folder itself.

**What it does not touch.** `toggleView` and the rule that the switch is read back. The terminal dialog's commands. Customize's own connector rows. The Connectors card. Per-chat switches.

**What it proves.** A3. Tests assert: five servers draw five rows with name, words and count, and no transport, source, scope or tool name until a row is opened; the words for each status of §C and the engine's own word for any other; the head's sentence once and on no row; a press on the switch or on Sign in leaving the row closed; Reconnect on the line of a failed row and inside a connected one; the toggle's and the reconnect's answer under their row; held open: a toggle that is out disables that row's switch and Reconnect, the row is closed, and the answer still lands under it; the terminal dialog's title and words; the live list's "Off"; the two menu labels; the palette's description of `/mcp` in a started and an unstarted chat.

### M7 — Plugins, Connectors and Skills before the first message

**What exists at its end.** In an unstarted tab on this Mac the Plugins dialog manages the plugins of the tab's folder, the Connectors submenu and dialog list the folder's configured connectors, and `/skills` lists the skills on disk. A tab set to another machine says the lists show once the chat starts there.

**What it touches.** A new `widgets/tab-place.ts`; for the plugin skill's manifest name (P3), `src/engine-host/customization/inventory.ts`, `src/shared/ipc/schema/customization.ts`, `wire.ts` and the generated files (Concrete Steps 4) and their tests; `widgets/PluginsWidget.tsx`, `widgets/plugins/LoadedLine.tsx`, `McpWidget.tsx`, `SkillsWidget.tsx`, `widgets/copy.ts` and their tests; a new `customize/inventory.ts` taken out of `CustomizeView.tsx`; U4's `PlusMenu.tsx`; `e2e/widgets.spec.ts`.

**Interfaces.** §D. Consumes M6's row and words.

**Decisions.**
- The three dialogs branch before the frame's own read; `NOT_YET` and `availabilityRefusal` are not changed.
- The folder, the remote target and the three states a dialog can be in are §D's.
- The submenu reads the inventory only for a tab that has a setup intent. A menu drawn with no session id reads nothing, as `CustomizeView.test.tsx` pins.
- The inventory's query moves to one hook with a stale time, so opening the submenu twice reads once; its key is unchanged, so Customize and the dialogs share the answer.
- The Connectors list shows, per name, the entry the engine will use (`shadowedBy` of `customize/connectors/present.ts`), with its scope in Customize's words.
- An inventory read that fails shows its words with Retry in the list's place, as Customize's page does; one that is slow ends at the engine host's own bound (seven seconds) with the host's warning. The plugin reads fail as they fail in Customize.
- When the chat starts while a dialog is open, the dialog draws what a started chat's dialog draws, the frame's "Starting…" first; the two are not mixed. When the tab leaves for another machine, the dialog closes.

**What it does not touch.** `composer/submit/submit-state.ts`. Customize's page. Choosing connectors before the start (#476). Reading another machine's configuration.

**What it proves.** A4. Tests assert, for an unstarted tab: the Plugins dialog reading the folder of §D (a project's, a worktree not yet made, none chosen) and its loaded line reading "Not observed yet" alone; the Connectors dialog's rows with no switch, Reconnect or Sign in under its line; the submenu's rows with scopes; the Skills dialog's three groups, its lead line, no Reload, and the text a choice inserts; none of the three drawing "Available once the session starts"; a remote target drawing only its sentence and reading nothing. Held open: a read out when the folder changes (the old answer is not drawn); a dialog open when the chat starts (rows, then "Starting…", then live rows); a dialog open when the tab leaves for another machine (it closes).

### M8 — Sign in for a plugin's connector and for MAWS's own list

Starts after M1's verdict is recorded.

**What exists at its end.** A dynamic connector that needs a sign-in offers Sign in in the Connectors dialog of a session MAWS runs on this Mac, and a row of MAWS's own list offers it in Customize while a ready session holds that server. A press from Customize signs in the configuration the row showed, or nothing. The steps, Cancel and the ways it ends are today's. For a session on another machine the control is disabled with §A's sentence.

**What it touches.** `src/shared/ipc/names/connectors.ts`, `schema/connectors.ts`, `grades/connectors.ts`, `wire.ts`, the generated files, and the two lists of the machine's commands that tests hold (`test/support/spine-lists.ts`, `src/services/machine-ops.test.ts`); for the configuration's revision, `src/shared/ipc/schema/customization.ts`, `src/engine-host/customization/inventory.ts`, `src/shared/ipc/schema/catalog.ts`, `src/main/catalog/postures.ts` and their tests; U9's `src/shared/ipc/remote-unavailable.ts`; `src/services/connectors/sign-in.ts`, `sign-in-entry.ts` and their tests; `customize/connectors/sign-in.ts`, `present.ts`, `ConnectorsSection.tsx` and their tests; `widgets/McpWidget.tsx` and its test; `e2e/discover-connectors.spec.ts`.

**Interfaces.** §A. Exposes `connectors.signInDynamicServer` and the configuration's revision to U11f and to X-184.

**Decisions.**
- The command, its check, its identity, the configuration's revision and its route to another machine are §A's.
- The check runs inside the operation, in the services, on the status of the session the act then uses; nothing at the door decides it. No remote caller reaches the command at this landing: it has no offer row.
- *A press from Customize is bound to the configuration its row showed.* The renderer's fingerprint only chose which row shows a finished result; it never reached the operation, so a row read before its entry was replaced under the same name could start a sign-in for the replacement. The press now carries the revision of the configuration the row was drawn from, and the operation refuses when the entry it reads has another. One read of the entry serves both comparisons (the revision pressed, and the session's server), so nothing can change between them. Rejected: main checking its own fingerprint before it forwards the press, which checks at the door and not where the act runs; and an unkeyed hash of the address, which would let a known address be confirmed from the renderer.
- A dynamic server is never read from a file later, so the wait the operation gives a just-added server ("Server not found", up to ten seconds) does not apply to it: that answer fails the operation at once in the engine's words.
- An older daemon on this Mac answers `unknown_command`; the row reads it as a sign-in that did not finish, in the transport's words. An older engine host answers no revision, and Customize's row then offers no Sign in; the dialog's does. No capability is added for this Mac's own daemon or host: each state lasts until the process is replaced when idle.
- M1's verdict sets the redirect per kind (§A).

**What it does not touch.** `src/endpoint/`, `src/main/lane-b/`, `apps/org-protocol/` (U11f). `connectors.signIn` and `connectors.signInServer`. The fingerprint `catalog.postures` answers and what a row does with it. Settings › MCP servers' rows. MAWS's own credential store. Plugin connectors in Customize (X-184).

**What it proves.** A1 and A2 on this Mac. Services tests assert: each refusal of `dynamicRefusal` with its words; a dynamic sign-in through every state to connected; one at a time across two sessions; a press whose revision is the entry's passes and authenticates; a press whose revision is not the entry's, the entry and the session both holding the replacement, ends `other_entry` with §A's words and sends no `mcp_authenticate`. Held open: the entry is replaced under the same name while the operation's read of it is out, and the read then answers the replacement: refused, nothing authenticated; a second press from another session while the first waits for its callback (the first ends cancelled, the second goes on); a cancel while the check's read is out (no `mcp_authenticate` is sent); the session leaving while the entry is being read (it ends `session_exited`, nothing sent). The engine host's tests assert: the same transport and address give the same revision within one run, another address or transport another, an entry with no address none, and nothing of the address can be read from it. Renderer tests assert: Sign in on a dynamic row and the command it sends; no Sign in for `claudeai` and managed scopes; the disabled control and its sentence for a session on another machine, with a file-scope row beside it still enabled; Customize's own-list row sending the revision it was drawn with, offering no Sign in while it has none, and choosing the attached session, then any ready one that lists the name, then "Open a session, then sign in"; a dialog's finished result not shown on Customize's row. `wire.test.ts` holds the manifest: one command and one optional property added, the event's entry unchanged. The mini's scene signs in a plugin's connector and one of MAWS's own list from the dialog, and the second from Customize.

### M9 — Settings regrouped, a note on one line

Starts after the owner's three answers (P5) and the architect's word on them.

**What exists at its end.** The index shows two group headings and Org after them; it scrolls by itself, with its footer in place. The body is in the index's order and opens at Appearance; Engine holds Binary, Update and Config home; Sessions and Supervisor hold what §G's table gives them; the Plugins paragraph row is gone. Every row is drawn from one declaration; where the body has its 760 px a note is one line and the rest is behind "More"; where the body is narrow the rows stack.

**What it touches.** `settings-tab/SettingsView.tsx`, `copy.ts`, `parts.tsx`, `EngineSection.tsx`, `SessionsSection.tsx`, a new `SupervisorSection.tsx` and `rows.ts`, `SupervisorSettings.tsx`, `BudgetSettings.tsx`, `LaunchProfileSettings.tsx`, `McpServersSettings.tsx`, `BrowserImport.tsx`, `KeymapSection.tsx` (its rows' stacking), the other sections' files where a note changes, and their tests; `settings-tab/index.ts`; `gateway/actions.ts` (a comment); U12's `delivery/copy.ts`; `e2e/settings.spec.ts`, `e2e/supervisor.spec.ts` and `e2e/cross-build.spec.ts` only if a locator breaks.

**Interfaces.** §G. Exposes `SettingsSection`, the section table and the row table to M10 and U7.

**Decisions.**
- The words are the child's table with §G's additions. A note that fits its line keeps its words; only the two lines the drawing measured over the line are cut. An answer of the owner's is written into §G, at the places §G names, before the milestone starts.
- *Rows stack by the body's own width.* Today one container, the whole view, turns the index into a row of links and stacks every row, at 32rem. A view between 32rem and about 700 px (a 50/50 split with no side surface is about 520 px) then keeps the index as a column and leaves a note about 150 px beside its label. The body becomes a container of its own and its rows stack under 32rem of body; the index keeps its own break on the view. Rejected: moving the index's break up as well, which changes a second thing nobody asked for.
- The supervisor's rows keep their group, named by `aria-label` "Background supervisor", and lose the visible `h4`; the keyboard's fallback moves to the section's heading. So `e2e/supervisor.spec.ts` and the supervisor's tests keep their locator.
- A state line is marked as one and is never cut or put behind More.
- A More that is closed is not in the page; its button carries `aria-expanded` and reads "Less" while open.
- Below the index's break its row of links drops the group headings and keeps the order.
- A row made at run time (an imported Chrome profile, one of its extensions) is drawn from a declared repeating row (§G), so nothing in the body is outside the table.
- Law 8 holds as Constraints say.

**What it does not touch.** Either settings schema, a setting's default, or what a row writes. The Org page's rows. `keymap.ts`. The stored tab's schema.

**What it proves.** A5, A6. Tests assert: the index's two headings, Org after them, and the order; each section's rows in §G's order; Engine's three; no Plugins paragraph; every declared row drawn in its section or revealed by another, and every drawn row declared, with the page populated (imported Chrome profiles with extensions, Spaces with their own design system, a chosen binary, the memory budget on, the supervisor waiting on an older version) and again empty; a More opening in place and closing; a state line whole; Direct login's instruction and its Copy on the row's line; a row's fixed columns giving way under the body's container and the index's under the view's; the stored list of sections equal to build F's ten; `delivery/copy.ts`'s sentence. The e2e scene measures at three widths (§G, "The measure"). A6's last sentence is not a test: the milestone's reviewer reads §G's table of where each old note went against the diff, since a test could only restate that table.

### M10 — Search settings

**What exists at its end.** "Search settings" at the top of the index lists matching rows in place of the sections, each the row's name with its section under it, the first preselected, with Up, Down and Enter. Choosing one brings the row into view under its section's heading, marks it, opens the More it shows when the match was there, and gives the row itself the keyboard. ⌘F inside Settings focuses the field; Esc clears it.

**What it touches.** A new `settings-tab/search.ts` and its test; `SettingsView.tsx`, `parts.tsx`, `rows.ts`, `copy.ts` and their tests; `e2e/settings.spec.ts`.

**Interfaces.** §G, "Search".

**Decisions.**
- Matching is a pure function over the row table, the state each drawn row shows now, the keyboard's rows and the Org page's group headings. A row is found only by words the page will show for it in its present state.
- *The row takes the keyboard, not a control in it.* The first control of several rows acts on Enter (a server's Remove, a chip's ×), so Enter to choose and Enter again would remove something. The row is focused; Tab then enters its controls. Rejected: naming a safe control per row, a list that every new row would have to keep right.
- The query stays in the field after a choice and the field does not keep the keyboard, so the child's clause "another result is one keystroke away" is dropped: both cannot hold.
- ⌘F is taken by the Settings view while it holds the keyboard and by nothing else, so it needs no row in U6's table and keeps working when U3's Find lands.
- The field carries `data-escape-clears`; while Settings is a tab, Esc in an empty field does nothing.
- The field is drawn once the settings are read, with the rows. Choosing a second result while the first is still marked takes the first mark away at once.

**What it does not touch.** `src/shared/keymap/`. A fuzzy match or a ranking. The Org page's rows.

**What it proves.** A7. Tests assert: the four queries of A7 and their results; "mcp" finding the Customize link; every word required and case ignored; a section's name and an Org group as results, and no row found by its group's name; a keyboard binding found by its action's title; a word behind the More a row shows now, and no result for a word that is only in another state's More; a row not drawn found as the row that reveals it; with the page populated, a repeating row found by its declared label and landing on its first item, and on the row that reveals it when it has none; a result's two lines, the name cut and never wrapped; the first result preselected and Enter choosing it; the chosen row focused and no control of it, so that a second Enter does nothing; the query still in the field; "No matching settings"; the keyboard in the list; the mark going after its moment, and at once when another result is chosen; Esc clearing; ⌘F focusing the field and reaching nothing outside Settings. The e2e scene: a row chosen far down a short section lands with its heading in view; the list scrolls with the index; the narrow form's field and results.

### M11 — The record, the whole checks, the hand-back

**What exists at its end.** The five reversed rulings are amended where they stand. Master is merged once more, the wire's minor is the next one on that master and the generated files are made again. The branch has passed typecheck, lint on what changed and the whole unit suite on the VM. The hand-back is written.

**What it touches.** The documents of "The record"; `src/shared/ipc/wire.ts` and the generated files, if the merge moved the minor; this document's Progress, Surprises & Discoveries and Decision Log.

**What it does not touch.** Product code, unless a check shows a defect; then the fix goes to that milestone's owner through the controller. The register, the board, the tracker.

**What it proves.** Parent-level acceptance 4 for U11's five entries; that the tree is green, on the master of that hour, before the architect's gate.

### The record (in the same pull request, UC-10)

Each is a dated addition where the earlier words stand; the earlier words stay. The sentences are the child's, under "Rulings reversed".

- l8-settings-06: `docs/doperpowers/plans/2026-09-28-c11-palette-settings-gateway-usage.md`, under "Settings tab", and the comment that opens `settings-tab/copy.ts`.
- l8-settings-01: the entry "M4's review fixes" in the Decision Log of `docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md`, and the paragraph "Sign in from the session's MCP widget" of `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md`.
- l8-settings-04: the `mcp` row of the widget table in the same C11 document.
- #505: residue 35 to 37 of `docs/doperpowers/plans/2026-10-28-p5-o8-report.md`.
- S-09: M7a's "At its end" in `docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md`.

The tracker rows of 2026-10-21, 2026-11-08 and 2026-11-12 that close with this landing, the register's rows and the board are the architect's at landing. (2026-11-13, at the architect's word: the controller wrote the tracker's rows; 10-21 and 11-12 closed, 11-08 left open for its repair; Progress.)

## Concrete Steps

From the worktree of branch `ux-wave/U11a`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11a --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Then check what the merge brought: `git log --oneline -1 origin/master`, and whether U6a is in it: `git grep -n "BUILD_F_ACTION_IDS" origin/master -- src/shared/keymap/ | head -1`. If that prints nothing, M5 waits and every other milestone goes on. Whether U13a's selector is there decides one import of M5 (§F): `git grep -n "export function sessionRow" origin/master -- src/renderer/src/keymap/actions-runtime.ts`. For each file this document names that the merge changed (`git diff --name-only 48619c824 origin/master`), read it again against "What the code says today" before building on it. If master already holds U7's Settings dialog (no `settings` tab kind in `src/shared/ipc/schema/layout.ts`), stop and report: §G's paragraph on the stored section then does not apply.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11a
       vmcheck 'pnpm exec vitest run <the test files the milestone names>'
       vmcheck 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # the renderer; tsconfig.node.json for main, services and shared code; tsconfig.e2e.json for e2e/
       vmcheck 'pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11a at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit the run fails on the new assertions; at the milestone's head vitest prints `Test Files … passed` with no failure, `tsc` prints nothing and eslint prints nothing.

3. **M1** adds no test. `vmcheck 'node --check spikes/p4-aggregator/m4-signin-spike.mjs'` prints nothing, and the e2e project typechecks. Then stop on M1 and hand the architect P1.

4. **M7 and M8, the wire.** M7 takes the landing's minor for `pluginName`; M8 adds its command and `revision` to the same minor (it moves the number only if a merge of master took it meanwhile). The manifest gate refuses an additive change at the committed minor, so a later milestone of the landing that adds to the same minor regenerates with master's manifest (master's minor) restored in the VM's checkout first, as M8 did. After the schemas, names and grades are edited, take the next `WIRE_MINOR` on the master last merged (merge again first if master has moved: `git fetch origin master && git merge origin/master`), then make the generated files again on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11a-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11a-wire.patch | git apply

   The last `git checkout` leaves the VM's checkout clean for the next call. At M7 expect the property `pluginName` under the skills of `commands.customization.inventory.output`, the minor, and a new value in `wire-fingerprint.json` if the engine host's answer is fingerprinted, and nothing else. At M8 expect the patch to add `commands.connectors.signInDynamicServer`, the property `revision` under `commands.customization.serverEndpoints.output` and the minor to the manifest, one name to each of `routes.json` and `address-paths.json`, a new value in `wire-fingerprint.json` (the engine host's answer gained a property), and nothing under `events.connectors.signInChanged`. A line under the event means the event's bound moved: undo it. Then `vmcheck 'pnpm exec vitest run src/shared/ipc src/shared/machine test/lane-b/offer-coverage.test.ts'` passes.

5. **M11, master again, then the whole checks.** Other landings move the wire's minor while this one is built.

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's two additions the next number after master's, take master's side of the four generated files, and run step 4's regeneration again. Then:

       vmcheck 'pnpm typecheck'
       vmcheck 'pnpm exec eslint src/renderer/src/settings-tab src/renderer/src/customize src/renderer/src/channel src/renderer/src/widgets src/renderer/src/sessions src/renderer/src/palette src/renderer/src/composer src/services/connectors src/main/org src/main/catalog src/engine-host/customization src/shared/ipc src/artifacts/dashboard/editor e2e'
       vmcheck 'pnpm test'
       vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'

   `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists fail on master too and are not this landing's; any other failure is. The scan passes: this landing adds no recorded file, and the scan is run because M1 and M8 touch fixtures' neighbours.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e or engine. The hand-back says: what exists, with the command and result that showed it; the master and the wire minor the branch stands on; what is not verified (every e2e scene, P1 to P5); the decisions made; anything that contradicts the spec; the residue. Residue known at authoring, each a row for the debt tracker at landing:
   - the Connectors card of the card column still shows the engine's raw status and says "MCP servers" (U8's file);
   - a re-enrollment's `machine-names` line names a remedy that does not apply there;
   - a `storage` refusal after the machine answered still opens with "Not signed";
   - `shape`'s second detail in `src/main/org/enroll.ts` ("a re-enrollment names the machine it replaces, <name>") is hidden by §B with the first; no sheet sends that case today;
   - a file-scope server and a dynamic one of the same name and address are two connectors to the one-at-a-time rule though the engine keeps one credential;
   - the Channel's composer returns only at the channel's own next retry, up to about 36 s after the network is back;
   - a Customize page read before the engine host restarted has revisions the new host does not answer, so its Sign in is refused until the page is refreshed;
   - "This project has no channel" is also what the palette says when no project is in front;
   - in a narrow Settings pane "More" often falls alone on a line of its own;
   - `e2e/c11-live.spec.ts` has no gate group, so its edits run only at a live sitting;
   - the gate cannot switch the sign-in spike on (`MAWS_SIGNIN_SPIKE`);
   - the document editor's confirm stays outside the shared backdrop (it never stacks);
   - a sheet opened from a menu item returns focus to the dialog under it, or to `body`, not to the menu's trigger ("More actions"), the better target (`app/dialog-focus.ts`);
   - `customize/inventory.ts`'s `plugins.changed` subscription is registered during render and lives as long as the window (the event source holds it); right for the window's one query client, not for a client that is replaced or disposed;
   - `EnrollSheet.test.tsx`'s re-enroll case (master's) prints an uncaptured "[org] command failed … no answer for org.enroll.approve" from an unanswered fake call;
   - where the main root of a session's repository cannot be read (git answers nothing, or another machine does not offer the reading), the Connectors dialog's head names the session's folder, a narrower place than the engine's switch reaches (P2).

7. **The architect's, after the hand-back.** The e2e runs of "Proof that an executor does not run"; class 1a on the head handed back, in the background (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11a`); the xhigh panel; class 1a again on the final head if the panel changed the branch; the pull request. Whoever merges master into the branch after this point makes the wire's files again as step 5 does.

## Interfaces and Dependencies

Paths under `src/renderer/src/` unless they start with `src/` or `e2e/`. A name here is what later milestones and siblings code against; an executor who must change one stops and reports. Everything not named here is the executor's.

### §A. The sign-in of a dynamic connector (M8; consumed by U11f and X-184)

**The command and the event** (`src/shared/ipc/schema/connectors.ts`; ruled, points 1 and 2):

    'connectors.signInDynamicServer': machine(z.strictObject({
      name: z.string().min(1).max(128),      // as the session's mcp_status reports it
      appSessionId: AppSessionIdSchema,
      entry: z.strictObject({ revision: z.string().min(1).max(64) }).optional(),   // the press came from a row of MAWS's own list: the revision that row was drawn with
      ...Callback,                           // a remote asker's port: no caller sends it until U11f
    }), OperationReceiptSchema),

    // ConnectorSignInChangedSchema: every field as it is, but
    name: z.string().max(128),               // was McpServerNameSchema: the same bound, without the configured-name rule

Graded `machine-admin`, as the two sign-ins beside it. A dynamic connector whose name is longer than 128 characters is offered no Sign in. `connectors.signIn` and `connectors.signInServer` keep `McpServerNameSchema` for their input.

Lost: a second event for a dynamic sign-in. It is additive by the letter of the wire's rule, where loosening a refinement is a change the manifest cannot see; it lost because one operation would then speak on two events, every reader and both feed lists would carry both, and the only reader that refuses the loosened value is an older build that could never have started the operation it belongs to (§H).

**The configuration's revision** (the review's finding 1). An opaque string that stands for one configuration of a server, so that a press can say which configuration its row showed without the renderer ever holding an address.

    // src/shared/ipc/schema/customization.ts: a row of customization.serverEndpoints' answer gains
    revision: z.string().max(64).nullable().optional(),   // null: the entry has no address

    // src/shared/ipc/schema/catalog.ts: a server of catalog.postures' answer gains
    revision: z.string().max(64).nullable(),              // null: the engine host answered none

- *Who makes it.* The engine host, in `src/engine-host/customization/inventory.ts`, for every endpoint it answers: an HMAC-SHA-256 of the entry's name, transport and address, under 32 random bytes the host makes at its start, keeps in memory and never writes or sends; in hex, cut to 32 characters. It is the form main's `configurationFingerprint` has; main's fingerprint and what a row does with it are not changed.
- *How it reaches the row.* Main's `catalog.postures` already reads those endpoints; it hands each one's revision to the renderer beside the posture. Customize's row for an entry of MAWS's own list keeps the revision it was drawn with, sends it with its press, and offers no Sign in while it has none.
- *How it is checked.* The operation reads the endpoints once, in the services, after the session is known ready and before `mcp_authenticate` is sent. That one read gives the entry's revision now and its address, and both comparisons below use it.
- *Its life.* One run of the engine host. Nothing stores it. A page read before the host restarted is refused until it is refreshed, which is the safe direction.

**The connector's identity.** A dynamic connector is its machine and its name:

    // src/services/connectors/sign-in.ts
    export interface ConnectorConfiguration { name: string; scope: 'user' | 'project' | 'local' | 'dynamic'; cwd: string | null }   // dynamic: cwd null
    // connectorKey: 'dynamic' is keyed as 'user' is, with no folder

    // customize/connectors/sign-in.ts
    export type SignInScope = PluginsScope | 'dynamic';
    export type SignInServer = { name: string; scope: SignInScope; cwd: string | null; machine?: MachineRef | null };   // signInKeyOf: 'dynamic' as 'user', no folder
    export function startSignInDynamic(server: { name: string; revision?: string }, fingerprint: string | null, appSessionId: AppSessionId, bridge?: MawsBridge): Promise<void>;

`startSignInDynamic` binds its receipt as `startSignInByName` does. The dialog passes neither a revision nor a fingerprint. Customize passes both: the revision goes to the services, and the fingerprint stays in the renderer and decides, as today, that a finished result shows only on the row of the configuration it was started for; a running one shows on both.

**The check** (`src/services/connectors/sign-in-entry.ts`), run by the operation before `mcp_authenticate` is sent, in the services, on the status of the session the operation then drives:

    /** Why the session cannot sign this dynamic server in, in words, or null. `own`: MAWS's own entries as the engine host answers them now, read only for a press that names an entry. */
    export function dynamicRefusal(requested: { name: string; entry?: { revision: string } }, live: readonly LiveServer[], own: readonly EndpointEntry[]): string | null;

The first row that holds answers; the operation then fails `other_entry` with the words.

| what the operation finds | words |
|---|---|
| the session's `mcp_status` lists no server of the name | `that session has no <name> server` |
| it lists the name with a scope that is not `dynamic` | `this session uses a different <name>; start a new session to sign in` |
| the press names an entry, and MAWS's list has no entry of the name now, or that entry's revision is not the press's, or the host answered no revision | `MAWS’s <name> server changed since this page read it; refresh the page, then sign in` |
| the press names an entry, and the session's server's transport or address is not that entry's (compared as `entryRefusal` compares a file entry's: `streamable-http` is `http`; an address written with `${…}` is not compared) | `this session uses a different <name>; start a new session to sign in` |
| otherwise | null |

So what is authenticated is the session's server; the session's server is the entry; and the entry is the configuration the row showed. The engine is the last check: `mcp_authenticate` looks the name up among the session's loaded servers, so a server that left between the check and the call (a plugin reloaded) ends the operation in the engine's words. A press from the dialog names no entry: its row shows the session's own server, which is what the check verifies and the engine then signs in.

**The redirect** is one constant in `sign-in.ts`, set from M1's verdict:

    const DYNAMIC_REDIRECT: { plugin: 'maws' | 'engine'; own: 'maws' | 'engine' } = { plugin: 'maws', own: 'maws' };

`maws`: MAWS's loopback listener, as for a file-scope connector. `engine`: `mcp_authenticate` is sent with no redirect, the engine keeps its own `localhost` listener, and the operation's existing path for that scheme watches the status. A plugin's server is one whose name starts `plugin:`.

**Who offers Sign in.**
- *The Connectors dialog* (a session MAWS runs): a row whose status is `needs-auth` and whose scope is `user`, `project`, `local` (through `connectors.signInServer`, unchanged) or `dynamic` (through the new command). Not for `claudeai` or a managed scope.
- *Customize › Connectors › My items*, a row of MAWS's own list (`scope === 'app'`), when `signInViewOf` offers a sign-in for it and the row has a revision: Sign in while a session is chosen, else `CONNECTORS.openSession(null)`, "Open a session, then sign in". The session chosen: the page's attached session when it is ready and its status lists the name; else the first ready session MAWS runs on this Mac whose status lists the name, one in the page's folder first, then by id. The services' check decides; this choice only picks whom to ask.
- Settings › MCP servers offers none.

**The route to another machine, until U11f** (ruled, point 3). One entry in U9's `REMOTE_UNAVAILABLE`:

    'connectors.signInDynamicServer': notYet('signing in to a connector from a plugin or from MAWS’s own list'),

so the control reads "Not on another machine yet: signing in to a connector from a plugin or from MAWS’s own list", disabled, through `useRemoteUnavailable(appSessionId, 'connectors.signInDynamicServer')`; nothing is sent, and `test/lane-b/offer-coverage.test.ts` passes. A file-scope row beside it keeps its Sign in, and the words a machine's own listener gives ("sign in on <machine>") are today's. A machine reached over a socket link (development and `e2e/machines.spec.ts`) is not greyed by that helper and takes the command or answers `unknown_command`. U11f removes the entry and makes the insertions U9's document lists (its Interfaces 2), with UC-7.5's update sentence for a machine that does not list the capability.

### §B. Org copy (M2)

`ORG` in `settings-tab/copy.ts`, exact, with the file's typographic apostrophes:

| key | reads |
|---|---|
| `grantRefusals['signed-out']` | This Mac isn’t signed in to the org. Sign in under Org, then try again. |
| `grantRefusals.damaged` | This Mac’s record of the grants it issued is damaged and can’t be repaired here, so it signs no grant. Sign from another device of the machine’s owner (an admin’s, for a machine the org owns). |
| `grantsDamaged` | Grants can’t be signed on this Mac: its record of the grants it issued is damaged. Sign them from another device of the machine’s owner. |
| `grantRefusals.storage` | The grant couldn’t be saved on this Mac. Try again; if it keeps failing, check the disk’s free space. *(ruled, 8b; the child's line adds ", so nothing was sent")* |
| `grantRefusals.invalid` | The rights were sent wrongly (one was named twice). Close this sheet and choose them again. |
| `grantRefusals.ineligible` | This Mac can’t sign this grant. Sign it from another device of the machine’s owner, or resolve: |
| `grantRefusals['ledger-unread']` | The machine’s grants for this person couldn’t be read, so nothing was signed. Try again in a moment. |
| `grantRefusals.refused` | The signed grant didn’t verify against the org state held now. Nothing was kept or sent: sign again. |
| `enrollProblems['not-yours']` | Another admin started this enrollment, and the hub answers only to them. Ask them to finish it, or Start over to enroll the machine yourself. |
| `enrollProblems['machine-names']` | That name is bound to another machine for the life of the org. Start over with a different name. |
| `enrollRefusals.shape` | A machine name is up to 63 letters, digits, dots, hyphens or underscores, starts with a letter or digit, and is not "hub" or "legacy". |
| `enrollRefusals['prefix-names-machine']` | That name starts with a delegation’s prefix, which is kept for the machines that delegation certifies. Choose a name outside it. |
| `enrollRefusals['no-machine']` | The org no longer lists this machine. Close this sheet and enroll it as a new machine. |
| `enrollRefusals.refused` | The hub refused the enrollment. Try again; if it is refused again, sign in to the hub again under Org. |
| `rightLines['machine-admin']` | Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use. *(ruled, 7; the child's line: "Change its settings, connectors and plugins, and restart it.")* |

**What follows a refusal's line.** The line, then main's detail unless the table says otherwise; `ineligible`'s list is drawn once, after its line. Main's string changes only where the last column says.

| sheet | reason | after the line | main's string |
|---|---|---|---|
| grant, re-grant | `signed-out`, `damaged`, `cancelled` | nothing (main gives none) | — |
| | `busy`, `invalid`, `no-change`, `stale`, `none` | nothing: the detail repeats the line | unchanged |
| | `ineligible` | the list | unchanged |
| | `ledger-unread` | the detail: which ledger, and why | loses ": try again shortly" at its one site |
| | `refused` | the verdict's code | becomes the code alone |
| | `storage` | the detail: what could not be written, and whether anything was sent | unchanged |
| enroll (a refused start) | `not-root`, `not-admin` | nothing, as today | — |
| | `shape`, `machine-name-taken`, `certified-machine`, `no-machine`, `cancelled` | nothing: the detail repeats the line | unchanged |
| | `busy` | the detail: which attempt is running | unchanged |
| | `hub` | the detail: the sign-in ended, or the hub was not reached | loses ": sign in again to enroll" at its two sites |
| | `prefix-names-machine` | the detail: which prefix | loses its second clause (from ": a name there")  |
| | `refused` | the hub's status and code | loses its lead, "the hub refused the enrollment: " |

Every refusal still opens with `ORG.notSigned` or stands alone as today; that prefix is not changed.

### §C. The Connectors dialog (M6; its row and words consumed by M7 and M8)

**Names** (`widgets/copy.ts` unless said):

| where | reads |
|---|---|
| `WIDGET_TITLE.mcp` | Connectors |
| the frame's head, muted, after the title | MCP servers |
| `MCP.none` | No connectors |
| `MCP.list` (the list's accessible name) | Connectors |
| "+" › Connectors, the entry to the dialog (U4's `PlusMenu.tsx`) | Connectors in this chat… |
| "+" › Plugins, the entry to the dialog | Plugins in this chat… |
| the palette's description of `/mcp` (U4's `composer/mentions/widgets.ts`; `items.ts` lets this one name's declared description win over the engine's) | Connectors in this chat (MCP servers) |
| the head's sentence, once | Off here is off for every session in <place>. |
| its tooltip | The engine records it in ~/.claude.json. |

`MCP_ACTIONS.persisted` goes. The `/mcp` beside the title stays.

**Status words**, one function, read by the dialog, the terminal session's dialog, the "+" › Connectors submenu and Customize's live list:

    // widgets/connector-status.ts
    export function connectorStatusWords(status: string, opts?: { switchDrawn?: boolean }): string;

| status | words |
|---|---|
| `connected` | Connected |
| `needs-auth` | Sign in needed |
| `failed` | Failed |
| `pending` | Connecting… |
| `disabled` | nothing where a switch is drawn; "Off" where none is |
| any other | the engine's own word |

The first, second and fourth are `CONNECTORS.connected`, `.needed` and `.connecting` of `customize/connectors/copy.ts`, read from there so the words have one home. `signInViewOf` and Customize's own rows are not changed.

**The row.** One line: the switch, the name as the engine reports it, the status words, `MCP.tools(n)` when it has tools. Opened: the transport (the full command as its tooltip), `MCP.from(source)`, `MCP.scope(scope)`, an error, the tool names. `WidgetFrame` gains two optional props for the head, a muted subtitle and one line of note; both are this dialog's alone at this landing.

**`<place>`** (ruled, point 5; P2 answered 2026-11-12): the project's name when the session's record names a project. Else the **main root** of the repository that holds the session's folder, with the home abbreviated (`homeAbbreviated`): the parent of `git rev-parse --git-common-dir`, which is what `git.worktree.list`'s `repoRoot` reads (as `src/endpoint/targets.ts` uses it); the executor takes that reading or one the pane already holds, whichever is there without a new command. Else, when the folder is in no repository, the session's folder itself (the folder being what the dialog reads today: `engine.cwd`, else the record's directory). Where the main root cannot be read (git answers nothing, or the session is on another machine and the reading is not offered there) the sentence names the session's folder, as before; that names a narrower place than the engine's, and is residue (Concrete Steps 6). Seen by P2: from a repository's root, a linked worktree beside it, a linked worktree under `<root>/.claude/worktrees/` and a subfolder, the engine writes `disabledMcpServers` only under the key of the repository's main root, and a new session in any of the four starts with the server off (16 of 16 pairs, two runs); outside any repository the key is the session's folder exactly, and its subfolder is a place of its own. A session in a worktree with a project reads the project's name, never its worktree's folder. This paragraph is the one place.

### §D. Before the first message (M7)

    // widgets/tab-place.ts
    export type TabPlace =
      | { kind: 'started' }                                        // the dialogs read the session, as today
      | { kind: 'remote'; machine: string }                        // an unstarted tab set to another machine: that machine's name
      | { kind: 'local'; folder: string | null; place: string };   // an unstarted tab on this Mac
    export function useTabPlace(appSessionId: AppSessionId): TabPlace;

    // customize/inventory.ts
    export function useCustomizationInventory(cwd: string | null, opts?: { enabled?: boolean }): /* the query Customize holds today, same key, with a stale time */;

- *Unstarted* is `useSetupIntent(appSessionId) !== null`. *Remote* is a spawn target for the tab (`useSpawnTarget`, as `composer/Composer.tsx` computes it) or an id whose machine is not this Mac.
- `folder` is `settingsDirectoryOf(location)` for a chosen location: the folder itself, or the repository's root for a worktree not yet made. With no location it is null: the inventory then reads the user configuration (`cwd: null`) and the plugin reads take the engine's config home, as Customize does.
- `place` is the project's name (`intentProjectName`), else the folder with the home abbreviated, else "your user configuration".

**Words** (`widgets/copy.ts`):

| where | reads |
|---|---|
| the Connectors dialog's line | Configured for <place>. Connection state, and connectors from plugins, show once the chat starts. |
| the Skills dialog's line | On disk for <place>. The chat may load more once it starts. |
| each of the three dialogs, and the Connectors submenu, for a remote tab | Shown once the chat starts on <machine> |
| the Connectors submenu or dialog with nothing configured | `MCP.none` |

**Connectors.** One row per name: the entry the engine will use (`shadowedBy`), its scope in Customize's words (`CONNECTORS.scopeOf`) where a started chat's row has its status words. No switch, no Reconnect, no Sign in.

**Skills** (ruled, point 6; P3 answered 2026-11-12). Customize's three groups under their headings there. "Use in chat" inserts `/<name> ` for a project's and a person's skill, `<name>` being the inventory's `name` (confirmed by P3 with a front-matter name equal to the folder's and different), and `/<plugin>:<name> ` for a plugin's, `<plugin>` being the plugin's **manifest name**: the `name` of `.claude-plugin/plugin.json` under the row's install path, which the engine names the plugin by. Not the installed plugin's key up to its `@`: P3 saw that form run nothing, silently, when a plugin's manifest name differs from its marketplace entry's (the text reaches the model as an ordinary message; 2 of 2), and `/<manifest name>:<name> ` run the skill in every variant. The inventory's skill row carries the manifest name as one optional field, `pluginName` (`src/shared/ipc/schema/customization.ts`, `CustomizationSkillSchema`: `pluginName: z.string().max(256).nullable().optional()`, null when the manifest's name could not be read, absent from an engine host of build F; §H). A plugin skill with no `pluginName` is listed without "Use in chat". This paragraph is the one place. No Reload.

**Plugins.** The dialog reads `folder` (the config home when null), so My items and its management work as in Customize. Its loaded line reads `FRESHNESS.notObserved` alone for an unstarted tab. The "+" › Plugins submenu keeps its two entries and lists no rows before the start.

### §E. One scrim; layers that stack; the gutter; names (M3)

    // sessions/ui.ts
    export const SCRIM = 'bg-bg-active';   // what a sheet or a dialog dims the window with (#523); the renewal owns a scrim token

    // sessions/scrim.ts
    /** The class of one modal layer's backdrop: SCRIM while it is the top layer, 'bg-transparent' while another has opened over it. Each backdrop calls it once and counts as a layer for as long as it is mounted. */
    export function useScrim(): string;

**Layers that stack** (the review's finding 3). The top layer's backdrop paints and every backdrop under it is clear while it is covered. So the window is dimmed once, by the one value, however many layers are open, and the top layer's backdrop also dims the dialog under it, which then reads as behind. The top layer is the one mounted last. Read by `Sheet` and by the overlays of `composer/WidgetDialog.tsx`, `composer/InlineEdit.tsx`, `resume/host.tsx`, `transcript/view/rows/Divider.tsx`, `keymap/KeyboardShortcuts.tsx` and `sidebar/AddProject.tsx`; each such backdrop carries `data-scrim`, and `Sheet`'s keeps `data-sheet-scrim` beside it. U7's Settings dialog reads it too: the Org sheets and the import sheet open over it. Pitfall: mount order stands for stacking order. Three of these overlays sit at `z-40` and `Sheet` at `z-50`, and today nothing opens a `z-40` dialog over a sheet; a later layer that would must raise its own z-index, the stack is not the place.

U10's `.doc-confirm-overlay` takes `background: var(--bg-active)` with no opacity and is not a layer of the stack (ruled, 9).

| where | reads |
|---|---|
| `REFUSALS['not-supported']` (`sessions/share/copy.ts`) | <machine>'s sminos can't keep a session's reach yet. Update sminos on <machine>, then open this again. |
| the Share and Add owner subtitle's tooltip | <title> · <machine> |

**The gutter** (ruled, point 10), in `styles/app.css`, `@layer components`:

    .scroll-gutter { scrollbar-gutter: stable; }                                    /* a scroller with a footer aligned under it */
    .scroll-gutter-under { overflow: hidden; scrollbar-gutter: stable; }            /* that footer: it clips, so the property applies */
    .scroll-gutter-scope [data-transcript-scroller] { scrollbar-gutter: stable; }   /* the session pane's transcript, from its wrapper */

The Channel's stream takes the first and its footer the second. In `session/SessionPane.tsx` the transcript's wrapper takes the third and the composer's wrapper the second. If the e2e measurement shows Electron's Chromium reserves no gutter for a clipped box, `.scroll-gutter-under` becomes `overflow: auto` with the same property, and that is the one change.

**Names, one order** for say rows, exchange rows and to-human headers. As a row narrows: the session's title gives way first, to nothing; then the recipients' and owners' labels; then the machine chip, which keeps up to 24 characters while there is room; then the alias, drawn whole where there is room and never under 12 characters. The chevron, the count's words, "and", "to everyone" and the time never shrink. A row that cannot hold the minimums wraps to a second line. Pitfall: `flex-wrap` on the row breaks lines before any item shrinks, so the wrap must be the fixed parts moving under the names, not the names wrapping among themselves. A party's tooltip is its alias, title and machine in full, joined with " · ", a missing one left out.

### §F. The Channel's reach and refusal, entries and action (M4, M5)

**The two fields** (`src/shared/ipc/schema/org.ts`, on the channel's open answer and on its change, after `live`):

    reach: z.enum(['connecting', 'unreachable']).optional(),     // present exactly while the answer is open and `live` is false
    refused: z.enum(['credentials', 'removed']).optional(),      // present while the hub has ended this channel's socket for good and the channel waits for the session's next change

`refused` is the channel's own word and does not depend on reach (the review's finding 2): `credentials` when the hub sign-in has ended, `removed` when the hub no longer admits the member, as the socket's two close codes say (`CLOSE_CREDENTIALS`, `CLOSE_REMOVED` in `project-socket.ts`). The third code that ends a socket, no such project, closes the answer `unknown-project` as today.

**Events and transitions**, per channel in main. Both are told with every open answer and as a change whenever either moves while the channel is not live.

| event | reach after | refused after |
|---|---|---|
| the channel is made; the sign-in or the hub changes; a released channel is opened again | `connecting` | absent |
| the attestation read fails | `unreachable` | unchanged |
| the socket errors, or closes before its welcome, with a code that does not end the channel | `unreachable` | unchanged |
| the socket closes with the code of an ended sign-in, or of a member no longer admitted | unchanged | `credentials`, or `removed`; nothing is retried |
| the socket's headers do not resolve | unchanged | unchanged |
| the socket is welcomed but has not caught up | unchanged | unchanged |
| the channel becomes live | absent | absent |
| a live channel loses its socket (a close, a missed pong, a wake) | `connecting` | unchanged |

So `unreachable` stays through every retry until the channel is live, and the footer does not flicker; and a refusal stands, whatever reach reads, until the session changes.

**The footer**, while not live, after "As of <time>" when there is one, the first that holds:

| condition | words |
|---|---|
| not signed in | Signed out |
| `refused` is `credentials`, or the org's hub status is `expired` | The hub sign-in has ended. (with its button) |
| `refused` is `removed`, or the hub status is `denied` | The hub no longer admits you. |
| reach is `unreachable`, or the hub status is `unreachable` | Offline · retrying |
| otherwise | Connecting… |

`CHANNEL.offline.unreachable` becomes "Offline · retrying" and `CHANNEL.offline.connecting` "Connecting…". An open channel with no entries and no `asOf` reads `CHANNEL.noCopy`, "This Mac has no copy of this channel yet.", where `CHANNEL.empty` stands today.

**The Channel's entries** (`channel/project.ts`; parameters as `sidebar/menus.tsx` reads the same stores today):

    export function channelProjects(...): { project: string; name: string }[];   // every project that has a channel: a project of the hub
    export function channelOfRow(row: RowKey, ...): string | null;               // that project's channel id, or null

The palette's `PaletteEntries` gains `channels: { project: string; name: string; waiting: number }[]`, drawn as a group "Channels" after Projects and listed with an empty query as Projects are. An entry reads "<name> · channel", with "N waiting" as its muted detail when N is not zero, and matches a query that is part of that text, case ignored. Enter runs `openTab({ kind: 'channel', project })`.

**The action** (ruled, point 11):

    // src/shared/keymap/actions.ts, after the rows of the Tabs submenu and before pane.split
    'channel.open': { title: 'Project channel', chord: null, sink: 'menu', menu: 'view', scope: 'app' },

View then reads: Overview, Artifacts, Tabs ▸ │ Project channel │ Split / move to other pane, … Its handler is registered exactly while the tab in front names a project that has a channel: a Channel tab's own project, or a session tab's row. That row is `sessionRow(id)` of `keymap/actions-runtime.ts` when the merged master has it (U13a), else `sessionSetKey` of `stores/org-projects.ts` as `ipc/events.ts` calls it today; the two are the same computation. Unregistered, the menu item is greyed and the palette's row reads `UNAVAILABLE['channel.open']`, "This project has no channel".

### §G. Settings (M9, M10; consumed by U7)

    // settings-tab/SettingsView.tsx
    export const SETTINGS_SECTIONS = ['appearance', 'notifications', 'keyboard', 'voice', 'browser', 'artifacts', 'sessions', 'gateway', 'engine', 'supervisor', 'org'] as const;
    export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
    export const SECTION_TABLE: readonly { group: 'app' | 'sessions' | null; section: SettingsSection }[];   // the index's and the body's order
    export function SettingsView(props: { section: SettingsSection | null }): JSX.Element;                   // fills its host; null opens at the table's first section

    // settings-tab/rows.ts
    export interface SettingsRow {
      id: string;                    // '<section>.<row>': the search's result and the row's mark in the page (data-settings-row)
      section: SettingsSection;
      label: string;
      states: Readonly<Record<string, { line?: string; more?: string; state?: true }>>;   // most rows have one, 'default'; `state`: the line reports a condition the person must act on
      keywords?: readonly string[];  // other words people use
      revealedBy?: string;           // the row whose control makes this one drawn
      repeats?: true;                // drawn once per thing made at run time
    }
    export const SETTINGS_ROWS: readonly SettingsRow[];

A drawn row names its declaration and the state it shows (`<Setting row="engine.binary" state="chosen">`), and tells the view both, so the search knows what the page shows now. A value inside a line (a size, a number of minutes, a name) is declared as a marked place; the search reads the words around it.

*Rows made at run time* (the review). `BrowserImport.tsx` draws a row per imported Chrome profile and a row per extension of each. Both are declared once with `repeats`: `browser.importedProfile` (declared label "Imported Chrome profile"; the drawn label is the profile's own name, and its note, the import's summary, is a state) and `browser.extension` (declared label "Extensions"; the drawn label is the extension's name), each `revealedBy` the Chrome profile row. Nothing else in the body repeats: a Space's design system is a control inside the By Space row.

**The index.** A column 148 px wide, as today, in three parts: the title and the search field at its top; the list, which scrolls by itself; the footer, which stays at the bottom. The list holds the two groups with their sections, then, under the rule that separates the Customize link today, Org and "Customize ›". With U7's Usage the list needs 705 px and the dialog gives 695 at the default window, so the scroll is not optional.

- A group heading is drawn as the app's other group headings, 12 px semibold in `fg-muted`, on one line that never wraps. (`fg-faint` is 2.6 to 1 on the index in the light theme.)
- `INDEX.groups`: `{ app: 'App', sessions: 'Sessions & engine' }`. "Sessions and engine" is 116 px in an entry's 115 and would wrap.
- `SECTIONS.supervisor`: "Supervisor". The link reads "Customize" with the chevron beside it. The footer is unchanged.
- The rows of each section, in order, are the child's table, its Background row read as Supervisor.

Three things are with the owner on the drawn page. Each is built at the first answer and changes at the places named, and nowhere else:

| question | built | the other answer changes |
|---|---|---|
| the order | everyday preferences first: App, then Sessions & engine, then Org | `SECTION_TABLE`'s order: Sessions & engine first with Engine at its head (Engine, Sessions, Gateway, Supervisor), then App, then Org. The view opens at the table's first section, so nothing else moves. |
| Org's heading | Org stands without a group heading | `INDEX.groups` gains `org: 'Org'`, and Org's entry in `SECTION_TABLE` takes `group: 'org'`, the type's third member. Nothing else reads a group: the search does not match by a group's name, and nothing stores one. |
| the section's name | "Supervisor" | the one string `SECTIONS.supervisor`, to "Background". The id `supervisor` is not shown and not stored. "Background" is also the first word of a session's "Background work" surface and of its key binding, so a search for it would then list both. |

**The stored section** (ruled, point 12). The list in `src/shared/ipc/schema/layout.ts` is not edited and stays build F's ten. `SettingsSection` is no longer derived from it; the stored ten are all members of it, so every caller and the tab's host compile unchanged. No caller opens the tab at `supervisor`: it is reached by the index and the search, which move the view without writing the tab, and by U7's `openSettings`, which is held for the run only. So no value F does not know can be stored, and nothing is held in memory.

**The measure.** "One line" is claimed where the body has its full 760 px: the default window with no side surface open, and U7's dialog when it gives `SettingsView` 948 px (148 for the index, 20 on each side of the body, 760). There a note has 580 px in 12 px type. A note that ends in More, or carries a button, has 532 px for its words and is 22 px high, the button's box; one that does not is 18 px high. No character count stands in for this: these sentences run 5.5 to 5.9 px a character, so a count misjudges both ways. The proof is the e2e scene, at three widths:

1. *The body at 760 px.* Every note is one line: 18 px, or 22 px where it ends in More or carries a button. Rows whose line is a state are not measured.
2. *A view about 520 px wide* (a 50/50 split with no side surface). The index is still a column; every row is stacked, label over control over note; no note stands beside its label.
3. *A view about 330 px wide* (a split beside a side surface). The index is a row of links without headings; rows stacked.

*Rows stack by the body's own width.* The body's column is a container of its own, and a row is two columns only where that container is at least 32rem. So a note beside its label is never narrower than 332 px (512 less the label's 168 and the gap's 12). The index keeps today's break, on the whole view, at 32rem.

Known and accepted: the supervisor waiting on an older version takes five lines at 760 px (114 px against 48 when it runs), a state that stays whole; in a narrow pane "More" often falls alone on a line of its own; in a dialog narrower than 948 px (912 at the window's smallest) some notes take two lines.

**Lines and Mores** are the child's table, with these additions. A note that fits its line keeps its words: no More is added for the sake of one clause.

*States the table does not give:*

| row, state | the line | behind More |
|---|---|---|
| Binary, a chosen binary | New sessions start on the binary you chose. | Running sessions keep the binary they started on. MAWS was verified against Claude Code <version>. |
| Update, installed | Runs claude update in a terminal tab. | New sessions start on the new version; running sessions keep theirs. |
| Voice › Shortcut, unbound (the default) | Click the microphone in the composer's toolbar to start dictating, and again to stop. | A shortcut, once bound, dictates into the focused composer while you hold it. |
| Limit, a limit set | Default: 25% of physical memory. | Past it the least recently used idle session is released. Send resumes a released session. |

*The two lines that run over at 760 px*, each with its last clause moved behind More and its words otherwise unchanged:

| row | measured, as the table words it | the line | behind More |
|---|---|---|---|
| Limit, default with its size | 550 px of words, then More | Default: 25% of physical memory (<size>). | Past it the least recently used idle session is released. Send resumes a released session. |
| Update, a chosen binary | 552 px of words, then More | Runs claude update in a terminal tab. | New sessions stay on your chosen binary until Use installed. Running sessions keep theirs. |

Every other line fits and keeps its words: among them Messages to you as the child's table words it (519 px, then More), Hooks in sessions (490 px, then More), and three notes the table does not list, which stay whole with no More: Per-session Direct (544 px), Browser › Profile (531 px) and Exit when idle set to never (501 px).

*Direct login.* The child's row gives the line "Only Direct sessions use it." and its More. Today's note also carries the instruction `GATEWAY.signIn`, "Sign in: run claude /login in a terminal", and a Copy button. Both stay on the row's line, after the sentence and before More (401 px together).

*The line under Sessions' heading* sits under the heading, 12 px in `fg-muted`, not beside it as Keyboard's hint does: "For sessions MAWS runs. Terminal sessions and your Claude Code settings files are not changed." It is one line at 760 px and two in a narrow pane.

*Where each old note went*, for the reviewer of M9: every note of today's `copy.ts` is in the child's table or the tables above, or keeps its words on one line. Said once under Sessions' heading, and so gone from each note: that a setting never reaches a terminal session, and that the person's own settings files are never changed. Dropped: Config home's "MAWS reads them and keeps its own index elsewhere" (the chip says it), and the Plugins paragraph row with its sentence.

**More.** A text button at the line's end, drawn in `fg` so that it reads as a button after a muted sentence; "More", "Less" while open, with `aria-expanded`. Closed, its text is not in the page.

**Search** (`settings-tab/search.ts`):

    export interface SettingsResult { id: string; name: string; under: string; target: string; openMore: boolean }
    export function searchSettings(query: string, input: { rows: readonly SettingsRow[]; shown: ReadonlyMap<string, string>; bindings: readonly { id: string; title: string }[]; orgGroups: readonly string[] }): SettingsResult[];

`shown` is each drawn row's id and the state it shows. Four rules decide the rest, and each choice under them is stated.

*(i) Choosing a result never puts the keyboard on a control that acts on Enter.* The chosen row itself takes the keyboard, with the accent outline; Tab then enters its controls. A second Enter does nothing.

*(ii) A result never names text the page will not show in its present state.* A drawn row is matched by its label, its keywords, its section's name, and the line and More of the state it shows now; another state's words are not searched, so a chosen binary's Binary row is not found by "PATH". A row that is not drawn (Limit and Stateful MCP servers while the memory budget is off) is found as the row that reveals it: its label and keywords count for that row, and the result is that row's name. A repeating row is one result by its declared label, and lands on its first drawn item, or on the row that reveals it when it has none. `openMore` is true when the query's words are found only with the More the row shows now.

*(iii) A result is the row's name with its section under it, never "<row> in <section>", and takes two lines at most.* The name is one line, cut with an ellipsis and whole in its tooltip; under it, in `fg-muted`, one line:

| the result | its name | under it |
|---|---|---|
| a row | its label | its section's name |
| a section | its name | Section |
| a key binding | its action's title | Keyboard |
| a group of the Org page | its heading | Org |
| the Customize link | Customize | Plugins, skills and connectors |

The Org page's own group headed "Org" is not a result of its own; the section's result stands for it. While the field holds text the results take the place of the groups and sections in the index's list and scroll as that list scrolls; the footer stays. No match reads `INDEX.noMatch`, "No matching settings", on two lines at most. The field's label and placeholder are `INDEX.search`, "Search settings"; it is drawn as the dialogs' search field, at the index's width.

*(iv) A row is not matched by its group's name.* "Engine" or "sessions" would otherwise list every row of the group. A key binding is matched by its action's title alone, so "keyboard" lists the section and its two rows, not sixty bindings.

Under those rules: every word of the query must be found, case ignored. Results stand in the page's order, a section's own result before its rows, and the first is preselected, so Enter chooses it; Up and Down move. Choosing a result scrolls the body so that the row's section heading is at the body's top where the row is then in view; a row farther down its section than the body is tall is brought to the middle instead, since both cannot be in view. The row is marked with `bg-bg-active` over its box and 8 px around it, for 1,600 ms, then cleared over 150 ms (at once under reduced motion, and at once when another result is chosen). The query stays in the field; the field does not keep the keyboard.

Keywords at least: connectors, integrations and tools for MCP servers; shortcut and hotkey for the key bindings; dark and light for Theme; relay, account and direct for the Gateway rows; RAM for the memory budget; plugins, skills, connectors, marketplace and mcp for the Customize link.

*The narrow form.* The field is a full-width first row above the row of section links. While it holds text the results take the links' place as a list under the field, at most 12rem high and scrolling; a choice scrolls the body beneath it.

**For U7.** `SettingsView` fills its host and needs 948 px of it for the one-line measure; the dialog's box is 960, so a padding of more than 6 px a side costs it. The index scrolls by itself and its footer stays, which Usage makes necessary. Usage is `{ group: 'sessions', section: 'usage' }` after Gateway in `SECTION_TABLE`, with its rows in `SETTINGS_ROWS`. The dialog's Esc lets a search field that holds text clear first (`data-escape-clears`). A sheet opened from Settings stacks over the dialog, whose backdrop reads `useScrim` (§E).

### §H. What is stored or sent, and what build F does with it

This landing stores no new key, so it adds no row to the cross-build coverage table (U13a's M5). It moves a row that table's settings scene drives (Constraints; Proof, P7).

| stored or sent | this landing | build F meeting this landing's value | this landing meeting F's value | this build, then F, then this build |
|---|---|---|---|---|
| `settings.json`, `machine-settings.json` | no key, value, default or version changes; a moved row writes the field it wrote | reads and writes them as master's | the same | unchanged at every step |
| `layout.json`, the Settings tab's `section` | writes only the ten values F knows, by the unchanged callers | parses it | every one of F's ten is a section here | unchanged |
| the command `connectors.signInDynamicServer`; the wire's minor, higher | sent by this build's app to this Mac's daemon | a daemon on F answers `unknown_command`: the row reads a sign-in that did not finish, in the transport's words. An app on F never sends it. F reads no minor. | — | a daemon outlives the app that started it until it is idle, so each pairing can occur; both are covered by this row |
| the event `connectors.signInChanged`, its `name` now any string up to 128 | emitted by this build's daemon with a dynamic connector's name | every reader on F drops an event whose name fails F's rule and logs one line (`host-supervisor.ts`, `socket-link.ts`, `remote-artifact-feed.ts`). F cannot have started that operation, so it has nothing to bind the event to. It can occur when F's app starts within the five minutes a sign-in this build began is still waiting. | F emits only configured names, which read here | no state is left by a dropped event |
| `revision`, on a row of `customization.serverEndpoints`' answer (the engine host's); the wire's fingerprint, changed by it | made by this build's engine host, read by this build's services and main | F's main and services read the answer through the wire's tolerant reader, which drops a property a build does not know. F speaks the wire by its major and minor and does not read the fingerprint. | an engine host on F answers no revision: Customize's row of MAWS's own list offers no Sign in until the host is replaced; the dialog's Sign in is not affected | nothing is stored: a revision lives for one run of one engine host |
| `pluginName`, on a skill of `customization.inventory`'s answer (the engine host's); the wire's fingerprint, if it covers that answer | made by this build's engine host from the plugin's manifest, read by this build's main and renderer | F's main reads the answer through the wire's tolerant reader, which drops a property it does not know; F's Customize never inserted a plugin skill's name | an engine host on F answers no `pluginName`: an unstarted tab's Skills dialog lists that host's plugin skills without "Use in chat" until the host is replaced; the person's and the project's skills are not affected | nothing is stored |
| `revision`, on a server of `catalog.postures`' answer (main's) | from main to this app's own windows, one build at both ends | never sees it | — | — |
| the engine's credential for a signed-in connector | the engine writes it to the Keychain, keyed by the server's name, type, address and headers; MAWS stores nothing | F's sessions run the same engine and read it connected | the same | unchanged |
| `~/.claude.json`, a disabled connector | the engine's `mcp_toggle`, as today | as today | as today | unchanged |
| the channel's `reach` and `refused` | from main to this app's own windows, one build at both ends; not stored, not on the wire | never sees them | — | the channel's cache file is not touched |
| `channel.open`, a rebinding | not storable: U6a's guard keeps an id F does not know out of `settings.json` | — | — | — |
| the machine link (RL2) | nothing new crosses it | — | — | U11f's |

A member who holds `machine-admin` on this machine and is connected from another device hears the sign-in event as today. It can now carry a plugin connector's name, which that member can already list (`connectors.servers`).

### §I. Dependencies on other landings

Consumed, by the name each is exposed under:

- **U6a** (must be on master before M5): the row's shape and "table order is menu order" (its Interfaces A, B, G); `paletteEntries(query, input, table)`; `WAVE_DEFAULTS`, which already holds `'channel.open': null`, and `LANDED`; `isRebindable`, by which the new row takes no rebinding and this landing does nothing for that; its insertions in this child's files, which M9 keeps as they are (`KeymapRow.rebindable` and the one condition in `KeymapSection.tsx`; `KEYBOARD.hint` without its first clause); and UC-6's focus-first rule as that document builds it, by which a region that handles a menu row's chord itself keeps it (M10's ⌘F).
- **U13a** (either order): `activeTab(state.main)`, and `openTab(target)` bringing an open tab forward (its §F); `sessionRow` when it is on master (§F above); its insertion in `customize/CustomizeView.tsx`, the file M7 takes the inventory's query out of (whoever lands second merges); its cross-build settings scene, which must find the idle-time row by the row's own label, since this landing moves it from Engine to Supervisor (whoever lands second sees to it).
- **U9** (either order; before U11f): `REMOTE_UNAVAILABLE` and `useRemoteUnavailable`, whose signature its document keeps. If U9 has landed, its `disabledWords` answers a declared command's words first, so §A's sentence reads the same.
- **U4a** (either order; nothing consumed, three files shared): its slash-list changes are in `composer/mentions/items.ts` and `widgets.ts`, where M6 changes the one name `mcp`; its `/btw` mount changes the transcript's wrapper in `session/SessionPane.tsx`, the element that takes M3's gutter scope. Whoever merges second keeps both edits.
- **U8a**: nothing consumed. Its tree test fails on a new spelling of a session's folder: M6 and M7 read the folder as the dialogs do today (`engine.cwd`, else the record's directory, a spelling the test counts as zero) or through `useWorkingFolder`, and add no other.
- **U3a, U8b**: nothing consumed. `transcript/view/Transcript.tsx` is not edited; U8's Connectors card is not edited.
- **The wire's minor**: U3a, U1a, U4a, U8b and U12a each raise it, as M8 does. The number is whoever merges last's to take (Constraints; Concrete Steps 4 and 5).

Exposed to siblings: `SCRIM` and `useScrim`; `SETTINGS_SECTIONS`, `SettingsSection`, `SECTION_TABLE`, `SETTINGS_ROWS` and `SettingsView`, with what §G's "For U7" asks of the dialog; the search field's `data-escape-clears` mark; `connectors.signInDynamicServer`, `startSignInDynamic`, `SignInScope` and the configuration's revision (U11f; X-184, whose rows for a plugin's connector will need a revision of their own); `connectorStatusWords` (U8's card may adopt it); `useTabPlace` and `useCustomizationInventory` (#476's lists); the three gutter classes; `channel.open`.

When U3's Find lands, ⌘F is a menu row's chord; its scene "while the Settings dialog is open ⌘F focuses its own search" is where the pair is proved together.

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| | what | when it can start | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **A dynamic connector's sign-in through MAWS's redirect** (law 6; the child's Probes) | after M1 is pushed | The `discover` e2e group in a gate job on the Mac mini runner, with `MAWS_SIGNIN_SPIKE=1` in the job's environment so that the case "spike: …" runs (the case is skipped without it, and the gate has no way to set it today: that is the architect's to arrange with the session that keeps master). Engine 2.1.322 on the runner. Never the MacBook, in any form. | For `dynamic` and for `plugin`: the scheme answered, each step's answer, the final status and the next process's status; the run's id. M1's criteria give the verdict, which sets §A's `DYNAMIC_REDIRECT` or takes a kind back to the design. M8 starts after it. |
| P2 | **Answered 2026-11-12** (`spikes/protocol-probe/findings-uxwave-u11-connector-off-place.txt` on `ux-wave/probe3-u11`; §C's `<place>`). **Where the engine records a switched-off connector for a session in a linked worktree** (law 6; point 5) | any time before M11 | A wire probe on the wave's probe VM, engine 2.1.322, scratch config home: a scratch repository with one linked worktree, a session in each, `mcp_toggle` off, then the key of `projects` in the scratch `.claude.json` that holds `disabledMcpServers`. No Keychain is involved. | The key for each case. The repository's root for both: §C's `<place>` stands. The worktree's own folder: a session in a worktree reads its folder as `<place>`. Anything else: back to the architect. |
| P3 | **Answered 2026-11-12** (`spikes/protocol-probe/findings-uxwave-u11-skill-names.txt` on `ux-wave/probe3-u11`; §D's Skills). **A skill's name on disk against the engine's name for it** (law 6; point 6) | any time before M11 | A wire probe on the same VM: a person's skill and a project's skill, each once with a front-matter name equal to its folder's and once different, and a plugin's skill; the engine's own skills list read beside the inventory's rows. | Per group, whether §D's inserted form is the engine's name. A group it does not confirm loses "Use in chat" before the first message. |
| P4 | **The 45 seconds of "Reading the channel…"** (S-09; the child's Probes) | after M4 is pushed | A Mac other than the MacBook on this branch's build, signed in to an org, the network turned off: one Channel tab that has a cache and one that has none; the time `org.channel.open` takes to answer, and what the body and the footer read. An agent on the mini, or U14's sitting. | The answer comes at once: A13 as built. It is late: what it waited on, which M4 then fixes in main (its last decision). |
| P5 | **The owner's look at the regrouped Settings** (root, "Looks the owner is asked for") | the page is drawn and measured (2026-11-12); the owner's answers are awaited | Three answers on the drawn page: the order; whether Org takes a group heading; the name of the section for the supervisor and the memory budget. | Each answer changes the places §G's table names and nothing else. M9 and M10 wait for them; no other milestone does. |
| P6 | **The e2e scenes** on a Mac under the load rule | after M11's hand-back; a milestone's own scenes as soon as it is pushed | The new and reworked scenes alone first: in `e2e/channel.spec.ts` the edges, the 420 px column, the footer's words and the palette and menu scene; in `e2e/composer.spec.ts` the session pane's edges under classic scrollbars; in `e2e/share.spec.ts` the scrim and the sentence; in `e2e/widgets.spec.ts` the stacked scene (the Plugins dialog, then its confirmation), the three edited Connectors scenes and the unstarted-tab scene; in `e2e/settings.spec.ts` the regrouped page, the notes at §G's three widths, More and the search. Then the groups that hold what this change reaches: `settings` (which also runs the org page, the Channel, Share and the registry), `widgets`, `composer`, `layout`, `supervisor-daemon`, `machines`, `default`. `e2e/c11-live.spec.ts` has no gate group: its edits are typechecked and run at the next live sitting. | Verdicts by group, and the screenshots the scenes attach (the footers under both scrollbar settings; the grant sheet; the Share sheet; the stacked dialogs). A red scene goes back to the controller as a fix. |
| P7 | **M8's sign-in scene, and the cross-build settings scene** | after M8 and M9 are pushed | M8's scene: the `discover` group in a gate job on the mini, with its Keychain custody as the existing sign-in case has it. The cross-build scene: one `e2e:cross-build` run with build `f1852de3a` as the peer, because M9 moves the idle-time row that scene changes through this build's Settings. | The run ids; the scene named as run and green. A skipped scene is not evidence. |
| P8 | **The branch review** | after M11 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11a` (Decision Log). | A verdict and findings; the fixes are one wave through the controller. |
| P9 | **Class 1a** | on the head handed back; again on the final head if the panel changed the branch | Concrete Steps 7. | The run's id, which the pull request names. |

## The owner's look (P5)

The architect drew the regrouped Settings as a page, with the app's tokens and Settings' real measures, and measured it; the page and its measurements are kept outside the repository. What it showed is folded into §G: which lines run over, the measure a note has, the index's headings and its scroll, the search's results and what choosing one does, Direct login's line, More's colour, and the place of the line under Sessions' heading. The drawing's frames stand for eleven sections; with U7's Usage there are twelve, which is why the index scrolls.

Three questions are with the owner on that page, and M9 is built at the first answer of each until the owner says otherwise:

1. Everyday preferences first and the engine last, or the engine first as today?
2. Org without a group heading, or as a group of one?
3. "Supervisor" or "Background" for the section that holds the supervisor and the memory budget?

Decided without asking, and shown on the page: what Sessions holds and the line under its heading; that only the two lines that run over are cut; the search's results; "Connector icons" as the last row of Appearance when its landing comes.

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, first landing (U11a)" and the parent pin; names its class 1a run, its review verdict and its residue (Concrete Steps 6, with what the milestones add); says that U11f holds the sign-in of a dynamic connector on another machine and waits for U9; and lists the five dated amendments it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

Found while checking the sections against the code at `48619c824`, then by the adversarial review and by the drawn page. Each is carried by a ruled point, a decision in a milestone, or an entry of the Decision Log.

- Observation: the sign-in's progress event bounds a server's name at 128 characters and holds it to a configured name's rule, which a plugin connector's name fails; the bound is on the wire's manifest and the rule is not.
  Evidence: `ConnectorSignInChangedSchema` in `src/shared/ipc/schema/connectors.ts`; `events.connectors.signInChanged` in `wire-manifest.json` reads `"name": {"type": "string", "maxLength": 128}`; `classifyWireChange` calls a changed length bound breaking.
- Observation: the renderer cannot send a configured server's address, so the check the section asks for a press from Customize has to read the entry in the services.
  Evidence: `CustomizationServerSchema` has no address; the comment above `CustomizationEndpointSchema`: "a configured URL may carry a token, so it never reaches the renderer".
- Observation: a command addressed by a session fails a tree test unless it is offered, answered by main or declared.
  Evidence: `test/lane-b/offer-coverage.test.ts`, "is exactly one of offered, answered by main, or declared remote-unavailable".
- Observation: the engine's own description of `/mcp` wins in the palette once its catalogue has arrived.
  Evidence: `slashItems` in `composer/mentions/items.ts` takes `WIDGET_COMMANDS` only for names the engine does not list; `fixtures/reads.jsonl` lists `mcp` with "Manage MCP servers".
- Observation: "Available once the session starts" is one constant read in about ten places, and the Plugins dialog's loaded line draws it too.
  Evidence: `NOT_YET` in `composer/submit/submit-state.ts`; `availabilityRefusal`'s callers; `widgets/plugins/LoadedLine.tsx` through `DormantGesture`.
- Observation: a new chat set to another machine is not in the tab's setup intent.
  Evidence: the intent's fields in `src/shared/sessions/intent.ts`; `useSpawnTarget` in `sessions/remote-spawn.ts`, as `composer/Composer.tsx` reads it.
- Observation: over the machine link a holder of `machine-admin` can act on connectors and nothing else.
  Evidence: the nine `machineAdmin` rows of `src/endpoint/offers.ts`; "A name not here is `not-offered`, graded or not".
- Observation: main's details repeat the sheets' lines for more reasons than the four the item names, and `storage` is refused both before a send and after a delivery.
  Evidence: `src/main/org/grants.ts` (`busy`, `invalid`, `no-change`, `refused`, `stale`, `storage`, and `unrecorded`); `src/main/org/enroll.ts` (`hub`, `machine-name-taken`, `certified-machine`, `cancelled`).
- Observation: ten overlays dim a window, not seven, and three of the five carry their own opacity.
  Evidence: `.doc-confirm-overlay` in `src/artifacts/document/editor/chrome.css`; `bg-bg opacity-60` in `WidgetDialog.tsx`, `InlineEdit.tsx` and `resume/host.tsx`.
- Observation: `scrollbar-gutter` does nothing on the Channel's footer or the composer's column as they are, and the transcript's scroller is shared by every transcript.
  Evidence: neither wrapper sets `overflow`; `[data-transcript-scroller]` is one element of `transcript/view/Transcript.tsx`, and `transcript.css` makes it a query container.
- Observation: nothing opens Settings at the supervisor's rows, and no caller could store a section build F does not know.
  Evidence: the callers of `openTab({ kind: 'settings', … })` and `SETTINGS_SECTIONS` in `gateway/actions.ts`; clicking the index sets the view's own state and writes no tab.
- Observation: the application menu cannot say why an item is greyed, and a row added after build F takes no rebinding.
  Evidence: `connectActions` reports the registered handlers and nothing else; U6a's document, decision 11.
- Observation: a press from Customize was not bound to the configuration its row showed (the review, finding 1).
  Evidence: `bindReceipt` and `SignInRecord` keep the fingerprint in the renderer; `resultFor` reads it only to choose which row shows a result; the operation's `run` checks the entry as it is when it runs.
- Observation: a channel the hub has refused retries nothing, while the org's hub status can still read healthy (the review, finding 2).
  Evidence: `onClosed` in `src/main/org/channel/channel.ts` sets `ended = 'parked'` and drops the socket; `reconcile` clears it only at a session change; the hub status is `org-session.ts`'s.
- Observation: modal layers stack today, so one value on every backdrop still dims the window twice there (the review, finding 3).
  Evidence: `WidgetDialogHost` keeps its overlay mounted while `ConfirmSheet`, a `Sheet`, opens from the Plugins dialog; two washes of 8% are about 15%.
- Observation: Settings draws rows that exist only at run time (the review).
  Evidence: `BrowserImport.tsx`, a `Setting` per imported profile and per extension.
- Observation: of the lines thought too long, two run over at 760 px; a character count misjudges both ways (the drawing, findings 1 to 3).
  Evidence: measured on the drawn page at 580 px in 12 px type: Limit with its size 550 px and Update with a chosen binary 552 px, each then More (48 px); Messages to you 519 px then More fits by 13; Per-session Direct 544 px, Browser › Profile 531 px and Exit when idle set to never 501 px fit with no More; these sentences run 5.5 to 5.9 px a character; a note ending in More is 22 px high.
- Observation: a note is one line only where the body has its 760 px, and a view about 520 px wide keeps a note column of about 150 px (the drawing, finding 4).
  Evidence: the rows stack by the whole view's width at 32rem; a 50/50 split with no side surface is above it.
- Observation: "Sessions and engine" does not fit the index; the index does not fit the dialog once Usage is there (the drawing, findings 5 and 7).
  Evidence: the heading is 116.0 px in an entry's 115; the index needs 675 px with eleven sections and 705 with Usage, against 695 in the dialog at the default window.
- Observation: results worded "<row> in <section>" wrap to two and three lines in 148 px, some read badly ("For in Notifications"), a group's name floods the list, and the first control of several rows acts on Enter (the drawing, findings 10 to 17).
  Evidence: "Stateful MCP servers in Background" is 204 px; "engine" matched 21 rows and 4 sections through the group's name; MCP servers' first control is a server's Remove.
- Observation: the `discover` group provisions and verifies engine 2.1.309, not the 2.1.322 P1 names; and 2.1.322's `mcp_authenticate` falls back to the engine's own `localhost` listener when the authorization server rejects a custom redirect, so P1 may legitimately answer `localhost` for a kind (M1).
  Evidence: `.github/workflows/gate.yml` provisions `scripts/provision-engine.sh 2.1.309`; `REAL_ENGINE_VERSION` in `e2e/support/real-engine.ts`; the fallback in `mcp_authenticate`'s handler of `~/claude-code-bundle/2.1.322/cli.pretty.js` (about line 614259); MAWS sends no `redirectUriOnly`.
- Observation: the engine's own lists disagree on a skill's name when its front-matter name differs from its folder's: the initialize answer's `commands` give the front-matter name, `system/init` gives the folder's, and the transcript's command line names the folder; so such a skill shows in the transcript under the folder's name, not the name Customize lists. Both names run it (P3).
  Evidence: `spikes/protocol-probe/findings-uxwave-u11-skill-names.txt` and its lists journal `u11-skill-names-lists.jsonl` on `ux-wave/probe3-u11`.

- Observation: a Channel tab opened again inside the 30 s release delay while the network is still off reads "Connecting…" until its socket next fails, up to 30 s later (§F's first row as written; for P4 to judge); and a wake that drops a socket not yet welcomed is told as `onClosed(1006)`, so it reads `unreachable` (M4).
  Evidence: `src/main/org/channel/channel.ts` (`open` calls `reconcile(true)` before `retain`; the release delay); `project-socket.ts`'s close on a wake.
- Observation: `test/support/tokens-guard.test.ts` reads an item id written `#` and three digits (`#505`, `#523`, `#540`) as a hex colour, so M2's and M3's comments and strings fail it (29 hits at `45a02d0d1`); M3's fix writes them another way.
  Evidence: M4's full-suite run at `0adbfd07c`, the only failure that is not on the brief's list or a load timeout.

- Observation: P1's verdict (2026-11-12, engine 2.1.322, runs 43357272365 and 43358963647 on the mini): both kinds promote as designed. For a server of MAWS's own list and for a plugin's server, `mcp_authenticate` with MAWS's redirect answers `custom`, the callback and the reconnect take the server's name (`plugin:<plugin>:<server>` for a plugin's), the status reads connected, and a later process reads it connected. `DYNAMIC_REDIRECT = { plugin: 'maws', own: 'maws' }`.
  Evidence: `spikes/p4-aggregator/findings-m4.txt`, the dated part "UX wave U11a, M1".
- Observation: a plugin's server is listed with scope `dynamic`, the same value as a server of the launch's own list, so a name starting `plugin:` is the only thing that tells them apart; and the engine suppresses a plugin's server whose address a file-configured server already names (or an earlier plugin's does), so such a connector never appears in a session's status. Nothing changes for the second in this landing; it bears on who is offered Sign in and on X-184's plugin rows. M8 checks §A's "Who offers Sign in" and `dynamicRefusal` against the first.
  Evidence: P1's second run (`before.scope` `dynamic` for `plugin:fx-plugin:fx-oauth`); its first run's debug line "Suppressing plugin MCP server … duplicates manually-configured …"; the function near line 476051 of `~/claude-code-bundle/2.1.322/cli.pretty.js`.
- Observation: on 2.1.322 a configured server reads `needs-auth` after `mcp_oauth_callback_url` until `mcp_reconnect`, so the spike's older questions `custom`, `cancel` and `pathA` list "the server did not report connected"; the operation already sends the reconnect (findings-m4, point 1).
  Evidence: P1's runs; `src/services/connectors/sign-in.ts`.

- Observation: `sessionSetKey` (`stores/org-projects.ts`) answers "not known" for a terminal session on another machine that is only listed (lane A, no record), though its listing names a hub project: it resolves a record-less listing only for lane B. M5's action resolves that case itself from the listing's project (ruled 2026-11-12; Decision Log); `sessionSetKey` is not changed, and for its other two callers today: (1) `ipc/events.ts`'s `projectOf`, the layout's filing of a session's tabs, treats such a tab as not known, so it opens in the tab set in front (`lane-a/remote-connect.ts` → `openSession`) and is never refiled into its project's set: it can stand in another project's strip; (2) `main/Tab.tsx`'s label calls it only for a session with a record, so it is not affected. The first can show the person a tab under the wrong project, so it is a tracker row with the pull request (Concrete Steps 6); nothing of it is fixed in this landing.
  Evidence: `sessionSetKey` (the `listing?.lane === 'B'` branch); `projectOf` in `ipc/events.ts` near line 381; `useSessionLabel` in `main/Tab.tsx`; M5's task review.
  Overtaken 2026-11-13 by the merge of U13a (`787fd7178`): one strip holds every tab, so there is no set to file a tab into, and U13a's `sessionRow` reads a record-less listing of either lane by its listing's row. The tracker row is dropped.

- Observation (the architect's e2e run 43359967651 at `8a6a631c2`): after Esc closes a sheet opened over a dialog from a menu item, focus fell to `body`: `useDialogFocus` (`app/dialog-focus.ts`) remembered the menu item as the sheet's opener, the item had left the document, and the dialog's paused focus scope does not take focus back. Ruled a product fix: when a layer closes with its opener gone and focus on `body`, nothing or inside it, focus goes to the topmost open Radix layer under it (`[role="dialog"]` or `[role="alertdialog"]` with `data-state="open"`; the hover card, comment cards and Overview also say `role="dialog"`, so they are not targets); with none, today's behaviour. Returning focus to the menu's trigger is the better target and changes every sheet opened from a menu, so it is a tracker row with the pull request.
  Evidence: `e2e/widgets.spec.ts` board 523 scene at its line 1102, both attempts; `app/dialog-focus.test.tsx` red at `2c2a8397f`.
- Observation (the same run): the composer harness connected the composer's slot and never the transcript's, so a `shell` pane's SessionPane drew C5's "Transcript unavailable" and `e2e/composer.spec.ts`'s edges scene found no transcript row. The harness page now connects the transcript slot with its others (`harness/composer/ComposerHarness.tsx`); the scene is unchanged. Of the two scenes that ask for a shell pane, `e2e/c7-shots.spec.ts`'s shows an unstarted session and never asks for the slot.
  Evidence: the run's page snapshot; `app/slot-fallbacks.tsx`.
- Observation (Mac run 43405665313 at `2f0fe04a8`): Radix's dismissable layer (1.1.19) arms its outside-press listener on a zero-delay timer scheduled from its mount effect, so a press straight after the layer draws can land before anything listens; the board 523 scene's press was flaky for that. And an e2e launch in mode `scenario` creates a New chat as a bare tab id with no setup intent, which every dialog reads as a started session; a scene about the time before the first message runs in mode `index`.
  Evidence: `e2e/widgets.spec.ts` (`layerTakesInput`; the New chat scene's `chatBackend`); `app/scenario-session-creator.ts`; `sessions/connect.ts`.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before an executor starts (done on 2026-11-12: needs-attention, three findings, all accepted and folded in below). Each milestone is reviewed at its boundary by the controller's reviewer before a milestone that consumes it starts. The branch gets `doperpowers:review-code` at the xhigh panel: it is expected to change about 112 files and 7,000 lines (about 60 product files, 40 unit-test files, 8 e2e files, 5 documents), well past the mark of twenty files or two thousand lines. The root calls nothing in U11 delicate; four parts still want a lens of their own: the sign-in's check, the configuration's revision and the wire (M8, §A and §H); the channel's reach and refusal (M4, §F's table); the backdrop where layers stack (M3, §E); and the regrouped Settings against the three `keep` items (M9). Class 1a on GitHub Actions (`static,unit,probes`) is the gate of record, run by the architect on the head handed back and again on the final head if the panel changed the branch. The pull request's body names its class 1a run, its review verdict and its residue, and carries the dated amendments of the five rulings this landing reverses.
  Rationale: the root's UC-10 and the common brief of the wave's execution documents. Rejected: a single reviewer, at this size.
  Date/Author: 2026-11-12, the author of this document; the sizes and the fourth lens revised the same day with the entries below.
- Decision: point 1 stands. The new command's `name` is 1 to 128 characters; the progress event keeps its bound of 128 and loses the configured-name rule.
  Rationale: the bound is on the wire's manifest and moving it is a major. Rejected: 256 characters as the section wrote it; a second event for dynamic sign-ins (two events for one operation, to spare a reader that could never have started it).
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 2 stands and is not enough alone. A press from Customize names its entry; what it names it by is settled by the review's first finding, below.
  Rationale: the renderer never holds an address, so the services must do the comparing. Rejected: sending the address with the press.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 3 stands. Until U9 has landed the new command is declared in `REMOTE_UNAVAILABLE`, with the words of §A.
  Rationale: the coverage test admits no undeclared command, and the update sentence of UC-7.5 would be untrue while no machine offers it. Rejected: an offer row in U9's files before U9.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 4 stands. The description of `/mcp` changes at two places of U4's `composer/mentions/`, for that one name; §I names U4a's edits of the same two files.
  Rationale: the engine's description wins once its catalogue arrives. Rejected: changing the declared description alone, which shows only before the chat starts.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 5 stands. `<place>` is the section's rule, and P2 says whether a worktree session reads its own folder.
  Rationale: law 6: the engine's key for a linked worktree was read, never seen. Rejected: always the folder's path, which drops the project's name where it is right.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
  Addition (2026-11-12, the wave's architect, on P2: engine 2.1.322, MAWS's launch, scratch config home; branch `ux-wave/probe3-u11` at `7f3f6c692`): from a repository's root, a linked worktree beside it, one under `<root>/.claude/worktrees/` and a subfolder, `disabledMcpServers` is written only under the repository's main root, and a new session in any of the four starts with the server off (16 of 16 pairs, two runs; fixtures `u11-connector-place-*-toggle.jsonl`, both toggles answering success at seq 27 and 29, both servers reading disabled at seq 31); outside a repository the key is the session's own folder exactly. So the project's name stands and a worktree session does not read its worktree's folder; the fallback is corrected to the main root of the repository holding the folder, and the folder only outside a repository or where the main root cannot be read (§C).
- Decision: point 6 stands. "Use in chat" before the first message inserts the two forms of §D once P3 confirms them.
  Rationale: the code today treats a skill's name on disk as unverified. Rejected: inserting unverified names; offering no "Use in chat" at all, against A4.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
  Addition (2026-11-12, the wave's architect, on P3, same probe branch): a person's and a project's `/<name> ` with the inventory's name is confirmed in both variants. A plugin's form with the key up to its `@` fails silently when the plugin's manifest name differs from its marketplace entry's (2 of 2; fixtures `u11-skill-names-p3u-entry_p3u-mani-skill.jsonl`, which runs nothing, and `u11-skill-names-p3u-manifest_p3u-mani-skill.jsonl`, which runs the skill); the engine names a plugin by its manifest. So `<plugin>` is the manifest's `name`, carried on the inventory's skill row as the optional `pluginName` in this landing's one minor, and a plugin skill without it has no "Use in chat" (§D, §H). Rejected: checking the form against the engine's list once the chat starts, which leaves the unstarted tab, the case this item is for, without the check.
- Decision: point 7 stands. The `machine-admin` line names what a holder can do over the link.
  Rationale: the offer table gives the right nine acts, all on connectors. Rejected: the child's line, which names settings, plugins and restarts that are graded and not offered.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 8 stands. (a) §B's details table covers every reason of both sheets. (b) `storage`'s line does not say that nothing was sent. (c) The two enroll lines are as the child words them.
  Rationale: (a) A8 fails otherwise. (b) The reason is also given after a delivery. (c) The row's Show… opens the sheet that has Start over. Rejected: (a) hiding only the four details the item names; (b) the child's clause; (c) a second wording for the rows, for one edge.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 9 stands. U10's document confirm takes the value in its own CSS; `keymap/KeyboardShortcuts.tsx` and the two files of #456 are named insertions.
  Rationale: "every sheet and dialog" includes them. Rejected: leaving the confirm at its old wash; one export from `live.ts`, which cannot tell the not-offered pause from the two where Allow stays.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 10 stands. The footer under a scroller clips, and the transcript's gutter is scoped from the session pane.
  Rationale: `scrollbar-gutter` acts only on a scroll container; a class on the shared scroller would reach every transcript. Rejected: a token in U3's `Transcript.tsx`; a measured padding by script.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 11 stands. The greyed menu item says nothing and the palette's row says the sentence; the row takes no rebinding yet; it stands after the Tabs rows.
  Rationale: the menu has no place for a sentence, and U6a's guard is the wave's rule. Rejected: a toast on a press of a greyed item; an alias in U6's `menu.ts` to seat the row beside Artifacts.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: point 12: (a) to (c) stand; (d) is replaced by the drawing's measurements (below); (e) if a later landing adds rows for a default model and mode, they sit under Engine, and nothing is built here.
  Rationale: (e) Sessions' heading line says the person's Claude Code settings files are not changed. Rejected: (a), (b) storing the new section as `engine`, for which there is no caller; (e) the child's "they join Sessions".
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: the later landing for a session on another machine is U11f.
  Rationale: the design of the owner's answered items already uses U11b to U11e. Rejected: U11b, as this document first had it.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: the wire's minor is taken, and the generated files are made again, against the final merged master: at M8, at M11, and by whoever merges last.
  Rationale: U3a has raised the minor to 37, and U1a, U4a, U8b and U12a raise it too. Rejected: taking the number once, after the merge of Concrete Steps 1.
  Date/Author: 2026-11-12, the wave's architect (the ruling); the author of this document (the fold).
- Decision: a press from Customize carries the revision of the configuration its row showed, and the operation refuses a changed entry before it asks anything of the engine (§A, "The configuration's revision"; M8).
  Rationale: the review's first finding: the fingerprint never left the renderer, so a row read before its entry was replaced under the same name could sign in the replacement. The engine host makes the revision because the services and main both already read its endpoints, and one read then serves both comparisons. Rejected: main checking its own fingerprint before it forwards the press (a check at the door, and a gap before the operation's own); an unkeyed hash of the address (a known address could be confirmed from the renderer); a key shared between main and the services (a stored secret for one comparison); replacing main's fingerprint with the revision (it would change when a file-scope row shows a finished result).
  Date/Author: 2026-11-12, the adversarial reviewer (the finding); the wave's architect (accepted); the author of this document (the fold).
- Decision: the channel tells the hub's refusal of it as its own field, `refused`, and the footer reads it before reach (§F; M4).
  Rationale: the review's second finding: after `unreachable`, a close that ends the channel leaves it parked with nothing retried, while the org's hub status can still read healthy, so "Offline · retrying" would stand for good. Rejected: clearing reach at such a close and falling to "Connecting…" (as untrue); reading the org's hub status alone, which another component keeps.
  Date/Author: 2026-11-12, the adversarial reviewer (the finding); the wave's architect (accepted); the author of this document (the fold).
- Decision: where modal layers stack, the top layer's backdrop paints and the ones under it are clear (§E, `useScrim`; M3, with its scene).
  Rationale: the review's third finding: the Plugins dialog and its confirmation each paint the value, about 15% together. Rejected: the bottom layer alone painting (the dialog under a sheet would not read as behind it); a darker single value chosen to look right when doubled.
  Date/Author: 2026-11-12, the adversarial reviewer (the finding); the wave's architect (accepted); the author of this document (the fold).
- Decision: a row made at run time is drawn from a declared repeating row, and "every drawn row is declared" is tested with the page populated (§G; M9).
  Rationale: the review's note: `BrowserImport.tsx` makes profile and extension rows, and a test over an empty installation would not see them. Rejected: leaving such rows outside the table, which the search and the test would then both miss.
  Date/Author: 2026-11-12, the adversarial reviewer (the finding); the wave's architect (accepted); the author of this document (the fold).
- Decision: a note that fits its line keeps its words; only Limit with its size and Update with a chosen binary move their last clause behind More. `NOTE_LINE_MAX` is gone; the bound is the measured width, proved by the e2e scene (18 px, or 22 px for a note that ends in More or carries a button).
  Rationale: the drawing, findings 1 to 3: of seven lines thought too long two run over, and a count of characters misjudges both ways. Rejected: the four cuts this document first made (a More holding one clause); shorter words in place of a cut.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: "one line" is claimed where the body has its 760 px; the rows stack by the body's own width, under 32rem of it; U7's dialog is asked for 948 px (§G, "The measure" and "For U7").
  Rationale: the drawing, finding 4: a view about 520 px wide is above today's break and leaves a note column of about 150 px. Rejected: claiming one line "at the default window" without the condition; moving the index's break as well.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: a group heading is 12 px semibold `fg-muted` on one line, and the middle group reads "Sessions & engine".
  Rationale: the drawing, findings 5 and 6: "Sessions and engine" is 116 px in 115, and `fg-faint` is 2.6 to 1 on the index in light. Rejected: a heading that wraps; `fg-faint`.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: Org stands without a group heading until the owner answers; the other answer, a group of one, changes `INDEX.groups` and Org's entry in `SECTION_TABLE`.
  Rationale: the drawing, finding 8: "Org" under "Org" reads as a stutter. Rejected as the default: the group of one, which this document first built.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: the section for the supervisor and the memory budget is named "Supervisor" until the owner answers; the other answer changes the one string `SECTIONS.supervisor`.
  Rationale: the drawing, finding 9: "Background" is also the first word of a session's "Background work" surface and its key binding. Rejected as the default: "Background", the child's name.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: the index's list scrolls by itself and its footer stays.
  Rationale: the drawing, finding 7: with U7's Usage the index needs 705 px of the dialog's 695. Rejected: letting the footer yield.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: the search is settled under four rules (§G): the chosen row takes the keyboard and no control of it does; a result never names text the page will not show now; a result is the row's name with its section under it, on two lines at most, in a list that scrolls with the index; a row is not matched by its group's name. Also: "mcp" finds the Customize link; the query stays and the child's "one keystroke away" is dropped; the row lands under its section's heading; the first result is preselected; the mark is `bg-bg-active`, 8 px around the row, for 1,600 ms; the narrow form has the field as a first row with its results under it.
  Rationale: the drawing, findings 10 to 17. Rejected: "<row> in <section>" (two and three lines in 148 px; "For in Notifications"); focus on the row's first control (Enter twice would remove a server); matching a row by its group (21 rows for "engine"); searching every state's More (a result that opens a More without the word).
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: Direct login's sign-in instruction and its Copy button keep their place on the row's line.
  Rationale: the drawing, finding 18: the child's row did not place them; together with the sentence they are 401 px. Rejected: moving the instruction behind More, where the one thing the row lets a person do would be hidden.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: "More" is drawn in `fg`, and the line under Sessions' heading sits under it, 12 px in `fg-muted`.
  Rationale: the drawing, findings 19 and 20: a muted "More" after a muted sentence does not read as a button; the only earlier hint sits beside its heading, where this line would not fit. Rejected: `TEXT_ACTION`'s muted colour; the line beside the heading.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).
- Decision: the drawing's findings 21 to 24 are noted where they change a stated height or width (§G, "The measure"; "The owner's look"); nothing is built for them.
  Rationale: the waiting supervisor's five lines are a state that stays whole; "More" alone on a line in a narrow pane is accepted; the dialog has twelve sections once Usage is there; the narrow width is 330 px and holds only beside a side surface. Rejected: cutting the state's lines.
  Date/Author: 2026-11-12, the wave's architect, on the drawn page's findings; the author of this document (the fold).

- Decision: M1's plugin question gives the scratch plugin with `--plugin-dir`, not a marketplace install; the two questions run after the seven with names of their own (`fx-own`, `plugin:fx-plugin:fx-oauth`); each reconnects at once after an accepted callback, as MAWS's operation does; the spike case alone can run another engine through `MAWS_SIGNIN_SPIKE_ENGINE_BIN`, and `scripts/engine-checksums.txt` gains the 2.1.322 darwin-arm64 line so `provision-engine.sh 2.1.322` can fetch it; the case's timeouts rise to 900 s and 840 s.
  Rationale: in 2.1.322 both plugin routes name the server `plugin:<plugin>:<server>` with scope `dynamic` and key its credential the same way, and `--plugin-dir` has fewer steps that can fail before the question; P1 must read 2.1.322 without moving the group's 2.1.309 pin for its other cases. Rejected: changing the group's engine pin; a marketplace install.
  Date/Author: 2026-11-12, M1's executor; folded by the controller.

- Decision: M2's sheets hide main's detail by a list of the reasons whose detail repeats the line, so a reason main gives no detail today (grant `signed-out`, `damaged`, `cancelled`) shows one if main ever adds it; one small `ReadState` component draws "reading, or the read's line with Retry" for the nobody state, the picker branch and the re-grant sheet; A8's machine-row lines are proved through the drawn rows in `MachinesGroup.test.tsx`.
  Rationale: §B's details table says "a reason main gains later shows its detail until the table says otherwise", and a list of hidden reasons keeps that true for a reason that gains a detail. Rejected: a list of shown reasons.
  Date/Author: 2026-11-12, M2's executor; folded by the controller.

- Decision: M3's backdrop is `sessions/scrim.tsx`: beside `useScrim` it exports a `Backdrop` element that each overlay renders through Radix's `asChild`, so a backdrop counts as a layer exactly while it is mounted; in another child's file each edit is an import and that element.
  Rationale: a hook called where those overlays' components sit would count a closed dialog as a layer. `useScrim`'s name and answer are §E's and unchanged.
  Date/Author: 2026-11-12, M3's executor; folded by the controller.
- Decision: names give way by grow weights a thousand apart (alias, then chip, then labels, then title), each part starting at its minimum, in place of §E's shrink weights; `Party` becomes `display: contents` so one order runs across the row; the chip's 24-character cap sits on the chip; recipients keep their 12-character floor; host rows and an opened exchange's lines use the same name row.
  Rationale: §E's own pitfall: with `flex-wrap`, shrink weights wrap the row before any name shrinks. The order and the minimums are §E's; only the means change. The 420 px e2e scene is the proof.
  Date/Author: 2026-11-12, M3's executor; folded by the controller.
- Decision: in the Channel, 8 px of the stream's foot padding moves to the clipping footer so the composer frame's ring and near shadow are not cut; a compact session pane (no transcript above its composer) takes no composer gutter.
  Rationale: `.scroll-gutter-under` clips (§E), which would cut the frame's ring at its edge.
  Date/Author: 2026-11-12, M3's executor; folded by the controller.

- Decision: M4's readings of §F's table where it leaves a case open: a session change is the session value object changing (`org-session.ts` rebuilds it exactly when the org, member, device or credential changes), not every adopted head; clearing a refusal starts reach again at `connecting`; "a released channel opened again" is an open while no tab holds it (inside the release delay); a close after the welcome but before caught up leaves reach unchanged; a failed attestation read moves reach only while its hub is still the session's; at caught up the internal reach resets, so a stale `unreachable` cannot leak into a later not-live state; the Sign in button goes with the footer's ended-sign-in row and no longer shows beside "Signed out". In main the per-channel state is `standing` (the name `reach` stays the network path's) and `ended` names the refusal (`'credentials' | 'removed'`) in place of `'parked'`. `src/main/org/org-session.test.ts` (UC-8: nobody's) takes one expected answer.
  Rationale: each is the row of §F's table that holds most nearly, chosen so a word never stands that the channel no longer means. The e2e scenes (three, one launch each, with the org's hub status `connected`) cover the case S-09 is about.
  Date/Author: 2026-11-12, M4's executor; folded by the controller.

- Decision (M3's review, fixed): a row's names and the words between them ("and", "to everyone") are one group, `Names` in `channel/parts.tsx`, that never wraps and enters its line at the sum of its parts' minimums; the row wraps around it, so the fixed parts after the names move under them and the names never split. A part's minimum is a `width` (`w-[12ch]` for an alias, `w-0` for the others), not a flex basis, so the group's min-content is that sum. Below about 200 px the group overflows rather than cutting an alias under 12 characters. An exchange row's chevron and count stay before the names; where even they and the names' minimums do not fit, the names go under them. The e2e names check measures each part under its own `max-width`, so a chip cut at 24 characters has not given way, and a wide-row case exercises that check.
  Rationale: the task review: an unrestricted `flex-wrap` over fixed words and names alike broke between the aliases while the prefix stayed, which is §E's pitfall one level up; and the first oracle failed a correct row whose chip was capped.
  Date/Author: 2026-11-12, M3's executor on the task review; folded by the controller.
- Decision (the architect's ruling): a board id is never written as `#` and three or six hex digits in this branch's files (comments, test names, strings); M3's fix wave rewrote every one the branch had added as "board NNN" in 34 files, and `test/support/tokens-guard.test.ts` stays as it is.
  Rationale: the guard reads such an id as a colour literal, and its rule is right.
  Date/Author: 2026-11-12, the wave's architect; applied by M3's executor.

- Decision (M3's second review, fixed): a person's directed message is a `words` entry (it names a member, with no session title or machine chip), not one of §E's say, exchange or to-human rows, so it keeps its layout and the e2e names check finds its rows by their alias part; a row that names a session without the `Names` group is still a fault, and the scene asserts a directed person's message is present at each width.
  Rationale: §E's order governs the rows that name a session.
  Date/Author: 2026-11-12, M3's executor on the task review; folded by the controller.

- Decision: the owner's three answers on the drawn Settings page (P5). (1) Settings begins with the everyday preferences, the engine last ("Preferences first"). (2) Org has no group heading of its own in the index ("No heading"). (3) The section that holds the supervisor and the memory budget is named "Supervisor". Each is the answer §G and M9 were written to, so nothing in §G changes.
  Rationale: the owner's call on the page the architect drew and measured (The owner's look).
  Date/Author: 2026-11-12, the owner (relayed by the wave's architect); folded by the controller.

- Decision: M5's means. U6a's two settings-tab tests that held every row to a Change control now loop over build F's ids and also assert `channel.open` shows none (both files are this child's). The rule "has a channel" is held equal to both sidebar menus by a DOM test that opens each row's real menu (`channel/has-channel.test.tsx`). `channelOfRow` does not check that the row is listed while `channelProjects` lists listed rows only, so a hidden project gets no palette entry but a session in it can still use the menu action. Two rows of one project id make one entry; entries are in name order. Only session and Channel tabs give the front a project; a Channel tab in front keeps the action enabled. An unstarted tab's project is read with `ipc/events.ts`'s intent closure, without its "machine not loaded" gate. The palette hook and the opener live in `channel/open-action.ts`, so `project.ts` stays pure. Entry elements are marked `data-channel-name` and `data-channel-count`.
  Rationale: each follows §F and keeps M5's edits in U6's files to the named insertions.
  Date/Author: 2026-11-12, M5's executor; folded by the controller.
- Decision (M5's review, ruled by the architect 2026-11-12): a session tab with no record but a listing takes its row from `rowOfListed(index, listing)`, the row the sidebar files the listing under, and from the listing's `orgKey` where every checkout of its project here is hidden (as `setKeyOfListed` does for lane B); every other session tab goes through `sessionSetKey`, which is not changed.
  Rationale: a terminal session on another machine known only by its listing (lane A) is a session tab of a project with a channel, and `sessionSetKey` resolves a record-less listing only for lane B. Rejected: editing `stores/org-projects.ts`, outside M5's insertions (its other callers' gap is residue).
  Date/Author: 2026-11-12, M5's executor on the task review; the wave's architect (the ruling).

- Decision: M6's means. The row is `ConnectorRow` (exported from `widgets/McpWidget.tsx`: `server`, `words`, `control`, `actions`, `opened`, `under`); it opens through a button with `aria-expanded`, not `<details>`, and its opened part is drawn only while open. `<place>` reads the main root through the existing `git.worktree.list` (home abbreviated); any failed read, and a session on another machine, falls back to the folder, and no sentence is drawn while the read is out. The terminal session's dialog takes the "MCP servers" subtitle and no head sentence (its switch is the terminal's `/mcp`). Sign in sits on the row's line and its progress line under the row, beside the toggle's and the reconnect's answer. The head's note may wrap, so a long path is not cut. In `composer/mentions/items.ts` a one-entry map lets only `mcp`'s declared description win. The "+" › Connectors submenu's rows take `connectorStatusWords` in M7, through its `widgets/` hook.
  Rationale: §C's row and words, with the controls outside the disclosure (M6's second decision); the submenu's rows are M7's by the Constraints table.
  Date/Author: 2026-11-12, M6's executor; folded by the controller.

- Decision (M6's review, fixed): the dialog's switch stays disabled until the head's sentence of what it reaches can be drawn (`reachSaid`, the same `place !== null` that draws it); Reconnect does not wait. A failed main-root read falls back to the folder, so the sentence then shows and the switch enables.
  Rationale: the sentence is the switch's disclosure; a switch usable while it is still out would let a person turn a connector off for every session in a place without being told.
  Date/Author: 2026-11-12, M6's executor on the task review; folded by the controller.

- Decision: M7's means. `useTabPlace` reads the two stores `useSetupIntent` rests on without calling it, so no model or trust read reruns per dialog, and answers a started place for an id it does not know. The "+" › Connectors submenu reads the inventory only while the menu is open (`enabled: open`); `useCustomizationInventory` has a 30 s stale time, shared with Customize through the unchanged key. A started session that is not ready keeps "Live details are unavailable…" in the Connectors submenu; only the Plugins submenu's sentence goes. The submenu's pending line is "Reading configuration…", and a failed read shows the read's own message. An unstarted Connectors row opens onto its transport and its configuration file. The engine host reads a plugin's manifest before its skill folders, and `pluginName` is null when the manifest is absent or unreadable or its name is not a non-empty string of at most 256 characters without whitespace, control or format characters. The unstarted Plugins dialog draws `LibraryBody` with no session and a `NotObservedLine`, so nothing reads a record-less id's observed facts; Open Discover with no folder opens the user configuration's page. `InventoryState` moves to `customize/InventoryState.tsx`; Customize's disk groups are built by `diskSkillGroups`. `harness/composer/EditorHarness.tsx` (nobody's) wraps its `PlusMenu` in a QueryClientProvider, as the two unit tests that render it do, because the menu now holds a query. The wire's minor is 37 (master's was 36).
  Rationale: §D's states with no second read of what a dialog already holds; the manifest's name is what the engine names a plugin by (P3).
  Date/Author: 2026-11-12, M7's executor; folded by the controller.

- Decision (M7's review, fixed): one `plugins.changed` listener per query client invalidates the inventory's key, registered the first time any reader renders, so a cached answer is marked stale whether or not a reader is mounted or may fetch; a disabled reader starts no read until it is enabled again.
  Rationale: with the listener tied to an enabled reader, a plugin installed from the unstarted Plugins dialog left the closed "+" menu's or Skills' cached inventory fresh for up to 30 s, so a removed skill could still offer "Use in chat".
  Date/Author: 2026-11-12, M7's executor on the task review; folded by the controller.

- Decision: M8's means. The services read `customization.serverEndpoints` with `{ cwd: null }`, and only for a press that names an entry; `dynamicRefusal` keeps only `scope === 'app'` entries of that answer, so a file entry of the same revision does not count. The revision's key is 32 random bytes made when the engine host's module loads (`configurationRevision(key)`, the form of main's fingerprint). Customize's own-list row with no revision draws neither Sign in nor "Open a session, then sign in". The dialog greys a dynamic row through `connectors.signInDynamicServer` and a file-scope row through `connectors.signInServer`. One bound, `signsInDynamic` (128 characters), serves the dialog and Customize. The mini's scene is its own `dynamic:` case in `e2e/discover-connectors.spec.ts`, with a second fixture for the plugin and a second own-list server (`fx-own-2`) signed in from Customize. The minor stays 37 (Concrete Steps 4).
  Rationale: §A's check reads MAWS's own entries now, once, where the act runs; a plugin's server and an own-list server are both scope `dynamic` (P1), so the entry comparison is limited to the own list.
  Date/Author: 2026-11-12, M8's executor; folded by the controller.

- Decision: M9's means. Each row's words live in `copy.ts` as its `states`, and `rows.ts` builds `SETTINGS_ROWS` from them; the old note keys go. `Setting` has a declared form (`row`, `state`, `values`, `label`, `lineEnd`) and a plain `label`/`note` form for the Org page, whose rows the table does not hold. A value inside a line is written `{name}`, and one not yet known reads "…". A registry in `settings-tab/drawn.ts` lets each drawn row tell the view its id and state (`useShownRows`, for M10). `Section` moves to `parts.tsx`, so the supervisor's group gives the keyboard to its section's heading by id. The Keyboard section's table and its reset are declared rows. The auto fallback test moves unchanged into `SessionsSection.test.tsx`, and `LaunchProfileSettings.test` renders `SessionsSection`; no assertion on what is written or sent changes. One regex of U12's `delivery/SendToSheet.test.tsx` changes `Engine` to `Sessions`: that test pins the sentence of `delivery/copy.ts` M9 is told to change. `e2e/supervisor.spec.ts` needs no edit (the group keeps its name); `e2e/cross-build.spec.ts` has no settings scene on this branch (U13a's comes with its landing, P7). The e2e bounds are 18.5 px for a line and 22.5 px for a line that carries a button.
  Rationale: one declaration per row, so the page, the search (M10) and "every drawn row is declared" read the same table.
  Date/Author: 2026-11-13, M9's executor; folded by the controller.

- Decision (P7's second run, 43386195217 at `8feaa7a7f`, accepted by the architect): Customize's row of MAWS's own list counts the attached session as listing a name when its `session.mcpStatus` answer lists it, unioned with the store's list; other ready sessions keep the store's list (`customize/connectors/ConnectorsSection.tsx`; `d1a728e44`, `055ce03bf`, `3b4ff61b7`, reviewed clean). §A's sentence stands: its check is "the session's mcp_status lists…".
  Rationale: the store's `EngineSessionStatus.mcpServers` is filled only from `system/init`, so a ready session before its first turn listed nothing and the row read "Open a session, then sign in" beside a live list that showed the server needing sign-in. A ready session that is not the attached one and has had no first turn is still not found; it is ticket 619, with U8's Connectors card that reads "Not reported" before the first turn for the same reason. Rejected: an `mcp_status` read per ready session.
  Date/Author: 2026-11-13, M8's executor on P7; the wave's architect (accepted).

- Decision: M10's means. `settings-tab/SettingsSearch.tsx` holds the field, the results, where a result lands, the scroll rule and the mark. A result's target is a row id, `section:<s>`, `binding:<id>`, `org:<heading>` or `customize`. The Org page's groups register as drawn (`useDrawnGroup`), so a group the page does not show is no result; key-binding results stand after the `keyboard.bindings` row and only while it is drawn. Each word of the query must appear in the row's words, case ignored; a match only in the More the row shows now opens that More; `{name}` places are not searched. A hidden row adds its label and keywords to the nearest drawn row that reveals it; a repeating row not drawn is one result landing on its revealer. The field keeps the keyboard while Up and Down move through the results (options are not focusable; a click chooses). A row the search lands on takes the keyboard through `tabIndex={-1}` with a `focus-visible` outline; the mark is a `data-settings-mark` attribute, 8 px of `--bg-active` as a box-shadow. A More is opened by its button under `flushSync` before the row is measured. ⌘F is ⌘ alone on F, and only from the view's own DOM, so a sheet opened from Settings keeps it; `src/shared/keymap/` is not touched. The field's text is `text-ui-sm` so "Search settings" fits the 148 px index.
  Rationale: §G's four rules; a search that reads the page's own drawn rows finds only words the page shows now.
  Date/Author: 2026-11-13, M10's executor; folded by the controller.

- Decision: in the record, the child's sentence "UX wave U11 (#505): …" is written "board 505", and M5's tab opener is `openProjectChannel`.
  Rationale: the token guard reads `#` and three hex digits as a colour (the architect's rule); the RL2 boundary guard (`src/main/machines/remote/boundary.test.ts`) scans main and the renderer for `openChannel(`, the remote module's call, and its allow-list is for real machine paths, so the name moved, not the guard (the architect's ruling).
  Date/Author: 2026-11-13, M11's executor and the wave's architect; folded by the controller.

- Decision (the branch panel, wf_feaae2f7-bcf over `c0e7b2ae8..0833f126d`, finding 1, the architect's ruling): an unstarted tab's `/skills` lists a skill whose plugin is off for the chat, with "Use in chat" disabled and its reason ("Off in the sessions MAWS runs: Settings › Sessions › Plugins in sessions"); off is read from `engine.launchProfile.plugins.off`, the one source the launch uses (`2eccce051`). The other offers of an invocation: a started chat's `/skills` reads the session's own dialog, which lists no plugin that is off; Customize › Skills offers no "Use in chat"; the slash palette and the `@` menu read the session's catalogue; the agents widget inserts agents. None of them needs a change.
  Rationale: the inserted command named a skill the engine that then starts cannot load (`profileSettings` writes `enabledPlugins[id] = false`). Rejected: a second rule for "on".
  Date/Author: 2026-11-13, the wave's architect (the ruling); the fix wave's executor; folded by the controller.
- Decision (the panel, finding 2, the architect's ruling): the search's selection is held by result id, so a query change that leaves the results the same (a trailing space) keeps it, and one effect reveals the selected result whenever the selection or the results change. A unit case holds the sequence, and M10's narrow scene gains the step.
  Rationale: a reset to the first result with no reveal left Enter choosing a result out of view.
  Date/Author: 2026-11-13, the wave's architect (the ruling); the fix wave's executor; folded by the controller.
- Decision (the panel, finding 3, the architect's ruling): a change that arrives during a read is owed a read after it, through one shared hook, `useReadAfterPluginsChange`, which both `usePluginsRead` and `useCustomizationInventory` use; the inventory's client-wide listener only marks answers stale (`refetchType: 'none'`), so one change costs one read. `usePluginsRead` now finds its read in flight by the query's own hash (before, another machine's read of the same folder also counted).
  Rationale: with TanStack Query 5.104.0 an invalidation of a query in its first flight is cleared by that flight's success, so a `plugins.changed` during the first read was lost for the 30 s stale time. Amended the same day (the task review of the fix wave): the hook was observer-scoped, so a change that landed while its reader closed or unmounted mid-read was still lost; the owed read is now the query's, kept per query client in `widgets/plugins/after-change.ts` (each flight records the change count at its start, and a flight older than the last change leaves the answer invalid), and it goes through an enabled reader's own observer, since the client's refetch would run a `skipToken` follower's options. `useReadAfterPluginsChange` is gone.
  Date/Author: 2026-11-13, the wave's architect (the ruling); the fix wave's executor; folded by the controller.
- Decision (the task review of the panel's fix wave, Important): an open skill detail is derived from its row as the list has it now, held by the skill's key, so its "Use in chat" follows the row's availability, and the detail leaves when the skill goes; a skill that comes back does not reopen it. The parent hears the detail's visibility from one layout effect, and no state is set inside an effect.
  Rationale: the detail held a snapshot of the row taken at the click, so a plugin turned off or on while it was open left its button in the old state.
  Date/Author: 2026-11-13, the fix wave's executor; reviewed clean; folded by the controller.
- Decision (the same review, Minor, fixed): while Settings has not been read, a plugin's skill in an unstarted tab's `/skills` has no "Use in chat" and reads "Reading Settings › Sessions › Plugins in sessions…"; a project's and a person's skill need no settings and stay usable. The disk list says which it holds by type (`DiskSkillUse`: known or unread). `usePluginsRead` loses its unused `shown` parameter, so `machine` moves up one place; every caller passes only the command and the folder.
  Rationale: an unread settings file was read as an empty off set, which offered every plugin's skill as usable.
  Date/Author: 2026-11-13, the fix wave's executor; reviewed clean; folded by the controller.
- Decision (Mac run 43405665313's two findings, both scene faults): the New chat scene of `e2e/widgets.spec.ts` runs in launch mode `index`, where New chat goes through `session.create` and leaves a setup intent, and reads "nothing started" from that intent and the session list; in mode `scenario` the tab was a bare id that every dialog read as a started session. The board 523 scene presses Esc and outside the confirmation once its layer takes input (focus inside it, then one timer turn), because Radix's dismissable layer 1.1.19 arms its outside-press listener on a zero-delay timer after its effect.
  Rationale: neither failure was the product's; the scene's fixture and its timing assumed what the app does not promise.
  Date/Author: 2026-11-13, the fix wave's executor; reviewed clean; folded by the controller.
- Decision (P7's second half, U13a's cross-build "settings, both ways" scene, the coverage row of "Constraints"): no edit. On this build `settings.open` draws every section in one body, Appearance stays a region by its heading, and the idle textbox keeps the sentence 'Minutes before the supervisor exits when idle' as its name, so the scene's locators find both rows on either build. The scene is this landing's from the merge on.
  Rationale: the row moved from Engine to Supervisor inside the same page; neither locator names Engine.
  Date/Author: 2026-11-13, the controller.
- Decision (after the merge of U13a, §F's "when the merged master has it"): View › Project channel reads the tab in front of the one strip (`frontChannel(strip)`), and a session tab's row through U13a's `sessionRow`, the row the title bar's chip names; M5's own intent reading and its lane A branch go, since `sessionRow` reads a record-less listing of either lane and an unstarted chat's intent. The action re-syncs on the layout and on `subscribeSessionRows`. Two consequences: the action stays unregistered until the session's machine has answered in this run (a test holds it), and a listing with no project row falls back to its machine's key, which names no channel. The test fixtures mark both machines loaded; no assertion changed (`47480e042` red, `9f2268573`).
  Rationale: tsc web failed at `787fd7178` (`activeTab` takes the strip); one computation of a session's row keeps the chip, Customize's page and the Channel action on one answer.
  Date/Author: 2026-11-13, M5's executor; folded by the controller.

## Outcomes & Retrospective

(2026-11-13, the controller, at hand-back; the branch review and class 1a are the architect's and refresh this.)

**What exists.** All ten items are built on `ux-wave/U11a`, M1 to M10 each reviewed clean at its boundary, M11's record, merge and whole checks done. A connector a plugin brings or one of MAWS's own list offers Sign in from the Connectors dialog of a session MAWS runs on this Mac, and Customize's own-list row signs in the configuration it showed or nothing (§A; P1 promoted both kinds as designed). The Connectors dialog is one line per connector with the switch's reach said once; a New chat lists its plugins, connectors and skills before the first message; Settings is regrouped with one line per note and has a search; the Org sheets name their next steps; one scrim dims the window however many layers stack; the Channel lines up, cuts names in one order, says offline or refused, and opens from the palette and the View menu.

**Proved on a Mac (the architect's runs).** e2e:settings at `9412a40e1` and `85b190c73` (the Channel's scenes; M9's three-width measure at 18.5 and 22.5 px); e2e:widgets 30/30 and e2e:composer 26/26 at `0be74a6ea`; e2e:discover at `e186cb343` (M8's real-engine sign-ins, no Keychain prompt). Open: e2e:settings for M10's search at `2f0fe04a8`; P4 (offline Channel); P7's cross-build half (U13a not on master); the `c11-live` step at a live sitting.

**Against the purpose.** The four surfaces stop getting in the way in the ways Purpose names; the Mac runs found five scene faults and three product faults the unit tests had missed (focus after a sheet over a dialog, the attached session's init-only server list, a refusal cleared by a second tab's open, the last found by review). Each became a rule in one place rather than a patch at one caller.

**Lessons.** A Mac run caught what jsdom could not every time it ran a new scene; scenes written blind need their selectors exact and their locators relative from the start. A text guard (`boundary.test.ts`, `tokens-guard.test.ts`) is invisible to a milestone's scoped proof; the one whole-suite run per landing is where they surface, so a landing's names and ids should be chosen with the repository's guards in mind. Holding one builder at a time in a shared checkout cost some waiting and no collisions.

**Residue** is Concrete Steps 6's list; ticket 619 holds the card's "Not reported" and a non-attached session before its first turn.
