# P4-AGG execution report: Discover across Skills, Connectors and Plugins (2026-10-25)

Spec: `docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md` (the living record: Progress, Surprises & Discoveries, Decision Log 4 to 17, Outcomes & Retrospective). Branch `p4-discover`, off master fbeb2ceb6. This report is the executing session's account at hand-back, before the architect's branch review panel.

## Status

DONE_WITH_CONCERNS. All five milestones are built, reviewed clean at their frontier and ticked. Acceptance 1 to 12 pass against the real 2.1.309 engine on the Mac mini. The whole Mac matrix is green. The concerns are things only others can close: the held `gate.yml` change, the charter's egress line, and an owner-taste pass on the screenshots.

## Milestones, commits and gates

| Milestone | Commits | Task review | Gate evidence |
|---|---|---|---|
| M1, the real-engine harness and fixtures | 0df1e2398, fix 95b775f2f | clean after 1 fix wave (Keychain custody failed open) | class 1a 40154912725; e2e:discover 40154941453 (2/2) |
| M2, the catalog | 9e6309756, e711484d7; fixes f56a44c6a, 882a8c838 | clean after 2 fix waves (identity across sources, cold-start installed state, in-flight revision race, partial manifests, no outside-change invalidation; then chosen-route components, LRU eviction) | class 1a 40163330358 |
| M3, Discover for Plugins and Skills | aa428cb2c..594f7291a; fixes cecae1595..5ca41695b, e232a394d | clean after 2 fix waves (view-lifetime invalidation, abandoned two-step install, Featured feedback, skill names, icon freshness; then a worktree's exact cwd, live spec navigation) | 40174394148: class 1a, e2e:discover 6, widgets 29, layout 14; settings 12 on f2538909d |
| M4, connectors: spike, add, remove, sign in | 295e97229..9eb7f22b3; fixes 5adfffcc6, 45751b733, bc9572458, c542e6362 | clean after 4 fix waves, each narrower: stale success, name-as-identity, callback deadline, fail-open regex and inventory; then per-session lock, slot reuse, cached error; then same-session wire target; then app-server shadowing, nested project files | spike 40175924834; 40188327848: class 1a, e2e:discover 8 + spike skipped; settings, widgets, layout green earlier |
| M5, acceptance | 88f05bd80..788b5bb70, fix b29167822 | clean after 1 fix wave (acceptance 4 in project B, acceptance 7 through Manage marketplaces, independent seed-shelf oracle) | whole Mac matrix 40190324774 on 788b5bb70, every job green on attempt 1; e2e:discover and e2e:discover-live 40190325020; e2e:discover 40196923687 on b29167822 |

Commit range: fbeb2ceb6..HEAD. Every commit after b29167822 touches only the spec and this report. Final gate on 7571af0d9: run 40197525168, with static, unit 1 to 4 of 4, probes and e2e:discover all green. Pull request: https://github.com/SSFSKIM/MAWS/pull/147.

## The spike's verdict (M4)

Promote, path B with the late-server variant (Decision Logs 12 and 14, the architect's ruling).
- **Where it ran:** on the mini, under the runner's own login keychain and `HOME`, with a scratch `CLAUDE_CONFIG_DIR`.
- **Keychain item:** exactly one, `Claude Code-credentials-ae335039`. It was absent before, deleted by that name after every engine exited, and verified gone.
- **What it found:**
  - Both redirect schemes complete.
  - The custom scheme needs `mcp_reconnect` after `mcp_oauth_callback_url`.
  - `mcp_set_servers` removes the session's SDK server, so path A is out and that call is never used.
  - `mcp_authenticate` starts a flow for a server added after the session started, which contradicts fact 2.
  - Sign in therefore runs from any ready session in scope. The credential serves every later session.

## Incident

Between 01:10:50 and 01:15:07 PDT on 2026-10-25, the M4 worker ran the spike on this MacBook from a local script under a scratch `HOME`. Its brief said the spike runs on the mini and never here. The engine's token save failed with errSecNoDefaultKeychain about 120 times, and each failure raised a modal "keychain cannot be found" dialog on the owner's screen.

On the architect's stop, I relayed the binding rule to the worker. The worker confirmed that no process was left and deleted the script and its scratch directory. Since then, nothing has signed in or written a keychain on the MacBook. The rule is now Decision Log 13, and the hazard is recorded in Surprises & Discoveries and `spikes/p4-aggregator/findings-m4.txt`. The lesson is in the Retrospective.

## The final `catalog` egress rule (for the charter's §19 line)

The module now lives at `src/shared/net/egress.ts` (Decision Log 4), lifted from `src/engine-host/egress.ts`; main and the engine host import it. `EGRESS_RULES = [GOOGLE_FONTS_EGRESS, CATALOG_EGRESS]`.

Rule `catalog`:
- **Timeout:** 120 s per request, body included.
- **Request:** GET only, `credentials: 'omit'`, no redirect followed, no header but the user agent.
- **Purpose:** "Discover's catalog: seed marketplace manifests, Anthropic's public plugin and connector directory, the official marketplace's public install counts; read for the person, never sent anywhere".
- **Page token:** `TOKEN = [A-Za-z0-9._~%-]{1,512}`.

| Origin | Path | Query | Content types | Cap | Measured |
|---|---|---|---|---|---|
| https://raw.githubusercontent.com | `^/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/HEAD/\.claude-plugin/marketplace\.json$` | none | text/plain | 8 MiB | largest 1,566,074 B (claude-community) |
| https://api.anthropic.com | `^/api/directory/plugins$` | `^\?visibility=public&limit=5000(?:&page=TOKEN)?$` | application/json | 48 MiB | one page, 13,149,916 B |
| https://api.anthropic.com | `^/api/directory/servers$` | `^\?limit=500(?:&cursor=TOKEN)?$` | application/json | 4 MiB | three pages, at most 1,348,270 B |
| https://storage.googleapis.com | `^/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details\.json$` | none | application/json | 2 MiB | 538,696 B |
| https://api.anthropic.com | `^/api/directory/plugin-icons/[0-9a-f]{64}/256\.png$` | none | image/png | 512 KiB | at most 111,087 B |
| https://storage.googleapis.com | `^/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/[A-Za-z0-9._-]{1,100}\.(?:png\|svg)$` | none | image/png, image/svg+xml | 512 KiB | at most 93,026 B |

How the rule is applied:
- **Icons:** they render only as `<img src="data:image/(png|svg+xml);base64,…">`, a rule pinned by a hostile-SVG test. Any other icon host, Google's favicon service included, gets a monogram. The renderer fetches nothing.
- **No network under test:** under `MAWS_E2E=1` the network is never reached, except through the opt-in `MAWS_CATALOG_LIVE=1` seam of the live smoke, which uses this rule.
- **No conditional GET:** every refresh is a full fetch, about 18 MB per 24 h.

## The held `gate.yml` change

It is uncommitted on the branch, pending CI-opt's clearance, and refreshed to apply on the current head (`git apply --check` passes). Patch: `/tmp/p4-discover-evidence/gate-yml.patch`. It does three things:
- adds `discover` to `CLASS1_E2E`;
- adds one step, `if: matrix.group == 'discover'`, running `scripts/provision-engine.sh 2.1.309` before the test phase;
- removes the two discover specs from `e2e-default-specs.test.mjs`'s default list. The total stays 93, and `discover-live.spec.ts` stays default's own.

Until the change lands, the mini's installed 2.1.309 serves the group through `real-engine.ts`'s fallback. Provisioning was proven separately on a clean cache: 33 s, sha256 and `--version` verified.

## Screenshots (in /tmp/p4-discover-evidence/, from run 40190325020)

| File | Pairs with |
|---|---|
| maws-discover-2026-10-25-home-1280x820.png | owner-notes/claude-customize-discover-2026-10-24.png |
| maws-discover-2026-10-25-home-1512x982.png | owner-notes/claude-customize-discover-2026-10-24.png |
| maws-discover-2026-10-25-detail-1280x820.png | owner-notes/claude-customize-discover-2026-10-24.png |
| maws-discover-2026-10-25-install-sheet-1280x820.png | owner-notes/claude-customize-discover-2026-10-24.png |
| maws-discover-2026-10-25-connector-sheet-1280x820.png | owner-notes/claude-customize-my-items-2026-10-24.png |

`owner-notes/` is `/Users/new/Developer/MAWS-notes/ux-comparison-2026-10-23/owner-notes/`; nothing was written there. Beside the screenshots: `live-counts-run-40190325020.json`, `live-counts-run-40190017077.json` and `all-grid-scale-run-40190325020.json`.

Deliberate differences from the reference:
- the Featured band is derived from data, not editorial;
- Your sources and per-source shelves sit in place of Desktop's picks;
- trust pills;
- inline filter chips.

Two taste items for the owner:
- at 1512 a card's byline truncates to "by Anthr…" beside its "Listed by Anthropic" label;
- a digit-led name's monogram reads its digit ("4" for 42crunch).

## Live counts (run 40190325020; 40190017077 matched)

- **Directory plugins:** 3,601 (92 / 344 / 3,165). 0 lack `reviewed_commit`, 5 lack `claude_code`, 9 have a publisher.
- **plugin-details:** 315 ids, 313 with installs.
- **Servers:** 1,011 (879 remote).
- **Connectors:** 732 after the `url_options` fix, against 700 before it.
  - By address: 660 url, 40 url_regex, 32 url_options.
  - By transport: 722 http, 10 sse.
  - By sign-in: 645 auth required, 87 not.
- **Summary script:** 5,701 items (4,969 plugins, 732 connectors; 3,101 on Skills). That is 33 fewer plugins than M2's walk, probably community churn.
- **The app, with the engine's directory on:** 4,970 plugins and 3,121 skills items, and 3,597 directory install routes. Featured is frontend-design.
- **All grid:** 4,970 items over 82 pages, end reached in 17.2 s. About 77k DOM nodes and 190 MB of heap. Frames at most 18.4 ms apart; a search answers in 126 ms. It is not virtualized.

## Review dispositions

Every Critical or Important finding from the five task reviews was fixed and re-reviewed. Dismissed or deferred:
- **M2, every seed fetched whatever the `cwd`:** dismissed. The network cache is shared across `cwd`s, and a marketplace can be present at one project's scope only (Decision Log 7).
- **M3, the session /plugins modal keeping Browse:** superseded by the architect's ruling (Decision Log 10). It became "Open Discover".
- **M3, the All grid not virtualized:** deferred to M5's live-scale measurement, then kept as is on the numbers above.
- **M5, the live smoke "collected" by the default set:** dismissed. The repository's live specs are collected and skip themselves without their flag; the spec now says "never run by the gate" (Decision Log 17).
- **Minor findings carried as unresolved,** for the branch review:
  - `src/main/catalog/state-watch.ts`'s real-filesystem test waits up to 10 s inside a 15 s timeout. It flaked once locally at 5 s, under a parallel run.
  - Several UI tests were written with their code, with no observed RED: M3's icons.ts, the CustomizeView app-shadow test in M4, and some M4 UI pieces.
  - The add or remove "forget" `.then` in ConnectorsSection is covered by a unit test of the forget function, not by a component test.

## Residue (rows for the board)

| Logged | Owner | Item | Evidence | Closes when |
|---|---|---|---|---|
| 2026-10-25 | CI-opt with the architect | Apply the held gate.yml change: discover in CLASS1_E2E, the provisioning step before its test phase, the default-specs list | /tmp/p4-discover-evidence/gate-yml.patch, applies on the branch head; spec M1 entry | CI-opt clears it and a gate run of e2e:discover provisions 2.1.309 itself |
| 2026-10-25 | the architect | Charter §19 egress line for the catalog rule, and the egress module's new path src/shared/net/egress.ts in the charter and plans | this report, The final catalog egress rule; spec Decision Logs 4, 7, 10 | the charter line names the rule and the path |
| 2026-10-25 | P4 | Conditional GET for the catalog rule: an ETag allowance in egressGet, so a refresh is not a full 18 MB fetch every 24 h | spec Decision Log 7; task-2-report Decision 3 | the rule sends If-None-Match and a 304 reuses the cached copy |
| 2026-10-25 | P4 | e2e/plugins-live.spec.ts and e2e/plugins-library-live.spec.ts, converted from the retired Browse to Discover, have only been typechecked | M3 fix waves; spec Decision Log 10 | one paid live run of both is green |
| 2026-10-25 | test infrastructure (unowned) | The unit 1/4 shard logs 166 recovered React errors, terminal token --term-bg has no value, through src/renderer/src/sessions/resource.test.tsx:110 | gate runs 40154912725 and 40163330358, both before any renderer change on this branch | the unit log carries none |
| 2026-10-25 | P4 | Split src/engine-host/plugins/manifest.ts (about 770 lines; the single-plugin view and the whole-marketplace read share it) | M2 executor's concerns | readMarketplaceManifest lives in its own module |
| 2026-10-25 | P4 | PluginsWidget imports DiscoverPane and DiscoverToolbar from customize/discover, a widgets-to-customize edge | M3 fix-wave concerns | the shared Discover parts live where both import them without the edge |

## [parent-impact]

- **Charter §19's egress rules (advisory, the architect's to write):**
  - a new rule `catalog`, with six routes, two of them icon routes;
  - the module's path is now `src/shared/net/egress.ts`.
  - Every other contract held as written. No decision D-1 to D-20 needed a change.

## Friction, for the tracker (the brief forbids me the board and ~/.claude)

| Friction | Cost | Workaround | Check | Status |
|---|---|---|---|---|
| A subagent controller that ends its turn while its own workers run never receives their completions. The harness then forces an interim SubagentHandback. | Two forced interim hand-backs and a coordinator round-trip. | Wait in the foreground with a bounded loop that greps the worker's transcript for a new SubagentHandback line (`/tmp/maws-p4-tools/wait-handback.sh`), and never end the turn while a worker runs. | A controller subagent ends its turn with a worker running and gets the completion. | live (harness; no repo) |
| A scratch HOME on a Mac with a logged-in desktop turns each failed keychain write into a modal dialog on the owner's screen. | About 120 dialogs; the owner's screen interrupted. | Keychain-touching runs go only in gate jobs on the mini (Decision Log 13). Under a scratch HOME there, create a scratch login keychain and delete it in teardown. | `security default-keychain` under a scratch HOME on a desktop Mac, with a write that fails. | conditional (live on any Mac with a logged-in GUI session) |

## Addendum: the branch panel fix wave (2026-10-25)

The architect's panel (xhigh, fbeb2ceb6..504c67c9c) returned 13 verified findings: 2 P1 and 11 P2. All 13 were fixed in one wave of three parallel fix branches, each merged with --no-ff:
- 371fd50bc: catalog, findings 0, 1, 3, 4, 5, 9, 10;
- 283c01937: connectors and sign-in, findings 2, 6, 7, 8, plus keychain conditions (a)(b)(c);
- 16c7930bf: the install sheet and taste, findings 11, 12, the byline and the monogram.

Each fix has a test that failed before it. The finding-to-commit map is in the PR body and in spec Decision Log 18.

The held gate.yml change is applied in 254f7dd99. Run 40203244376 on that commit covered the whole Mac matrix, discover included and provisioned: every job was green on attempt 1. This report's earlier residue row for the gate.yml change is closed by that commit.

## Addendum: the bounded verification's fixes (2026-10-25)

Four fixes, each with a test that fails first:
- the keychain guard checks only the captured login-shell environment (item 1);
- a failed prompt probe stops the tree, then fails (item 2);
- the state watch polls every ancestor's .mcp.json below / (item 3);
- Sign in refuses when the running session holds a different server of that name, judged by mcp_status scope, transport and URL, with streamable-http read as http (item 4).

Commits: 4e2b951d5, cfedb7871, 884dcde1c, 9340c4894.

Gates: run 40213411717 on 9340c4894 (static, unit 4/4, probes, e2e:discover on the mini) is green. e2e/support/launch.ts is untouched, so the whole-matrix run 40203244376 still stands for the other groups.

New residue row, deferred by the architect:

| Logged | Owner | Item | Evidence | Closes when |
|---|---|---|---|---|
| 2026-10-25 | P4 | A seed-route collision: an unrelated repository registered under a seed's marketplace name inherits that seed's installed state | src/main/catalog/normalize.ts ~315 and join.ts; the architect's verification, 2026-10-25 | a seed's route matches the engine's marketplace by source repository, not by name alone, with a test |

## Addendum: the master merge (p4-discover-merge, 2026-10-25)

- **Transcript blocker.** On the merge with master, the anchoring case failed twice at "the end stays pinned" (182 px; runs 40213872787, 40215238586).
  - Not Discover's catalog: it does no work at startup.
  - Not the CSS: the built Transcript, index, ReviewView and xterm CSS were byte-identical between the two builds.
  - Per-frame traces of the distance from the end showed the same follower lag on master and on the merge (runs 40216982884 and 40216980417).
  - The fix landed on master on its own branch: p4-transcript-follow, merge 0809ddc2b. A follower is now pinned in the same observer pass that measures a row's growth.
  - Its e2e control without the fix (40218692463) failed with paintedMax 182. With the fix, paintedMax was 0 in runs 40218688881, 40219930934 and 40219934567.
- **Owner's Details ruling** (Decision Log, 2026-10-25). Commits e13b7093d, f7f722010 and 7b2725ff5.
  - Review: reviewer-low found one P2, a fixed scope hidden with the command. It was fixed in 7b2725ff5 and re-reviewed clean.
  - Screenshots, all 1280×820 with Details closed, from evidence run 40224890270:
    - `/tmp/p4-discover-evidence/maws-discover-2026-10-25-details-install-sheet-1280x820.png`
    - `/tmp/p4-discover-evidence/maws-discover-2026-10-25-details-add-then-install-sheet-1280x820.png`
    - `/tmp/p4-discover-evidence/maws-discover-2026-10-25-details-connector-sheet-1280x820.png`
- **Gates on ce71c7825.** Run 40223727419 is green: class 1a, plus e2e transcript, discover, widgets, layout, settings and code.
- **Not run.** The live specs `discover-live`, `plugins-live` and `plugins-library-live` now open Details before reading. They are typechecked only; they belong to no gate group.
