# P5 acceptance: the evidence on record (O15 input)

> **Status of this file.** An inventory written on 2026-11-10 by a research agent for P5 O15 and read by the architect, from master a839e6bb2. It is an input to `docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md`, not a decision record: line numbers are that commit's, "recommendation" marks the agent's proposal, and where it disagrees with the code or with the O15 document, those are right.

Read from the architect's checkout at master a839e6bb2 (read only), 2026-11-10. Sources, in authority order: the P5 document `docs/doperpowers/plans/2026-10-27-p5-org.md` (its Decision Log, cited **DL n**; Risks, Deferred, Tracking map), the children's execution documents and reports `docs/doperpowers/plans/2026-1*-p5-*.md`, and `docs/tech-debt-tracker.md` (cited **row #n**, the 0-based position among the tracker's table rows at a839e6bb2, plus its owner).

**How to read the tables.** Each claim is a separate checkable sentence of the acceptance item. "Live?" says what kind of evidence the record holds:
- `live`: seen on the owner's production machines (MacBook, mini, the owner's devcloud/Linux VM, the phone, the production org/hub) and covering the claim as worded;
- `live-partial`: seen live, but only part of the claim, one of two machines, an older build, or a dev build or scratch profile;
- `staging`: the staging hub/org, or a throwaway VM or scratch profile driven by an agent;
- `gate` / `bench`: a CI suite or a measured group (the bench runs on the mini as a CI runner unless stated);
- `none`: no recorded evidence beyond design, code reading or unit tests.

"(inferred)" marks what I worked out rather than read. Nothing here rules pass or fail.

**Frame facts that bear on every item.**
- *Outcomes is empty.* The P5 document's "Outcomes and retrospective" says only "Written at recomposition." The item's own frame ("recorded with evidence in Outcomes") is unmet by construction until O15 writes it.
- *The machines' build.* Since 2026-11-10 00:39Z to 01:07Z all three machines run master **cf30dafdd** (DL 262). `git diff cf30dafdd a839e6bb2` outside `docs/` and `research/` touches only `apps/desk-hub/deploy/*` and its tests (PR #549, deploy tooling; DL 264). `4200a8425..cf30dafdd` has no non-doc change, so the machines run #544's merge (DL 261). The last full gate is run 42710549674 on #544's gated head 427ce3462 (55 jobs green, one flaky pass `supervisor.spec.ts:1051`).
- *"One devcloud Linux VM."* The VM evidence is spread over several VMs, none of them a single standing acceptance VM:
  - `dc-acceptance-7f80`: O10 and O14 B1, production-delegated; deleted 2026-11-01.
  - `dc-acceptance-bd31`: O7 M7 sitting; deleted 2026-11-04 12:01Z (DL 215).
  - `dc-acceptance-e071`: O7 M10 sitting, 2026-11-05.
  - `dc-linux171-1e68`: the standing production VM, a Hetzner server in the cua project adopted by devcloud. It is on cf30dafdd and is the only VM in the owner's week.
  - Throwaway VMs for O2, O3-E, O5, O16 and O17 (`dc-m8accept-dcef`, `dc-o3ewatch-*`, `dc-o5accept-d0fb`, `dc-o16-accept-4a0c`, `dc-o17linux-ce0e`, `dc-o18m6-8b03`, ...).
- *Live sittings with dev builds.* Several "live" records ran a dev build on a scratch profile, not the installed app: O9 M8 (5ead22046), O9 M10 (78b2bfbf6) and O8 M8 step 7 (a dev profile). This is marked per row.

---

## 1. Local parity

> Signed out, MAWS on the MacBook does everything it did at master c3507722d, with every e2e group green on the daemon shape, and the local-latency bench (OX7) within budget. Every project, session, artifact, library item, draft and layout from before the upgrade is present after it, with no re-index.

| Claim | Evidence on record | Live? | Gaps against the item | Staleness (later changes to the area) | Tracker rows / residue |
|---|---|---|---|---|---|
| 1a Signed out, the MacBook does everything it did at c3507722d | **DL 168** (2026-10-31): MacBook swapped from 74f175c2c to master **3239a670f** at 12:32:54Z. "Neither Mac's app signed in to an org", so the check was signed out. The owner used Files, Source Control diff, a save and Reveal in Finder on the daemon shape. O3 Outcomes item 1 (o3-spine L485). **DL 170**: New chat was off after each swap until relaunch; fixed in #403 (2aa6390a2). **DL 105**: "A profile that never signs in makes no keys, files or requests" (gate, #287). | live-partial | A spot check of a few surfaces, not a parity sweep. The MacBook has been signed in since the pairing of 2026-10-31 ~13:58Z (DL 170), so no signed-out live use is recorded after that. | Predates O4 (DL 183, f01517013: connectors, delivery, library and catalog into `mawsd`), O5 (DL 181, DL 191), O7 M2 to M10 (DL 175 to 222), O16 (DL 200), O17 (DL 209, DL 210), #452 (DL 206), #502 quit reaper (DL 234), #519 (DL 250), O8 M4 to M8. The MacBook has moved through about ten builds since (section (b)). | row #391 (load flakes); O3 residue "New chat off after each swap" (fixed DL 170) |
| 1b Every e2e group green on the daemon shape | Every e2e group has launched on the daemon shape since **DL 137** (O3-B, #336, dd58bcb8a; only `e2e:supervisor` and `e2e:c7-utility` keep the embedded shape as sentinels). Latest full gates: **DL 261** run 42710549674 on 427ce3462, the code the machines run (55 jobs green, one flaky pass); DL 258 run 42526195244 (56 jobs); DL 252 runs 42442702948 and 42451193705. | gate | This is the named gate, so live evidence is not needed. Green is often "green on rerun". **DL 260**: attempt 1 of run 42594055817 had two red jobs and the first flaky sighting of O2 M7's idle release (`supervisor.spec.ts:1442` case (m)). **DL 123**: the mini's `packaged` was red for every tree on `sessions.spec.ts:302` until #297. **DL 174** and **DL 186**: groups red on master unseen because no gate ran them. | No full gate is recorded on cf30dafdd's merge tree itself (the code equals 427ce3462's PR head plus merge, inferred). | row #417 (35 hosted flake signatures, incl. the daemon-shape quit guard "1 mid-turn, not asked", 7 sightings, latest 2026-11-09); row #608 (case (h) fix did not hold under load); row #416 (`e2e:desk-web` only under `--gates all`); row #370 (hosted skip counts unchecked); row #431 (idle groups outside the default-specs reader) |
| 1c OX7 local-latency bench within budget | Baseline **DL 33**: p50 24.45 / p95 37.56 ms, limits 26.45 / 42.56 ms; runs 40440185564, 40440764482, 40441045572 (mini). Readings on the daemon shape: DL 107 25.9 (p50) on O2's landing; DL 153 25.1 / 37.7 (O3-D, 4885de28c); DL 183 41246075649 25.2 / 37.9; DL 185 41268381349 24.6 / 37.4; DL 192 41322817177 24.3 / 37.5; DL 200 41428060325 25.1 / 37.2; **DL 209** 25.6 / 37.1 on 97779bfe3 (2026-11-03, last recorded). | bench (mini) | The item names the bench, and the bench is the mini's measured group, not the MacBook. Margin on p50 is about 0.85 ms at the last reading. | The last reading is 2026-11-03 (DL 209). Not re-read after O7 M8 to M10 (DL 216 to 222), #501, #503 (DL 236, DL 237), #519 (DL 250), O8 M6a to M5b (DL 248 to 261). | row #490 (`mawsd` synchronous `ps` blocks its loop tens of ms; not measured against OX7) |
| 1d Every project, session, artifact, library item, draft and layout present after the upgrade, no re-index | **DL 168** (MacBook, 3239a670f): a draft, the Needs-you item, the library's rows in order, browser profile history and four non-default settings unchanged; the library listed at once, no re-index (O3 Outcomes item 1, read through the accessibility tree before and after). **DL 172** (#406, gate): layout survives an update's `mawsd` restart. Gates `profile-upgrade.test.ts` and `profile-upgrade-mawsd.test.ts`. | live-partial | Projects, sessions, artifacts and layout are not named in the live record; "the profile has no bookmarks to compare". **O4**: the owner's first-launch Keychain adoption of connector grants on each Mac is "to be recorded after the landing", and no record of it is found. | Index migration 15 (**DL 157**, #374) and the settings split (**DL 123**) changed stored state after or around the check. Each later swap (DL 239, 240, 249, 256, 259, 262) restarted onto new builds, with no record re-check beyond error-line counts. **DL 176**: after a cold `session.list` the library can stay unreconciled. | row #516 (library unreconciled after a daemon wake); row #629 (a remote draft not resent after a failed save); row #429 (ad hoc signature: each build may re-prompt TCC) |

## 2. Sessions outlive the app with their services

> With the app quit, a lane B session's `maws` tool calls (an artifact write, a dataset refresh) complete, the index and attention keep deriving, and reopening shows no visible gap: the journal re-serves what the ring dropped.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 2a App quit: a lane B session's `maws` tool calls (artifact write, dataset refresh) complete | **DL 168** (MacBook, 3239a670f): the owner quit the app mid-turn twice (96 s; 7 min 14 s). The turn stayed open on its permission and a background task finished with no app. The entry says: "An artifact write with no app still rests on the gate's stand-in" (`supervisor.spec.ts` `artifacts.testWrite`). The dataset refresh with no app is O4's gate only (o4-services Acceptance 3; `--gates all` 41264101762). O5: export with the app quit through a second client, gate 41307327726 (capture through an e2e hook, not a session's tool call). **DL 159** (staging, tag 15dd0f, dc-acceptance-7f80, stub model): lane B events streamed with no app, but no `maws` tool call. | live-partial | The two named tool calls were never seen live with the app quit, on any machine. | The live quit predates O4 (DL 183), O5 (DL 181, DL 191), #452 (DL 206) and #502 (DL 234, quit reaper). | row #525 (spine-internal engine-host requests are not park needs); row #608 (quit guard); row #531 (stop timers ~19.75 s vs launchd 20 s); row #483 (no e2e of work outstanding at quit across builds) |
| 2b App quit: the index and attention keep deriving | **DL 168** (MacBook): background task finished and reported with no app. **DL 170** (2026-10-31, MacBook app quit 14:02:42Z; mini app 4885de28c): the mini's app showed the MacBook session go Working then Idle ~85 s later, never paused. **DL 206** (2026-11-03, MacBook at 75944744d): a live failure. The index's first `fs.scan` of the 7,750-session store took ~13.6 s against a 10 s budget, so "transcripts written while the app was closed went unlisted". Fixed by #452 (71969abd8; 120 s budget). | live-partial | No live re-check after #452. The attention half is seen only through the mini's status row. | DL 206's failure post-dates DL 168 and DL 170. #452 and every later index or spine change (DL 234, DL 236) are unobserved live with the app quit. | row #492 (batches dropped while `mawsd` exits cold); row #495 (first commands after cold start time out behind main's 10 s) |
| 2c Reopening shows no visible gap; the journal re-serves what the ring dropped | **DL 168**: reopening showed the transcript whole, the document in the library, the card once (O3 Outcomes item 2). The journal-over-ring replay is shown by gates (O3-D Acceptance 1, `e2e:c12`, `e2e:supervisor-daemon`, run 41043483162) and by staging DL 159 (1207 events once per carrier). | live-partial | "Journal re-serves what the ring dropped" is not separately shown live (inferred: no live case overflowed the ring). | As 2a. **DL 201**: the stream catch-up restart cap (#444) came after. | row #407 (the renderer ignores `historyUnavailable`, so a lost range shows no gap); rows #481, #485, #493, #609, #37 (replay and duplicate edge cases); row #586 (no on-disk main log) |

## 3. One sidebar across machines

> Signed in, the sidebar groups sessions from the three machines by org project, each row with its machine. States match `sminos list --org` within 2 s. Sessions in no project sit under their machine.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 3a Sidebar groups the three machines' sessions by org project, each row with its machine | **DL 154** (2026-10-30, owner 20:50Z, MacBook on 8a8a9feaa): "the owner saw the mini's sessions as rows in the MacBook's MAWS", the first time on production. The O8 M2 sub-box for this live check is still unticked (O8 L38; Outcomes "Still owed"). **DL 170**: the mini showed a MacBook session only as a status card (4885de28c). **DL 211** and **DL 222**: remote sessions on the mini and the VM opened from the MacBook's sidebar. **DL 221**: owner's MAWS group, ranking fixed by #480. **DL 251** (2026-11-08, live, failed): a remote session sits under a project row only if this Mac holds a project with the same `.smns` id; MAWS **#521** is open (P2). **DL 257** (63443a3bd): the Channel tab, not the sidebar, showed the VM and mini seats. **DL 263**: the Org page lists the three machines. | live-partial | No recorded observation of one sidebar holding all three machines' sessions grouped by org project. The VM's rows in the MacBook's sidebar are never described as such. **DL 242**: RL10 learns hub projects only from the signed head's `projects`, which on production lists none (`src/endpoint/rl10/org-directory.ts`), handed to O15. The approved project registry (**DL 265**) changes this grouping, but only after O15. | DL 154 is on 8a8a9feaa. Later changes to rows: DL 216 (#470 ranking, Resume…), DL 218 (#475 retired machines), DL 220, DL 221, DL 233, DL 237 (#503 machine home), DL 248 (#518 per-reader), DL 255 (#530). | MAWS #521 (open); row #423 (`up` without carrier during grace); row #425 (Linux recursive watch); row #507; row #535; row #537 |
| 3b Row states match `sminos list --org` within 2 s | `sminos list --org` was read live several times: O12 M9, 2026-10-29 18:15:49Z; O14 B2 step 5 (08:15Z); O14 B3 (18:56Z). None was compared with the app's rows, and no timing was recorded. **DL 218** (2026-11-05, live): a deleted VM's sessions stayed in `sminos list --org` indefinitely. The MAWS half is fixed by #475 (91ca5d02e). The sminos half is deferred (doperpowers board #171). O6's 2 s is its own offline-greying bound, with stand-in profiles (gate). | none | O8's Concrete Steps L1782 plan this check "with a screenshot", but no result is recorded in O8 or in the Decision Log. | — | rows #601 and #602 (a remote record's frozen `busy` and `updatedAt` in ranking and Overview); rows #419, #424, #471, #472, #143, #620 |
| 3c Sessions in no project sit under their machine | O6 M6 `e2e:machines` with a stand-in second profile on one Mac (hosted runs 40631062922, 40631063249, 40631063380); O8 M2 `rows.test.ts`. **DL 237** (#503): New chat "Don't work in a project" puts a session at the machine's home (gate). | none | No live observation. | DL 237 (#503) changed the home-rooted path after O6 and O8 M2. | — |

## 4. Lane B at full depth anywhere

> From the MacBook, a lane B session on the mini and one on the Linux VM each: [twelve actions]. On the bench: delta-to-paint p50 ≤ local p50 + 1 RTT + 10 ms; command round trip ≤ 2 RTT + 20 ms; open to first row ≤ 1.5 s; resume ≤ engine start + 1 RTT; on each transport the app uses.

**Live sittings for this item:**

| Sitting | Date | MacBook | mini | VM | Record |
|---|---|---|---|---|---|
| O7 M7 | 2026-11-04 04:01Z to ~06:30Z | 01d4488cf (02de6c88c for S8) | 75944744d | `dc-acceptance-bd31`, 75944744d | DL 211; O7 doc checklist L3272 to L3293 |
| O7 M10 | 2026-11-05 ~05:24Z to 06:00Z | 5f2bc8964 (wire 3.27) | 5f2bc8964 | `dc-acceptance-e071`, 5f2bc8964 | DL 222; O7 doc L3199 to L3219 |
| O7 M10 re-check | 2026-11-05 from 10:13Z | 01c0b239c | 5f2bc8964 | VM not named | DL 222; O7 doc L3225 to L3230 |

Every one of these predates the machines' present build cf30dafdd. The remote lane B area changed since, all by gate only:
- DL 216 (#470: WIRE 24 to 26, offer coverage, untracked diff, two attached clients)
- DL 217 (#472: machine route)
- DL 220 (#478)
- DL 222 (#482)
- DL 236 (#501: remote subagent drill-in)
- DL 237 (#503: New chat machine first, home root, RL2 1.10)
- DL 248 (#518: per-reader state)
- DL 251 (#522: Share)
- DL 252 (#524: channel reach)
- DL 255 (#530: composer disabled below Converse)
- DL 258 (#539), DL 260 (#543), DL 261 (#544)

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 4a Stream with token deltas (mini and VM) | **M7**: VM, "a fresh session streamed end to end and 'Working…' cleared". Mini "not reached": the S1 session had no row. The O7 checklist notes streaming "unobservable on these sessions (the to-human output style sends a reply as one tool call)". **M10 re-check** (DL 222, mini): the live thinking label counted up, and "Thought for 0s" on burst blocks was fixed after by #482. Gate: O7 M2 `e2e:remote` (41219477075, both carriers). | live-partial | The VM only at 75944744d; token deltas on the mini are not recorded as seen. | Above; #482 (DL 222) reached the machines only with the next build. | rows #394 (keyed `promptEdit` refused); row #609 |
| 4b Send (mini and VM) | M7: mini passed; VM "not rerun (same path)". | live-partial | The VM leg was never run. | Above. | rows #589, #593 |
| 4c Steer | M7: mini passed; VM not rerun. | live-partial | The VM leg was never run. | Above. | row #393 (queue promote graded `manage`) |
| 4d Interrupt | M7: mini passed ("didn't stall, in time"); VM not rerun. | live-partial | The VM leg was never run. | Above. | — |
| 4e Approve and deny | M7: mini approve passed; VM approve and deny passed. The mini's deny was not done (session in auto mode). | live-partial | Deny on the mini was never seen. | Above. | row #400 (step-up by password on a Mac without Touch ID, i.e. the mini, never run; **DL 62**); row #412 (declining a question needs `approve`) |
| 4f Answer a question | M7: **failed** on both machines ("Couldn't read this session's questions"; `maws.asks.list` and `maws.ask.answer` not offered over RL2). Fixed by M8 (DL 216, #470, gate). **M10**: a MAWS ask answered from the MacBook, opened 05:28:57.825Z and answered 05:29:05.214Z. The record does not name the machine (the mini, inferred). | live-partial | One machine (unnamed), on 5f2bc8964. | Above. | row #412 |
| 4g Take an image | M7: mini passed ("sent in about 4 s"), and a PDF too; VM image passed. | live | — | 75944744d; the uploads path changed after (DL 216, typed `uploads`). | rows #589, #593 |
| 4h Show the diff | M7: the mini's edit and diff (tracked, inferred); an untracked file showed no diff (**failed**). **M10**: an untracked file in Review passed (machine not named). | live-partial | The VM's diff is not recorded; the M10 machine is unnamed. | DL 237 (#503) home-root rule for `git.*` and `scm.*`. | rows #588, #610, #611 |
| 4i Open and edit a file | M7: mini passed (the MacBook's edit reached the agent; the agent's append showed live); VM not rerun. | live-partial | The VM leg was never run. | Above. | rows #509, #527, #610 (link and swap windows) |
| 4j Run a terminal in the worktree | M7: mini passed (a file only the mini's checkout holds); VM passed (`uname -s` Linux). | live | — | 75944744d. | row #534 (pty-host park vs a remote spawn in flight) |
| 4k Open and edit an artifact | Gate only: O7 M5a (41384303649), M5b (41408937046 and others), M5c (41552593862). The O7 checklist says: "Not exercised live: acceptance 2's artifact items (M5)". M7 S8 reached only an MCP widget. M10: Notion sign-in from the MCP panel and Connectors connected on the VM (adjacent: connectors, not artifacts). | none | Never seen live on either machine. | — | rows #564, #566, #567 |
| 4l Screenshot an artifact | Gate only (O7 M5a reads; `artifact_screenshot` itself is O5's, see item 10). | none | Never seen live. | — | rows #578, #579, #580 |
| 4m Delta-to-paint p50 ≤ local p50 + 1 RTT + 10 ms | CI bench on the mini, **run 41573992251** (2026-11-03 03:44Z, master bf6766af7, load 3.26): local 25.2 / 37.8; direct 22.7 / 36.0; relay 23.2 / 35.6 ms (p50 / p95). **Run 41720562772** (DL 210, landing tree b04c12fd0): p95 31.8 direct, 35.3 relay, 37.8 local (p50 not quoted). The live bench at M7 was **void** (DL 211: clock spread 199.5 ms; MacBook load peaking at 97.7). **DL 222**: "never run against a real machine" (tracker row). | bench (one host) | Both ends run on one host: link RTT p50 0.0 ms (direct) and 1.0 ms (relay), so the "+1 RTT" allowance was never exercised at tailnet or hub latency. No VM, no production hub. | Last bench 2026-11-03. Since then DL 216 to 261 (remote area, above). | row #605 (live bench never run); rows #554, #603 (the load rule reads only the Macs); row #553 |
| 4n Command round trip ≤ 2 RTT + 20 ms | Run 41573992251: local 1.3 / 1.7; direct 2.2 / 2.7; relay 3.2 / 4.9 ms. The void live attempt read direct 73.8 ms and relay 119 ms at link RTT 34 / 107 ms (void, DL 211). **DL 39** (staging, MacBook over CGNAT Wi-Fi): hub relay 1 KiB p95 217 to 223 ms, "one path's figure, not a bound". | bench (one host) | As 4m. | As 4m. | rows #420, #388 |
| 4o Open to first row ≤ 1.5 s | Run 41573992251: local 107.9; direct 131.9; relay 522.2 ms. Void live: direct 1,275 ms and relay 3,430 ms (over). **DL 262** (live, 2026-11-10): the MacBook's hub took 71 s to connect after the swap, "as at the swaps of 11-07 and 11-08" (adjacent). | bench (one host) | As 4m. The only real-network figures are void, and the relay's was over the bound. | As 4m. | rows #619, #622, #489 |
| 4p Resume ≤ engine start + 1 RTT | **DL 208**: direct resume after a forced drop **missed**: 7,441.9 and 7,647.8 ms against ~175 ms, on 75944744d (the M7 machines' build). Fixed by #457 (da7b8f1f6). Run 41573992251: direct 49.9 ms and relay 80.8 ms (engine start 770.0 ms). Run 41720562772: direct 47.4 ms, relay 75.2 ms, engine start 263.7 ms. | bench (one host) | As 4m. The M7 sitting's machines ran the pre-#457 build (DL 208: "the fix is not on the sitting's machines"). | As 4m. | row #486 |
| 4q On each transport the app uses (direct tailnet and hub relay) | CI bench covers direct (loopback directMap) and relay (a local hub). Live: at M7 the hover read "direct" on both machines ("direct via tailnet (36 ms)" on the VM); Wi-Fi off was skipped by the owner. **DL 148** (production, dc-acceptance-7f80, endpoint harness, not the app): both carriers subscribed; the relayed carrier resumed after 33.8 s. **DL 115**: every client frame ≥ 48 bytes on main's remote links failed in a built app from O7 M1 until #301. | none (live) | The hub relay was never seen carrying a session in the app live. The O7 report says "the hover on both carriers", but the checklist shows direct on both. | — | row #433 (no e2e drives RL2 in the built app); rows #420, #550, #551, #317, #389 |

## 5. Spawn anywhere

> "+ Session" on the mini or the VM starts a lane B session that is in the sidebar within 5 s of the engine's first event.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 5a On the mini, in the sidebar within 5 s | **M7** (DL 211): **failed**: the sheet and Touch ID passed, but there was no sidebar row, twice. The cause was the group's row cap (DL 216). **M10** (DL 222): **failed** (session cb9e796a absent even under Show more). **M10 re-check** (DL 222, mini 5f2bc8964, MacBook 01c0b239c): no Touch ID asked; "the row stayed under MAWS" after the tab closed. No timing. Gate: DL 216 e2e "1,062 ms after B's engine host started it"; O7 M8 hosted 907 ms and 613 ms ("a hosted runner's figure, not a bound"). **DL 240**: the mini's New chat home item is no longer greyed after the f857f0450 swap. | live-partial | The 5 s was never timed live. DL 216: "acceptance 5's 5 s is measured live at M10", and no such measurement is recorded. | DL 237 (#503 New chat machine first), DL 220 (no Touch ID on own machines), DL 233; all after or beside the re-check. | rows #494, #594, #595, #534 |
| 5b On the VM | M7: **failed** (no row). M10: **failed** (session cf463a17 absent; "about 5 s to start, because its engine host woke from parked"). The M10 re-check does not name the VM. | none (live pass) | No live pass on any VM. dc-linux171-1e68 has no recorded spawn check. | As 5a. | rows #428, #439, #555 |

## 6. Lane A in MAWS

> A terminal session on the MacBook and one on the mini can be sent to, steered, interrupted, answered and approved from MAWS, and their model and effort set. Every control the bridge can't reach is disabled with its reason. A terminal session without the bridge stays read-only, as today.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 6a MacBook terminal session: send, steer, interrupt, answer, approve, model, effort from MAWS | **O9 M8 sitting** (2026-10-29 03:00Z to 03:30Z; DL 132; O9 L838 to L865). The MacBook ran a dev build of 5ead22046 on a scratch `MAWS_USER_DATA` and scratch `SMINOS_HOME`, signed out (sminos 1.27.10, engine 2.1.312). Worked: c (send mid-turn read at the next request), d (approval raced, first answer won), e (*answered in the terminal*, card "Answered in the terminal"), g compact, h Stop, i background shell, j resume. f: "the turn after f's change ran on Haiku", but the chip stayed Opus (defect 4). Nine defects; six fixed in #334 (f0af710e6), checked in CI and `e2e:lane-a` on the mini (40830106480, 11 of 11). No re-sitting. | live-partial | Items a, b and f are not in the "worked" list. Answering a question *from MAWS* and setting effort *from MAWS* are not recorded. Not the installed app, and signed out. | Later lane A changes, all gate only: #355 (DL 144 mode chip), #361 (DL 149), #364 (DL 150), #506 (DL 241 subagent rows), sminos 1.40.0 (DL 247), #527 (DL 253 task notifications). | rows #464, #474, #604 (thinking label from the bridge's first chunk) |
| 6b Mini terminal session, the same controls | **O9 M10 sitting** (DL 147, 2026-10-29 18:15Z to 19:03Z). The MacBook ran a dev build of master 78b2bfbf6 (scratch profile, scratch sminos home), signed in to production at org version 11 (revoked at 12). It drove a terminal session on the mini (sminos 1.27.14, engine 2.1.312). Shown: send idle and running ("read as the next prompt"); interrupt (both sides stop); permission prompts answered in MAWS and in the terminal; the Mode chip; the model chip following a `/model` and `/effort` *typed in the terminal*; `/rename`; a side question; compact; MCP list and enable; the subagent tree; a 20 s Wi-Fi drop resumed with no row lost or doubled. Five defects, fixed in #361. | live-partial | Not shown: plan approval, carrier switch. A question answered from MAWS is not listed. Steer is shown only as a send while running. Model and effort were set in the terminal, not from MAWS. Dev build on a scratch profile. **DL 110**: the owner accepted a window in which mini terminal sessions were driven only through phone cards. | As 6a, plus DL 150 (#364 remote mode). The MacBook later got the installed app (DL 154). | row #473 (remote lane A has no Electron scene); rows #465, #474; DL 236 (a remote lane A subagent gap, lifted by #506 after both sittings) |
| 6c Every control the bridge can't reach disabled with its reason | DL 147: "the declared gaps each disabled with its reason" (live, mini, from the MacBook). Local: e2e against a capability fixture (O9 Acceptance 2), DL 131 and DL 132. DL 216: 54 commands declared remote-unavailable and greyed with their reason (lane B, gate). | live-partial | Local lane A is gate only; the live record is one sentence. | As 6a. | rows #465 (offered then refused `grade`), #587 |
| 6d A terminal session without the bridge stays read-only | Gate only: foreign-live scenes and driver/discovery tests (O9 M8 gates, 40798430473). **DL 247**: sminos 1.40.0 deletes "the unfenced Resume, Retire and Stop and steer without a bridge" (live deploy, no read-only check recorded). | none | No live observation. | DL 247 changed sminos's behaviour in this area after every check. | row #511 (nothing checks the engine can load sminos's bridge) |

## 7. The laptop asleep

> With the MacBook asleep for an hour, sessions on the mini and the VM keep working, their approvals wait, and a question and a permission prompt each reach the phone and are answered there. Within 1 s of the network being reachable after wake, every subscription resumes from its cursor, with no loss and no duplicate (RL3).

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 7a MacBook asleep an hour; sessions on the mini and the VM keep working | No record with the MacBook asleep. **DL 211**: the owner skipped the lid test ("we should skip that because we need continuous wifi for other sessions to run. same for lid"). Adjacent: **DL 170** (MacBook *app quit*, mini watched); the B4 soak (O14 B4 step 2, 2026-10-30 22:18Z to 2026-11-06 22:18Z: seven daily checks, `hub@1eeff6de`) records connectivity, not sleep. | none | The scene was never run. | — | — |
| 7b Their approvals wait | No record with the MacBook asleep. Adjacent: the phone card test paused ~9 h 06 min before an answer (DL 146, a question), with the MacBook awake and not yet cut over. | none | Never run. | — | rows #454 (a relaunched bridge makes the card vanish and return; `waiting` pushed twice), #422 |
| 7c A question reaches the phone and is answered there | **DL 146** (2026-10-29, production; mini; hub and web deployed at 78b2bfbf 17:50:45Z): the owner answered b2-card2's blocking card from the phone at 17:21Z and mini-ops's async card at 17:51Z. O14 says these were questions. **DL 160** (2026-10-30, `hub@1eeff6de`): `b4-card2` answered "Yes" from the phone at 23:49:59Z. **DL 138**: the first production card test (08:45Z) **failed**; fixed by #345. Staging: **DL 116** (O13 M7 sitting, `hub@2575f896`). | live-partial | The MacBook was awake (or not recorded). No production phone answer is recorded after 2026-10-30, and none on the VM. | Production web moved to 8813921b, then 1eeff6de, then `web@master.14ec1177` (DL 247). O18's reach changes (DL 225 to 229), #466 owner-channel resolver (DL 214), sminos 1.27.x to 1.41.0. | rows #454, #455, #127, #88, #438 |
| 7d A permission prompt reaches the phone and is answered there | **Staging only**: DL 116 (2026-10-28, staging `hub@2575f896`): the phone answered a lane A and a lane B permission (`allow`) once each, through the real endpoint module over a fake engine host and fake sminos (in-process on the MacBook). | staging | No production permission prompt answered from the phone is recorded. | As 7c. | rows #421 (a card's digest covers only the cut form past 256 KiB), #455 |
| 7e Within 1 s of the network after wake, every subscription resumes from its cursor, no loss, no duplicate | No sleep/wake measurement. Adjacent live: **DL 147**: a 20 s Wi-Fi drop resumed with no row lost or doubled (lane A, no timing). **DL 148** (production VM dc-acceptance-7f80, harness, tag 9b75d1): an RL1 socket cut replayed on the relayed carrier after **33.8 s** while direct held; `mawsd restart` resumed by snapshot; 447 events and 182 rows once. **DL 211**: Wi-Fi drop and lid skipped; "acceptance 7's app half rests on M7's measured forced-drop case". CI: run 41720562772 direct resume 47.4 ms, relay 75.2 ms. **DL 208**: on 75944744d direct resume took ~7.4 to 7.6 s (fixed by #457). **DL 262**: the MacBook's hub took 71 s to connect after swaps. | none | The 1 s bound after wake is never measured on a real network. The only real-network resume figures (33.8 s relayed; 71 s hub connect) are far from it. | DL 208 (#457) post-dates DL 147 and DL 148. | rows #407, #542, #543 (asks and toasts not deduplicated on replay), #563, #566, #618, #621, #37 |

## 8. Two clients

> MAWS on the mini and on the MacBook attach to one session at once. Both stream it, and an answer from one settles the card in the other.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 8a The mini's and the MacBook's MAWS attach to one session at once; both stream it | **M7 item 5** (DL 211; O7 checklist L3283): both apps on a fresh mini session, but "streaming in both unobservable". **DL 170**: the mini watched a MacBook session as a status card only. **M10**: "concurrent second client (e2e only)". Gate: DL 216 (#470: two attached apps, per-client follows), O7 M2. | live-partial | Streaming in both was never seen. | DL 216 (#470) changed per-client follows after M7. | — |
| 8b An answer from one settles the card in the other | M7 item 5: "answer in mini's app cleared MacBook's count at once" (fresh session). M7 item 11: answered in the mini's app, the MacBook's count dropped at once. Gate: DL 216 "the ask settling across clients". | live-partial | Seen one way only (mini to MacBook), at 75944744d / 01d4488cf, on a count rather than an open card (inferred). | As 8a. | row #543 |

## 9. The machine decides

> The trust cases of RL's acceptance hold: hub-placed actions and events are refused, an altered request card is refused by digest, and a removed device is refused once the new org state arrives.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 9a Hub-placed actions and events refused | **O10 M11 attempt 4** (DL 145, 2026-10-29 17:24Z to 17:45Z, production, dc-acceptance-7f80, harness 1938dc855): relay replay closes `sequence`, `replayed`, `stale`, an altered frame `tag`, and so on. The "hostile relay" is the harness's TamperRelay, not the hub acting. Staging tag 973954. **O14 B4 step 3** (`hub@1eeff6de`): "an rpc frame on a project socket is answered refused retired" (the hub refusing DX6, not the endpoint refusing the hub). O11 M8 (staging). | live-partial | Shown on a production-delegated VM by a harness, not on the Macs; the VM has been deleted. | Endpoint authorization changed after: O18 (DL 225 to 228), #538 (DL 254), DL 199 `DECISION_MOVED`. | rows #408, #469 (staging scene more ordinary than production) |
| 9b An altered request card refused by digest | Staging: **DL 116** / O13 M7: refusal "over another action's digest" by the phone's passkey path. Gate: O13 M5 suite (digest mismatch), O8 M4a digest-bound preview. | staging | No live check. | — | row #421 (digest of a cut card past 256 KiB) |
| 9c A removed device refused once the new org state arrives | **O12 M9** (live, mini, 2026-10-29 09:00:16Z): an event refused `revoked` nine minutes after org state 8 revoked two keys (incidental). **O10 attempt 4** (production VM): removed device closed `removed`. **DL 156** (2026-10-30, live): four endpoints read the shared key's retirement within a minute, no restart. **DL 263** and **DL 264**: v24 adopted by all three machines within ~3 min, which revokes the admin device's keys (no use of a revoked key was attempted afterwards, inferred). Gates DL 158 and DL 162. | live-partial | The removal of a device that then tries to act was never staged on the Macs. | #538 (DL 254) is not live until the production hub carries it (DL 258: "Live use waits for ... a production hub with #538"). | rows #497 (a retired cert honoured up to 10 min), #387, #552, #639, #640, #646, #442, #448 |
| 9x (Risks row; DL 69) The deployment admin device revoked once the app's device is a root | **DL 263** (2026-11-10, production, MacBook cf30dafdd): the owner's `admin root add` made this Mac's device `QesKSyD1pZgF_UGIAA5GGA` a root at v23. This Mac signed **v24** with Touch ID (05:38:50Z), removing `deployment-admin-4d9cdf736347` and revoking `8nSM5mHMn7jCSbEFzX4pwQ` and `GptYhzH9NLDNfpCsG4gN3A`. `admin show` at 05:40:46Z read one root; key file and anchor deleted. **DL 264**: dc-linux171-1e68 adopted v24 at 05:38:54.091Z. O8 Outcomes: MacBook 05:40:36Z, mini 05:41:41Z. | live | — | Current. | row #648 (devcloud delegation expires 2027-01-26; renewal now the app's) |

## 10. Agent tools on a machine with no app

> On the Linux VM with no app attached, `artifact_screenshot` and `artifact_export` work through the machine's render service, and browser control is offered or refused by capability, never failed mid-call.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 10a `artifact_screenshot` through the render service on the VM | **O5 M6** (2026-11-01 00:49Z to 01:10Z; throwaway `dc-o5accept-d0fb`, Ubuntu 24.04, no app ever ran; branch head 0fd1edea9): a scripted lane B session (c40e4e21…) got a 1280x800 PNG of 14,211 bytes; the same sitting ran a real `claude` 2.1.316 session (2e3d506d…). The owner ruled the scripted run closes item 10 (DL 169). **DL 191** (gate on the merged tree). | staging | A throwaway VM at a branch head before O5's merge, not the standing VM (dc-linux171-1e68), and never re-run. The render time bound has no live confirmation. | O17 (DL 209: render host as tab engine; DL 210: socket names by digest) changed the render host after. | rows #573 (`render-host.spec.ts` not in `LINUX_E2E`), #188, #532 |
| 10b `artifact_export` | Same sitting: export of a document as PDF (`5-pdf.pdf`, session 40bada66…). | staging | As 10a. | As 10a. | As 10a |
| 10c Browser control offered or refused by capability, never failed mid-call | O5: the VM read "no browser is attached on dc-o5accept-d0fb" (staging); gate `browser-cua.spec.ts` (41307327726). **O17** Linux pass 3 (`dc-o17linux-ce0e`, f172dc91b): `session.capabilities.browser` read the reason string (staging, by hand). **DL 187** and **DL 189**: O17 is not required; "acceptance 10's browser clause holds by refusal". O17 landed whole (DL 209, DL 210). | staging | No live check on the standing VM or the Macs. Not shown: the 1 s listen bound, and real cua's "no browser" text (O5). | — | rows #539 (capability refused by socket path length), #574, #575, #576, #578 |

## 11. Owners are visible and carried

> Every row of a session you don't own alone shows its owners (DL 111). A `sminos say` across sessions carries the sender session's owners, signed by its machine (RL9), and the receiver draws it as a peer message from that agent and owner.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 11a Every row of a session you don't own alone shows its owners | **Staging**: DL 263 step 7 (2026-11-10, MacBook dev profile, staging; VM `dc-m8-87b3`): the owner added a second staging identity as owner of a lane A and a lane B session; the hub's listings named both; after quit and relaunch, both rows named both, in the row and the hover card. The relaunch check ran on a second scene and rests on the owner's word to the desk track. DL 262: staging rehearsal. **Production**: "production's rows carry no owner labels" (DL 263), since every session there is the owner's alone. **DL 211** (live, failed): every A11 owner attestation read `not-owner`; fixed by #464 (DL 212). Gate: DL 129 (O8 M5), DL 261 (M5b). | staging | Untestable on production as it stands (no co-owned session). | — | row #432 (phone card rows draw no owners); row #647; board #465 (spawn proof not bound to its session, DL 212) |
| 11b A `sminos say` carries the sender's owners, signed by its machine (RL9) | **O14 B3 step 3** (2026-10-30 18:59Z, live; MacBook 8a8a9feaa, sminos 1.27.17): the MacBook's `b4948247:1494` read on the mini "owned by" the owner's address with no trust label. On the VM, `b4948247:1500` read the same (20:43Z). **O14 B4 step 1** (21:53Z): imported lines carry `verified`, signer kind `machine`. **DL 146** (O12 M9): B2 step 8's say carries its owner label. **DL 244** (staging O18 M6). | live-partial | Read in sminos's chat output, not in MAWS. | sminos moved from 1.27.17 to 1.41.0. O18's reach rules (DL 223 to 235) and sminos 1.40.0 (DL 247) changed `say`'s path. | — |
| 11c The receiver draws it as a peer message from that agent and owner | No live record of MAWS's session pane drawing a `sminos say` as a peer message with its owner. Staging **DL 244**: delivered "as a chat frame from U's lane with its owner label, nobody's words" (sminos side). Gate: O8 M7a Channel tab (DL 238, `channel.local.test.ts`). Live **DL 257**: the Channel tab showed seats' messages across machines (test content; owner labels not mentioned). **DL 155**: no reader draws the migrated-history label; moved to O15 under the owner's Q10 waiver. | none | Never seen in MAWS's UI. | DL 238 and DL 246 (Channel tab), DL 252 (#524). | — |

## 12. The people model is in

> A second member, added by an org-state edit on the staging org, sees listings per each session's visibility and their own sessions in full; with sessions at the default `listed`, `converse` and `approve` are refused on sessions not shared with them.

The item itself names the staging org, so staging is the place it asks for.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 12a The second member sees listings per each session's visibility | **DL 252** (2026-11-08, staging, VM at 169108598, production `hub@14ec1177`). Layer 1 (harness member `b1`) passed `m6b-visibility`. Layer 2: the owner as real member B (second email, real Access): the private session left B's sidebar; Can message came back as "Private · shared with you" with no transcript; View showed the transcript. **DL 244** (O18 M6, staging `hub@bdf8fd36`, dc-o18m6-8b03, 44 checks): U's `list --org`, `find` and `@short` named nothing of private S. | staging | Layer 1's member was added by the harness's `addRunMember` (inferred to be the org-state edit). | DL 255 (#530) fixed three reader-side defects found by layer 2 (gate). | rows #626, #632, #635, #647; boards #525 (fixed), #526 (deferred: three author labels can be wrong) |
| 12b The second member sees their own sessions in full | Not stated in either layer of DL 252. O18 M6 shows the member's own sessions only through their own lane. | staging (partial) | No explicit record. | — | rows #625, #642 |
| 12c At default `listed`, `converse` and `approve` refused on unshared sessions | DL 252 layer 1 `m6b-visibility`: "At `listed`, `converse` and `approve` are refused `grade`". Layer 2 showed only that "nothing was sent" at View. Gate: O10 `grades.test.ts`. **DL 223** found that before O18 "every session is listed in effect". | staging | Layer 2 (the owner's hand) did not exercise the refusal at `listed` itself. | — | rows #637 (no e2e drives a reader's pane against another member's session), #628, #412, #393; DL 231 (a same-user process can still widen) |

## 13. Upgrades mid-turn

> With a lane B session mid-turn and running a background shell: `mawsd` restarted, and the app upgraded one minor, leaves the turn completing, no input applied twice and the pending permission shown once; after O16 the same holds for an engine-host upgrade.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 13a `mawsd` restarted mid-turn with a background shell | **DL 168** / O3 Outcomes item 3 (MacBook, 3239a670f, 2026-10-31): `mawsd restart` with a permission pending; the card showed once, the turn completed after the answer, nothing applied twice ("583 events folded, one held event drained, the spine loaded in 2,575 ms"). A background shell is not mentioned. Staging: **O16 M4 run 3** (throwaway `dc-o16-accept-4a0c`, f4f563b2c, stub model), mid-turn with a background `sleep` and a permission, across a `mawsd` restart: "result once, permission once, shell's own completion once". DL 159 (staging, events only). | live-partial | The live case had no background shell; the background-shell case ran on a throwaway VM. | Predates O16 (DL 200, session host under every lane B launch) and the gate and reap wave (DL 205). | rows #395, #427, #501, #547 |
| 13b The app upgraded one minor, the same | Live upgrades many times, none mid-turn as recorded: **DL 154** (O3-D upgrade, "no session mid-turn"); **DL 161** (defect: the old `mawsd` launched hosts from a replaced bundle, fixed by #381; field check owed); **DL 239** (swap check counts, incl. missing module, replaced bundle and unexpected host exit, all 0, which answers DL 161's owed check, inferred); DL 240, 249, 256, 259, 262 (sessions handed over: five or six on the mini, two on the VM; whether any was mid-turn is not stated). DL 262: mini line `engine-host exited unexpectedly (code null)` (board #473). Gate: `e2e:cross-build` (DL 209 3.21 to 3.22 and from 3.20; DL 217). | live-partial | No live mid-turn upgrade with a pending permission and a background shell. | — | rows #501 (no e2e swaps a packaged bundle under a running `mawsd`), #536, #484, #599, #429 |
| 13c After O16, an engine-host upgrade, the same | Live: **DL 240** (mini, f857f0450): "new engine host took over 5 live sessions ('5 adopted, none failed')". DL 249, 256, 259 and 262: the old supervisor handed its five or six live sessions to its successor (mid-turn state not stated). Staging: O16 run 3 on `dc-o16-accept-4a0c` (engine-host replacement by a same-commit, version-bumped pack, stub model). Gate: holder-to-holder cross-build run 41486479191 (DL 209). | live-partial | No live mid-turn case. | — | rows #549 (resolved by 41486479191, inferred), #540, #541, #544, #548 |

## 14. The laptop's cost

> With the app closed and no session working, `mawsd` and the engine host on the MacBook stay under an idle CPU and memory bound set by O2's measurement, memory read as the two processes' total physical footprint (DL 48, DL 57), and idle sessions are released by the laptop's policy (§2). On an enrolled machine, the endpoint `mawsd` loads has a budget of its own: 8 MiB of physical footprint, and an idle CPU share set from its enrolled reading on the mini (DL 114).

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 14a Idle CPU of `mawsd` + engine host under the bound, on the MacBook | The bound is 1.12 s per 600 s (DL 128). Every reading is the mini's measured group: DL 133 ≤ 0.13 s; DL 139 0.12 s; DL 183 0.10 to 0.13 s; DL 192 0.12 to 0.13 s; DL 200 0.12 to 0.13 s; DL 209 0.12 s. The MacBook's cold reading was deferred: **DL 168** ("armed with the desk track"), **DL 173** (the mini's paired app kept the MacBook's spine loaded; ruled that a watched machine stays loaded), **DL 180** ("still waits for a window with the mini's app quit"). **DL 182** (live, MacBook, 2026-10-31): engine host at 225 to 290% CPU with no session working; fixed by #419. | none (MacBook) | No reading on the MacBook is recorded. | — | rows #513, #545, #570; DL 181 (a lane B tab on a session not live re-subscribes every 1 to 30 s, so the machine never parks) |
| 14b Memory: the two processes' total footprint under the bound | The bound is 99,145 KiB (DL 128, re-derived from 96,721 by DL 57, then 101,113 by DL 107). Mini series: DL 133 91,395 to 92,579; DL 153 90,899; DL 183 median 92,595; DL 192 93,715 (render 96,755); DL 200 95,171; DL 209 94,547 (four-kept 101,299 and 100,450, over, judged by an amended rule); DL 210 render x4 3 of 4 within. **DL 249**: run 42411142643 **over** on 6f89f9d11 (100,979 / 101,170 / 105,347 KiB). After #519 (DL 250), **DL 256**: `:359` median 96,659 and `:449` median 96,610 within; **`:479` median 99,818 over the absolute bound**, passing only under DL 209's rule; `measuredHeadless` keeps `:479` "red by construction until the per-session budget exists". **DL 180** (live, MacBook): the old `mawsd` was flat at a median of 285,721 KiB (+91 KiB/h) over 3.5 h (a leak check, not the bound; RSS of a pre-O4 build, inferred). | none (MacBook) | No reading on the MacBook. The bound was re-derived three times and is now held by a per-session rule for the render case. The pressure rule is "still recorded only". | The last series is DL 256 (2026-11-08, measured masters up to bf2864971). cf30dafdd's later code (#539, #543, #544) has not been measured. | rows #570, #571, #572 (engine host ~1.4 MiB drift between jobs), #546, #478, #508 |
| 14c Idle sessions released by the laptop's policy | Gate: O2 case (m) (40609072336); O16 verified-empty release (DL 200). **DL 203**: O16's descendant veto would make "every session hold itself unreleasable" on the owner's setup; fixed by #448 and #449 (DL 205: joint race proof 7/7 on the stub provider). **DL 215**: sminos live checks 21/21 and 17/17 (stub provider). **DL 260**: the first flaky sighting of O2 M7's idle release (`:1442` case (m)). | none | Never observed on the MacBook (no record of a session released after 10 min idle). | — | rows #556, #557, #558, #560, #561 (veto and verified-empty edges), #395 |
| 14d Enrolled endpoint ≤ 8 MiB physical footprint | The owner set the budget in **DL 114**. Readings on the mini: **DL 124** run 40735795915: +5,728 KiB (enrolled against a local wrangler-dev hub, before the GC lever). **DL 133** run 40826529043 on ad096787f (2026-10-29): +5,456 KiB (unenrolled 90,643, enrolled 96,099). | bench (mini, stale) | No reading on the real enrolled machines, and none since 2026-10-29. | O3-D (DL 153), O4, O5, O7 (WIRE 21 to 33), O16, O17, O18 (DL 225 to 228 endpoint reach and audience), #519, O8 M4b to M5b all landed in or beside the endpoint after the last reading. | (no tracker row names it) |
| 14e Endpoint idle CPU share from its enrolled reading on the mini | **DL 124**: set at 0.18 s per 600 s (1.5 times run 40735795915's +0.12 s). | bench (set, never re-checked) | The share was set but never measured against afterwards. | As 14d. | — |

## 15. The local boundary

> Every local socket is owner-checked and refuses symlinks, authenticates before any session data (a refusal line naming its protocol, build and live count, same uid only, is allowed, DL 29), and the daemon's artifact endpoint is reachable only through a unix socket or a per-boot token, never an open loopback port.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 15a Every local socket owner-checked and refusing symlinks | Gate: O2 `private-path.test.ts`, `private-listen.test.ts`, `socket-server.test.ts` (class 1a 40606709647; "exit 1, 'is a symlink'"). O5 cua relay `assertPrivateSocket` (41260724505, 41263931021). O3-E file guards (adjacent). | none | No audit of every socket on a machine; sockets added since (O16's session host sockets; O17's `rcua` and digest-named sockets, DL 210) have no recorded boundary sweep. | DL 200 (O16), DL 210 (socket renames). | rows #509, #527 (link-swap windows, files), #44 |
| 15b Authenticates before any session data | Narrowed by **DL 29** (the engine host's `refuse token` line allowed). Gate: O2 socket tests. | none | Gate only. | As 15a. | — |
| 15c Artifact endpoint only through a unix socket or a per-boot token, no loopback port | **DL 164** (design) and O5 M2: HTTP over `artifacts.sock` (0600 in the 0700 daemon dir, no loopback port, no token); `src/mawsd/artifacts-endpoint.test.ts`; M2 gate 41199792514. O4 note: connector OAuth binds a loopback listener on 127.0.0.1 in `mawsd`, which is outside 15c's scope (inferred). | none | Gate only; nobody checked a machine's open ports. | — | — |

## 16. The owner's verdict

> After a week of daily use across the machines, the owner declares MAWS the one interface, and says what still sent them to a terminal or to desk-web.

| Claim | Evidence on record | Live? | Gaps | Staleness | Tracker / residue |
|---|---|---|---|---|---|
| 16a A week of daily use across the machines | **DL 246** (2026-11-07): "Acceptance 16, the owner's week, starts from this landing" (M7b, #514, 9353f255b). **DL 249**: all three machines swapped to 6f89f9d11 (21:03Z to 22:54Z) "so the owner's week (acceptance 16) runs on them". Swaps since: 63443a3bd (11-08, DL 256), cfff902f7 (11-09, DL 259), cf30dafdd (11-10, DL 262). Signals of use during the week: DL 251 (channel failure from the owner's screenshots), DL 257, DL 263 (M8 sitting). | live-partial | The week started 2026-11-07 ~22:54Z. On the record's last date (2026-11-10) it has run about three days, so it cannot end before 2026-11-14 (inferred). Nothing records daily use itself. The machines changed build three times during it. | — | — |
| 16b The owner declares MAWS the one interface | None. (DL 1: the owner's design-time intent that MAWS is the one interface.) | none | — | — | — |
| 16c The owner says what still sent them to a terminal or desk-web | None as a verdict. Owner reports of friction on record: DL 236 (a remote subagent transcript missing); DL 237 ("you can't open new session on other machines unless I declare certain project on that machine"); DL 251 (a `.smns`-only folder needed for a project row); DL 263 and DL 265 (the per-org project registry, a follow-up outside P5). Desk-web was locked on the phone and the Mac's browser at B4 (DL 242). | none | — | — | — |

---

## Items assigned to O15 by name elsewhere in the record

These are not acceptance claims themselves, but the record hands each one to O15:

- **The migrated-history label.** "Attested at migration by `<machine>`" is drawn by no reader. Its check moved to O15's recomposition under the owner's Q10 waiver (DL 155; DL 242: "The drawing of migrated events stays O15's").
- **RL10 projects.** A machine on RL10 follows only hub projects the signed head lists, and production lists none (DL 242, `src/endpoint/rl10/org-directory.ts`). The owner approved the registry design (DL 265, "Spec now, build beside O15"); its app changes reach master only after O15 fixes the build P5 is verified on.
- **O8 acceptance item 7.** The owner's fresh look at a project's Channel tab across machines was not recorded at M8. It stands on DL 257 (63443a3bd), and "O15 re-checks it" (DL 264).
- **The deployment admin device.** Revoking it once the app's device is a root (Risks row; DL 69) is done (DL 263, DL 264).
- **O17.** O15 "records any stage not landed as carried" (DL 187). O17 landed whole (DL 209, DL 210).
- **The MacBook's cold idle reading.** With the endpoint's 8 MiB allowed, it is "armed with the desk track" (O3 Outcomes item 6; DL 168, DL 173, DL 180). It is not recorded.
- **O4 Keychain adoption.** The owner's first-launch adoption of connector grants on each Mac is "to be recorded after the landing" (o4-services). It is not recorded.
- **The DL 161 field check.** The owed check ("no three-exit line in `mawsd.log`") is answered by DL 239's swap-check counts, all 0 (inferred).
- **B2 step 9.** The owner's look at the production hub logs for 2026-10-29 08:45Z to 08:57Z is still pending (O14).

---

## (a) Claims with no live evidence on the production machines, most significant first

"No live evidence" means nothing observed on the owner's MacBook, mini, production VM, phone or production org bears on the claim. Each claim gives its best evidence in brackets.

1. **16a, 16b, 16c: the owner's week and verdict.** The week started 2026-11-07 (DL 246, DL 249) and cannot have run seven days by 2026-11-10 (inferred). There is no declaration and no account of what sent the owner elsewhere. (16a has live-partial evidence that the week started; 16b and 16c have none.)
2. **7a, 7b, 7e: the laptop asleep.** Never run. The owner waived the lid and Wi-Fi tests at M7 (DL 211). The 1 s resume after wake was never measured on a real network; the real-network figures are 33.8 s relayed (DL 148) and a 71 s hub connect after swaps (DL 262). [none; CI forced-drop 47.4 / 75.2 ms on one host]
3. **7d: a permission prompt answered from the phone.** [staging only, DL 116, through fakes]
4. **4m, 4n, 4o, 4p, 4q: the remote bench and its transports.** The live bench was never valid against a real machine (DL 211, DL 222, row #605). CI runs both ends on one host with link RTT ~0 to 1 ms, so the RTT allowances were never exercised. The hub relay was never seen carrying an app session live. [bench on one host]
5. **14a, 14b, 14c: the laptop's idle cost.** No reading on the MacBook at all. The mini's latest series has the render case `:479` over the absolute bound (DL 256), and release by policy is never observed live. [mini bench; gate]
6. **5b: spawn on the VM.** Live attempts failed at M7 and M10; no VM re-check is recorded. [gate 1,062 ms]
7. **4k, 4l: open, edit and screenshot an artifact remotely.** Never live on either machine. [gate]
8. **3b: sidebar states match `sminos list --org` within 2 s.** Never compared. DL 218 found stale `list --org` rows; the sminos half is deferred. [none]
9. **10a, 10b, 10c: render and browser on a VM with no app.** Only throwaway VMs (`dc-o5accept-d0fb` at 0fd1edea9; `dc-o17linux-ce0e`). [staging]
10. **11c: the receiver draws a `say` as a peer message from that agent and owner.** Never seen in MAWS. [staging, sminos side, DL 244]
11. **11a: owners on co-owned rows.** Production has no co-owned session; shown on staging only (DL 263 step 7). [staging]
12. **14d, 14e: the enrolled endpoint's 8 MiB and CPU share.** Last read on the mini on 2026-10-29 (DL 133), against a local stand-in hub; the CPU share was never re-checked. [bench, stale]
13. **12a, 12b, 12c: the people model.** Staging is what the item names. 12b is not stated, and 12c rests on the harness layer. [staging]
14. **9b: an altered card refused by digest.** [staging and gate]
15. **15a, 15b, 15c: the local boundary.** [gate]
16. **6d: a terminal session without the bridge stays read-only.** [gate; sminos 1.40.0 changed the area, DL 247]
17. **3c: sessions in no project sit under their machine.** [gate, stand-in profiles]
18. **1b and 1c.** These are gate and bench claims by the item's own wording; their evidence exists (run 42710549674; DL 209), with the flake and staleness notes above.

**Counts.** 67 claims (items 1 to 16 split as above, plus 9x).
- **31 have live evidence on production machines.** Only 3 are full: 4g, 4j and 9x. The other 28 are partial: 1a, 1d, 2a to 2c, 3a, 4a to 4f, 4h, 4i, 5a, 6a to 6c, 7c, 8a, 8b, 9a, 9c, 11b, 13a to 13c, 16a.
- **36 have none.** Of these:
  - 11 have only gate or bench evidence: 1b, 1c, 4m to 4q, 14a, 14b, 14d, 14e.
  - 10 have staging evidence: 7d, 9b, 10a to 10c, 11a, 11c, 12a to 12c.
  - 15 have neither: 3b, 3c, 4k, 4l, 5b, 6d, 7a, 7b, 7e, 14c, 15a to 15c, 16b, 16c.

---

## (b) Builds each machine ran at each recorded live check

Only what the log and the children state. "?" marks a build the record does not give. Production hub and web builds are shown where stated.

| When (UTC) | Check | MacBook | mini | VM | Phone / hub | Source |
|---|---|---|---|---|---|---|
| 10-28 16:22Z | O13 M7 owner sitting (staging) | runs the harness, endpoint in process (build ?) | — | — | phone on staging `hub@2575f896 web@HEAD.2575f896` (master 2575f896a); production `hub@3486527c` | DL 116 |
| 10-28 16:46Z to 17:38Z | Production rooted; B0 | — | — | — | production `hub@1bf619c8`; phone paired as `web-cards` `Y4NFQOnwE_H85ECUUg5P6Q` | DL 119, DL 120 |
| 10-28 22:28Z; redo 10-29 01:14Z | B1 VM cut over | — | — | dc-acceptance-7f80 pack `0.0.0-d392c4d8-1b82f835` | `hub@1bf619c8` | O14 B1 |
| 10-29 03:00Z to 03:30Z | O9 M8 local lane A sitting | dev build of 5ead22046, scratch profile, signed out; sminos 1.27.10; engine 2.1.312 | — | — | — | DL 132; O9 L838 |
| 10-29 07:31Z to 11:42Z | B2 mini cut over; card test failed 08:45Z; re-attest | — | MAWS b47d14778, then 5b7f51092 (11:36Z); sminos 1.27.11, then 1.27.12, then 1.27.14 | — | `hub@1bf619c8` | O14 B2; DL 138, DL 141 |
| 10-29 17:21Z, 17:51Z | Phone answers (production) | not cut over, no MAWS installed (DL 151) | 5b7f51092 (inferred) | — | hub and web redeployed at 78b2bfbf 17:50:45Z (so the 17:21Z answer was on `hub@1bf619c8`) | DL 146 |
| 10-29 17:24Z to 20:19Z | O10 attempts 4 and 5 (production) | test device | — | dc-acceptance-7f80, sminos 1.27.15; master 78b2bfbf6 | production | DL 145, DL 148 |
| 10-29 18:15Z to 19:03Z | O9 M10 remote lane A sitting | dev build of 78b2bfbf6, scratch profile, org v11 | sminos 1.27.14; MAWS 5b7f51092 (inferred) | — | production | DL 147 |
| 10-29 (later) | mini app rebuilt | no MAWS | `/Applications/MAWS.app` from fc5278f32 | — | `hub@8813921b web@master.8813921b` | DL 151 |
| 10-30 18:38Z to 20:50Z | B3 MacBook cut over; mini rows seen 20:50Z; owner labels on `say` | packaged 8a8a9feaa; sminos 1.27.17; org v15 | fc5278f32 (inferred) | dc-linux171-1e68 `mawsd` 1a222253 (cut over 20:42:58Z) | `hub@8813921b` | DL 154; O14 B3 |
| 10-30 20:52Z / 23:08Z | O3-D upgrade (DL 161 defect) | 4885de28 | 4885de28c (23:08Z) | — | — | DL 154, DL 161 |
| 10-30 21:53Z | B4 step 1, legacy key retired (v16) | 4885de28 | fc5278f3 | dc-linux171 1a222253; dc-acceptance-7f80 39e9acf4 | `hub@8813921b` | DL 156; O14 B4 |
| 10-30 22:18Z to 11-06 22:18Z | B4 soak (seven daily checks) | moved, builds not all recorded | moved (not recorded) | dc-linux171 1a222253 | `hub@1eeff6de web@master.1eeff6de` | DL 160, DL 239 |
| 10-30 23:49:59Z | Phone answers b4-card2 | — | (as above) | — | `hub@1eeff6de` | DL 160 |
| 10-31 12:32Z to 14:02Z | O3 close: swap, records, quits, `mawsd restart`; pairing (board #402) | 74f175c2c, then 3239a670f | app 4885de28c | — | production org | DL 168, DL 170 |
| 10-31 20:35Z | MacBook swap; engine-host CPU incident | 3adf9c979 (build d09daef1) | — | — | `hub@1eeff6de` | DL 180, DL 182 |
| 11-03 | index scan failure | 75944744d | (smaller store, in time) | — | — | DL 206 |
| 11-04 04:01Z to 06:30Z | O7 M7 sitting | 01d4488cf (02de6c88c for S8) | 75944744d | dc-acceptance-bd31, 75944744d (deleted 12:01Z) | `hub@1eeff6de` | DL 211; O7 L3272 |
| 11-05 05:24Z to 06:00Z | O7 M10 sitting | 5f2bc8964 (wire 3.27) | 5f2bc8964 | dc-acceptance-e071, 5f2bc8964 | `hub@1eeff6de` | DL 222; O7 L3199 |
| 11-05 from 10:13Z | O7 M10 re-check | 01c0b239c | 5f2bc8964 | not named | — | DL 222 |
| 11-06 23:27Z to 11-07 00:28Z | Soak final check; swaps; B4 steps 4 to 8 | f857f0450 from 23:52Z (rollback 01c0b239c) | f857f0450 from 00:06Z (rollback 5f2bc8964) | dc-linux171 1a222253; throwaway dc-o14final-64ce | `hub@1eeff6de`; phone and Mac browser desk-web locked | DL 239, DL 240, DL 242 |
| 11-07 07:29Z to 07:55Z | O18 M6 (staging) | f857f0450 (probes in process) | f857f0450 | dc-o18m6-8b03 at 68c6125a4 (staging) | staging `hub@bdf8fd36`; production `hub@1eeff6de` | DL 244 |
| 11-07 08:10Z | VM swap | f857f0450 | f857f0450 | dc-linux171 f857f0450 | — | DL 245 |
| 11-07 ~15:03Z | Production hub deploy | f857f0450, sminos 1.40.0 | f857f0450, sminos 1.40.0 | dc-linux171 f857f0450, sminos 1.39.0 | `hub@14ec1177 web@master.14ec1177` | DL 247 |
| 11-07 21:03Z to 22:54Z | Swap; the owner's week begins | 6f89f9d11 (wire 3.31) | 6f89f9d11 | dc-linux171 6f89f9d11 | `hub@14ec1177` | DL 249 |
| 11-08 02:51Z to 05:27Z | O8 M6b shared staging run | 6f89f9d11 (and a second scratch profile) | 6f89f9d11 | staging VM at 169108598 | staging (build not stated); production `hub@14ec1177` | DL 251, DL 252 |
| 11-08 14:29Z to 14:45Z | Swap | 63443a3bd (wire 3.32), sminos 1.40.7 | 63443a3bd, sminos 1.40.7 | dc-linux171 63443a3bd, sminos 1.40.7 | `hub@14ec1177` | DL 256 |
| 11-08 22:41Z | M7b channel screenshot | 63443a3bd | 63443a3bd | dc-linux171 63443a3bd | `hub@14ec1177` | DL 257 |
| 11-09 01:05Z to 07:43Z | Swap | cfff902f7 (wire 3.33) | 63443a3bd until ~07:43Z, then cfff902f7; sminos 1.41.0 | dc-linux171 cfff902f7 | production `hub@14ec1177`; staging `hub@cfff902f`, then `hub@e181a194` | DL 259, DL 261 |
| 11-10 00:39Z to 01:07Z | Swap | cf30dafdd | cf30dafdd | dc-linux171 cf30dafdd | `hub@14ec1177` (inferred unchanged) | DL 262 |
| 11-10 04:49Z to 06:12Z | O8 M8 sitting: step 7 on staging, then production v23 and v24 | cf30dafdd (+ a dev profile for staging) | cf30dafdd (v24 at 05:41:41Z) | dc-linux171 cf30dafdd (v24 at 05:38:54.091Z); staging VM dc-m8-87b3 | production `hub@14ec1177` (inferred); org v24 | DL 263, DL 264 |

**Notes on the builds.**
- The production hub has not been redeployed since `hub@14ec1177` (DL 247). #538, the hub's machine-removal key binding, waits for the owner's deploy (DL 254, DL 258).
- Before 2026-10-30 the MacBook had no installed MAWS (DL 151). Its earlier "live" records ran dev builds on scratch profiles (DL 132, DL 147).
- Master a839e6bb2 differs from the machines' cf30dafdd only in `apps/desk-hub/deploy/*`, its tests and docs. I read this with `git diff` in the checkout.
