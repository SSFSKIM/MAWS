# P5 O8 — The org interface (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O8**, §"O8: The org interface". Parent pin: blob `653f79b63c4418e5ee3060a205f322dd3cdfa40e` at master `e181a1944` (P5's Decision Logs 1–260; re-pinned on 2026-11-09 at M5b's cut. Neither 259 nor 260 changes what M5b consumes: 259 is the swap that put cfff902f7 (M4b) on all three machines, and 260 lands M4c. M5b's own preconditions were met earlier: 251 landed M6b's `record.owners` offer, its record path, the local door and `org.owners.add`; 190 (b)'s fix is on master; and sminos 1.38.0 or later carries the executor (Decision Log, "M5b's refresh at its cut"). Before that, at blob `7026ea72dd48e0a805b5c9b82b91a0d2d6c0c4e5` and master `cfff902f7`, P5's Decision Logs 1–258, re-pinned on 2026-11-08 at M4c's cut. Of 252–258, only 258 bears on M4c: it lands M4b, whose composer guard, settlement-bound hub halves and certificate set M4c builds on. 230 (earlier) landed the desk track's renew route M4c consumes. 252 and 255 are the channel reach and its reader fixes, 253 the joined notifications, 254 the key-bound machine delete, 256 and 257 the swap and M7b's live check. Before that, at blob `5cb515f365cc18780df3cd8451c3c7d828ffca95` and master `bd2b59baa`, P5's Decision Logs 1–251, re-pinned on 2026-11-08 at M4b's cut. Of 249–251, only 251 bears on M4b: it lands M6b (`signActions`, `actMany`, `policy.ts`, the local door, `WIRE_MINOR` 32) and records the channel-reach fix in flight. 249 is the three machines' swaps, and 250 makes the wire fingerprint a committed file that `pnpm wire:manifest` refreshes. Before that, at blob `257faf80e19062a89fb24caafa28f2c448b68bac` and master `48e0ed15a`, P5's Decision Logs 1–248, re-pinned on 2026-11-07 at M6b's cut, where 246–248 change nothing M6b consumes: 246 lands M7b, 247 puts O18's build on the production hub and has sminos 1.40.0 remove phase 1's hub path, 248 lands M6a and adds M6a's endpoint rule to Decision Log 235's second-member precondition. Before that, at blob `7781e2d50a7a4a5f86576f11354128d444b8fe39` and master `14ec11778`, P5's Decision Logs 1–245, re-pinned on 2026-11-07 at M6a's cut, where 239–245 change nothing M6a consumes: 239 and 240 swap both Macs to f857f0450, 241 lands #506's RL2 11 and `WIRE_MINOR` 29, 242 ends O14, 243 and 244 shape and pass O18 M6 on staging without `record`, 245 meets Decision Log 227's floor. Before that, at blob `92141de56e15ff65c3da5baa8fa135cdecf075c7` and master `f857f0450`, P5's Decision Logs 1–238, re-pinned on 2026-11-06 at M7b's cut, where 229–238 change nothing M7b consumes: 232 sets the order, 238 lands M7a. Before that, at blob `b99c1767` and master `910539147`, re-pinned for the re-plan of the rest: 223 to 228 make M6's Share sheet O18's M5, with the `list` grade and audience streams; 154 moves the last machine, so the owner's words no longer wait; 155 waives B4's wait on M7's reader; 168 closes O3 and 222 closes O7; 190 makes the spawner an owner and leaves its residue (b) due before owners move; earlier pin blob `d07bfc4ea2466d7d5ca7ca3164aed4d93021311a` at master `6fb933626`, P5's Decision Logs 1–129, re-pinned on 2026-10-29 for M4's re-plan: 121 lands H1, 126 leaves M4 the refused attempt and the section's split, 129 lands M5 and names M4 next; earlier pin blob `e74a3c5d58e682790627cf0fc54abe23e161930e` at master `1bf619c83`, Decision Logs 1–116; first drafted at `5b46682f1`, re-pinned for Decision Logs 95 to 97, and again on 2026-10-28 for M3's and M5's re-plan: Decision Log 101 refuses O3's D2, so lane B's owner changes route to sminos's member record; 105 and 113 land M1 and M2; 111 answers Q1 to Q7; 116 passes M1's staging sitting and finds the double sign-in, fixed in its own PR; the others, 114 and 115 among them, change nothing here).
>
> **What binds.** O8's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5 §7 (people: owners, visibility, machine owners and grants, agents talk as today, credentials) and §8 (the sidebar's per-project toggle, the project channel, the Org page, attention across machines); parent acceptance 3 (its remote rows: Decision Log 93), 11 and 12.
> - The remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (blob `437a03eb`), cited *RL §n*: RL5 (the signed org state), RL6 (the session record, its listing and its withdrawal), §5.2 (writers, the backstop, the software root and its end), §5.3 (a device's pairing), §5.6 (step-up), §5.7 (the log plane), §5.9 (what the hub can't do), §6 (owners, visibility, grants).
> - P5's contracts OX2, OX3, OX8 and OX9, and Decision Logs 26 and 30 (the admin's signing checks), 31 (a delegation's prefix and id used once), 34 (a member's new device), 36 (reader state and drafts per member), 38 (Access's login transfer; the Registry socket's `?app=1`), 50 (an owner add is `record.owners {add: true, member}`), 59 (`gone` listings), 69 (the deployment admin and its end), 71 (the device key's backup mark), 75 and 80 (words v2-only; migrated history by O14's Interfaces §D), 92 (this document's first milestone; the project channel is the app's one reader of the log plane) and 93 (O9's requests of the rows; acceptance 3 closes with this first milestone).
>
> **Built on.** O7's document `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (blob `6f67459b`, PR #276), whose M1 is being built in parallel: its Interfaces §B (`OrgSession`, `SignedIn`, `HubAccess`, `signedOut()`), which M1 here implements for production, and §A (`Machines.remote`, `Machines.onRemote`), whose roster M2 reads. O9's document `…-p5-o9-lane-a.md` (blob `5aaaae49`, PR #277; its M1 landed, P5 Decision Log 97): its Interfaces §G, R1 to R6, which M2's rows answer. O6, landed (`…-p5-o6-machine-dimension.md`, blob `f5a91406`): addresses, OX3's org keys and `smnsId`, the sidebar's settled forms T1 to T5. O10 M1–M9, landed (`…-p5-o10-endpoint.md`, blob `315bc8cf`): `src/main/device/` (keys, step-up, the backup mark), the endpoint's listings (`src/endpoint/listings.ts`) and `endpoint.listings`. O11, landed (`…-p5-o11-hub-v2.md`, blob `4c4ac1ff`): the Registry's chain, pairing exchange, listings and app socket. O13, landed (`…-p5-o13-web-cards.md`, blob `04e88ca6`): `deployment admin` (`apps/desk-hub/deploy/admin.ts`), production's root until O8, and the pairing code, MAC and fingerprint in `org-protocol`. O14's Interfaces §D (`…-p5-o14-cutover.md`, blob `511deaba`) for M7.
>
> **What this file holds.** The execution only. P5 Decision Log 92's first milestone is specified to be built now, as two milestones: **M1, the app's org session** (sign-in, the device's registration, the held org state) and **M2, the remote rows**. **M3, the app as the org's signer**, and **M5, owners on rows and the People toggle**, were re-planned to that depth on 2026-10-28 on the owner's answers (P5 Decision Log 111), with "Add owner" split out as M5b. M4 was re-planned on 2026-10-29 and split three ways: **M4a, the Org page's shape, people and devices**, is executable; M4b (machines and their rights) and M4c (delegations) stay advisory, with the facts their re-plans need. M4b, M4c and M6–M8 are **advisory**: what each needs, adds and proves, not how. Much of them turns on the owner's taste, asked under "Open questions for the owner"; M1 and M2 pre-empt none of those answers. Residue decisions are made where they bind, each with the alternative that lost, and listed in the Decision Log for P5's writer. **On 2026-11-06 the rest was re-planned on master 910539147:** M4b, M4c, M5b, M6a, M6b, M7a, M7b and M8 are executable, in the order M7a, M7b, M6a, M6b, M4b, M4c, M5b, M8 (Plan of Work).

## Purpose

P5 makes MAWS one app over the owner's machines and, later, other people. O6 gave the app a machine dimension, O7 gives it an encrypted link to each machine, and O10's endpoint on each machine decides every request by the org state it holds. None of them puts the app itself in the org: it holds no org state, the org lists no device of its, and it cannot reach the hub. O8 is the app's half of the org: first the sign-in, then the people.

After M1 and M2 (the first milestone):
- **The owner signs MAWS on the MacBook into the org once.** In Settings › Org they paste a pairing code from `deployment admin pair --class native-mac` (O13's command, the org's root until M3), sign in to Cloudflare Access in their own browser, and compare a ten-character fingerprint on the screen with the one in the terminal before approving there. From then on the app holds the org's signed state, verified from the code's root pins, and follows every new version; O7's link opens a channel to each machine the org lists. Signed out, MAWS is exactly what it was.
- **The sidebar lists other machines' sessions.** Each machine's endpoint publishes a signed listing of each session to the hub. The app verifies them and draws the owner's sessions on the mini and the devcloud VMs under their org projects, beside this Mac's, each with its machine chip and its state, greyed while its machine is offline. O7's lane B pane and O9's lane A pane open them.

After M3–M8 (advisory): the app's device becomes a root of the org and signs its weekly state; the Org page manages people, devices, machines and rights; rows name their owners and a per-project toggle adds other people's sessions; owners set each session's visibility and shares; each project gets its channel, the app's one reader of the log plane; and the deployment admin's software root is revoked.

**How to see M1 and M2 working.** In the suites, the sign-in runs against desk-hub's Worker in Miniflare with O13's real `pair` as the approving side, and a real endpoint's listings arrive as rows grouped by org project with machine chips beside local rows. Live, a dev run on a scratch profile signs in to staging with a code from `staging-run.sh admin pair --class native-mac`, the owner's browser and the owner's approval; a relaunch is still signed in with no browser trip. On production, after the owner's sign-in, the sidebar shows the first cut-over machine's sessions (O14's B1 VM, then B2's mini). The commands are in Concrete Steps.

## Progress

- [x] M1 — The app's org session — landed (PR #287, master 790002644, P5 Decision Log 105); the owner's staging sitting owed — (needs O6, O10 M9, O11 and O13 M2, all landed; O7 M1's `src/main/org/session.ts` by the second-lands-takes-the-file rule)
  - [x] (2026-10-28) Built on `p5-o8-m1`: `org.*`, `<userData>/org/`, the login transfer and stand-in, the hub client, the held view, the Registry feed, the production session, the Org section, main's composition over O7's seam (O7 M1 landed first, #285; its `session.ts` taken, the file this branch had copied byte for byte). The unit suites and `test/org/sign-in.local.test.ts` pass locally.
  - [x] (2026-10-28) reviewer-high converged: round 1 at ef4bb83cb (3 P1, 5 P2, all fixed at 59edeebe1), round 2 on the fix found nothing. Class 1a green at b5816709a (run 40683146373).
  - [x] (2026-10-28) The final gate on the PR's tree: run 40683839806, three reds none of #287's (c7 green on rerun 40699088283; design-systems a hosted flake; packaged's known `layout-transfer.spec.ts:541`).
  - [x] (2026-10-28) The owner's staging sitting passed (P5 Decision Log 116): paired as `native-mac`, listed at version 68, signed in and connected after a relaunch with no browser. It found one defect, two browser trips and two entry posts in one sign-in, fixed by its own PR before M3.
- [x] M2 — The remote rows — landed (PR #295, master cfa0f0e7b, P5 Decision Log 113); the live check held at O14 B3: the owner saw the mini's sessions as rows in the MacBook's MAWS on production, 2026-10-30T20:50Z (P5 Decision Log 154)
  - [x] (2026-10-28) Built on `p5-o8-m2`, branched from `p5-o8-m1` (the architect lands them in order): `rows.ts`, `org.rows`, main's wiring, the renderer's listed partition and rows; the unit suites and `test/org/rows.local.test.ts` pass locally.
  - [x] (2026-10-28) reviewer-high converged: round 1 at 11846ed8a (2 P1, 1 P3, all fixed at f8764a1ca, cf1e4451e and 529ae1522), round 2 on the fixes found nothing.
  - [x] (2026-10-28) The final gate on bcb8959b7: run 40691164424, 41 of 42 jobs green; the one red is packaged's known `layout-transfer.spec.ts:541` (O2's skip). The landing gate runs on the merge with the master O2 leaves (the architect).
  - [x] (2026-10-28) The landing gate on the merge with O2's master (fd1d65c44): runs 40716613510 and 40716660100 green, no flaky lines.
  - [ ] The live check at the first cut-over machine.
- [x] M3 — The app as the org's signer: a co-root, the weekly successor, the signing checks — landed (PR #314, master 716a2675d, P5 Decision Log 126); the owner's sitting (`root add` on staging, then production) owed — (re-planned 2026-10-28; needed M1 and O7 M1)
  - [x] (2026-10-28) Task 1: `root add` in `deploy/admin.ts`, its `production-run.sh` line, and its proofs in `admin.test.ts`.
  - [x] (2026-10-28) Task 2: `checks.ts` (`checkSuccessor`, `supersededRevocations`) and its proofs, the zero-roots ones included.
  - [x] (2026-10-28) Task 3: the device module, `createStateSigner` and the next keys (create, promote, destroy).
  - [x] (2026-10-28) Task 4: `signing-store.ts`, `signer.ts`, `postState`, `signing.json`, §H's M3 rows.
  - [x] (2026-10-28) Task 5, reviewed clean (5448d421b, fixes 34b043605 and 841d36673): `weekly.ts` and `deliveries.ts`.
  - [x] (2026-10-28) Task 6a, reviewed clean (7fab342f5, fix 65e1310fa): the session's composition, the rekey transaction and its replay, the IPC schema and commands, main's wiring.
  - [x] (2026-10-28) Task 6b, reviewed clean (fbed38051, fixes 37cdbf67d and 1d4bd558c): the Org section (its lines, buttons and confirmations) and `copy.ts`.
  - [x] (2026-10-28) Task 7, reviewed clean (1e38ae640): `test/org/signer.local.test.ts`, with the shared harness `test/org/local-org.ts`.
  - [x] (2026-10-28) Task 8, reviewed clean (740f0c46f): the app follows a recovery whose first state is a sibling at its head's version (Task 7's Discovery 2).
  - [x] (2026-10-28) reviewer-high on the whole branch converged in three rounds. Round 1, on 559ddfc0c, found 3 P1 and 2 P2, fixed at c4a1d6801..ba781f87f. Round 2 reproduced one earlier interleaving of the first P1, fixed at b92b07573. Round 3 found nothing material.
  - [x] (2026-10-28) The desk track reviewed the `deploy/` hunk and shaped the wrapper fix. The final gate, run 40771309800, had two browser reds (`browser-cua.spec.ts:483`, `browser-chrome.spec.ts:681`), none of #314's; its rerun, 40783162110, was green.
  - [ ] The owner's sitting: `root add` on staging, then production (the steps are in the report, `2026-10-28-p5-o8-report.md`).
- [x] M4a — The Org page: its shape, people and devices — landed (PR #344, master ecc930b5c, P5 Decision Log 140)
  - [x] (2026-10-29) Task 1, reviewed clean and approved by the desk track (336af704b): the move: the pairing judges and their `PendingEntry` type into `org-protocol`, `admin.ts` importing them (its own commit, the desk track's review).
  - [x] (2026-10-29) Task 2, reviewed clean and approved by the desk track (5935f62a5; review fix 592211929; boundary comment 37ce2077d): `successorProblems` and `stateProblems` in `org-protocol`, and `admin.ts`'s `amend` running it (the desk track's review).
  - [x] (2026-10-29) Task 3, reviewed clean (643d126de, fix 6d23a8055): the signing paths: `edits.ts`, `Edit.endorse` and `Edit.live`, `StateSigner.sign`'s endorsement and guard, the signer's check before the slot, and `checks.ts` running `successorProblems`.
  - [x] (2026-10-29) Task 4, reviewed clean (19730e6ae; class 1a green through it, run 40819796641): the session's surface: `org.view`, `org.preview`, `org.change`, `org.pair.*`, `pairing.ts`, `hub-client.ts`'s `pendingOf`, `refused.attempt`, the schema and main's wiring.
  - [x] (2026-10-29) Task 5, reviewed clean (9b9f8945d, fix 653e60c0b; class 1a green at the fix, run 40824276945): `close()`'s fence and join (`HeldOrg.close()`, the parts' operations in flight), and the two test workarounds removed.
  - [x] (2026-10-29) Task 6, reviewed clean (1971d3be9, fix 7437e1e2e): the renderer: `settings-tab/org/`, the four groups, the change and pair sheets, `copy.ts`.
  - [x] (2026-10-29) Task 7, reviewed clean (7033fb853): `test/org/org-page.local.test.ts`, registered in `TIMING_NODE_TESTS`; 6/6, six runs in a row.
  - [x] (2026-10-29) Task 8, reviewed clean (37ea7abab, 9764fc1d7; fix wave 300f1a6b5..fac48e11f; test race ab8d2ede6): the Org page's look made checkable through the gate: `e2e/org-page.spec.ts` in `e2e:settings` over a seeded org, its four groups and the pairing sheet attached, under forced classic scrollbars. Its first run (40828325127) caught a real overflow, fixed in the layout; green on the EC2 Mac at d8d7417a8 (40830513848) and 44175e50a (40831591829).
  - [x] (2026-10-29) reviewer-high on the whole branch (87af670c2..8cd862d6b) found nothing material, in one round; Task 8's later fix wave was re-reviewed clean at its frontier.
  - [x] (2026-10-29) The final set at 2efc9642c, after merging master afac87f23: the hosted call (class 1a and every class-1 group but default and the two secret groups, run 40832852899) and packaged (40832852847), both green; the architect reviewed the Org page's screenshots and found nothing blocking (taste points to #342). Master 1fe1a74d9 (#338) merged after it at 063460ccf: class 1a and desk-web (40843054561), settings, desk-web-hub and machines (40846738615), all green.
  - [x] (2026-10-29) Master bd6b4b097 (O3-B, #336) merged at 4ca8ec271: class 1a, settings, machines, desk-web and desk-web-hub green on the daemon shape (40851684636). In the architect's slot on the same tree: `e2e:default` (40867534219, EC2 Mac, `--lane no-hosted`), `e2e:connectors-oauth` (40867548462, the mini's VM guest) and `e2e:discover` (40867803535, the mini), all green with no flaky line.
- [x] M5 — Owners on rows and the People toggle — landed (PR #323, master 0db3870a0, P5 Decision Log 129)
  - [x] (2026-10-28) Built on `p5-o8-m5` at b78445447, one task: `memberName`, `OrgRows.members` and `member`, the `sidebar.people` key and `stores/people.ts`, `ownersLabel` and `RowTitle`, `projectList`'s ownership-first filing, the People hover action and menu item, owners in the hover cards. The focused suites pass locally, each file alone.
  - [x] (2026-10-28) Class 1a at the merge with master (df6c2826a, run 40786128124) found one typecheck error in `derive.test.ts`, fixed at 50a1ab992. reviewer-medium found one P2, the early toggle's replay (Decision Log, M5's build, item 11), fixed at 854178726.
  - [x] (2026-10-28) The first final gate (run 40786951312 on 53f147ef1) found one M5 regression. The People action sat on every row and took a line-center click at the sidebar's 200px floor (`e2e/shell.spec.ts:50`). Fixed at 54aab1ada: the toggle shows only where it can act. The same run's unit red was a test-side race, fixed with two others in tests: `OrgSection`'s clock, the teardown's `rm`, and the rekey crash setup.
  - [x] (2026-10-28) The final gate on 7e58d6984: run 40794571273, 48 jobs green and 3 skipped, `e2e:default` and `e2e:discover` among the green. One flaky line, `browser-cua.spec.ts:483` (M3's known one), was green on retry.
- [x] M7a — The project channel: the log reader, the Channel tab and people's words — *executable (re-planned 2026-11-06); first*
  - [x] (2026-11-06) Task 1, reviewed clean in three rounds (221c6daaf..64d278151; fixes 4fe3fac85..4e5e867bd): main's channel reader (the socket client, verification, the bounded cache with hash-bound migration checkpoints and the lifecycle projection, signed words scoped to their signer, deltas with `removed`), the session's commands and `close()`'s join, the `org.channel.*` schema and the `channel` tab kind. Gates green at 64d278151, 2d145630e and 7e5ff6d02 (runs 42171173230, 42173482918, 42176161523).
  - [x] (2026-11-06) Task 2, reviewed in three rounds, the last fix checked by the controller (3d355c066..7d113efb3; fixes a21cc2653..4e74435aa): the Channel tab (the projection folding main's verified events, the stream, the composer, Not sent, "as of" offline, Waiting on you with the MAWS ask answered in place, Channel in the project's menu), and main as the one source of a word's state, bound to its signer's context. Gates green at 7d113efb3, a8c03bcbc and 4e74435aa (runs 42181546717, 42190002590, 42194136958).
  - [x] (2026-11-06) Task 3, reviewed with one fix wave, checked by the controller (d2f99da15..7bd4dcd17; fixes 68f9b8f20, ee29e26aa): `test/org/channel.local.test.ts` on the Miniflare hub (the folded exchange, DX1 attested at migration, a revoked key's event and a forgery on A's transport counted and not drawn, words signed and unmacked on B's socket and drawn back, "as of" across a relaunch), and the Channel tab's e2e case in `e2e:settings` over a harness-only fixture with its screenshots; two layout fixes from them. Gates green: e2e:settings 42208872828 and 42214481766, static,unit,probes 42219970692.
  - [x] (2026-11-06) The branch: reviewer-medium in three rounds (fixes 912fc182f..8139e7713, the last round clean); master merged at 1675f282d and 9ebbacbc5; the final `--gates all --evidence` on 9ebbacbc5, run 42259619702, 55 jobs green with packaged and unit:darwin among them. Its one flaky line, `browser-cua.spec.ts:1028`, is explained from the code: a headless O17 scene with no M7a code in it, tracked.
- [x] M7b — The project channel: to-human messages across machines — *executable; after M7a; the owner's week (P5 acceptance 16) starts when it lands*
  - [x] (2026-11-06) Task 1, reviewed clean in two rounds (9327c77f2..a54248357; fixes ef3d17d7e, 832534dca): the one extraction of a message (`src/shared/owner/to-human-items.ts`), the spine's channel journal as an `ADDED_TABLES` entry, lane B from the owner channel's batches and the asks' own record, the start-path hold, the cuts, `channel.history` and the main-only `channel.changed` (`WIRE_MINOR` 29). Gates green: 42290932596, 42292712838 (cross-build, the downgrade scene whole), 42297329414.
  - [x] (2026-11-06) Task 2, reviewed by our task reviewer in three rounds and by the desk track in six (READY, their 601) (5a6b05638..f37817c55, with the org-protocol commits 40e793791 and 9e4b67f20): the seam and lane A's `#host` hand-off, `channel.history` with the per-lane `view` cut and opaque cursors, the project-scoped `channel` feed (`rl2.channel`, RL2 1.12, `WIRE_MINOR` 30), reach checks, a bounded streamed scan, the snapshot's restarts, and recovery from the let-go ids. Gates green: 42321083327 (full), 42328732994, 42331543046.
  - [x] (2026-11-06) Task 3, accepted by the architect (58e294092..19456cac9), with its review carried by the branch's reviewer-high: `machines.ts` (the spine and each machine's feed, gated on `rl2.channel`, with the older-peer fallback and a per-machine cache that belongs to one reader), the merge into `org.channel.*`, and `ToHumanEntry.tsx`. Gate green: 42336903199.
  - [x] (2026-11-06) Task 4 (33098354b..daf8d4a3c): `channel.local.test.ts` cases 5 and 6, plus an older-peer case (7/7, three runs in a row), and the e2e seed's to-human entries photographed, with two layout fixes. Gates green: e2e:settings 42341855912, static,unit,probes 42343748493.
  - [x] (2026-11-07) The branch: reviewer-high on `782790d38...4e35fb15c`, one Minor (journal order across history pages) fixed at 1d3caff96 and ba7d57c92; master merged at 4e35fb15c. `--gates all --evidence` there (42344559621): 53 green, with a real `library.spec` regression fixed at 9bb79f34e. On 9bb79f34e: static, unit 1–4, e2e:library, cross-build and packaged 1/2 and 2/2 green (42357252517, 42359252532). e2e:discover failed four times in Set up job on the mini, on codeload action-archive downloads, before any step ran (42344559621, 42357252517, 42359252532 attempts 1 and 2). CI-opt seeded the runner's action cache, and the discover job then passed: 42359252532 attempt 3, 9 passed, 1 skipped by design, no flaky line. M7b is reviewed and gated whole, and goes to the architect as #514.
- [x] M6a — Reader state and drafts per member — *executable; after M7b*
  - [x] (2026-11-07) Refresh at the cut: branch `p5-o8-m6a` from `p5-o8-m7b` at f4f99135f (stacked on #514, the architect's ruling, since `ADDED_TABLES` exists only there). Task 1's gates ran on the stacked tree and are development checks. #514 landed (9353f255b), and master ba401f5b8 was merged in at ee25ea1ec: M6a's base is master from here, with no stacked condition left.
  - [x] (2026-11-07) Task 1, reviewed clean in one round (968e62c34, 72b558be3, 19623e805): the spine's `reader_state` and `member_drafts` as `ADDED_TABLES` entries; `sessions.ts` and `drafts.ts` by reader, with a new turn marking every member unread; `HandlerContext.reader`, written only by `mawsd`'s front from the seam's dispatch; `session.reader.update` at `WIRE_MINOR` 31, answering `ReaderState`; `session.update` refusing any reader. Static gate green at 19623e805 (42373324095). 72b558be3's run 42372775732 was red on one type error, fixed at 19623e805.
  - [x] (2026-11-07) Task 2, reviewed clean. It took our task reviewer three rounds and the desk track four, closing on its delta check of 16f310a0d.
    - Built in d6347dda2, 80ccbfc65 and ab33757ae.
    - Fix waves: d5a4ccc3a, 00286c8ef and 54ceaa543; then 2a18c158f, 50e7c403e and d0e159f12.
    - The endpoint now offers `session.reader.update` and the drafts. Each call carries the authorization decision's reader, and is checked again at dispatch.
    - Every surface carries a member's own reading, proven per surface. An owner's queued change is checked at send.
    - Also in this task: the certificates parity fix the desk track asked for (65e0532b1, outside the reader work), and the client's record re-read on a reopened checkout feed (cd5ab7f28 and 16f310a0d).
    - Static green on every head, last 42385684134.
  - [x] (2026-11-07) Task 3, reviewed clean in two rounds (c3db6ff24, 166197fa4; fix cf5f833c5).
    - On a machine that keeps the rows, a remote lane B session's reading, pin and draft are the member's own, through `session.reader.update`, with its `ReaderState` applied. They survive a relaunch.
    - On a machine that refuses the rows, today's in-run fallback runs as before.
    - One session's draft saves are serialized and coalesced, and a switch to the fallback ends the queued ones.
    - The fix wave closed a late refusal overwriting the newest fallback draft, and a doubled seen write.
    - Static green at cf5f833c5 (42386392490).
  - [x] (2026-11-07) The branch, reviewed and gated as a whole. reviewer-medium ran four passes with a confidentiality lens; every data loss it found is fixed, and it found no disclosure. The desk track checked every endpoint and draft-path delta and found them correct. `--gates all --evidence` passed on b90a20de5 (run 42395007929): 55 jobs green, no flaky line. The PR is #518.
- [ ] M6b — Visibility and shares (O18's M5) — *executable; after M6a; its live proof is the staging run it shares with O18 M6, which needs the desk track's sminos executors and a real second member (the owner)*
  - [x] (2026-11-07) Refresh at the cut: branch `p5-o8-m6b` from master 48e0ed15a, after M6a landed as #518. The cited lines were reconciled, the parent re-pinned at Decision Log 248, and the plan made: four tasks (Decision Log, "M6b's refresh at its cut" and "M6b is built as four tasks").
  - [x] (2026-11-07) Task 1, reviewed clean. The commits: 776b239cd, 727a103e6 and 5c24e83d1 (endpoint only), 79dc87205 and a35f6cf5a; then the fix wave 5cc92783f and f443e16cd, merged at 7a8e5a47b.
    - What it adds: the `record.*` acts and `record.policy` behind sminos's `record`; the welcome's `record`; and the local door, served as `endpoint.local.act` and `.call` at `WIRE_MINOR` 32.
    - Reviews: our task reviewer took two rounds. The desk track's desk 632 found the acts correct and raised three P2s on `record.policy`; desk 633 closed them.
    - Static green at a35f6cf5a (42404533003) and f443e16cd (42406895430).
  - [x] (2026-11-07) Task 2, reviewed clean. The commits: fa42186a5, 237682977, 40b9742e6, 656527ca8 and 28eae9dfc; then the review's fixes, dad52c414, 56eaf7f55 and 4d95d25b6.
    - What it adds: `org.policy.get` and `.set` and `org.owners.add`; one confirmation per save, through `actMany` and `signActions`; and the rows reading each machine's channel listings, with two memberships per key, bound to the reader.
    - The enumerating rows test has 5,040 permutations plus 16,807 five-event sequences.
    - Reviews: our task reviewer approved it, then approved the three Minor fixes.
    - Static green at 4d95d25b6 (42410961560). One local run of `rows.test.ts`'s crypto-heavy marks case hit its 5 s timeout at a load average near 100, then passed on the committed code. Under CI it counts as a flake to explain.
  - [x] (2026-11-07) Task 3, reviewed clean. The commits: f4f81e35f, 9d6a52542, 539e8b815, bc22ad7b0, 8f1b003e4, 9ed8353a6 and 6546231d2; then the review's fixes, 3c09ac206 through 954c74ded.
    - What it adds: the Share sheet, the reach marks and the row menus; the private-listing churn fix in main; and `e2e/share.spec.ts`.
    - Reviews: the frontier review found I1, I2, M1 and M2, and its re-review closed them, with one Minor: actions-whole's blanket `aria-hidden` exemption, folded into Task 4. The architect's taste read added three fixes, all accepted.
    - Green at 6546231d2 (42417175074), and at 954c74ded (42420500958: static, unit, e2e:settings and e2e:cross-build).
  - [x] (2026-11-07) Task 4, reviewed clean. The commits: d04d960a5 and 3c13448dc (app), and 5bcd83565 and aef0c7353 (`apps/desk-hub/deploy`). Then two fix waves: d0c031dbf, 23b88d6cc, 3c8fb5cdc, a3954e3f3, 3c8d1b1e9, f6246b4a3, a21c6e561, 665e938e6 and fc6aff4cc; then 5ce55a8b8, a80ae3eaa and 055778370.
    - What it adds: `policy.local.test.ts`, run against a stand-in that holds each rpc to sminos's proof binding and field set. It also adds the reach harness's record-act widenings, with the items m6b-cutover, m6b-visibility and m6b-reader, the real-member steps for the sitting, and actions-whole's narrowed exemption.
    - Reviews: our task reviewer took three rounds (5 Importants, then 2, then none). The desk track took three verdicts: desk 641 (layer 1 clean, 4 P2s), desk 642 (ready, with 2 leftovers folded in) and desk 643 (ready, converged).
    - Green at 055778370 (42432343440: static, unit, e2e:settings and e2e:cross-build, hosted).
  - [x] (2026-11-08) Branch review clean. reviewer-high, with a security lens, found 3 P2s (eaafe05af, df906b6e9 and 95be41576, the last reviewed by the desk track as desk 644), and its re-review found the branch correct. Master 5b1f73877 merged in at 0db815f19.
  - [x] (2026-11-08) The final gate at 169108598 (`--gates all --evidence --lane hosted`, run 42438203920) is green on its first attempt: 55 jobs, with 2 matrix placeholders skipped and no flaky line. The commits after it are docs only. The PR is opened. The shared staging run is on the branch head (Decision Log, "M6b lands before the shared run", amended).
- [x] (2026-11-08) M4b — Machines and their rights — PR from `p5-o8-m4b`; the final gate green at 01450ac1c (42526195244, desk-web on its rerun; 42526210394)
  - [x] (2026-11-08) Refresh at the cut: branch `p5-o8-m4b`, cut from master bd2b59baa after M6b landed as #522. The cited lines were reconciled, the parent was re-pinned at Decision Log 251, and the plan made: six tasks (Decision Log, "M4b's refresh at its cut" and "M4b is built as six tasks").
  - [x] (2026-11-08) Task 1, reviewed clean. Commits: 099c7cf77 (the move), 0ad9a8ff5 (`grantProblems`), b2ddf6b1d (a type-only fix) and 3112033dd (the review's I1, canonicalizability). All four are `apps/org-protocol` and `apps/desk-hub`, for the desk track.
    - Our task reviewer took two rounds: I1 was fixed, and I2 was dismissed under the recorded decision. Its external adversarial cases pass 6/6.
    - Static and unit are green at 3112033dd (42446714963).
  - [x] (2026-11-08) Task 2, reviewed clean. The commits: e07f9f42c, 0537d9aff (`endpoint.local.grants`, `WIRE_MINOR` 33), 0adff8c99, then the master merge 79beb549f (#524), then 62c862351 and e086ef5a0 (the dispatch and the door).
  - [x] (2026-11-08) Task 3, reviewed clean. Commits: 2a3960e52 (the composers, by an executor lost in the crash), c8a8bc6e2 (its hidden red gate), a79eda70f (the hub client), 09a450ef6 (custody), d8dfc032f (the destination's own file), and the fix wave fb9743f0a and 09c349d2c (gcloud's logging off, uncertain writes, the error allowlist). Green: static and unit at 09c349d2c (42550283250).
  - [x] (2026-11-08) Task 4, reviewed clean. Commits: 5d225154d, 12db19412, and the fix wave dc67415cc and d39a90cbb (custody ends with its run, the active create's key reserved, hub work bound to its sign-in, `delegations.ts` split in two). Green: static and unit at d39a90cbb (42559947638); `e2e:settings` at 12db19412 (42556487805).
  - [x] (2026-11-08) Task 5, reviewed clean. Commits: 56a5dbd26, 5e1bca3f7, the fix waves 50dd920af and 404ff969b (a create bound to main's run, a row's Discard to its own slot, the key read's Retry, copy by phase) and c2e51a9a9 (the status's revision, the slot's held phase, publication from the signer's word). Green: static, unit and `e2e:settings` at c2e51a9a9 (42578958501).
  - [x] (2026-11-09) Task 6, reviewed clean. Commits: 785001ba2, 7e2b0885a, e0eb559fb (test-only). Green: `org-page.local.test.ts` 15/15 on three CI attempts at e0eb559fb (42584197185).
  - [x] (2026-11-09) Branch reviews clean after one wave: bac4a425e, 143f7ead2, 5fc80df73 (Decision Log, "M4c's branch reviews"). Green: static, unit and `e2e:settings` at 5fc80df73 (42592828180).
    - Reviews: our task reviewer approved it, with one Minor, the schema comment, which is folded into Task 3. The desk track found it READY: 674 on the projection, 683 on the dispatch and on the door as an amendment to M6b's door rule. Desk 683's two notes are folded into Task 3's first commit.
    - Green: static and unit 1–4 at e086ef5a0 (42468417824). The e2e:cross-build job the planner added is waiting on a rerun after a CDN 504 in its setup.
  - [x] (2026-11-08) Task 3, reviewed clean. The commits: 1f82a49ff (endpoint only), 1b9c48fa6, ca3f145ce, 7f7ba3acb, then the master merge 4050bb5ec (#534); fix wave 1, a610c538f and 309cf86e6; the master merge 4fdd40cd7 (#535, #536); fix wave 2, 65f17c80c, c79c19683 and 2822e9be9.
    - Reviews: the desk track found 1f82a49ff and 1b9c48fa6 READY (684). Our task reviewer took three rounds: an Important and a Minor, fixed in wave 1; an Important (the settlement delete revoking a re-listed name), fixed in wave 2; then approved, with one Minor left (a keyed 200 is logged as "deleted"), which Task 4 rewords.
    - Green: static and unit at 2822e9be9 (42480136294).
  - [x] (2026-11-08) Task 4, reviewed clean. The commits: f519c4804 (Step 0), b4888335e, 556e3061b, the spec commit ce4931a7e, and the fix waves b051e0b35; 9a35790bd, 5ccc78b0c, fe2bac5c1; a8aed197c. None touches `src/endpoint`, `apps/org-protocol` or `apps/desk-hub`.
    - Reviews: our task reviewer took four rounds (Decision Log, "M4b Task 4", item 12). The architect ruled the delivery route (push, then grant; every verdict final).
    - Green: static and unit at a8aed197c (42494746695).
  - [x] (2026-11-08) Task 5, reviewed clean. The commits: 484d9fd2f, 65a547a54, and the fix waves fccfe6803; 0d518e9a3 and f044b0e72; 7b1b1780f (0d518e9a3 and 7b1b1780f are main's scoped enrollment cancel).
    - Reviews: our task reviewer took four rounds (Decision Log, "M4b Task 5", item 10). The architect ruled the cancel's scope.
    - Green: static, unit and e2e:settings at fccfe6803 (42502411003, with its screenshots); static and unit at 7b1b1780f (42506305752).
  - [x] (2026-11-08) Task 6, reviewed clean. The commits: 63409dab2 and its fix wave f098db1ee, both test-only.
    - Reviews: our task reviewer found case 8 masked by the ledger read's push, which was fixed. The controller read the fix.
    - Green: `org-page.local.test.ts` 12/12 in unit 3/4 on three CI attempts at f098db1ee (42515095022).
- [x] (2026-11-09) M4c — Delegations — PR from `p5-o8-m4c`; the final gate green at 4d2b45261 (42594055817, unit:darwin and e2e:connectors on their rerun; 42609058582)
  - [x] (2026-11-08) Refresh at the cut: branch `p5-o8-m4c`, cut from master cfff902f7 after M4b landed as #539. The cited lines were reconciled, the parent was re-pinned at Decision Log 258, and the plan made: six tasks (Decision Log, "M4c's refresh at its cut" and "M4c is built as six tasks").
  - [x] (2026-11-08) Task 1, reviewed clean. Commits: e5655af5f (the move, `apps/` only, desk 701 CORRECT) and 76f72df85 (`checks.ts`). Our task reviewer's one Important, a retired diagnostic, is recorded as a decided exception (Decision Log, "M4c Task 1, the move"). Green: static at e5655af5f (42538332291); static and unit at 76f72df85 (42538499882).
  - [x] (2026-11-08) Task 2, reviewed clean. Commits: 1650daf4f (the unsent slot) and its fix wave 0e332c014 (publication bound to the holding run, the review's I1). Green: static and unit at 1650daf4f (42541105062) and 0e332c014 (42542743616).
- [x] (2026-11-09) M5b — Add owner — PR from `p5-o8-m5b`; the final gate green at 427ce3462 (42710549674; `packaged` 42717057290 on its rerun); its live proof is M8's step 7
  - [x] (2026-11-09) Refresh at the cut: branch `p5-o8-m5b`, cut from master e181a1944 after M4c landed as #543. Both waits were met. The scope shrank to the renderer and one local case, since M6b built the main side. The parent was re-pinned at Decision Log 260. The live proof moved to M8's sitting, as a staging step. The plan is two tasks (Decision Log, "M5b's refresh at its cut" and "M5b is built as two tasks").
  - [x] (2026-11-09) Task 1, reviewed clean. Commits: fea94bdaa (the sheet, both menus, `stores/local-owner.ts`) and the fix wave 4d33e84f9 (Share takes the same one-owner clause through one gate). Our task reviewer took two rounds. I1, the head skew, the architect accepted as residue (Decision Log, "M5b Task 1, the renderer", item 6). Green: static and unit at 4d33e84f9 (42702690877); `e2e:settings` at 4d33e84f9 (42701162112).
  - [x] (2026-11-09) Task 2, reviewed clean. Commits: 67af5b945 (the stand-in's `add_owner`, the lane A and lane B case, the share holder's refusal), 3767a4ba6 (share.spec's `showPeople`), 51b93834e. Approved on the first round, with two Minors: lane B's authorization fixture, and noise in the run's output. Green: static and unit at 51b93834e (42708248610); `e2e:settings` at 3767a4ba6 (42706609911, the share spec passing on its first attempt).
- [x] (2026-11-10) M8 — The deployment admin's end, and acceptance — the owner's sitting passed on 2026-11-10; this Mac's device is production's only root at org-state version 24 (Outcomes, M8)
  - [x] (2026-11-09) The sitting script, against master cf30dafdd: step 7 on staging first, then production steps 1 to 6, each with its role, its verb and what the owner sees; B4's steps 4 to 8 are done; the preconditions and what the desk track stages beforehand are in Concrete Steps, M8 (Decision Log, "M8's sitting script").
  - [x] (2026-11-10T05:17Z) Step 7, Add owner on staging: passed. B was added on lane A and lane B rows from the sheet, and after a relaunch both rows named both owners (on a second scene; Decision Log, "M8's sitting", item b). Teardown complete at v368.
  - [x] (2026-11-10T05:36Z) Step 1, the root add: version 23, two roots, on the second try (item e).
  - [x] (2026-11-10) Step 2: a check only, since B4 ran on 2026-11-07.
  - [x] (2026-11-10T05:38Z) Step 3, the revocation: signed by this Mac at version 24. The deployment admin device is removed, and its step-up and channel keys are revoked. The last `admin show` ran at 05:40:46Z.
  - [x] (2026-11-10) Step 4, the deletion: the admin's `keys.json` and `keys.json.org.json` are gone, and the directory is empty.
  - [x] (2026-11-10) Step 5, O15's check: one root, this Mac's device.
  - [x] (2026-11-10) Step 6, the acceptance run: items 1 to 6 recorded. Item 7 is cited from M7b's live check on production (P5 Decision Log 257): the owner's fresh look was not recorded at the sitting, and O15's closing verification takes it.

## Acceptance

Items 1, 2, 3, 4a and 5's display half have landed. The rest became executable on 2026-11-06: 4b, 4c, 5's add half, 6 (6a and 6b), 7 (7a and 7b) and 8.

1. **The org session (M1).**
   - A profile that never signs in creates no device keys, makes no network request, and has no `<userData>/org/`. `org.status` answers `{state: 'none'}`.
   - Signing in with a pairing code from `deployment admin pair --class native-mac`: the app runs Access's login transfer in the system browser, checks that `/api/me` names the code's org and member, reads the org's chain from its genesis and verifies it against the code's pins, posts its device entry with the code's MAC, and shows the entry's fingerprint. The fingerprint equals the one `pair` prints. Once the approving device lists the entry, the app reads signed in.
   - The held org state follows each version the hub announces, refuses a rollback and a fork, adopts a recovery transition, and survives a relaunch with no network. A relaunch is signed in again with no browser while the Access token lives.
   - `OrgSession.current()` is non-null exactly while the held head lists this device, under its member, with this profile's channel and step-up keys. `onChanged` fires at sign-in, sign-out, each adopted head (a link's `advance` included) and each change of the hub's credentials. While it is non-null, O7's links come up to the listed machines. An Access token that expires sets `hub` to null and leaves the device signed in, so the links keep the direct carrier.
   - A head that removes the device makes `current()` null, and the Org section says so. A hub that stops admitting the member (a `4403` close, `403 not-a-member`) reads `denied` and changes no trust state until a verified head does.
   - A damaged held chain fails closed: the hub's chain is taken again only if it holds the anchored version and head, and otherwise only an explicit re-anchor with a fresh pairing code opens it; an ordinary sign-in never moves the anchor. A rewind, and sign-out, each survive a crash at any point.
   - Proved by `src/main/org/*.test.ts` and `test/org/sign-in.local.test.ts` (the Miniflare hub, O13's real `pair`), and live on staging at the owner's hand.
2. **The remote rows (M2).** P5 acceptance 3's remote half, and O9's R1 to R6 (its Interfaces §G).
   - Every listing the hub holds for a machine in O7's RL2 roster that verifies against the held head is a row. One that fails is not, and is tried again at the next head.
   - A row's address is `<ref>/<listing session>`: lane A's engine session id, lane B's `appSessionId` (R1). It carries its lane (R2), its state and title (R4), its owners as member ids and its listing's project (R5), and the org key that project joins. A lane A row reads `foreign_held` (R3, as far as a listing can say: Decision Log, finding F6). Nothing else (R6).
   - The sidebar files a row under the org project its project joins by `smnsId`, computed with the signed-in org, when that project is listed, and otherwise under its machine's row (OX3). It draws its machine chip (T1), greys it while its machine is not `up` (T2), shows its state's glyph and counts it in its project's waiting and working rollup.
   - Only the signed-in member's own sessions are drawn; other people's wait for M5's toggle. A row whose address has a record is not drawn: the record is.
   - A `gone` revision removes the row, a higher revision replaces it, and a lower one is ignored, after a reconnect or a relaunch too. The rows survive a relaunch with the hub down, from a cache verified again at load, and a machine's restored tabs stay until this run's hub snapshot has applied.
   - Proved by `src/main/org/rows.test.ts`, `test/org/rows.local.test.ts` (a real endpoint's listings through the Miniflare hub), `derive.test.ts` and `Sidebar.test.tsx` (remote rows under org projects with machine chips, beside local rows), and live at the first cut-over machine.
3. **The app as the org's signer (M3).** The app's device, its key file carrying `excludedFromBackupAtCreation` (else registered again with new keys first), is a root beside the deployment admin, made one by the owner's `deployment admin root add` (the owner's sitting). It signs the weekly no-change successor, asking once with Touch ID at the first focus after the head turns 7 days old and never more than once a day (Q6), so the deployment admin's `refresh` stops. Every state it signs is kept in a durable pending slot before it is sent, and nothing else is signed while one is unsettled. Before signing anything it refuses a state that makes a revoked key current again, offers the superseded states' revocations after a root transition, warns before dropping a delegation, refuses a delegation prefix that equals, nests in or covers another or a name, and one whose prefix or id was used before (revoked ones included), and renews a delegation only while it is live (P5 Decision Logs 26, 30 and 31). Each removal it signs is also delivered to every machine and acknowledged (RL §5.2).
4. **The Org page (M4).**
   - **4a (M4a).** Settings › Org is in Q1's four groups.
     - From the app, a root adds and removes members, changes a role or an email, pairs a device (its own, endorsed in the same Touch ID, or another member's first device through H1), removes a device, and makes an admin's device a root.
     - Each change is shown in a sheet before it is signed. A problem `successorProblems` names refuses before Touch ID.
     - A later device of a member who doesn't sign is stated as not yet possible, rather than offered.
     - A refusal shows under the control that sent it.
     - Proved by the unit suites and `test/org/org-page.local.test.ts`, including a second member added, paired, promoted, demoted and removed on the local hub.
   - **4b (M4b).** From the Org page an admin enrolls a machine with a code, comparing name, ref and key id. A machine's owner (an admin for an org-owned one) changes its owners, drops it (its key retired, or revoked), and grants, changes and withdraws a member's rights on it. Each grant is a signed record shown before Touch ID and delivered to the machine. A grant the machine's ledger lost (a lost ledger, or a new key) is re-signed for its current key, each shown first (P5 Decision Log 30, with the reason as corrected on 2026-11-06). Proved by the unit suites, `test/endpoint/grants-call.test.ts` and `org-page.local.test.ts`'s steps 7 to 11.
   - **4c (M4c).** An admin creates, renews and drops a delegation from the Org page under M3's checks, which now live once in `org-protocol`. A new delegation's code goes from main into the named Secret Manager secret and nowhere else, checked by a fake gcloud. A renewal extends the state, then the hub's key, and a half-done one says so and retries. Proved by the unit suites and `org-page.local.test.ts`'s steps 12 to 14.
   - An admin enrolls a member's first device directly (P5 Decision Log 34).
5. **Owners are visible and carried (M5, M5b; P5 acceptance 11).** Every row of a session you don't own alone shows its owners, as first names after the title, and its hover card lists them all (Q2). A per-project People toggle, off by default and remembered per project, adds other people's sessions, each with its owners and machine; while it is off the project row says "+N others" when there are any (Q3). An owner adds an owner from the row's menu, by a step-up `record.owners {add: true, member}` act (P5 Decision Log 50) that the session's machine executes through sminos, and the session's next listing names them (M5b).
6. **The people model (M6a, M6b; P5 acceptance 12; O18's M5).**
   - **6a.** Unread, last seen, pinned and drafts are kept per session and member. The machine's owners share the session's own state, and every other member has their own, locally and over RL2, so nothing a second person reads, pins or types changes what the owner sees (P5 Decision Log 36).
   - **6b.** An owner sets a session's general access (Private, Listed, Org can view, Org can talk) and its shares (Can message, View, Converse, Approve) in the Share sheet, with one Touch ID per save. This works on another machine or on this Mac. A private session reaches its owners and shares through the channel listing, and nobody else's rows. A row whose access isn't the default is marked.
   - **Live**, on the staging org with a real second member (the run shared with O18 M6): the second member sees listings by each session's visibility and their own sessions in full; with sessions at the default `listed`, `converse` and `approve` are refused on sessions not shared with them; a Can message share lets their agents message and not read; and their reading changes nothing of the owner's.
7. **The project channel (M7a, M7b).**
   - **7a.** A project's Channel tab shows its log across machines, verified in the app: people's words, agent-to-agent traffic folded per exchange, migrated events "attested at migration by `<machine>`" (O14's Interfaces §D), and the cards waiting now, answerable inline. It sends the owner's words v2-only (P5 Decision Log 75), and draws its cache "as of" when offline.
   - **7b.** It adds every session's to-human messages, questions and answers from every machine, each with its session's title and machine chip, an offline machine's from the cache "as of" its time.
8. **The deployment admin's end (M8).** The owner's app device is a production root (the root-add sitting, its first step). After O14's B4 steps 4 to 8, the app signs the successor that revokes the deployment admin device and every machine acknowledges it; its key file and anchor are deleted; and no device but the app's is a root (P5 Decision Log 69; O15 checks it). Items 1 to 7 run as the acceptance, with evidence in Outcomes.

## Execution

### Constraints (bind every milestone)

- **The trust model is RL's, and the app adds no authority.** The app verifies whatever it draws or acts on against the org state it holds: the chain from the pinned genesis, each listing (`verifyListing`), each endpoint record (O7). The hub relays and stores, and none of its answers is trusted (RL §5.9). Every RL5, RL6 and RL8 byte is `org-protocol`'s, and the app reimplements none (P5's protocol-package rule). The held chain follows the rules of `src/endpoint/org-sync.ts`, the endpoint's held state, case by case, through the package's verifiers (M1).
- **Main holds every key and token.** Device keys load only through `src/main/device/keys.ts` and sign only through it and `src/main/device/step-up.ts` (P5 Decision Log 53). The Access token lives only in `src/main/org/`. `org.*` carries statuses, fingerprints and listing fields to the renderer, never a token, a key, a nonce or a pairing secret.
- **Electron-free modules.** Everything under `src/main/org/` imports no Electron at runtime and runs under vitest's `node` project. The browser opener, step-up's confirmation, wake and network probes and the build string are injected from `src/main/index.ts`. (`src/main/org/session.ts` and `dev-session.ts` are O7's, under the same rule.)
- **How main imports the protocol package.** By relative path with the `.ts` extension, as `src/main/device/keys.ts` does (`'../../../apps/org-protocol/src/index.ts'`), so electron-vite bundles it. Tests may import `org-protocol`. Main never imports `src/endpoint/` (its lint rule) or `apps/desk-hub/` sources; tests may.
- **The wire.** `org.*` is main-to-renderer traffic, owned by main, graded `client` in `src/shared/ipc/grades/org.ts` (OX9), and outside the wire manifest. M1 and M2 bump no `WIRE_MINOR`, take no settings version, add no `IpcError` code (`IPC_ERROR_CODES` is an enum; O1), change no RL2, RL3 or RL4 message, and add no e2e group.
- **The protocol, the hub and the endpoint are as landed.** No milestone changes anything under `apps/org-protocol/src/`, `apps/desk-hub/src/`, `apps/desk-hub/deploy/`, `src/endpoint/` or `apps/desk-web/`. A need there is a contract request to P5's writer (Interfaces §I). One exception, the architect's ruling (Decision Log, 2026-10-28): M3 adds `deployment admin root add` to `apps/desk-hub/deploy/admin.ts`, its line in `production-run.sh` and its test in `apps/desk-hub/test/deploy/admin.test.ts`, which the desk track's owner reviews.
- **One sign-in.** The production `OrgSession` (M1) is the only provider besides O7's development source behind `MAWS_DEV_ORG`. Nothing else in main signs in to the hub or holds an org state.
- **Taste.** M1's Settings › Org section is the least UI a sign-in needs. M2's rows use O6's settled forms T1 to T5 and the existing glyphs, and add no menu, owner label, toggle or control. Anything beyond that is an owner question.
- **Dependencies.** One new: `tweetnacl` 1.0.3, exact, in `devDependencies` (bundled into main as `ws` is), for the login transfer's sealed box (M1). Otherwise `ws` 8.22.0, zod 4 and `org-protocol` (workspace).
- **Machines and gates.**
  - Class 1a runs through `cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool`.
  - Mac e2e runs with `--runner macos --lane hosted` for the groups in `.github/workflows/gate.yml`'s hosted list.
  - On this MacBook, run one focused vitest file at a time after `pnpm install --frozen-lockfile`. Run no e2e of an engine or connector scene, and nothing that touches the Keychain or raises a TCC or firewall dialog. Tests inject `excludeFromBackup` into `loadDeviceKeys`, a `confirm` into step-up and a browser opener into the login, so neither `osascript`, Touch ID nor a browser runs.
  - Before `ci-gate`, run `npx eslint` on the touched files.
- **Live tests run on staging only, at the owner's hand.** A login transfer needs the owner's browser and an approval needs the owner's terminal. No agent runs `production-run.sh` or signs a device into production; production's sign-in is the owner's rollout (Concrete Steps).
- **Hands off.** Never touch the owner's running MAWS, its build output under the main checkout, or its user data; every profile is a scratch `MAWS_USER_DATA`. Never read `~/.config/claude-secrets` or `~/.cloudflared`. Never print a token, a pairing code or a key. Never stage `spikes/gws-onboarding/`, `.playwright-cli/`, `node_modules` or `plugin/`. Never edit the charter, P5, the remote layer, the ledgers or `docs/tech-debt-tracker.md`; debt and residue go to this document's record and the PR body.
- **Commits.** End every commit message with `Sminos-Session: GUI AI agent workspace charter#37052769 (MAWS on macbook)` as a second `-m`, or the line the executor's own session is given. Add no other trailer. Never rebase. Merge origin/master in when a branch needs it.
- **Review.** Each milestone lands by its own PR with doperpowers:reviewer-high before it goes to the architect: M1 is the device side of the org's trust (it pins the chain, registers a device and holds a bearer credential), and M2 decides what the app believes about other machines' sessions. Later milestones are reviewed at the rung their re-plan names.
- **Amended 2026-11-06** (Decision Log, "the constraints for the rest"): M4b, M4c, M6a, M6b and M7b change `src/endpoint/`, `src/services/` and `src/mawsd/endpoint-seam.ts`, and M4b and M4c move code into `apps/org-protocol/src/`. The desk track reviews every `src/endpoint` and `apps/org-protocol` hunk, in commits of their own. `apps/desk-hub/src/` stays as landed: the renew route M4c consumes is the desk track's PR. No milestone changes the RL4 `Action` shape (`apps/org-protocol/src/action.ts`: its keys, encodings or bounds) without telling the architect first. sminos's `record_proof` refuses `bad-shape` on any act that isn't exactly what `isAction` accepts, so a shape change must ship with a sminos release, or every `record.*` fails closed (the desk track, 2026-11-06). The bullets above stand as written for M1 to M5. For the rest, on this MacBook: eslint runs on one file at a time and never over more than one, and typechecks, broad lint and full suites go to the gate. The gates are the worktree's own `scripts/ci-gate.sh W --gates <list> --runner macos --label <label>` (Concrete Steps, "The rest"), not the class 1a lines above.
- **Amended 2026-11-06** (Decision Log, "M7b's channel feed"): `apps/org-protocol` is touched by M4b, M4c and M7b's channel feed. M7b's change is `'channel'` in `MachineFeed` and an RL2 minor bump (12, after #506's 11), in a commit of its own for the desk track's review, and it needs no hub change.

### Orientation

- **The hub, for an app** (`apps/desk-hub/src/worker.ts`; the Registry in `objects/registry.ts` and `objects/org-chain.ts`; paths and shapes in `src/protocol/identity.ts`).
  - Every route takes a member that Access admitted: the Worker verifies `Cf-Access-Jwt-Assertion` and resolves its email to a member through the head's `members` (`Registry.resolve`), else `403 not-a-member`. A native client sends `cf-access-token: <app token>`, which Access turns into that assertion (P5 Decision Log 38). The suites' stand-in for Access (`apps/desk-hub/local/standin.ts`) admits `x-desk-standin-user: <email>` instead.
  - Every Worker answer but a WebSocket's `101` and an event stream carries `X-Desk-Build`. An answer without it came from Access (or something else in front of the Worker).
  - `GET /api/me` answers `{org: {id, …}, member: {id, email, role, created}}`.
  - `GET /api/org/state` answers `{head, transitions, certificates}`; with `?since=<version>` it adds `chain` (oldest first, about 1 MiB a page) and `more`. `deployment admin`'s `readServed` pages it from genesis.
  - `POST /api/devices/pending` takes `{deviceId, class, keyStorage, channelPub, stepUpPub?, passkey?, mac}` as the signed-in member and answers `201 {pending: {…, member, created, expires}}`. An entry lives `PENDING_DEVICE_TTL_S` (600 s), a member holds at most 8 (`409 too-many`), a device id posted again replaces its entry, and the hub never checks the MAC. `GET` lists only the caller's own member's entries.
  - `GET /api/listings[?project=]` answers `{listings, endpoints}`, every stored listing but the withdrawn.
  - `GET /api/registry/socket?app=1` is a WebSocket. It sends DX3's `grid` frame, then `state {version}` when the hub holds a state, then the listings in `listings {records, last}` pages of at most 256 KiB, then a `state` notice at each accepted state and a `listing {record}` as each is stored (a withdrawn one included). A frame over 1 MiB comes as numbered `part` frames (`apps/org-protocol/test-support/socket.ts`, `PartJoiner`). A member a new state removes is closed with code `4403`. `apps/org-protocol/test-support/registry-socket.ts` is a working reference client.
  - A certificate or its retirement stored by a devcloud VM changes no state version and sends no app frame.
- **The pairing exchange** (`apps/org-protocol/src/pairing.ts`; RL §5.3). The approving device shows `smns-pair-v1.<base64url canonical JSON>` carrying `{hub, org, member, roots, recoveryPub, k}`. `decodePairingCode` accepts only the canonical spelling. The new device posts its entry with `pairingMac(k, {org, member, device})`. The approving side lists the member's pending entries, keeps those whose MAC verifies under `k` (`judgeEntry` in `apps/desk-hub/deploy/admin.ts`), refuses two at once, shows `pairingFingerprint(org, member, device)` (`xxxxx-xxxxx`), and after the person compares it with the new device's screen and confirms, signs a successor adding the device with an `endorsement` by the admin device. Today the approving side is `deployment admin pair --class web-cards|native-mac` (O13 M2), which polls every 2 s and prints the code to the terminal and the clipboard. Its tests drive it against the suites' local hub (`apps/desk-hub/test/deploy/admin.test.ts`).
- **The org state's verifiers** (`apps/org-protocol/src/org-state.ts`, `org-view.ts`). `verifyPinnedChain(chain, transitions, pins)` verifies a run from genesis anchored to a code's pins. `advanceHead(head, states, transitions, accepted)` adopts the successors that verify. `verifyRewind` admits a recovery transition from below the head. `memoryOrgView` holds a run in memory, unpersisted. The root set is the admin devices' step-up key ids (`OrgState.root.keys`). The endpoint's persisted view, `EndpointOrg` in `src/endpoint/org-sync.ts`, is the reference for every adoption rule: rollback below the high-water mark, fork at the held version, and rewind on a recovery.
- **The device in main** (`src/main/device/`). `loadDeviceKeys(profile, deps)` makes `<profile>/device/keys.json` on its first call (0600 in a 0700 directory, both checked, never regenerated or repaired) and returns `{keyStorage: 'software', channel, stepUp, excludedFromBackupAtCreation}`. The mark is true only for a file created after `device/` was excluded from Time Machine (P5 Decision Log 71). Nothing calls it in production yet. `createStepUp({device, key, confirm?})` signs an RL4 action after `promptTouchID`. The file holds no device id.
- **O7's seam, being built** (O7 Interfaces §B and §E). `src/main/org/session.ts` holds `OrgSession {current(), onChanged()}`, `SignedIn {identity, view, stepUp, hub}`, `HubAccess {url, headers()}` and `signedOut()`. `src/main/org/dev-session.ts` signs an unpackaged build in from `MAWS_DEV_ORG`. `src/main/index.ts` passes `startMachines` the development session when that is set, else `signedOut()`. O7's `RemoteSource` keeps one link per machine in the held head and its live certificates, the local ref left out (O7 M1, "Which machines get a link"), and `Machines.onRemote(listener)` reports the roster's refs.
- **Listings** (RL6; `Listing` and `LISTING_GONE` in `apps/org-protocol/src/types.ts`; `verifyListing` in `records.ts`). A listing is `{org, machine, session, revision, issued, fields: {owners, project, lane, state, title}}`, signed by its machine's key. The endpoint (`src/endpoint/listings.ts`, `rl10/members.ts`) lists a lane A session under its engine session id and a lane B session under its `appSessionId` once joined. `project` is sminos's project id, the `smnsId` of OX3. `owners` are member ids, `@machine` resolved. `state` is sminos's word for the session (`busy`, `idle`, `waiting`, `stopped`, `done`, `failed`, …). A `private` session is never posted, and its listing reaches its owners and shares only through `endpoint.listings` over a channel. sminos sends no `access` or `shares` yet, so no session is private today.
- **The renderer's sessions** (`src/renderer/src/`). `stores/sessions.ts` holds every machine's records, projects and digests by address. `ipc/events.ts`'s `connectShell` snapshots a machine when its link comes up (`engine.sessions`, `attention.list`, `session.list`, `session.projects.list`, `session.digests`) and keeps a tab while its session is known (`knownTab`). For an RL2 machine those reads are refused (O10 M5 doesn't offer them), and the machine never counts as loaded. `stores/org-projects.ts` builds the org index (`orgIndex`: keys, checkouts, `listed`) and files a record (`rowOfSession`). `sidebar/derive.ts` (`projectList`, `projectSessions`), `Sidebar.tsx`, `SessionRow.tsx` and `HoverCard.tsx` draw the tree. `app/MachineChip.tsx` and `app/machine-mark.ts` draw T1 and T2. `attention/glyph.ts` holds the status glyphs. `settings-tab/SettingsView.tsx` lists the Settings sections (`ORDER`; the layout's `SettingsTabSchema` enum).
- **OX3's join** (`src/main/index/org-project.ts`). A checkout's key is `smns:<id>`, `remote:<remote key>`, `repo:…` or `folder:…`, and its `smnsId` is the `.smns` file's id, or for `remote:` sminos's `repoProjectId(org, key)` once `machineEnrollment()` names the org. That function returns null until this machine's endpoint enrolls (O10 M10, then O14's cutover of the MacBook), so on the MacBook a `remote:` checkout has no `smnsId` through M2's early life (Surprises).

### Plan of Work

M1 runs now and lands by its own PR. M2 needs M1 and O7 M1 on master, and lands by its own PR. M3 needs M1 and O7 M1 (both landed) and lands by its own PR, reviewed at reviewer-high, since it signs the org state; its owner's sitting follows M1's. M4a needs M3 and O11's H1, both landed, and lands by its own PR, reviewed at reviewer-medium; the first two commits on its branch (the move and the pre-sign function) are the desk track's to review. M4b and M4c need M4a. M5 needs M2 (landed) and lands by its own PR after M3's, reviewed at reviewer-medium; M5b needs O10's offer row and O12's executor (Interfaces §I). M6 needs M5 and O3. M7 needs O7 M2 and M6 and O3, and its people's words wait for O14's last machine. M8 needs O14's B4 and every milestone before it. Each advisory milestone is re-planned, with its own buildability round, when its dependencies land and the owner has answered its questions.

**The rest, re-planned 2026-11-06** (Decision Log, "the re-plan of the rest"). The order is M7a, M7b, M6a, M6b, M4b, M4c, M5b, then M8 (the architect). Each lands by its own PR to the architect, built under doperpowers:subagent-driven-execution, a milestone per landing.
- **Reviews.** reviewer-high with a security lens on M4b, M4c, M6b and M8, which sign or change the org state, a grant or a session's reach. reviewer-medium on M7a, M7b and M6a, with a confidentiality lens on M7b's feed and M6a's reader routing. The desk track reviews every `src/endpoint` and `apps/org-protocol` hunk.
- **The owner's week** (P5 acceptance 16) starts when M7b lands.
- **The shared staging run.** M6b's live proof and O18 M6 share one staging run. It waits on:
  - M6b's offers on master;
  - the desk track's executors (sminos 1.38.0 or later);
  - a real second member, admitted by the owner's Access change.
- **M5b lands** only once the desk track's `record.owners` executor and DL190 (b)'s fix are on master. Both were met at its cut (2026-11-09). Its live proof moved to M8's sitting.
- **M8 is last.** It is owner steps and evidence. Its first step is M3's root-add sitting, and its revocation waits on B4's steps 4 to 8.

### M1 — The app's org session

**At its end.**
- Settings › Org signs this Mac into the org from a pairing code: Access's login transfer in the system browser, the device's registration with its fingerprint, and the approving device's approval. A relaunch is signed in with no browser trip while the Access token lives.
- Main holds the org's signed chain from its genesis, verified against the code's pins, on disk, and follows each new version the hub announces.
- A production `OrgSession` (O7 §B) answers `current()` from the registration, the held head and the device's keys, and is the session main hands `startMachines` when `MAWS_DEV_ORG` is not in force. O7's links come up in production.
- A Registry feed holds the app's `?app=1` socket for whichever session is signed in, and hands its frames to the session (state notices) and to M2 (listings).
- A never-signed-in profile is untouched: no keys, no files, no requests.

**Touches.**
- New, under `src/main/org/`: `org-session.ts` (the production session and its service), `held.ts` (the held org view), `access-login.ts` (the login transfer and the stand-in), `hub-client.ts` (the hub's HTTP routes as the app uses them), `registry-feed.ts` (the `?app=1` socket), `files.ts` (`<userData>/org/`), `register.ts` (the `org.*` handlers), `timing.ts`, and their tests.
- `src/main/org/session.ts`: O7's (Interfaces §B there). If O7 M1 has not landed when M1 starts, M1 creates it with O7 §B's text verbatim (its types and `signedOut()`). Whichever of O7 M1 and O8 M1 lands second takes the first's file and keeps both compositions in `src/main/index.ts` (P5 Decision Log 50's rule).
- New: `src/shared/ipc/schema/org.ts` and `src/shared/ipc/grades/org.ts`, registered in `src/shared/ipc/schema.ts` and `src/shared/ipc/grades.ts`.
- New: `src/renderer/src/settings-tab/OrgSection.tsx` and its test. Changed: `src/renderer/src/settings-tab/SettingsView.tsx` (`ORDER` gains `'org'`, last) and `src/shared/ipc/schema/layout.ts` (`SettingsTabSchema`'s section enum gains `'org'`, appended as `voice`, `browser` and `artifacts` were).
- Changed: `src/main/index.ts` (the composition below), `package.json` and `pnpm-lock.yaml` (`tweetnacl` 1.0.3).
- New: `test/org/sign-in.local.test.ts`, and `vitest.config.ts` adds it to the timing-node list as O7's local suites are.

**Interfaces.** It produces Interfaces §A (the production session and its service), §B (`org.*`), §C (the files), §D (`HeldOrg`), §E (the login), §F (the Registry feed) and §H's timing. It consumes O7 §B, `loadDeviceKeys` and `createStepUp` (O10 M9), `org-protocol`'s pairing, org-state and view functions, and `excludeFromBackup` (`src/main/device/backup-exclusion.ts`).

**Decisions.**

*Signing in starts from a pairing code.*
- **The code is the trust anchor.** It carries the hub, the org, the member, the root key ids and the recovery key (RL §5.3), so the app verifies the hub's chain from genesis against pins it got by hand, never from the hub. Rejected: signing in by Access alone and trusting the hub's chain on first use, which lets a hostile hub hand the app an org of its own making.
- **What makes the code acceptable.** `decodePairingCode(text.trim())` must return a code whose `hub` is `https:`, or `http:` on a loopback host only in an unpackaged build where `MAWS_DEV_STANDIN_USER` names a person (the stand-in, §E); otherwise the attempt is refused `bad-code`. If this profile holds a registration, the code must name its org and hub; otherwise it is refused `other-org`. A refusal writes nothing.
- **A held registration makes the code a sign-in.** If this profile holds a registration for the code's org, a code given to `register` is read as "sign in" (the login transfer alone). The held pins, chain and anchor stay; only `reanchor` (below) replaces them.

*The registration, step by step* (the `registering` steps of the status in §B).
1. **`browser`.** The login (§E) runs against `code.hub` and yields a hub credential.
2. **`checking`.**
   - `GET /api/me` must answer the code's org and member. Another member, or `403 not-a-member`, is refused `not-member`, naming the email Access signed in when the answer or the token's `email` claim names one.
   - `loadDeviceKeys(userData)` is called here, the first time ever on this profile. A `DeviceKeysError` is refused `keys`, with its reason.
   - The device's id is `keyId(keys.channel.pub)`, and its entry is `{id, class: 'native-mac', keyStorage: 'software', channelPub, stepUpPub}`.
   - The chain is read from genesis (`?since=0`, every page) and verified with `verifyPinnedChain(chain, transitions, {roots: code.roots, recoveryPub: code.recoveryPub})`. A verdict that fails, a run that stops short of the served chain, a served head that isn't the run's last state, or a head of another org is refused `chain`, naming the verdict.
   - If the head already lists this id under the code's member with both these public keys, registration is done (go to 4).
   - If either key's id is in the head's `revoked` or `retired`, or the device id is listed under another member or with other keys, the attempt is refused `removed`. Registering again needs new keys, which M3 builds.
3. **`approval`.**
   - The app posts its entry to `/api/devices/pending` with `pairingMac(k, {org, member, device: entry})` and shows `pairingFingerprint(org, member, entry)` with the entry's `expires`.
   - It reads the chain from the held head every `APPROVAL_POLL_MS` and adopts what verifies (`advanceHead`, in memory only).
   - It is done once the head lists the entry, under the member, with the same keys.
   - Past `expires` with no such head it is refused `expired`. A `409 too-many` or any other answer is refused `hub` with the status and the hub's `error`.
4. **Done.** The files are written in this order: `chain.json`, `access.json`, `registration.json` (§C). The registration file goes last, so a crash before it leaves `none`, and the other two are rewritten by the next attempt. The status turns `registered`, `current()` turns non-null, `onChanged` fires, and the feed opens.
- **`cancel`** stops any step, discards what is held in memory, writes nothing, and reads `none` (or the held registration's state, for a sign-in).
- **Rejected:** a random device id kept in a file of its own, which can drift from the keys it names. The derived id changes exactly when the keys do, which is when the org must see a new device (`removals()` in `src/endpoint/org-sync.ts` treats changed keys so). Also rejected: making keys at startup, which would give every e2e and dev profile a key file and an osascript call.

*The Access login transfer* (§E has the protocol's facts).
- **The flow `cloudflared access login` uses** (P5 Decision Log 38): the system browser and a polled, sealed transfer. It is proved against staging by U9's spike (O11 M7). The spike's prototype is outside the repository, so every fact it relied on is in §E.
- **The app keeps the app token and discards the org token.** The app token admits this person to the hub alone for the Access session (720 h on staging). The org token would sign the person in to every Access application of the team, so holding it buys a browserless renewal at the price of a credential far wider than the hub. Renewing is one browser trip per Access session (open question Q7). Rejected: keeping the org token, as `cloudflared` does.
- **The token is a 0600 file**, `<userData>/org/access.json`, in a 0700 directory excluded from Time Machine at its creation (`excludeFromBackup`, best effort, logged on failure). Rejected: the Keychain through `safeStorage`, which ties a hub credential to Chromium's store (U7's problem) and may prompt in an unsigned build. The token admits only to the hub, which can't act (RL §5.9).
- **Its end.** It reads expired `TOKEN_SKEW_MS` before the JWT's `exp` (decoded, not verified: the app only schedules by it), or at the first hub answer without `X-Desk-Build` whose status is 401, 403 or a redirect. Expired, `SignedIn.hub` becomes null, `onChanged` fires, and the feed closes. The device stays signed in, so O7's links keep the direct carrier and the cached endpoint records. "Sign in again" is a browser trip, after which `/api/me` must name the same member.

*The held org view* (`held.ts`, Interfaces §D). It implements O7's `OrgView` over a whole chain kept on disk, under these rules, each `EndpointOrg`'s:

| Offer | Rule |
|---|---|
| The first chain, at registration | `verifyPinnedChain` against the code's pins; the whole served run, or nothing; the anchor (below) set from its genesis and head |
| States from the hub, or from a link's handshake (`advance`) | `advanceHead(head, states, transitions, accepted)` adopts the run that verifies; written to disk, then listeners told |
| A recovery transition whose `fromVersion` is below the head | `verifyRewind(head, t, pins.recoveryPub, accepted)`; its base is the held state at `fromVersion`; the first state under it must pass `verifySuccessor(base, s, [t])`; the states after `fromVersion` move to `superseded` (kept for M3's offer); the high-water mark follows the new head |
| A served head below the high-water mark | refused `rollback`, logged; the status's `problem` says so |
| A served head at the held version with another hash | refused `fork`, logged; `problem` says so |
| A state that follows nothing held | ignored, logged once |

- Adoptions run one at a time, each against the head the one before left, as `memoryOrgView`'s queue does.
- `since(version)` answers the held states after `version` and the transitions from it, for a peer that is behind.
- `certificates()` answers the set the hub last served. Its consumers verify it (`machineKeys`, `verifyListing`), as the endpoint keeps it.
- **The whole chain is kept,** from genesis, with `superseded`, `accepted` and the transitions. At P5's scale that is a few kilobytes a week. The later admin duties need it: the superseded states' revocations after a root transition (P5 Decision Log 30), and a check of each new state against its predecessor. Rejected: the endpoint's 30-day window, which would lose what M3 offers. Also rejected: moving `EndpointOrg`'s adoption into `org-protocol` now, which changes O10's landed module for no behaviour of its own. One adoption shared by the endpoint and the app is a debt row (Decision Log).
- **The anchor.** `registration.json` keeps `anchor {genesis, version, head}`: the genesis state's hash, and the held head's version and hash. It is the trust that outlives `chain.json`, as `deployment admin`'s anchor file is for its device (`verifiedHead`). It is set at registration and moved after each adoption, a rewind's included: `chain.json` is written first, then the anchor (`saveAnchor`), so a crash between leaves the anchor naming a state the new `chain.json` either still holds or records as superseded, and the next load moves it up.
- **At load,** the held chain is checked as one run from the anchored genesis, not pinned again:
  - `chain[0]` hashes to `anchor.genesis`, and `verifyGenesis(chain[0])` passes;
  - `advanceHead(chain[0], rest, transitions)` adopts every state held, and the run's last state is the held head;
  - the anchored state is accounted for: the chain holds `anchor.version` with hash `anchor.head`, or `superseded` holds it, in which case a transition in `accepted` with a `fromVersion` below `anchor.version` authorized the held chain's state at `fromVersion + 1` (which the one-run check verified through it), and the superseded states hash-chain from that same base. The second case is a rewind whose anchor write a crash cut off.

  The pins are not checked again: a recovery may have rewound below the state the code's roots first signed, and `verifyPinnedChain` would then refuse a chain `verifyRewind` admitted (round 1's finding, reproduced against the package).
- **A held chain that fails that check, or doesn't read, fails closed.** `current()` is null, and the status's `problem` is `held-chain`. The app reads the hub's chain from genesis and takes it only if it passes the same one-run check from `anchor.genesis` and holds `anchor.version` with hash `anchor.head` on its own line of states. A served chain that a recovery rewound below the anchor is not taken: the history `verifyRewind` needs (the accepted transitions and the authenticated base) went with the damaged file, and an old genuine recovery replayed without it would pass (round 2's finding). Anything else stays closed until the owner re-anchors (`reanchor`, below): an explicit act, since it gives up the old high-water mark. Rejected: re-reading from genesis against the pins alone, which lets a stale or hostile hub restore an older chain, removed devices and machines included.
- **Re-anchoring** (`org.reanchor {code}`; the service's `reanchor`) is the one way out of `held-chain`, and it is refused `busy` in any other state. It takes a pairing code for the registration's org and member, from a device the owner trusts. It runs registration's `checking` step with that code's pins: the login only when no live credential is held; `/api/me`; the chain from genesis verified by `verifyPinnedChain`; and the head must list this device under the member with these keys, else `removed`. Then it writes `chain.json` and a new anchor in that order. Ordinary `register` and `signIn` never write the anchor. The Org section shows, in `held-chain`, the problem in words, a "Pairing code" field and a Re-anchor button, with one line saying it replaces the org state this Mac trusted.

*Following the hub.*
- While signed in with a hub credential, the Registry feed (§F) holds the `?app=1` socket. At its open, and at each `state {version}` above the held head, the session reads `?since=<held version>`, every page, and adopts it.
- Every `CERTS_REFRESH_MS` it reads `GET /api/org/state` with no `since` for the head, the transitions and the certificates. A changed certificate set fires `onChanged`, since O7's roster includes live certificates. The poll exists because no frame announces a certificate (Interfaces §I asks O11 for one).
- **A close with `4403`, or `403 not-a-member` on any hub request, is not a verified removal.** The hub closes the sockets of a member a new state removed and then refuses that member everything, `/api/org/state` included, so the removing state can't be read from it. The session reads `hubAccess: 'denied'`: `SignedIn.hub` is null, the feed stops and doesn't retry, and the device's trust doesn't change, since an unsigned close or refusal proves nothing. The held head stays until a verified successor drops the device, carried by a link's handshake (`advance`) or by the hub after a later sign-in. Meanwhile the endpoints, which hold the removing state, refuse the device (O7's sealed `close {removed}`). "Sign in again" retries. A hub route that lets a removed member read the state that removed them is asked of O11 (Interfaces §I, H3).
- The feed reconnects on its backoff, and at once on a probe: main wires `powerMonitor` `resume` and `unlock-screen` to `feed.probe()`.

*What `current()` answers.* Non-null exactly when all of these hold:
- a registration is held and not signed out;
- the held head lists the registration's member with a device of the registration's id whose `channelPub` and `stepUpPub` equal this profile's keys;
- the keys loaded at startup or registration;
- `<userData>/org/` passed its checks.

Its value is:
- `identity`: `{org, member, device, clientClass: 'native-mac', channelKey: keys.channel, build, capabilities: []}`;
- `view`: the held view;
- `stepUp`: `createStepUp({device: {org, device}, key: keys.stepUp})`, injected from main;
- `hub`: `{url, headers()}` while a live credential is held, else null.

`headers()` resolves to `{'cf-access-token': token}`, or the stand-in's `{'x-desk-standin-user': user}` (O7 §B's `headers()` is async). The value object is rebuilt, and `onChanged` fires, at each of O7 §B's triggers. A head that drops the device leaves the registration held and reads `session: 'removed'`.

*Sign out and sign in.*
- `signOut` first writes `signedOut: true` to `registration.json`, the commit point; then it deletes `access.json`, closes the feed and fires `onChanged`. A sign-in still running is fenced by a generation counter that `signOut` advances, so its completion writes nothing and can't clear the marker. At startup, a registration marked signed out never reads `access.json` and deletes one it finds. The registration, the chain and the keys stay, so signing in again is a browser trip and no new pairing.
- `signIn` (or a code for the held registration's org) runs the login alone, the status reading `registered` with `hubAccess: 'signing-in'`. `/api/me` must name the registration's member, else it is refused `not-member` and the old state stands. Success writes `access.json`, clears `signedOut` and fires `onChanged`.
- A device stays listed in the org until an admin removes it (M4).
- Removing this profile's registration altogether (a different org on this Mac) is not built; it is a later need, recorded as residue.

*The Org section* (`OrgSection.tsx`), the least UI a sign-in needs, with the existing `settings-tab/parts.tsx` pieces and tokens. It shows, by `org.status`:
- `none`: that this Mac isn't signed in; a "Pairing code" field and a Sign in button; one line saying where a code comes from (a device already in the org; today `deployment admin pair --class native-mac`).
- `registering`: the step in words (finish in the browser; checking the org; waiting for approval until `expires`) with Cancel. At `approval`, the fingerprint large in the monospace token, with "compare it with the approving device, then approve there".
- `registered`:
  - which org and email, and this Mac's device id (its first 8 characters);
  - the hub's state (connected; connecting; sign-in expired, or the hub no longer admitting this person, each with "Sign in again"; or unreachable);
  - the org state's version and its age in days, in the warning tone from `HEAD_WARN_DAYS` (21), with the 30-day backstop named;
  - the `problem` line when one is held;
  - Sign out.
- `registered` and signed out: Sign in.
- `registered` and removed: that this Mac is no longer in the org.
- `development`: that the session comes from `MAWS_DEV_ORG`.
- A refusal shows one line under the field with its reason, worded per `OrgRefusal` (§B).

The Org page's final shape, where it lives and what more it shows are the owner's (Q1); M4 may move or regrow all of it.

*Composition* (`src/main/index.ts`).
- Main creates the production session before `startMachines`, wired as below. The session and the feed meet through `attach`, since the feed is built over whichever session `startMachines` gets: `createOrgSession({userData, build, packaged, env, openExternal: openExternalUrl, stepUp: (keys, device) => createStepUp({device, key: keys.stepUp}), log})`, `build` being the string main already passes `startMachines` (`MAIN_BUILD`'s version and commit).
- `startMachines` gets O7's development session when `MAWS_DEV_ORG` is in force (unpackaged), else this one. `org.status` answers `{state: 'development'}` in the first case.
- One Registry feed is created over whichever session `startMachines` got (`createRegistryFeed({session})`), so O7 M2's and O9's development runs get listings too. When that is the production session, `production.attach(feed)` hands it the feed's notices.
- `register.ts`'s handlers are registered with main's other handlers, and `org.changed` is emitted on each status change.
- At quit, `session.close()` and `feed.close()` run.

**Does not touch.** O7's link, its carriers, its roster and its development session (beyond taking `session.ts` by the rule above). Any signing of org states (M3). The approving side, which stays `deployment admin` until M4. The listings (M2). The renderer beyond the Org section and the Settings order. `apps/`, `src/endpoint/`.

**Proves.** Acceptance 1. Each test below is named by the behaviour it pins.
- `access-login.test.ts`, with a local HTTP server as Access and as the transfer service, which seals with `tweetnacl` the way the real one does:
  - the metadata JWT verified against the served JWKS, and refused for a bad signature, another hostname or a `type` other than `match`;
  - the browser URL's path and every parameter exactly as §E gives them;
  - a long poll answered non-200 waits and polls again, a 5xx fails, and a 200 opens with the `service-public-key`;
  - the org token dropped, and the app token's `exp` and `email` read;
  - the overall bound and `cancel`;
  - the stand-in honoured only for a loopback hub in an unpackaged build with `MAWS_DEV_STANDIN_USER`.
- `held.test.ts`:
  - each row of the rules table (the endpoint's `test/endpoint/org-sync.test.ts` cases, carried over where they apply), persistence before notification, and `since`;
  - a recovery that rewinds below the state the pinned root first signed, followed by an offline restart that loads the held chain;
  - a crash between `chain.json` and the anchor after a forward adoption, and after a rewind to a lower version, each loading and moving the anchor up;
  - a damaged `chain.json` with the hub serving an authentic chain from before a removal the app had adopted: it stays closed; with the hub serving a chain that holds the anchored state: it loads; with the hub serving a chain an old, genuine recovery rewound below the anchor: it stays closed;
  - `reanchor` refused outside `held-chain`; in it, re-anchoring on a fresh code's pins; `register` with a code for the held org never moving the anchor.
- `org-session.test.ts`, over fakes:
  - each registration step and each refusal reason;
  - the file order, with a crash between files;
  - startup from the files with no network;
  - `current()`'s four conditions;
  - `onChanged` at each trigger, `advance` included;
  - the token's end by its clock and by an Access answer, `hub` null and the device still signed in;
  - sign out and sign in;
  - a crash after sign-out's marker and before `access.json`'s removal, and a failed marker write, each starting signed out with no token used;
  - a sign-in that completes after a sign-out writing nothing;
  - a `403 not-a-member` and a `4403` close reading `denied`, with `current()` unchanged until a verified head drops the device;
  - a never-signed-in profile making no keys, no files and no requests.
- `registry-feed.test.ts`: parts joined; frames typed; open only while `current()?.hub` is non-null and closed when it turns null; the backoff and its reset on a probe; `4403` passed on; an upgrade refused without `X-Desk-Build` reported as credentials ended.
- `test/org/sign-in.local.test.ts`, on desk-hub's Worker in Miniflare (`test/endpoint/miniflare-hub.ts`) with the stand-in's identity:
  - the org rooted and the approver run as `apps/desk-hub/test/deploy/admin.test.ts` does (`runAdmin(['pair', '--class', 'native-mac', …local, '--yes'])`), and the app's registration completing against it, the app's fingerprint equal to the line `pair` printed;
  - a second session over the same `userData` signed in with no login and no network until the feed opens;
  - an admin `refresh` followed through the feed's notice;
  - a served rollback refused;
  - an admin `remove-device` making `current()` null;
  - the member removed from the org (a second member, as `OrgAdmin` adds one), its app reading `denied` and keeping its held head;
  - **O7 §B met exactly:** `connectChannel(dial, signedIn.identity, signedIn.view, {machine})` completing against the endpoint harness's listener (`test/endpoint/sub-harness.ts`), the endpoint enrolled in the same local org.
- `OrgSection.test.tsx`: each status drawn; Sign in sends `org.register` with the trimmed code; Cancel, Sign out and Sign in again; the fingerprint shown; in `held-chain`, the code field and Re-anchor sending `org.reanchor`; no prop carries a token.
- The grades test passes with `org.*` declared `client`.

### M2 — The remote rows

**At its end.**
- Main keeps every listing the hub serves that verifies against the held head, caches them, and answers `org.rows` with the rows of the machines in O7's RL2 roster.
- The renderer holds them as **listed sessions**, a partition of the sessions store beside records, and the sidebar draws the member's own as rows under their org projects (or their machines' rows) beside local rows, with chips, state glyphs, greying and rollups.
- A machine the rows cover takes no record snapshot, and counts as loaded once its rows apply.
- A lane can register an opener that a click on its listed row calls. O7 M2 registers lane B's and O9 M9 lane A's.

**Touches.**
- Main: `src/main/org/rows.ts` (new) and its test; `src/main/org/register.ts` (`org.rows`, `org.rows.changed`); `src/main/index.ts` (the rows source, wired to the feed, O7's roster and the local index's projects).
- Shared: `src/shared/ipc/schema/org.ts` (`RemoteRow`, `OrgRows`, the command and the event).
- Renderer:
  - `stores/sessions.ts` (the listed partition);
  - `ipc/events.ts` (the feed, the snapshot rule, loaded, `knownTab`);
  - `stores/org-projects.ts` (`rowOfListed`);
  - `sidebar/derive.ts`, `Sidebar.tsx`, `ListedRow.tsx` (new), `HoverCard.tsx` (a listed card);
  - `sessions/remote-openers.ts` (new);
  - their tests.
- `test/org/rows.local.test.ts` (new).

**Interfaces.** It produces Interfaces §G (`RemoteRow`, `OrgRows`, `org.rows`, the listed partition, `registerRemoteOpener`). It consumes M1's feed and session, O7 §A's `Machines.onRemote` (the roster), `verifyListing`, and `repoProjectId` and `machineProjectId` from `src/main/index/org-project.ts`.

**Decisions.**

*Where rows come from.*
- **The hub's listings, through the `?app=1` socket.** At open the feed brings `listings` pages. Their records, once `last` arrives, replace the held rows: a held record with a higher revision than the page's is kept (a live frame raced the snapshot), and a held record the snapshot lacks leaves the rows, since withdrawn listings are never in pages. Each `listing` frame then replaces its key's record when its revision is higher, and a `gone` one removes the row.
- **A high-water mark per key outlives its row.** Each key (`<ref>/<session>`) keeps, apart from the visible rows, a mark of the newest record the app accepted for it: its revision, the SHA-256 of its canonical form (`canonicalize`), the key id that signed it (`sig.kid`), and whether it was `gone`. A record is judged against its key's mark:
  - below the mark's revision: ignored;
  - at the mark's revision and byte-identical to the marked record (same hash): taken as the same record. A live mark's row is restored or kept, which is what a cache load, a reconnect's snapshot and an unchanged resend bring (the endpoint re-signs nothing unchanged and resends the same bytes). A `gone` mark's key stays without a row;
  - at the mark's revision with another hash: ignored and logged, as a conflict;
  - above it: verified, and if it verifies it becomes the row (or removes it, if `gone`) and the new mark.

  A row a snapshot omits leaves the rows and keeps its mark. So revision 10, then `gone` at 11, then a replayed 10 never brings the row back, across a reconnect or a relaunch; `src/endpoint/listings.ts` keeps its signed withdrawals for the same reason. The marks persist in `listings.json` (§C).
- **A mark is dropped only on signed evidence that its signing key can never speak again:** its `kid` is in the held head's `revoked` or `retired`, or the mark's record was signed under a delegation certificate whose delegation the held head lists in `revoked`. RL5 never lets such a key, or such a certificate, be current again, so no record the mark guards can verify after that. A delegation past its `expires` is not that evidence: a renewal signed before the deadline is valid when it arrives after it (`keysAccounted` in `org-state.ts`), so a hub that withholds the renewal could otherwise erase the mark and then replay (round 4's finding); the endpoint holds an expired certificate for the same reason. An empty answer from `machineKeys` is not that evidence: it also comes from a certificate the hub left out of the set it served, or a ref contested for the moment, and both can reverse with no state change (round 3's finding, reproduced with `machineKeys` and `verifyListing`). A machine leaving the state puts its key in `retired` or `revoked` in that same step (RL5), so it needs no rule of its own. There is no count cap: dropping a mark by age or count would let a still-verifiable old revision return (round 2's finding). A mark is a few dozen bytes, and a machine's sessions over a key's life stay in the thousands at P5's scale. A session listed again comes at a higher revision (RL6), so a mark never hides it.
- **Every record is verified** with `verifyListing(head.state, record, certificates, now)` against the session's current view. One that fails waits in a bounded set (1024, newest kept) and is tried again at each `onChanged`. At each new head every held record is verified again, so a machine the org removed, or whose key it revoked, loses its rows at once.
- **The cache.** `<userData>/org/listings.json` (§C) is written a second after a change. At load each record is verified against the held head (the org must match) and held under its key's mark. So a relaunch with the hub down still shows rows, greyed while their machines are not `up` (T2).
- **Rejected: `endpoint.listings` over each link now.** It is the path for `private` sessions (to their owners and shares) and needs polling, since it is a call. No session is private until sminos sends `access` (Orientation), so M6 adds it when visibility exists. Also rejected: `GET /api/listings` polling, which the socket replaces.

*Which rows exist.* A held record becomes a row when its machine is in O7's RL2 roster (`Machines.onRemote`), which leaves out the local machine and contested refs. Every row carries `mine`: the signed-in member is among its owners. Signed out, there are no rows (the cache stays).

*The join to org projects* (OX3; P5 Decision Log 27's "O8 joins … by `smnsId`").
- A row's `orgKey` is the local machine's org key whose join id equals the listing's `project`, else null.
- Join ids are computed in main from the local index's projects with the **signed-in org**: a `smns` source gives its `smnsId`, and a `remote:<K>` key gives `repoProjectId(org, K)`. Other sources join nothing.
- The machine project needs no join: a row with no `orgKey` sits under its machine's row anyway.
- Recomputed when local projects change or the org changes.
- **Why the signed-in org.** `machineEnrollment()` is null on the MacBook until its own cutover, so O6's stored `smnsId` is null for every `remote:` checkout there. sminos's ids use the org the machines are enrolled in, which is the one org the app signs in to. Rejected: waiting for `machineEnrollment()`, which leaves every `remote:` project's remote sessions under their machine rows until the MacBook's cutover.
- The local index's projects reach `rows.ts` as injected `localProjects()` and `onLocalProjects(listener)`. At composition they are `index.projects.listWithRemoved()` and `onEmitted('session.projects.changed', …)`, as `src/main/index.ts` already watches that event for the files service. When O3 moves the index into `mawsd`, the same two read through the local machine's link.

*How a row is filed* (`rowOfListed`, beside `rowOfSession`):
- under `orgKey` when the org index lists it;
- nowhere when `orgKey` names local checkouts that are all hidden, since hiding is the owner's word on the project and a remote checkout can't be hidden from here;
- else under `machine:<ref>`.

*The listed partition* (renderer).
- `useSessions` gains `listed: ReadonlyMap<AppSessionId, ListedSession>` and `listedMachines: ReadonlySet<MachineRef>`. `applyRows(rows)` replaces both wholesale from `org.rows` and `org.rows.changed`.
- A `ListedSession` is a `RemoteRow` with its address (`addressOf(machine, session)`) as `appId`.
- **It is not a `SessionRecord`.** A listing has no directory, model, mode, holder or lineage. A record built from one would plant made-up values in about seventy readers of `directory` alone, which is the class of silent bug P5's Surprises name for O6. Other people's sessions will only ever be listings (M5), so the sidebar needs the listed kind anyway.
- **M2 promises no record for a remote session, and none exists before O3.** The session pane takes a `SessionRecord`, and so does O9's `controlsFor(record, …)`, but no source produces one for a remote session today. The listing lacks a record's directory, holder, mode and timestamps. Lane A's plane `presence` (`SessionPresence` in `apps/desk-hub/src/protocol/session.ts`) carries the process status, the bridge and its capabilities, not a record. A per-member `session.get` on the machine is O3's (O7's C5). Until O3, the lane that opens a remote session draws its pane from the `ListedSession` and its own subscription, and where the pane needs a record, the opening lane's re-plan decides: a remote pane variant, or O3's read. That is finding F8, and a contract question to O9 and O7 (Interfaces §I).
- **The yield rule,** for when a record exists: once any source applies a record at a listed address (the store's per-machine `applyChangedMany`), the record's row is drawn and the listed row is not.
- Rejected: synthesizing `SessionRecord`s and `SessionDigest`s in main for the snapshot reads, which O7 M1's text left open.

*R3, read honestly.* A lane A row's `availability` is `'foreign_held'`: it is held on its machine, and nothing on this Mac may start a writer on it. A listed row offers no action at all, so nothing here can start a second writer. The listing carries no holder, so the row names no holder kind or pid; what the watch's presence says of the process is O9's to read once it opens the session. Recorded as finding F6, not worked around. A lane B row's `availability` is null, since O7 M2 owns its pane.

*Drawing* (O6's T1 and T2; the existing glyphs; no new taste).
- **Membership.** Only `mine` rows are drawn, and a row whose address has a record is not. A row is filed by `rowOfListed`, then joins its project's sessions in one ordering by last activity: a record's `lastActivity`, a listed row's `issued`. Both are under the same caps and Show more. Lineage nesting applies to records only, and search matches a listed row by its title.
- **`ListedRow.tsx`**: the title; `MachineChip` (T1); greyed in place with "offline" while the machine is not `up` (T2, `useMachineMark`); the age from `issued`; and the glyph for its state:

  | `state` | Glyph (existing) |
  |---|---|
  | `busy` | ● Working (accent, pulsing) |
  | `waiting` | ◐ Needs you (warning) |
  | `failed` | ✕ Failed |
  | `done`, `stopped`, `retired` | ✓ Done (faint) |
  | anything else | ○ Idle (faint) |

  O9's open question Q1, how a terminal session's glyph reads, governs lane A rows too. They follow its recommendation, live glyphs, until it is answered.
- **The listed hover card** shows the title, the machine's name, the state's label and "updated `<age>`". No owners (M5) and no actions.
- **Rollups.** A project row's waiting count adds its drawn listed rows in `waiting`, and its working count those in `busy`.
- **What a click does.** `registerRemoteOpener(lane, open)` in `sessions/remote-openers.ts` lets a lane's owner say how its sessions open. A click on a listed row calls its lane's opener. With none registered, the row is selected and its hover card shows, and nothing opens. Rejected: a placeholder tab, which needs words the owner hasn't seen. Also rejected: drawing rows only once a lane can open them, which hides acceptance 3's view (rows and states across machines) until O7 M2 and O9 M9.
- **No menu, drag, pin or unread** on a listed row. Those act on a record.

*The snapshot rule* (`connectShell`).
- A machine in the latest `OrgRows.machines` (the RL2 roster) takes no record snapshot, since all five reads are refused there.
- **Coverage is apart from the roster.** `OrgRows.complete` is true only once this run's feed has delivered the hub's `listings` snapshot through its `last` page, the rows have applied it, and the held head has reached the version the feed's `state` notice announced at open (if it announced one), so the page is judged against the state it was sent beside. Rows from the cache alone, or before the feed opens, come with `complete: false`.
- **A machine with records awaiting verification is not covered.** `OrgRows.pending` names each roster machine with a record in the waiting set: one that failed `verifyListing`, perhaps because a key rotation's state hasn't been adopted yet.
- A roster machine counts as loaded (`setLoaded`, `settleMachine`) only at an `org.rows` with `complete: true` that doesn't name it in `pending`. A machine whose records never verify stays unloaded, and its tabs stay; that costs only the tabs' pruning. Until it loads, its restored tabs stay: `knownTab` protects an unknown session only while its machine is unloaded, and `settleMachine` drops what is unknown. With the hub down all session, the machine stays unloaded and its tabs stay.
- A machine the rows don't name yet snapshots as today and fails softly, as under O7 M1.
- `knownTab` also keeps a tab whose address is listed.
- O7 M2 replaces this rule for lane B when it brings its own reads.

*Emission.* Main coalesces changes for `ROWS_COALESCE_MS` and emits the whole `OrgRows`. At P5's scale, a few hundred rows, a whole list is simpler than diffs and cheap.

**Does not touch.** Owners on rows, the per-project toggle, visibility and `endpoint.listings` (M5, M6). Attention, Needs you and notifications across machines (O7 M6, O3). Opening a remote session (O7 M2, O9 M9). Any record of a remote session. `apps/`, `src/endpoint/`.

**Proves.** Acceptance 2. Each test below is named by the behaviour it pins.
- `rows.test.ts`, over fakes:
  - verification against the head;
  - a failing record retried at the next head;
  - a head removing a machine dropping its rows;
  - the snapshot's replace rule, with a raced higher revision kept;
  - revision order, and `gone` removing;
  - a replay of a lower revision after `gone` ignored live, after a reconnect whose snapshot omits the key, and after a relaunch from the cache;
  - a live row restored from the cache at its mark's revision, and kept across repeated unchanged snapshots with the marks loaded; a `gone` mark's identical record leaving no row; another record at a mark's revision ignored as a conflict;
  - marks kept when the hub serves a certificate set without the signing machine's certificate, and while its ref is contested: after a `gone` at 11, the certificate omitted for one refresh and then served again, a replayed 10 still ignored;
  - marks kept past their delegation's `expires`: a renewal signed before the deadline and delivered after it, then a replayed lower revision, still ignored;
  - marks dropped only when the held head lists their `kid` in `revoked` or `retired`, or their delegation in `revoked`; never by count: a replay after many thousand marks still ignored;
  - the cache verified at load, and another org's cache discarded;
  - `complete` false from the cache alone, before the snapshot's `last` page, and while the held head is below the version announced at open; true after all three;
  - `pending` naming a machine whose newly keyed listings arrive before the state that rotated its key, and clearing once that state is adopted;
  - the roster filter;
  - `mine`;
  - the join for `smns`, for `remote:` through `repoProjectId` with the signed-in org, and none;
  - coalescing;
  - no rows while signed out.
- `test/org/rows.local.test.ts`, on the Miniflare hub:
  - an endpoint enrolled and listed as `test/endpoint/hub-link.local.test.ts` does, reporting a lane A and a lane B session in a project whose `smnsId` a local `remote:` fixture joins;
  - the app's session registered through M1;
  - the rows arriving with R1's addresses, lanes, states, titles, owners and the joined `orgKey`;
  - a new revision updating a state, a `private` report withdrawing a row, and the endpoint's machine dropped from the state removing its rows.
- `derive.test.ts` and `Sidebar.test.tsx`, with this Mac's records and another machine's listed rows:
  - both under one org project, the remote rows with `@<name>` chips beside the local rows;
  - a row whose project isn't listed under its machine's row;
  - a row of an all-hidden project nowhere;
  - its machine offline, greyed in place;
  - a listed row and a record at one address, one row;
  - a row not `mine`, not drawn;
  - each state's glyph, and the rollup counts;
  - caps and Show more over both kinds;
  - a click with and without an opener.
- `events.test.ts`: `org.rows` applied; a machine the rows name taking no snapshot reads; restored tabs of that machine kept through rows with `complete: false` (a delayed cache, a multi-page snapshot still arriving) and while it is in `pending` (the last page in before a delayed key-rotation state, its open session unverifiable), the machine loading only at `complete: true` with it out of `pending`; a listed tab kept.

### M3 — The app as the org's signer: a co-root, the weekly successor, the signing checks

**At its end.**
- A signer in main signs org states with this device's step-up key, behind Touch ID, under O13's rule of no two successors of one parent: a typed edit becomes a successor of the held head, passes the checks before signing and the package's `verifySuccessor`, is shown in words, signed after Touch ID, kept in a durable pending slot, posted, and adopted. Nothing else is signed while a pending state is unsettled.
- When the held head lists this device's step-up key in `root.keys`, the app signs the weekly no-change successor (Q6): it asks once with Touch ID at the first focus of the app after the head turns 7 days old, never more than once a day; the Org section carries a quiet line with "Re-sign now", and one notification a day goes out while the head is due and the app is not in front. The deployment admin's `refresh` is then the owner's to stop.
- The checks before signing (P5 Decision Logs 26, 30, 31) are one pure module the signer runs on every edit, M4's included: a revoked key made current, a delegation prefix that equals, nests in or covers another (live or dropped) or a machine's name, a delegation id used before, a renewal of a delegation no longer live, a dropped delegation (a warning), and after a root transition the superseded states' keys offered for revocation.
- Each state the app signs that ends a key (into `revoked` or `retired`) is also delivered to every machine of the roster as `endpoint.state` over O7's links, each acknowledgement kept, the machines still owing one in the status (RL §5.2).
- A device whose key file lacks `excludedFromBackupAtCreation`, or one the org removed, makes new keys and registers them with a fresh pairing code while the old device stays signed in; the old key file is destroyed once the held head no longer lists the old device's keys as current (P5 Decision Log 71).
- `deployment admin root add <device id>` (apps/desk-hub/deploy/admin.ts) adds a listed admin device's step-up key id to `root.keys`. Running it, on staging and then production, is the owner's sitting; everything else is built and proved here.

**Touches.**
- New, under `src/main/org/`: `signing-store.ts` (the one writer of `signing.json`), `signer.ts` (the signer and its pending slot), `checks.ts` (the checks before signing, and the superseded offer), `weekly.ts` (the weekly successor's asking), `deliveries.ts` (direct revocation delivery), and their tests.
- Changed, `src/main/org/`: `org-session.ts` (the signer's composition, `rekey`, the status's `signer` part), `hub-client.ts` (`postState`), `files.ts` (`signing.json` and its validator; `registration.json`'s `signing` and `rekey`), `register.ts` (the new commands), `timing.ts` (§H's M3 rows).
- Changed, `src/main/device/`: `step-up.ts` (`createStateSigner`), `keys.ts` (the next keys, their promotion and the retired file's destruction).
- Shared: `src/shared/ipc/schema/org.ts` (`OrgSignerStatus` on `registered`; `org.resign`, `org.revokeSuperseded`, `org.rekey`, `org.discardPending`; refusals).
- Renderer: `settings-tab/OrgSection.tsx` and its test (the signer's lines and buttons), `settings-tab/copy.ts`.
- `src/main/index.ts`: the signer's deps (the state signer over the device's step-up key, `app` `browser-window-focus` and the windows' focus, `clientPort.notify`, `machines.remote` and `onRemote` for deliveries).
- The desk track's file, by the architect's ruling (Decision Log, 2026-10-28): `apps/desk-hub/deploy/admin.ts` (`root add`, in `SUBCOMMANDS` and `CONFIRMING`), `apps/desk-hub/deploy/production-run.sh` (its per-verb line), `apps/desk-hub/test/deploy/admin.test.ts`. The desk track's owner reviews that hunk at the PR.
- `test/org/signer.local.test.ts` (new), in `vitest.config.ts`'s timing-node list.

**Interfaces.** It produces §K. It consumes M1's session, held view (`superseded()`, `adoptServed`, `since`) and files; `signOrgState`, `stateHash`, `keyId`, `verifySuccessor` and the state's types from `org-protocol`; O7's `RemoteLink.act` and the roster (`Machines.remote`, `onRemote`); O10's `endpoint.state` offer; `ClientPort.notify`.

**Decisions.**

*Who signs, and with what.*
- **This device is a root when the held head's `root.keys` holds `keyId(keys.stepUp.pub)`, and it may sign only when it is a root and its key file carries `excludedFromBackupAtCreation`.** The package makes a root an admin member's device's step-up key (`rootKeys`, `stateInvariants`), so the owner's app, paired under the owner, qualifies once `root add` lists it. The mark is a local fact nothing signed can carry (`loadDeviceKeys` continues after a failed exclusion and `fromFile` keeps the missing mark, `keys.ts:65-76`, `:155-159`), so it is checked here: an unmarked device is refused `unmarked` for every sign, even when the head lists it as a root, and the Org section offers new keys (below) instead of the `root add` guidance. Not a root, every sign is refused `not-root` and nothing is shown that would sign.
- **The key stays in the device module** (P5 Decision Log 53). `step-up.ts` gains `createStateSigner({key, confirm})`, whose `sign(state, prompt)` runs the same Touch ID confirmation step-up uses (`promptTouchIDConfirmation`) and only then `signOrgState(state, [key])`. Main injects it into the session as it injects `stepUp`; the signer never sees the key. Rejected: handing `src/main/org/` the `CryptoKey`.
- **Successors are composed in `signer.ts`** as `deploy/org-admin.ts`'s `successor()` does: a structured clone of the head's state, `version + 1`, `prev = stateHash(head.state)`, `issued = max(now, head.state.issued)`, then the edit. Before Touch ID, the unsigned state runs the checks; after signing, the signed state must pass `verifySuccessor(head, signed, transitions)` or it is refused `invalid` and never kept or sent. Rejected: moving `successor()` into `org-protocol` for six lines whose correctness the package's verifier already decides (the architect's ruling).

*The signing file* (`<userData>/org/signing.json`, §C): the pending slot, the delivery obligations and the weekly asking's dates, in one file with one writer.
- **One writer: the signing store.** The session builds a `SigningStore` (§K) over M1's commit queue and hands the same one to the signer, the weekly asking and the deliveries. `update(fn)` runs in the queue as read, change, write (`files.write`: synced, renamed, the directory synced), so no change (a new pending state, an exposure, a settlement, an acknowledgement, an abandonment, `lastAsked`, `lastNotified`, and the first write's `registration.json` flag) replaces another's with an older snapshot. Network calls and `adoptServed` run outside it, since adoption's anchor write itself waits on the queue (`org-session.ts:480-499`). Nothing reads `signing.json` through `OrgFiles` directly.
- **It fails closed**, unlike §C's other files. `registration.json` gains `signing: true` when the file is first written. A missing or unreadable `signing.json` while that flag is set is `problem: 'signing'`: every sign is refused `signing`, and only `org.resetSigning` (the owner's explicit act, with the line that a successor sent before the damage could still surface as a fork) writes a fresh file. Rejected: §C's "treated as absent", which after an unanswered post would let a second successor of the same parent be signed.

*The pending slot*, as `deployment admin`'s anchor keeps `pending`.
- **Order.** Signed, the state is written as `pending: {signed, parent, exposed: {hub: false, machines: []}}`, with its delivery obligation (below) in the same write, before it goes anywhere.
- **Exposure is written before each send.** `exposed.hub` is set before the `POST`, and a machine's ref joins `exposed.machines` before its `endpoint.state` act. A send whose answer never came counts as exposed.
- **Posting.** `POST /api/org/state` with the signed state. `201` adopts it (`adoptServed` with the hub's chain since the held head) and clears `pending`.
  - `409 not-head` or `rollback`: the app reads the hub's chain and adopts it. If the hub's chain holds the pending state, it is settled. Otherwise the slot stays, and the status reads `pending-fork`, because an exposed proposal may be retained and served by the hub or a machine whatever their answers said.
  - Any other answer, or no answer, leaves it pending, and the status says so.
- **Settling** runs at start, at each feed open, and before any sign:
  - the held chain holds the pending state → cleared;
  - the hub holds no successor of its parent → the same bytes are posted again;
  - another state holds its version → `pending-fork`.
- **`org.discardPending`** clears a pending slot (a `pending-fork`, or one the hub keeps refusing, such as `409 key-purged`: Decision Log, 2026-10-28, Task 4) only while the hub's chain doesn't hold it, and only after the owner confirms the Org section's line in `abandon-pending`'s words (`admin.ts:1155-1168`): a hub or machine that kept the proposal can still show it as a fork. The weekly successor that lost a race to the deployment admin therefore waits for that confirmation. It is rare once the owner stops `refresh`.
- **Rejected:** clearing an exposed proposal on `409` because no machine acknowledged it, which the round showed unsafe. The hub has the bytes, and an applied delivery can lose its answer.

*The checks before signing* (`checks.ts`; P5 Decision Logs 26, 30, 31). `checkSuccessor(head, next, superseded, now)` returns every finding, each `refuse` or `warn`:
| Finding | Level | Rule |
|---|---|---|
| `revives-revoked` | refuse | a key id in `head.revoked` is a device's, machine's, root's or delegation's key in `next` (the package refuses it too; the app names it first) |
| `prefix-equal`, `prefix-nested`, `prefix-covers` | refuse | with `n` the new prefix and `p` another delegation's, live or revoked, both case-folded by `machineNameKey`: `n === p`; `n.startsWith(p)`; `p.startsWith(n)`. Raw string prefixes, as `stateInvariants` (`org-state.ts:101-104`) and `prefixProblem` (`admin.ts:817-820`) compare them, so `dc-` and `dc-prod-` collide; names have no `/` |
| `prefix-names-machine` | refuse | `machineNameKey(name).startsWith(n)` for a machine's name or a retained name in `machineNames` |
| `delegation-id-used` | refuse | a new delegation's id is a live or revoked delegation's |
| `renew-expired`, `renew-not-extension` | refuse | a delegation's `expires` changes and either the old or the new value is not later than `next.issued` (`keysAccounted`, `org-state.ts:202-206`), or the new value is not later than the old (P5 Decision Log 30: renewal extends) |
| `drops-delegation` | warn | a delegation leaves `next.delegations`: shown in the prompt, its certificates' keys moving to `revoked` |
| `empty-roots` | refuse | `next.root.keys` is empty (the package's `stateInvariants`, `org-state.ts:95`; named before Touch ID; the desk track's check, Decision Log 2026-10-28) |
| `superseded-keys` | warn | `supersededRevocations(head, superseded)` offers revocations that `next.revoked` doesn't carry (shown so an unrelated edit after a recovery says what it leaves out) |

A `refuse` finding ends the attempt with its code before Touch ID; `warn` findings are lines in the prompt.

*The superseded states' revocations* (P5 Decision Log 30). A recovery rewinds the chain to a base below the head the app held, so a revocation signed honestly on the discarded branch is lost, and its key may be current again on the new line.
- **Candidates** (`supersededRevocations(head, superseded, self)`): each entry of a superseded state's `revoked` that `head.revoked` lacks, by its holder:
  - **A machine holder** (`{machine}`): always offered.
    - If `head.machines` holds that ref with that key, the machine leaves `machines` and the entry is appended.
    - If the key is in `head.retired` (retired before the recovery's base, revoked on the discarded branch), that retired entry moves to `revoked` with its own verified holder. `stateInvariants` refuses a key in both sets (`org-state.ts:111-112`), and `keysAccounted` permits the move (`:172-173`).
    - Otherwise the entry is appended alone. This covers a delegated machine's certificate, whose key lives in the certificate set and not in `head.machines`: once its revocation is lost, `certViews` (`records.ts:188-205`) admits the certificate again and `machineKeys` (`:233-239`) returns its key. `keysAccounted` permits a new machine-holder revocation whether or not the predecessor held the key (`org-state.ts:194-199`). It is offered without the hub serving the certificate.
  - **A device holder:**
    - If the head lists that device under its member with that key current, the device leaves its member, and both its keys go to `revoked`: the candidate's entry, plus one for its companion key unless the head already retired or revoked it. A retired companion moves from `retired` to `revoked`. Its step-up kid leaves `root.keys`.
    - If the key is in `head.retired`, the entry moves there from `retired` to `revoked`.
    - Otherwise nothing is offered, because `keysAccounted` refuses a new non-machine revocation of a key the predecessor neither held nor retired (`org-state.ts:194-199`).
  - **A delegation holder:**
    - If the head lists the delegation, it leaves `delegations` and the entry is appended. Every key the head retired under that delegation's refs (`<id>_…`) moves from `retired` to `revoked`, as `delegation drop` does (`admin.ts:1064-1071`), since `stateInvariants` refuses a dropped delegation's certificate keys left retired (`org-state.ts:107-109`).
    - Otherwise nothing is offered.
- **The closure is shown.** Each consequence beyond the candidate's own entry (a companion key, a root kid, a machine entry, a delegation's retired certificates) is a line of the prompt. The closure is built so the signed successor passes `verifySuccessor`. The proofs sign each kind with the real package and verify it, so an offer can't reach Touch ID and then fail as `invalid`.
- **Withheld, never offered:** a candidate whose closure would remove this device's own keys or empty `root.keys`. It is named in the offer for the owner to settle by other means.
- **`org.revokeSuperseded`** signs one successor with them all.

M3's own edits are the no-change successor and that revocation. The delegation and device edits are M4's, and run these checks unchanged.

*The weekly successor* (`weekly.ts`; Q6).
- **Due**: this device may sign (a root, its keys marked, `signing.json` readable), no state is pending, and the held head's `issued` is at least `WEEKLY_DUE_DAYS` (7) days old.
- **Asking**: at the first `browser-window-focus` while due, if `lastAsked` in `signing.json` is not within `ASK_GAP_MS` (24 h), `lastAsked` is written first, then the signer signs the no-change successor, and Touch ID asks "re-sign the org state (no change)". A cancel ends it for the day; the quiet line stays.
- **Notifying**: every `WEEKLY_CHECK_MS` (1 h), while due and no app window is focused, if `lastNotified` is not within `ASK_GAP_MS`, one notification ("The org state is N days old. MAWS will ask for Touch ID when you next open it."), `lastNotified` written first. A click focuses the app, which may ask.
- **The quiet line** in the Org section while due: "Org state is N days old" with "Re-sign now", which signs at once (`org.resign`).
- Rejected: Touch ID from a background timer, which asks for a fingerprint with no window in front.

*Direct delivery* (`deliveries.ts`; RL §5.2).
- **Which states.** One that moves any key id into `revoked` or `retired` relative to its parent. The weekly successor ends nothing and is never delivered.
- **To whom.** Each machine of the roster at signing, less a machine the state itself removes.
- **The obligation is durable before anything is sent.** The signing store's `deliveries` gains `{hash, signed, owed: ref[]}` (`hash` the signed state's `stateHash`) in the same update as the pending slot. It keeps the signed bytes, so delivery never depends on the hub having accepted the state. Publication (the slot) and delivery (the obligation) settle apart: the slot clears at the hub's acceptance, and the obligation when its last machine acknowledges or leaves the roster. A crash between them loses neither.
- **Only the app's own line is ever sent.** An obligation sends while its state is on the app's line: the held chain holds it, or it is the pending slot's state and the slot is not `pending-fork`. In `pending-fork` its sends are suspended. `org.discardPending` removes the obligation in the same update that clears the slot, so no abandoned byte is sent again. It moves to `abandoned: [{hash, version, hub, machines}]` (whether the hub and which machines may hold it, from the exposure record), which the status reports. If the held chain later adopts that state after all, the obligation is not revived: the machines get it through their own sync.
- **The payload pages forward through the app's line** (`link.act({action: 'endpoint.state', args: {states, transitions}, stepUp: 'never'})`). The line is the held chain plus, while unaccepted, the pending state. `transitions` are all the held view's accepted transitions, a few at most. Each machine's cursor is kept per obligation as `known: {version, line}`. `line` is a digest of the accepted transitions the app held when the cursor was set, so a rewind the app adopts resets every cursor. A count would not do: a rewind past one forward root transition drops one transition and adds the recovery, which leaves the count unchanged (Decision Log, Task 5).
  1. **Recovery first.** When the app's line contains an accepted transition (`fromVersion` f) and this machine has no cursor on the current line, the first run starts at the state at f: the transition's base, which the whole held chain keeps. It runs forward through f + 1 and on. `EndpointOrg.#rewind` (`org-sync.ts:225-244`) needs the state at f + 1 and, when f has left its window, the authenticated base, and the run carries both. An endpoint still on the superseded branch, above the recovered head or at an equal version, rewinds by it. A `done` sets the cursor on this line.
     Recovery first is a probe, tried once per machine per line. Any other answer records `probed[ref] = line` and hands the machine to step 2, then step 3, on the same line. Two endpoints answer that way and neither is a failure:
     - One below the base (head < f − 1). No candidate transition applies (`fromVersion` ≥ its head), and the run holds no state at its head + 1, so it answers `not-newer`.
     - One that already accepted this recovery and whose head is past the run's first page. `verifyRewind` refuses the accepted transition (`rollback`, `org-state.ts:311`), and `#refusal` sees states below its high-water mark (`org-sync.ts:258-261`), so it answers `rollback`.
     An endpoint at f − 1, or one past the recovery within the first page, takes the run or matches a head in it and answers `done`.
  2. **Finding the machine's head** when no cursor exists and no recovery applies: runs start at `caps().stateVersion` (RL7's caps, `link.ts:63-77`), else genesis, and include that version's state. `#deliver` (`endpoint.ts:671-682`) answers `done` with `{version}` when it adopted states, or when a delivered state at its head's version hashes equal to its head. Either proves the machine's head is on the app's line at that version, and sets the cursor. `not-newer` or `rollback` moves the next run's start past this run's last state.
  3. **Forward catch-up** from a cursor at version v: each run starts at v + 1, never repeating v, and takes consecutive states up to `DELIVERY_MAX_BYTES` (512 KiB). A `done` must raise the version. A run that can't hold even its first state (one state over the bound) stops that machine's delivery with a visible `too-large` in the status, and the machine catches up through its own hub sync.

  So runs reach the target in bounded steps with no hub, across a recovery too. A machine on an abandoned sibling of the app's line (a `pending-fork` proposal it adopted) can't be moved by any run, and is reported under `abandoned`.
- **Acknowledgement.** A machine is acknowledged when a `done` answer's `version` is at least the obligation's state's version. The run that earned the `done` came from the app's line, which holds that state below the version, so the state is on the machine's line too.
  - A machine already ahead of the state is acknowledged once a run reaches its head's version.
  - A machine ahead of the app's own held head on the same line waits until the app adopts that far. One ahead on a superseded line is handled by recovery first.
  - Anything else stays owed, sent again at that machine's next link up and every `DELIVERY_RETRY_MS` (1 h).
  - A machine is no longer owed once it is out of the roster and the held head no longer names it. The roster is empty at start and at sign-out, so the roster alone would erase every obligation (Decision Log, Task 5).
- The status lists the machines still owing an acknowledgement per version, and those that may hold an abandoned proposal. M4's page shows them.

*New keys* (P5 Decision Log 71; M1's `removed` refusal said M3 builds it).
- **Offered** when `keys.json` lacks `excludedFromBackupAtCreation` (status `signer.rekey: 'unmarked'`) or the session reads `removed`.
- **`org.rekey {code}`** runs M1's registration with a fresh pairing code for the registration's org and member, against a second key file. `createNextDeviceKeys(profile)` writes `device/keys.next.json` only after excluding `device/` from backup succeeds, so it carries the mark. A failed exclusion refuses `keys` and writes nothing. The old device stays signed in, and `current()` keeps answering for it, until the held head lists the new entry.
- **Done: one recoverable transaction across the keys and the registration**, in the commit queue. Until step 1 is on disk the attempt is fenced by its generation as M1's sign-in is: a sign-out or cancel advances it, and the attempt then deletes `keys.next.json` and writes nothing else. **From step 1 on the transaction is irreversible:** a cancel or sign-out no longer touches its files, the promotion runs to its end (or the replay finishes it), and each `registration.json` write is read-modify-write, so a sign-out's `signedOut` marker written meanwhile stays.
  1. `registration.json` gains `rekey: {device: <new id>}`.
  2. `keys.json` is renamed to `keys.retired.json`.
  3. `keys.next.json` is renamed to `keys.json`, and the directory is synced.
  4. `registration.json`'s `device` becomes the new id and `rekey` is removed.
  5. `onChanged` fires, and the links re-key.
- **The replay** runs at load, before the missing-keys check and before `current()` is computed (`org-session.ts:574-584` returns `keys` today when `keys.json` is absent). It runs whenever `registration.json` holds `rekey`:
  - The file whose `keyId(channel.pub)` equals `rekey.device` is found among `keys.json` and `keys.next.json`.
  - The renames are completed as far as they got.
  - Step 4 is written.
  - If no file holds that id (the next keys were lost before step 2), `rekey` is removed and the old registration stands.
  - Every boundary is tested, both renames done with the registration still old included.
- **The old device** stays listed until a root removes it: the status names its id and the command (`… admin remove-device <old id>`; M4's page later). Once the held head lists neither of its keys outside `revoked` and `retired`, `destroyRetiredDeviceKeys(profile)` deletes `keys.retired.json`.
- A cancel or refusal before step 1 deletes `keys.next.json` and leaves the old registration as it was.

*The co-root* (the owner's sitting; the desk track's owner reviews this hunk at the PR on the four points below).
- `deployment admin root add <device id>`: through `anchored(ctx, true)` and `amend`, it finds the device under the deployment admin's own member (`from.me.member.id`), as `remove-device` looks only there (`admin.ts:698-704`), so any root it adds is one `remove-device` can remove. A device under another member is refused ("`<member>` has no device `<id>` in the head"). The app is paired under the owner, the deployment admin's member, so this costs nothing now; a second admin's device becomes a root through M4's page. It refuses as `remove-device` and `delegation create` refuse, in their words (`refuse('…')`, "nothing was signed"), then appends `keyId(device.stepUpPub)` to `root.keys`. It is in `CONFIRMING`, and production-run.sh's verb list says it changes production's roots.
- **(1) Which devices may be a root.** Only a device that signs org states as genesis's device does: class `native-mac` with a `stepUpPub` (genesis's is `deviceEntry`'s `native-mac`/`software`, `deploy/org-admin.ts:56`). Any other class is refused ("`<id>` is a `<class>` device: only a native-mac device with a step-up key signs org states"). A `web-cards` device can't carry a `stepUpPub` at all (`shapes.ts:81`), so its passkey device could never sign one; the refusal names it rather than leaving it to the package's `malformed`. Also refused: no such device under the deployment admin's member (the member is an `admin`, as `rootKeys` requires), and a device already a root.
- **(2) What a successor needs once there are two roots.** One signature. `verifySuccessor` checks the successor with `rootSigned(after, next.sigs, rootKeys(before))`, which accepts when at least one of the successor's signatures verifies under any key of the parent's root set (`org-state.ts:255-267`, `:355`). So either root alone signs any successor, the other root's removal included; adding a root adds a signer, never a quorum. The test signs successors of a two-root head with each root alone, and one with a key outside the set refused `not-root-signed`.
- **(3) The confirmation** names what `pair` names, so the owner compares it with the app's screen: "make `<describeEntry(device)>` of `<email>` (fingerprint `<pairingFingerprint(org, member, device)>`, step-up `<kid>`) a root of `<org>`? [y/N]". The fingerprint over the state's entry, its `endorsement` dropped, equals the one `pair` printed when the device was approved (`pairing.ts:138` drops it), and M3's Org section shows this device's fingerprint and id beside "Make this Mac a root: run `… admin root add <id>`".
- **(4) Removing a root.** `remove-device` has no last-root guard: it refuses only the admin's own device ("`<id>` is this admin device: …", `admin.ts:701`), and removing a device filters its step-up kid out of `root.keys` (`:712`). With two roots that stays right: removing the app's device (a lost Mac) leaves the deployment admin the one root, and the deployment admin can never remove itself, so `stateInvariants`' non-empty root set always holds. Tests: two roots, `remove-device <app device>` accepted and `root.keys` back to the admin's kid alone, the app then reading `not-root`; the admin's own device still refused.
- From then on two signers share the chain (finding F1). A deployment admin verb that races the app's successor gets `not-head`, and its next run refuses `fork` until the owner runs `abandon-pending`. Rare, visible, recoverable; residue.

**Does not touch.** The Org page and its edits (M4): M3 exposes only re-sign, revoke-superseded, rekey, discard-pending and reset-signing. Revoking the deployment admin (M8). `apps/org-protocol/src/`, `apps/desk-hub/src/`, `src/endpoint/`, `apps/desk-web/`. `apps/desk-hub/deploy/` beyond `root add`.

**Proves.** Acceptance 3, each test named by the behaviour it pins.
- `signer.test.ts`, over fakes:
  - refused `not-root` without a root key, and `unmarked` for an unmarked device the head lists as a root, nothing signed in either;
  - the composed successor's version, `prev` and `issued` (never backwards against a head issued in the future);
  - checks run before Touch ID, a `refuse` ending it with no prompt; `invalid` when the signed state fails `verifySuccessor`;
  - the slot and the delivery obligation written in one write before any send; exposure written before the post and before each act; cleared at `201`; a crash after the slot write, and after the post before its answer was recorded, each settled at the next start by the three rules; `not-head` on an exposed proposal reading `pending-fork`, never cleared by itself; `discardPending` refused while the hub holds the state, and otherwise only after the owner's confirmation;
  - a hub retaining a rejected proposal and serving it later: the app's slot still names it;
  - `signing.json` unreadable or missing after its first write: every sign refused `signing` until `resetSigning`;
  - through the one composed signing store: a weekly date write racing a pending write, and an acknowledgement racing a new pending state, nothing lost;
  - nothing signed while a state is pending.
- `checks.test.ts`:
  - Each row of the table, with states built by `org-protocol`'s helpers. Each refuse is also refused by the package where the package refuses: `dc-` against `dc-prod-`; a machine `dc-prod-1` under a new `dc-`; a renewal at or before `issued`. A shortening of `expires` that leaves the delegation live passes the package (`keysAccounted`, `org-state.ts:206`), so `renew-not-extension` is the app's own rule, and its test asserts the package's `ok` beside the app's refusal (Decision Log, 2026-10-28).
  - `supersededRevocations` after a rewind, each offer signed and checked with the real `verifySuccessor`:
    - an honest revocation of a device present before the base and current again after the recovery, with the device removed;
    - a device whose channel key the discarded branch revoked and whose step-up key it retired, the companion accounted;
    - a revoked delegated certificate restored by the recovery, offered as a machine-holder revocation while the hub serves the certificate and while it withholds it;
    - an enrolled machine's retired key and a delegated certificate's retired key (its certificate absent from the hub's answer), each revoked on the discarded branch: moved from `retired` to `revoked`;
    - a delegation whose certificates the recovered branch retired, those keys moved to `revoked`;
    - a device added only on the discarded branch, not offered;
    - this device's own key, withheld.
  - No path to zero roots (the desk track's check). M3's own surface removes no device and no root: its edits are the no-change successor and the superseded revocations, whose closure withholds anything that would empty `root.keys`. The package refuses an empty root set in `stateInvariants` (`org-state.ts:95`), which `verifySuccessor` runs on every successor (`:341`). A root kid must also name an admin's device's `stepUpPub` (`:115`). Tests, signed with the real package:
    - a successor of a two-root head that removes the deployment admin's device and its kid, signed by the app's root: accepted, with the app the one root;
    - a successor of that state that then removes the app's own device (the last root): refused `malformed` by `verifySuccessor` and refused by `checkSuccessor` as `empty-roots` before Touch ID;
    - a successor that empties `root.keys` while keeping the devices: refused the same way.
    `checkSuccessor` gains the `empty-roots` refuse row (a successor whose `root.keys` is empty), so the app names the refusal before Touch ID, as it names `revives-revoked`. M4's removal UI inherits it.
  - A successor signed only by a key that the same successor adds to `root.keys` is refused `not-root-signed`, because `rootSigned` checks against the parent's root set (`org-state.ts:355`). The desk track's second check.
- `weekly.test.ts`: due only when the device may sign, at 7 days, with nothing pending; the first focus asking once and `lastAsked` written first; a second focus the same day not asking; a cancel; the hourly notification only unfocused and once a day; "Re-sign now".
- `deliveries.test.ts`, over a fake link backed by a real `EndpointOrg`:
  - which states are delivered, and that a removed machine is never sent to;
  - runs paging forward from `caps().stateVersion`, from the last acknowledged version and from genesis, each forward run starting after the cursor;
  - one state fitting the bound but two consecutive ones not: still progressing one state a run; a single state over the bound reading `too-large`;
  - after a recovery: an endpoint on the superseded branch above the recovered head, one at an equal version on the other branch, and one whose window no longer holds the recovery's base, each brought onto the app's line by the recovery-first run; every cursor reset when the app adopts a rewind;
  - the probe's exit, on real endpoints: one below the recovery's base (answers `not-newer`), and one that already accepted the recovery and is past the first page (answers `rollback`). Each is recorded as probed on that line and reaches the target through head-finding and forward catch-up, and neither gets a second probe on the same line;
  - a missing run larger than `DELIVERY_MAX_BYTES` reaching the target in bounded steps with no hub;
  - the pending state delivered while the hub withholds it;
  - a machine already ahead of the state acknowledged at its head;
  - a lost acknowledgement followed by the machine advancing before the retry;
  - a machine ahead of the app's head acknowledged only after the app adopts;
  - sends suspended in `pending-fork`;
  - a removal that loses the hub race, discarded, and an owed machine reconnecting later: no abandoned byte sent, the machine named under `abandoned`;
  - retried at link up and on the clock; a machine leaving the roster no longer owed;
  - the obligation outliving the slot's clearing across a crash.
- `keys.test.ts` (the device module's): the next keys carry the mark, and a failed exclusion refuses with nothing written; promotion; destruction.
- `org-session.test.ts`: `rekey` end to end over fakes, the old device answering `current()` until the new entry is listed; a cancel and a sign-out during the approval leaving the old registration and no next keys; a cancel and a sign-out after step 1 and after each rename, the promotion still completing and a sign-out's marker kept; the replay at each boundary of the transaction (after step 1, after each rename, both renames done with the registration still old) reaching the new device signed in; the status's `signer` part.
- `apps/desk-hub/test/deploy/admin.test.ts`: `root add` adds the kid; refuses a `web-cards` device, another member's device (a second admin's included), an unknown id and a device already a root, each in its siblings' words; confirms with the device, its member, its fingerprint (equal to `pair`'s line for that device) and the kid; with two roots, successors signed by either root alone accepted by the package and the local hub; `remove-device` of the app's device leaving the admin the one root, and the admin's own device still refused.
- `test/org/signer.local.test.ts`, on the Miniflare hub with O13's real admin (`runAdmin`) and an endpoint enrolled as `rows.local.test.ts` does:
  - the app registered (M1), `root add` run by the admin, the app reading itself a root;
  - the weekly successor signed by the app (Touch ID injected), accepted by the hub, adopted by the admin's next `show`;
  - an admin `refresh` racing the app's: the app's proposal `not-head` and held as `pending-fork` until the owner's discard;
  - a superseded-key revocation delivered to the endpoint over the link and acknowledged, and the endpoint's held head carrying it;
  - `rekey`: new keys registered with a second `pair`, `remove-device` of the old id by the admin, the retired file destroyed.
  - a delivery to an endpoint more than 16 states behind, adopted through the genesis fallback and acknowledged;
  - a delivery while the local hub refuses the post, the endpoint adopting the pending state over the link.
  - one run of consecutive states filling `DELIVERY_MAX_BYTES` delivered over the real link and adopted, with an `endpoint.state` done. A single state over the bound is `too-large` in `deliveries.test.ts` and is never sent (the architect, 2026-10-28).
- `OrgSection.test.tsx`: the root line, and no `root add` guidance for an unmarked device; the quiet line and Re-sign now; the superseded offer; owing machines; `pending-fork` with Discard behind its confirmation; `signing` with Reset behind its confirmation; the rekey offer with its code field.

### M4a — The Org page: its shape, people and devices *(executable; re-planned 2026-10-29)*

**At its end.**
- Settings › Org is the Org page, in Q1's four groups.
  - **You:** this Mac (its device id and fingerprint), the hub sign-in with its renewal, Sign out, new keys, and your other devices.
  - **People:** each member with email, role and devices, the roots marked.
  - **Machines:** each listed machine with its owners and whether it is up. Read-only in M4a.
  - **Org:** the state's version and age, the roots as `rootLines` reads them, the recovery key's id, the problem held, and M3's signer lines (weekly, pending slot, superseded offer, deliveries owing).
- While this Mac may sign (M3's `maySign`), People offers these changes:
  - Add person, Remove person, Change role and Change email;
  - Pair a device (to yourself, or as another member's first device);
  - Remove device (any member's but this Mac's);
  - Make a root (an admin's `native-mac` device with a step-up key).
- Each change opens one sheet that shows what will be signed, line by line, with the checks' warnings. Its consent is bound to a digest of what was shown, and Confirm asks Touch ID. A change the checks refuse is named in the sheet and never reaches Touch ID.
- **Pairing from the app.** The app makes the pairing code and shows it once, with Copy. It polls H1 for the target member's pending entries and judges each with `judgeEntry`. It shows the matched entry's fingerprint to compare, and approves through the signer:
  - **your own device:** endorsed by this Mac's step-up key, inside the same Touch ID;
  - **another member's first device:** unendorsed, as the protocol allows (P5 Decision Log 34).
- **The rule the page states, not an action that fails.** The protocol's `endorsed` (`org-state.ts:383-399`) needs a later device of a member who already has devices to be endorsed by one of that member's own step-up keys.
  - A member who signs (a root) pairs their own later devices from their own app.
  - A member who doesn't sign has no route yet: their later device waits for the countersign flow (RL §5.2; P5 Decision Log 34 deferred it).
  - On such a member, People shows "Their next device is paired from one of their own devices, a flow not built yet" in place of Pair a device.
- **Read-only, and refusals.** An app that isn't a root, or can't sign, sees the page read-only, with "Only a root signs org changes" and the roots' emails. A refused sign-in, re-anchor or rekey shows under the control that sent it, through `refused.attempt`.
- `OrgSection.tsx` is split by group. `close()` awaits the commit queue's tail, and the two test workarounds go (Decisions, *Close*).

**Touches.**
- **The move, first commit** (desk-track reviewed; *The move* below):
  - `apps/org-protocol/src/pairing.ts`: `judgeEntry`, `entryDevice`, `isPairedDeviceId` and `isRpId` arrive from `apps/desk-hub/deploy/admin.ts`, unchanged, and are exported from `index.ts`;
  - `admin.ts` imports them.
- **The pre-sign function, second commit** (desk-track reviewed):
  - `apps/org-protocol/src/org-state.ts` gains `successorProblems` and the named `stateProblems`, which `stateInvariants` becomes a reading of. `verifySuccessor`'s verdicts are unchanged.
  - `apps/desk-hub/deploy/admin.ts`'s `amend` runs it before signing.
  - `apps/org-protocol/test/successor-problems.test.ts` (new) proves it.
- **Main:**
  - `src/main/org/edits.ts` (new): the change composers;
  - `src/main/org/pairing.ts` (new): the app's pairing;
  - `src/main/org/view.ts` (new): `OrgView` from the held head;
  - `checks.ts`: runs `successorProblems`;
  - `signer.ts`: `Edit.endorse`;
  - `src/main/device/step-up.ts`: `StateSigner.sign` endorses;
  - `hub-client.ts`: `pendingOf`;
  - `org-session.ts`: the commands, `refused.attempt`, `close()` and its fence;
  - `held.ts`: `HeldOrg.close()` (the adoption queue fenced and its tail returned) and `adoptServed`'s closed guard;
  - the signer's, weekly's and deliveries' `close()` return their operation in flight;
  - `src/main/index.ts`: wiring;
  - their tests.
- **Shared:** `src/shared/ipc/schema/org.ts` (`OrgView`, `OrgChange`, `org.view`, `org.preview`, `org.change`, `org.pair.*`, `OrgRefusal.attempt`, `OrgStatus`'s `pairing`), `routes.json`, `grades/org.ts`.
- **Renderer:**
  - `src/renderer/src/settings-tab/org/` (new folder): `OrgSection.tsx` (the shell), `YouGroup.tsx`, `PeopleGroup.tsx`, `MachinesGroup.tsx`, `OrgGroup.tsx` (M3's signer lines, moved), `ChangeSheet.tsx`, `PairSheet.tsx`, `parts.tsx`;
  - `copy.ts`'s `ORG`;
  - `SettingsView.tsx`'s import;
  - the tests, split by group.
- **Tests:** `test/org/org-page.local.test.ts` (new, added to `vitest.config.ts`'s `TIMING_NODE_TESTS`, whose explicit list is the only way into the `node-timing` project), `org-session.test.ts` (the workarounds removed).

**Interfaces.** It produces §M. It consumes:
- M3's signer, checks and status (§K);
- M1's session, held view and hub client;
- H1 (`GET /api/devices/pending?member=`);
- `org-protocol`'s `encodePairingCode`, `verifyPairingMac`, `pairingFingerprint`, `endorseDevice`, `keyId` and `verifySuccessor`;
- `memberName` (M5);
- the renderer's `useMachines` store for whether a machine is up.

**Decisions.**

*The move* (Constraints: `apps/org-protocol` and `apps/desk-hub` are the desk track's; the architect's ruling, 2026-10-29).
- **What moves.** The pure pairing judges go from `admin.ts` to `apps/org-protocol/src/pairing.ts`, byte for byte, as their own commit at the head of the branch: `judgeEntry`, `entryDevice`, `isPairedDeviceId`, `isRpId` and the constants they read. `admin.ts` imports them, with no behaviour change, and the desk track reviews that commit.
  - `deploy/bin.ts` bundles `admin.ts` and its imports with esbuild before running the generated module, so a bundled admin run can't show whether the package loads on its own. `org-protocol`'s sources use `.ts` import specifiers and nothing Node's type stripping refuses. The moved code keeps that form, and the move's steps import the exported judges straight from `apps/org-protocol/src/index.ts` under `node --experimental-strip-types`.
  - The judges' input type moves with them as a package-owned structural type (`PendingEntry`), since today's `PendingDevice` is the hub's (`apps/desk-hub/src/protocol/identity.ts`). The hub's type stays where it is and satisfies it.
  - Rejected: app-side copies with a parity test, which are a shim where the code can simply move.
- **What moves later.** The pure parts of `admin-machines.ts` and `encodeEnrollmentCodeV2` are M4b's. `prefixProblem` is M4c's. Each moves when its milestone needs it.

*The pre-sign function.*
- `successorProblems(before: OrgState, after: OrgState, opts: { endorsing?: { kid: string; devices: string[] } }): Promise<Problem[]>` is for an **ordinary successor**, one with no authorizing root transition. That is every successor the app and the CLI compose. For it, the function runs every check `verifySuccessor` makes except the signatures, and names each problem.
  - It does not judge a successor a recovery authorizes. A held transition changes non-signature rules: the successor must take the transition's root set, and the transition's new root devices are exempt from endorsement (`org-state.ts:350-375`). The recovery vector in `vectors/scenario.ts:345-370` replaces a member's devices unendorsed and is accepted that way.
  - The link: version, `prev`, org.
  - `revives-revoked`.
  - The whole-state rules (`stateProblems`):
    - `member-id-taken`, `email-taken`, `device-id-taken`;
    - `owners-unknown`, naming the machine or delegation;
    - `empty-roots`, `root-not-admin` (a root kid that is no admin device's step-up key);
    - the key, name and prefix rules, each by its own code.
  - `recovery-changed`, `legacy-retired`, `machine-names`, `keys-unaccounted`.
  - `endorsement-missing`: a later device of a member who had devices, without an endorsement. A device id in `opts.endorsing.devices` counts as endorsed by `opts.endorsing.kid`, when that kid is one of the member's step-up keys in `before`, since the signer endorses it inside the same Touch ID.
  - `email-grammar`: a member new in `after`, or whose email changed, whose email is not `isMemberEmail`'s address (`names.ts`). A writer's rule alone, which `verifySuccessor` never makes; the desk track's key-held PR (#338) added it, and `edits.ts` refuses the same grammar up front as `bad-email` through `isMemberEmail`.
  - `stateInvariants(state)` becomes `(await stateProblems(state)).length === 0`.
  - `verifySuccessor` is unchanged in every verdict it returns, and in the order it reaches them. `org-protocol`'s existing suites and vectors pass unchanged, which is the proof.
  - Rejected: app-only rows in `checks.ts`, which leave the CLI to meet the same problems only after signing.
- `checks.ts`'s `checkSuccessor` runs `successorProblems` first, each problem a `refuse` finding with its code, then M3's own rows (the delegation rules and the superseded offer). The delegation rules duplicated between `checks.ts` and `admin.ts`'s `prefixProblem` stay until M4c moves `prefixProblem`.
- `admin.ts`'s `amend` runs `successorProblems` on the composed successor before `signOrgState`. A problem refuses in `amend`'s words, "nothing was signed", naming the code. Every admin verb's successor is valid today, so this changes only how a broken one is refused.

*The view* (`org.view`). It reads `OrgView | null` from the held head, null unless `registered` with a head:
- `version` and `issued`;
- `members`: id, email, `name` (`memberNames`), role, `you`, and devices. Each device carries id, class, `keyStorage`, `root` (its step-up kid is in `root.keys`), `thisMac` and `fingerprint` (`pairingFingerprint`, for compare-by-eye);
- `machines`: name, ref and owners, the signed facts only. Whether a machine is up comes from the renderer's `useMachines` store, which `machines.changed` keeps current. A link can drop with no new head, so the view would go stale if it carried that bit;
- `roots`: kid with member and device, as `rootLines` reads them, or `unlisted`;
- `recoveryKid`: `keyId(root.recoveryPub)`;
- `maySign` (M3's).

The renderer reads it again at each `org.changed`, which the session already fires at every adopted head. It is not a field of the status: the status is emitted on every attempt and timer, and the view changes only with the head.

*Changes.* `OrgChange` is one of:
- `member.add {email, role}`;
- `member.remove {member}`;
- `member.role {member, role}`;
- `member.email {member, email}`;
- `device.remove {member, device}`;
- `root.add {member, device}`.

`org.preview {change}` composes it on a fresh `successorDraft` of the held head (`edits.ts`) and runs `checkSuccessor`. It answers `{ok: true, change, lines, warnings, digest}`, where `change` is normalized: `member.add` gains its new random member id, so the id signed is the id shown. Otherwise it answers `{ok: false, reason, findings}`.

`org.change {change, digest}` composes again inside the signer's `sign`, on the head it signs on. A different digest of `{change, lines, warnings}` reads `stale` and signs nothing, as `org.revokeSuperseded` does. The composers:
- **`member.add`.** The email is trimmed and lower-cased, and the role is `member` unless chosen. The member has no devices; the first is paired next (Pair a device).
  - The sheet adds: "They sign in through the hub's Access. On production their email must be admitted there too: an Access change, the owner's."
  - The member id is 16 random bytes in hex, the 32 characters `isMemberId` takes. The hub rebuilds its members table from each accepted head (`org-chain.ts` `projectMembers`) and resolves a person by email against it, so the new member's `/api/me` names this id once the state is accepted.
- **`member.remove`.**
  - Each device's channel and step-up keys go to `revoked`, with their holders, and their step-up kids leave `root.keys`.
  - Refused:
    - for yourself;
    - for the member holding this Mac's device;
    - when they own a machine or a delegation (`owners-unknown`, naming each). Their machines change hands in M4b.
- **`member.role`.**
  - A demotion takes the member's step-up kids out of `root.keys`, a line saying so.
  - Refused:
    - for yourself ("another admin changes your role");
    - when it would empty the roots (`empty-roots`).
- **`member.email`.**
  - The line says the hub admits the member by the new email from this state on, and that on production Access must admit it too.
  - Refused: an email another member has (`email-taken`).
- **`device.remove`.**
  - Both of the device's keys go to `revoked`, and its kid leaves `root.keys`: `remove-device`'s edit, for any member.
  - Refused:
    - this Mac's own device (it leaves through New keys or M8);
    - `empty-roots`.
  - M3's old-device line becomes this action, in place of the `remove-device` command.
- **`root.add`.** Appends the device's step-up kid to `root.keys`, for an admin's `native-mac` device with a step-up key that isn't a root: `root add`'s rule, for any admin.

Each composer throws `StaleEdit` when its target is gone from the draft, so a head that moved under the sheet reads `stale`. Lines name members by email and devices by their first 8 characters with class, as `show` does.

*Pairing* (`pairing.ts`).
- **`org.pair.start {member, class}`.** Only while `maySign`, and only for yourself or a member with no devices; otherwise `refused` with the rule above.
  - `class` is `native-mac` (a Mac running MAWS, the default) or `web-cards` (a browser holding a passkey), chosen in the PairSheet. `judgeEntry` refuses an entry of another class, as `pair --class` does.
  - The app makes 16 random bytes `k`, then calls `encodePairingCode({hub, org, member, roots: root.keys, recoveryPub, k: base64urlEncode(k)})` (the code carries `k` as base64url, `pairing.ts:29-31`; `admin.ts:745-753`). It answers `{ok: true, code, expires}`. The TTL is `PAIR_TTL_MS`, 600 s, `pair`'s maximum.
  - The code is in that answer alone: the status never carries it or `k`, and the suites' secret check covers it. `k` lives in main's memory only, so a relaunch ends the pairing.
- **The polling.** Every `PAIR_POLL_MS` (2 s) it polls `GET /api/devices/pending?member=<id>`; for yourself, the plain read. Each entry is judged with today's signature, `judgeEntry(entry, {org, member, k, class, listed})` (`admin.ts:304-321`), with `listed` taken from the held head's device ids.
  - `503 hub-updating` and no answer keep polling (P5 Decision Log 121).
  - `403 not-admin` and `404 no-member` end the pairing as `refused` with that code.
  - Two matching entries end it: "two devices answered this code: start over".
- **The candidate is frozen once found.** The first matching entry becomes the pairing's candidate: its canonical device and that device's digest. The hub keeps a pending entry under its member and device id and replaces it on a repost (`org-chain.ts:243-260`, `INSERT OR REPLACE`), so a later poll can show the same id with other keys. If it does (another canonical device under the candidate's id, or a second match), the pairing ends as `entry-changed` or `two-entries`, and the person starts over. Main never swaps the candidate for a newer one.
- **The status.** `pairing: {generation, member, class, expires, entry: {id, class, keyStorage, fingerprint, digest} | null, problem: 'two-entries' | 'entry-changed' | 'expired' | 'not-admin' | 'no-member' | null} | null`.
  - `generation` counts pairings in this run.
  - `digest` is the candidate's canonical device digest.
  - The renderer's PairSheet shows the fingerprint, to compare with the device's own screen.
- **`org.pair.approve {generation, digest}`.** The approval names the candidate the person compared, as `pair` keeps the exact device it showed (`admin.ts:790-801`).
  - It refuses `stale` when the pairing's generation or the candidate's digest isn't the one named.
  - It then reads the pending list again and requires that same canonical device ("the entry changed after it was shown", `pair`'s rule).
  - It signs `device.approve` with the frozen candidate, never with what the read returned.
  - The edit carries a liveness guard, `Edit.live()`: true while the pairing is this generation and neither cancelled nor expired. It is checked at three points:
    - in `apply`, which throws `StaleEdit`, for the races before Touch ID;
    - in the device module, right after the confirmation and before any endorsement or state signature, where it reads `cancelled` (`StateSigner.sign` takes the guard);
    - in the signer, just before the pending slot's write, where it reads `stale`.
  - So a cancel or an expiry while Touch ID is open endorses, signs, slots and posts nothing.
  - Once the slot is written the proposal is durable, and cancelling the pairing no longer withdraws it. It settles as any pending proposal does, and M3's Discard is the way back, as the sheet says.
  - The edit appends the device to the member. For yourself, `Edit.endorse` names it, and the state signer endorses it with this Mac's step-up key inside the same Touch ID, before signing the state.
- **`org.pair.cancel`** ends it, advancing nothing a signing in flight relies on: that signing's `apply` sees the pairing ended and reads `stale`.

One pairing at a time, and none while a rekey runs, since both are the session's attempts.

*Endorsement inside one Touch ID.*
- `Edit` gains `endorse?: {member: string; device: string}[]` and `live?(): boolean`.
- `StateSigner.sign(state, prompt, {endorse?, live?})`, after the confirmation:
  - returns `cancelled` if `live` says no;
  - endorses each named device on the canonical copy it signs (`endorseDevice(org, member, device-without-endorsement, key)`);
  - then signs the state.
- The signer checks `live` again before the slot's write. `apply` already ran before Touch ID (`signer.ts:460-468`, Touch ID at `:485`), so it can't see a change made while the prompt is open.
- The signer passes `opts.endorsing` to `checkSuccessor`, so the device reads endorsed before Touch ID. `verifySuccessor` after signing checks the real endorsement.
- The key stays in the device module (P5 Decision Log 53).
- Rejected: two Touch IDs, one to endorse and one to sign, for one change the person confirmed once.

*The refused attempt.*
- `OrgRefusal` gains `attempt: 'register' | 'reanchor' | 'signIn' | 'rekey'`, set where the session sets `refused` (`org-session.ts`) and carried with it for as long as it stands.
- The renderer shows a refusal under the control whose attempt it names, which retires `OrgSection`'s `source` state and its after-reload heuristic (`rekeyRefused`; P5 Decision Log 126's residue).
- Pairing refusals are the pairing's own (`pairing.problem`, or the start's answer), not the session's.

*Close.* A late write comes from a producer, not only from the queue. A signer step awaiting a hub read can adopt after the queue has drained: `signer.ts:277-291` keeps its held view across `await hub.chain()`, its `close()` only sets flags (`:616-620`), adoption writes `chain.json` and queues an anchor (`held.ts:368-373`), and `writeAnchor` doesn't refuse a closed session (`org-session.ts:640-646`). So `close()` runs in four steps:
  1. It fences: `closed` is set, and every producer checks it after each await, before it adopts or queues a write. The signer's adoption checks its lifecycle epoch there, as its posts already do. `writeAnchor` and the session's other queued writers refuse to enqueue once closed. The held view's `adoptServed` takes a guard the session passes, which is false once closed.
  2. It stops the parts, as today.
  3. It awaits the producers in flight, from outside the commit queue, never inside it:
     - the signer's current operation, the sync and the deliveries' run, which each part's `close()` now returns;
     - the held view's own adoption queue. `HeldOrg.close()` fences it: a queued adoption checks the guard when it runs, not only when it was submitted. It returns the queue's tail, including a `chain.json` write already under way. An adoption reaches that queue from outside the session too: a link's direct `view.advance(...)` (`remote/link.ts:442-445`), which isn't awaited, and which writes `chain.json` outside the commit queue (`held.ts:285-292`, `:368-373`);
     - the session's load, if it is still running.
  4. It awaits the commit queue's tail.

  The rule: each writer under `org/` is one of these owners, and a new writer joins one of them.

  When `close()` resolves, nothing more is written under `org/`.
- The test workarounds go: 8d18883f4's `rm` retry, and 8e21b6354's wait for the anchor in `crashedRekey`.
- Two tests:
  - one holds a queued anchor write open and asserts `close()` resolves only after it lands;
  - one holds the signer's hub read open, calls `close()`, releases the read, and asserts that no file under `org/` changes after `close()` resolved;
  - one starts `view.advance` directly, as a link does, holds its `chain.json` write open, calls `close()`, and asserts `close()` waits for that write to settle.
- This closes the tracker row P5 Decision Log 129 opened.

*The split.*
- `settings-tab/org/OrgSection.tsx` keeps the status read and the state switch: none, development, registering, registered.
- Each group is its own file, and the sheets are their own.
- The M1 and M3 pieces move unchanged into You and Org: Held, Problem, SignerLines, NewKeys, Fingerprint, HeadAge, CodeField and Refusal.
- Their tests split with them. `OrgSection.test.tsx`'s cases keep their names in the group files, so a moved case reads as moved.
- The copy stays in `copy.ts`'s `ORG`. Its "Today that is `deployment admin pair --class native-mac`" lines become "An admin pairs it from their Org page (Pair a device), or `deployment admin pair --class native-mac`".

*Machines in M4a.* Read-only: name, owners by name, up or not. "Enroll a machine" reads "`deployment admin enroll <name>` (here in M4b)".

**Does not touch.**
- Machines' edits, grants and enrollment (M4b). Delegations (M4c).
- The deployment admin's end (M8).
- The countersign flow for a non-signing member's later device.
- The step-up prompt's full text (O7's re-plan, P5 Decision Log 126).
- `apps/org-protocol/src/` and `apps/desk-hub/deploy/` beyond the two reviewed commits.
- `apps/desk-hub/src/`, `src/endpoint/`, `apps/desk-web/`.

**Proves.** Acceptance 4a, each test named by the behaviour it pins.
- **The move:**
  - `admin.test.ts`, `admin-verbs.test.ts` and `production-scripts.test.ts` pass unchanged.
  - `org-protocol`'s `pairing.test.ts` gains the moved judges' cases: those admin's suites pin through `pair`, now on the functions themselves.
- **`apps/org-protocol/test/successor-problems.test.ts` (new):**
  - `successorProblems` names each problem, with one case per code.
  - Over the package's vectors whose successor `verifySuccessor` accepts with no transition, `successorProblems` finds nothing. Over those it refuses for a non-signature reason, it names a problem. The recovery vectors are outside its contract, and a case says so.
  - `endorsing` counts a named device as endorsed only under one of the member's own keys.
  - `stateInvariants` agrees with `stateProblems` on every vector.
- **`edits.test.ts`:**
  - each composer's successor passes `successorProblems` and the package's `verifySuccessor` once signed;
  - each refusal row above refuses;
  - a target gone from the draft reads `stale`;
  - `member.add`'s id is the one previewed.
- **`pairing.test.ts`:**
  - the code decodes to the target member with this head's roots;
  - an entry with a wrong MAC, class or id is "not this pairing's";
  - two entries refuse;
  - `503` keeps polling, while `403` and `404` end;
  - approve re-reads, and refuses a changed entry;
  - a same-id entry reposted with other keys, between display and approval, ends the pairing as `entry-changed`;
  - approval naming an old generation or digest reads `stale`;
  - a cancel or an expiry while the confirmation is held open, then answered yes, gives no endorsement, no state signature, no slot and no post;
  - a wrong class is "not this pairing's";
  - the code and `k` are never in a status;
  - expiry ends it.
- **`step-up.test.ts`:** one confirmation endorses and signs, the endorsement verifying under the device's step-up key; a cancel endorses nothing.
- **`checks.test.ts`:** `successorProblems`' codes arrive as refusals before Touch ID.
- **`org-session.test.ts`:**
  - `org.view` follows the head;
  - `org.preview` and `org.change` bind the digest (`stale`);
  - `refused.attempt` names each attempt;
  - `close()` resolves after a held anchor write;
  - a signer hub read released after `close()` writes nothing;
  - the two workarounds are gone and the cases still pass 20 runs in a row.
- **The renderer** (`settings-tab/org/*.test.tsx`):
  - each group draws its rows;
  - a machine's up state follows `machines.changed` while the org version stays the same;
  - read-only without `maySign`;
  - each change's sheet shows its lines and warnings, and Confirm sends the previewed digest;
  - a refused preview shows its findings and no Confirm;
  - the PairSheet shows the code once, then the entry's fingerprint, and approves;
  - the later-device rule is shown in place of the action;
  - a refusal shows under the control its attempt names;
  - M1's and M3's moved cases pass.
- **`test/org/org-page.local.test.ts`** (desk-hub's Worker in Miniflare, through `local-org.ts`), with app A a root through `root add`:
  1. A adds member B (`b@example.com`) and pairs B's first device. B's app, under the stand-in's identity for B, registers with A's code, and A approves through H1. B reads signed in.
  2. A changes B's role to admin and makes B's device a root. B's app reads `root`.
  3. A demotes B, and B's root leaves.
  4. A pairs a second profile of its own member, endorsed, and the hub accepts it.
  5. A removes B's device, then B. B's app reads removed.
  6. Every state the hub accepted verifies from genesis.

  This is P5 acceptance 12's "a second member added by an org-state edit", here on the local hub. Staging's is M6's sitting.

### M4b — Machines and their rights *(executable; re-planned 2026-11-06)*

**At its end.**
- The Org page's Machines group is no longer read-only. While this Mac may sign, an admin enrolls a machine, a machine's owner (or an admin, for an org-owned machine) changes its owners, drops it, and grants rights on it, and a machine whose grants were lost is re-granted.
- **Enroll a machine.** Enrolling takes a name, or "Re-enroll <machine>" from the row (`--replace`'s case). The app then does what `deployment admin enroll` does (`admin.ts:878-946`):
  - it mints `POST /api/enrollments {ttl_s: 3600, machine?}` and makes 32 random bytes `k`;
  - it shows the code once, with Copy, beside the line "On the machine, run `mawsd endpoint enroll <code>`";
  - it polls `GET /api/enrollments/<id>/key` every 5 s, where `404 no-key` means wait, then runs `verifyEnrollmentMac`;
  - it shows the machine's name, ref and key id to compare with `mawsd keys --json` on the machine;
  - it signs `machine.add` or `machine.replace` through the change sheet.
  - The code and `k` live in main's memory and that one answer, as a pairing's do (M4a's rule).
- **Owners.** `machine.owners {ref, owners}` sets an attended machine's `owners`: a non-empty list of member ids, or `'org'`. A certified machine (a devcloud VM) has no owners of its own: its row says its owners are its delegation's, and that they change with the delegation (M4c).
- **Drop.** `machine.drop {ref, revoke}` removes the machine from `machines`. Its key goes to `retired` by default, or to `revoked` when "Its key may be compromised" is ticked, as `machine drop [--revoke]` does (`admin.ts:1100-1131`). The app then deletes the hub row (`DELETE /api/machines/<name>`). A failed delete shows "Signed. The hub still lists <name>: Retry", and Retry calls only the route.
- **Rights.** Each machine row lists the members who hold a grant on it, with their rights (`spawn`, `shell`, `machine-admin`; owners hold every right and need none). "Grant…" opens a sheet: a member, then the rights, each with one line on what it allows.
  - Granting, changing and withdrawing are each a signed `Grant` at the next version. Withdrawing is a grant with no rights.
  - Each is signed with this device's step-up key behind one confirmation that shows the grant, then delivered with `endpoint.grant` over the machine's link and acknowledged (`src/main/machines/remote/acts.ts`, `endpoint-actions.ts:103-108`).
  - Only a member who may sign the grant sees the action: an owner of the machine, or an admin when its owners are `'org'` (`verifyGrant`, `records.ts:72-105`).
- **Re-granting.** When the machine's ledger no longer holds a grant this app issued and the machine's key is current (its ledger was lost, or the machine was enrolled again with a new key), the row says "N grants this Mac issued are missing on <machine>". Re-grant… shows each grant, then signs it for the machine's current key at a version above both the issued record's and the ledger's, and delivers it. This is P5's "re-signs a re-enrolled machine's grants showing each one first", with the reason corrected (Decision Log, 2026-11-06).

**Touches.**
- **The move, first commit** (desk-track reviewed, as M4a's was):
  - `encodeEnrollmentCodeV2`, `decodeEnrollmentCodeV2`, `EnrollmentCodeV2` and their validation move from `apps/desk-hub/src/protocol/identity.ts:467-501` to `apps/org-protocol/src/enrollment.ts`, exported from `index.ts`;
  - the identity file and `admin.ts` import them;
  - `certificateViews`, `resolveMachine` and `machineRows` (`apps/desk-hub/deploy/admin-machines.ts`) move to `apps/org-protocol/src/machines.ts`, with their input typed by a package-owned structural `MachineRow` that the hub's `MachineView` satisfies.
  - `pnpm --filter desk-hub build` (a `wrangler deploy --dry-run`) stays clean (the desk track's condition).
- **`org-protocol`, in the move's commit:** `grantProblems`, the eligibility half of `verifyGrant` (*Grants*, below).
- **`src/endpoint`, second commit** (desk-track reviewed): the call `endpoint.grants` (machine-targeted, `list`), which answers `{members: [{member, grant: Signed<Grant> | null, highWater: number}]}` from the ledger (`src/endpoint/grants.ts`): the caller's own entry, or every member's when the caller is an owner of the machine, or an admin of an org-owned one. `highWater` is answered even when no grant survives (a revoked signer's grant is deleted, while its high-water mark stays, `grants.ts:56-65`). Its offer row, and its test in `test/endpoint/`.
- **Main:**
  - `src/main/org/edits.ts`: `machine.add`, `machine.replace`, `machine.owners` and `machine.drop`;
  - `src/main/org/enroll.ts` (new): the enrollment, built as `pairing.ts` is;
  - `src/main/org/grants.ts` (new): the issued record, signing, delivery and the missing-grant judge;
  - `src/main/device/step-up.ts`: `RecordSigner`, which signs one record behind one confirmation;
  - `src/main/org/hub-client.ts`: `mintEnrollment`, `enrollmentKey` and `deleteMachine`;
  - `src/main/org/files.ts`: `grants.json`;
  - `org-session.ts`: the commands, the enrollment and grants as parts that `close()` joins;
  - `src/main/index.ts`: wiring;
  - their tests.
- **Shared:** `src/shared/ipc/schema/org.ts` (`OrgChange`'s four kinds; `OrgView.machines` gains `pub` key id, `certified`, `delegation`; `org.enroll.*`, `org.grants.*`; `OrgStatus.registered.enrolling`), `routes.json`, `names/org.ts`.
- **Renderer:**
  - `settings-tab/org/MachinesGroup.tsx`, with its actions;
  - `EnrollSheet.tsx` and `GrantSheet.tsx` (new);
  - `ChangeSheet.tsx` gains the machine kinds' fields;
  - `copy.ts`'s `ORG`;
  - their tests;
  - `e2e/org-page.spec.ts`'s seed and screenshots gain the Machines group's actions, a machine with several grants, and an enrollment awaiting its key.
- **Tests:** `test/org/org-page.local.test.ts` gains the enrollment and grant cases (below).

**Interfaces.** It produces §R. It consumes:
- M4a's change pipeline (`composeChange`, `org.preview`, `org.change`, `Edit.live`) and its pairing as the pattern for the enrollment;
- M3's signer and deliveries;
- `org-protocol`'s `verifyEnrollmentMac`, `signRecord`, `verifyGrant` and `SIGNING_DOMAINS.grant`;
- the link's `act` and `call` (O7 M1, O10 M7).

**Decisions.**

*The move.* It is the frontier M4a named for these functions (M4a, *What moves later*). Their bodies and outputs don't change, and `admin.ts`'s suites passing unchanged is the proof. Rejected: app-side copies, for M4a's reason.

*The enrollment* (`enroll.ts`; `org.enroll.start {name, replace?: ref}`, `org.enroll.approve {generation, digest}`, `org.enroll.cancel`).
- **Who may.** Only an admin, since the mint route is admin-only (`registry.ts:294-322`) and the poll answers only the member who minted it (`registry.ts:1433-1441`). An admin whose app can't sign sees the action, with "This Mac can't sign: enroll from an admin's Mac that does".
- **The checks before the mint**, as `enroll` makes them:
  - a name already listed refuses `name-taken` unless it is `replace`'s own;
  - a name the state binds permanently to another ref (`machineNames`) refuses `name-bound`;
  - a name inside a delegation's prefix refuses `name-in-prefix`.
  These are `successorProblems` codes where the package has them, and composer refusals otherwise.
- **The candidate is frozen at its first good answer:** name, ref, pub and MAC. A later poll that shows another key for the same enrollment ends the attempt `key-changed`, as a pairing's `entry-changed` does.
- **Approval** names `{generation, digest}` of what was shown (M4a's rule), composes `machine.add {name, ref, pub, owners: [the enrolling member]}` and a `machineNames` pair. For `replace`, it composes `machine.replace {ref, pub}`, which retires the old pub under `{machine: ref}` with `notAfter`, as `enroll --replace` does (`admin.ts:924-943`).
- The edit carries `live()` as a pairing's does. A cancel or expiry (the mint's TTL) while Touch ID is open signs nothing.
- One enrollment at a time, none while a pairing or a rekey runs.

*Owners and drop.*
- `machine.owners` refuses a list naming a non-member (`owners-unknown`). It also refuses an empty list (`shape`), and changing a certified machine (`certified-machine`: "its owners are its delegation's").
- `machine.drop` refuses this Mac's own machine (`this-machine`: it leaves through `mawsd endpoint unenroll`), and a certified machine, which retires through `mawsd endpoint retire` on the machine, or through dropping its delegation.
- Lines name the machine by name, and owners by email.
- A drop's key ending is also delivered to the roster's machines (M3's deliveries), since an ended key is an ending the endpoints must hear.
- M4a's `member.remove` refusal (`owners-unknown` for a member who owns a machine) now names "Change the machine's owners first", with the machine's row linked.

*Grants* (`grants.ts`).
- **The record.** `<userData>/org/grants.json` is 0600 and written through the commit queue. It holds `{version: 1, issued: [{signed: Signed<Grant>, delivered: 'pending' | 'done' | {refused: string}, op?: string}]}`: every grant this app signed, the latest per (machine, member). It is listed in §C and joined by `close()`.
- **The version.** The next version is above both the issued record's and the ledger's `highWater` for that member, read through `endpoint.grants` just before signing. A ledger read that fails refuses the sign `ledger-unread`, so a version is never guessed. Another issuer (another owner's device) can move the mark meanwhile, and the endpoint then answers `not-newer` with no number (`grants.ts:38-51`). In that case the app reads `endpoint.grants` once more and offers "Another device changed this grant: sign again", one more confirmation, never a silent retry.
- **Signing.** `RecordSigner.sign(domain, body, prompt, {live?})` confirms once, checks `live`, then calls `signRecord`. The key stays in the device module (P5 Decision Log 53).
  - The prompt names the machine, the member and each right.
  - **Before Touch ID**, `grantProblems(state, certificates, body, signerKid)` judges the unsigned grant: the machine listed or certified, `machineKey` its current uncontested key, the member listed, the rights known, and `signerKid` a step-up key of an owner's device (an admin's for `'org'`). This new package function is the eligibility half of `verifyGrant` (`records.ts:72-105`), which becomes eligibility then signature. It lands in an `org-protocol` commit of its own, desk-track reviewed, with `verifyGrant`'s verdicts unchanged (its suites prove it). A placeholder signature can't stand in, since `signedByIn` checks it (`records.ts:48-52, 79-89`).
  - **After signing**, the full `verifyGrant` runs against the held head before the grant is kept or sent.
- **Delivery.** `endpoint.grant {grant}` is sent as an act over the machine's link, `stepUp: 'none'`, since the grant carries its own signature.
  - The record notes `pending` before the send, and the act's outcome after it.
  - An act the endpoint answers `expired`, because its ledger reopened (`orphanAtOpen`, `endpoint-actions.ts:15-18`), is sent again as a new op.
  - A machine that is offline keeps `pending`, sent again when its link comes up, as M3's deliveries are.
- **Missing grants.** At each `endpoint.grants` answer, an issued grant the ledger lacks is missing. The real case is a machine enrolled again with a new key and an empty ledger. A lost ledger is that case too: the endpoint's startup moves the key and the ledger aside together when one of them is gone, and reads unenrolled (`src/endpoint/state/store.ts:286-300`), so it comes back only through re-enrollment. The re-grant offer lists them. An issued grant whose rights are empty (a withdrawal) is never offered.
- **Display.** Rights are read from `endpoint.grants`, the machine's own word, with the issued record's `pending` ones marked "Not yet on <machine>". An offline machine shows the issued record's view "as of" its last answer.
- Rejected:
  - grants in the org state, which changes RL5 and every verifier;
  - re-signing at every key change without reading the ledger, which reissues grants that `--replace` kept (`enroll.ts:208-225`).

**Does not touch.** Delegations and their owners (M4c). Certified machines' retirement on the machine. `apps/desk-hub/src/` beyond the move's import. `apps/desk-web/`.

**Proves.** Acceptance 4b.
- **The move:** `admin.test.ts`, `admin-verbs.test.ts` and `production-scripts.test.ts` pass unchanged. `org-protocol`'s `enrollment.test.ts` gains the codec's cases, and `records.test.ts` gains `grantProblems`' cases, with `verifyGrant`'s existing cases unchanged. `pnpm --filter desk-hub build` is clean. The strip-types import line (M4a's form) prints `function` for each moved name.
- **`test/endpoint/` `grants-call.test.ts`:** a member reads only their own grant; an owner reads every member's; a non-member reads nothing.
- **`edits.test.ts`:**
  - each machine composer's successor passes `successorProblems` and `verifySuccessor` once signed;
  - each refusal row refuses;
  - `replace` retires the old pub and keeps the owners and the ref.
- **`enroll.test.ts`:**
  - the code decodes with this head's roots and `k`;
  - a wrong MAC, or another name, is not this enrollment's;
  - a changed key ends it `key-changed`;
  - `404 no-key` keeps polling, while `403 not-yours` and `403 not-admin` end it;
  - approve with an old digest reads `stale`;
  - a cancel while the confirmation is open signs nothing;
  - the code and `k` are never in a status.
- **`grants.test.ts`:**
  - the version is above the record's and the ledger's `highWater`, including a member whose grant is gone and whose mark stays (a new signer replaces a revoked signer's grant without guessing);
  - `not-newer` re-reads once and asks again;
  - an unread ledger refuses;
  - the grant verifies against the head before it is kept;
  - a non-owner's grant refuses before Touch ID, and an owner's unsigned draft passes `grantProblems` and reaches exactly one confirmation;
  - delivery records `pending`, then the outcome;
  - an `expired` outcome resends as a new op;
  - missing grants are found in both cases, and a withdrawal is never re-offered;
  - `grants.json` fails closed when unreadable (the page says so and signs no grant).
- **`step-up.test.ts`:** `RecordSigner` confirms once, and a cancel signs nothing; the grant verifies under the device's step-up key.
- **The renderer:** each action's sheet; the code shown once, then name, ref and key id to compare; rights per member; "Not yet on"; the missing-grant offer; read-only without `maySign`; the certified machine's owner line.
- **`test/org/org-page.local.test.ts`** (desk-hub's Worker in Miniflare and a real endpoint, through `local-org.ts`):
  7. A enrolls a machine from the app. The endpoint redeems the code and posts its key, A compares and approves, and the endpoint reads `org-listed`.
  8. A grants B `spawn` on it. The endpoint's ledger holds it, and `machineRights` gives B `spawn`.
  9. The endpoint's `grants.json` is removed and the endpoint restarted. Its startup invariant moves the key, the ledger and the enrollment aside and reads unenrolled (`src/endpoint/state/store.ts:286-300`), which the case asserts. A re-enrolls it from the page (Re-enroll, `machine.replace`, a new key). The page shows B's grant missing under the earlier key, re-grants it for the new key above the mark, and the new ledger holds it.
  10. A changes the machine's owners to B, then back. A drops it, and the hub row goes.
  11. Every state the hub accepted verifies from genesis.

### M4c — Delegations *(executable; re-planned 2026-11-06)*

**At its end.**
- The Org group gains **Delegations**. Each delegation shows its prefix, its owners, its expiry ("expires in 23 days"), its uses, and the certified machines it has made, each live or retired.
- While this Mac may sign, an admin creates, renews and drops a delegation from the app, under M3's checks (P5 Decision Logs 30, 31), which now live once, in `org-protocol`.
- **The code never shows.** A new delegation's provisioning code goes straight from main into Secret Manager as a new version of the secret the owner names. It is never displayed, put on the clipboard, written to disk, logged or sent to the renderer (the architect's ruling, 2026-11-06; P5 Decision Log 75 (1)).
- **Renewal** extends the delegation in the signed state, then the hub's provisioning credential through the desk track's `POST /api/provisioning-keys/<id>/renew`. That route takes no body: the hub reads the new `expires` from the delegation in its held head. A renewal whose second half failed reads "Renewed in the org state; the hub's key still expires <date>: Retry", and Retry calls only the route.
- **Drop** revokes the delegation's key, moves its certificates' `retired` entries to `revoked` (`drop`'s edit, `admin.ts:1070-1092`), warns first (M3's `drops-delegation`), then deletes the hub key. A failed delete shows Retry, which calls only the route.

**Touches.**
- **`org-protocol`, first commit** (desk-track reviewed):
  - `prefixProblem` (`admin.ts:812-827`) and `mintDisagrees` (`admin.ts:949-970`) move to `apps/org-protocol/src/delegations.ts`.
  - `successorProblems` gains the directional prefix codes (`prefix-equal`, `prefix-nested`, `prefix-covers`) for a delegation new in `after`, beside `stateProblems`' `prefix-overlaps`, which stays for whole states.
  - `admin.ts` imports both.
- **Main:**
  - `checks.ts` drops its own prefix rows and keeps the renewal rows (`renew-expired`, `renew-not-extension`), the drop warning and the superseded offer;
  - `edits.ts`: `delegation.add`, `delegation.renew`, `delegation.drop`;
  - `src/main/org/delegations.ts` (new): the create transaction, renew's and drop's hub halves;
  - `src/main/org/secret-store.ts` (new): the gcloud custody;
  - `signer.ts` and `signing-store.ts`: `Edit.hold`, an edit signed into the slot held unsent, and `publishHeld(hash)` (*The held slot*, below);
  - `hub-client.ts`: `mintProvisioningKey`, `renewProvisioningKey`, `revokeProvisioningKey`, `provisioningKeys`;
  - `org-session.ts`: the commands;
  - `src/main/index.ts`: the gcloud resolver;
  - their tests.
- **Shared:** `org.ts` (`OrgChange`'s kinds; `OrgView.delegations`; `org.delegation.*`; the settings field below), `routes.json`, `names/org.ts`; `src/shared/ipc/schema/settings.ts` (`org.provisioningSecret`, machine settings).
- **Renderer:** `settings-tab/org/OrgGroup.tsx` (Delegations), `DelegationSheet.tsx` (new), `copy.ts`, their tests, and the e2e seed's delegation rows.
- **The desk track's PR, before M4c's** (the architect's ruling 2, 2026-11-06): `POST /api/provisioning-keys/<id>/renew`. *Landed as #493 (6e648911a, P5 Decision Log 230), and deployed to staging and to production's hub@14ec1177 (the architect, 2026-11-08).*
  - Admin-only, with no body. The hub takes the new `expires` from the delegation with that id in its held org-state head.
  - It answers `200` with the key as `GET` lists it, or `404` for an unknown id.
  - It refuses a revoked or already-expired key (no revival). It refuses `not-renewed` when the head's delegation for the id is absent or not later than the hub's `expires`. It refuses an `expires` past now + `MAX_PROVISIONING_KEY_TTL_S`, the creation cap.
  - Its codes are in §S: `200`, `403 not-admin`, `404 unknown-key`, `410 key-revoked`, `410 key-expired`, `409 not-renewed`, `409 too-long` and `503 hub-updating`. Staging gets it from the desk track; production gets it at the owner's next production hub deploy.

**Interfaces.** It produces §S. It consumes:
- M4a's change pipeline;
- M3's signer, pending slot and checks;
- the hub's provisioning-key routes and the desk track's renew route;
- `org-protocol`'s `encodeProvisioningCodeV2`, `signOrgState` and the delegation types.

**Decisions.**

*The create transaction* (`org.delegation.create {label, prefix, ttlDays, maxUses: number | null, owners}`), in `admin.ts`'s order:
1. **Before anything is minted:**
   - The prefix passes `prefixProblem`.
   - The destination is set (below), and gcloud is resolved and signed in: `gcloud auth print-access-token --account <account>` exits 0, its output discarded.
   - The secret exists: `gcloud secrets describe <secret> --project <project>` exits 0.

   Any failure refuses `secret-store`, naming what's missing, and nothing is minted or signed.
2. It mints exactly as `delegationCreate` does (`admin.ts:985-1029`): `POST /api/provisioning-keys {label, prefix, ttl_s, max_uses?}`. The sheet's values map like this:
   - `label`: the sheet's required Label field, 1 to 100 characters;
   - `ttl_s`: `ttlDays × 86,400`, inside `MIN_PROVISIONING_KEY_TTL_S` to `MAX_PROVISIONING_KEY_TTL_S`, checked in the sheet;
   - `max_uses`: present only when a cap is chosen (1 to `MAX_PROVISIONING_KEY_USES`). Uncapped sends none, and signs `maxUses: NO_USE_CAP`.

   The answer must be `201`, and is checked with `mintDisagrees(issued, {prefix, ttl, maxUses, before, after})`. A disagreement revokes the minted key and refuses. With `ttlSeconds = ttlDays × 86,400` and `beforeMs = Date.now()` taken just before the mint, the signed delegation's `expires` is `new Date(beforeMs + ttlSeconds × 1000).toISOString()`, and `mintDisagrees` gets the same units (`ttl: ttlSeconds`, `before` and `after` in milliseconds), as `admin.ts:953-963, 1009-1026` does. `offlineRevokeS` is `NEVER_OFFLINE`, as admin's is.
3. It makes the delegation's key pair in main, composes `delegation.add {id, pub, prefix, expires, maxUses, offlineRevokeS, owners}`, and signs it into the pending slot **unsent** (`Edit.hold`). This is the change sheet's one Touch ID. The sheet says the code will go to `<project>/<secret>` as a new version.
4. It encodes the `smns-provision-v2` code in memory (`encodeProvisioningCodeV2`, `apps/org-protocol/src/provisioning.ts:122`) and runs `gcloud secrets versions add <secret> --project <project> --account <account> --data-file=-`, with the code on stdin alone. Its stdout and stderr are read for the version name and an error line, never logged whole.
5. It confirms with `gcloud secrets versions describe <version> … --format=json`, which reads the version's metadata (`name`, `state: ENABLED`, `createTime`), never its value.
6. It publishes the slot (`publishHeld(hash)`, with the hash step 3 captured), and the signer settles it as any pending proposal.

*The held slot.* An unsent delegation is a persisted phase of the pending slot, not a skipped first post:
- `signing.json`'s `pending` gains `unsent: {kind: 'delegation', id} | null` (named `held` until the refresh, item 2), written in the same `update` that writes the slot.
- **Nothing automatic posts a held slot.** It is excluded from `settleLocked`'s repost (`signer.ts:444-464`), which the session runs at startup and at a feed's reopen (`org-session.ts:643, 812`), from deliveries and from the weekly asking. Any other signing attempt meanwhile answers `pending`, as an ordinary unsettled slot does.
- **`publishHeld(hash)`** runs under the signer's existing exclusive operation, in two steps. First, one `SigningStore.update`, whose callback stays pure and synchronous (`signing-store.ts:29-38, 92-109`), checks that the slot's stored hash is `hash` (the slot this create made) and still `held`, and durably clears `held`. Only after that update resolves does it run the normal post path, which writes exposure first, as every post does (`signer.ts:361-382`). So a gcloud operation that finishes after a Discard, or after another slot replaced it, publishes nothing, and a crash between the two steps leaves an ordinary pending slot that settles.
- **A relaunch** finds `held` with no key pair in memory. The row offers only Discard. It names the minted hub key, and Discard also revokes it, as admin's message says (`provisioning revoke`).

A failure at 4 or 5 leaves the slot held, with the reason under the delegation row. "Write the code again" retries 4 and 5 while this run holds the key pair. Once the app has quit, the key pair is gone, and the row offers only Discard (M3's), since a delegation whose private key nobody holds must not be published. The key pair and the code live only in main's memory and the child's stdin, and are dropped at publish, discard, sign-out or quit.

*The destination.* `org.provisioningSecret {project, secret, account}` is a machine setting, set once in the Delegations section. Nothing is read from devcloud's files.
- Production's is the owner's Google Cloud project (not recorded in this repository), secret `desk-provisioning-v2` and the owner's CLI service account. These are the secret B4 step 6 versions, and the account O14 names as the MacBook's gcloud identity with Secret Manager access (O14's Dependencies).
- Devcloud's boot reads `latest` (B4 step 6), so the new version is what the next VM uses, provided the profile's `[desk] delegation_id` names the new delegation. The sheet says so for a delegation that isn't the profile's.

*gcloud.* A GUI app's `PATH` lacks Homebrew, so main resolves `gcloud` explicitly:
- the captured login-shell environment's `PATH` (the engine's, `engineEnv`);
- else `/opt/homebrew/bin`, `/usr/local/bin` and `~/google-cloud-sdk/bin`.

None found refuses `secret-store: gcloud not found` before the mint. The resolver is injected, so tests put a fake `gcloud` first on a scratch `PATH`.

*Renew* (`delegation.renew {id, expires}`).
- Refused before Touch ID by:
  - M3's `renew-expired` and `renew-not-extension`;
  - `renew-past-cap`, an `expires` past now + `MAX_PROVISIONING_KEY_TTL_S`. The hub would refuse it after the state was signed, leaving the two halves apart for good.
- The state is the authority, so its extension is signed and settled through the signer first. Then `POST …/renew`, with no body.
- The route's answers (§S):
  - `409 not-renewed` is the half-done case: the head the hub holds hasn't the extension yet. Retry calls the route alone.
  - `503 hub-updating` is retried, and is not a failure of the renewal.
  - `410 key-revoked` and `410 key-expired` end it with their words, since an elapsed key is never revived.
  - A production hub without the route (before the owner's deploy) answers `404 not-found` with the Worker's build header. The row then reads "Renewed in the org state; this hub can't renew its key yet", with Retry.
- A delegation's `expires` is always ISO millis, so neither sheet offers "no expiry". `delegations.test.ts` covers every code against a fake hub.
- The hub's key is read through `provisioningKeys()` at each view, so the row shows the hub's expiry beside the state's, and a mismatch ("half-done") offers Retry.

*Drop* (`delegation.drop {id}`). Composed as `admin.ts`'s. `drops-delegation`'s warning names its certified machines and says the id and the prefix stay reserved for good. After the signer settles it, `DELETE /api/provisioning-keys/<id>`, with Retry on failure.

*The view.* `OrgView.delegations`: `{id, prefix, owners, expires, maxUses, machines: {ref, name, live}[], hub: {expires, uses} | null, held: 'unsent' | null}`. `held: 'unsent'` marks the slot's delegation between steps 3 and 6.

Rejected:
- showing the code with Copy, which breaks DL75's custody;
- a CLI helper taking the code over a pipe, which adds a process and a protocol for the same custody;
- renewal as rotation, which burns a prefix and isn't "renew".

**Does not touch.** devcloud's profile and boot. `production-run.sh`'s `--pipe` mode, which stays for the owner's B4. The hub beyond the desk track's route.

**Proves.** Acceptance 4c.
- **`org-protocol`:** `delegations.test.ts`, with the moved functions' cases; `successor-problems.test.ts`, with the directional codes; `admin.test.ts` and `admin-verbs.test.ts` unchanged.
- **`checks.test.ts`:** one finding per prefix collision (the duplicate gone); the renewal rows as before.
- **`delegations.test.ts`** (main), with a fake `gcloud` on a scratch `PATH` that records its argv and stdin to a file the test reads:
  - a missing or signed-out gcloud, or a missing secret, refuses before any mint;
  - a mint disagreement revokes and refuses;
  - the code reaches the fake's stdin and nowhere else (not the log, any file under the profile, a status, the renderer's payloads or argv);
  - the fake failing at `versions add` leaves the slot unsent with the reason, and "Write again" succeeds;
  - after a simulated relaunch only Discard is offered;
  - the metadata check reads `describe` and never `access`;
  - publish settles the slot;
  - a held slot survives startup, a feed's reopen and another signing attempt unposted (`settle` never sends it);
  - a gcloud success arriving after Discard, or after a replacement slot, publishes nothing (the hash binding);
  - a crash before `publishHeld`'s write leaves it held (only Discard after the relaunch), and a crash after leaves an ordinary pending slot that settles.
- **`edits.test.ts`:** each delegation composer passes `successorProblems` and `verifySuccessor` once signed; renew refuses an expired or shortened delegation; drop moves its certificates' `retired` to `revoked`.
- **The renderer:** the rows, the half-done renewal, the unsent row's two actions, and the destination setting.
- **`test/org/org-page.local.test.ts`:**
  13. A creates a delegation through the fake gcloud, against the real local hub's mint (so the request's mapping meets the hub's own parser). The case asserts the request's fields, and the signed `expires` within a minute of now + `ttlDays` days. A real endpoint provisions from the code the fake received, its certificate verifies, and it lists.
  14. A renews it, and the hub's key expiry follows.
  15. A drops it. The certificate's key reads revoked, and the hub key is listed revoked (numbered 13-15 and "listed revoked" at the refresh, 2026-11-08).

### M5 — Owners on rows and the People toggle

**At its end.**
- A row of a session you don't own alone shows its owners after the title, as first names in the chip's secondary style ("you, Ana", "Ana, Ben +3" past two), and its hover card lists them all with their emails (Q2). Your own sessions look as today.
- Each org project (and machine row) has a People toggle, off by default and remembered per project, on the project row's hover actions and in its menu. On, other people's sessions join the project's list in activity order, each with its owners and machine chip. Off, the project row says "+N others", faint, when there are any (Q3).
- "Add owner" is split out as M5b, below.

**Touches.**
- Shared: `src/shared/org/member-name.ts` (new: `memberName(email)`), `src/shared/ipc/schema/org.ts` (`OrgMember`; `OrgRows.members`), `src/shared/ipc/schema/layout.ts` (`LayoutKeySchema` gains `'sidebar.people'`).
- Main: `src/main/org/rows.ts` (`members` on `rows()`), and its test.
- Renderer:
  - `stores/sessions.ts` (`members` kept beside `listed`);
  - `stores/people.ts` (new: the toggle's set, read and written through `layout.get`/`layout.set` as `stores/summary.ts` keeps `summary.sections`);
  - `sidebar/owners.ts` (new: `ownersLabel`);
  - `sidebar/derive.ts` (others filed and counted, or drawn under People), `ProjectRow.tsx` ("+N others", the toggle's hover action), `menus.tsx` (the checked item), `ListedRow.tsx` and `SessionRow.tsx` (the owners label), `HoverCard.tsx` (owners in the listed card, and in a record's card at a listed address);
  - their tests.

**Interfaces.** It produces §L. It consumes M2's rows and listed partition, the held head's `members` (in main), and the layout store.

**Decisions.**

*Names.* The signed state's members carry `id`, `email`, `role` and `devices`, and no name (`isMember` takes those four fields alone). A first name is derived from the email: its local part's first run of letters, split at `.`, `_`, `-`, `+` or a digit, capitalized ("ana.lopez@…" reads "Ana"). Two members of the head whose derived names collide both read their whole local part. An owner id the head doesn't list reads "former member". Rejected: a signed `name` field, which changes RL5's closed member shape for the hub, the endpoint and sminos; showing emails on rows, which crowds the row.
- Main sends `OrgRows.members`: `{id, email, name}` for every member id that some row names, from the held head, so the renderer never derives from state it doesn't hold. And `OrgRows.member`: the signed-in member's id, null signed out, in the same payload as the rows, so "you" is always judged against the identity the rows were computed for (`rows()` holds it in main today, `rows.ts:401`, and sends only `mine`).

*The label* (`ownersLabel(owners, me, members)`, `me` being `OrgRows.member`). `null` when the owners are exactly you. Otherwise "you" first when you are an owner, then the others' names in the listing's order, two shown and "+N" past them. After the title and before the machine chip, in `MachineChip`'s style (`text-ui-sm text-fg-muted`, faint when offline). Truncated with the title, never the chip.
- **Which rows.** Listed rows. A local record has no owners (`SessionRecordSchema` has none), so a local session's row is unchanged; a record drawn at a listed address (M2's yield rule) takes the listing's owners for its label and hover card.

*The People toggle* (Q3; O6's T6).
- **Where it's remembered.** The layout key `sidebar.people`, `{version: 1, on: RowKey[]}`, read once and written 250 ms after the last change, as `summary.sections` is. A key needs no layout version: `LayoutKeySchema` is a union of literals and main's `layout.set` stores any value for a key it lists (not `panel.…`). Rejected: a field on `SidebarRegionSchema`, which an older build reading the new value fails to parse, losing width, sort and expanded projects.
- **Ownership comes first, then the presentation.** For every address `projectList` meets, a record's or a listing's, it is *others'* when a listing at that address exists and isn't `mine`, and *yours* otherwise (a local record with no listing is yours; records carry no owners). Then:
  - **Filing.** It is filed by `rowOfSession` for a record and `rowOfListed` for a listing, as M2 files them, and a record at a listed address still wins as the row that's drawn.
  - **Visibility.** Others' rows are drawn, as the record or the listing, only while their row key is in the toggle's set; otherwise they count in the entry's `others`. So a session of someone else's that a lane opened into a record leaves the list when People goes off. (`projectList` files records unconditionally today, `derive.ts:95-108`, which this changes.)
  - **Rollups** count yours only: others' `waiting` and `busy` rows draw their glyphs but don't add to the project's waiting or working counts, which say what needs you. Rejected: counting others' waiting, which the toggle would turn into a false "needs you".
  - **Search** matches drawn rows only, so others' rows match while the toggle is on.
  - **Machine rows** with `others` above zero stay in the list even with nothing of yours drawn (the pruning at `derive.ts:141` keeps them), so "+N others" and the menu's toggle stay reachable.
- **The hover action.** A fourth `ProjectActions` button (lucide `Users`), "Show people's sessions" or "Hide people's sessions", pressed while on. **The menu** gains "Show people's sessions" with a check while on, after "Mark all read", for project and machine rows alike (machine rows have no hover actions).
- **"+N others"**: `text-ui-sm text-fg-faint`, after the name, while the toggle is off and `others` is above zero, hidden on hover as the rollups are.

**Does not touch.** Owner changes (M5b). Owners on local records (none exist before O3-D). Visibility, shares and `endpoint.listings` (M6). `apps/`, `src/endpoint/`.

**Proves.** Acceptance 5's display half, P5 acceptance 11.
- `member-name.test.ts`: the derivation's cases, and collisions.
- `rows.test.ts`: `members` names every owner a row lists, from the held head; an unlisted id reads "former member".
- `owners.test.ts`: `null` for you alone; "you, Ana"; "Ana, Ben +3"; former members.
- `derive.test.ts`: others counted while off, drawn under People on; a record at an others' listed address hidden while off and counted, drawn while on, never in the rollups; a record at your listed address winning as today; rollups counting yours only; search over drawn rows; a machine with only others' sessions kept with its `others`; the toggle's set per row key, machine rows included.
- `Sidebar.test.tsx`: the label on a co-owned and a foreign row and none on yours; "+N others" faint and hidden on hover; the hover action and the menu item toggling and persisting through `layout.set` (and restored from `layout.get`); others' rows in activity order with owners and chips; the hover card listing every owner with emails.
- `events.test.ts` or the store's test: `members` and `member` applied with the rows; a co-owned-only dataset labelled "you, …"; a change of signed-in member relabelling every row from the new payload.

### M5b — Add owner *(executable; re-planned 2026-11-06; lands once the desk track's executor and DL190 (b)'s fix are on master)*

**At its end.**
- "Add owner…" is on a listed row you own (M6b's row menu) and on a local session's row that has a listing. It opens a sheet listing the head's members who aren't owners.
- Saving sends `record.owners {add: true, member}` as a step-up act, through M6b's record path, to the session's machine (or this Mac's own door). The act's outcome shows in the sheet.
- The session's next listing names the new owner, and M5's label shows them.
- No removal: RL §6.1 grades another's removal differently, and the owner never asked for it.

**Touches** (revised 2026-11-09 at the cut: M6b built the main side; Decision Log, "M5b's refresh at its cut").
- Renderer: `sessions/share/AddOwnerSheet.tsx` (new), its dialog kind beside `share` (`sessions/dialogs.ts`, `SessionDialogs.tsx`), the "Add owner…" item beside Share in the row menu (`sidebar/menus.tsx:103`) and the session's header menu (`app/Toolbar.tsx:250`), `sessions/share/copy.ts`, tests.
- Test: `test/org/policy.local.test.ts`'s sminos stand-in appends the verified act to `ownersProof`, and one new case.
- Already on master, from M6b: `org.owners.add {address, member}` in `src/main/org/policy.ts:263-264`, its schema, name and route (`schema/org.ts:875`, `names/org.ts:44`, `routes.json:88`), its handler (`register.ts:203`), the fixtures' answers (`share-fixture.ts:73`, `page-fixture.ts:119`), the act's shape test (`policy.test.ts:135-140`) and the stand-in's `record.owners` branch (`policy.local.test.ts:209-210`). M5b changes none of these unless a test it adds shows a defect.

**Interfaces.** It consumes M6b's `record.owners` offer, record path and local door (§Q), `org.owners.add`, and the desk track's sminos executor for `record.owners` (sminos 1.38.0 or later). The executor adds the member to `owners`, appends the signed act verbatim to `ownersProof`, bumps `policyRev` and re-lists the session; a member who is already an owner changes nothing (`sminos_visibility.py`'s `add_owner`, pinned by `test_visibility.py`'s `test_record_owners_*`).

**Waits on.** Nothing now (met at the cut, 2026-11-09):
- The desk track's executor, behind sminos's `record` capability (M6b, *Offered only when sminos can*), ships in sminos 1.38.0.
- DL190 (b)'s fix is on master: the endpoint places a lane B record by the `opId` of its `ownersProof` entry that is the spawn's act (action `session.spawn`), not `ownersProof[0]`, which an owner add can occupy, and fails closed when one opId names two app sessions (`#bySpawn`, `src/endpoint/rl10/members.ts:338-347`).

**Proves.** Acceptance 5's add half.
- `AddOwnerSheet.test.tsx`: the members offered (the head's members who aren't owners), and the outcome shown.
- `policy.test.ts`: the act's shape, which is M6b's record target, never M5's old sample with `session` and no context. This test is already on master.
- `test/org/policy.local.test.ts` gains: A adds B as an owner of a lane A and a lane B session on a real endpoint, with a sminos stand-in that executes as the desk track's contract says (owners, `ownersProof`, `policyRev`, re-list), and the next listing names both. The lane B record carries its spawn act ahead of the owner act, so the re-list goes through DL190 (b)'s placement.
- Live, at M8's owner sitting (moved there from M6's staging run, which has passed; the architect, 2026-11-09): B's name appears on the owner's row. See M8, Concrete Steps.

### M6a — Reader state and drafts per member *(executable; re-planned 2026-11-06)*

**At its end.**
- Unread, last seen, pinned and drafts are kept per session and member in the spine's index (P5 Decision Log 36; O3's C5 and D1 hand the index change to O8).
- **The machine owner's state stays in the session row.** The session row's columns (`pinned`, `last_seen_*`, `unread`, and the `drafts` table) stay the state of the machine's owners. Local access (the app on its own Mac) and a remote member who is one of the machine's owners read and write them, so one person's devices share their reading.
- **Every other member's is kept apart.** A member who isn't an owner has their own rows, so nothing they read, pin or type changes what the owner sees, and the reverse.
- Remote members reach them over RL2. O7 left these reads to O8 M6 (`remote-unavailable.ts:39,56-57`):
  - `session.update`'s reader fields (`pinned`, `lastSeen`, `unread`), and `session.drafts.get` and `.set`, are offered;
  - `session.get` and `session.list` answer each member's reader fields.
- The renderer's in-run fallbacks for remote lane B marks and drafts (`lane-b/read-marks.ts`, `composer/editor/drafts.ts:76-95`) give way to the machine's answers.

**Touches.**
- `src/services/index/`:
  - `migrations.ts`, two `ADDED_TABLES` entries (not a migration: a newer `user_version` costs a downgraded build its whole index; M7b's ruling, 2026-11-06): `reader_state (app_session_id, member, pinned, last_seen_uuid, last_seen_at, unread, PRIMARY KEY (app_session_id, member))` and `member_drafts (app_session_id, member, doc, attachments, updated_at, PRIMARY KEY (app_session_id, member))`, both `ON DELETE CASCADE`;
  - `sessions.ts` and `drafts.ts`, the reader argument;
  - `register.ts`: `applyPatch` and the draft commands read `context.reader`;
  - their tests.
- `src/shared/spine/` or wherever the router's command context is typed: `context.reader: 'owner' | MemberId`, absent meaning `'owner'`.
- **`src/endpoint`** (desk-track reviewed):
  - offer rows for `session.reader.update` (revised 2026-11-07, in place of `session.update`; `title` and `archived` stay the owner's), `session.drafts.get` and `session.drafts.set`; *2026-11-13 (UTC):* Amended by the UX wave (U9; O-48, S-02; `docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md`), on the owner's words: the observation behind O-48 ("I cannot create a fork session from the remote machine …") and "Approve and start", 2026-11-12. From the UX wave (U9), behind `rl2.session-acts`: a fork in place (the machine's owners), archive, unarchive, rename, the owner's read of archived sessions, dismissing an attention item, taking back a waiting message and a pane's answer are offered. Launch, start, the setup of a new session, delete, take over and replays stay unoffered.
  - the dispatch sets `context.reader`: `'owner'` when the caller is one of the machine's owners (`machineOwners`), else the caller's member id;
  - `remote-unavailable.ts` drops the three rows;
  - tests.
- Renderer: `lane-b/read-marks.ts` and the draft interception fall back only while the machine's answer is refused (an older endpoint). Tests.

**Interfaces.** It produces §P. It consumes the spine's index (O3-D), the endpoint's dispatch of machine commands (O7), and `machineOwners` (`org-protocol`).

**Decisions.**
- **Reading.** A member's reader fields are their own row's, with no row reading `pinned: false`, `unread: false`, `lastSeen: null`. An `'owner'` reader reads the session row as today.
- **Unread.** When a new turn ends, the index sets `unread` on the session row and on every `reader_state` row of the session. A member's first sight of a session is not unread. Only `markSeen` clears a member's own.
- **Grades.** `session.update` (reader fields) is graded `list`, `session.drafts.get` and `.set` `converse`, and `title` and `archived` stay `manage`. A patch mixing reader fields with others is refused `malformed` remotely.
- **What a remote reader update answers.** Never the record: `applyPatch` returns the whole `SessionRecord` (`register.ts:38-46`), which holds checkout paths, settings and `launchedBy.action` (a spawn's signed act, its brief included; `src/services/sessions/spawn.ts:51-53,75`), and a `list` caller must not read those. A reader's update goes through a new machine command, `session.reader.update {appSessionId, patch: {pinned?, lastSeen?, unread?}}`, which answers `ReaderState {appSessionId, pinned, lastSeen, unread}` (a new schema beside `SessionRecordSchema`; `WIRE_MINOR` 31). The renderer's remote path applies that projection to the record it holds. `session.update` stays local, answers as today, and is refused with any reader in the context (revised 2026-11-07, Decision Log "M6a Task 1's fork"). *2026-11-13 (UTC):* Amended by the UX wave (U9; S-02): a reader's `session.update` whose patch is exactly `{archived: false}` is taken, at `manage`, and answered with the record as `session.get` answers that reader: `index.sessions.get(id, reader)`, the call `session.get` makes, and `session.get` is offered to another machine as a call (`src/endpoint/offers.ts`), so the answer is no wider than a read that reader may already make. `session.rename` under a reader answers its record the same way. Every other patch under a reader, `{archived: true}` included, is refused as before.
- **Co-owners share.** Two members who both own a machine share its owners' reading. The index can't tell which owner sits at a device, and the case is rare. It is written in the Surprises, not hidden. Rejected: keying the local app by its signed-in member, which strands the state of a profile that signs in later, or signs out.
- **No migration of data.** Existing rows stay the owners'. Rejected: copying them to the signed-in member, which needs an identity the daemon doesn't hold.
- The document channel's member attribution (O7's §T, `stream-document.ts`) is outside M6a. Drafts here are the composer's.

**Does not touch.** Visibility and shares (M6b). The engine host.

**Proves.** Acceptance 6's reader half.
- `migrations.test.ts`: the new entry, and every existing migration's case unchanged.
- `sessions.test.ts` and `drafts.test.ts`: per-member reads and writes; a new turn marks every reader unread; the owner's columns are untouched by a member's writes, and the reverse.
- `register.test.ts`: `context.reader` routes each command.
- `test/endpoint/` `reader-state.test.ts`: an owner's remote read hits the owner's columns; a non-owner's hits their own rows; `title` from a non-owner is refused; grades as above. A `list`-only caller's `session.update` answer holds the four `ReaderState` fields and nothing else: no `launchedBy`, no path, no settings.
- The renderer: a remote lane B session's unread and draft survive a relaunch (the fallback gone).
- Live, at the staging run (M6b): B pins, reads and types a draft in a session the owner shares with B, and the owner's sidebar, unread count and draft are unchanged.

### M6b — Visibility and shares *(executable; re-planned 2026-11-06; carries O18's M5)*

**At its end.**
- **The Share sheet** (Q4, as O18 amended it), from the session's header (the Toolbar's session actions, `Toolbar.tsx:218-239`) and from its row's menu, for a session you own:
  - **General access:** Private, Listed (the default), Org can view, Org can talk, each with one line on what it means.
  - **People:** each with Can message, View, Converse or Approve, and Add person.
  - **Help text:**
    - Can message: "Their agents can message this session. They can't read it."
    - Private: "Only its owners, and the people it's shared with, can see it or message its agent. Its agent can message only them too."
    - The foot: "What was already shared stays shared."

    Q4's old warning ("say messages stay org-readable") is gone (O18 M5).
  - **Save** asks Touch ID once for everything it changes.
- **A row's mark.** A row whose access isn't Listed, or that has shares, shows a small mark: a lock for Private, a people mark otherwise, with its access in the hover card. Your own sessions' marks come from `record.policy`. Another's private session that is shared with you shows the lock, read from its listing's `audience`.
- **Private sessions reach their people.** A private session's listing goes only over a channel (`endpoint.listings`), so the app now reads it from each link and merges it into M2's rows. A private session's owners and shares see it, and no one else does.
- **This Mac's own sessions too.** A local session's access and shares change through this Mac's own endpoint, over a local door, by the same act and rule.
- **Only once sminos can.** A machine whose sminos doesn't execute `record.*` (an older build) offers no Share: the sheet reads "<machine>'s sminos can't keep a session's reach yet".

**Touches.**
- **`src/endpoint`** (desk-track reviewed, its own commits):
  - `offers.ts`: `record.access {access}`, `record.shares {member, grade: 'list' | 'view' | 'converse' | 'approve' | null}` and `record.owners {add: true, member}` (M5b's), each `manage`-graded, executor `sminos`, with an `accepts` validator. Step-up is already required for every `record.*` (`step-up.ts:11-31`). Also `record.policy` (a call, `manage`) answering `{supported, policies: [{session, access, shares, policyRev}]}` for the sessions the caller owns on the machine, or the one named.
  - `targets.ts`: a `record` target rule taking a listing's session id for either lane: lane A's engine session id, or lane B's `appSessionId`, placed through `members.ts`'s join.
  - `rl10/link.ts`'s `draw`: the record path. A `record.*` act goes to sminos as an `rpc` for either lane, with `session` (the sminos member), `args`, and the signed action as `proof`, under the opId ledger as `sminos.*` rpcs go. Its outcome returns as theirs do.
  - The local door: `EndpointModule.local {act(action): Promise<Outcome>; call(name: 'record.policy', input): Promise<unknown>}`. The daemon serves it as two machine-socket commands, `endpoint.local.act` and `endpoint.local.call`.
    - `act` takes only the three `record.*` actions, and refuses anything else `not-offered`.
    - It verifies the action's step-up signature cryptographically, unconditionally, before anything else (`src/endpoint/step-up.ts`'s verifier, called whatever the grade). Channel authorization skips that check for an action whose grade doesn't need it (`authorize.ts:490-499`), and the door has no channel identity to stand in for it.
    - It derives the member and the class from the device's one entry in the held head (an `Action` names a device, not a member: `action.ts:30-47`). A device the head doesn't list, or lists twice, refuses `unknown-device`.
    - Only then does it run `authorize`, as a channel's act does.
    - `call` answers `record.policy` alone, as the machine owners' member (Decision Log 36's local reader).
  - `src/mawsd/endpoint-seam.ts` and the daemon's command registration;
  - tests.
- **Main:**
  - `src/main/org/policy.ts` (new): `org.policy.get {address}`, `org.policy.set {address, access?, shares?}`, and M5b's `org.owners.add`. Each builds the acts for the session's machine (`machines.remote(ref)`) or the local door, and signs them under one confirmation.
  - `src/main/machines/remote/acts.ts`: `actMany`, several step-up acts under one confirmation (the step-up sheet lists them all).
  - `src/main/device/step-up.ts`: `signActions`, one confirmation and several signatures.
  - `src/main/org/rows.ts`: channel listings (below).
  - `src/main/index.ts`: wiring.
  - Their tests.
- **Shared:** `org.ts` (`RemoteRow` gains `audience` and `policyRev`; `OrgPolicy`; `org.policy.*`; `org.policies.changed`), `routes.json`, `names/org.ts`.
- **Renderer:**
  - `sessions/share/ShareSheet.tsx` (new);
  - `sidebar/menus.tsx`: a listing-capable session menu, for `ListedRow`'s menu and for a record's row at a listed address;
  - `ListedRow.tsx` and `SessionRow.tsx`: the mark;
  - `HoverCard.tsx`;
  - `Toolbar.tsx`'s session actions;
  - `stores/policies.ts` (new);
  - `copy.ts`;
  - tests;
  - an e2e case seeding the sheet and marked rows, with screenshots (M4a's Task 8 pattern).

**Interfaces.** It produces §Q and O18's Interfaces §D. It consumes:
- O18's landed endpoint (the `list` grade, `audience`, `policyRev`);
- the desk track's sminos executors through `set_visibility` (O18 Interfaces §C), behind sminos's `record` capability;
- O7's acts and calls;
- M2's rows;
- M5's labels.

**Decisions.**

*The act and the frame* (agreed with the desk track, 2026-11-06; §Q holds both exactly).
- **The act.**
  - It carries no `session` and no `context`. A record act is launch-independent, and `isAction` refuses a `session` without a `context` (`action.ts:108-122`).
  - Its `args` name the target, exactly one of `{session: <lane A engine session id>}` or `{appSessionId: <lane B app session id>}` (the new `record` rule in `targets.ts`, taking either lane), plus the change.
  - `stepUp: 'required'`.
  - This replaces M5b's old sample (`session` without `context`, which `ActTable` refuses `malformed`).
  - The query executor is `sminos`, not the `engine-host` default (`acts.ts:40-52, 137`).
- **The frame.** RL10's existing `rpc`, with `rpc` keeping its `record.` prefix.
  - Its `args.session` is always the id that keys sminos's record (`session-records/<sid>.json`, the member frame's `session`):
    - lane A: the act's own `session`, a lane A member the members table holds;
    - lane B: the act's `appSessionId`, resolved through `members.ts`'s join to the member it places.
  - No member places it: the endpoint refuses `no-session` and sends nothing, never queued (DL190 (b) makes more of them place).
  - `proof` is the act verbatim, as signed.
  - No `context`, no `requestDigest`.
- **sminos's side** (the desk track's). Each executor calls `set_visibility(sid, access=… | share=…, operator=True)`: the verified step-up act is what admits a widening (O18 §C). `record.owners {add}` widens a private session's audience (owners ∪ shares), so it bumps `policyRev` and runs the same transition, a new snapshot with no `unlisted` notice.
- **The refusals the sheet shows:**
  - sminos's: `no-session` (no readable record), `unsupported` (an endpoint without the `access` capability takes only `listed`), `bad-shape`;
  - the endpoint's: `not-offered` and `no-session`;
  - sminos's `read-only`: the machine's sminos policy is read-only, and every `record.*` is refused, narrowing included;
  - the ledger's `stale`, `expired` and `tombstoned`;
  - step-up's `cancelled`.

  Each has its own line in `copy.ts`.
- **The outcome.** `done` carries `{changed, policyRev}`. The sheet confirms each line against the revision it caused, and the member frame follows as usual. `changed: false` (an owner who already was one, or a level already set) shows as a no-op, not an error, and bumps nothing.
- sminos binds each act's proof to the op's target and change. The act M6b signs names exactly the session and the change the offer carries: the `args` the device signs are the args the frame's change copies, with lane B's `appSessionId` as signed. On a lane B target sminos checks only that it is a non-empty string, since the endpoint's join placed it (the desk track, 2026-11-06; sminos 1.38.0, branch `o18-record-executors`).
- `record.owners` appends the act to `ownersProof` verbatim, and the ledger keeps the proof (`REMOTE_KEPT`). The RL10 adapter's context check exempts `record.*`, as it does `spawn`, since a record act doesn't depend on how the session was launched.

*One Touch ID per save.* A save is a list of acts:
- an access change;
- each share added, changed or removed;
- each in the canonical order the sheet showed.

`signActions` confirms once with every act's line, then signs each canonical copy. The acts are sent in order, and each outcome is shown on its line. A failure stops the rest and shows what went through.

*Offered only when sminos can.* sminos advertises `record` in its RL10 hello's `capabilities` once its three executors are in (the desk track, 2026-11-06). The endpoint offers `record.*` acts only while the machine's sminos advertises it. Without it, the act is refused `not-offered` before anything is sent, never a silent no-op, and `record.policy` answers `{supported: false}`.
- **Hub projects only.** sminos takes `{session: args.session}` as its target. It checks that the session is in a hub project of this machine, and that it joined that project from this machine. So the app offers Share only on a session whose project is on the hub (its `smnsId` is listed), and a session in a local-only project has no Share.
- **`record.policy` reads the member frame** (`access`, `shares`, `policyRev`, which an access-capable endpoint gets for every local session, O18 M3).
  - A session whose record sends no member frame (unreadable, O18 D10) answers `unavailable` for that session, never defaults (the desk track's point d).
  - The sheet then reads "Its reach can't be read right now" and offers nothing.

*Channel listings into the rows.*
- `rows.ts` calls `endpoint.listings` on each link at link up, at each `org.changed` head, after each policy act's outcome, and every 60 s while up.
- Each listing verifies as a hub one does, under the same marks.
- **Source-aware, by current membership.** Every key holds two independent memberships, whatever source first showed it: in the hub's current snapshot, and in its machine's last channel answer.
  - A hub snapshot's completion clears only the hub membership of the keys it lacked (`rows.ts:365-374` drops the key today). A channel answer clears only the channel membership of the keys it lacked.
  - A row is drawn while either holds, and only through the accepted revision ordering: a higher revision from either source replaces, an older one (a delayed hub `gone` included) is ignored, and a `gone` at a higher revision removes it from both.
  - So a session that goes private moves from the hub's snapshot to the channel's without its row blinking, and the endpoint's withdrawal of the public listing (`listings.ts:17-20, 181-207`) doesn't take the channel's listing with it.
- `RemoteRow` carries `audience` and `policyRev`.
- Rejected: a private listing published to the hub with an audience, which RL6 rules out.

*Policies* (`stores/policies.ts`).
- `org.policy.get` is called per machine (`record.policy` with no session) at link up and after each save, for your own sessions.
- The marks and the sheet read from it, and a session the call doesn't name has no mark.
- **The revision check is best effort.** The agreed act carries no expected revision, and `set_visibility` applies to the record as it stands under its lock (O18 §C), so the app can't make a save conditional.
  - The sheet opens on a fresh read, and reads `record.policy` again on Save, before Touch ID, and once more after Touch ID, before the first act is sent. A `policyRev` that moved at either point sends nothing and reads "Changed elsewhere: reload".
  - A change that lands between that last read and an act's execution is applied over it. Each act's outcome then carries the revision it caused, and the sheet reads the policy again after the save and shows the result as it stands, marking a line whose outcome's `policyRev` skips a revision as "also changed elsewhere".
  - Strict compare-and-set would need an expected revision in the frame, a contract change. It is not asked for: two owners editing one session's reach at once is rare, and the result is always shown.

*The local door.*
- Rejected: an RL2 link to this Mac's own endpoint. The direct listener binds only tailnet addresses (`direct-listener.ts:1-5`), and the roster excludes the local ref on purpose (`source.ts:47-56`).
- Rejected: calling sminos's CLI as the operator, which would give the app a second, unsigned way to widen and leave no proof for sminos's record.

The door adds no authority. An act through it is authenticated by its step-up signature alone, checked every time, and then authorized against the head as over a channel. It carries the three record acts and the one read, nothing else.

*The endpoint says `record` too.* The endpoint's RL10 welcome to sminos (its `capabilities`, `["access", "reach"]` today) gains `record` exactly when the build serves the three `record.*` offers, added in the same commit as them. It means "this machine's sessions can be widened from any member's MAWS through this endpoint", so a headless machine's endpoint advertises it too.
- sminos 1.39.0 keys its CLI cutover on it: it refuses widening at the terminal ("use MAWS") only where its endpoint said `record`. It keeps that word across the endpoint being away, and lifts it only at a later welcome without it (a MAWS rollback).
- The change moves the welcome's lines in `test/endpoint/rl10/conversation.json`, the blob the desk track's sminos conformance replay pins. Before M6b's PR, the new blob hash and the changed lines go to the desk track by `sminos say`, and the architect is told.
- `record-acts.test.ts` proves the welcome carries `record` when the offers are registered, and not in a build without them.
(Agreed by the architect and the desk track, 2026-11-06.)

*The CLI's widening.* Once these offers are on master, the desk track makes `sminos access` and `sminos share` refuse every widening with "use MAWS", and keep narrowing (the architect's brief, 2026-11-06). The cutover follows each machine's own endpoint's `record`, so it no longer waits on M6b's landing date.
- The exception, by the desk track's ruling: a machine enrolled at no hub keeps the terminal gate.
- That, and this milestone, are preconditions of a second member joining production.
- M6b's PR body says so, and the shared staging run checks it.

**Does not touch.** sminos (the desk track's). `apps/desk-hub/src/` (O18 M1 landed the hub's half). desk-web, whose DX6 client stays frozen (P5 Decision Log 227).

**Proves.** Acceptance 6, with O18's Interfaces §D.
- **`test/endpoint/` `record-acts.test.ts`:**
  - each offer's grade, validation and step-up;
  - a lane A and a lane B target placed;
  - the `rpc` carrying the proof;
  - `not-offered` without the capability;
  - `record.policy`'s answers;
  - the local door refusing an act with no step-up, an act with a present but invalid signature (on a `record.*` act and on a normally non-step-up command, which it refuses as not offered), any action outside `record.*`, and a device the head doesn't list; and authorizing a good act as a channel does.
- **`policy.test.ts`:** the acts' shapes; one confirmation per save; order and partial failure; a revision moved before Touch ID and one moved after it each send nothing; a change landing during the acts is shown as the policy then stands, with the skipped revision marked.
- **`step-up.test.ts`:** `signActions`, one confirmation, each signature verifying, and a cancel signing none.
- **`rows.test.ts`:**
  - a channel-only private listing survives a hub snapshot;
  - a session learned from the hub goes public → private, then a channel refresh, then a hub reconnect and snapshot: its row stays throughout, and a delayed older hub `gone` is ignored;
  - it leaves at the channel's omission (with no hub membership) or at a higher-revision `gone`;
  - marks hold across both sources.
- **The renderer:** the sheet's levels and help text, the people list, the save; the marks; menus on listed rows; unsupported reads.
- **`test/org/policy.local.test.ts`** (new; Miniflare hub, a real endpoint, and a sminos stand-in executing the contract):
  - A makes a session private;
  - B's app no longer has its row from the hub, and gains it from the channel once shared with B as Can message;
  - B's `converse` act is refused;
  - the local door changes a local session.
- **Live, the shared staging run** (Concrete Steps): O18's acceptance 1 to 8 and this milestone's, together.

### M7a — The project channel: the log reader, the Channel tab and people's words *(executable; re-planned 2026-11-06)*

**At its end.**
- **Where it opens.** An org project's row menu has **Channel** (Q5), shown when the project's `smnsId` is known (`orgIndex`). It opens one tab per project, titled "<project> · channel".
- **One stream for the project, across machines,** read from the hub's Project socket (`/api/projects/<smnsId>/socket`) and verified in main. Oldest is at the top and the composer at the bottom, as a group chat reads. It shows:
  - **People's words** (`human` events), by the member's name (M5's `memberName`) and their device's verification.
  - **Agent-to-agent traffic,** folded to one row per exchange: "3 messages between maws-45 and ci-opt", each name with its machine chip. The row opens the exchange's messages in place on a click.
  - **Questions and permission cards** that wait now, inline at the stream's foot under "Waiting on you". They are answerable there, the same cards attention shows, from every machine (O7 M6's feed). MAWS's own asks answer inline too, not through their sheet.
  - **History from before the cutover.** A DX1 event in a writer that a history attestation covers reads "attested at migration by `<machine>`" (O14's Interfaces §D). An uncovered one reads "unverified (from before the move)", faint.
  - **Earlier to-human entries** that are in the log (a pre-cutover machine's `message`, `question` and `answered`). New to-human entries are M7b's.
- **People's words, sent.** A composer at the foot sends the owner's words as a v2 `human` (P5 Decision Log 75 (7)).
  - The event is signed by this device's channel key, carries a nonce and no `mac`, and goes over the same socket.
  - A leading `@alias` addresses that session, and untagged words go to everyone.
  - A sent message shows "sending" until `human-ack`. A refusal shows under it ("not reachable" for a session hidden from you, P5 Decision Log 224).
  - B3 has moved the last machine (P5 Decision Log 154), so words no longer wait.
- **Offline.** With the hub unreachable or signed out, the tab draws the cached stream with "As of <time>", the time of its last `caught-up`, and the composer is withdrawn.
  - Amended 2026-11-13: UX wave U11 (S-09): the Channel's footer reads the channel's own reach first.
- **What it leaves out.** Withheld tombstones, `unlisted` notices and lifecycle events draw nothing. Lifecycle events give the stream its sessions' titles and machines. An event that doesn't verify draws nothing and is counted ("2 events didn't verify"), then tried again at the next head.

**Touches.**
- **Main, `src/main/org/channel/` (new):**
  - `project-socket.ts`: the socket client, `welcome`, `resume` from the cache's offset, `more`, `caught-up`, live `log`, `human`, `human-ack` and `refused`, and the 4403 close. Headers from `hub.headers()`; reconnect with M1's backoff.
  - `verify.ts`: each event, as below.
  - `cache.ts`: `<userData>/org/channel/<project>.json`, the newest 5,000 events or 8 MiB by offset, written through the commit queue, verified again at load.
  - `channel.ts`: one per open tab, released 30 s after its last tab closes.
  - `words.ts`: the signed human, its nonce, resend after a reconnect, the ack.
  - Their tests.
- `org-session.ts`: the commands and `close()`'s join. `src/main/index.ts`: wiring.
- **Shared:** `src/shared/ipc/schema/org.ts` (`ChannelEntry`, `org.channel.open`, `.close`, `.send`, `org.channel.changed`), `routes.json`, `names/org.ts`; `src/shared/ipc/schema/layout.ts` (`TabRefSchema` gains `channel {project}`, which needs no layout version, since unknown kinds are dropped).
- **Renderer:**
  - `channel/` (new): `ChannelView.tsx`, `project.ts` (the pure projection: entries, folding, labels), `Exchange.tsx`, `Composer.tsx` (reusing the composer's editor only if it fits; a plain textarea is acceptable), and the waiting cards' section;
  - `main/Pane.tsx` and `main/Tab.tsx` (the tab kind);
  - `stores/layout-model.ts`'s `openIn` (one tab per project);
  - `sidebar/menus.tsx`'s `ProjectItems` (Channel);
  - `request-card/`: an inline variant of the native ask (the Question sheet's body inline, submitting through `maws.ask.answer`);
  - `copy.ts`;
  - tests.
- **e2e:** a case seeding a channel through a harness-only fixture, as `page-fixture.ts` does for the Org page. The seed holds long names, a folded exchange of 40 messages, a refused word, a migrated entry, an offline "as of", and a waiting permission and question. The case photographs them under classic scrollbars and asserts no overflow, in `e2e:settings` (its hosted group, where the Org page's case runs).
- **Tests:** `test/org/channel.local.test.ts` (new, in `TIMING_NODE_TESTS`).

**Interfaces.** It produces §N. It consumes:
- the hub's Project socket and attestations route;
- `org-protocol`'s `verifyEvent`, `verifyAttestation`, `verifyHistoryAttestation` and `signEvent`;
- M1's session (its head, its certificates, the channel key, `hub`);
- the attention store (local, and O7 M6's remote);
- `RequestCard`;
- `orgIndex` and `MachineChip`.

**Decisions.**

*Verification* (`verify.ts`), per event:
- **A device's `human`** (writer `hub/<member>` or its audience stream `hub/<member>~<digest>`): `verifyEvent({org, project}, head.state, event, certificates, now)`. That covers the signature by one of the member's devices' channel keys, with the hub's `writer`, `seq` and `ts` outside what is signed (`events.ts:35-63`). The writer's member must equal the event's `member`, or the event fails. Its author is that member, named from the held head. It has no machine attestation, and `verifyAttestation` isn't run on it (it would answer `malformed`, `attest.ts:108-111`).
- **A machine's v2 event** (writer `<machine>/…`, with `sig`): `verifyEvent`, then `verifyAttestation` for its owners. Its owners' label reads as RL9 says, by the held head's emails, never an email the event carries.
- **A DX1 event** (it has `mac` and no `sig`): judged against the project's history attestations, read once per open from `GET /api/projects/<id>/attestations` and again when a writer's `upTo` is passed. It reads `migrated` when `verifyHistoryAttestation(record, events, head, certificates, {project, writer})` is `ok` for a record whose `upTo` covers its seq, and `legacy` otherwise. The app holds no org key, so it never verifies a `mac`.
- **A withheld tombstone** (`{writer, seq, withheld: true}`) is skipped.
- **A failed event** is kept in the cache, counted, and judged again at each adopted head.

*Folding* (`project.ts`).
- **An exchange** is a run of `say` events among the same two sessions (writer and recipients), each within 10 minutes of the last. A third session's say ends it.
- A broadcast (`to: '*'`) from one session folds with that session's broadcasts in the same window, as "N messages from maws-45 to everyone".
- An exchange of one message draws as the message itself.
- The fold is pure and its tests pin it.

*The waiting cards.* The project's sessions' items from `useAttention` (local and remote), filtered by `rowOfSession` and `rowOfListed` to this org project, drawn with `RequestCard` at placement `inline`. Answering goes through the controls already in place (lane A `sminos.answer` and `decide`, lane B `session.answer`), so a card answered in the channel is answered everywhere (owner, P5 Decision Log 11).

*The native ask inline.* `RequestCard` opens the Question sheet for a MAWS ask today (`RequestCard.tsx:9-10`). The channel draws the sheet's question body inline and submits through `maws.ask.answer`. The sheet stays where it is for the session pane.

*Words* (`words.ts`).
- The draft is `{kind: 'human', from: 'human', member, to, text, created, nonce}`, signed with `signEvent({org, project}, draft, channelKey)` (`project-socket.ts:19-22` is the reference).
- A word not acknowledged is resent with the same nonce after a reconnect, and the hub dedupes it.
- The draft lives in main's memory only. A word the channel dropped unsent (its last tab gone 30 s) reads "Not sent" at the tab's next open within the app's life. A relaunch drops it with nothing to show, since no copy of it is on disk (revised 2026-11-06, Task 2's Decision 2).
- The app sends nothing to a project that it can't read.

*The cache.* Per project, events by offset and their verdicts, re-verified at load. A project whose cache doesn't read is read from offset 0. "As of" is the last `caught-up`'s time.
- **Migrated history outlives the bound.** `verifyHistoryAttestation` needs every event of the writer from seq 1 to `upTo` (`history.ts:146-175`), which an evicted prefix no longer gives. So once a writer's prefix verifies in full, the cache keeps a checkpoint, separate from the bounded events and never evicted: `{writer, upTo, by, record, hashes: {<seq>: <hash of the exact canonical event that passed>}}`, one hash per position 1 to `upTo`.
- **At load,** the record's signature and binding are verified again (`verifyHistorySigner`). A cached event of that writer reads `migrated` only when its own canonical hash equals the checkpoint's hash at its seq, as M2's marks bind a record by its hash (`rows.ts:298-307`). Any other bytes at a covered position (a hub serving a different event at that writer and seq, at any offset) read as failed, and are never upgraded by the checkpoint. The verdict extends to no event by writer and seq alone.
- **A damaged cache** reads from offset 0, which recomputes every checkpoint from the full prefix.

*Hub access.* The socket opens only while `current()` has `hub`. An expired Access token shows "Sign in to the hub again" in the tab, the Org page's own action (Q7).

**Does not touch.** To-human entries written after the cutover (M7b). Any endpoint or service. The hub. desk-web.

**Proves.** Acceptance 7a.
- `verify.test.ts`: a device's `human` verifies with its member as author, and fails when its writer's member and `member` differ; a v2 say verifies with its owners; a forged one fails and is retried at the next head; a DX1 event under an attestation reads `migrated` with the machine's name; one past `upTo`, or under no attestation, reads `legacy`; a tombstone is skipped.
- `project.test.ts` (renderer): exchanges and broadcasts fold; a third party ends an exchange; one message unfolded; titles and machines from lifecycle events; the waiting section filtered to the project.
- `project-socket.test.ts`: resume from the cached offset; `more` followed; live after `caught-up`; 4403 ends it with "removed".
- `words.test.ts`: the signature verifies under the device's channel key; a reconnect resends with the nonce; a refusal shows; signed out, nothing sends.
- `cache.test.ts`: the bound; a damaged file reads from 0; "as of"; a DX1 writer larger than both bounds verifies once, is evicted in part, and still reads `migrated` across a restart from its checkpoint, re-checked by `verifyHistorySigner`; a forged event at a covered writer and seq, served at a new offset, then evicted and reloaded, never reads `migrated`.
- **`test/org/channel.local.test.ts`** (Miniflare hub through `local-org.ts`):
  1. A machine's listed key signs v2 `say` events into the project log, plus a DX1 writer with a history attestation from a listed machine, as `apps/desk-hub/test/app-connection.test.ts` and the O14 suites seed them.
  2. The app's channel shows the exchange folded, the DX1 events "attested at migration by <name>", and a forged event uncounted in the stream.
  3. The app sends words. A second socket (`ProjectSocket`) receives them with `sig` and no `mac`, and the app's own channel draws them back from the log as verified words by A, as it draws a `human` another member's device sent through `deviceHuman`.
  4. The hub stops, and the tab shows the cache "as of".
- **The renderer:** the tab opens once per project; Channel shows only with a `smnsId`; the composer is withdrawn offline; the inline native ask answers.
- **The e2e case's screenshots,** read by the architect, as M4a's were.

### M7b — The project channel: to-human messages across machines *(executable; re-planned 2026-11-06)*

**At its end.**
- **Every session's to-human entries are in its project's channel,** from every machine, with the session's title and machine chip (Q5):
  - messages, from lane A's to-human tool, and lane B's message tool and `<message>` spans;
  - questions, as they were asked;
  - answers, as they were given.

  They sit by time among M7a's entries. A question still waiting is a card in "Waiting on you" (M7a); here it is its history.
- **Offline machines.** An offline machine's entries come from the app's cache with "as of <time>", the last time its feed was live (Q5).
- **Each machine keeps its own entries.** Each machine keeps its sessions' to-human entries per project in its spine, bounded: the newest 2,000 per project and 30 days.
- **Who reads them.** Over RL2, a member reads them only for sessions they may `view` (to-human text is the session's content).
- **The owner's week** (P5 acceptance 16) starts when M7b lands (the architect, 2026-11-06).

**Touches.**
- **`src/services/channel/` (new, the spine):**
  - `journal.ts`: an index table `channel_entries (id, project, app_session_id, engine_session_id, lane, kind, text, choices, at, src, UNIQUE(src))`, an `ADDED_TABLES` entry in `src/services/index/migrations.ts` (created `IF NOT EXISTS` after the migrations at any version, never dropped or renamed, so a downgraded build keeps its index; revised 2026-11-06), pruned at the bounds above;
  - `register.ts`: `channel.history {project, before?, limit ≤ 200}` (newest first, paged) and the event `channel.changed {project, entry}`;
  - **lane B's source:** the owner channel's event batches (`src/services/owner/register.ts`'s `onEvent`), taking each accepted message-tool call as a `message` (`src/shared/owner/message-call.ts`'s `isMessageTool`, both `mcp__to-human__message` and a recorded session's `mcp__maws__message`, counted once `messageCallState` reads `sent`), each `<message>` span (the parser's `to-human` kind) as one `message`, and each answered ask with its question and answer as `question` and `answered`;
  - **lane A's source:** the endpoint's sub-less RL10 `host` messages (`rl10/link.ts:616`'s dispatch to `#host` at :632), handed in through a new `EndpointServices.channel.record(entry)` seam, beside `notifier.hostMessage` and not behind the `hosts.json` mark, which moves only once a `wrote` reaches the hub. `src` is `<project>/<writer>/<seq>` of the host event. Each message carries its project and its `src`, and `UNIQUE(src)` dedupes sminos's resend of the last 50;
  - the project id is sminos's project id (`smnsId`), lane B's through `src/services/index/org-project.ts`'s join;
  - tests.
- **`src/endpoint`** (desk-track reviewed): `offers.ts` rows for `channel.history`, and the feed `channel` beside `attention`. The feed's frames: `snapshot` (the newest page) and `changed`. Also the `#host` hand-off and its test.
  - **Filtering is lane-aware.** `attention.list`'s `eachSession` path places every id as a lane B `appSessionId` through the spine (`calls.ts:283`'s dispatch to `#eachSession` at :419; `targets.ts:269-278`'s `recordedPlacement` and `placeRecorded`), which a lane A entry doesn't have. So a new filter ranks each entry at `view`:
    - a lane A entry by its `engineSessionId` through the RL10 member record (the `session` rule's target);
    - a lane B entry by its `appSessionId` placement.
  - The rank is re-checked at each feed frame before it is sent, so a session that becomes private, or a share removed, stops its entries at once.
- `src/mawsd/endpoint-seam.ts`: the seam's `channel`.
- **Main:** `src/main/org/channel/machines.ts` (new). It reads `channel.history` from this Mac's spine (a local command) and from each roster machine over its link, with the `channel` feed live. It keeps a per-machine cache, `<userData>/org/channel/<project>.machines.json` (the newest 500 entries per machine, `asOf`), and merges into M7a's `org.channel.changed`.
- **Renderer:** `channel/project.ts` places to-human entries; `ToHumanEntry.tsx` (new) shows a message, a question with its choices and answer, the title and the machine chip, and "as of" on an offline machine's entries. Tests.
- **Tests:** `test/org/channel.local.test.ts` gains the to-human cases.

**Interfaces.** It produces §O. It consumes:
- M7a;
- the owner service's event batches (O3-D);
- RL10's host messages (O12 item 6);
- O7's feeds and calls;
- the spine's `org-project` join.

**Decisions.**
- **Where the journal lives.** In the spine, beside the index that already holds the owner channel's marks. The endpoint only hands lane A's entries in. Rejected:
  - asking sminos to page its host store over RL10 (a desk-track protocol change, for history the spine can keep as it arrives);
  - the endpoint's own file, which would put a second store under `mawsd/endpoint/`.
- **What counts as an entry.** For lane B, each to-human message as the report view reads it: a sent message-tool call (P4-R7) and each `<message>` span (the contract's other form, one message per span), plus need-input questions and their answers. `essential` and `insight` marks are not messages, by Q5's "each to-human message" (revised 2026-11-06 at M7b's cut). For lane A, sminos's host kinds as they arrive (`message`, `question`, `answered`).
- **Back-fill.** None. A machine's journal starts empty at the build that brings it, and earlier entries stay where they were: pre-cutover ones in the log (M7a), others only in their transcripts. The Surprises say so, and the owner's week starts after it.
- **Grades.** `view` per session, filtered as `attention.list` is, so a member sees the to-human entries of exactly the sessions whose transcript they may read.

**Does not touch.** sminos. The hub. The owner channel's marks and answers (O3-D's).

**Proves.** Acceptance 7b.
- `journal.test.ts`: lane B's message and answered ask recorded once; lane A's host message recorded, and sminos's resend deduped; the bounds; the project's join.
- `test/endpoint/` `channel-feed.test.ts`: `view` filtering for both lanes, a lane A entry allowed and one refused, in history and in changes; a share removed mid-feed stopping the next frame; the snapshot, changes, and an older device without the feed.
- `machines.test.ts`: the merge by time; offline "as of"; a machine leaving the roster drops its entries.
- **`test/org/channel.local.test.ts`:**
  5. A real endpoint, fed a sub-less host message by an RL10 stand-in, and the local spine with a lane B message both appear in the project's channel with their titles and machines.
  6. The endpoint's link drops, and its entries stay "as of".
- **Live:** the owner's MacBook shows a mini session's to-human message and a devcloud VM session's question in one project's channel. Recorded in Outcomes with a screenshot, as the owner's week starts.

### M8 — The deployment admin's end, and acceptance *(executable; re-planned 2026-11-06: owner steps and evidence, no code)*

**At its end.**
- The owner's MAWS device is a root of production, and has signed at least once.
- O14's B4 has run its steps 4 to 8.
- The app has signed the successor that removes the deployment admin device: both its keys go to `revoked`, and its step-up kid leaves `root.keys`. Every machine has acknowledged it (M3's deliveries).
- The owner has deleted its key file and anchor.
- `admin show`, run once more by the owner before the deletion, and the Org page both name the app's device as the only root.
- Acceptance items 1 to 7 are recorded in Outcomes with their evidence.
- M5b's live proof (acceptance 5's add half) is recorded in Outcomes: a second member's name on a row the owner co-owns, after "Add owner…" (moved here from M6's staging run; the architect, 2026-11-09).

**Touches.** O8's document (Outcomes, Progress) and the report. No code: M4a's `device.remove` already composes the revocation for any device but this profile's own (`edits.ts:232-246`), and M3 delivers it. A defect found on the way gets its own PR.

**Decisions.**
- **The root-add sitting is M8's first owner step.** The records show none (O8's Outcomes; P5 Decision Log 155). It is skipped when `production-run.sh admin show` already lists two root lines, one of them the app's device.
- **The order** (revised 2026-11-09: step 7, on staging, comes first, by the architect's ruling).
  0. Step 7, Add owner on staging, and its teardown.
  1. The root add.
  2. B4's steps 4 to 8 (O14:277-282), now a check only: they ran on 2026-11-07.
  3. The revocation.
  4. The deletion.
  5. O15's check.

  No admin verb signs after step 3. One read-only `admin show` checks the result, and moves the anchor to the revoking head, which is harmless once the files are deleted next.
- **Removing a root.** The revocation is `device.remove {member: <the admin device's member>, device: <its id>}` from the People group. The member is the owner's own, since genesis lists `/api/me`'s member with the admin device (`admin.ts:604-617`).
  - The sheet's lines name it as the deployment admin's device, by its id (`deployment-admin-<12 hex>`, or `a1` for an old file; `admin-device.ts:15-19`).
  - The checks refuse it unless the app's device is a root (`empty-roots`).
  - Removing it from the app is the intended path, since admin's own `remove-device` refuses its own device (`admin.ts:676-693`).
- **Copy.** The Org group's root lines name the deployment admin device as such until it is gone (Q6's "ending the deployment admin" as a guided step): "Deployment admin (the CLI's software root): remove it once O14's last step has run". The row offers its removal only while this Mac is a root.
- **M5b's live proof runs on staging, not production** (added 2026-11-09 at M5b's cut). The architect moved it to this sitting so the owner sits once. Production has no second member, and none joins during P5: a second member is deferred, behind Decision Log 235's precondition (P5 §"Deferred"; P5 Decision Logs 235 and 248). So the step runs on the staging org, with the owner's second staging identity as M6b's layer 2 used it. It runs inside this sitting, as its first part, on staging, before the production steps, with the adder a MAWS profile the owner drives (the architect, 2026-11-09). The desk track sets its scene. It is step 7 below.

**The owner's steps.** These are in Concrete Steps, M8, each with its check, and go to the architect for a sitting.

**Proves.** Acceptance 8, and the acceptance run of items 1 to 7 in Outcomes.

### Concrete Steps

Run all steps from the milestone's worktree `W`, after `pnpm install --frozen-lockfile`.

**M1.**

    # iterate, one focused file at a time (this MacBook)
    npx vitest run --project node src/main/org/access-login.test.ts
    npx vitest run --project node src/main/org/held.test.ts
    npx vitest run --project node src/main/org/org-session.test.ts
    npx vitest run --project node src/main/org/registry-feed.test.ts
    npx vitest run --project node-timing test/org/sign-in.local.test.ts    # Miniflare; about a minute
    npx vitest run --project renderer src/renderer/src/settings-tab/OrgSection.test.tsx

    # lint the touched files, then the gates (never run the gates' commands locally)
    npx eslint src/main/org src/main/index.ts src/shared/ipc/schema/org.ts src/shared/ipc/grades/org.ts src/renderer/src/settings-tab test/org
    cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:machines,e2e:settings --runner macos --lane hosted    # main's composition under O6's scene; the Settings order

Expected: each vitest file ends `Test Files  1 passed`; `ci-gate` prints `GREEN <run-url>`; `e2e:machines` passes unchanged (its two liveness bounds have flaked on a 3-core hosted Mac, P5 Decision Log 88, so a red there is rerun once before it is read as a regression).

The live staging check, at the owner's hand, after the PR's gates and before it goes to the architect:

    # the owner's terminal, from W
    W/apps/desk-hub/deploy/staging-run.sh admin pair --class native-mac    # prints the code; waits for the app's entry

    # a dev run of W on a scratch profile (never the owner's MAWS)
    MAWS_USER_DATA=$(mktemp -d ~/.local/share/o8-staging.XXXX) npx electron-vite dev

In the app, Settings › Org: paste the code, Sign in, finish in the browser, compare the fingerprint with the terminal's, approve there. Expect "Signed in to staging-ssfskim as `<email>`". Quit and relaunch the same scratch profile: signed in again with no browser. Record in Outcomes the fingerprint match, `GET /api/me` answering through `cf-access-token` (U9's spike never captured it), and the head's version.

The production rollout, the owner's alone once M1 is on master, when production is rooted (O13's rollout brief, step 2): `production-run.sh admin pair --class native-mac` and the same sign-in in the owner's own MAWS.

**M2.**

    npx vitest run --project node src/main/org/rows.test.ts
    npx vitest run --project node-timing test/org/rows.local.test.ts
    npx vitest run --project renderer src/renderer/src/sidebar/derive.test.ts
    npx vitest run --project renderer src/renderer/src/sidebar/Sidebar.test.tsx
    npx vitest run --project renderer src/renderer/src/ipc/events.test.ts
    npx eslint src/main/org src/main/index.ts src/shared/ipc/schema/org.ts src/renderer/src/stores src/renderer/src/sidebar src/renderer/src/sessions src/renderer/src/ipc test/org
    cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:machines --runner macos --lane hosted
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:default --runner macos    # the bare set holds the sidebar's specs; not hosted-eligible

Expected as for M1. The OX7 bench is not required for either milestone: neither changes the local link's path, the router's local branch or the delta path.

The live check runs at the first cut-over machine (O14's B1 VM), in the owner's signed-in MAWS: that machine's sessions appear under their org projects with `@<name>`, their states follow `sminos list --org` within 2 s (P5 acceptance 3), and a session ended there leaves the sidebar. Recorded in Outcomes with a screenshot.

**M3.**

    npx vitest run --project node src/main/org/checks.test.ts
    npx vitest run --project node src/main/org/signer.test.ts
    npx vitest run --project node src/main/org/weekly.test.ts
    npx vitest run --project node src/main/org/deliveries.test.ts
    npx vitest run --project node src/main/org/org-session.test.ts
    npx vitest run --project node src/main/device/keys.test.ts
    npx vitest run --project node src/main/device/step-up.test.ts
    npx vitest run --project desk-hub apps/desk-hub/test/deploy/admin.test.ts
    npx vitest run --project node-timing test/org/signer.local.test.ts
    npx vitest run --project renderer src/renderer/src/settings-tab/OrgSection.test.tsx
    npx eslint src/main/org src/main/device src/main/index.ts src/shared/ipc/schema/org.ts src/renderer/src/settings-tab apps/desk-hub/deploy/admin.ts test/org
    W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool --peer none
    W/scripts/ci-gate.sh W --gates e2e:settings,e2e:machines,<the groups ci-gate's coverage note names> --runner macos --lane hosted --peer none

Expected as for M1. The owner's sitting, after the PR's gates and M1's staging sitting (the app registered on staging):

    # the owner's terminal, from W
    W/apps/desk-hub/deploy/staging-run.sh admin root add <the device id the Org section shows>    # compare the fingerprint with the Org section's; confirm

In the app's scratch profile, Settings › Org reads "This Mac signs the org state". "Re-sign now" asks Touch ID and the head's version goes up by one; `staging-run.sh admin show` reads the new version. Recorded in Outcomes: the version, the fingerprint match, and the admin's `show` naming two roots. The production rollout is the owner's alone once M3 is on master: `production-run.sh admin root add <id>` from the owner's own MAWS's Org section, then the owner stops running `refresh`.

**M4a.**

The move commit is the branch's first. Run its checks before any other M4a work:

    # the moved judges: admin's suites and org-protocol's, unchanged in outcome
    pnpm --filter desk-hub exec vitest run test/deploy/admin.test.ts test/deploy/admin-verbs.test.ts
    pnpm --filter desk-hub exec vitest run test/deploy/production-scripts.test.ts
    pnpm --filter org-protocol exec vitest run test/pairing.test.ts
    # the package boundary on its own: the judges imported straight from org-protocol under Node's type stripping
    node --experimental-strip-types --input-type=module -e "const m = await import('./apps/org-protocol/src/index.ts'); console.log(['judgeEntry','entryDevice','isPairedDeviceId','isRpId'].map((n) => typeof m[n]).join(' '))"
    # admin as the deploy checkout runs it (bin.ts bundles it): read-only verbs against the local hub, in a scratch org
    # (the deploy README's local recipe)
    pnpm --filter desk-hub local --state ~/.local/share/o8-m4a-move/hub          # a second terminal; Ctrl-C at the end
    mkdir -p ~/.local/share/o8-m4a-move/recovery
    pnpm --filter desk-hub deployment admin init --keys ~/.local/share/o8-m4a-move/admin/keys.json --hub http://127.0.0.1:8747 --user owner@example.com
    pnpm --filter desk-hub deployment admin genesis --keys ~/.local/share/o8-m4a-move/admin/keys.json --hub http://127.0.0.1:8747 --user owner@example.com --recovery ~/.local/share/o8-m4a-move/recovery/recovery.json --yes
    pnpm --filter desk-hub deployment admin show --keys ~/.local/share/o8-m4a-move/admin/keys.json --hub http://127.0.0.1:8747 --user owner@example.com
    pnpm --filter desk-hub deployment admin devices --keys ~/.local/share/o8-m4a-move/admin/keys.json --hub http://127.0.0.1:8747 --user owner@example.com
    rm -r ~/.local/share/o8-m4a-move

Expected: the import line prints `function function function function`; the suites pass; `show` and `devices` print as they did before the move.

The same checks follow the pre-sign commit. That commit also runs `org-protocol`'s whole suite once, through the gate, not locally.

#261 (O14's m5b, held to B4 step 3) also touches `apps/desk-hub/deploy/`. Whichever of #261 and M4a lands second merges the other in, with no rebase.

When M4b moves `encodeEnrollmentCodeV2`, `pnpm --filter desk-hub build` (a `wrangler deploy --dry-run`) must stay clean. That is the desk track's condition, and it goes into M4b's steps.

Then the milestone:

    pnpm --filter org-protocol exec vitest run test/successor-problems.test.ts
    npx vitest run --project node src/main/org/edits.test.ts
    npx vitest run --project node src/main/org/pairing.test.ts
    npx vitest run --project node src/main/org/checks.test.ts
    npx vitest run --project node src/main/org/signer.test.ts
    npx vitest run --project node src/main/org/org-session.test.ts
    npx vitest run --project node src/main/device/step-up.test.ts
    npx vitest run --project node-timing test/org/org-page.local.test.ts    # registered in TIMING_NODE_TESTS first
    npx vitest run --project renderer src/renderer/src/settings-tab/org/<each group's test file>
    npx eslint src/main/org src/main/device src/main/index.ts src/shared/ipc/schema/org.ts src/renderer/src/settings-tab apps/org-protocol/src apps/desk-hub/deploy/admin.ts test/org
    W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool --peer none
    W/scripts/ci-gate.sh W --gates all --lane hosted --class1a pool --peer none        # class 1a, every hosted Electron group, e2e:default, unit:darwin
    W/scripts/ci-gate.sh W --gates packaged --peer none                                  # `all` skips packaged

Expected as for M1. The app packages (`apps/org-protocol`, `apps/desk-hub`) run their own vitest configs through `pnpm --filter`, one file at a time as here.

**M5.**

    npx vitest run --project node src/main/org/rows.test.ts
    npx vitest run --project node src/shared/org/member-name.test.ts
    npx vitest run --project renderer src/renderer/src/sidebar/owners.test.ts
    npx vitest run --project renderer src/renderer/src/sidebar/derive.test.ts
    npx vitest run --project renderer src/renderer/src/sidebar/Sidebar.test.tsx
    npx eslint src/main/org src/shared src/renderer/src/stores src/renderer/src/sidebar
    W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool --peer none
    W/scripts/ci-gate.sh W --gates e2e:default,<the groups ci-gate's coverage note names> --runner macos --lane hosted --peer none    # e2e:default holds the sidebar's specs and runs on the mini

The live check joins M2's at the first cut-over machine once a second member exists (M6's staging member): a session the second member owns reads its owner's name under People and counts in "+N others" while off.

**The rest (M7a to M8), on this MacBook.** One focused vitest file at a time; no local typecheck, no eslint over more than one file, no multi-file vitest, no local Electron e2e. Every gate runs from the milestone's worktree `W`:

    # after each product commit
    W/scripts/ci-gate.sh W --gates static --runner macos --label <milestone>-static
    # a milestone's gates (main or renderer changes): the whole set; a diff under src/endpoint adds e2e:desk-web, which `all` holds
    W/scripts/ci-gate.sh W --gates all --runner macos --label <milestone>
    W/scripts/ci-gate.sh W --gates packaged --runner macos --label <milestone>-packaged     # `all` skips packaged
    # while `ssh mini 'cat .local/state/ci-hold'` shows a hold, add --lane hosted

Never name a `MEASURED_E2E` group (`.github/workflows/gate.yml`). Keep any measured run out of 2026-11-08 23:25Z to 2026-11-09 01:05Z. A flaky pass in a spec the milestone reaches counts as red until the code explains it.

**M7a.**

    npx vitest run --project node src/main/org/channel/verify.test.ts
    npx vitest run --project node src/main/org/channel/project-socket.test.ts
    npx vitest run --project node src/main/org/channel/words.test.ts
    npx vitest run --project node src/main/org/channel/cache.test.ts
    npx vitest run --project node-timing test/org/channel.local.test.ts        # registered in TIMING_NODE_TESTS first
    npx vitest run --project renderer src/renderer/src/channel/project.test.ts
    npx vitest run --project renderer src/renderer/src/channel/ChannelView.test.tsx

Then the gates above, with `--evidence` on the `all` call so the channel case's screenshots upload, for the architect to read.

**M7b.**

    npx vitest run --project node src/services/channel/journal.test.ts
    npx vitest run --project node test/endpoint/channel-feed.test.ts
    npx vitest run --project node src/main/org/channel/machines.test.ts
    npx vitest run --project node-timing test/org/channel.local.test.ts

The live check is the owner's, in their own MAWS once a build carrying M7b is on the MacBook and the mini (the owner's swap): a mini session's to-human message and a devcloud VM session's question in one project's channel.

**M6a.**

    npx vitest run --project node src/services/index/migrations.test.ts
    npx vitest run --project node src/services/index/sessions.test.ts
    npx vitest run --project node src/services/index/drafts.test.ts
    npx vitest run --project node src/services/index/register.test.ts
    npx vitest run --project node test/endpoint/reader-state.test.ts

**M6b.**

    npx vitest run --project node test/endpoint/record-acts.test.ts
    npx vitest run --project node src/main/org/policy.test.ts
    npx vitest run --project node src/main/device/step-up.test.ts
    npx vitest run --project node src/main/org/rows.test.ts
    npx vitest run --project node-timing test/org/policy.local.test.ts
    npx vitest run --project renderer src/renderer/src/sessions/share/ShareSheet.test.tsx

**The shared staging run** (M6b with O18 M6). The architect schedules it with the owner and the desk track: from 2026-11-07, never 06:45 to 07:00Z (the mini), never in a cua_repl hold. It has two layers. Layer 1 needs no one but the desk track. Layer 2 is one sitting with the owner. (Decision Log, "M6b Task 4, the local suite and the harness".)

**Layer 1: the harness member** (the desk track, no owner step). Member B is the run's own harness member (`addRunMember`) with its b1 device, on a fresh VM at the slot, without the MAWS project:

    zsh apps/desk-hub/deploy/staging-run.sh deploy                                       # O18 M1's hub, if staging lacks it
    zsh apps/desk-hub/deploy/staging-run.sh reach-vm setup --vm <vm> --sminos a3d4a8f8   # sminos 1.40.3; refused below 9a694999 (1.40.1)
    zsh apps/desk-hub/deploy/staging-run.sh reach --vm <vm> --direct-url ws://<the VM's tailnet address>
    zsh apps/desk-hub/deploy/staging-run.sh reach-vm teardown --vm <vm>

The scenes' MAWS is the branch at or after M6b. Their endpoints say `record`, so every widening goes through A's record acts. The run prints a PASS/FAIL line for each of O18's items 1 to 8 and for O8's three:
- `m6b-cutover`: the terminal's widening, of the access and of a share, is refused "use MAWS", with no confirmation asked and `record.policy` unmoved; its narrowing runs;
- `m6b-visibility`: b1 lists S by its access alone, each level set by A's act. At `listed`, `converse` and `approve` are refused `grade`;
- `m6b-reader`: B pins, reads and drafts a lane B session A shares at Converse, and A's reading and draft read back unchanged.

Item 4 is O8's "Can message: B's agents message, B can't read". Undo is the run's own (its LEFT and KEPT lines).

These are the live run's checks, none of them verified before it:
- lane B inside the reach scenes;
- record acts over the relays;
- layer 2's pairing through real Access with a second identity;
- the profile daemon's teardown.

**Layer 2: the real-member sitting** (the owner with the desk track, one scene). B is a real person, the owner's second email, signed in from a second scratch MAWS profile on the owner's Mac.

1. **The email file.** The owner sends the second email to the desk track directly, never into a repo or a PR. The desk track writes it to a 0600 file outside any checkout, for example `~/.local/share/o8-sitting/second-email`. The records say "the owner's second email".
2. **B joins the org.** The desk track runs `zsh apps/desk-hub/deploy/staging-run.sh real-member add --email-file <that file>`, then `staging-run.sh access-sync`. Access now admits B.
3. **B pairs.**
   - The owner launches the scratch profile and opens the logout URL.
   - The desk track runs `zsh apps/desk-hub/deploy/staging-run.sh real-member pair --email-file <that file> --code-file <a new path outside any checkout>`. It writes the code there (0600) and waits up to 30 minutes.
   - To stop a `pair` early, the desk track signals its node process or its process group, never the wrapper alone. zsh's TERM trap ends the wrapper, not node, and node would keep polling until `--wait` runs out, and could still list a device (desk 643; residue m6b-r3).
   - The owner copies the code without displaying it, with `pbcopy < <that path>` in a Terminal or iTerm window. They paste it into the profile's Settings › Org › Pairing code row, press Sign in, and finish in the browser as the second email.
   - The step lists the device as B's first device, unendorsed: an admin can't endorse another member's device (P5 Decision Log 34). It prints the device's fingerprint, which the profile shows too.
4. **The run.** O8's items, with B the real member on the second profile:
   - the owner makes a session private, shares it Can message, then View;
   - B's rows and agents follow;
   - B's `converse` is refused;
   - B pins, reads and types a draft, and the owner's sidebar and draft are unchanged;
   - `sminos share … view` at the owner's terminal says "use MAWS".

**The pitfall.**
- The profile's sign-in opens the default browser at the staging hub's `/cdn-cgi/access/cli` (`access-login.ts:194`). If that browser holds the owner's staging Access session, or a stored Google session of the owner's, Access completes the sign-in as the owner; on 2026-11-08 the Google session did. So just before B's sign-in, the owner clears that browser's site data for the staging hub's domain and for the team's Access domain, then signs in with the one-time PIN and B's email.
- Never open Access's logout URL for this. It revokes every Access session of that identity, cloudflared's CLI token included: on 2026-11-08 it ended the pair and the harness's admin calls until the owner ran `cloudflared access login` again, in a private window as themselves (Outcomes, M6b).
- While that browser is signed in as B, nobody runs `cloudflared access login` for staging, or the CLI token would name B.
- The sitting checks the pass-through by reading the member email the profile shows before its pairing completes. If it shows the owner's email, stop. `pair` reads only B's pending entries (`?member=`), so an entry posted as the owner is never listed for B.

**Teardown.**
1. The desk track runs `zsh apps/desk-hub/deploy/staging-run.sh real-member remove --email-file <that file>`, which removes B and revokes the device's keys, then `staging-run.sh access-sync`.
2. The owner quits the scratch app. The profile's mawsd outlives the app and has no stop verb, so the desk track names its pids with `pgrep -fl maws-m6b-second-member`, ends each with `kill -TERM <pid>`. A private daemon carries `--dir <its dir>` in its argv (`daemon.ts:286`), so the name matches it. After TERM, the desk track checks that no process of the profile's session is left and that its lock files are gone, rather than trusting the name match alone. Then it runs `rm -rf ~/.local/share/maws-m6b-second-member`. The device keys are software keys in the profile's `device/keys.json`, so the directory takes them with it.
3. The email file is deleted.
4. The owner signs back into staging Access as themselves the next time a browser needs it.
5. The VM goes with `reach-vm teardown`.
6. The architect removes the sitting's worktree, `/Users/new/.local/share/maws-worktrees/m6b-sitting`.

**The owner's steps** (the architect hands these over):
1. Send the second email to the desk track directly.
2. At the sitting, launch the scratch profile. It launches from a prepared worktree at or after M6b's head, which the architect prepares before the sitting at `/Users/new/.local/share/maws-worktrees/m6b-sitting`, with `pnpm install --frozen-lockfile` already run there:

       cd /Users/new/.local/share/maws-worktrees/m6b-sitting && mkdir -p -m 700 "$HOME/.local/share/maws-m6b-second-member" && MAWS_USER_DATA="$HOME/.local/share/maws-m6b-second-member" npx electron-vite dev

   (Earlier drafts launched from the `p5-o8-m6b` worktree, on the plan of a sitting before the landing.) A dialog from macOS on that first launch, such as "accept incoming network connections" for Electron, is the owner's to answer. Deny is safe, since the profile connects outward to the hub, and no agent clicks through it.
3. Open `https://desk-hub-staging.opencognita-platform.workers.dev/cdn-cgi/access/logout` in the default browser.
4. Copy the pairing code without displaying it: in a Terminal or iTerm window, run `pbcopy < <the path the desk track names>`. Paste it into the profile's Settings › Org › Pairing code row and press Sign in. Sign in with the second email and the code from its inbox. Before pairing completes, check that the member email the profile shows is the second email.
5. Don't run `cloudflared access login` for staging until you're signed back in as yourself.
6. Only if the sitting falls after about 11-25: before step 3, run `cloudflared access login https://desk-hub-staging.opencognita-platform.workers.dev` once.

Recorded in both documents' Outcomes: each item, with a transcript line, a screenshot or a file listing.

**M4b.** The move commit first, with M4a's move checks. Then:

    pnpm --filter org-protocol exec vitest run test/enrollment.test.ts
    pnpm --filter desk-hub exec vitest run test/deploy/admin.test.ts      # one file per run
    pnpm --filter desk-hub exec vitest run test/deploy/admin-verbs.test.ts
    pnpm --filter desk-hub build                                          # wrangler deploy --dry-run: clean (the desk track's condition)
    node --experimental-strip-types --input-type=module -e "const m = await import('./apps/org-protocol/src/index.ts'); console.log(['encodeEnrollmentCodeV2','decodeEnrollmentCodeV2','certificateViews','resolveMachine','machineRows'].map((n) => typeof m[n]).join(' '))"
    npx vitest run --project node test/endpoint/grants-call.test.ts
    npx vitest run --project node src/main/org/edits.test.ts
    npx vitest run --project node src/main/org/enroll.test.ts
    npx vitest run --project node src/main/org/grants.test.ts
    npx vitest run --project node src/main/device/step-up.test.ts
    npx vitest run --project node-timing test/org/org-page.local.test.ts

**M4c.** The `org-protocol` commit first, with the admin suites one file per run. Then:

    pnpm --filter org-protocol exec vitest run test/delegations.test.ts
    pnpm --filter org-protocol exec vitest run test/successor-problems.test.ts
    npx vitest run --project node src/main/org/checks.test.ts
    npx vitest run --project node src/main/org/delegations.test.ts      # the fake gcloud on a scratch PATH
    npx vitest run --project node src/main/org/edits.test.ts
    npx vitest run --project node-timing test/org/org-page.local.test.ts

The live check is the owner's, on staging first. In the Delegations section the owner names staging's secret (a scratch secret in the owner's Google Cloud project, which the owner creates), creates a delegation, then checks the secret's new version by metadata alone (`gcloud secrets versions list <secret>`). A VM provisioned from it (`devcloud vm up` with the profile naming it, or the endpoint harness) lists. Then the owner renews and drops it. Production's first app-created delegation is the owner's, after M8.

**M5b.**

    npx vitest run --project renderer src/renderer/src/sessions/share/AddOwnerSheet.test.tsx
    npx vitest run --project node src/main/org/policy.test.ts
    npx vitest run --project node-timing test/org/policy.local.test.ts

Live: at M8's sitting, step 7 (moved there on 2026-11-09; the architect).

**M8.** The sitting script (refreshed 2026-11-09 against master cf30dafdd; Decision Log, "M8's sitting script"); corrected 2026-11-10 after the sitting, Decision Log "M8's sitting"). The architect may read the owner's MAWS and press a button in it through `cua_repl` at the owner's request and on their go; Touch ID and every terminal confirmation stay the owner's. Step 7, on staging, runs first. Steps 1 to 6 then run on production. Who does each step is in brackets: **[owner]**, **[desk]** (the desk track), **[mini-ops]**, or **[architect]**. The architect sets the sitting and runs it with the owner. Every `staging-run.sh` and `production-run.sh admin …` verb that the owner runs goes in a Terminal or iTerm window, never with `!` in Claude Code, because its confirmation reads `/dev/tty`. Every command runs from a checkout of master at or after cf30dafdd. No step writes either of the owner's email addresses into a repository, a PR or a chat; the email file of M6b's layer 2 is the only place one is written.

**Before the sitting.** Nothing below may start until every item here holds.
- **Preconditions** (each checked by whoever is named):
  - [architect, with the owner] The swap: the MacBook, the mini and `dc-linux171-1e68` run master cf30dafdd. `mawsd status` on each machine reads `build … cf30dafd · wire 3.33`. At the refresh the MacBook read `cfff902f`.
  - [desk] The production hub serves `hub@14ec1177` (read credential-free: `curl -sI -X POST https://desk-hub.opencognita-platform.workers.dev/machine/enroll | grep -i x-desk-build`). That is enough for M8: `device.remove` and M3's deliveries need no newer hub. The staging hub serves `hub@e181a194` or later, which is enough for step 7. Both readings were taken at the refresh.
  - [desk] O14's B4 has run its steps 4 to 8; it is ticked in O14's document (2026-11-07). The old step 2 is therefore only a check.
  - [owner] The deployment admin device's key file and anchor are present: `ls ~/.local/state/desk-hub-production/device/` lists `keys.json` and `keys.json.org.json`. The owner's terminal holds a production Access token: if `production-run.sh admin show` says it has none, or that it has expired, run `cloudflared access login https://desk-hub.opencognita-platform.workers.dev` first.
  - [owner] The owner's MAWS is signed in to production, and Settings › Org › You names its device.
  - [architect] Before step 3, the owner says they hold the paper recovery key (added 2026-11-10). After step 3 the recovery key is the only way back if this Mac's device is lost.
  - **Unknown from the records, and settled by step 1's `show`:** whether the app's device is already a root. No record shows M3's root-add sitting (P5 Decision Log 155).
- **Staged beforehand** [desk, rehearsed on staging with the harness, never with the owner's identities]:
  - A worktree for the sitting at `/Users/new/.local/share/maws-worktrees/m8-sitting`, from master at or after cf30dafdd, with `pnpm install --frozen-lockfile` run. The owner's staging profile launches from it.
  - One staging machine, a devcloud VM (`endpoint-vm` or `reach-vm`, the desk track's choice). It is enrolled on staging with the owner's staging member among its owners, runs sminos 1.38.0 or later and a build at or after cf30dafdd, and its RL10 welcome carries `record`.
  - The email file: the owner sends the second email to the desk track directly, and the desk track writes it to a 0600 file outside any checkout (M6b's layer 2, step 1).
  - A rehearsal of step 7's act on that VM with a harness member as the adder, to confirm the scene. It covers the step-up a dev profile asks for: if a scratch profile can't step up for `record.owners`, the fallback below is the plan, and the architect is told before the sitting.

7. **Add owner, on staging (run first).** This is M5b's live proof, acceptance 5's add half. B is the owner's second staging identity; production has no second member (M8's Decisions).
   1. [desk] `zsh apps/desk-hub/deploy/staging-run.sh real-member add --email-file <that file>`. B becomes a member of the staging head. B never signs in, so `access-sync`, the pairing and M6b's browser pitfall aren't needed.
   2. [owner] Start only once the desk says 7.1 and 7.4's scene are done (added 2026-11-10): `pair` reads the head when it starts and signs at the end, so a head the desk moves in between is refused `409`. In a Terminal or iTerm window, not with `!` in Claude Code, run `DESK_STAGING_DEVICE=/Users/new/.local/share/dsk-scripts/p5-o11/staging-device zsh apps/desk-hub/deploy/staging-run.sh admin pair --class native-mac` from the sitting worktree. It prints a code and waits for the app's entry. The prefix names where this Mac keeps staging's admin keys, since `staging-run.sh` defaults to `~/.local/state/desk-hub-staging/device`, which this Mac doesn't have; without it the command stops with "no admin device keys" (the desk track, 2026-11-10). If it reports no staging Access token, run `cloudflared access login https://desk-hub-staging.opencognita-platform.workers.dev` once, as yourself, and run it again.
   3. [owner] Launch the staging profile:

          cd /Users/new/.local/share/maws-worktrees/m8-sitting && mkdir -p -m 700 "$HOME/.local/share/maws-m8-staging" && MAWS_USER_DATA="$HOME/.local/share/maws-m8-staging" npx electron-vite dev

      In Settings › Org, paste the code, press Sign in, and finish in the browser as yourself. Compare the fingerprint with the terminal's, and approve there. You see "Signed in to staging-ssfskim as …", with your own staging identity. A macOS dialog on first launch is yours to answer; Deny is safe.
   4. [desk] On the staging VM (keep-a1's own lane A and lane B sessions serve, as at the sitting): one lane A session (a terminal `claude` in a checkout of a hub project) and one lane B session (spawned from the owner's staging profile with New chat on the VM's machine, by the owner, as the desk track directs). Both rows appear in the owner's staging sidebar as yours.
   5. [owner] On each of the two rows, open the row menu and choose Add owner…. The sheet offers B by name. Pick B, press Save, and answer the step-up once. You see "Added", or the endpoint's refusal in words.
   6. [owner] Check: each row's owners read "you, <B's first name>", and its hover card lists B. Quit the profile and launch it again (step 3's command): both rows still name B, from the next listing. [architect] Takes a screenshot of each row and its hover card for Outcomes.
   7. **Fallback** [architect decides at the sitting]: if the profile can't sign in to staging, or can't step up, the harness member is the adder on the same VM, as at M6b. B then pairs (M6b's layer 2, steps 3 and 4, with its pitfall), and B's profile reads each session as its own, co-owned with the harness's member. Outcomes records that the sheet is proved by the unit and local suites only.
   8. Teardown, only on the owner's explicit word after 7.6's relaunch (added 2026-11-10):
      - [desk] Runs `zsh apps/desk-hub/deploy/staging-run.sh real-member remove --email-file <that file>`. If B paired, it also runs `staging-run.sh access-sync`.
      - [owner] Quits the staging profile.
      - [desk] Ends the profile's `mawsd` with `pgrep -fl maws-m8-staging`, then `kill -TERM <pid>`, and checks that no process and no lock file is left. Then it deletes `~/.local/share/maws-m8-staging`, the email file, and the VM.
      - [owner] Removes the staging profile's device from staging, since its keys went with the directory. In a Terminal or iTerm window, not with `!` in Claude Code, run `DESK_STAGING_DEVICE=/Users/new/.local/share/dsk-scripts/p5-o11/staging-device zsh apps/desk-hub/deploy/staging-run.sh admin remove-device -- <its id>` (the `--` because a device id may start with `-`), the id the profile showed at step 3, and confirm. You see that the staging head no longer lists it. Nothing on production has changed.
1. **The root add, unless done.**
   - [owner] In a Terminal or iTerm window, not with `!` in Claude Code, run `zsh apps/desk-hub/deploy/production-run.sh admin show`.
   - If it already lists two root lines, one of them naming the device in your MAWS's Settings › Org › You, go to step 3.
   - Otherwise, in the same window, run `zsh apps/desk-hub/deploy/production-run.sh admin root add -- <that device id>`. Compare the fingerprint it asks about with the one the Org page shows, and answer `y`. If it answers "not made a root: nothing was signed" after your `y`, nothing was signed: run it again in a fresh Terminal window.
   - You see: `root added: … (version N+1)`, `show` reads two root lines, and the Org page reads "This Mac signs the org state". The page offers Re-sign now only while the weekly successor is due (`OrgGroup.tsx:164`), so step 3's removal, signed by this Mac, is the proof that it signs. From here on, you no longer run `refresh`.
2. **B4's steps 4 to 8.** [desk] Confirm only: they ran on 2026-11-07, and O14 is done.
3. **The revocation.**
   - [owner] In your MAWS, Settings › Org › People, your own member lists the deployment admin's device (`deployment-admin-<12 hex>`, or `a1`). Choose Remove device…. The sheet's lines read: both of its keys revoked, the root removed. Sign with Touch ID.
   - You see: "Signed version M.", and the Org group's roots list only this Mac. Its Deliveries line empties once every machine has acknowledged. [architect] Takes a screenshot of the sheet for the record.
   - [owner] The last `admin` command, read-only, in a Terminal or iTerm window, not with `!` in Claude Code: `zsh apps/desk-hub/deploy/production-run.sh admin show`. You see: `head version M`, one root line (the app's device), and the admin device no longer listed under your member. `show` moves the admin's anchor to version M, as intended.
4. **The deletion.** [owner] In a Terminal or iTerm window, run `rm ~/.local/state/desk-hub-production/device/keys.json ~/.local/state/desk-hub-production/device/keys.json.org.json`. If `DESK_PRODUCTION_DIR` or `DESK_PRODUCTION_DEVICE` moved them, delete them where they are instead. Leave the offline recovery key alone.
   - You see: `ls ~/.local/state/desk-hub-production/device/` lists neither file, and the Org page still reads "This Mac signs the org state".
5. **O15's check.** [owner] Settings › Org's root lines name one device, this Mac. [architect] Records it for O15.
6. **The acceptance run.** [architect] Records each item in Outcomes, with a screenshot, a version or a transcript line. Items already proved live are cited, not repeated:
   - 1: the M1 staging sitting (P5 Decision Log 116) and production's own sign-in.
   - 2: the rows at the first cut-over machine.
   - 6: the M6b shared staging run (P5 Decision Log 252).
   - [owner] On production, each of these is a look in the owner's MAWS:
     - 3: the Org page reads "This Mac signs the org state", with the head version from step 3.
     - 4a: step 3's sheet.
     - 4b: Machines lists the three machines with their owners.
     - 4c: Delegations lists the devcloud delegation. Production's first app-created delegation stays the owner's, after M8.
     - 5: step 7's screenshots. On production, rows show no owner labels, because the owner owns every session alone.
     - 7: a project's Channel tab shows its log and to-human entries across the machines.

### Interfaces and Dependencies

`tweetnacl` 1.0.3 (new, exact): `nacl.box.keyPair()` and `nacl.box.open`. Otherwise `ws` 8.22.0, zod 4 and `org-protocol`.

**§A. The production org session** (`src/main/org/org-session.ts`).

    import type { OrgSession, SignedIn } from './session';                         // O7 §B
    import type { DeviceKeys } from '../device/keys';
    import type { OrgStatus, OrgRefusal } from '@shared/ipc/schema/org';

    export interface OrgSessionService extends OrgSession {
      status(): OrgStatus;
      onStatus(listener: (status: OrgStatus) => void): () => void;
      register(code: string): { ok: true } | { ok: false; reason: OrgRefusal };    // starts; progress and the outcome arrive as statuses
      signIn(): { ok: true } | { ok: false; reason: OrgRefusal };                  // a held registration: the login transfer alone
      reanchor(code: string): { ok: true } | { ok: false; reason: OrgRefusal };    // only in `held-chain`; else refused `busy`
      cancel(): void;
      signOut(): Promise<void>;
      attach(feed: RegistryFeedHooks): () => void;                                   // §F's notices: open, state, removed, credentials ended
      close(): Promise<void>;
    }
    export interface OrgSessionDeps {
      userData: string;
      build: string;
      packaged: boolean;
      env: NodeJS.ProcessEnv;                                                        // MAWS_DEV_STANDIN_USER, honoured unpackaged only
      openExternal(url: string): boolean;                                            // main's openExternalUrl
      stepUp(keys: DeviceKeys, device: { org: string; device: string }): SignedIn['stepUp'];
      loadKeys?: typeof import('../device/keys').loadDeviceKeys;                     // tests inject one with excludeFromBackup stubbed
      excludeFromBackup?(path: string): Promise<boolean>;
      login?: AccessLogin;                                                           // §E; the transfer by default
      fetch?: typeof fetch;
      now?(): number;
      timing?: Partial<OrgTiming>;
      log(line: string): void;
    }
    export function createOrgSession(deps: OrgSessionDeps): OrgSessionService;      // returns at once; reads its files in the background

**§B. `org.*`** (`src/shared/ipc/schema/org.ts`; owner `main`; grade `client` in `src/shared/ipc/grades/org.ts`).

    export const ORG_REFUSALS = ['bad-code', 'other-org', 'access', 'not-member', 'keys', 'chain', 'removed', 'expired', 'hub', 'busy'] as const;
    export type OrgRefusal = { code: (typeof ORG_REFUSALS)[number]; detail?: string };   // detail: a verdict, a status, the email Access named

    export type OrgStatus =
      | { state: 'none'; refused?: OrgRefusal }                                      // `refused`: the last attempt's end
      | { state: 'development'; org: string; member: string; device: string }
      | { state: 'registering'; step: 'browser' | 'checking' | 'approval'; org: string; hub: string;
          fingerprint: string | null; expires: string | null }                       // fingerprint and expires at `approval`
      | { state: 'registered'; org: string; hub: string; member: { id: string; email: string }; device: string;
          session: 'signed-in' | 'signed-out' | 'removed';
          hubAccess: 'connected' | 'connecting' | 'expired' | 'denied' | 'unreachable' | 'signing-in';
          head: { version: number; issued: string } | null;                         // null until a held chain verifies
          problem: 'held-chain' | 'rollback' | 'fork' | 'directory' | null;         // held-chain: closed until a re-anchor; directory: <userData>/org/ refused
          refused?: OrgRefusal };

    commands: 'org.status' (void → OrgStatus), 'org.register' ({code: string} → {ok: true} | {ok: false, reason: OrgRefusal}),
              'org.signIn' (void → same), 'org.reanchor' ({code: string} → same), 'org.cancel' (void → void), 'org.signOut' (void → void),
              'org.rows' (void → OrgRows; M2)
    events:   'org.changed' (OrgStatus), 'org.rows.changed' (OrgRows; M2)

`busy` refuses a `register` or `signIn` while another runs. The renderer's code field never echoes the code back in a status.

**§C. Files** (`<userData>/org/`, 0700, checked with `assertPrivateDirectory` at each start; each file 0600, written through a temporary file and a rename, and a file that doesn't read is logged and treated as absent).

    registration.json  { "version": 1, "hub": "<origin>", "org": "<org id>", "member": { "id": "<32 hex>", "email": "<email>" },
                         "device": "<keyId(channelPub)>", "pins": { "roots": ["<key id>"], "recoveryPub": "<B64>" },
                         "anchor": { "genesis": "<stateHash of version 1>", "version": <the held head's version>, "head": "<its stateHash>" },
                         "registered": "<ISO>", "signedOut": false }
    chain.json         { "version": 1, "chain": SignedOrgState[] /* genesis … head */, "transitions": Signed<RootTransition>[],
                         "accepted": RootTransition[], "certificates": Certificates, "highWater": <version>,
                         "superseded": SignedOrgState[] }
    access.json        { "version": 1, "hub": "<origin>", "kind": "access", "token": "<app token>", "expires": "<ISO>", "email": "<email>" }
                     | { "version": 1, "hub": "http://127.0.0.1:<port>", "kind": "standin", "user": "<email>" }
    listings.json      { "version": 1, "org": "<org id>", "records": Signed<Listing>[],                           (M2)
                         "marks": { "<ref>/<session>": { "revision": <n>, "hash": "<SHA-256 of the canonical record, B64>", "kid": "<sig.kid>", "delegation": "<id>" | null, "gone": <boolean> } } }
                                                                   // delegation: the certificate's, when a delegated machine signed it
    grants.json        { "version": 1, "issued": [{ "signed": Signed<Grant>, "headVersion": <the version it was verified and kept under>, "delivered": "pending" | "sending" | "done" | { "refused": "<code>" }, "op"?: "<op id>" }] }   (M4b)
                                                                   // every grant this app signed, the latest per (machine, member); fails closed: registration.json's
                                                                   // "grants": true, set before its first write, makes a missing or unreadable file `damaged` (no grant signed)
                                                                   // "sending": written before each act (write-ahead); an entry a start finds "sending" becomes
                                                                   // { "refused": "outcome-unknown" } and is never sent again

The directory is excluded from Time Machine at its creation, best effort. Nothing in it is a key: the device's keys stay in `<userData>/device/` (O10 M9).

**§D. The held org view** (`src/main/org/held.ts`).

    import type { OrgView, OrgPins, SignedOrgState, RootTransition, Signed, Certificates } from 'org-protocol';
    export interface HeldOrg extends OrgView {
      ready(): boolean;                                                               // a verified chain is held
      adoptServed(served: { chain: SignedOrgState[]; head: SignedOrgState | null; transitions: Signed<RootTransition>[];
                            certificates: Certificates }): Promise<{ adopted: number; rewound: boolean; refused?: 'rollback' | 'fork' | string }>;
      onAdopted(listener: () => void): () => void;                                    // after the file is written
      superseded(): readonly SignedOrgState[];
    }
    export type Anchor = { genesis: string; version: number; head: string };       // stateHash values (B64)
    export function startHeldOrg(input: {
      file: string;                                                                   // chain.json
      anchor: Anchor | null;                                                          // registration.json's; null only at registration and re-anchoring
      saveAnchor(anchor: Anchor): void;                                               // writes registration.json; called after each chain.json write
      pins?: OrgPins;                                                                 // with `first`: the code's, for verifyPinnedChain
      first?: { chain: SignedOrgState[]; transitions: Signed<RootTransition>[]; certificates: Certificates };
      log(line: string): void; now?(): number;
    }): Promise<HeldOrg | null>;                                                      // null: no chain passed the load rule (held-chain)

`advance` (OrgView's) is `adoptServed` with no served head.

**§E. The login** (`src/main/org/access-login.ts`).

    export type HubCredential =
      | { kind: 'access'; token: string; expires: string; email: string | null }
      | { kind: 'standin'; user: string };
    export type AccessLogin = (hub: string, options: { signal: AbortSignal }) => Promise<HubCredential>;
    export function cloudflareLoginTransfer(deps: { openExternal(url: string): boolean; fetch?: typeof fetch;
      store?: string /* https://login.cloudflareaccess.org/ */; certsOrigin?(authDomain: string): string; now?(): number;
      log(line: string): void }): AccessLogin;
    export function hubHeaders(credential: HubCredential): Record<string, string>;   // {'cf-access-token': …} | {'x-desk-standin-user': …}

The transfer, as `cloudflared` 2026.8 does it (`token/transfer.go`, `token/token.go`, `token/encrypt.go`) and as U9's spike ran it against staging (O11 M7):
1. **Discover.** `HEAD <hub>` with `cf-access-metadata-request: true`, `redirect: 'manual'`. The answer's `cf-access-metadata` header is a JWT. Fetch `https://<auth_domain>/cdn-cgi/access/certs`, find its header's `kid`, and verify it (RS256, `RSASSA-PKCS1-v1_5` with SHA-256). Its body's `hostname` must equal the hub's host (case-insensitive), `type` must be `'match'`, and `aud` must be present. `auth_domain` may come with or without a scheme. A missing header, a key the team doesn't publish or a failed signature fails the login, and nothing is opened.
2. **Seal.** `nacl.box.keyPair()`. The transfer id is the public key in base64url **with padding** (Go's `base64.URLEncoding`).
3. **Open the browser** at `https://<hub host>/cdn-cgi/access/cli` with the query, in key order: `aud=<aud>`, `close_interstitial=true`, `edge_token_transfer=true`, `redirect_url=<hub origin>?aud=<aud>&token=<id>` (no slash before `?`), `send_org_token=true`, `token=<id>`. `send_org_token` stays in, since it is the path the spike proved; the org token is dropped on receipt.
4. **Long-poll** `GET https://login.cloudflareaccess.org/transfer/<id>` with a 60 s timeout per request. A 200 is the payload; another status below 500 waits 1 s and polls again; a 5xx fails. The whole wait is bounded by `LOGIN_WAIT_MS`.
5. **Open the payload.** The body is standard base64. Its first 24 bytes are the nonce, and the rest opens with `nacl.box.open(rest, nonce, <service-public-key header, base64url>, secretKey)` into JSON `{app_token, org_token}`. A payload that doesn't open fails the login.
6. **Keep** `app_token` with its JWT payload's `exp` and `email`, which are read and not verified. Discard `org_token`.

**The stand-in.** A loopback `http://127.0.0.1:<port>` hub, in an unpackaged build with `MAWS_DEV_STANDIN_USER=<email>`, gives `{kind: 'standin', user}` with no browser. Otherwise a loopback hub is refused `bad-code`.

**§F. The Registry feed** (`src/main/org/registry-feed.ts`).

    import type { OrgSession } from './session';
    import type { Listing, Signed } from 'org-protocol';
    export interface RegistryFeedHooks {
      onOpen(listener: () => void): () => void;
      onState(listener: (version: number) => void): () => void;
      onRemoved(listener: () => void): () => void;                                    // a close 4403
      onCredentialsEnded(listener: () => void): () => void;                           // an upgrade answered by Access, not the Worker
    }
    export interface RegistryFeed extends RegistryFeedHooks {
      onListings(listener: (page: { records: Signed<Listing>[]; last: boolean }) => void): () => void;
      onListing(listener: (record: Signed<Listing>) => void): () => void;
      connected(): boolean;
      probe(): void;
      close(): void;
    }
    export function createRegistryFeed(deps: { session: OrgSession; socket?: (url: string, headers: Record<string, string>) => WebSocketLike;
      timing?: Partial<OrgTiming>; random?(): number; log(line: string): void }): RegistryFeed;

The socket is `ws` to `ws(s)://<hub>/api/registry/socket?app=1` with `session.current().hub.headers()`. It is held while `current()?.hub` is non-null, and re-opened when `onChanged` changes the hub's URL or headers. After a `4403` close or an upgrade Access answered, it waits for the session's next change (a sign-in) rather than its backoff. Unknown frames (`grid`, `summary`, anything new) are ignored.

**§G. The rows** (M2: `src/shared/ipc/schema/org.ts`, `src/main/org/rows.ts`, the renderer).

    export interface RemoteRow {
      machine: MachineRef;                                                            // the listing's ref
      session: string;                                                                // lane A: the engine session id; lane B: the appSessionId (O9's R1)
      lane: 'A' | 'B';                                                                // R2
      state: string;                                                                  // sminos's word (R4)
      title: string;                                                                  // R4
      owners: string[];                                                               // member ids (R5)
      project: string | null;                                                         // sminos's project id, the smnsId (R5)
      orgKey: OrgKey | null;                                                          // the local org key it joins, by the signed-in org (R5)
      availability: 'foreign_held' | null;                                            // lane A: 'foreign_held' (R3); lane B: null (O7 M2's)
      revision: number;
      issued: string;
      mine: boolean;                                                                  // the signed-in member is an owner
    }
    export interface OrgRows {
      machines: MachineRef[];                                                         // the RL2 roster: these take no record snapshot
      rows: RemoteRow[];
      complete: boolean;                                                              // this run's hub snapshot applied, the announced head adopted
      pending: MachineRef[];                                                          // roster machines with records awaiting verification
    }
    // In the zod schema `session` is a plain string, never AppSessionIdSchema, so O6's codec lifts nothing in a row;
    // the renderer forms the address with `addressOf(machine, session)`.

    // src/main/org/rows.ts
    export function createRemoteRows(deps: { session: OrgSession; feed: RegistryFeed; roster(): readonly MachineRef[];
      onRoster(listener: () => void): () => void; localProjects(): Promise<readonly ProjectRecord[]>;
      onLocalProjects(listener: () => void): () => void; file: string; emit(rows: OrgRows): void; now?(): number;
      timing?: Partial<OrgTiming>; log(line: string): void }): { rows(): OrgRows; close(): Promise<void> };

    // renderer: stores/sessions.ts
    export type ListedSession = RemoteRow & { appId: AppSessionId };                 // appId = addressOf(machine, session)
    //   state.listed: ReadonlyMap<AppSessionId, ListedSession>; state.listedMachines: ReadonlySet<MachineRef>; applyRows(rows: OrgRows): void
    // renderer: stores/org-projects.ts
    export function rowOfListed(index: OrgIndex, listed: ListedSession, alsoListed?: ReadonlySet<RowKey>): RowKey | null;
    // renderer: sessions/remote-openers.ts
    export function registerRemoteOpener(lane: 'A' | 'B', open: (listed: ListedSession) => void): () => void;
    export function remoteOpenerFor(lane: 'A' | 'B'): ((listed: ListedSession) => void) | null;

**§H. Timing** (`src/main/org/timing.ts`; each a field of `OrgTiming`, overridable in tests).

| Name | Value | From |
|---|---|---|
| `LOGIN_WAIT_MS` | 900 000 | the spike's 15 minutes |
| `TRANSFER_POLL_MS` | 60 000 per request, 1 000 between non-200 answers | `cloudflared`'s long poll |
| `APPROVAL_POLL_MS` | 3 000 | `deployment admin pair`'s 2 s, plus the hub's page |
| `REGISTRATION_WAIT_MS` | the pending entry's `expires` (600 s) | `PENDING_DEVICE_TTL_S` |
| `FETCH_TIMEOUT_MS` | 10 000 | — |
| `FEED_BACKOFF_MS` | 1 000, 2 000, 4 000, 8 000, 16 000, then 30 000; ±20% | O7's `BACKOFF_MS` |
| `CERTS_REFRESH_MS` | 600 000 | the endpoint's 10-minute sync |
| `TOKEN_SKEW_MS` | 60 000 | — |
| `HEAD_WARN_DAYS` | 21 | the phone's warning (O13) |
| `ROWS_COALESCE_MS` | 100 | — |
| `ROWS_CACHE_WRITE_MS` | 1 000 | — |
| `UNVERIFIED_MAX` | 1 024 records | — |
| `WEEKLY_DUE_DAYS` | 7 | Q6 |
| `ASK_GAP_MS` | 86 400 000 | Q6's once a day |
| `WEEKLY_CHECK_MS` | 3 600 000 | — |
| `DELIVERY_RETRY_MS` | 3 600 000 | — |
| `DELIVERY_MAX_BYTES` | 524 288 | an eighth of RL2's `MESSAGE_MAX_BYTES` (4 MiB, `channel.ts:50`) |

**§I. Contract requests** (for P5's writer to carry; each says what O8 needs, not how).

*To O3* (the services host and the spine):
- **D1. Per-member reader state and drafts** (P5 Decision Log 36). The index in `mawsd` keys unread, last seen, pinned and drafts by session and member, reachable over RL2 by a remote member and locally as the machine owner's member (M6). The same index answers a member's `session.get` and `session.list` by rank, O7's C5, which gives a remote session's pane its record (M2's yield rule).
- **D2. Lane B's record changes.** *Refused by P5 Decision Log 101:* lane B's record changes route to sminos's member record, as lane A's do (Decision Log 45). M5b and M6 take that route.
- **D3. Lane B's to-human messages over RL3.** The owner channel's messages and asks of lane B sessions, served per machine on a subscription the project channel opens (M7), as O12 item 6 does for lane A.
- **D4. The project of a session** stays sminos's project id in every record and listing, so the join in M2 stays one rule.

*To O10* (the endpoint): offer-table rows for `record.owners`, access and share changes, `manage`-graded with step-up for another's removal (RL §6.1), routed to sminos for both lanes (M5b, M6; P5 Decision Logs 45 and 101). `endpoint.state` stays the act that delivers a revocation directly (M3).

*To O11* (the hub):
- **H1.** An admin's read of a member's pending device entries, so an admin can enroll a member's first device (P5 Decision Log 34; M4). Its exact shape is in M4.
- **H2.** An app frame on the `?app=1` socket when a machine certificate or its retirement is stored, so the app needn't poll for a new devcloud VM (M1's `CERTS_REFRESH_MS` until then).
- **H3.** A way for a member's app to read the state that removed the member: the hub sends it (or its version and the chain since the app's head) before closing `4403`, or answers `GET /api/org/state` for that version to a member it has just dropped. Until then the app reads `denied` and learns the removal from an endpoint (M1).

*To O12* (sminos): `access` and `shares` in `member` frames, and the executors for `record.owners`, access and share RPCs under the opId ledger (M5, M6); the RL2 view of the machine-local to-human store of item 6, for the project channel (M7).

*To O7*: M2's `registerRemoteOpener('B', …)` and the yield rule (a record at a listed address replaces the row), which O7 M2's re-plan adopts; and the snapshot rule for RL2 machines, which O7 M2 replaces for lane B. A contract question for O7 M2's re-plan (finding F8): its pane for a remote lane B session draws from the `ListedSession` and its subscription, or waits for O3's per-member read (C5) to supply a record.

*To O9*: M2's rows meet R1, R2, R4, R5 and R6 as asked. R3 is met as far as a listing can say: a lane A row reads `availability: 'foreign_held'`, carries no holder kind or pid (RL6 has none: finding F6), and offers no action. O9 M9 registers `registerRemoteOpener('A', …)`. A contract question for O9 M9 (finding F8): a remote lane A session is a `ListedSession`, and no source produces a `SessionRecord` for it before O3 (its plane's `presence` is not one), so `controlsFor(record, …)` and the pane need either a remote variant that takes the `ListedSession` with the watch's `LaneAState`, or O3's per-member read.

**§J. Contract additions.**
- **Now (M1):** `OrgSessionService` and `createOrgSession` (§A), which implement O7 §B; `org.status`, `org.register`, `org.signIn`, `org.reanchor`, `org.cancel`, `org.signOut` and `org.changed` (§B); `<userData>/org/` (§C); `HeldOrg` (§D); the login and `MAWS_DEV_STANDIN_USER` (§E); the Registry feed (§F); `tweetnacl` 1.0.3. No `WIRE_MINOR`, no settings version, no e2e group.
- **Now (M2):** `RemoteRow`, `OrgRows`, `org.rows` and `org.rows.changed`; the listed partition, `rowOfListed` and `registerRemoteOpener` (§G); `listings.json`.
- **M3 (executable):** §K: `createStateSigner`, the next keys, `checks.ts`, the signer and its pending slot, the weekly asking, deliveries, `postState`, `OrgStatus`'s `signer` and `problem: 'signing'`, `org.resign`, `org.revokeSuperseded`, `org.rekey`, `org.discardPending`, `org.resetSigning`, `signing.json` (failing closed) and `registration.json`'s `signing` and `rekey`; `deployment admin root add`. No `WIRE_MINOR`, settings version, `IpcError` code or e2e group.
- **M5 (executable):** §L: `memberName`, `OrgMember`, `OrgRows.members`, the `sidebar.people` layout key, `ownersLabel`. No layout version, `WIRE_MINOR` or settings version.
- **M4a (executable):** §M: `successorProblems` and `stateProblems` in `org-protocol`, the pairing judges moved there, `OrgView`, `OrgChange`, `org.view`, `org.preview`, `org.change`, `org.pair.start`, `org.pair.approve`, `org.pair.cancel`, `OrgStatus`'s `pairing`, `OrgRefusal.attempt`, `Edit.endorse` and `StateSigner.sign`'s `endorse`. No `WIRE_MINOR`, settings version or e2e group.
- **The rest (executable, 2026-11-06):** §N (M7a), §O (M7b), §P (M6a), §Q (M6b, with M5b's `record.owners`), §R (M4b) and §S (M4c). No `WIRE_MINOR` moves: the new endpoint offers and feeds are additive rows (OX1), and the index takes new tables as `ADDED_TABLES` entries, not migrations (revised 2026-11-06). M7b's spine commands do move `WIRE_MINOR` (to 30, after #506 took 29): they are machine-owned wire entries, not endpoint offer rows. So does M6a's `session.reader.update` (to 31, revised 2026-11-07). M7a adds the `channel` tab kind with no layout version.

**§K. The signer** (M3).

    // src/main/device/step-up.ts
    export type StateSigner = {
      kid: string;                                                                    // keyId(stepUp.pub)
      sign(state: OrgState, prompt: { summary: string; text: string }): Promise<{ ok: true; signed: SignedOrgState } | { ok: false; reason: 'cancelled' }>;
    };
    export function createStateSigner(deps: { key: SigningKey; confirm?: Confirm }): StateSigner;   // Touch ID first, then signOrgState(state, [key])

    // src/main/device/keys.ts
    export function createNextDeviceKeys(profile: string, deps: DeviceKeysDeps): Promise<DeviceKeys>;  // device/keys.next.json, marked
    export function promoteNextDeviceKeys(profile: string): Promise<void>;          // keys.json → keys.retired.json, keys.next.json → keys.json
    export function destroyRetiredDeviceKeys(profile: string): Promise<void>;
    //   loadDeviceKeys finishes a promotion a crash cut off (keys.json absent, keys.next.json present)

    // src/main/org/checks.ts
    export type CheckCode = 'revives-revoked' | 'prefix-equal' | 'prefix-nested' | 'prefix-covers' | 'prefix-names-machine'
      | 'delegation-id-used' | 'renew-expired' | 'renew-not-extension' | 'drops-delegation' | 'superseded-keys';
    export type Finding = { level: 'refuse' | 'warn'; code: CheckCode; detail: string };
    export function checkSuccessor(head: OrgState, next: OrgState, superseded: readonly SignedOrgState[], now: Date): Promise<Finding[]>;
    export type SupersededOffer = {
      edit(draft: OrgState): void;                                                    // the whole closure, applied to the successor
      lines: string[];                                                                // each candidate and each consequence, for the prompt
      withheld: RevokedKey[];                                                         // own keys, the last root
    } | null;                                                                         // null: nothing to offer
    export function supersededRevocations(head: OrgState, superseded: readonly SignedOrgState[], self: { channelKid: string; stepUpKid: string }): Promise<SupersededOffer>;

    // src/main/org/signing-store.ts: the one writer of signing.json, over M1's commit queue
    export type SigningFile = { version: 1; pending: Pending | null; deliveries: Obligation[]; abandoned: Abandoned[]; lastAsked: string | null; lastNotified: string | null };
    export interface SigningStore {
      get(): SigningFile | 'damaged';                                                // the last read or written; 'damaged' → problem 'signing'
      update<T>(fn: (file: SigningFile) => { next: SigningFile; value: T }): Promise<T>;   // in the commit queue; no network, no adoption inside
      reset(): Promise<void>;                                                         // org.resetSigning
    }
    export function createSigningStore(deps: { files: OrgFiles; commit<T>(body: () => Promise<T>): Promise<T>;
      registration(): { signing?: true } | null; markRegistration(): Promise<void> }): Promise<SigningStore>;

    // src/main/org/signer.ts
    export type Edit = { summary: string; lines: string[]; apply(draft: OrgState): void | Promise<void> };
    export type SignOutcome = { ok: true; version: number }
      | { ok: false; reason: 'not-root' | 'unmarked' | 'signing' | 'cancelled' | 'pending' | 'invalid' | 'hub' | 'busy'; detail?: string }
      | { ok: false; reason: 'refused'; findings: Finding[] };
    export interface OrgSigner {
      isRoot(): boolean;
      maySign(): boolean;                                                             // root, marked, signing.json readable
      pending(): { version: number; exposed: boolean; fork: boolean } | null;
      sign(edit: Edit): Promise<SignOutcome>;                                         // composes, checks, prompts, slots, posts, adopts
      settle(): Promise<void>;                                                        // the slot's three rules
      discardPending(confirmed: true): Promise<{ ok: boolean; reason?: 'held' }>;    // only after the owner's confirmation
      resetSigning(confirmed: true): Promise<void>;                                    // only in problem 'signing'
    }
    export function createOrgSigner(deps: { session: OrgSession; held: () => HeldOrg | null; signer: () => StateSigner | null;
      hub: () => HubClient | null; store: SigningStore; deliveries: Deliveries;
      now?(): number; log(line: string): void }): OrgSigner;

    // src/main/org/weekly.ts
    export function startWeekly(deps: { signer: OrgSigner; head: () => SignedOrgState | null; store: SigningStore;
      focused(): boolean; onFocus(listener: () => void): () => void; notify(text: string): void;
      timing?: Partial<OrgTiming>; now?(): number; log(line: string): void }): { due(): boolean; close(): void };

    // src/main/org/deliveries.ts
    export interface Deliveries {
      obligation(signed: SignedOrgState, parent: OrgState): Obligation | null;        // the signer writes it with the slot, in one update
      send(): Promise<void>;                                                          // each owed machine whose state is on the app's line; exposure written before each act
      owing(): Array<{ version: number; machines: MachineRef[] }>;
      close(): void;
    }
    export function createDeliveries(deps: { store: SigningStore; roster(): readonly MachineRef[]; onRoster(l: () => void): () => void;
      link(ref: MachineRef): RemoteLink | null; view: () => HeldOrg | null; timing?: Partial<OrgTiming>; log(line: string): void }): Deliveries;

    // src/main/org/hub-client.ts
    postState(signed: SignedOrgState, signal?: AbortSignal): Promise<HubResult<{ version: number }>>;   // 409's `error` is the verdict code

    // src/shared/ipc/schema/org.ts: `registered` gains (and `problem` gains 'signing')
    signer: {
      root: boolean; maySign: boolean;                                                                  // this device's step-up kid is in root.keys
      fingerprint: string; stepUpKid: string;                                         // for `root add`'s confirmation
      due: boolean; ageDays: number | null;
      pending: { version: number; fork: boolean } | null;
      offer: { superseded: number } | null;                                           // keys the superseded states added
      owing: Array<{ version: number; machines: string[] }>;
      rekey: 'unmarked' | null; oldDevice: string | null;                            // oldDevice: still listed after a rekey
    } | null;                                                                         // null until a head is held
    // commands: 'org.resign' (void → SignResult), 'org.revokeSuperseded' (void → SignResult),
    //           'org.rekey' ({code} → {ok: true} | {ok: false, reason: OrgRefusal}), 'org.discardPending' ({confirmed: true} → {ok, reason?}),
    //           'org.resetSigning' ({confirmed: true} → void)
    // SignResult = {ok: true, version} | {ok: false, reason: 'not-root' | 'unmarked' | 'signing' | 'cancelled' | 'pending' | 'invalid' | 'hub' | 'busy' | 'refused', detail?}

    // §C gains
    signing.json     { "version": 1,
                       "pending": { "signed": SignedOrgState, "parent": "<stateHash>", "exposed": { "hub": <boolean>, "machines": ["<ref>"] } } | null,
                       "deliveries": [ { "hash": "<stateHash>", "signed": SignedOrgState, "owed": ["<ref>", …],
                                         "known": { "<ref>": { "version": <n>, "line": "<digest of the accepted transitions held>" } }, "probed": { "<ref>": <line> }, "tooLarge": ["<ref>"] } ],
                       "abandoned": [ { "hash": "<stateHash>", "version": <n>, "hub": <boolean>, "machines": ["<ref>"] } ],
                       "lastAsked": "<ISO>" | null, "lastNotified": "<ISO>" | null }      // fails closed once registration.json says signing: true
    registration.json  gains "signing": true (once signing.json is first written) and "rekey": { "device": "<new id>" } (during a rekey's promotion)

**§L. Owners and the People toggle** (M5).

    // src/shared/org/member-name.ts
    export function memberName(email: string): string;                                // the local part's first run of letters, capitalized
    export function memberNames(members: ReadonlyArray<{ id: string; email: string }>): Map<string, string>;   // collisions → whole local part

    // src/shared/ipc/schema/org.ts
    export interface OrgMember { id: string; email: string | null; name: string }    // email null: an id the head doesn't list ("former member")
    // OrgRows gains `members: OrgMember[]` (every member id some row's owners name) and `member: string | null` (the signed-in member, null signed out)

    // src/shared/ipc/schema/layout.ts: LayoutKeySchema gains z.literal('sidebar.people'); value { version: 1, on: RowKey[] }

    // renderer
    export function ownersLabel(owners: readonly string[], me: string, members: ReadonlyMap<string, OrgMember>): string | null;   // sidebar/owners.ts
    //   stores/people.ts: usePeople { on: ReadonlySet<RowKey>; toggle(key: RowKey): void; load(): Promise<void> }
    //   sidebar/derive.ts: projectList(…, people: ReadonlySet<RowKey>); ProjectEntry gains `others: number`

**§M. The Org page** (M4a).

    // apps/org-protocol/src/org-state.ts (desk-track reviewed)
    export type Problem = { code: string; detail?: string };
    export function stateProblems(state: OrgState): Promise<Problem[]>;          // stateInvariants(s) === (problems.length === 0)
    export function successorProblems(before: OrgState, after: OrgState, opts?: { endorsing?: { kid: string; devices: string[] } }): Promise<Problem[]>;   // ordinary successors only
    export type PendingEntry = { /* the judges' structural input, package-owned */ };
    // apps/org-protocol/src/pairing.ts: judgeEntry, entryDevice, isPairedDeviceId, isRpId (moved from deploy/admin.ts)

    // src/shared/ipc/schema/org.ts
    export type OrgView = {
      version: number; issued: string; maySign: boolean; recoveryKid: string;
      members: { id: string; email: string; name: string; role: 'admin' | 'member'; you: boolean;
                 devices: { id: string; class: 'native-mac' | 'web-cards'; keyStorage: string; root: boolean; thisMac: boolean; fingerprint: string }[] }[];
      machines: { name: string; ref: string; owners: string[] | 'org' }[];          // up or not: the renderer's useMachines
      roots: ({ kid: string; member: string; device: string } | { kid: string; unlisted: true })[];
    };
    export type OrgChange =
      | { kind: 'member.add'; email: string; role: 'admin' | 'member'; id?: string }   // id set by the preview
      | { kind: 'member.remove'; member: string } | { kind: 'member.role'; member: string; role: 'admin' | 'member' }
      | { kind: 'member.email'; member: string; email: string }
      | { kind: 'device.remove'; member: string; device: string } | { kind: 'root.add'; member: string; device: string };
    // org.view: void -> OrgView | null
    // org.preview {change}: {ok: true, change, lines, warnings, digest} | {ok: false, reason, findings}
    // org.change {change, digest}: SignResult (stale on another digest)
    // org.pair.start {member, class: 'native-mac' | 'web-cards'}: {ok: true, code, expires} | {ok: false, reason}   (the code only here)
    // org.pair.approve {generation, digest}: SignResult;  org.pair.cancel: void
    // OrgStatus registered gains pairing: {generation, member, class, expires, entry: {id, class, keyStorage, fingerprint, digest} | null,
    //   problem: 'two-entries' | 'entry-changed' | 'expired' | 'not-admin' | 'no-member' | null} | null
    // OrgRefusal gains attempt: 'register' | 'reanchor' | 'signIn' | 'rekey'

    // src/main/org/signer.ts
    export type Edit = { summary: string; lines: string[]; endorse?: { member: string; device: string }[]; apply(draft: OrgState): void | Promise<void> };
    // src/main/device/step-up.ts
    //   StateSigner.sign(state, prompt, {endorse?, live?}): one confirmation; cancelled if !live(); then endorseDevice for each named device, then signOrgState
    // Edit gains live?(): boolean, checked at apply, after the confirmation, and before the slot's write
    // src/main/org/held.ts: HeldOrg.close(): Promise<void>   (fences the adoption queue, resolves at its tail)

    // src/main/org/timing.ts: PAIR_TTL_MS 600_000, PAIR_POLL_MS 2_000

**§N. The project channel's reader** (M7a).

    // src/shared/ipc/schema/org.ts
    export type ChannelEntry =
      | { kind: 'words'; offset: number; member: string; name: string; to: '*' | { session: string; alias: string }[]; text: string; at: string;
          sending?: true; refused?: string }
      | { kind: 'exchange'; offsets: number[]; between: [ChannelParty, ChannelParty] | [ChannelParty, 'everyone']; count: number; first: string; last: string }
      | { kind: 'say'; offset: number; from: ChannelParty; to: '*' | ChannelParty[]; text: string; at: string; owners: string[] }
      | { kind: 'host'; offset?: number; id?: string; party: ChannelParty; host: 'message' | 'question' | 'answered'; text: string;
          choices?: string[]; at: string; asOf?: string };                                       // M7b fills `id`/`asOf`
    export type ChannelParty = { session: string; alias: string; title: string | null; machine: string | null };
    export type ChannelLabel = 'verified' | 'migrated' | 'legacy';                              // each entry carries one, `migrated` with `by`
    // org.channel.open {project} -> {ok: true, entries, label: Record<offset, …>, unverified: number, asOf: string | null, live: boolean} | {ok: false, reason: 'signed-out' | 'no-hub' | 'unknown-project'}
    // org.channel.close {project}; org.channel.send {project, text} -> {ok: true, nonce} | {ok: false, reason}
    // org.channel.changed {project, …the open answer}   (event)

    // src/shared/ipc/schema/layout.ts: TabRefSchema gains { id: `channel:${project}`, kind: 'channel', project, pinned: boolean }

    // src/main/org/channel/project-socket.ts
    export function openProjectSocket(deps: { hub: () => HubAccess | null; project: string; after: number;
      onLog(events: LoggedEvent[]): void; onCaughtUp(offset: number): void; onAnswer(a: HumanAck | HumanRefused): void; onClosed(code: number): void }): { send(human: DeviceHuman): void; close(): void };

**§O. To-human entries across machines** (M7b).

    // the spine (src/services/channel/register.ts): machine commands
    // channel.history {project, before?: string, limit?: number (≤ 200)} -> {entries: HostEntry[], more: boolean}
    // channel.changed {project, entry: HostEntry}                                              (event)
    export type HostEntry = { id: string; project: string; appSessionId: string | null; engineSessionId: string | null; lane: 'A' | 'B';
      kind: 'message' | 'question' | 'answered'; text: string; choices?: string[]; at: string; src: string };
    // src/mawsd/endpoint-seam.ts: EndpointServices.channel: { record(entry: Omit<HostEntry, 'id'>): void }
    // src/endpoint/offers.ts: 'channel.history' (each-session, view-filtered), feeds += 'channel'

**§P. Reader state per member** (M6a).

    // src/services/index/migrations.ts (two ADDED_TABLES entries, revised 2026-11-06)
    reader_state  (app_session_id, member, pinned, last_seen_uuid, last_seen_at, unread, PRIMARY KEY (app_session_id, member))
    member_drafts (app_session_id, member, doc, attachments, updated_at, PRIMARY KEY (app_session_id, member))
    // the router's command context gains reader?: 'owner' | MemberId   (absent: 'owner')
    // revised 2026-11-07: a new machine command, never the record (WIRE_MINOR 31)
    session.reader.update {appSessionId, patch: {pinned?, lastSeen?, unread?}} -> ReaderState {appSessionId, pinned, lastSeen, unread}
    // session.update stays local and is refused with any reader (amended 2026-11-13 by the UX wave, U9: an unarchive alone is taken; Decision Log "M6a Task 1's fork", 5)
    // src/endpoint/offers.ts: 'session.reader.update' (list), 'session.drafts.get' and '.set' (converse)
    // a non-owner's device never receives the owners' reader fields: every record the endpoint sends them, answer or event, carries their own

**§Q. Visibility and shares** (M6b; O18's Interfaces §D).

    // the act (device -> endpoint): no `session`, no `context`; stepUp 'required'
    { action: 'record.access', args: { session: <lane A engine id> } | { appSessionId: <lane B app session id> } & { access: 'private' | 'listed' | 'org-view' | 'org-converse' } }
    { action: 'record.shares', args: <target> & { member: MemberId; grade: 'list' | 'view' | 'converse' | 'approve' | null } }
    { action: 'record.owners', args: <target> & { add: true; member: MemberId } }                                  // M5b's
    // the call: record.policy {session?} (manage) -> {supported: false} | {supported: true, policies: Array<{session, access, shares, policyRev} | {session, unavailable: true}>}

    // the frame (endpoint -> sminos): RL10's rpc
    { t: 'rpc', rpc: { rpc: 'record.access' | 'record.shares' | 'record.owners', project, machine, member, device, created, nonce, opId, opCreated,
        args: { session: <sid>, …the change }, fingerprint, proof: <the act verbatim> } }
    // <sid>: the id that keys sminos's record; lane B's through members.ts's join; unplaced -> refused 'no-session', nothing sent
    // gated by sminos's RL10 hello capability 'record'; sminos's target_of is {session: args.session}, a session of a hub project joined from this machine
    // the endpoint's RL10 welcome to sminos (today capabilities ["access", "reach"]) gains 'record' exactly when this build serves the three record.* offers, headless machines too:
    //   "this machine's sessions can be widened from any member's MAWS through this endpoint"; sminos 1.39.0 keys its "use MAWS" cutover on it (sticky across the endpoint's absence,
    //   lifted only by a later welcome without it); test/endpoint/rl10/conversation.json's welcome lines change, and the desk track gets the new blob hash and lines by sminos say before M6b's PR
    // outcome: done {changed, policyRev} (changed: false is a no-op, no revision); refusals shown: no-session, unsupported, bad-shape, read-only (sminos);
    //   stale, expired, tombstoned (the ledger); not-offered, no-session (endpoint); cancelled (step-up)

    // the local door: src/mawsd/endpoint-seam.ts EndpointModule.local { act(action): Promise<Outcome>; call(name, input): Promise<unknown> }
    //   machine-socket commands 'endpoint.local.act' (the three record.* acts only; step-up verified unconditionally; member from the device's one head entry)
    //   and 'endpoint.local.call' (record.policy only, as the machine owners' member)

    // src/main/org/policy.ts: org.policy.get {address} -> OrgPolicy; org.policy.set {address, access?, shares?, policyRev} -> {ok, results: Outcome[]}
    // src/main/machines/remote/acts.ts: actMany(requests) under one confirmation; src/main/device/step-up.ts: signActions
    // RemoteRow gains audience?: string[]; policyRev?: number

**§R. Machines and grants** (M4b).

    // apps/org-protocol/src/enrollment.ts: encodeEnrollmentCodeV2, decodeEnrollmentCodeV2, EnrollmentCodeV2 (moved)
    // apps/org-protocol/src/machines.ts: certificateViews, resolveMachine, machineRows, MachineRow (moved)
    // OrgChange gains machine.add {name, ref, pub, owners} | machine.replace {ref, pub} | machine.owners {ref, owners: MemberId[] | 'org'} | machine.drop {ref, revoke: boolean}
    // org.enroll.start {name, replace?: ref} -> {ok: true, code, expires} | {ok: false, reason}; org.enroll.approve {generation, digest}; org.enroll.cancel
    // OrgStatus.registered gains enrolling: {generation, name, expires, candidate: {name, ref, keyId, digest} | null, problem} | null
    // org.grants.view {ref} -> {grants: {member, rights, version, state: 'on-machine' | 'pending' | 'refused'}[], missing: number, asOf}
    // org.grants.set {ref, member, rights} -> SignResult-like; org.grants.regrant {ref, digest}
    // src/main/device/step-up.ts: RecordSigner.sign(domain, body, prompt, {live?}) -> {ok: true, signed} | {ok: false, reason: 'cancelled'}
    // <userData>/org/grants.json {version: 1, issued: [{signed, delivered: 'pending' | 'done' | {refused}, op?}]}
    // src/endpoint: 'endpoint.grants' (machine, list) -> {members: [{member, grant: Signed<Grant> | null, highWater: number}]}: the caller's; every member's for an owner (an admin for 'org')
    // apps/org-protocol/src/records.ts: grantProblems(state, certificates, body: Grant, signerKid) -> Problem[]   (verifyGrant = grantProblems, then the signature)

**§S. Delegations** (M4c).

    // apps/org-protocol/src/delegations.ts: prefixProblem, mintDisagrees (moved); successorProblems gains prefix-equal | prefix-nested | prefix-covers
    // OrgChange gains delegation.add {…the delegation} | delegation.renew {id, expires} | delegation.drop {id}; org.change and its preview refuse delegation.add (only the create transaction composes it, as only enrollment composes machine.add)
    // apps/org-protocol/src/delegations.ts also holds MIN_/MAX_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_USES, NO_USE_CAP, NEVER_OFFLINE (desk-hub's identity.ts re-exports them)
    // org.delegation.create {label, prefix, ttlDays, maxUses: number | null, owners} -> SignResult & {secret?: {version, createTime}}   (SignResult's reasons gain 'secret-store')
    // org.delegation.rewrite {id}; org.delegation.renewHub {id}; org.delegation.revokeHub {id}   (revokeHub also takes a stray key's id)
    // OrgView gains delegations: {id, prefix, owners, expires, maxUses, machines: {ref, name, live}[], hub: {expires, uses, revoked: boolean} | null,
    //   state: 'in-effect' | 'unsent' | 'dropped', unsent: {rewrite: boolean, problem: string | null} | null, hubBehind: 'renew' | 'revoke' | null}[]   (revised 2026-11-08)
    // OrgView gains strayKeys: {id, prefix, label, created, expires}[]: hub keys unrevoked and unexpired that no head delegation, revoked holder or unsent slot names
    // the destination: main's own <profile>/provisioning-secret.json {version: 1, provisioningSecret: {project, secret, account} | null}, not a settings section (O7 M9; revised 2026-11-08)
    // org.provisioningSecret.get -> value | null | {damaged}; org.provisioningSecret.set {…} | null; org.provisioningSecret.reset (removes a damaged file; confirmed)
    // Edit gains hold?: {kind: 'delegation', id} (Unsent), and a held sign answers HeldSigned {ok: true, version, hash}, never through signResult; signing.json's pending gains unsent: {kind: 'delegation', id} | null (files.ts's type and validator;
    //   never posted by settle, delivery placement or weekly; renamed from `held`, which the signer's refusal reasons already use for "the chain holds it", revised 2026-11-08)
    // OrgSigner gains publishHeld(hash): Promise<SignOutcome>   (under the signer's exclusive operation: one pure update clears `unsent` for the slot whose stored hash is `hash`, only for the run that held it (an in-memory {hash, epoch}); then the normal post path)
    // DiscardOutcome's ok gains marker: Unsent | null (the IPC answer leaves it out)
    // the desk track's route (branch p5-hub-key-renew; the architect lands it): POST /api/provisioning-keys/<id>/renew, admin-only, no body
    //   200: the key exactly as GET /api/provisioning-keys lists it (the bare record, not {key}), delegation included; `expires` is the head delegation's string verbatim
    // POST /api/provisioning-keys answers 201 {key, token} (hub-client checks 201, not any 2xx); GET lists revoked keys too; DELETE answers 200 {revoked: id}, a soft revoke that keeps the record listed
    //   403 not-admin | 404 unknown-key | 410 key-revoked | 410 key-expired (an elapsed key is never revived)
    //   409 not-renewed: the head has no delegation with that id, or its expires isn't later than the hub's (submit the state first; the half-done case, retried with the route alone)
    //     it also answers a renewal already applied (equal expires): the app reads GET and takes equality as done (revised 2026-11-08)
    //   409 too-long: past now + MAX_PROVISIONING_KEY_TTL_S (checked in the app before signing: `renew-past-cap`)
    //   503 hub-updating: retryable, not a failure of the renewal
    // a delegation's expires is always ISO millis: no "never", so the sheets offer no "no expiry" choice

## Open questions for the owner

Each is built as its recommendation when its milestone is re-planned, unless the owner answers otherwise. M1 and M2 build only Q7's recommendation, and pre-empt the rest.

- **Q1. The Org page** (M4). *Recommendation:* one Settings section, Org, grown from M1's, in four groups:
  - **You**: this Mac, your other devices, and the hub sign-in with its renewal;
  - **People**: members with role and devices, and Add person;
  - **Machines**: name, owners, online, rights, and "Enroll a machine" giving a code;
  - **Org**: the state's version and age, the roots, the recovery key's id, and revocations still owed.

  Each change opens a sheet that shows exactly what will be signed and asks Touch ID. *Alternatives:* a dedicated Org tab outside Settings, with more room for a page opened rarely; or machines managed from the sidebar's machine rows, closer to where machines appear but splitting administration across two places. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
- **Q2. Owners on rows** (M5). *Recommendation:* show owners only where they aren't just you. Your own sessions look as today. A session someone else owns, or you co-own, shows first names after the title in the chip's secondary style ("Ana, Ben +3" past two), and the hover card lists them all. This rewords P5 acceptance 11's "every session row shows its owners" to "every row of a session you don't own alone", for P5's writer. *Alternatives:* an owner chip on every row, as acceptance 11 is worded; avatars. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
- **Q3. The per-project toggle** (M5; O6's T6). *Recommendation:* a "People" toggle on the project row's hover and in its menu, off by default and remembered per project. When it is on, others' sessions join the list in activity order, each with its owner. While it is off, the project row says "+N others", faint, only when there are any. *Alternatives:* one toggle in the sidebar's header for every project; others' sessions in an "Others" group under each project. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
- **Q4. Visibility and shares** (M6). *Recommendation:* a Share sheet from the session's header and its row menu, shaped like a shared document's:
  - General access: Private, Listed (the default), Org can view, or Org can talk, each with one line on what it means;
  - People, each with View, Converse or Approve, and Add person;
  - Touch ID on save;
  - with Private, the line that the messages its agent sends other agents stay readable across the org (RL §6.2).

  A row whose access isn't the default shows a small lock or people mark. *Alternatives:* visibility only in the session's info panel; a default per project. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]** *Amended by O18 (P5 Decision Logs 223, 224; 2026-11-06): People gain Can message (the `list` grade), and the Private line becomes "a private session's agents talk only within its audience; what was already shared stays shared" (M6b).*
- **Q5. The project channel** (M7). *Recommendation:* a tab opened from the project row (a "Channel" item), reading like the desk's group chat:
  - one stream for the project across machines;
  - each to-human message as an entry with its session's title and machine chip;
  - questions and permission cards inline and answerable there (owner, P5 Decision Log 11);
  - agent-to-agent traffic folded to one row per exchange ("3 messages between maws-45 and ci-opt"), opening on a click;
  - people's own messages with a composer at the bottom, once words are v2 (after O14's last machine);
  - an offline machine's entries from the cache, with "as of" its time;
  - migrated events labelled "attested at migration by `<machine>`".

  *Alternatives:* one inbox across projects, filtered by project; agent-to-agent traffic shown unfolded. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
- **Q6. The signer's prompts** (M3, M8). *Recommendation:* the weekly successor asks once, with Touch ID, at the first focus of the app after the head turns 7 days old: a quiet line in the Org section and one notification, never more than once a day. Making the app a root, and later ending the deployment admin, are guided flows in the Org page, each step named. *Alternative:* re-sign only once the head nears 21 days, with fewer prompts and less margin before the 30-day backstop. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
- **Q7. Renewing the hub sign-in** (M1, built as recommended). *Recommendation:* one browser trip each time the Access session ends (720 h on staging), shown in the Org section and as one notification; Cloudflare's team-wide org token discarded. *Alternative:* keep the org token as `cloudflared` does, so the app renews with no browser, at the cost of holding a credential that signs you in to every Access application of the team, not only the hub. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**

## Surprises & Discoveries

- Observation: O14 runs its verbs on the deployment admin through its final brief, so the deployment admin can't be revoked when the app's device first becomes a root, as P5's O8 acceptance reads.
  Evidence: P5 Decision Log 75 (1): "O14 administers production's org state through verbs on O13 M2's `deployment admin` (`show`, `enroll`, `delegation create` and `drop`, …, `keys retire` and `purge`, …) … and leaves the admin device's revocation to O8".
- Observation: on the MacBook a `remote:` checkout has no `smnsId` until this machine's endpoint enrolls, so a join by stored `smnsId` would find nothing for most projects.
  Evidence: `src/main/index/org-project.ts`: `export function machineEnrollment(): Enrollment | null { return null; }`; `smnsId: enrollment ? repoProjectId(enrollment.org, key) : null`.
- Observation: the hub lists pending device entries only to their own member, so no admin can see a second member's new device.
  Evidence: `apps/desk-hub/src/objects/registry.ts` `pendingDevices(member)` → `this.chain.pending(member.id)`.
- Observation: a stored machine certificate changes no state version and sends no app frame.
  Evidence: `Registry.storeCert` returns `this.records.storeCert(…)` with no `toApps`; only `submitState` and `storeListing` call `toApps`.
- Observation: an answer from the Worker always carries `X-Desk-Build` (but a `101` or an event stream), so an answer without it is Access's.
  Evidence: `apps/desk-hub/src/worker.ts` `fetch`: `named.headers.set('X-Desk-Build', BUILD)` for every response but status 101 and `text/event-stream`.
- Observation: RL6's listing carries no holder, so O9's R3 ("holder a terminal") can't come from a listing.
  Evidence: `apps/org-protocol/src/types.ts` `Listing.fields: { owners, project, lane, state, title }`.
- Observation: sminos sends no `access` or `shares` yet, so no session is private and the hub's listings hold every session today.
  Evidence: `sminos_uplink.py` `member_frame`'s docstring: "O8's `access` and `shares` are not sent yet."
- Observation: `endpoint.listings` already serves a member's listings over a channel, private ones included, so the private path of RL §6.2 exists on the endpoint's side.
  Evidence: `src/endpoint/calls.ts` header: "`endpoint.listings` answers the signed listing of every session on the machine the member holds `list` or more on … A `private` session's listing leaves the machine only so".
- Observation: the root set is the admin devices' step-up keys, so every org state the app signs is a step-up signature, behind Touch ID.
  Evidence: `types.ts` `root: { keys: string[] … }` ("the kids of admin devices' `stepUpPub`"); `admin.ts` `signOrgState(next, [keys.stepUp])`.
- Observation: U9's spike captured the transfer but not the hub answering `/api/me` through `cf-access-token`; M1's staging check is its first capture.
- Observation: a chain `verifyRewind` admits can fail `verifyPinnedChain` against the pins it was registered under, when the recovery rewinds below the first state those roots signed; so a held chain is checked at load from its anchored genesis, not pinned again.
  Evidence: the first buildability round's read-only probe against `apps/org-protocol` (initial pinned run ok; `verifyRewind` and `verifySuccessor` ok; reload `not-root-signed`).
- Observation: a removed member's app can't read the state that removed it from the hub.
  Evidence: `Registry.submitState` closes the removed members' sockets with `4403` after rebuilding `members`, and the Worker's `route` resolves the member before any `/api/*` route, answering `403 not-a-member`.
  Evidence: O11's Surprises (2026-10-27): "Not captured: `/api/me` with that token, and renewal without a browser."

- Observation: an adoption moves `HeldOrg.head()` in memory before the anchor's write and the listeners, so a reader polling `head()` can see a new head before `onChanged` fires.
  Evidence: held.ts `#commit` (the file, then memory, then `saveAnchor`, then the listeners); `test/org/sign-in.local.test.ts`'s refresh case first raced on it.
- Observation: the Worker refuses a removed member's socket upgrade `403 not-a-member` with `X-Desk-Build` (its member resolution runs before every route), so a refused upgrade tells Access's end of a credential from the hub's refusal by that header.
  Evidence: `apps/desk-hub/src/worker.ts` `route`: `if (!principal) return json(403, { error: … 'not-a-member' … })`, then `fetch` names the build on every answer but a `101`.
- Observation (M3, 2026-10-28): a device id is a base64url key id, so about one id in 64 starts with `-`. A CLI that parses options (`parseArgs`) then reads such an id as an option. Any CLI that takes a key id has this trap. The fix puts ids after `--` everywhere M3 passes or prints one:
  - the O8 suites and their shared harness;
  - the Org section's `root add -- <id>` and `remove-device -- <old id>`;
  - the deploy README;
  - the staging and production wrappers, which appended their own `--config`/`--keys` after `"$@"` and now put them first.
  Evidence: class 1a run 40768996939 at b92b07573: `remove-device: … Unknown option '-y'` in `signer.local.test.ts`'s rekey case, which had passed at 559ddfc0c with another random id. Fixed at 031c476da and in the wrapper commit after it.

- Observation (M5, 2026-10-28): `stores/summary.ts`'s `load()` has no production caller, so `summary.sections` is written but never read back; collapsed summary sections reset at each launch. M5's People store is loaded from `App.tsx` instead.
  Evidence: `grep -rn "getState().load()" src/renderer/src`, outside tests, finds no summary caller.
- Observation (M5): `App.test.tsx` runs in the `renderer-timing` vitest project, not `renderer` (`vitest.config.ts:57`).
- Observation (M4a Task 2, 2026-10-29): before `successorProblems`, a machine posting a key another machine already held (the hub doesn't check) made `enroll` sign a successor the package refuses. The admin kept it pending, the hub answered `409 malformed`, and every later verb failed until `abandon-pending`. It is now refused before anything is signed.
  Evidence: the admin test's RED run in Task 2 (`m4a-task-2-report.md`).
- Observation (M4a Task 5, 2026-10-29): the first version of the signer's close test was itself flaky. Its "before" listing was taken while the prior adoption's anchor write was in flight (a `.tmp` entry, 4 against 3). The listing is now taken after `close()` resolves, which is what the spec asserts; the fence is shown by the head staying put in memory and in `chain.json`.
  Evidence: `m4a-task-5-report.md`, Discoveries; `org-session.test.ts` 20 runs in a row clean with both workarounds removed.

- Observation (the re-plan, 2026-11-06): new to-human entries are no longer in the hub's log. On a cut-over machine sminos writes them to a machine-local host store (lane A), and lane B's are derived from transcripts by the owner service. The project channel's to-human half is therefore per machine, which is why M7 split.
  Evidence: doperpowers `sminos.py:5370-5389` and `:6036-6079` (`projects/<id>/host/<machine>.<session>.jsonl`); `src/shared/ipc/remote-unavailable.ts:76-80` (`ownerChannel.*` remote-unavailable); `src/renderer/src/owner/report/project.ts` (to-human rows from the transcript).
- Observation (the re-plan): a listing carries neither `access` nor `shares`, only a private channel listing's `audience` and `policyRev`, so the Share sheet needs its own read.
  Evidence: `apps/org-protocol/src/types.ts:113-120`; `src/shared/ipc/schema/org.ts:222-235`.
- Observation (the re-plan): the app has no act path to its own Mac's endpoint. The roster excludes the local ref, and the direct listener binds only tailnet addresses.
  Evidence: `src/main/machines/remote/source.ts:47-56`; `src/endpoint/direct-listener.ts:1-5`; `src/mawsd/endpoint-seam.ts:73-79`.
- Observation (the re-plan): the reader state is still session-wide in the spine's index, and remote lane B marks and drafts live in renderer memory for one run.
  Evidence: `src/services/index/migrations.ts:46-60`; `src/renderer/src/lane-b/read-marks.ts:1-35`; `src/renderer/src/composer/editor/drafts.ts:76-95`.
- Observation (the re-plan): an in-place `--replace` enrollment keeps the endpoint's accepted grants, so "a re-enrolled machine refuses every old grant" (the M4b facts of 2026-10-29) holds only for a machine whose ledger is lost.
  Evidence: `src/endpoint/enroll.ts:208-225`; `test/endpoint/enroll.test.ts:164-195` ("a grant in force kept").
- Observation (the re-plan): the hub's provisioning key has its own `expires`, and no route renewed it, so a renewal in the state alone left new VMs refused `410 key-expired`.
  Evidence: `apps/desk-hub/src/objects/provisioning-keys.ts:59-119`; `worker.ts:233-242`.
- Observation (the re-plan): no record shows M3's root-add sitting on staging or production. The prepared steps are in the report, and Outcomes still owes it.
  Evidence: `2026-10-28-p5-o8-report.md:195-237`; this document's M3 Outcomes; P5 Decision Log 155 ("dormant until the owner's `root add` sitting").
- Observation (M6a's design): two members who both own a machine share its owners' reader state, because the index can't tell which owner sits at a device.
- Observation (M7a Task 1): the hub's `fanOut` sends a member's own `human` back to the socket that sent it, so words come back through the log after their `human-ack`. `words.logged` also clears a word whose nonce appears in the log.
  Evidence: `apps/desk-hub/src/objects/project.ts:1577-1586`.
- Observation (M7b Task 1): a numbered migration for a new table cost a downgraded build its whole index. The cross-build downgrade scene caught migration 16, so the journal became an `ADDED_TABLES` entry (`IF NOT EXISTS`, `user_version` stays 15), the rule for any table no earlier build reads, M6a's included.
  Evidence: Decision Log, M7b Task 1's `ADDED_TABLES` ruling; run 42292712838.
- Observation (M7b Task 1): IPC event names had no main-only list, so `channel.changed` was bridged to every renderer window by default until `mainOnlyEvents` was added.
- Observation (M7b Task 2): `INTEGER PRIMARY KEY` reuses a pruned maximum id, so opaque cursors needed `AUTOINCREMENT`; and the `channel` feed needed an `apps/org-protocol` hunk the spec hadn't foreseen (`MachineFeed`).
- Observation (M7b's final gate): `e2e/library.spec.ts` rewinds the index to version 9 from a template built by the numbered migrations plus `ADDED_COLUMNS`, so an `ADDED_TABLES` entry the opener creates at any version was missing from the template, and the rewound index failed "is a version-9 index". The template now takes `ADDED_TABLES` too (9bb79f34e). Any later `ADDED_TABLES` entry is covered.
  Evidence: run 42344559621 (e2e:library, packaged 1/2 red), 42357252517 (green).
- Observation (M5b Task 1): `e2e/share.spec.ts:251` is a race in the test itself. A project row's hover card covered the People toggle before any session menu opened. It was red once on fea94bdaa and green on the rerun (42697938520), with master e181a1944 green as a control (42696748705). M5b reaches this spec, so Task 2 fixes the race (the architect, 2026-11-09).
  Evidence: e2e:settings on fea94bdaa; the friction tracker's entry by Task 1's executor.
- Observation (M8, step 7.2): a waiting `admin pair` reads the head when it starts and signs only once the app's entry arrives. On staging it read v358, the desk track's `real-member add` and scene then made v359 and v360, and `pair`'s successor at v359 was refused `409`. Recovery was `admin abandon-pending` and a second `pair`.
  Evidence: the sitting's record (the architect, 2026-11-10). Board #547, the desk track's, has a waiting admin verb re-read the head before it signs, or refuse with nothing pending.
- Observation (M8, step 1): the first `root add` refused "not made a root: nothing was signed" (exit 1) after the owner typed `y`. `confirm` (`deploy/admin.ts`) read a line through `readLineFrom` (`deploy/terminal.ts`) that was neither `y` nor `yes`, and what it read is unknown. Nothing was pending, and the head stayed at 22. The second try, in a fresh Terminal window, signed version 23.
  Evidence: `~/.local/state/desk-hub-production/admin-root-20261110T052506Z.log`. #547 gains an item: a refused confirmation says what it read, in hex.
- Observation (M8, step 1): the Org page offers Re-sign now only while the weekly successor is due (`settings-tab/org/OrgGroup.tsx:164`, `weekly !== null`). The state was 0 days old, so the script's "Re-sign then asks Touch ID" couldn't run. The removal at step 3, signed by this Mac, proved that it signs.
  Evidence: the page as the architect read it through `cua_repl`, 2026-11-10.
- Observation (M8, step 7.6): the first scene was torn down before the owner's relaunch, so the relaunch check ran on a second scene, and the owner typed B's address a second time.
  Evidence: the sitting's record. The second scene was machine `o18-a1-1c80f2` at v365, with B re-added as `166912a7…` at v364.

## Decision Log

- Decision: Verification. This document gets one `doperpowers:adversarial-reviewer` buildability round on its execution section, focused on the first milestone (M1 and M2), repeated until a round yields nothing worth changing. M1's and M2's PRs each get doperpowers:reviewer-high. M3–M8 each get their own buildability round when re-planned, and the review rung their re-plan names.
  Rationale: M1 is the device side of the org's trust (a pinned chain, a registered device, a bearer credential) and M2 decides what the app believes about other machines; the advisory milestones can't be reviewed for buildability before their dependencies and the owner's answers exist.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The first buildability round (doperpowers:adversarial-reviewer on 4362ed440: 3 P1 and 4 P2, each checked against the code and adopted) is folded in. (1) A recovery that rewinds below the state the code's roots first signed made the held chain fail `verifyPinnedChain` at every later load; the reviewer reproduced it against the package. The registration now keeps an anchor, and the load checks one run from the anchored genesis. (2) A damaged chain re-read from genesis would have lost rollback protection; it now fails closed unless the hub's chain reaches the anchor. (3) Deleting a withdrawn listing deleted its replay barrier; each key now keeps its high-water revision and `gone` record, persisted. (4) Lane A's plane presence is not a `SessionRecord`; M2 no longer names one, and the gap is finding F8. (5) The roster was read as listings coverage; `OrgRows.complete` now gates a machine's loading. (6) A removed member can't read the state that removed it; that is now `denied`, with no trust change, and H3 is asked of O11. (7) Sign-out's token deletion came before its marker; the marker is now the commit point, and a running sign-in is fenced. Tests for each are named in M1's and M2's Proves.
  Rationale: each finding was real against the code (`org-view.ts` `verifyPinnedChain`, `admin.ts` `verifiedHead`, `src/endpoint/listings.ts`'s kept withdrawals, `SessionPresence`, `events.ts` `knownTab` and `layout.ts` `settleMachine`, `Registry.submitState` and the Worker's member resolution, O7 §B's `hub: null`). The verdict found O7's type seam and O9's listing fields aligned.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The second round (2 P1 and 4 P2 on 158416956, each checked against the code and adopted) is folded in. (1) Taking a served chain that a recovery rewound below the anchor needs the accepted transitions and the authenticated base the damaged file held; the reviewer showed an old genuine recovery passes `verifyRewind` with an empty barrier. That exception is gone: a damaged chain reopens only on a served chain holding the anchored state, or by re-anchoring. (2) A count cap on listing marks let an old revision return; marks now drop only when their machine leaves the org or their signing key is no longer the machine's. (3) The anchor's two-file commit broke a rewind cut by a crash; the load rule now accepts an anchored state recorded as superseded by a verified rewind, and `startHeldOrg` takes the anchor and `saveAnchor`. (4) Re-anchoring had no path; `org.reanchor` is the one way out of `held-chain`, with its own field and button there, and `register` and `signIn` never move the anchor. (5) A mark at an equal revision hid an unchanged live row; equality is now by the record's hash, and a different record at that revision is a conflict. (6) The snapshot's last page could arrive before the state that verifies it; `complete` now waits for the announced head, and `pending` keeps a machine with unverified records from loading.
  Rationale: verified against `org-state.ts` `verifyRewind` (its `accepted` barrier), `EndpointOrg.#rewind` and `#commit`, `records.ts` `verifyListing` (current keys only, no age), `Listings.#evaluate` (no re-sign when unchanged), and `Registry.fetch` (the state notice, then every listings page, at once). The verdict found the round-1 fixes for `denied` and the remote-record gap sound.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The third round, narrowed to the second round's fixes (1 P1 on 5b218cf3b, adopted), found that a mark dropped when `machineKeys` gives no key could be erased by the hub, which serves the certificate set: leave a delegated machine's certificate out for one refresh and the mark goes, then serve it again and replay an older revision. Marks now drop only on signed evidence in the held head, and the mark keeps its certificate's delegation id. The round found the anchor, load, re-anchor, equal-revision and coverage rules sound.
  Rationale: reproduced by the reviewer against `machineKeys` and `verifyListing` (verifies, `not-listed` with the certificate omitted, verifies again once restored, no state change); RL5 keeps a revoked or retired key, and a revoked delegation, from ever being current again.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The fourth round, narrowed to the mark rule (1 P1 on 8971bc166, adopted), found that a delegation's elapsed `expires` is not final: a renewal signed before the deadline verifies when it arrives after it, so a hub withholding it could erase a mark and then replay. The expiry branch is gone; marks drop only when the head puts their key in `revoked` or `retired`, or their delegation in `revoked`. The round found the omission and contest fix sound and nothing else in scope.
  Rationale: reproduced by the reviewer (`keysAccounted` admits the late renewal; the listing goes from `not-listed` to valid once it is adopted); `test/endpoint/rl10/review.test.ts` already holds an expired certificate for this reason.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The fifth round, narrowed to that fix, found nothing (approve at 2e5e6da22). The review has converged: rounds of 7, 6, 1, 1, then 0 findings, every one adopted.
  Rationale: the skill's stop rule; a round that yields nothing worth changing.
  Date/Author: 2026-10-28, O8's planner.

- Decision: `src/main/org/session.ts` is O7's, taken as it landed (#285 at ccdc14943): this branch copied it byte for byte from `p5-o7-m1` before O7 landed, so the merge was clean; main hands `startMachines` the production session, or O7's development session when `MAWS_DEV_ORG` is set in an unpackaged build, in which case no production session is made at all and `org.status` answers `development` from the development session's identity, every `org.*` act refused `busy`. `STANDIN_HEADER` is imported from `dev-session.ts`.
  Rationale: one org session per run: two would hold two feeds and allow a production sign-in beside a development one. Rejected: creating the production session in development runs too and only not handing it to `startMachines`.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: A token fresh from the login is given a grace: `/api/me` answered 401, 403 or a redirect without `X-Desk-Build` (Access, not the Worker) is retried at 2, 4, 8 and 16 s, then every 16 s, for up to `FRESH_TOKEN_GRACE_MS` (120 s), before the attempt is refused `access`; `cancel` ends the wait at once; a Worker's `403 not-a-member` (which carries `X-Desk-Build`) is never retried. Applies to registration, `signIn` and `reanchor`. (Architect accepted.)
  Rationale: staging answered a fresh Access credential 401 for 5 s to about a minute (O11 M8, via the desk track). Rejected: refusing at the first 401, which fails most first sign-ins on staging; retrying a Worker refusal, which is the hub's word and not a propagation delay.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: `org.*`'s event goes on the client side of the link surface (`CLIENT_RULES` gains `org`), and `routes.json` lists the six commands under `client`; after a merge that touches the registry, `routes.json` is regenerated (`MAWS_ROUTES_WRITE=1`), never hand-merged. (Architect accepted.)
  Rationale: `org.*` is this app's own state; `link-surface.test.ts` holds every event to one side. Rejected: a link event, which would offer another machine's app this app's sign-in status.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: Beyond Interfaces §B and §F: `ORG_REFUSALS` gains `directory` (`<userData>/org/` failed its checks, so a registration can write nothing), and `RegistryFeedHooks` gains `onClose` (an open socket ended), which the session reads as `hubAccess: 'connecting'`.
  Rationale: §B's `problem: 'directory'` had no refusal to give an attempt that meets it, and §F had no way to say the feed went down, so `connected` would outlive the socket. Rejected: overloading `keys` or `hub`; polling `feed.connected()` from the status.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: A registration with no readable `access.json` reads signed out, as one marked `signedOut` does; a token that ends by its clock or Access's answer keeps its file (so it reads `expired`, not signed out). Sign-out writes the marker first and removes the token even when the marker's write fails.
  Rationale: acceptance 1's "a failed marker write … starting signed out with no token used": with the token gone and no marker, the profile must not start signed in on the direct carrier. Rejected: reading a missing token as signed in with `hub` null, which brings the links up after a sign-out whose marker failed.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: Following the hub, the session reads `?since=<held version>`, and reads again from a served transition's `fromVersion` when one below the head is not held, or from genesis when the served head is below the held one; the certificate poll hands any served head at another version to that read.
  Rationale: `?since=<head>` leaves out the state at `fromVersion + 1` a recovery needs, so a genuine recovery would be refused as a rollback; the whole chain tells a rewind from a rollback. Rejected: `?since=<head>` alone (`EndpointOrg.sync`'s), which works for the endpoint only because its window keeps the base.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: The held view as built (held.ts), where §D or the load rule left room. `startHeldOrg` takes the org files (`files: OrgFiles`) rather than a path and no clock; it returns `{ok, held} | {ok: false, reason}`; `adoptServed` answers `certificatesChanged` too; `HeldOrg.highWater()` is added. The high-water mark is recomputed at load as the head's version (the anchor carries rollback protection across restarts). The load also checks that `accepted` holds every transition the run took. "Authorized" in the superseded case is both `verifyTransition(base, t, recoveryPub)` and `verifySuccessor(base, next, [t])`. Rollback and fork are judged only when nothing was adopted, as `EndpointOrg` does, so a recovery whose served head is below the mark is taken. The rewind's base is always the held state (the whole chain is held), never one a delivery carries. A failed anchor write after an adoption is logged, not thrown: `chain.json` holds the adoption, and the next load moves the anchor up. A recover from the hub writes a fresh file (`accepted` the run's transitions, nothing superseded).
  Rationale: each follows the rule it serves (the round-1 to round-5 findings); `verifySuccessor` alone falls back to the old root set when a transition fails to verify. Rejected: re-using a delivered base (the endpoint's path, which its window needs and this view doesn't).
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: The login transfer generates its box key from WebCrypto's random bytes (`nacl.box.keyPair.fromSecretKey`), not tweetnacl's own source, and does not check the metadata JWT's `iat` (cloudflared master refuses one missing, older than 24 h or 5 min ahead; §E doesn't list it). The stand-in admits `http://127.0.0.1:<port>` only, not `localhost` or `[::1]`.
  Rationale: tweetnacl's PRNG detection depends on how the CJS bundle rewrites its `typeof require`, and failing it throws at sign-in. The metadata arrives over TLS from the hub's own host, and the spike ran without the `iat` check; the staging sitting confirms the header's claims. Rejected: tweetnacl's `keyPair()`; adding the `iat` check before staging shows Access sets it.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: The Org section reads `org.*` itself and takes no props (so no prop can carry a token), and Sign out sits on the Account row. While approval waits, an unreachable hub or an unexpected answer keeps the poll going until `expires`; an Access answer refuses `access` and the Worker's `not-a-member` refuses `not-member`.
  Rationale: the other sections take the settings object; this one has its own data. Rejected: a row of its own for Sign out, which read as an empty label.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: M1's reviewer-high (round 1 at ef4bb83cb: 3 P1 and 5 P2, each verified and fixed). (1) Every durable write and trust change of the session runs in one serialized commit queue, each taking its registration snapshot at its turn and changing only its own fields, each attempt fenced inside the queue by its generation (and, for a re-anchor and a recovery, by the trust it started from): a sign-in's write can't roll back an anchor an adoption moved, a re-anchor's token can't land after a sign-out, and a recovery can't overwrite a re-anchored chain. Sign-out advances the generation and reads signed out at once, then queues its marker and the token's removal. Every `startHeldOrg` call takes a capturing anchor saver that forwards to the queued write once its view is held, so no queued operation waits on a view's adoption queue. (2) Production passes `excludeFromBackup` for `<userData>/org/` (no default inside the module, so no suite runs osascript). (3) The hub client keeps a response's `error` only in a short code grammar (else `unrecognized`), `/api/me`'s email only as an address, and a pending entry's `expires` only as an ISO instant, so a hostile hub can't reflect the bearer token into a refusal, a status or a log. (4) A served certificate set must pass `isCertificates`, and items that aren't signed certificates or retirements are dropped at the boundary (O7's `nextCertExpiry` reads them unguarded). (5) The feed keeps at most 4 incomplete part sets and 8 MiB of their text. (6) Every background read and adoption (the feed's callbacks, the certificate and recovery clocks) is caught and logged, the held state unchanged.
  Rationale: each was a concrete interleaving or input against the code; each fix has a test that fails without it. Rejected: per-write ad hoc fences (the round found three windows they left), a default exclusion inside `files.ts`, failing a whole state read for one malformed certificate.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: M1's review has converged: round 2 (reviewer-high on 59edeebe1, narrowed to the fix wave) found nothing material. Rounds of 8, then 0.
  Rationale: the stop rule; a round that yields nothing worth changing.
  Date/Author: 2026-10-28, O8 M1's executor.

- Decision: M2's rows source as built (rows.ts), where the document left room. One queue applies every event, starting with the cache's read, so nothing is judged before the persisted marks are held. Records a live `listing` frame brought since this open are kept even when the snapshot lacks them (a session listed after the snapshot was cut), and waiting records of keys the snapshot omits are purged at the last page. A held record that fails verification again leaves the rows and waits, its mark kept. The announced version is the highest `state` notice between the open and the last page. A change of signed-in org clears marks, rows and the waiting set. The cache is written only into an existing, checked `org/` (never created by the rows). A mark's delegation id is the certificate whose key signed the record, when the head lists no machine entry for the ref. The hash is base64url, the package's `B64`. Delegated rows are not re-verified on the clock alone; O7's roster drops a machine at its certificate's expiry.
  Rationale: the replace rule as written would delete a session listed after the snapshot; the rest follow the mark rule's rounds. Rejected: judging records before the cache's marks are loaded; deleting a re-failing record's mark.
  Date/Author: 2026-10-28, O8 M2's executor.

- Decision: M2's renderer as built. Listed rows merge by `issued` among the records the sidebar's sort leaves in recency order, after the records it puts first (pinned; under `priority`, waiting, unread or working). `ProjectEntry.sessions` stays records only, with a `listed` field and a sidebar-local merged `items` list carrying the order, search and caps. A listed row's `issued` counts toward its project's activity, and the project card's count includes listed rows. A row whose org key has checkouts but none the index lists goes nowhere (all hidden). With no opener, a click selects the row in the sidebar alone (not persisted, not a tab); listed rows are their own tree-node kind, so no record path opens them, and they carry no menu. A covered machine also skips the `engine.sessions` re-read at host ready, and is settled when it newly becomes covered, not at every rows event; an `org.rows` answer older than an `org.rows.changed` is dropped.
  Rationale: the existing sort and `ProjectEntry` readers; settling at every event would close tabs as listings churn. Rejected: a pure activity merge (a listed row above a waiting local record); ranking listed rows into the priority tiers (attention across machines is O7 M6's and O3's); a union `sessions` touching every reader; a persisted selection.
  Date/Author: 2026-10-28, O8 M2's executor.

The residue for P5's Decision Log. Each item is decided where it binds (M1 or M2 unless marked), with the alternative it rejected:

1. P5 Decision Log 92's first milestone is built as two milestones, M1 (the org session) and M2 (the remote rows), each its own PR. Rejected: one milestone, which holds O7 M1's production value until the rows are built and puts two verification strategies and two state owners in one review.
2. Sign-in starts from a pairing code, whose root pins anchor the app's chain; Access's login transfer runs against the code's hub. Rejected: Access alone, trusting the hub's chain on first use.
3. The device id is `keyId(channelPub)`. Rejected: a random id in a file of its own.
4. The Access app token lives in a 0600 file in `<userData>/org/` (excluded from Time Machine), and the org token is discarded; renewal is one browser trip per Access session (Q7). Rejected: the Keychain through `safeStorage`; keeping the org token for a browserless renewal.
5. Being signed in is the registration plus the head listing the device; the Access token gates only the hub, so an expired token sets `hub` to null and leaves the links on the direct carrier. Rejected: signing out when the token expires.
6. The held chain is kept whole, from genesis, with superseded states, under `EndpointOrg`'s adoption rules through the package's verifiers. Rejected: the endpoint's 30-day window; moving `EndpointOrg`'s adoption into `org-protocol` now. One shared adoption for the endpoint and the app is a debt row.
7. One Registry feed (`?app=1`) over whichever session `startMachines` holds, for state notices (M1) and listings (M2), with a 10-minute certificate read. Rejected: polling `GET /api/org/state` and `GET /api/listings`.
8. No keys, files or requests for a profile that never signs in: `loadDeviceKeys` first runs at registration. Rejected: making the keys at startup.
9. Removing a held registration (another org on this Mac) and re-keying are not built in M1; re-keying is M3's. Rejected: a Forget control in M1's least UI.
10. Rows are the hub's listings, verified against the held head, cached and verified again at load and at each head, for the machines of O7's RL2 roster. Rejected: `endpoint.listings` per link now (M6's, for private sessions).
11. Rows are a listed partition of the sessions store, not `SessionRecord`s; the lane that opens one supplies its record, and the row yields to it. Rejected: records and digests synthesized from listings.
12. A row's project joins an org key by `smnsId` computed with the signed-in org; a row whose org key names only hidden local checkouts is drawn nowhere. Rejected: waiting for `machineEnrollment()`.
13. A listed row opens through an opener its lane registers (O7 M2 for lane B, O9 M9 for lane A); with none, a click only selects it. Rejected: a placeholder tab; drawing rows only once openable.
14. Only the member's own rows are drawn in M2; other people's wait for the toggle (M5, Q3). Rejected: drawing every listing.
15. The deployment admin stays a root beside the app until O14's B4, and is revoked in M8 (M3, M8). Rejected: revoking it when the app first becomes a root, which strands O14's verbs.
16. An admin enrolls a member's first device directly, through an admin read of pending entries asked of O11 (M4; P5 Decision Log 34). Rejected: the countersign flow, now.
17. M7's log-plane reader may land before the channel's look is settled, so O14's B4 never waits on Q5 (M7). Rejected: one landing for the whole channel.
18. No new e2e group in M1 or M2; their live proofs are the owner's staging sitting and the first cut-over machine. Rejected: `e2e:org`, which would need a hub and an approving device in the hosted lane.
19. `tweetnacl` 1.0.3 for the transfer's sealed box. Rejected: `@noble/ciphers` and `@noble/curves`, two packages for one call that the spike ran with `tweetnacl`.
20. The registration keeps an anchor (the genesis hash and the held head's version and hash), written after each `chain.json` write, a rewind's included; at load the held chain is checked as one run from the anchored genesis, the anchored state held or recorded as superseded by a verified rewind, not pinned again; a damaged chain fails closed unless the hub's chain holds the anchored state, and only `org.reanchor` with a fresh pairing code opens it. Rejected: re-pinning at load, which refuses a legitimate recovery; re-reading from genesis against the pins, which loses rollback protection; taking a served chain rewound below the anchor, whose check needs the history the damaged file held.
21. A listing's key keeps a mark of its newest accepted record (revision, hash, signing key, `gone`), apart from its row and persisted: a lower revision is ignored, the same record restores or keeps its row, another record at that revision is a conflict. A mark is dropped only when the signed head puts its key in `revoked` or `retired`, or revokes its certificate's delegation. Rejected: deleting a withdrawn row's key with it; a count cap, which lets a still-verifiable old revision return; dropping on an empty `machineKeys`, which a hub can cause by leaving a certificate out; dropping at a delegation's `expires`, which a late but valid renewal reverses.
22. A machine counts as loaded only once this run's hub snapshot has applied with the announced head adopted (`OrgRows.complete`) and none of its records await verification (`OrgRows.pending`); the roster alone only suppresses its record reads. Rejected: loading a machine on its first rows, or on the snapshot's last page alone, either of which can drop restored tabs.
23. A hub that stops admitting the member (`4403`, `403 not-a-member`) is `denied`, not a removal: the app changes no trust state until a verified head does. Rejected: reading the unsigned close as the removal.
24. Sign-out's commit point is the `signedOut` marker, written before the token is deleted, and a running sign-in is fenced. Rejected: deleting the token first.
25. M2 promises no record for a remote session; the opening lane draws its pane from the `ListedSession` and its own subscription, or waits for O3's read (finding F8). Rejected: naming lane A's plane presence as a record's source.

Findings on P5 for its writer (things in P5 that are wrong or missing):

- **F1.** P5's O8 acceptance has the app revoke the deployment admin once the app's device is a root. O14 runs its verbs on the deployment admin through B4 (Decision Log 75 (1)), so the revocation has to follow B4; until then both are roots and share the chain. O8's edges gain O14's B4 for that step, and O15's check runs after it.
- **F2.** P5 Decision Log 27 has O8 join the hub and the log by `smnsId`, but `machineEnrollment()` is null on the MacBook until its cutover (O14's B3), so stored `smnsId`s can't serve the join through most of P5. O8 computes join ids with the signed-in org.
- **F3.** Decision Log 34 asks O8 to choose: O8 has an admin enroll a member's first device directly, which needs a hub route O11 doesn't have (§I H1).
- **F4.** O14's B4 waits on one reader drawing migrated history (Decision Log 75 (5)), which Decision Log 92 made O8's project channel, a late, taste-gated milestone. O8 lands the reader half first (residue 17); P5's Ordering should show B4 waiting on that half, not the whole channel.
- **F5.** O8's edges read "Blocked by O6, O11, O12", but its later milestones are also blocked by O3 (per-member state, lane B record changes, lane B's to-human store), O7 M2 and M6 (cards), O14's last machine (words) and O14's B4 (the admin's end). The Ordering table's O8 row should name them per milestone.
- **F6.** O9's R3 asks a lane A row to read as held by a terminal, but RL6's listing carries no holder. M2's lane A rows read `foreign_held` with no holder kind; O9 takes the holder from its watch.
- **F7.** P5 §8's Org page lists "the recovery key", which is offline and fixed at genesis (RL §5.3). The page can show only its id and the root-transition flow; P5's text should say so.
- **F8.** No child produces a `SessionRecord` for a session on another machine before O3's per-member read (O7's C5), yet the session pane and O9 M9's `controlsFor(record, …)` take one. O9's remote half (M9) is scheduled before O3. Either O9 M9 and O7 M2 draw remote panes from M2's `ListedSession` and their own subscriptions, or remote panes wait for O3. P5 should name which; O8 recommends the first, since it needs nothing unbuilt.
- **F9.** The hub refuses a removed member everything, the state that removed them included, so no app can verify its own member's removal from the hub (§I H3).

- Decision: M2's reviewer-high round 1 (on 11846ed8a: 2 P1, 1 P3, each reproduced by the reviewer and fixed test-first) is folded in. (1) A mark's delegation came from the first certificate naming its machine and key, verified or not, so a hub could prepend a copy of a genuine certificate with another delegation, and revoking that delegation dropped the mark and let an older revision return after a relaunch. The delegation now comes only from a certificate `verifyMachineCert` accepts, at the instant the listing verified; two verified ones that disagree record `null`, which keeps the mark until the key itself ends. (2) `retryWaiting` emptied the waiting set before its awaits, so an `org.rows` read during a retry after a new head could say `complete` with nothing `pending` and settle a machine whose restored tab was still being verified; a record now stays waiting until its judgment lands. (3) The sidebar's temporary selection of a listed row was hidden, not cleared, when the shown tab changed, so returning to the tab selected the row again; it is now cleared. Round 2 on the fixes found nothing material.
  Rationale: (1) and (2) break the mark rule (residue 21) and the coverage rule (residue 22) as written; (3) breaks the selection's stated lifetime. Rejected for (1): asking `verifyListing` for the certificate it used, a change under `apps/org-protocol/src/`, which this child doesn't touch; rejected for (2): a separate in-flight set, when the waiting set already is `pending`'s source.
  Date/Author: 2026-10-28, O8's executor.

- Decision: M3 and M5 are re-planned into executable milestones on the owner's answers (P5 Decision Log 111), and the parent pin moves to P5's blob `33276836` at master `a2f4411da`. "Add owner" leaves M5 as M5b, since its offer row and executor don't exist (O10's `offers.ts` has no `record.*` row; sminos has no `record.owners` executor). Decision Log 101 refused O3's D2, so M5b routes lane B's owner changes to sminos's member record, as lane A's. M4 stays advisory, and states H1's shape for the desk track.
  Rationale: M3 needs only M1 and O7 M1, and M5 only M2, all landed; M5b's dependencies are other children's.
  Date/Author: 2026-10-28, O8's planner (the executor, re-planning at the architect's direction).

- Decision: The boundary break, by the architect's ruling. M3 adds `deployment admin root add <device id>` to `apps/desk-hub/deploy/admin.ts`, with its `production-run.sh` line and its test in `admin.test.ts`. The desk track's owner reviews that hunk at M3's PR on four points: which device classes may be roots (native-mac with a step-up key only), what a successor needs under two roots (one root's signature, by `rootSigned`), the confirmation naming the fingerprint, and `remove-device` with two roots.
  Rationale: no verb adds a root (`SUBCOMMANDS`, `admin.ts:118`; only genesis writes `root.keys` and `remove-device` removes from it), so the owner's co-root step can't run without one.
  Rejected: a contract request to the desk track, which queues M3's sitting on another child's work for a verb of about 30 lines.
  Date/Author: 2026-10-28, O8's planner; ruled by the architect the same day.

- Decision: M3's signer.
  - The app composes successors itself, as `deploy/org-admin.ts`'s `successor()` does, and runs the package's `verifySuccessor` on its own signed state before keeping or sending it. Rejected: moving `successor()` into `org-protocol`.
  - The step-up module signs org states through `createStateSigner`, Touch ID first, and the key never leaves it (P5 Decision Log 53). Rejected: handing `src/main/org/` the key.
  - A durable pending slot settles as the deployment admin's does. A `not-head` on a state no machine received is cleared and offered again, since no one else can hold it. Rejected: signing again on the new head after a direct delivery, which can fork the machines from the hub.
  - Direct delivery sends the last 16 held states, so a machine slightly behind adopts the run.
  - The weekly successor asks with Touch ID only at a focus, and notifies once a day while the app is not in front. Rejected: Touch ID from a background timer.
  - New keys register beside the old device. The old device stays signed in until the new entry is listed, and its key file is destroyed once the head ends its keys. Rejected: destroying the old keys before the new device is approved, which strands a profile whose approval fails.
  Date/Author: 2026-10-28, O8's planner.

- Decision: M5's names and toggle.
  - First names come from the email's local part, since the signed member shape is closed: `isMember` takes `id`, `email`, `role` and `devices` alone. Collisions read the whole local part, and an unlisted id reads "former member". Main sends `OrgRows.members`.
  - The People toggle is remembered under the layout key `sidebar.people`. Rollups count your sessions only.
  - A record drawn at a listed address takes the listing's owners.
  - Rejected:
    - a signed `name` field, which changes RL5 for the hub, the endpoint and sminos;
    - emails on rows;
    - a `SidebarRegionSchema` field, which an older build fails to parse, losing the sidebar's layout;
    - counting others' waiting rows as needing you.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The re-plan's first buildability round is folded in (doperpowers:adversarial-reviewer on dc39ef6f1: 6 P1 and 5 P2, each checked against the code and adopted).
  1. The superseded offer revokes what the superseded states revoked and the head lacks, removing the holder where the key is current again. It no longer revokes keys added on the discarded branch, which `keysAccounted` refuses.
  2. A delivery is acknowledged only by `done` with a version at least the state's. `not-newer` is resent from genesis under a byte bound, since a far-behind endpoint also answers `not-newer` (`org-sync.ts:258-260`).
  3. The delivery obligation keeps the signed bytes in the same write as the pending slot, so a withheld hub doesn't stop direct delivery (RL §5.2), and publication and delivery settle apart.
  4. A rekey is one recoverable transaction: a `rekey` intent in `registration.json` before the renames, replayed before the missing-keys check.
  5. `signing.json` fails closed once written, and the weekly dates share its single read-modify-write writer.
  6. An exposed proposal is never cleared by itself: exposure is written before each send, and discard takes the owner's confirmation, as `abandon-pending` does.
  7. Signing needs the backup mark as well as the root key.
  8. The prefix checks use the raw case-folded relation (`dc-` against `dc-prod-`), and renewal must extend a live delegation to a live date.
  9. `OrgRows.member` carries the signed-in member for "you".
  10. Ownership is classified before presentation, so an opened record of another's session follows the toggle and stays out of the rollups, and a machine with only others' sessions keeps its row.
  11. `root add` takes only a device under the deployment admin's own member, which `remove-device` can remove.
  Rationale: each was reproduced against the cited code or the package's rules. Each is now named in M3's or M5's Proves.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The re-plan's second buildability round is folded in (on 16f82f61d: 4 P1 and 3 P2, all in M3; it confirmed M5's and the first round's other fixes closed).
  1. The superseded offer keeps machine-holder revocations, delegated certificates included, with or without a current entry. Each removal's whole closure is accounted for and shown: a device's companion key, a delegation's retired certificates.
  2. A discard removes the obligation with the slot, so no abandoned byte is sent. Sends are suspended in `pending-fork`, and what may hold an abandoned proposal is reported.
  3. Delivery pages forward through the app's own line in byte-bounded runs, starting at the machine's known version, so it converges with no hub.
  4. A machine ahead of the state is acknowledged when a run reaches its head (`#deliver` answers `done` on a matching head).
  5. A rekey is irreversible from its intent on: a cancel or sign-out no longer deletes its inputs.
  6. One `SigningStore` over M1's commit queue is the single writer that the signer, the weekly asking and the deliveries share. Network calls and adoption stay outside it.
  Rationale: each was checked against `records.ts`, `org-state.ts`, `org-sync.ts`, `endpoint.ts`, `link.ts` and `org-session.ts` as cited in M3.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The re-plan's third buildability round is folded in (on e2c949c90: 1 P1, 2 P2).
  1. Delivery runs recovery first. When the app's line holds a recovery transition, a machine with no cursor on that line gets a run from the transition's base, which the whole held chain keeps, forward, and every cursor resets when the app adopts a rewind.
  2. Forward runs start after the established cursor and must raise the version. A single state over the byte bound reads `too-large` instead of looping.
  3. A machine-holder revocation whose key the head retired moves the retired entry to `revoked`.
  The round confirmed every earlier fix closed, and M5 clear.
  Rationale: `org-sync.ts:225-244` (the rewind needs the state at `fromVersion + 1` and the base), `endpoint.ts:680-681` (`done` on an unchanged head), `org-state.ts:111-112` and `:172-173`.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The re-plan's fourth buildability round is folded in (on 59b63b5cd: 1 P2). Recovery first is a probe with a defined exit. Any answer other than `done` records the line as probed for that machine and hands it to head-finding and forward catch-up. Two proofs are added: an endpoint below the recovery's base, and one past the first page that already accepted the recovery. The rounds converged at 11, 7, 3, 1.
  Rationale: `org-sync.ts:227` (a transition with `fromVersion` at or above the head is no candidate), `org-state.ts:311` (an accepted transition refused as `rollback`), `org-sync.ts:258-261` (`#refusal`: `not-newer` with no state at head + 1, `rollback` with states below the high-water mark). Without the exit, both machines would stay owed forever, retried hourly with the same run.
  Date/Author: 2026-10-28, O8's planner.

- Decision: The desk track's two further checks for M3's PR (2026-10-28, via the architect) are written into M3's proofs, and `checks.ts` gains an `empty-roots` refuse row.
  1. No path leaves the org with zero roots. M3's own surface removes nothing that holds a root. The package refuses an empty root set (`stateInvariants`, `org-state.ts:95`, run by `verifySuccessor` at `:341`), and `remove-device` filters a removed device's kid (`admin.ts:712`). The app still names the refusal before Touch ID, so M4's removal UI inherits it. The tests sign the sequence the desk track named with the real package.
  2. A successor signed only by a root key it adds itself is refused (`rootSigned` against `rootKeys(before)`, `org-state.ts:355`). There is a test.
  Rationale: the package already holds both rules. The app-side row costs one line, and it turns a late `invalid` after a fingerprint into a named refusal before one.
  Date/Author: 2026-10-28, O8's executor.

- Decision: M3 is built as seven tasks under subagent-driven-execution, each reviewed at its dependency frontier, then reviewer-high on the PR.
  1. `root add` and its proofs.
  2. `checks.ts`.
  3. The device module: `createStateSigner`, the next keys.
  4. The signing store, the signer and `postState`.
  5. `weekly.ts` and `deliveries.ts`.
  6. The session's composition, the rekey transaction, the IPC commands, main's wiring and the Org section.
  7. `test/org/signer.local.test.ts`.
  Rationale: the milestone spans about a dozen modules, and one context building all of them would carry every earlier task's noise into the later ones. The split follows §K's producers.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 2 (`checks.ts`, ccd09f9d1) settles these points of the checks' contract, which later tasks read.
  1. `CheckCode` gains `empty-roots`. §K's union predates that row.
  2. `revives-revoked` reads both `head.revoked` and `next.revoked`, as the package does, and it covers revoked kids in `root.keys`.
  3. A renewal is judged live at `max(next.issued, now)`.
  4. `prefix-names-machine` also refuses a new machine name under an existing prefix. The package refuses it too, and M4's enroll would otherwise reach Touch ID first.
  5. A delegation is new unless the head lists it with the same id, key and prefix.
  6. The superseded offer is non-null whenever any candidate exists, withheld ones included. Its `lines` empty means nothing to sign: Task 6 hides the offer's button then and still shows the withheld names. `superseded-keys` also warns about withheld candidates.
  7. M3's proof of "one shortening `expires`" was wrong about the package, which refuses only a shortening to or before `issued`. Renewal-extends is the app's own rule (P5 Decision Log 30). The proof line is reworded.
  Rationale: the executor checked each point against `org-state.ts`.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 3 (the device module, 5c866c647) settles the primitives Task 6's rekey transaction builds on.
  1. `createStateSigner` is async, since `keyId` is.
  2. Every refused confirmation reads `cancelled`.
  3. `sign` signs a canonical copy taken before the prompt.
  4. `DeviceKeysRefusal` gains `not-excluded`, covering a failed exclusion and one that answers `false`.
  5. Added beyond §K: `discardNextDeviceKeys`, `deviceKeyIds(profile, 'current'|'next'|'retired')` and `findDeviceKeys(profile, device)`.
  6. `promoteNextDeviceKeys` is idempotent: it completes whichever renames a crash left and syncs the directory. The replay is `findDeviceKeys`, then promote, then step 4.
  7. A stale `keys.next.json` is replaced. So Task 6 keeps `createNextDeviceKeys` and step 1 under one fence, and a recorded rekey's next keys can't be replaced.
  8. A second rekey's promotion overwrites a `keys.retired.json` that is still waiting, which destroys the first old device's keys before a root removes that device. Accepted: destroying a key early is the safe direction, and that old device stays listed, removable as before. The rejected alternative refused a second rekey while a retired file waits, which would block the `removed` case that needs it.
  9. (Review fix, 7987431af.) Every read and change of a profile's key files runs in one in-process queue per profile, so two finishers of one promotion (or a load finishing it) can't retire the keys the other just installed. Reads are queued too, so `findDeviceKeys` can't answer `null` mid-promotion and make the replay drop a live rekey. Across processes, main's profile lock (`startWithProfileLock`, `index.ts:252`) keeps a second main off the profile. The queue serializes file steps, not the rekey transaction: Task 6's fence spans `createNextDeviceKeys` through step 1.
  Rationale: §K's shapes, with what the transaction needs made explicit.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 4 (the signing store and the signer, 96ef54f3b) settles these points.
  1. `discardPending` clears any slot the hub's chain doesn't hold, not only a `pending-fork` one. This is `abandon-pending`'s own rule (`admin.ts:1155-1168`). Otherwise a slot the hub keeps refusing (`409 key-purged`, say) blocks every sign forever. The owner's confirmation and the `abandoned` record guard it as before. Refusals: `held`, `hub`, `none`, `signing`.
  2. `registration.json`'s `signing: true` is written before `signing.json`'s first write, in the same queue turn, so the file fails closed from its first byte.
  3. Whether the slot is a fork is derived from the held chain (`judgePending`), never stored. A re-judge, at `onChanged` too, clears a slot the held chain holds, with no network call.
  4. A sign first reads and adopts the hub's chain, so it doesn't propose a fork on a stale head. After Touch ID, `verifySuccessor` runs against the current head, and the slot's update checks the head again: if it moved, nothing is kept.
  5. A sign while signed out is refused `not-root`. A store error during a sign reads `signing`.
  6. `createOrgSigner` takes `marked()`, since the backup mark rides on neither the state signer nor the held view. `OrgSigner` gains `onChanged` and `close`. The deliveries' `obligation` hook may be async.
  7. (The architect's check of item 1, 2026-10-28.) The discard keeps `abandon-pending`'s distinctions (`admin.ts:1168-1196`).
     - A slot never exposed (`exposed.hub` false and `exposed.machines` empty) reads as the CLI's never-sent case: "pending version n `<hash>` was never sent: nothing was posted", and the question says nothing can show it as a fork.
     - An exposed slot (the hub, or any machine's act, since a delivery is exposure too) states where the hub stands, either not holding it or holding another state at version n (a fork). Its question carries the fork warning: "A later sign may make another successor of version n − 1, which a hub or machine that kept these bytes could show as a fork: discard it only once you know why the hub refused it."
     - The signer's discard returns `{unsent, hubVersion, forkAt?}` for the Org section to word.
     - The held floor after a discard is `max(slot's parent version, hub head)`, as `writeAnchor` sets it. In the app the held view never moves below the head it holds, which is at least the parent, and the discard adopts the hub's chain first. A test pins that no lower version is accepted after it. The floor holds on one line. A recovery the held view authenticates is the org's own rewind: it resets the held high-water mark to the recovered chain (`held.ts:335-360`), so a slot whose parent the recovery superseded is discarded at the recovered head, not held above it. Holding the floor at the superseded parent would refuse the recovery itself (the Task 4 re-review's finding, dismissed on that ground). Only a recovery transition the held view verified resets the floor (the architect, 2026-10-28). A hub answer merely lower than the floor, with no verified recovery behind it, is still refused (`rollback`).
     - `abandon-pending`'s delegation-residue lines have no analogue: M3's signer adds no delegations. M4's delegation edits inherit them.
  8. (Review fixes, 027ff0007.) The refresh before a sign follows a recovery: M1's `rereadFrom` moved to `held.ts`, shared with the session. A sign is refused `hub` when the hub was read but its head wasn't taken. A 201 is ok only once the held chain holds the signed state; a failed adoption reads `hub` ("… it stays pending"), and settle finishes it.
  Task 6 inherits these:
  - call `settle()` at start and at each feed open;
  - `markRegistration` writes inside the current queue turn, without a nested `commit`, and updates the in-memory registration;
  - the Org section offers Discard for a refused slot that isn't a fork;
  - a post's `credentials` or `denied` answer goes to the session's hub-failure handling.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 5 (`weekly.ts` and `deliveries.ts`, 5448d421b) settles these points of delivery. All of Task 4's seams fitted with no change to the signer.
  1. A cursor's `line` is a 48-bit digest of the held accepted transitions, not their count, which stays level across a rewind past one forward root transition.
  2. A machine is no longer owed once it is out of the roster and the held head no longer names it. The roster is empty at start and at sign-out.
  3. An obligation whose state a recovery superseded is dropped. The superseded offer carries its revocations.
  4. A run for a state already on the held chain stops at the held head, so it never carries another obligation's pending state.
  5. Recovery first starts at the newest transition's `fromVersion`. Any judging answer records the probe.
  6. A forward `not-newer` or `rollback` drops the cursor and resumes head-finding past the run.
  7. `too-large` clears the cursor and keeps the machine owed, and a retry finds its head from caps.
  9. (The architect's check, 2026-10-28.) The bound comes from the receiving side.
     - A delivery reaches the endpoint as one RL2 message (`endpoint.state` in a call). RL2 messages are capped at `MESSAGE_MAX_BYTES` (4 MiB, `org-protocol` `channel.ts:50`). The endpoint's calls hold that cap less 1 KiB (`src/endpoint/calls.ts:101`). RL2 pages a message over RL1's 1 MiB frames (`RL1_MESSAGE_LIMIT`, `relay.ts:19`; `HANDSHAKE_PAGE_BYTES`).
     - `DELIVERY_MAX_BYTES`, 512 KiB, is an eighth of that cap. That leaves margin for the call's envelope and the transitions it carries.
     - Task 7 proves one run at the bound end to end over the real link. `deliveries.test.ts` proves that a single over-bound state reads `too-large` and is not retried in a loop.
  10. (Review fixes, 34b043605.) The fixes cover three cases.
     - A run records the held view and head it was planned on, and checks them again synchronously after the exposure write and just before `link.act`. A change means nothing is sent and the run is planned again.
     - A recovery probe carries its base and the state after it. When that pair is over the bound, the probe reads `too-large`, is not sent and is not recorded as probed, and that pass falls through to head-finding. A machine that reached the recovered line by its own sync still settles.
     - A machine leaves an obligation only on authenticated evidence: the state's own removal, or a certificate that `verifyMachineCert` accepts against the parent. A machine `next.machines` still holds is never dropped.
  8. The planner's "last 16 held states" (the signer entry above) and `DELIVERY_SPAN` are superseded by the byte-bounded forward paging of the re-plan's rounds. The §H row is gone, and the constant leaves `timing.ts`.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 6a (the session's composition, 7fab342f5) settles these points of the main side.
  1. The session takes one optional `signing` dep: the state signer, focus, notify, the roster, `onRoster` and the link. Main passes the roster and the link as lazy closures, since the machines start after the session.
  2. The weekly asking and `maySign` also need `current()`, so a signed-out root is never asked for Touch ID. The signer's parts stay up across a sign-out.
  3. The `signer` status part carries more than §K names: `pending.exposed`, `pending.refused`, `offer.withheld`, `owing[].tooLarge`, `abandoned` and `rekeying`. A rekey keeps the status `registered`.
  4. `SignResult` puts a refusal's findings in `detail`, and `DiscardResult` is Task 4's. `org.discardPending` and `org.resetSigning` take `{confirmed: true}`.
  5. Rekey:
     - it checks the new device against the held chain, not the fresh code's pins;
     - its key-file work is serialized, and the commit checks `keys.next.json` holds the new id before step 1;
     - a new rekey is refused while an unfinished intent is recorded;
     - a failure after step 1 is left to the replay at the next start.
  6. `revokeSuperseded` composes the offer again at signing and refuses `invalid` if it no longer matches what was shown.
  7. The retired key file is destroyed once no listed device holds either old key.
  8. (Review fixes, 65e1310fa.) Step 4 merges the promotion into the registration as it stands after its write, so a sign-out during that write stays signed out. A queued rekey checks `registration.rekey` again after waiting for the key-file work, and refuses `busy` while an intent waits for its replay.
  Not built: rekey for a profile whose `keys.json` is gone or refused. M1's `keys` problem covers that profile, and its path is to sign out and register afresh. Residue.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 6b (the Org section, fbed38051) settles these points of the signer's lines.
  1. The discard's confirmation is worded from the status before the discard: never exposed, a fork, or exposed with the n − 1 fork warning. Its result line reports `{unsent, hubVersion, forkAt?}`.
  2. Discard is offered for a fork or a refused non-fork slot. A slot that is only waiting reads as a muted line, with no Discard.
  3. The buttons that sign need `maySign`. The offer and its withheld names show regardless.
  4. Each signer action ends in one line on the Signer row, and a Touch ID cancel shows nothing.
  5. Rekey refusals sit under the rekey field. Rekey and sign-in share `status.refused`, so the section tracks which control sent the attempt; a `refused.attempt` field would make that exact, and is residue for M4.
  6. The weekly line sits on the Signer row. The `root add` line names the full device id, with the fingerprint in the row's note. A discarded proposal shows only when it was exposed.
  7. OrgSection.tsx stays one file, about 440 lines. M4 splits it.
  8. (Review fixes, 37cdbf67d and 1d4bd558c.) Discard's consent is bound to the proposal.
     - The status's pending part carries the slot's `hash`. `org.discardPending` takes `{confirmed: true, hash}`, and the signer refuses `stale` when the hash doesn't name the current slot, before any hub read or write.
     - The sheet closes when its slot settles or is replaced.
     - The hash is the package's `stateHash`, computed in the slot's write and again at every load, so a stored value never outranks its state. Abandoned rows are keyed by hash.
     - Rejected: a synchronous copy of `stateHash` for `pending()`, which would make a second definition of a protocol byte.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Task 7's two adapted proofs and its Discovery 2 (the architect, 2026-10-28).
  1. The genesis fallback can't be reached on a real link: a link is up only after `caps`, which always carries `stateVersion`. So the local suite proves deep delivery (versions 16 to 35, one run, acknowledged), and `deliveries.test.ts` keeps the literal genesis path.
  2. "The hub refuses the post" is the fetch seam answering `503 busy`, a real `OrgChain.submit` answer. The real Worker can't refuse a valid successor without it becoming a fork.
  3. Discovery 2, fixed in M1's session (740f0c46f):
     - A feed `state` notice at the held head's version is followed through `rereadFrom`, as one above it is.
     - The certificate poll syncs when the served head is at the same version with another hash, rather than judging it a `fork` alone.
     - held.ts is unchanged, so only a verified recovery moves the head, and a sibling with no recovery behind it still reads `fork`.
  4. A notice below the held head is not followed. A recovery below the app's head is followed by the certificate poll within 10 minutes, or when the hub's chain reaches the app's version. A recovery needs the owner's recovery key, so it is rare, and a post the app makes on the abandoned head in that window is refused by the hub, which M3's fork handling covers. Rejected: following such a notice only when the served chain carries a transition the held view hasn't accepted, since it costs a hub read on the common path and raises a false `rollback` when the hub is merely behind. Residue for M3's landing entry.
  5. Discovery 1 is the desk track's residue (O10): an endpoint's own hub sync reads `?since=<head>`, so it can't take that same recovery. M3's recovery-first delivery covers it until then.
  Date/Author: 2026-10-28, O8's executor.

- Decision: The whole-branch review's fixes (reviewer-high round 1 on 559ddfc0c: 3 P1, 2 P2; fixed 559ddfc0c..ba781f87f).
  1. The hub post checks the held line again synchronously after its exposure write, as deliveries do, and posts nothing off the line.
  2. The signer carries its own lifecycle epoch, which sign-out and close advance. It is checked before Touch ID, before the slot's write and before each post, and a fenced sign reads `not-root`. The session's generation was not used: a cancelled rekey advances it too. A slot published before a sign-out stays, and settles at the next sign-in.
  3. The closure is shown before Touch ID. The status carries the superseded offer's lines, warnings and withheld names with a digest of them. The Org section shows them in a sheet, and `org.revokeSuperseded {offer}` names the digest it confirmed. A mismatch reads `stale`, whether at the call or when the offer is composed again on the hub's head (formerly `invalid`). Touch ID's own line counts the warnings shown in Settings › Org, since macOS's prompt carries one reason string.
  4. A hub refusal of any post, settlement's re-posts included, is kept and shown as `refused`, so Discard is offered. No answer, or no hub, only waits.
  5. The weekly ask writes nothing at focus. A gate run just before Touch ID checks focus, writes `lastAsked`, checks focus again and takes the date back if focus was lost, so an ask that never reached Touch ID spends no day.
  Residue for O7: RL4 step-up actions (`createStepUp`) show Touch ID only the action and the machine, and drop the prompt's text the same way.
  Date/Author: 2026-10-28, O8's executor.

- Decision: Device ids go after `--` wherever M3 passes or prints one (031c476da). The staging and production wrappers pass the owner's arguments last (1ec366d08): `deployment()` and `direct()` keep the command word first for `bin.ts`, then the wrapper's `--config`, then `"$@"`; the admin sites put `--keys` after `admin`.
  Approved by the architect, with the desk track's shape and three pinned forms in `production-scripts.test.ts`: B1 step 2's `admin --pipe delegation create …` on the `direct()` path, `admin root add -- <a '-'-led id>` through both wrappers, and one non-admin verb through each wrapper with `--config` after the command word. `admin show` is also pinned, unchanged in form. A caller's own `--config` is refused, as before, since `--config` is not repeatable.
  Rejected: printing the bare id and adding `--` only for a `-`-led id, which fails through the wrappers for one id in 64 until they change.
  Date/Author: 2026-10-28, O8's executor.

- Decision: M5's build (b78445447) settles these points the milestone left open.
  1. The label shows two entries in all, "you" among them: "you, Ana +1" for you, Ana and Ben. The cap bounds the row's width, so "you" counts.
  2. `ownersLabel`'s `me` is `string | null`: signed out, nobody reads "you". Empty owners give `null`.
  3. Names widen one level further than §L: two members whose local parts also collide (`ana@a`, `ana@b`) read their whole emails.
  4. `memberName` takes Unicode letters (`élodie` reads "Élodie"), upper-cases the first and lower-cases the rest (`GINA` reads "Gina"), falls back to the whole local part when it has no letters, and compares collisions case-insensitively.
  5. `OrgRows.members` is ordered by the sorted rows' first naming of each id, which keeps main's JSON dedup stable.
  6. Others' hidden rows add no activity: a project holding only hidden rows ranks by `createdAt`. What you can't see doesn't reorder your list. Drawn others' rows count.
  7. Others' archived records are not counted in "+N others", as archived records are never drawn. "+1 other" is singular, and it shows whether the project is open or closed.
  8. The People hover action is the first of the four buttons, so Resume, Remove and "+" keep their places at the right edge. The menu's item carries a trailing check, as the menu has no indicator gutter.
  9. The hover card lists owners only where the row's label shows (not on a session you own alone); "you" carries your email, a former member none.
  10. `usePeople.load()` runs once from `App.tsx`'s mount, not the Sidebar, which keeps IPC out of every Sidebar test.
  11. A toggle made before the stored set is read records the state the person saw it reach. When the read lands, each touched key is set to that state and every other stored key is kept, and nothing is written before. Rejected: `summary.ts`'s "toggle wins", which would replace the whole stored set with one early toggle; and replaying early toggles as flips (the first build), which reviewer-medium showed turns a stored-on project off after a "Show" clicked during the read, and saves that (fixed at 854178726).
  Debt, not built: `sidebar.people` keys are neither moved when an address key becomes an org key (`layout-model.ts`'s `rekeySets` does so for `expandedProjects`) nor pruned; the toggle reads off until set again. Others' records still reach Needs you and "Mark all read"; attention across machines is O7 M6's and O3's.
  Date/Author: 2026-10-28, O8's executor.

- Decision: The People toggle shows only where it can act: its hover action and its menu item appear on a project or machine row when the row has others' sessions (`others` above zero) or while it is on, so it can be turned off. Elsewhere the row and its menu are as before M5.
  Rationale: the first build put it on every project row, local-only projects of a person with no org included, so most people met a control that does nothing on every row. It also moved the hover geometry: the final gate's e2e:default (run 40786951312, `e2e/shell.spec.ts:50`, Item 6) clicked the line's center at the sidebar's 200px floor and landed on "Hide people's sessions".
  Rejected: showing it on every org-keyed row. That still offers a toggle with nothing behind it.
  At the 200px floor the actions don't cover the name. The line is a flex row: the name is `flex-1 min-w-0`, the actions a `shrink-0` sibling, not an overlay. Computed from the classes, not measured (happy-dom does no layout): with four actions the name keeps about 56px, x 29–85, and the line's center (about 92) falls on the first action. A click on the name collapses the row; only a click at the center misses, which the e2e helper `closeProject` makes (`e2e/support/sidebar.ts:60`). Residue: that helper could click the name.
  Date/Author: 2026-10-28, O8's executor.

- Decision: M4 is re-planned on today's master and split three ways (2026-10-29, on the architect's rulings). The parent pin moves to P5's blob `d07bfc4e` at master `6fb933626`.
  - M4a, the Org page's shape, people and devices, is executable.
  - M4b (machines and their rights) and M4c (delegations) stay advisory, with the facts the re-plan found written into them.
  Rationale: the re-plan's reading found most of M4 has no implementation to port.
  - No admin verb adds or removes a member, changes a role or an email, renews a delegation, or touches a grant.
  - Grants are not in `OrgState`. They are separate records the hosting machine's ledger holds, and nothing issues them in production. A re-enrolled machine refuses every old grant, and the app keeps no record of the grants it issued.
  - The device module signs only whole states.
  - desk-web's `views/{org,key,machines}`, the named reference, are the v1 desk, with no pairing, members, rights or delegations.
  Each part is a milestone of its own.
  Members stay in M4a: Q1's People group with "Add person" is the owner's answer, and an org of people is the product's point. The buildability round may still split them out as M4d.
  Rejected:
  - one M4 at this depth, which reviews poorly;
  - app-side copies of the pairing judges and checks with parity tests, a shim where the code can move.
  Date/Author: 2026-10-29, O8's executor.

- Decision: The pre-sign checks for members, roles, the root set, endorsements and machine names live in `apps/org-protocol` as `successorProblems`, beside `verifySuccessor`.
  - It is one pure function that names a proposed successor's problems before Touch ID.
  - The CLI's `amend` and the app's `checkSuccessor` both run it. `verifySuccessor` stays the gate after signing.
  - The pure pairing judges move there first, as a mechanical commit. Both commits are the desk track's to review.
  The desk track's conditions:
  - admin runs the moved code from the deploy checkout: read-only `show` and `devices` against the local hub, plus admin's suites;
  - a `wrangler` dry-run build stays clean when M4b moves `encodeEnrollmentCodeV2`;
  - #261 and M4a merge, never rebase, whichever lands second.
  Date/Author: 2026-10-29, the architect's ruling, recorded by O8's executor.

- Decision: The protocol's endorsement rule is a user-visible rule in M4a.
  - An admin pairs another member's first device through H1, unendorsed.
  - A later device needs an endorsement by one of that member's own step-up keys.
  - A member who signs pairs their own later device from their app.
  - A member who doesn't sign has no route until the countersign flow (RL §5.2, deferred by P5 Decision Log 34).
  The page says so where the action would be, and offers nothing that fails.
  Date/Author: 2026-10-29, O8's executor, on the architect's ruling.

- Decision: `close()` awaits the commit queue's tail. This is folded into M4a, which touches `org-session.ts` anyway. The two test workarounds go (8d18883f4, 8e21b6354), which closes P5 Decision Log 129's tracker row.
  Date/Author: 2026-10-29, O8's executor.

- Decision: The re-plan's buildability round is folded in (doperpowers:adversarial-reviewer on f8f51e500: 1 P1, 5 P2, 1 P3, each checked against the cited code and adopted). Its verdict keeps members in M4a: the protocol supports device-less members, first-device pairing, email admission, demotion and key-accounted removal, so no M4d.
  1. (P1) Pairing approval is bound to the candidate the person compared. The candidate is frozen when found. A same-id entry reposted with other keys ends the pairing. `org.pair.approve` names `{generation, digest}`, and the edit signs the frozen device, checking at `apply` that the pairing is still live.
  2. `successorProblems` is scoped to ordinary successors. A held transition changes non-signature rules, and the recovery vector is accepted unendorsed that way. `verifySuccessor` keeps its verdicts and their order.
  3. `close()` fences its producers and joins them before draining the queue, since a signer step awaiting a hub read can adopt after the tail has drained. A test holds that read open across `close()`.
  4. Pairing uses today's API: `judgeEntry(entry, {org, member, k, class, listed})`, `k` base64url in the code, a class chosen in the sheet (`native-mac` by default), and `listed` from the held head. The judges' input type moves as a package-owned `PendingEntry`.
  5. Whether a machine is up comes from the renderer's `useMachines`, not the view, since a link drops with no new head.
  6. `org-page.local.test.ts` is registered in `TIMING_NODE_TESTS`.
  7. (P3) `deploy/bin.ts` bundles admin, so the move's steps also import the judges straight from the package under Node's type stripping.
  Date/Author: 2026-10-29, O8's executor.

- Decision: The buildability round's second pass is folded in (on 02bd683e1: 1 P1, 1 P2; it confirmed the other six fixes closed and members kept in M4a).
  1. (P1) The pairing's liveness check moves to the point it can act. `apply` runs before Touch ID, so `Edit.live()` is also checked in the device module after the confirmation (before endorsing or signing) and by the signer before the slot's write. A proposal already in the slot is durable, and cancelling the pairing no longer withdraws it.
  2. `close()` also joins the held view's own adoption queue (`HeldOrg.close()`), which a link's direct `advance` feeds outside the session's producers, and the session's load. Each writer under `org/` belongs to one owner that `close()` joins.
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 1, the move (336af704b), settles these points.
  1. `admin.ts` re-exports `judgeEntry`, `isPairedDeviceId` and `isRpId` from `org-protocol`. Two test-side importers read them from it: `test/local/endpoint.ts` and `test/endpoint/staging/world.ts`.
  2. `entryDevice`, private in `admin.ts`, is now exported, for Task 4's pairing.
  3. `PendingEntry` is built from the package's own `DeviceClass`, `KeyStorage` and `Passkey`, and the hub's `PendingDevice` satisfies it.
  4. The move's local-hub recipe keeps `keys.json` and `recovery.json` in separate directories, since `genesis` refuses a recovery file beside the admin keys (`admin-device.ts:88`).
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 2, `successorProblems` (5935f62a5), settles these points.
  1. `stateInvariants` is exported, so the parity test can compare it with `stateProblems`. That test passed against the old boolean body before the switch.
  2. `Problem.code` is a `ProblemCode` union, narrower than §M's `string`, so Task 3 can join it with `checks.ts`'s codes.
  3. The codes:
     - the link: `other-org`, `version-not-next`, `prev-not-head`;
     - the whole-state prefix rule: `prefix-overlaps`, since a whole state has no new-or-old direction;
     - beyond the list, to cover every non-signature check: `shape` (alone), `issued-backwards`, `machine-ref-changed`, and each sub-rule of `stateInvariants`;
     - where `checks.ts` already names a rule, its name.
  4. An endorsement by a key outside the member's own (`unknown-signer`) stays `verifySuccessor`'s signature check.
  5. The admin check sits in `signPending`, so it covers `propose` as well as `amend`.
  6. Until M4c, `checkSuccessor` shows `prefix-overlaps` beside its own directional prefix code for one collision.
  7. (Review fix, 592211929.) The task review found that full diagnostics ran inside `verifySuccessor` before authentication. 120 duplicate delegations built 7,140 `prefix-overlaps` diagnostics.
     - `stateInvariants` now uses `stateProblems(s, {first: true})`, which returns at the first problem and builds no detail.
     - Full mode keeps at most `PROBLEMS_PER_CODE` (8) problems per code, and builds each detail lazily, never past the cap. `onDetail` counts the details built, for the test.
     - The pairwise comparison stays quadratic, as the desk track allowed.
     - `key-held-twice`'s detail names the holders without the key id.
     - Past the cap each call site still makes its closure, so full mode is for a caller's own successors, never for posted input. The desk track's note is recorded at the functions (37ce2077d).
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 3, the signing paths (643d126de), settles these points.
  1. A composer refuses with `RefusedEdit` and a `ChangeCode` (`self`, `this-mac`, `no-change`, `bad-email`, `not-signing-device`), which the signer reads as `refused` before Touch ID. `no-change` and `bad-email` go beyond the spec; `bad-email` uses the hub's email pattern, exported from `hub-client.ts`.
  2. Rules the state decides are the package's, not repeated in the composers: `owners-unknown`, `email-taken`, `empty-roots`, `root-not-admin`, `endorsement-missing`.
  3. Shown equals signed. `composeChange` builds its lines from the state the sheet was shown on. `apply` builds them again on the signer's draft, and throws `StaleEdit` when they differ or the target is gone. Only a normalized change composes, so `member.add`'s id comes from `normalizeChange` alone.
  4. `OrgChange` is a plain TypeScript type in `edits.ts`, as §M gives it. Task 4 moves it into the shared schema, and the finding codes there are strings.
  5. `checkSuccessor` drops an M3 row whose code the package already named, and any finding repeated word for word. M3's own `revives-revoked` and `empty-roots` rows are gone. The directional prefix codes still show beside `prefix-overlaps` until M4c.
  6. `live()` is also checked just before Touch ID, so a pairing that already ended shows no prompt. That makes four checks.
  7. Asked to endorse a device the state doesn't list, the device module throws. The signer catches that case first and refuses `invalid`.
  8. M3's `invalid` test now uses a device endorsed by an unknown key (`unknown-signer`), since a changed recovery key is refused before Touch ID.
  9. (Review fix, 6d23a8055.) A pairing that ended while `signing.json`'s first write was being prepared still wrote and posted its slot. The store awaited the registration's `signing` mark after the callback's liveness check.
     - On a first write, `update` now marks the registration, then runs its callback again on a fresh copy, and writes that second result with no await between. Every check an update makes runs just before the write.
     - Update callbacks are therefore pure and synchronous functions of the file. The signer's, deliveries' and weekly's all are.
     - Once marked, the registration stays marked and `signing.json` is written as it stands, so the store stays fail-closed.
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 4, the session's surface (19730e6ae), settles these points.
  1. `OrgRefusal.attempt` is optional. Every refusal a session attempt ends carries it. The startup `keys` refusal and the synchronous `{ok: false}` answers name none, and the renderer gives an attempt-less refusal its own place.
  2. `registered.pairing` is required and nullable, like `signer`.
  3. A preview refusal is `{ok: false, reason: refused | stale | not-root | unmarked | signing | invalid, detail?, findings}`. Preview refuses up front when this Mac can't sign. `org.change` maps a refusal into `SignResult`.
  4. A pairing start is refused as one of:
     - `not-root`;
     - `later-device` (the page's sentence);
     - `no-member`;
     - `busy` (any session attempt runs: sign-in, re-anchor, rekey; a rekey is likewise refused while a pairing runs);
     - `hub` (no live credential to poll with).
  5. A pairing is done (`null`) when an approve succeeds, or when the held head lists the candidate. An approve that fails leaves it live for a retry. An ended pairing keeps its `problem` until it is cancelled or a new one starts.
  6. An entry with the candidate's id and another device ends the pairing as `entry-changed`, whatever its MAC. The candidate vanishing while polling is ignored, since the hub drops a pending entry once its state is accepted. At approve, a missing candidate ends it as `entry-changed`.
  7. Expiry runs on one unref'd timer per pairing, and `live()` reads the clock exactly. A pairing whose context reads null (closed or signed out) stops itself, and sign-out cancels it.
  8. `org.change` normalizes its input, so a `member.add` without its previewed id reads `stale`.
  9. `org.view` answers whenever a verified head is held, signed out (`maySign` false) or removed included.
  10. `pendingOf` returns the protocol's `PendingEntry[]`, dropping misshapen items and the hub's own fields.
  11. `names/org.ts` lists the six new commands. `index.ts` and `grades/org.ts` needed nothing.
  12. A pairing that ends during Touch ID reads `cancelled`. One that ends before Touch ID reads `stale`.
  13. Task 5: `close()` cancels a running pairing in its "stop the parts" step.
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 5, `close()`'s fence and join (9b9f8945d), settles these points.
  1. The commit queue itself refuses a new turn once the session is closed (a rejected promise), so every queued writer is covered without a check of its own; turns already queued still run. Its callers already handle the rejection, and the parts check `closed` before their updates, so a normal quit logs no refusal.
  2. An adoption whose `chain.json` write lands before close but whose anchor write comes after it has that anchor refused. This is the crash case the load rule already settles (the anchor moved up to the head at the next load), and a session test pins both halves.
  3. The guard is `StartInput.open`, a property of the held view, optional with absent meaning always open. Being the view's, it also covers a link's direct `advance` and the signer's own `adoptServed`; the session's four call sites pass it.
  4. The signer's lifecycle epoch fences adoption after a sign-out too, as step 1 says ("checks its lifecycle epoch there, as its posts already do"). One behaviour changes: a 201 post whose follow-up read lands after a sign-out answers `not-root` and the slot stays pending until the next sign-in settles it.
  5. The join order is the parts, the sync and the load first, then `held.close()`, then the commit queue's tail. The load can hold a new view until it ends, so `held` is read only after it; nothing in the commit queue waits on a producer or on the adoption queue, so the order cannot deadlock.
  6. Interface §K's `close(): void` becomes `close(): Promise<void>` for `OrgSigner`, `Weekly` and `Deliveries`.
  7. Main's quit awaits the session's `close()`, bounded by the shutdown steps' grace, so a Touch ID sheet open at quit cannot hold the exit indefinitely.
  8. The pairing's cancel at close has no test of its own: a pairing whose context reads null already stops itself (Task 4, item 7).
  9. A signer test that closed inside its Touch ID wait now starts the close there and awaits it after the sign, since awaiting it inside would wait on itself.
  10. `close()` does not join the two writers under `device/`, `checkRetired`'s key destruction and a fenced rekey's `discardNext`: the rule covers `org/`. They did not trip the teardown's `rm` in 20 runs; if one does, join `retiredWork` and `keyWork` in step 3.
  11. (Review fix, 653e60c0b.) A signer operation that meets `close()` reads as stopped, never as a storage failure through the IPC router. The lifecycle is checked right before each enqueue that follows an await: the slot's write after Touch ID and the exposure write before the post answer `not-root`; a discard answers `{ok: false}`. Genuine storage errors still read `signing`.
  12. (Review fix.) The queued reset checks the signer's closed flag, not its sign-in lifecycle: a reset is the owner's repair of a damaged file, which a sign-out does not cancel and a close does.
  13. (Review fix.) The discard uses the slot's stored `hash`, which the store recomputes on every read, instead of awaiting a fresh `stateHash`, so no await sits between its last check and its write.
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a gains Task 8, the Org page's look checked through the gate. Task 6 was proved in happy-dom only, and this MacBook may not launch the app, so the look would otherwise wait for an owner's sitting. One case in the e2e group that opens Settings seeds an org with real-world variety: a member whose name and email wrap, a member with several devices, a pending pairing, and a refusal with no attempt. It screenshots each of the four groups and attaches the PNGs (`testInfo.attach`), and asserts only structure: no horizontal overflow, and every row's actions visible. The group runs on the hosted lane with `--evidence`, so the attachments upload when green, and the architect reads the screenshots. The PR names the owner's taste look as a later sitting only if the architect finds nothing wrong.
  Rationale: a renderer whose wrapping nobody has seen is not done; the gate can carry the evidence without an owner present.
  Date/Author: 2026-10-29, the architect (O8's executor recording).

- Decision: M4a Task 6, the Org page's renderer (1971d3be9, review fix 7437e1e2e), settles these points.
  1. The groups are `<h4>` headings in `data-org-group` divs, not regions: a group named "Org" would collide with the Settings section's region and with the "Org" row.
  2. Org state shows in every registered state (M1 showed it only when signed in). The held chain's problem stays with its Re-anchor field in You; Org's Problem row shows every other problem. The signer lines show only when signed in, as before.
  3. A refusal shows under the control its attempt names. One naming no attempt, or naming a control the page no longer offers (a `rekey` refusal with no new-keys field), goes in a "Refused" row of its own, at the end of You or after the code field in `none`, so none is dropped. A command's own synchronous `{ok: false}` is tagged with the attempt the page sent.
  4. The old-device row (M3's) offers Remove… through the change sheet (`device.remove`), only while `maySign`, in place of the `remove-device` command line.
  5. People offers nothing the composers refuse for yourself. Make a root is offered on an admin's non-root `native-mac` device; whether it has a step-up key is the preview's to refuse (`not-signing-device`), since the view does not carry it.
  6. A later device of a member who signs reads "They pair their next device from their own Org page."; the non-signing case reads the spec's sentence. Neither offers the action.
  7. A change that succeeds closes its sheet and shows "Signed version N." at the foot of People. Any other failure stays in the sheet with Sign withdrawn. The person's own Touch ID cancel shows nothing.
  8. Closing the pairing sheet while a pairing runs (Cancel pairing, Escape, the overlay) cancels it, since its code cannot be shown again. A pairing running with no sheet reads "Pairing a device until HH:MM" on its member's row with Show…, which reopens the sheet without the code. The code lives only in the sheet's state and is dropped once the entry appears or the pairing ends.
  9. An approval's answer shows in every stage of the sheet, because main publishes a pairing's end before approve answers: `cancelled` with a detail reads "ended while Touch ID was open", `stale` reads "ended, or its device changed, before Touch ID" with main's detail, and the person's own cancel shows nothing.
  10. When this Mac loses the right to sign, an open change or pairing sheet withdraws its signing actions and says why rather than closing; an operation in flight keeps its answer.
  11. The pairing sheet says, beside Approve and while an approval is pending, that once the signed state is kept a cancel no longer withdraws it and Discard is the way back (`ORG.pairDurable`, muted text).
  12. Machines read Up, Connecting…, Offline, or "Not connected" when the roster does not name the machine. Owners read you as "you", an id the head no longer lists as "a former member", and `'org'` as "Owned by the org". The spec's "(here in M4b)" reads "Enrolling from this page comes later.", the UI carrying no milestone ids.
  13. `SheetForm`'s `submitLabel` is optional: without it there is no default button and Enter submits nothing. The Org sheets use it, so a refused preview has no Confirm.
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 7, `test/org/org-page.local.test.ts` (7033fb853), settles these points.
  1. Step 5 removes B's device before B, so B's app reads `removed` from a verified head while the hub still admits it; removing B first would end B's feed with a `4403`, which reads `denied`.
  2. `member.email` is proved by `edits.test.ts`, not here: B's app holds a fixed stand-in identity, so changing B's email would end its hub access mid-scenario.
  3. The pairing secret is checked by booleans only, so a failure cannot print a code.
  4. A's `PAIR_POLL_MS` is 100 in this suite (2 s in production).
  Date/Author: 2026-10-29, O8's executor.

- Decision: M4a Task 8, the Org page's look through the gate (37ea7abab..fac48e11f), settles these points.
  1. The page is seeded through a harness-build-only seam, not the real session: the only refusal naming no attempt is `keys`, set at load when the key file is gone, which leaves no signer, so a running pairing cannot coexist with it in a real session. `src/main/org/page-fixture.ts` answers `org.status` and `org.view` from a file the strict schemas must accept, through `interceptCommand`, under `MAWS_E2E=1`, unpackaged, with an absolute `MAWS_E2E_ORG_PAGE`; every other `org.*` act gets a no-effect answer, `org.rows` stays main's.
  2. No production build carries it: `index.ts` calls it only under `__MAWS_HARNESS_BUILD__`, defined from the condition that builds `harness.html`, and a unit case checks the plain main's bundle holds none of it. The spec skips on a build without the harness.
  3. (Review fix.) Installing the fixture stops the production session's `org.changed` forwarding (`registerOrgHandlers`' own return), so load's closing `changed(true)` cannot replace the seed after Settings mounts.
  4. The case runs under classic scrollbars whatever the desktop's: `launchMaws` passes `-AppleShowScrollBars Always` through AppKit's argument domain for that process alone, and the case waits until the settings body's scrollbar takes width.
  5. Its structural checks: nothing in the section, any row, cell or text block is wider than its box; every action, scrolled into view, lies on all four edges inside its row, every clipping ancestor and the window; two deliberately clipped probes prove the check names them; no seeded machine's ref shows in the section's text.
  6. (The gate's finding.) A word wider than its column breaks inside its cell: `Setting`'s label and value cells take `min-width: 0` and `overflow-wrap: anywhere` (text that fits wraps as before), a text action never shrinks, and the refusal line, the People footer and a sheet's body break the same way. The first run had a widened member name 182px wide in the 168px label column, on the EC2 Mac and on a hosted Mac alike.
  7. (The architect.) The Org group names machines as the Machines group does: the org state's name for a ref, else its link's name or This Mac, the ref only when nothing names it (Deliveries, too-large, Discarded). The superseded offer's lines stay main's words (`describeHolder`, under the offer's digest); they already lead with the name.
  Date/Author: 2026-10-29, O8's executor.

- Decision: the desk track's key-held PR (#338, master 1fe1a74d9, P5 Decision Log 134) landed before M4a, carrying M4a's Tasks 1 and 2 unchanged, so M4a takes its three follow-ons at the merge. `edits.ts` refuses `bad-email` through `org-protocol`'s `isMemberEmail` in place of hub-client's `EMAIL`, which the merge drops (hub-client reads `/api/me` through `isMemberEmail` too). `email-grammar` joins the pre-sign codes (*The pre-sign function*). The admin suite's "twin posts m1's key" case is #338's: the hub now refuses that twin with `409 key-held`, so the case posts a key another signer lists, which only the pre-sign check catches; its assertion is unchanged.
  Date/Author: 2026-10-29, O8's executor, at the architect's word.

- Decision: The rest is re-planned on master 910539147 (2026-11-06): M4b, M4c, M5b, M6, M7 and M8 become executable, with the facts the advisory sections lacked. M6 splits into M6a (reader state per member) and M6b (visibility and shares, O18's M5), and M7 into M7a (the log reader, the Channel tab and people's words) and M7b (to-human entries across machines). The order is M7a, M7b, M6a, M6b, M4b, M4c, M5b, then M8. The parent pin moves to P5's blob `b99c1767` at master `910539147` (P5's Decision Logs 1 to 228).
  Rationale: the architect's brief and rulings (2026-11-06). The facts:
  - O18 (P5 Decision Logs 223 to 228) turned M6's Share sheet into its M5, with the `list` grade and audience streams;
  - O3 closed (the index in the spine), and O7 closed;
  - O12 M11 made the spawner an owner;
  - B3 moved the last machine, so the owner's words no longer wait;
  - new to-human entries left the log;
  - no `record.*` offer or executor existed.

  Splitting each of M6 and M7 lets a landing carry one reviewable concern and the owner's week start on the channel's core.
  Date/Author: 2026-11-06, O8's executor, on the architect's rulings.

- Decision: The constraints for the rest. M4b, M4c, M6a, M6b and M7b change `src/endpoint/`, `src/services/` and `src/mawsd/endpoint-seam.ts`, and M4b and M4c move code into `apps/org-protocol/src/`, against the Constraints' "the protocol, the hub and the endpoint are as landed".
  - The desk track reviews every `src/endpoint` and `apps/org-protocol` hunk, in their own commits.
  - `apps/desk-hub/src/` stays as landed, so the renew route M4c consumes is the desk track's PR.
  - The desk track builds the sminos executors through `set_visibility`, DL190 (b)'s join fix, and the CLI's "use MAWS" refusal.
  - The Constraints keep their text for M1 to M5, with a dated note.
  Rationale: O18's M5 assigns the offers to O8 M6. O3's C5 and D1 hand the index change to O8. No other owner holds the record path, the local door or the channel journal.
  Date/Author: 2026-11-06, the architect's ruling 3, recorded by O8's executor.

- Decision: A new delegation's code goes from main into Secret Manager, never shown. Main runs `gcloud secrets versions add <secret> --data-file=-`, with the code on its stdin alone, after the state is signed into the slot unsent. It confirms by the new version's metadata, then publishes.
  - The code lives only in main's memory and the child's stdin. It is never logged, put on the clipboard, written to disk or sent to the renderer.
  - gcloud is resolved explicitly, and a missing or signed-out one, or a missing secret, refuses before anything is minted.
  - A failure after signing leaves the slot unsent with the reason.
  - The destination (`project`, `secret`, `account`) is a machine setting. Production's is the owner's Google Cloud project / `desk-provisioning-v2` / the owner's CLI service account (not recorded in this repository), O14's.
  - A fake gcloud on a scratch `PATH` proves the custody.
  Rationale: P5 Decision Log 75 (1) already binds the custody (no code is ever a file on a Mac; it goes to Secret Manager), and after M8 the app is the only signer that can create a delegation. Rejected: (b) showing the code once with Copy, which breaks that rule; (c) a CLI helper over a pipe, the same custody with another process.
  Date/Author: 2026-11-06, the architect's ruling 1 (the architect's to decide, not the owner's), recorded by O8's executor.

- Decision: Renewal extends the delegation in the state first, then the hub's key, through the desk track's `POST /api/provisioning-keys/<id>/renew`. The route is admin-only with no body, and takes `expires` from the head's delegation. The app checks the creation cap (`MAX_PROVISIONING_KEY_TTL_S`) before signing, and a failed hub half shows as half-done with a Retry that calls only the route.
  Rationale: the state is the authority, and the acceptance's "renews a delegation only while it is live" needs the hub's credential to follow. Rejected: renewal as rotation, which burns a prefix.
  Date/Author: 2026-11-06, the architect's ruling 2 and the desk track's route, recorded by O8's executor.

- Decision: P5 Decision Log 30's reason for re-signing a re-enrolled machine's grants is corrected. An in-place `--replace` keeps the endpoint's accepted grants (`src/endpoint/enroll.ts:208-225`, test `test/endpoint/enroll.test.ts:164-195`, "a grant in force kept"). A machine whose ledger is lost, or that was enrolled again with a new key and an empty ledger, loses them. So M4b reads the machine's ledger through `endpoint.grants` and re-signs only the issued grants it lacks, each shown first. The acceptance clause stands.
  Date/Author: 2026-11-06, O8's executor; the architect carries a line to P5.

- Decision: The record acts' shape and their frame to sminos are agreed with the desk track (§Q).
  - The act carries no `session` or `context`, and names its target in `args` (`session` for lane A, `appSessionId` for lane B).
  - The RL10 frame's `args.session` is always the id that keys sminos's record, lane B's resolved through the members join. An unplaced one is refused `no-session` and never queued.
  - `proof` is the act verbatim.
  - sminos's executors call `set_visibility(…, operator=True)`, since the verified act admits the widening.
  - `record.policy` answers `unavailable`, never defaults, for a session with no member frame.
  - The offers are gated on sminos's capability `record`. A `done` outcome carries `{changed, policyRev}`, and `changed: false` is a no-op. `read-only`, `stale`, `expired` and `tombstoned` are refusals the sheet shows. The context check exempts `record.*`.
  - Once the offers are on master, the CLI refuses every widening with "use MAWS", except on a machine enrolled at no hub.
  Date/Author: 2026-11-06, the desk track's answers through the architect (its chat 1158 accepted the frame as written), recorded by O8's executor.

- Decision: M8 is owner steps and evidence. Its first step is M3's root-add sitting, skipped when `admin show` already lists the app's device as a root. B4's steps 4 to 8 come before the revocation, which M4a's `device.remove` composes from the People group. The owner deletes the admin's key file and anchor after it.
  Date/Author: 2026-11-06, the architect's ruling 5, recorded by O8's executor.

- Decision: Verification for the rest. This re-plan gets a `doperpowers:adversarial-reviewer` buildability round before its docs PR. Each milestone's PR is reviewed: reviewer-high with a security lens on M4b, M4c, M6b and M8; reviewer-medium on M7a, M7b and M6a, with a confidentiality lens on M7b's feed and M6a's reader routing. The desk track reviews every `src/endpoint` and `apps/org-protocol` hunk.
  Date/Author: 2026-11-06, the architect's brief, recorded by O8's executor.

- Decision: The re-plan's buildability round is folded in (doperpowers:adversarial-reviewer on ce2dda8c2: 6 P1 and 7 P2, each checked against the cited code and adopted).
  1. (P1, M6a) A remote reader update answers `ReaderState`, never the whole record, which holds `launchedBy.action` and paths a `list` caller must not read.
  2. (P1, M4c) An unsent delegation is a persisted `held` phase of the slot. No automatic settle posts it, and `publishHeld(hash)` publishes only the slot this create made.
  3. (P1, M6b) The local door takes the three `record.*` acts only, verifies their step-up signature unconditionally, and takes the member from the device's one head entry.
  4. (P1, M4b) A package-owned `grantProblems` judges an unsigned grant before Touch ID. `verifyGrant` becomes eligibility then signature, its verdicts unchanged.
  5. (P1, M4c) The mint is `delegationCreate`'s request exactly (`label`, `ttl_s`, `max_uses`), and the encoder is `encodeProvisioningCodeV2`.
  6. (P1, M7a) A device's `human` is verified by `verifyEvent` alone, its author being its writer's member, with no machine attestation.
  7. (P2, M4b) `endpoint.grants` answers each member's `highWater` with or without a grant, and a `not-newer` re-reads once and asks again.
  8. (P2, M4b) A lost ledger unenrolls the endpoint (`state/store.ts:286-300`), so the local proof re-enrolls before re-granting.
  9. (P2, M7a) A migrated writer's verdict is kept as a checkpoint beyond the cache's bound, re-checked by `verifyHistorySigner` at load.
  10. (P2, M7b) The channel feed's filter is lane-aware, and re-checked per frame.
  11. (P2, M6b) Rows track hub and channel membership per key, whatever showed the key first.
  12. (P2, M6b) The `policyRev` check is best effort, read again before and after Touch ID, with a change landing during the acts shown as it stands.
  13. (P2, M8) `admin show` is the one read after the revocation, and moving its anchor is intended. The revocation's evidence is the digest-bound sheet and the signed state, since `show` prints no revoked device keys.
  The verdict found M5b buildable as written. The second pass (on 0701ee0a5) closed 12 of the 13 and found three in the fixes, each adopted:
  - (P1, M7a) the migration checkpoint now binds each covered position to the hash of the exact event that passed, so other bytes at that writer and seq never read `migrated`;
  - (P2, M4c) `publishHeld` clears `held` in one pure update, then runs the normal post path, under the signer's exclusive operation;
  - (P2, M4c) the delegation's `expires` is computed in explicit units.

  A third pass, on a8d1fdb0a, closed all three and found nothing new. The review has converged: rounds of 13, 3, then 0 findings, every one adopted.
  Date/Author: 2026-11-06, O8's executor.

- Decision: M7a is built as three tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-medium on the branch.
  1. Main and the shared schema: `src/main/org/channel/` (the socket client, verification, the cache with its migration checkpoints, words, the per-project channel), the session's commands and `close()`'s join, the `org.channel.*` schema, and the `channel` tab kind.
  2. The renderer: the tab, the projection and folding, the stream, the composer, the waiting cards with the native ask inline, Channel in the project menu.
  3. `test/org/channel.local.test.ts`, and the e2e case over a harness-only seeded channel, with screenshots.

  The pre-flight settles one point §N leaves two ways. `org.channel.open` and `org.channel.changed` carry main's verified events, not §N's folded entries:
  - `ChannelEvent {offset, writer, seq, event, label: 'verified' | 'migrated' | 'legacy', by?, author?, owners?}`, plus the pending words (`{nonce, text, to, state: 'sending' | {refused}}`), `unverified`, `asOf` and `live`;
  - the renderer's pure `channel/project.ts` folds them into §N's `ChannelEntry`, which becomes a renderer type.

  Main holds what only main can judge (signatures, attestations, the held head's names), and the renderer the presentation, which its tests pin without main.
  Date/Author: 2026-11-06, O8's executor (pre-flight).

- Decision: The record.* executors ship in sminos 1.38.0, not 1.37.0. 1.37.0 is D5's restatement (doperpowers #492), and 1.38.0 is built on top of it, to §Q exactly. M6b and M5b need sminos 1.38.0 or later on the target machine. Nothing in the app changes, since the `record` capability is the real gate. The merge order onto doperpowers main is #463 (O18 M3), M4, D5, then the executors.
  Also from the desk track:
  - DL190 (b) as built places an unplaced lane B record by the `ownersProof` entry that is the spawn's act (`session.spawn`), not by `ownersProof[0]`. Once `record.owners` exists, a record with an empty `ownersProof` can hold an owner-add act at index 0. M5b's wait is corrected to match.
  - MAWS #496 (master bdd6cb7db) gives `test/endpoint/rl10/conversation.json`'s three sminos hello lines `capabilities: ["audience", "record"]`, the blob sminos 1.38.0's conformance replay compares exactly (bc2593f1). An M6b change to that fixture starts from master's copy, and the architect is told, since the desk track's sminos gate pins it.
  Date/Author: 2026-11-06, the desk track through the architect, recorded by O8's executor.

- Decision: M7a Task 1, main and the shared schema (221c6daaf..64d278151; fixes 4fe3fac85..2d145630e), settles these points.
  1. `open` answers main's verified events whole. `changed` is a delta: `upserts` by offset, `removed` offsets: every offset any tab was sent, by an open's answer or a delta, that main no longer holds, so a tab holds exactly main's bounded set and every judgment covers all it holds, the words, the sessions' lifecycle, `unverified`, `asOf` and `live`. `reset: true` comes only after a judgment that changed verdicts in bulk, another org's log, or a closed answer. Coalescing is at 100 ms. (The controller's fix, which replaced a whole-log resend, and the review's, which made evictions told.)
  2. `author` and `owners` are M5's `OrgMember` objects, named from the held head, so a cached verdict still draws names signed out. `by` is the attesting machine's name. `mac` and `sig` are stripped before the renderer.
  3. `open` answers `ok: true` with `live: false` whenever a cache exists, so "as of" draws offline. `signed-out` and `no-hub` come only when there is nothing to draw, and `unknown-project` for a non-project id or the hub's 404. A refused project stays refused through later heads, until the tab's next open or another hub.
  4. (A gap the spec missed.) A DX1 writer larger than the cache's bound could never verify, since the bound evicted its prefix while pages arrived. The channel reads the project's attestations before it opens the socket, and spares an awaited writer's events past the bound until `caught-up`. Only an attestation whose signer and binding verify (`verifyHistorySigner`) earns the exemption, and only up to its `upTo`, for one copy per (writer, seq): the first held. Replays and conflicting copies fall under the normal bound. An unauthenticated record, or replays of an authentic one, would otherwise let a hub defeat the bound (the review's findings).
  5. Every cached event is judged again at each new head or certificate set, not only failed ones. A failed owner attestation leaves a machine event verified with no owners.
  6. `@alias` follows `sminos say`'s leading-tag grammar, in `channel/address.ts`. It reads each session's latest verified lifecycle (`joined`, `retired`, `renamed`, `titled`), which is kept past the bound, persisted in the cache and judged again at each head, so a session whose `joined` was evicted stays addressable. A lifecycle event that first verifies at a later head enters the projection then, the latest offset winning (the review's findings). Each pending word belongs to the org, member and device that signed it, and a sign whose await outlives a context change sends nothing (the review's finding). Task 2's review moved the rest into main (Task 2, item 2): another sign-in hides the old context's words rather than refusing them, and release drops acked words and keeps the unacked ones as "not sent".
  7. §N's socket signature gains `onWelcome`, a boolean from `send()`, and the client's own close codes 4401 (credentials) and 4404 (unknown project).
  8. `attestations` sits on `ProjectReads` beside `HubClient`, so the signer's, the pairing's and the deliveries' clients need no channel read.
  9. `close()`'s join, by M4a's rule:
     - a channel's work is joined outside the commit queue, and its write enters the queue as a finished snapshot that awaits nothing;
     - `shut()` stops the channels with its fence and lets their final snapshots in through their own door (the review's finding, replacing a write that awaited its producer inside the queue).
  10. The cache's 8 MiB bound counts UTF-8 bytes.
  11. A renderer frame that reloads or is destroyed releases the channel references it held (`holds.ts`).
  12. Words are signed with `identity.channelKey` through `org-protocol`'s `signEvent`, as O7's links already sign RL2 handshakes with it. P5 Decision Log 53's rule covers step-up and state signing, and this reading is recorded rather than widened.
  13. `src/shared/machine/coverage.test.ts` reviews `ChannelEvent.event`'s string-keyed record: a log event's own fields, sminos's ids, no MAWS address.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 1's report.

- Decision: M7a Task 2, the renderer (3d355c066..7d113efb3), settles these points where the spec was silent.
  1. §N's `ChannelEntry` is a renderer type. Every entry carries `key`, `label` and `by?`. An `exchange` carries its `says`, so it opens in place. `say.owners` are `OrgMember`s, labelled with M5's `ownersLabel`. A `words` entry has `you`, `to` and `state?: 'sending' | 'sent' | 'not-sent' | {refused}`, in place of §N's `sending?`/`refused?`. A word not yet in the log has `offset: null` and `at: null`.
  2. "Not sent" holds within the app's life, not across a relaunch. Main is the single source of a word's state (`sending`, `sent`, `not-sent`, `{refused}`), and the renderer draws it (the review's findings, superseding the first build's page-memory book and Task 1 item 6's last sentence).
     - Every pending word stays bound to the org, member and device that signed it. A channel exposes only the current context's words, and another context's are neither shown, resent nor refused.
     - An acknowledged word stays pending as `sent` until the log holds its nonce. At release (30 s after the last tab) it is dropped, since the log has it.
     - A word never acknowledged at release moves to a bounded in-memory "not sent" list per project and context. The next open in that context returns it as `not-sent`, with its text, until that channel's next release.
     - A relaunch can say nothing: the draft lives in main's memory, and a disk copy would defeat that rule.
  3. A fold holds one label: a label change ends a run. A say to several sessions folds with nothing. Any other drawn entry ends a run, words and to-human entries included, as desk-web's rule has it.
  4. The waiting cards leave out a greyed machine's items, which nothing can answer now. The native ask answers in place through `RequestCard`'s `askInPlace`, which feeds `AskBody`'s shared `inPlace` mode, so no variant's types change. `HoverAsk` gained the sheet's "older peer" gate.
  5. Words by the signed-in member read "You". The member comes from `useHubAccess`'s new `member` field.
  6. Machine chips resolve the log's machine *name* to a roster ref, case-insensitively as `machineNameKey` compares, and reuse `MachineChip`'s rules. An unresolved name draws as `@name`.
  7. The channel tab is a tab of no session. Like Settings, it follows the current set, and `channel:<smnsId>` keeps it one tab per project.
  8. Offline reasons come from `hubAccess`: "Signed out", "The hub sign-in has ended." (with Sign in again), "The hub no longer admits you.", "Hub unreachable", and otherwise "Connecting to the hub…". The composer is withdrawn whenever `live` is false.
  9. Text renders plain (`whitespace-pre-wrap`), not Markdown, which keeps an untrusted log's text inert.
  10. An open that main doesn't answer shows "Couldn't open the channel" with Retry.
  11. The e2e-facing selectors are `data-channel`, `data-channel-entry` (with `data-offset`, `data-channel-label`, `data-host`, `data-count`), `data-word-state`, `data-channel-provenance`, `data-channel-exchange-messages`, `data-channel-party`, `data-machine-chip`, `data-channel-unverified`, `data-channel-waiting`/`data-channel-card`, `data-channel-composer`, `data-channel-offline`/`data-channel-as-of` and `data-channel-closed`. The scroller is `role="log"`.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 2's report.

- Decision: M7a Task 3, the local suite and the e2e case (d2f99da15..7bd4dcd17; fixes 68f9b8f20, ee29e26aa), settles these points.
  1. The local suite meets two events that must not draw. One is a say by `studio`, stored while its key verified and then revoked by the org. The other is a real forgery: a hostile hub played on A's own transport (`orgSession`'s `channelSocket` seam) alters a stored say's text while its signer stays listed. Both are counted in `unverified`, neither draws, and the forgery fails again from the cache after a relaunch (the review's finding: a revoked key is refused before its signature is checked, so it alone proves no read-side forgery check).
  2. The v2 machines are desk-hub's `FakeEndpoint` with `enrollV2`, not O10's endpoint. Joins and says go in one upload, because the hub withholds a say to a session it doesn't know. B's socket receives A's words, and B's own device sends words through `deviceHuman`. "As of" is proved both live and across a relaunch with the hub down.
  3. `tsconfig.node.json` lists the renderer's pure projection and the graph it imports, file by file, so the node-timing suite typechecks against it.
  4. The e2e case is its own spec, `e2e/channel.spec.ts`, in `e2e:settings`. That moved both default-spec pins and the group's script. Its fixture, `channel-fixture.ts`, is a separate harness-only module beside `page-fixture.ts`, guarded the same way. The waiting cards come from C5's stub scenario (`nine-sessions.json`), filed under the channel's project.
  5. The screenshots set the layout priority of a long-named row. The alias holds, drawn whole up to 24 characters. The title gives way first, then the machine chip, and recipients keep at least 12 characters. The exchange's hover pill stays inside its section.
  6. The e2e gate needs `--evidence` for a green run to upload its screenshots; they then come from `gh run download`.
  7. The action-box and clipping-ancestor check is one helper, `e2e/support/actions-whole.ts`, shared by the Org page's and the Channel's specs (the review's finding).
  Left as UX residue (the architect, 2026-11-06, with the 24-character cap kept for now): the offline footer reserves no scrollbar gutter, so it sits about 7 px right of the stream under classic scrollbars; the cap cuts a long alias even when there is room; below a column of about 500 px a long-named exchange row's fixed parts can't fit.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 3's report.

- Decision: M7a's branch review (reviewer-medium over 10328b26b...1675f282d) found three trust defects and one cache defect in main's reader, fixed in 912fc182f..b9a8380b6; its second round, two more, fixed in bfe900973 and 8139e7713. The architect accepted items 1–5 (2026-11-06). They amend Task 1's items 3–6.
  1. The held log, its cache file and its resume cursor belong to one reader, the org and the member. The cache stays one file per project and records `member` beside `org`. Another reader's file reads from offset 0, and that reader's first write replaces it. A member switch is handled like an org switch: the log is dropped, a reset is sent, and the new reader reads from 0. Until then an open draws and addresses nothing of the previous reader's. Without this, an audience stream the hub's `mayRead` serves only to its members stayed visible to the next member signed in, and the shared cursor skipped streams only the new member could read. Signed out, the last reader's cache still draws "as of".
  2. Each judgment samples the head and certificates once and records that same snapshot as judged. A head or certificate set adopted during an awaited load is judged again, not marked done.
  3. Lifecycle carries its provenance. A verified or migrated lifecycle is a session's identity and its address. A legacy one names only a session that has no authenticated lifecycle, never as a member, never overriding, and never addressable. The two are kept apart in the cache, and the sessions bound drops legacy-only sessions first. Legacy still names its session because its events already draw at that trust level, and naming gives a hostile hub neither an address nor an override.
  4. `historyDigest` is a hash chain, and a checkpoint's digest is its value at `upTo`, already proven. So a later attestation extends a checkpoint from that value: its signer and binding verify, one event per newer seq is folded in turn, and the result matches its digest. The evicted prefix is not needed. The extended checkpoint takes the new record's `by`.
  5. The bound's exemption spares only an awaited writer's events past its checkpoint. Before this, a writer with a checkpoint and an authentic attestation above it spared its whole prefix, and the bound evicted the newest events instead.
  6. (Round 2.) `ChannelSession` carries `authenticated`. A legacy lifecycle names only `legacy`-labelled entries. A verified or migrated entry whose session has only a legacy lifecycle draws its parties as the tab draws a session it knows nothing about: the signed event's own alias, the writer's machine, no title. This covers the sender, a say's recipients and a host entry's party. Without it, a hub that withheld a `joined` and served an unsigned one could name a verified message's sender.
  7. (Round 2.) Only a project's newest channel writes its cache file, under a per-project generation count. A released channel's last snapshot is dropped once the project has been opened again. Task 1 item 9's join rule is unchanged, and the cost is re-reading from the hub what the old channel held after its last write.
  Date/Author: 2026-11-06, O8's executor (controller), from the branch fix wave's report.

- Decision: M7b's refresh at its cut from master `f857f0450` (M7a landed as #504). M7b's consumed interfaces were reconciled against master.
  1. The cited lines moved: `#host` is at `rl10/link.ts:632`, dispatched at :616; `#eachSession` is at `calls.ts:419`, dispatched at :283; the lane B placement is `targets.ts:269-278`. The parent is re-pinned at blob `92141de5`, where Decision Logs 229–238 change nothing M7b consumes.
  2. Lane A's hand-off sits beside `notifier.hostMessage`, not behind the `hosts.json` mark, since the mark moves only once a `wrote` reaches the hub. `src = <project>/<writer>/<seq>` makes sminos's resend of the last 50 idempotent through `UNIQUE(src)`. This is the architect's acceptance (2026-11-06), and it is an `src/endpoint` hunk for the desk track's review.
  3. Lane B's messages are read the way `src/shared/owner/message-call.ts` defines them for every MAWS reader. A sent call of either message tool counts: `mcp__to-human__message` today, and `mcp__maws__message` in recorded sessions. The spec named only the second, which has left its tool server. Each `<message>` span also counts, as the contract's other form of a message, one per span. `essential` and `insight` marks don't. The old line, "plain marked text is not a message", would have dropped every message a session without the tool sends. It is read as excluding the non-message marks and plain text; the architect accepted this (2026-11-06).
  4. M7b defines no classifier of its own; this binds (the architect, 2026-11-06). The spine's lane B entries come from the same extraction the local report view uses to count a message (the parser, `isMessageTool`, and the span and question rules). The channel and this machine's own to-human view can then never disagree about what was a message. That extraction runs in the renderer today (`owner/report/project.ts`, `transcript/model/`), so Task 1 lifts its pure core into `src/shared/owner/`, and the report view and the spine both call it. Re-listing the three kinds in the spine was rejected, since it would let the two drift.
  Date/Author: 2026-11-06, O8's executor (refresh pass).

- Decision: M7b is built as four tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-high on the branch with a confidentiality lens.
  1. The spine: `src/services/channel/` (the journal and its migration, `channel.history` and `channel.changed`, lane B's source from the owner channel's event batches, the `smnsId` join), and `journal.test.ts`.
  2. The endpoint, in commits of its own for the desk track's review: `endpoint-seam.ts`'s `channel`, the `#host` hand-off, the `channel.history` offer row, the `channel` feed, and the lane-aware `view` filter re-checked at each frame. Also `test/endpoint/channel-feed.test.ts`.
  3. Main and the renderer: `src/main/org/channel/machines.ts`, its cache, and the merge into `org.channel.*`; `ToHumanEntry.tsx` and `project.ts`'s placement; `machines.test.ts`.
  4. `test/org/channel.local.test.ts` cases 5 and 6, and the e2e seed's to-human entries, photographed.
  Date/Author: 2026-11-06, O8's executor.

- Decision: the architect's rulings on M7b Task 1's report (2026-11-06).
  1. New index tables are `ADDED_TABLES` entries beside `ADDED_COLUMNS`, not migrations. This is the rule `migrations.ts` already states for columns (P5 O7 M4): a newer `user_version` costs a downgraded build its whole index, and every swap keeps the previous build as its rollback.
     - A table qualifies only if no earlier build reads it.
     - It is created `IF NOT EXISTS`, indexes included, after the migrations at any version. It is never dropped or renamed; anything else stays a migration.
     - A downgrade leaves a gap (the old build writes no journal rows), which is accepted. `UNIQUE(src)` absorbs the resends after a re-upgrade.
     - The cross-build downgrade scene must pass whole, so the provisional skips are reverted.
     - The same rule applies to M6a's two tables.
  2. Questions asked through `mcp__maws__ask` are in, since that is the contract's question form today. They are sourced from the ask's own record (the question, its choices, its answer), with `src` keyed by the ask's id, not parsed from the transcript. The same record answers the ask and feeds the journal, which keeps the one-source condition. Need-input marks stay as the older form.
  3. No entry may be dropped on the normal start path. Entries that arrive before the project's org id is derived are held in a bounded buffer and written once the id is known; an overflow is logged.
  4. A message's text is bounded, with a visible cut marker, at a size the hub's event limit can carry after the envelope (the number cites the hub's limit).
  5. `WIRE_MINOR` stands as a wire entry. Whoever lands second takes the next number at the merge. #506 landed first (2026-11-06, merge 23fc8c2bd) with RL2 minor 11 and `WIRE_MINOR` 29, so M7b takes RL2 minor 12 and `WIRE_MINOR` 30 in a new commit after its master merge.
  Date/Author: 2026-11-06, the architect, recorded by O8's executor.

- Decision: M7b Task 1, the spine (9327c77f2..a54248357), settles these points.
  1. **The one extraction is `src/shared/owner/to-human-items.ts`.** The renderer-resident part of the report view's decision was `derive.ts`'s `toHumanRow` call rule and the text-block filter, and those moved there. The renderer's `to_human` row, the owner channel's marks and lane B all call it. The report view's broader "marked" rule (which also counts essentials and insights, for folding) is not "a message" and stays as it is.
  2. **When a call counts.** A message-tool call counts once its result reads sent, whenever that result arrives, as the renderer's row does. Pending calls are bounded at 256 per session.
  3. **Interrupted blocks.** Message spans in an interrupted block count, since the transcript draws them. Questions in one don't, since no mark is kept for them, so no answer could follow.
  4. **No back-fill.** Lane B reads only events with a journal row (`seq !== null`). That also keeps a terminal-held session's transcript, followed from disk, out of lane B, where lane A's entries already cover it.
  5. **Answers to need-input questions** come from the owner channel's delivered state (`ownerChannel.changed`), and only for a question the journal recorded. A later answer is a new entry.
  6. **MAWS asks.** They are read from the host's journaled `maws.ask.opened` and `maws.ask.answered`, since the engine host's `AskTable` forgets an answered ask.
     - Each question is one entry (`src …/ask/<askId>/<questionId>`), with its option labels as choices. Each answer is one `answered` entry, recorded only if its question was.
     - The answer text is written for the person (`askAnswerOf`).
     - A subagent's asks are in, since the person answers them in the same sheet. Its words stay out.
     - The ask's `title` and `context` aren't carried. A multi-question ask groups by its `ask/<askId>/` prefix; a title would be an optional field, added only if the person can't follow without it (the architect).
  7. **The hold.** Entries said before a project's org id is derived are held for lane B only, at most 1,000 across every session. Past that, the oldest goes, with one logged line, and the next flush counts what went. They are written in order on the next project change.
  8. **The cuts.** The hub refuses an event over 1 MiB (`apps/desk-hub/src/protocol/parts.ts:5`'s `FRAME_LIMIT`, refused at `objects/log-store.ts:79`). So the journal cuts text at 64 KiB of UTF-8 and an option at 512 bytes, at a character boundary with `… [cut]`, and keeps at most 32 options. The worst case on the wire is 640 KiB. The cut sits inside `ChannelJournal.record`, so both lanes and the emitted event are bounded in one place.
  9. **Storage.** `at` is stored as epoch milliseconds and returned as UTC ISO. History's `before` is an entry id, ordered `at DESC, id DESC`, with a default and maximum page of 200. Pruning runs at each record and at start, and the age bound applies on read too. `channel_entries` has no foreign key: a deleted session's entries stay the project's history, and Task 2's `view` filter governs who reads them.
  10. **The command's reach.** `channel.history` is main-only (the preload doesn't bridge it) and graded `view`. `channel.changed` is a link event. `ProjectStore.org(id)` reads the join. `AddedTable` is `{table, sql}`, the entry's SQL owning its indexes.
  The architect accepted items 6–8's choices: subagents' asks, the shared hold, and the option cuts.
  11. (The review's fixes, ef3d17d7e and 832534dca.)
     - `channel.changed` is a main-only event: names gain `mainOnlyEvents` beside `mainOnlyCommands`. The preload refuses it, and main's emitter sends a name that isn't bridged to no window on any path (`emit`, `emitFrom`, `emitTo`), while main's taps still hear the local machine's event.
     - Every part of a lane B `src`, anchor and hold key is passed through `encodeURIComponent`, so an id containing a separator can't collide with another identity.
     - An answer that arrives before its question waits for it: at most 256, the oldest dropped silently (answers to questions from before the journal began land here by design). It is recorded right after its question, under either listener order and either placement. The architect accepted this.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 1's report.

- Decision: M7b's channel feed (the architect, 2026-11-06, on Task 2's report).
  1. **An org-protocol commit of its own.** M7b carries one, for the desk track's review: `'channel'` in `apps/org-protocol/src/messages.ts`'s `MachineFeed`, `RL2_PROTOCOL.minor` 10 → 11 (12 after #506's merge), an `rl2.channel` capability in `src/endpoint/capabilities.ts`, and a `messages.test.ts` case. Polling `channel.history` was rejected: the spec's feed is live, and every earlier feed came this way.
  2. **The sub names a project:** `{t:'sub', feed:'channel', project, cursor, credit}`. The snapshot is that project's newest viewable page, and `changed` carries only that project's entries. Main opens one feed per machine and project, only while a tab holds that channel.
     - The endpoint checks the reader's view of the project when the sub opens, and again at each change as `view` is graded today.
     - A reader whose access is revoked mid-feed has the feed ended, as the other feeds end on revocation.
     - Reach is per project, so the check sits in one place, and other projects' entries never go on the wire.
  3. **Older peers.** A device never asks an endpoint that lacks `rl2.channel` for the feed: main checks the capability first. Against an older endpoint the tab falls back to `channel.history` on open, with no live updates, or to greyed words if even that is missing. Tested in that direction, and `e2e:cross-build` stays green.
  4. **No deployed component parses the feed name.** The production hub (hub@8813921b) must need no change, since a hub deploy is the owner's. The commit cites the code showing that the hub and its carriers relay RL2 frames without validating `feed`. If the hub parses it, the work stops and the architect is told.
  5. **The minors.** Branch `remote-lane-a-agents` will also want RL2 minor 11. Whichever lands later takes the next minor at the merge, by a new commit, never a rebase. The same holds for `WIRE_MINOR` (29 here). The PR body names the numbers taken. (Resolved: #506 landed first with 11, and M7b takes RL2 12 and `WIRE_MINOR` 30.)
  6. **The spine's page bound.** The spine's `channel.history` page is capped at 1 MiB of JSON, as the endpoint's is, with `more` exact.
  Date/Author: 2026-11-06, the architect, recorded by O8's executor.

- Decision: M7b Task 2, the endpoint (5a6b05638..28285e413), settles these points.
  1. **No hub change.** After the handshake an RL2 sub travels inside a sealed frame (`apps/org-protocol/src/channel.ts:20`), and the hub passes channel frames on unread: it decodes only the multiplex envelope (`decodeChannelFrame`) and forwards the payload. Nothing in `apps/desk-hub/src` imports the RL2 message parser. This was checked at the hub production carries, hub@1eeff6de (the desk track, 2026-11-06), at `relay.ts:415-470` (`decodeChannelFrame`, then `open`/forward with `payload` untouched) and its `org-protocol` imports (`relay.ts:38-57`, envelope helpers only). It was checked first at 8813921b.
  2. **The protocol.** `MachineFeed` gains `'channel'`. The sub's `project` is required for `channel` and refused on any other feed. RL2 is 1.12 (it was 1.11 until #506 took 11), and the endpoint lists `rl2.channel` in its `h2`.
  3. **The feed's frames.** Each open answers `subbed` (mode `snapshot`, epoch `channel:<boot>`, seq 0), then a snap of `{entries, more}`: the project's newest page that the member may view. Each later viewable entry comes as `ev {body: {entry}}`. The end reasons are `no-target` (the project isn't in the org), `class` (a web-cards device), `removed` (the project left the head), `behind` and `unavailable`.
  4. **Reach.** The feed's reach is the project's presence in `head.projects`, so every org member reaches every org project, as the hub admits them. Each entry's session is still ranked at `view` before it is sent.
     - A lane A entry is ranked only against sminos's lane A record.
     - An entry whose session has no record is visible to no one, its machine's owners included.
  5. **Paging.** `channel.history` keeps reading journal pages until the caller's page is full, so `more` is exact and paging never stalls on other members' entries. A page is at most 1 MiB of JSON, on the endpoint and in the spine. For a member who may view few sessions, a page costs up to eleven journal reads.
  6. **The seam and lane A.**
     - The seam's `channel` is `record` only: history and changes travel through the existing `dispatch` and `onEvent`.
     - A lane A entry arriving while the spine is cold loads it with the endpoint's trigger. An entry that can't be kept is logged.
     - Lane A's `src` is encoded per part. A host message with no session isn't journaled. A question's texts are joined by a blank line.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 2's report.

- Decision: M7b Task 2's review waves (13d419d6d..f11aa40a0), across our task reviewer's three rounds and the desk track's three (their 581, 589 and 591). They amend Task 2's items 3–5.
  1. **Cursors.** A channel entry's id on the wire is an opaque cursor. Its journal id, zero-padded to 20 digits, is sealed with its lane and session by deterministic SIV: an HMAC-SHA256 nonce and AES-256-GCM, with the project as associated data. The key is 64 bytes, kept 0600 in the endpoint's own state (`channel/cursor-key`). An unknown, tampered, other-project or not-viewable `before` answers the same `{entries: [], more: false}`, after one ranks read and one `session.get`. Journal ids are `AUTOINCREMENT`, so a pruned id is never reissued, and the index file's `sqlite_sequence` gains a row for the table. The spine's main-only history keeps plain ids.
  2. **Placements only narrow.** A lane B session is ranked at every placement the reader has heard since its mark, including those heard before its first read. Each distinct placement is kept once, at its latest hearing. Past 32 distinct placements the session is placed nowhere, which fails closed. A new or waiting entry is ranked by a record read begun after it arrived. A queued entry is checked again at every record event. A removed record places no one.
  3. **Reach and paging.**
     - `orgProject()` reach is checked at history's admission and publication, and on the feed's snapshot.
     - A read ranks page by page, keeping only viewable entries plus the one past the page, and goes to the journal's end. Its bound is 4,000 entries scanned, twice the journal's 2,000; past that the answer is `unavailable`, never a false `more:false`. This replaces the 16 MiB byte cap the desk track accepted in round 2, because that cap could answer `more:false` with a viewable entry beyond hidden ones (the architect, 2026-11-06).
     - A page is published only while everything it kept still stands and no session the read passed by has become viewable. Otherwise it is read again.
     - Measured with plain 64 KiB text through the in-process spine, 2,000 entries with 1,999 of them hidden took 1.4–1.7 s for history and 1.3–1.5 s for the snapshot, against the device's 10 s call deadline.
  4. **The snapshot.** A snapshot is tied to the ranks it began under, and a change of ranks reads it again. After three moved reads, the feed waits up to 2 s for the next change of rights (any `accessChanged`) and takes one more read. If that read moves too, or no change comes, the feed ends `unavailable`. It never publishes a page it can't vouch for. A queued snapshot is checked against the sessions its read passed by until it is taken; one that turns viewable sends the snapshot back to be read again, or ends the feed `behind` if part of it was already sent.
  5. **The feed's changes.** Changes are ranked before they count toward `CHANGES_HELD`, which caps viewable-waiting and unranked entries separately. Past 1,000 unranked entries, the feed keeps only their journal ids (at most 2,000) and reads them again once nothing is queued, keeping only what the member views. A member who views none of them is sent nothing. Viewable ones go as `ev`s in journal order, and a new `snap` goes only when the viewable part fills a page. Another member's private activity never makes a frame, ends a feed or counts against one. A taken-back event's seq goes to the next event. `known` is only the queued snapshot page's ids, and placements nothing held needs are evicted.
  6. **Recovery after an overflow** (the desk track's rounds 4 and 5, their 593 and 597, and the architect's rulings, 2026-11-06). Recovery never sends a snapshot. It sends what the member views as `ev`s, under the bound where ranked > `CHANGES_HELD` ends the feed `behind`, which counts only viewable entries.
     - It keeps the ids of the entries it let go of unranked, and only those; nothing `#rank` decided goes in. An id is forgotten only once the journal no longer holds it. Past the journal's bound, the ids the journal has pruned are dropped, which keeps the list to at most 2,000 per project.
     - It re-reads exactly those ids and sends the viewable ones in id order, merged with live arrivals.
     - Overturned: round 4's ruling held a journal position, the AUTOINCREMENT id. That assumed delivery runs in id order, but snapshot pages are ordered by `(at, id)`, so no single id bounds what has been accounted for. Round 5 reproduced both directions of that, and a discarded entry replayed later. The architect recorded the ruling as his mistake.
     - Round 6 checks this version. After it, only a content leak or a silent loss of a viewable entry is fixed; anything else goes to residue. Accepted: after a burst of more than 1,000 hidden entries, a viewable lane A event waits behind the catch-up's placement reads. That is a latency that depends on hidden entries; it concerns when something is sent, not what.
  7. **Residue, for the tech-debt tracker at landing:**
     - A queued lane B entry can still leave if its record moves silently just before credit, before the notification is heard; the text was authorized before it was queued. Rated minor (the architect).
     - The real-socket timing at the maximum serialized payload is unmeasured.
     - The recovery latency in item 6.
     - Ordering across overlapping recovery batches, rated P2 by the desk track's round 6 (their 601). A finished recovery starts sending while another batch is still let go, so a higher-id viewable entry can go out before a lower-id recovered one. Each entry still arrives once, with no gap and no audience breach. It closes when lower-id recovery candidates are considered before later ranked arrivals go out, with that case pinned. Its effect is confined to delivery order, because the Channel tab orders entries by `at`, then id (Task 3).
  8. **The consumer dedupes** (the desk track's round 6 and the architect's ruling). Main's channel consumer dedupes by (machine, entry id) across snapshot, ev and history, since the transport dedupes stream positions only. Task 3 owns this.
  The desk track's round 6 found the endpoint READY under the agreed final-round bar (2026-11-06).
  Date/Author: 2026-11-06, O8's executor (controller), from Task 2's fix-wave sections.

- Decision: M7b Task 3, main and the renderer (58e294092..19456cac9), settles these points. The architect accepted them (2026-11-06).
  1. **`src/main/org/channel/machines.ts`** reads this Mac's spine and each roster machine, only while a tab holds the project's channel. For an endpoint listing `rl2.channel`, it opens the machine's `channel` feed: `subs.ts` now gates the sub on that capability, where before it gated feeds only on `rl2.feeds`. It pages older entries through `channel.history`.
  2. **Machine states** are `live`, `read` (an older peer, read once at open), `offline` and `unavailable`, each with `asOf`. "as of" shows on a non-live machine's entries. An unavailable machine's entries are greyed, with one faint line naming it.
  3. **Dedupe and order.** Entries dedupe on (machine, id), across snapshot, ev and history. The order shown is the entry's own `at`, then the machine's journal order, since an opaque cursor sorts nothing. That keeps the endpoint's delivery-order residue out of the tab.
  4. **Replacement.** A whole read, to `more: false` or 500 entries, replaces the machine's entries, so a reach change takes them out of the member's view.
  5. **The cache.** `<project>.machines.json` holds the newest 500 entries and at most 4 MiB per machine. It is checked strictly at load, and anything off reads as empty. It belongs to one reader, as M7a's cache does: signed out keeps the file's reader, the first sign-in from no reader is adopted, and any other reader resets it.
  6. **The roster.** A machine leaves only while the reader is signed in, and at open only a non-empty roster prunes.
  7. **The schema.** The change is additive and main-to-renderer only, so `WIRE_MINOR` doesn't move: optional `hosts` and `machines` on `org.channel.open`, and a by-key delta on `changed`. The entry carries one plain `session`, as `RemoteRow` does.
  8. **The renderer.** To-human entries are a renderer kind of their own (`to-human`), drawn by `ToHumanEntry.tsx`. Answers pair with their question by `src` on the same machine. Lane A answers stand alone, since nothing in them names their question. A grouped ask carries no title field, because each question's own text and choices are enough to follow.
  9. **Wiring.** This Mac's spine is late-bound in `app.ts`, because the org session is built before the services bus.
  9a. **Journal order across pages** (the branch review's finding, fixed in 1d3caff96 and ba7d57c92). A read's first page and live entries take places above every entry already held, and its older pages take places below. The place reaches the renderer as `ChannelHost.order`, and `state.ts` orders by time, then machine, then `order`, so an ask straddling a page boundary keeps its questions in sequence.
  10. **Residue, for the tech-debt tracker at landing.** A flapping link re-reads up to 500 entries per opening, and the open answer can carry up to 4 MiB per machine over IPC at the worst-case text size.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 3's report.

- Decision: M7b Task 4, the local suite and the e2e seed (33098354b..daf8d4a3c), settles these points.
  1. **Cases 5 and 6** sit in M7a's suite and run before case 4, which stops the hub.
     - The endpoint and its spine journal are real, fed over their real RL10 socket. Sminos's side is `FakeSminos`, because sminos lives outside the repo.
     - This Mac's spine is real and fed through lane B's real source. The services bus around it is a stand-in, because no `mawsd` runs in a suite.
     - Titles come by the real paths: a lane A session's from its listing, a lane B session's from its record.
     - Case 6 drops the link by stopping the endpoint. It proves the outcome, not which of `machines.ts`'s two paths marks the machine offline.
  2. **The older peer** is a second real endpoint whose `h2` withholds `rl2.channel`. It is read through one `channel.history` call, and no feed is opened.
  3. **The e2e seed** adds to-human entries from two machines, a multi-question MAWS ask with its answers, a lane A question, long titles, and one machine offline with "as of" and one unavailable. These are photographed under classic scrollbars. The screenshots caught two faults:
     - A to-human entry's chip fell back to the raw ref. It now falls back to `ChannelMachine.name`, and the roster's name still wins.
     - The header's title didn't give way before its machine chip. Now it does, and the chip keeps up to 24 characters.
  4. **The open answer's weight** at the seed's realistic size is 42,904 bytes of JSON. The 48 log events take 37,508, the 9 to-human entries 3,591 (about 400 each), the sessions 850 and the machines 377.
  5. **M7a's `Party`** in `parts.tsx` shrinks proportionally in the same way, so a long title can cut a say's machine chip too. It was left as it is, for the architect.
  Date/Author: 2026-11-06, O8's executor (controller), from Task 4's report.

- Decision: M6a's refresh at its cut (2026-11-07). The branch `p5-o8-m6a` is cut from `p5-o8-m7b` at f4f99135f, stacked on #514 by the architect's ruling: M6a's two tables are `ADDED_TABLES` entries, a mechanism M7b introduces (`git grep ADDED_TABLES origin/master -- src/services/index/` finds nothing). The conditions:
  - no M6a PR, not even a draft, until #514 lands; then master is merged in (no rebase), so the PR's diff is M6a's alone;
  - a move of #514's head is merged into M6a;
  - gates on the stacked tree are development checks, not landing evidence.
  M6a's consumed interfaces were reconciled against that tree.
  1. **Cited lines.** `src/shared/ipc/remote-unavailable.ts:39,56-57` still hold `session.update` and `session.drafts.get`/`.set`. `applyPatch` is at `src/services/index/register.ts:37-49`. A spawn's `launchedBy`, with `action`, is built at `src/services/sessions/spawn.ts:62`, not :51-53,75. The renderer's fallbacks are `lane-b/read-marks.ts` and `composer/editor/drafts.ts:76-96` (`rememberingRemoteDrafts`).
  2. **The command context.** The context is `HandlerContext` in `src/shared/ipc/client.ts`, which already carries `op` (a claimed remote act) and `remote: true`. `remote` is set by `mawsd`'s services front for the endpoint's dispatch alone (`src/mawsd/front.ts:611-619`), never from a request's args. `reader` joins it the same way. The endpoint names the reader through the seam's `dispatch` (`src/mawsd/endpoint-seam.ts:42`, `src/endpoint/services.ts:20`), and the front writes it into the context. A request's args never carry it, so a caller can't name another member's rows.
  3. **The parent** is re-pinned at blob `7781e2d5` (master `14ec11778`), where Decision Logs 239–245 change nothing M6a consumes (the header).
  Date/Author: 2026-11-07, O8's executor (controller, refresh pass).

- Decision: M6a is built as three tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-medium on the branch with a confidentiality lens on the reader routing.
  1. **The spine.**
     - The two `ADDED_TABLES` entries;
     - `sessions.ts` and `drafts.ts` with a reader argument, where a new turn's end marks every reader unread;
     - `HandlerContext.reader`, written by the services front from the seam's dispatch;
     - `register.ts` routing `session.get`, `.list`, `.update` and `session.drafts.*` by `context.reader`;
     - the `ReaderState` schema, and the answer with a reader;
     - `migrations.test.ts`, `sessions.test.ts`, `drafts.test.ts` and `register.test.ts`.
  2. **The endpoint**, in commits of its own for the desk track:
     - the offer rows and their grades;
     - the dispatch naming the reader from `machineOwners`;
     - mixed patches refused `malformed`;
     - `remote-unavailable.ts` dropping the three rows, with `test/lane-b/offer-coverage.test.ts` kept true;
     - `test/endpoint/reader-state.test.ts`.
  3. **The renderer:**
     - `lane-b/read-marks.ts` and the draft interception falling back only while the machine refuses;
     - the remote path applying `ReaderState` to the record it holds;
     - a remote lane B session's unread and draft surviving a relaunch.
  Date/Author: 2026-11-07, O8's executor (controller).

- Decision: M6a Task 1's fork. A reader's update is a new machine command, `session.reader.update`, at `WIRE_MINOR` 31, and `session.update` is not given a second output type.
  1. **Why §P couldn't stand as written.** §P had `session.update` answer `ReaderState` when there's a reader, and also said no `WIRE_MINOR` moves. Those can't both hold. `session.update` is a machine-owned entry in the wire manifest. Its answer is checked strictly as a `SessionRecord` by `mawsd`'s front (`front.ts:383`, `validateCommandOutput`) and by the device's renderer (`renderer/src/ipc/client.ts:100`). A union output is a breaking change under `classifyWireChange`, so it would need a wire major.
  2. **What's built.** `session.reader.update {appSessionId, patch: {pinned?, lastSeen?, unread?}} -> ReaderState`, graded `list`, is an additive command (`WIRE_MINOR` 31). The endpoint offers it in place of `session.update`, which stays local-only and is refused with any reader. A patch can't carry `title` or `archived`, because the schema has no place for them, which covers the `malformed` refusal of a mixed patch on the wire. §P, M6a's Touches and Decisions, and the notes on the rest's wire changes are revised to match. Rejected: a redacted `SessionRecord` with reader fields, which would invent paths and settings to satisfy the schema; and an endpoint-side projection, which the device's strict check of `session.update` refuses.
  3. **The owners' reader fields on remote feeds.** Task 1 found that the endpoint forwards `session.changed`, whose records carry the owners' `pinned`, `unread` and `last_seen_*`, to remote feeds. M6a's intent is that each member's reading is kept apart, so a non-owner's device never receives the owners' reader fields. Every record the endpoint sends them, an answer or an event, carries their own, or nothing where they have no row. The mechanism is Task 2's, in its desk-track commits; its test sits in `test/endpoint/reader-state.test.ts`.
  4. **A member's write** sends no `session.changed` and takes no revision. Their own device learns the change from the `ReaderState` answer, and the owners' views don't move.
  5. **Amended 2026-11-13 (UTC)**, as the session that keeps master ruled (the UX wave's R9; `docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md`). Amended by the UX wave (U9; S-02): a reader's `session.update` whose patch is exactly `{archived: false}` is taken, at `manage`, and answered with the record as `session.get` answers that reader: `index.sessions.get(id, reader)`, the call `session.get` makes, and `session.get` is offered to another machine as a call (`src/endpoint/offers.ts`), so the answer is no wider than a read that reader may already make. `session.rename` under a reader answers its record the same way. Every other patch under a reader, `{archived: true}` included, is refused as before. The handler checks the patch's own keys itself, whatever the endpoint admitted, and the stored answer the ledger replays for a duplicate or a query is that same reading.
  Date/Author: 2026-11-07, O8's executor (controller), on Task 1's NEEDS_CONTEXT; item 5 by the UX wave's U9 executor (M1), 2026-11-13.

- Decision: The architect's rulings on `session.reader.update` (2026-11-07), binding on Tasks 1–3.
  1. **Whose row it writes.** The command writes only the caller's own reader row, and the member comes from the channel's authenticated member, never from the request (the schema has no member field). "Co-owners share" stands: an owner's write lands on the owners' row, the session row's columns, and never on a member row. A non-owner's write lands on that member's own row and never reaches the owners' row or another member's. A test pins both directions.
  2. **An older machine.** On a machine whose endpoint offers neither `session.reader.update` nor the drafts rows, today's in-run fallback stays exactly as it is (`lane-b/read-marks.ts`, `rememberingRemoteDrafts`). No new path is added, and owners aren't split from non-owners. Where the machine offers the rows, they replace the fallback. What's ruled out is a new durable local store of reader state that drifts between devices; the in-run memory isn't one, and deleting it would cost the owner remote drafts and unread marks before a swap.

     No separate non-owner case is needed, because a non-owner and an older machine never meet, by rule. An older endpoint sends the owners' reader fields to any device, and no device-side check can take them back. **So the second member's precondition (P5 Decision Log 235) includes every enrolled machine being on a build that carries M6a's endpoint rule.** The architect adds this to P5's Decision Log at M6a's landing.
  3. **The confidentiality rule, on every surface.** Every record the endpoint sends a member, owner or not, carries that member's own reader fields, or none where they have no row. This holds for answers, `session.changed` events, snapshots, history pages and remote rows. Each surface gets its own test in Task 2, whose commits the desk track reviews.

  The leak isn't live today, because the org has one member, and the second member waits on O8 M6b. The architect states in P5's Decision Log that the rule is part of what that precondition relies on.
  Date/Author: 2026-11-07, the architect, recorded by O8's executor (controller).

- Decision: M6a Task 1, the spine (968e62c34, 72b558be3, 19623e805), settles these points.
  1. **A member's write** sends no `session.changed` and takes no revision. A write by the owners, through either command, announces the change and takes a revision exactly as `session.update` does.
  2. **A new turn** marks unread every member who has a `reader_state` row. The owners' own unread is still set by `source.ts`. A member with no row reads `unread: false`, so first sight isn't unread.
  3. **`bare()`** treats a member's reader state or draft as state to keep, so a record holding either is never handed over to a live process.
  4. **Schema.** The two tables have no indexes beyond their primary keys. `Reader = 'owner' | MemberId` lives in `src/shared/ipc/client.ts`.
  5. **`session.reader.update`** is declared in `REMOTE_UNAVAILABLE` until Task 2 adds its offer row; Task 2 drops that line along with `session.update`'s and the drafts' lines. Its patch schema has no `title` or `archived`, so strict validation refuses a patch carrying either, and an empty one. But `mawsd`'s front reads input with the tolerant reader (`readCommandInput`, `src/shared/ipc/validate.ts:49`), which strips unknown fields, so `{pinned: true, archived: true}` reaches the handler as a pin-only patch; no archive write and no other reader's row is reached (Task 1's review, a Minor). A remote mixed patch is therefore refused `malformed` by the endpoint, on the raw args before tolerant decoding, as M6a's Grades decision says. That's Task 2's, with its test. OX1's tolerance rule is not weakened.
  6. **The seam types.** `endpoint-seam.test.ts` keeps the two seam types equal apart from `dispatch`, which it checks one way (by `extends`). Task 2 restores full equality when it gives `EndpointServices.dispatch` the optional `reader`.
  7. **Enumerated lists.** The O2 profile fixture, the spine command lists and the cross-build sample now include the new tables and command. A guard in `migrations.test.ts` runs every `ADDED_TABLES` entry on a version-9 file.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 1's report.

- Decision: A member's reader change reaches that member's other devices, and no one else's (the architect's design point, 2026-11-07, option (a)). A member's write announces no `session.changed`, so without a notice the member's other devices would stay stale until their next read.
  - **What's built.** When the endpoint has answered a member's successful `session.reader.update`, it sends that member's channels, and only theirs, a `session.changed` carrying the record as that member reads it, re-read through the dispatch with `reader: <member>`. Every field in it goes through ruling (3)'s path. The reader rule is the same as on every other surface, and no wire entry is added.
  - **Owners.** An owner's change already announces through the spine's own `session.changed`, which ruling (3) delivers to each owner with the owners' fields.
  - **Drafts** have no change notice in any root today and keep none; a draft loads when its composer opens.
  - **Rejected:** a spine event keyed by member, which would add a wire entry and a second routing table for what the endpoint already knows (the channel's member). Also rejected: leaving the member's other devices stale, on the architect's lean toward (a) where it is cheap; it is, since the endpoint already projects each record per member.
  - **The test** (Task 2): a member's write on device 1 reaches the same member's device 2 with their fields, and reaches neither another member's channel nor an owner's.
  Date/Author: 2026-11-07, O8's executor (controller).

- Decision: M6a Task 2, the endpoint (d6347dda2, endpoint-only, for the desk track; 80ccbfc65 and ab33757ae, the rest). It settles these points.
  1. **The reader is computed with the authorization decision.** It comes from the owners that decision already read, rather than from a second lookup at execution, since an act may await nothing between its decision check and the ledger. A machine owner reads as `'owner'`; anyone else reads as their own member id. Every `machine` request a channel makes carries that reader. The new file is `src/endpoint/readers.ts`.
  2. **Grades.** `session.drafts.get` stays a call graded `view`, as the registry has it, and not `converse` as M6a's Grades decision said, because a call graded `converse` is refused `act-required` and would have to be a ledgered act. A member's draft row is only ever their own. Rejected: `converse`, which would turn a read into a ledgered act. The architect accepted `view` on 2026-11-07. `session.drafts.set` is a `converse` act, and it's in `KEPT_WITHOUT_ACTION`, so the ledger doesn't store each draft save's document. `session.reader.update` is graded `list`, as ruled.
  3. **The mixed patch** is refused by authorization's existing strict schema check on the raw input, before tolerant decoding. No new code was needed, and a test pins it.
  4. **Surfaces.**
     - Each checkout feed's `session.changed` carries its member's own reading.
     - If a member's re-read fails, the record goes with no reading at all, never the owners'.
     - The feeds' owners hook is optional and fails closed: without it, every member reads as their own.
     - The notice to a member's other devices is a `session.changed` with `cause: 'update'` and the last revision heard, on that member's checkout feeds for the session.
     - Cost: about 15 µs per index read, and about 224 µs against 195 µs per `session.changed` end to end once a member's feed is added beside an owner's. Not measured: the per-event owners read on a delegated machine, where it verifies certificates.
  5. **The notice's reach.** A member's other device hears of a change only while it holds that session's checkout feed open. A sidebar row for a session that isn't open picks the change up at its next read. The architect accepted this as residue (2026-11-07). The owners' path already announces to every device, so the gap touches only a shared-in member's other devices. Its exit is the notice on the listing feed, scoped to that member.
  6. **Main's adapter** takes `session.drafts.set` as a machine act. Task 3 must send one session's draft saves one after another, because acts are decided concurrently.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 2's report.

- Decision: M6a Task 2's fix wave (d5a4ccc3a, 00286c8ef, endpoint plus their tests; 54ceaa543, tests only), on the desk track's round 1 (INCORRECT: P1, P2) and our task reviewer's two Importants. The architect accepted these points (2026-11-07).
  1. **Standing at dispatch (desk P1).** A reader-routed call reaches the machine only while the decision that named its reader still stands, checked in the step that dispatches it. This covers `session.get`, `session.list`, `session.reader.update`, `session.drafts.get` and `session.drafts.set`. A call whose decision moved goes through the gate once more; if it moved again, it answers `unavailable`. So an ex-owner never reads or writes as the owners. Before the fix, `Calls.execute()` had no `stands` check, unlike acts and streams.
  2. **The projection queue's bound (desk P2).** Changes waiting on a reading count toward the feed's backlog, each pending notice as a nominal 1 KiB, and past the limit the feed ends `behind`. Queued work whose feed has closed or ended asks the machine nothing. A change goes to an owner unchanged only while the head and certificates that made them an owner are unchanged; otherwise it's re-read as that member.
  3. **Each surface proven by its behaviour (our reviewer).** `reader-state.test.ts` drives every surface a member is sent through real remote channels, with distinct readings and drafts for the owners, B and D: a lane B subscription's snapshot and events, the checkout and attention feeds, the history pages, and the record's answers. No leak was found. The schema scan stays as a supplementary guard, now reading `pinned` and naming what it can't read.
  4. **`src/services/sessions/stub-source.ts`**, the scenario mode's source, intercepts `session.get`, `.list`, `.update` and `drafts.*` without a reader. No e2e or scenario test asserts reader behaviour through it, so this is a residue row. The exit: the stub carries `context.reader` once a scenario test reads per-member state.
  Date/Author: 2026-11-07, O8's executor (controller), from the fix wave's report.

- Decision: M6a Task 2's second fix wave (2a18c158f, endpoint with its test; 50e7c403e and d0e159f12, tests only), on our task reviewer's re-review. The desk track's round 2 on the first wave (d5a4ccc3a^..54ceaa543) found it CORRECT, with no material findings. The architect accepted these points (2026-11-07).
  1. **An owner's change is checked when it's sent (G1).** Each queued `ev` carrying an owner's change also carries its condition: the head and certificates that made its member an owner. The change leaves the subscription's queue only while that condition holds; otherwise the feed ends `behind`. So a former owner who keeps a share never receives an owners' reading queued for them earlier. It isn't invalidated on `accessChanged`, because a change of certificates alone never reaches that hook. The cost: any head or certificate move while an owner's change waits for credit ends the feed, even if the member is still an owner. That premise, that a `behind` reopen loses nothing, was wrong (the desk track's round 3, revised 2026-11-07). A reopened checkout feed never read the record again: `RemoteSession.kick()` returns at once while the transcript subscription is open, and the checkout snapshot handler was empty. So the title, pin and holder stayed stale. The bug predates G1 (backlog overflow ends the feed the same way), but G1 made it common. It's fixed client-side in cd5ab7f28 (item 6 below).
  2. **The second move (G3).** If a call's second decision moves too, it answers `unavailable`, and the machine hears neither decision.
  3. **History, proven with real producers (G2).** `session.appEvents` is answered by the real sessions service. `session.history.list` is answered by spine-root's handler (its line copied into the test) over a real `PromptHistory`. Both are seeded, and the test asserts that every member receives the seeded entries.
  4. **The bound's overshoot** (the desk track's note, accepted, no row). The queue bound measures full serialized changes, and the nominal 1 KiB applies only to unread member notices. Like the existing send side, it lets one incoming record overshoot the watermark rather than capping each record.
  5. **Out of M6a.** A change of certificates alone calls `streams.recheck()` but not `subscriptions.recheck()`. This predates M6a, G1's fix doesn't depend on it, and the architect has put it to the desk track as its own question.
  6. **A reopened checkout feed reads the record again** (cd5ab7f28, main only, the desk track's round 3, P2). In the replay branch, the client reads `session.get` under its own member, which the reader rule projects, and hands the result to `recordChanged`. A record the feed told while the read was out wins over the read's answer. The read sits beside the watch replay, not in its per-machine queue. This covers both causes of `behind`: G1's head move and a backlog past its bound.
     - The integration test (`test/lane-b/remote.test.ts`) queues the change behind a recheck hold, not at zero credit as the desk track asked, because the real client grants its own credit.
     - `remote-checkout`'s unit case and the real-stack case both failed before the fix.
  7. **The certificates parity fix** (65e0532b1, endpoint only), which the desk track asked for, is outside M6a's reader work. A certificate set changed under the same head now rechecks every subscription and resumable cursor, as a new head does, beside the streams.
     - A caps refresh needs no recheck. Apart from a new head, which already rechecks, it fires only when a grant is kept, and a subscription's decision reads no machine right.
     - The desk track's suggested test (a contested certificate ends an owner's subscription) would pass without the fix, because contesting this machine's own certificate also removes its standing, which closes every channel `removed`. The test instead holds a live subscription across a certificate change and checks that it is authorized again. It failed before the fix.
     - In practice the fix only closes the short window before that async standing check lands, and keeps the two paths consistent.
  Date/Author: 2026-11-07, O8's executor (controller), from the second wave's report and the architect's rulings.

- Decision: M6a Task 3, the renderer (c3db6ff24; 166197fa4 a test's type), settles these points. The architect accepted them on 2026-11-07.
  1. **How the device learns what a machine keeps.** It learns from the machine's answers to the three commands. Any success means the machine keeps the rows. `not-offered` means it refuses them. A refusal is forgotten at `artifacts.resync`, so a machine updated mid-run is asked again. No capability or endpoint change was needed.
  2. **The fallback stays as it is (ruling 2).** `read-marks.ts` still records marks everywhere. Its overlay onto the record is skipped only where the machine keeps the rows, so an older machine never loses a mark while the device is still learning.
  3. **Seen on screen.** A remote session that comes on screen is marked seen on the machine. It's marked again whenever a record arrives saying unread while the session stays on screen, because `session.setVisible` isn't offered remotely. It shows as read at once.
  4. **Pin on a remote lane B session** is offered unless its machine refused. This follows from M6a's scope, not a new surface: `pinned` is part of the reader state approved for M6a, and M6b's live proof needs "B pins" (the architect confirmed).
  5. **Draft saves** are serialized and coalesced per session, so only the newest waiting save is sent. A load while a save is pending, or after a save that failed, returns that save's draft. That's in-run memory, not a durable store. A spawn's handed draft stays in memory and loads first; the first save replaces it on the machine.
  6. **The `ReaderState` answer** is applied to the record held without moving its revision. The machine's later `session.changed` replaces it.
  7. **At the gate:** if `e2e:remote`'s read/unread cases (the M8 scene around `remote.spec.ts:1901`) fail or show flaky on this branch, that's red, to be fixed, not explained. The bug to look for is a late `session.changed` flipping a seen row back to unread (the architect, 2026-11-07).
  Date/Author: 2026-11-07, O8's executor (controller), from Task 3's report.

- Decision: M6a's branch-review wave (167585c9e F1, 77413c1db F2, a3f4eb8d0 F3, 2a7fd43ef F4). It covers the desk track's review of Task 3 (one P1, three P2s) and our reviewer-medium on the branch (two P2s, the same as F1 and F3, plus F3's read side). The architect ruled all of them (2026-11-07). No disclosure across readers was found.
  1. **F1: a pending timeout no longer releases the next draft save.** What decided it: the act's outcome never reaches the renderer after main's `timeout`. `settle()` returns `pendingResult` (`remote.ts:474-480`, `remote-outcomes.ts:76`) and only logs the late outcome, and `session.drafts.set` isn't an operation, so no receipt reaches the page. So the fix is machine-side, a compare-and-set.
     - `session.drafts.set` takes an optional `replaces`, folded into the unreleased `WIRE_MINOR` 31.
     - The spine refuses a stale save, with `STALE_DRAFT_WORDS`, in the write's own transaction.
     - The renderer reads what is kept after a timeout or failure, and retries a stale save on top of the newer one, up to three times.
     - The compared revision is the draft's writer-stamped `updatedAt`, compared on the machine for identity only and never ordered, so two devices' clocks never meet. Rejected: a machine-assigned number, which would need a new `session.drafts.set` output (a wire break) or a read after every save. The architect accepted this deviation from "a revision the machine assigns" (2026-11-07): it keeps the reason given, since no two devices' clocks are ever compared. Also accepted is the known hole: two different drafts stamped in the same millisecond look identical, so a save replacing one could land over the other.
  2. **F2: a reader reply can't overwrite newer feed records.** Each session with a write out keeps a generation, moved by every write and every record the stores take for it. A reply is shown only if the generation hasn't moved.
  3. **F3: the text of a draft always persists.**
     - `@shared/sessions/draft-fit.ts` fits a draft to `REMOTE_INLINE_MAX_BYTES`, measured with the base64.
     - On save, the text always goes. Attachments that don't fit stay in this run, and the composer shows a warning toast once per set left out.
     - On a remote `drafts.get`, the spine leaves out what doesn't fit and names it, and the renderer says so.
  4. **F4: resync reconciles what's on screen.** At resync, each of that machine's sessions on screen is marked seen again.
  Date/Author: 2026-11-07, O8's executor (controller), from the wave's report.

- Decision: The branch-review wave's follow-ups (36658082a K1, f8705abf3 K2, 011af4382, e5b7717dd and aafb6be61, the enumerating test). These come from reviewer-medium's re-run, which found two P2 data-loss paths, and from the architect's call for one enumerating test over the draft path (2026-11-07). The desk track found the wave itself correct.
  1. **K1: a clear keeps a tombstone.** A clear writes a tombstone row whose stamp the machine mints, so a late save that replaces `null`, or the old stamp, is refused as stale.
     - The tombstone is marked by `attachments = 'null'`, not by a null `doc`, because a real draft can have a null `doc`.
     - Only a remote read exposes it, as `{doc: null}`. Local reads and `DraftStore.get` still answer `null`.
     - Every clear writes one, this Mac's own composer clear included. A cleared draft doesn't stop a record from yielding.
     - The stamp contains `#`, so a future reader that orders by `updated_at` must allow for it.
  2. **K2: a transport omission is never a deletion.** A save names the attachments its fitted read left on the machine, by `{id, name}`, and the spine restores them. A save that doesn't name an attachment removes it, which is the explicit removal. This needed no endpoint hunk and no schema change. The regression runs the round trip through `register`, the endpoint and the renderer.
  3. **The enumerating test found one more loss.** Two saves both answered `timeout`, and then the older one landed late, so the machine kept the older text. Fix: after a `timeout` with nothing newer waiting, the renderer resends the newest draft after 15 s, at most three times. On a link that keeps timing out, that's up to three extra acts per edit.
  4. **The enumerating test** is `test/lane-b/drafts-enumerated.test.ts`. It uses the real `DraftStore` and `remote-drafts.ts`, an alphabet of 6 events, and every order up to 5 events, for an owner and a member, starting from a kept draft and from none. It runs in about 13 s. Two invariants:
     - (i) the machine never ends on a draft older than the newest the user produced;
     - (ii) no attachment disappears without an explicit removal.

     Before the fixes, it failed 361 of 1,650 orders per reader from a kept draft (58 on (i), 320 on (ii)) and 158 from none. It now passes with no failures. A 7-event probe that also fires the resend timer was green locally, but at 41 s it isn't committed.
  5. **L1 (reviewer-medium's last pass, 2e822d884).** An attachment dropped only by a save's own fitting was not named for preservation, so a stored PDF that fit the read whole was deleted on the machine once a text edit took the save over the budget. Now the save names those too, alongside the read's withheld ones. The machine's restore only brings back ids it holds, so naming one it never had is harmless. One the person removes in the composer isn't named and is still removed.

     The enumerating test missed this because its alphabet had no event that crossed the budget. It now has a `grow` event (7 events, every order up to 5: 5,094 runs per reader from a kept draft). With the fix stashed, 822 of those runs failed. It runs in about 20 s alone. The desk track found L1 correct, which completes its check of every draft-path change on M6a. Its non-blocking note, accepted: the second note is added after `fitDraft` has measured the draft, so a save can go over `REMOTE_INLINE_MAX_BYTES` by a few dozen bytes per withheld attachment. That stays well inside the bound's 64 KiB headroom.
  Date/Author: 2026-11-07, O8's executor (controller), from the follow-ups' report.

- Decision: The client re-read's ordering and retry (16f310a0d, main only; the desk track's round-4 follow-ups, checked correct, which closes that thread).
  - **Ordering.** Each reopening's read and each told record take the next number from one shared generation counter. An answer applies only while its generation is still the latest, the feed is still mine, and it's live.
  - **Retry.** A failed read asks again under the same generation, from `feedRetryMs[0]` and doubling up to the `feedRetryMs[1]` cap, for as long as it stays current. The delay is capped and the number of tries isn't, as with the feed's own `unavailable`.
  - **A permanent refusal** of `session.get` on an admitted feed re-asks every 30 s, with a log line each time, for the feed's life. That's residue: the exit is to stop, or to end the feed, on a refusal that isn't transient (`forbidden`, `not-offered`).
  Date/Author: 2026-11-07, O8's executor (controller).

- Decision: M6b's refresh at its cut from master `48e0ed15a` (2026-11-07, after M6a landed as #518). M6b's consumed interfaces were reconciled against master.
  1. **Cited lines.**
     - Still holding: the Toolbar's session actions (`SessionMenuOverflow`, `Toolbar.tsx:218-241`, which now also reads M6a's `useReaderRowsOf`); `step-up.ts:11-31` (`record.*` already requires step-up, at :14); `action.ts:30-47` and `:108-122`; `listings.ts:17-20`, with the asker's listing at `:181-207`; `direct-listener.ts:1-5`; and the roster's exclusion of the local ref, which is `src/main/machines/remote/source.ts:47-56` (`rosterOf`, `if (ref === local) continue`).
     - Moved: channel authorization's presence step is at `authorize.ts:492-505`, after M6a's reader work. `members.ts` is `src/endpoint/rl10/members.ts`. `ActRequest` and `executorOf` are at `src/main/machines/remote/acts.ts:40-53` and `:137`, and `ActRequest.action` already names "O8's 'record.*'". `rows.ts`'s replace rule is at `:365-374`.
  2. **What sminos already says.** `test/endpoint/rl10/conversation.json` has sminos's hello carrying `["audience", "record"]` (sminos 1.38.0 and later) and the endpoint's welcome carrying `["access", "reach"]`. So M6b's welcome change is one capability added to the welcome lines, and their blob hash goes to the desk track before the PR.
  3. **What M6a changed underneath.** Channel authorization now names a reader and checks again at dispatch, for the five reader-routed calls. `record.policy` is a new call. It reads the member frame, not the reader rows, so it isn't reader-routed, but it answers only for sessions the caller owns. The local door's `call` answers as the machine owners' member, as §M6b says.
  4. **The live proof.** The desk track is asked whether O18 M6's staging harness can supply the second member again (B1, each scene its own Linux user on one devcloud VM), and whether a second run on O18 M6's terms needs a fresh word from the owner. Their answer goes to the architect. Task 4 plans the run on it.
  5. **The parent** is re-pinned at blob `257faf80` (master 48e0ed15a), where Decision Logs 246–248 change nothing M6b consumes.
  Date/Author: 2026-11-07, O8's executor (controller, refresh pass).

- Decision: M6b is built as four tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-high on the branch with a security lens, as the rest's verification entry names.
  1. **The endpoint and the door.** The `src/endpoint` hunks go in commits of their own, for the desk track.
     - The three `record.*` offers and `record.policy`, behind sminos's `record` capability.
     - `targets.ts`'s `record` rule, for either lane.
     - `rl10/link.ts`'s record path: an `rpc` carrying the act as `proof`, refusing `no-session` when no member places it.
     - The welcome's `record`, in the same commit as the offers.
     - The local door, `EndpointModule.local`.
     - `test/endpoint/record-acts.test.ts`.
     - Then, in their own non-endpoint commits: `mawsd`'s `endpoint.local.act` and `endpoint.local.call`.
     - Before the PR, `conversation.json`'s new blob hash and changed lines go to the desk track by `sminos say`, and the architect is told.
  2. **Main.**
     - `src/main/org/policy.ts` (`org.policy.get` and `set`, and M5b's `org.owners.add`).
     - `actMany` and `signActions`: one confirmation per save.
     - `rows.ts`'s channel listings, with two memberships per key.
     - The shared schema and wiring.
     - `policy.test.ts`, `step-up.test.ts`, `rows.test.ts`.
     - From M6a's retrospective: `rows.ts`'s two memberships are state written from two sources over unreliable links, so Task 2 writes an enumerating test over their events (a hub snapshot's rows and completion, a hub `gone`, a delayed older hub `gone`, a channel answer, a channel omission, a higher-revision `gone`, a link drop). Its invariant: a row is drawn exactly while either membership holds at the newest accepted revision, and never blinks across a public → private move.
  3. **The renderer.**
     - The Share sheet.
     - The marks on `ListedRow` and `SessionRow`, and the hover card.
     - The listing-capable menus, and the Toolbar's session actions.
     - `stores/policies.ts` and `copy.ts`.
     - An e2e case seeding the sheet and marked rows, with screenshots.
  4. **The local suite and the live proof.**
     - `test/org/policy.local.test.ts`, on a Miniflare hub with a real endpoint and a sminos stand-in executing the contract.
     - The shared staging run's plan, on the desk track's answer (refresh item 4). The run itself is scheduled by the architect.
  Date/Author: 2026-11-07, O8's executor (controller).

- Decision: M6b's live proof, on the desk track's answer and the architect's ruling (2026-11-07). Task 4 plans it as two layers.
  1. **The harness path stands on its own.** O18 M6's staging harness can supply a second member for everything that member's own keys can do. `addRunMember` (`reach-acceptance.ts:215`) creates `o18-m6-<tag>@staging.invalid` with channel and step-up keys the harness makes, and scene B1 runs as its own Linux user on one devcloud VM. A reference-client channel runs as b1 to A1 over the relay (`reach-items.ts:293`, `b1ToA1`).
     - So B's pin, read and draft are proven through the endpoint calls b1's channel makes under M6a's reader rule, with A's reading and draft read back unchanged through A's keys.
     - The b1 client acts the harness lacks (`session.reader.update`, `session.drafts.get` and `.set`, and M6b's `record.*` where a scene needs them) are M6b's work, in Task 4.
     - The harness can't drive B's MAWS app or browser. An app signs in through Access's login, and an `@staging.invalid` address never receives Access's one-time code. So the owner's sidebar left unchanged as drawn, and B's rows in B's app, are cited from `policy.local.test.ts` and the renderer suites on this layer.
  2. **The real-member steps for B's app sit on top, in a section of their own,** ready if the owner chooses a real second member. The architect has asked the owner. They are the Concrete Steps' 1–2 as written:
     - an email the owner controls, admitted by staging Access (the owner's change);
     - the member added;
     - a second scratch MAWS profile on a GUI Mac, signed into by that person;
     - the VM enrolled with that member as its owner;
     - the admission removed at teardown.
  3. **The terms.** No fresh word from the owner is strictly needed on O18 M6's terms: the VM stays out of production, and the desk track deploys master to staging. The architect puts that line in the scheduling message.
     - The scenes run sminos 1.40.1 or later.
     - O18 M6's VM is gone, so the desk track sets up a fresh one at the slot.
     - The desk track wants `test/endpoint/rl10/conversation.json`'s blob hash and its changed lines before the PR.
  Date/Author: 2026-11-07, the desk track and the architect, recorded by O8's executor (controller).

- Decision: M6b Task 1, the endpoint and the door. The endpoint-only commits are 776b239cd, 727a103e6 and 5c24e83d1, for the desk track. 79dc87205 (shared IPC) and a35f6cf5a (mawsd) are the rest. The architect accepted these points (2026-11-07).
  1. **`record.policy`** is a call graded `list` on the machine. It answers only for the sessions the caller owns at `manage`, keyed by listing id. A session the caller doesn't own and a session with no member frame both answer `unavailable`. So does a frame without a `policyRev`, never a default.
  2. **sminos's absence and capability.**
     - With no sminos connected, the acts and `record.policy` answer `unavailable`.
     - With sminos connected but without `record`, the acts are `not-offered` and `record.policy` answers `{supported: false}`.
     - The check is in the Authorizer's first step, and `draw` checks again.
  3. **`no-session`** stays inside the endpoint as free text. org-protocol's refusal list is unchanged, and main treats `no-session` as a plain refusal string (Task 2).
  4. **Lane B placement.** It goes through the spine (`placeRecorded`) and the members join, never the engine host. A caller who doesn't stand on the session hears `grade`, so no answer reveals whether a session exists: the same rule as M7b's uniform refusals. When several lane B members join one session, the order is: the one on the spine's recorded engine session, then the one not superseded, then a sole member. A lost lane B record act is looked up on lane B.
  5. **The local door** checks, in order:
     1. the action's name;
     2. that a step-up is present;
     3. that the head lists the device exactly once;
     4. the signature.

     Then it takes a channel's route. It waits 30 s for an outcome, then answers `unknown`/`timeout`. `local?` is optional on both module interfaces, so existing mawsd fakes stay valid, and the seam answers `unavailable` until a module is loaded. The door's two commands, `endpoint.local.act` and `endpoint.local.call`, are main-only on `machine.sock`, and the endpoint's own dispatch is refused them. They are machine-owned wire entries at `WIRE_MINOR` 32.
  6. **The welcome's `record`.** `test/endpoint/rl10/conversation.json` moves to blob `790db9cad1ae09a3d541c78b5beb9f6891f02108`. On lines 82 and 298, the welcome's `capabilities` go from `["access","reach"]` to `["access","reach","record"]`. Both went to the desk track.
  7. **The commits don't each build alone.** 776b239cd, 727a103e6, 5c24e83d1 and 79dc87205 each fail the seam's type-parity check (`src/mawsd/endpoint-seam.test.ts:102`) on their own, because the endpoint and mawsd halves are kept apart for review; 776b239cd also lacks `OfferRow.sminos`. The head is green. The architect ruled no squash: M6b lands by merge commit, the gate runs on the merged tree, and the PR body says so.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 1's report and the architect's rulings.

- Decision: The owner's answer on the second member (2026-11-07): "Real member, one sitting (Recommended)".
  The option the owner chose, as the architect put it to them: "As the O8 spec plans. You let a second email you control into staging's Access. Then, in one sitting of about 20–30 min, that person signs into a second scratch MAWS profile through Access. The desk track's harness does the rest, and teardown removes the admission. This is the first live sign-in by someone other than you, which only a real account can test."
  So Task 4's staging plan keeps both layers. Layer 2 is now planned, not conditional.
  1. **Layer 1 stands alone.** The harness's keys-only member covers scene B1 and the b1→A1 channel, with B's pin, read and draft, and A's state read back unchanged.
  2. **Layer 2 is for the one sitting.** It needs:
     - a second email the owner controls;
     - the owner's admission of it to staging's Access;
     - the member added to the staging org;
     - a second scratch MAWS profile on a GUI Mac, signed in as that person;
     - the VM enrolled with the right owner.

     Teardown removes the admission and the member.
  3. **The owner's steps** go in a short list for the architect to hand over: the admission, the sitting's length, and possibly a one-time `cloudflared access login`.
  4. **Scheduling.** The sitting is scheduled when M6b's PR is near its final gate, not before. The scheduling message carries "same terms as O18 M6: the VM out of production, the desk track deploys master to staging". The desk track sets up a fresh VM at the slot, with scenes on sminos 1.40.1 or later.

- Decision: The desk track found Task 1's fix wave correct (desk 633, on 5cc92783f and f443e16cd).
  - **The fixes.** `placeRecord` is the one placement for both reads and acts, and `policies()` reads ownership on the record it places. `#localPolicy` answers only under an `ownersRead` that still stands: three reads, then `unavailable`. `unsupported()` is read again in the step the answer goes out, on both paths.
  - **Nothing leaks.** An unnamed non-owner gets no entry. A named session that exists but isn't the caller's gets the same `unavailable` as one that doesn't exist.
  - **Residue** (the desk track's Minor; the architect files it): `placeListings` waits for each lane B listing's spine placement in turn, so a `record.policy` call without a named session costs one spine dispatch per lane B listing, in sequence. The exit is `Promise.all`. If Task 3's Share-sheet e2e shows the sheet's opening waiting on these placements, it is fixed in Task 3's wave instead, and its endpoint hunk goes to the desk track.
  Date/Author: 2026-11-07, the owner, the desk track and the architect, recorded by O8's executor (controller).

- Decision: M6b Task 2, main (fa42186a5, 237682977, 40b9742e6, 656527ca8, 28eae9dfc). It settles these points, and the architect accepted them (2026-11-07).
  1. **The commands.**
     - `org.policy.get` takes `{machine}` or `{address}`.
     - `org.policy.set` answers `{ok, results, policy}`. The refusal codes are `POLICY_REFUSALS`. A line's reason is the refuser's own word, and `no-session` arrives as a plain string.
     - "Also changed elsewhere": the returned revision is above the base plus 1 for a change, or above the base plus 0 for a no-op.
  2. **One confirmation per save.**
     - `actMany` only signs, and returns one sender per act.
     - `policy.ts` sends the acts in order and stops at the first failure. A send past `ACT_FRESH_MS` is refused `stale`.
     - `signActions` always asks for confirmation; an empty list is `malformed`. A `StepUpSigner` is required.
  3. **Lanes.** This Mac's sessions are lane B. A remote session's lane comes from its row; with no row, a save is refused `no-session`.
  4. **The rows' two memberships.** Each membership is scoped to revisions:
     - an older record is ignored;
     - a failed call releases nothing;
     - a machine answers only for its own sessions.

     `listings.json` gains `shown`, and a file without it reads as hub-held. There's at most one channel call per machine at a time. The channel is read:
     - at link up and at each new head;
     - at sign-in;
     - after each act (`refreshChannel`);
     - every 60 s;
     - and at once on a hub `gone` for a row the channel held.
  5. **The enumerating test** (in 237682977) covers 5,040 permutations plus 16,807 five-event sequences, in about 30 s.
     - Its first run failed 4,284 of 5,040 orders: every order where the channel spoke first, `hubRows chanAnswer` (stuck at revision 10), and `gone11 chanAnswer`.
     - Three mutations show it catches the faults it targets.
     - The architect keeps length 5, since that's what this test proves (M6a's resend fault showed only at five events). The unit gate's four shards absorb the 30 s. If that shard becomes the long pole, the test moves to its own shard; it is not shortened.
  6. **The e2e Org page fixture** answers `set` and `owners.add` `busy`, and leaves `policy.get` to main.
  7. **Private-listing churn.** The endpoint re-signs a private listing on every call. Task 3 finds out whether that churn is visible:
     - an `org.policies.changed` or row-changed broadcast every 60 s;
     - a re-render or reset of an open Share sheet;
     - a flap of unread or of membership;
     - a bump of a membership revision.

     If it is, main dedupes a listing on its content and revision, not its signature, with a test, in Task 3's wave. No endpoint change is needed. If it's only CPU and IPC cost, it becomes residue m6b-r2.
  8. **Free-string line reasons.** Task 3 maps the known `POLICY_REFUSALS` codes and `no-session` to copy. Any other reason shows as one generic refusal line naming the machine, with the raw word secondary (a detail or a tooltip). Nothing outside the known codes ever renders blank, and Task 3's e2e photographs one unknown reason.
  9. **Commits that don't build alone.** fa42186a5, 237682977, 40b9742e6 and 656527ca8 fail the typecheck on their own, and 28eae9dfc fixes them. No squash, as with Task 1. The PR body lists them.
  10. **The review's fixes** (dad52c414 N1, 56eaf7f55 N2, 4d95d25b6 N3; Task 2's frontier review approved, with these three Minors taken).
      - **N1.** A step-up seals the `opCreated` that was in the request when the person was asked. `sign` and `signActions` take it before the prompt and read nothing from the request after it.
      - **N2.** A malformed `done` reads `unknown`, reason `malformed`, and the save stops there, so the remaining lines read `not-sent`. Task 3's copy has a line for it. A `done` line's `policyRev` is no longer nullable.
      - **N3.** The channel memberships, answers and cache are bound to the reader, `(org, member)`, as M7a's and M7b's caches are.
        - When another member signs in to the same org, the last reader's channel memberships are dropped and every channel is read again.
        - An answer asked for the last reader is ignored, and until then `rows()` draws only the hub's rows.
        - `listings.json` records `member`. The channel's rows are restored only for that member; the hub's rows, memberships and marks, which are the same for every member, stay.
        - B keeps the anti-replay marks of A-only sessions, never drawn, so replay protection isn't weakened.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 2's report and the architect's rulings.

- Decision: The real-member sitting (desk 634, with the architect's ruling, 2026-11-07). Task 4 plans it.
  1. **cloudflared.** No login is needed. The owner's staging Access token, the one `staging-run.sh`'s admin and reach steps use, is valid until 2026-11-26T01:36Z and names the owner's staging email. Only if the sitting falls after about 11-25 does the owner run `cloudflared access login https://desk-hub-staging.opencognita-platform.workers.dev` once, before the logout step.
  2. **The Access admission** takes no dashboard step. `staging-run.sh access-sync` (O11 M3) sets staging's Access people policy to exactly the emails of the org state head's members. Once the run adds B to staging's org state, the desk track runs `access-sync` and Access admits B. At teardown B is removed and `access-sync` runs again. The owner's only input is the address itself, sent to the desk track directly, never into a repo or a PR. The records say "the owner's second email".
  3. **A pitfall in B's sign-in.** The scratch profile's org sign-in opens the default browser at the staging hub's `/cdn-cgi/access/cli` (`access-login.ts:194`). If that browser still holds the owner's staging Access session, Access likely completes the transfer as the owner. So just before B's sign-in, the owner opens `https://desk-hub-staging.opencognita-platform.workers.dev/cdn-cgi/access/logout`.
     - That logs out of every Access app on the team, so production desk web asks for sign-in again later. The MAWS apps' org sessions and cloudflared's CLI token are untouched.
     - Until the owner signs back in as themselves, they must not run `cloudflared access login` for staging, or the CLI token would name B.
     - The pass-through is unverified live. The sitting checks it by reading the member email the scratch profile shows before its pairing completes.
  4. **The harness path** (the architect's ruling, keeping "your harness does the rest"). Task 4 adds two harness steps, both signed by the staging admin's test keys, as `addRunMember` is:
     - (a) adding B with the real email, read at run time from a 0600 file outside the repo, never committed or logged;
     - (b) endorsing the second profile's device programmatically.

     A test pins both to refuse any hub but staging's, as O18 M6's harness does. A pairing code goes to a 0600 file, never into chat. The owner's admin flows in the app aren't part of M6b's acceptance. The scratch profile lives under a path Task 4 names, outside the repo, which the desk track can delete at teardown. Launching it is the owner's one command at the sitting, not an Electron app an agent runs on the MacBook.
  5. **Teardown.**
     - The run removes B and revokes the device.
     - The desk track runs `access-sync`.
     - The second scratch profile's directory is deleted.
     - The owner signs back into staging Access as themselves the next time a browser needs it.
     - The VM is a fresh one at the slot, without the MAWS project; its scenes run sminos 1.40.3.
  6. **The owner's steps**, for the architect to hand over:
     1. Send the second email to the desk track directly.
     2. At the sitting, launch the scratch profile with the given command.
     3. Open the logout URL in the default browser.
     4. Sign in with the second email and the code from its inbox, and check the member email the profile shows before pairing completes.
     5. Don't run `cloudflared access login` for staging until signed back in as yourself.
     6. Only if the sitting falls after about 11-25: the one-time `cloudflared` login, before step 3.
  Date/Author: 2026-11-07, the desk track and the architect, recorded by O8's executor (controller).

- Decision: M6b Task 3, the renderer (f4f81e35f, 9d6a52542, 539e8b815, bc22ad7b0, 8f1b003e4, 9ed8353a6, 6546231d2). It settles these points.
  1. **The private-listing churn (Task 2 item 7) was visible.** Every 60 s it sent an `org.rows.changed`, reset the row's age to "now", moved it to the top in recency order, bumped its mark and rewrote the cache. It touched neither `org.policies.changed`, an open sheet, nor unread.
     - Fixed in main (f4f81e35f): a private listing re-signed with nothing new is drawn at the revision and time it was first shown. That changes what the rows draw, not what they accept, so the anti-replay mark still advances.
     - Residue m6b-r2: each period still verifies the listing and writes `listings.json`. After a relaunch, a private row's age restarts from its last re-sign.
  2. **Refusals (Task 2 item 8).** Every known code has its own line in `copy.ts`. Any other reason reads "<machine> refused this", with the raw word beside it. N2's `unknown`/`malformed` reads that the outcome is unknown and the lines after it weren't sent, with a Reload. The e2e photographs both.
  3. **The sheet.**
     - The help lines for Listed, Org can view, Org can talk, View, Converse and Approve are written from RL §6.2. Bound strings keep the spec's straight apostrophes.
     - A machine whose sminos can't keep a reach still offers Share; the sheet reads the bound line and offers only Close.
     - Add person draws on the `org.view` members and defaults to View.
     - Save order: access first, then changes and removals in the policy's order, then additions.
  4. **Where Share is offered.**
     - "Hub project" means a listing with a `project`, or a local project with an `smnsId`.
     - On this Mac, ownership comes from its `record.policy` read.
     - A listed row gets a menu only when Share is offered.
  5. **The e2e case** is `e2e/share.spec.ts` in `e2e:settings`, over a harness-only fixture (`src/main/org/share-fixture.ts`, wired in `app.ts`, which also intercepts `machines.list` and holds the production rows' events). Its six screenshots: the marks, the hover card, the sheet, the sheet after a save, an unknown outcome, and an unsupported machine. Its first run found a real overflow: the sheet's selects pushed each person's row past the sheet. That's fixed.
  6. **`record.policy`'s serial placements (m6b-r1).** The sheet's opening never waits on them, because its read names one session. A save's result does wait: main re-reads the whole machine before answering (`policy.ts:210`). It couldn't be timed on the fixture. It stays residue.
  7. **The unit gate was red at 89d616e78 and nobody saw it.** `coverage.test.ts` lacked Task 1's `endpoint.local.act`, and only static had run on Tasks 1 and 2. bc22ad7b0 fixes it. From here, each task's gate set includes unit.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 3's report.
- Decision: M6b Task 3's review fixes (3c09ac206, df0e5d374, 76b97bdbd, 2ae8fbcac, 9ab1353b5, c1d33c77a, 954c74ded). The frontier review found two Important and two Minor. The architect's taste read of the screenshots added three fixes. This entry settles these points.
  1. **The sheet's order is the order Save sends (I1).**
     - A person removed keeps their place, struck through, with "Removed when you save" and Undo, until Save.
     - A person added and then removed before Save leaves the list.
     - Undo is the only way back for a removed person. The add picker never offers someone pending removal, so nobody appears twice in the order.
     - A test pins the review's sequence (remove Ana, change Ben, re-add Ana): the pending lines shown match the payload line for line.
  2. **A policies read belongs to the sign-in it started under (I2).**
     - Main fences each read on `(org, member)` plus a sign-in generation.
     - A read that ends after a sign-out, a switch to another member, or the same member's new sign-in publishes nothing and answers `signed-out`.
     - The renderer applies replies only under the sign-in they were asked in, and takes no `org.policies.changed` while signed out.
     - The event carries no identity. The architect accepted the fence without it (2026-11-07).
  3. **The cache race in `rows.test.ts` was the test's (M1).** The test read the cache before `close()` flushed its deferred write. Both reader tests now read after `close()`. Nothing in `rows.ts` changed.
  4. **The e2e check that every action is whole covers every control (M2).**
     - It covers fields, native selects, radios, checkboxes, links and their roles. A clipped select joins its probes.
     - It centres each control in its scroller before measuring, and allows a clipping container one pixel, since a scrollport may end mid-pixel. The first run (42419518426) named a select less than a pixel past the body's edge.
     - Org-page and channel pass under the wider check.
  5. **The architect's taste fixes.**
     - Add person sits at the head of People, with the list under it. The label stays "Add person", as the spec words it.
     - Reload is a secondary button. While a stopped save's results offer a Reload, the sheet doesn't also show the "can't be read · Reload" line. When a save's results don't offer one, that line keeps its Reload.
     - The sheet gets a scrim: `Sheet` takes an optional `scrim`. The Share sheet uses `bg-bg-active`, the Add project dialog's scrim, and the other sheets keep the shared `bg-bg/60`.
     - The architect accepted the 8% scrim with no new token (2026-11-07). The empty state's buttons still show faintly below a short sheet, and that is acceptable.
     - The shared scrim is nearly invisible on light theme for the other sheets. That goes on the board with M6b's other UX residue: the unsupported copy should name its remedy, and long machine names truncate in the subtitle. The architect files these at landing.
  6. **Gates.** Run 42420500958 is green: static, unit 1/4–4/4, e2e:settings and e2e:cross-build, every spec on its first attempt.
  Date/Author: 2026-11-07, O8's executor (controller), from the fix wave's report and the architect's notes.
- Decision: M6b Task 4, the local suite and the harness. The commits:
  - d04d960a5, actions-whole;
  - 3c13448dc, `policy.local.test.ts`;
  - 5bcd83565 and aef0c7353, `apps/desk-hub/deploy` only, which go to the desk track for review.

  The architect accepted all of the executor's decisions (2026-11-07). Two of them change earlier text. The rest settle these points.
  1. **Every widening in the reach scenes is A's record act. This changes the harness as O18 M6 left it.**
     - From sminos 1.39.0, once an endpoint's welcome says `record`, sminos refuses widening at the terminal and at the agent shell ("use MAWS", `sminos_visibility.py`'s THROUGH_APP), and keeps narrowing. Every M6b build says `record`. So O18 M6's scenes, which widened at the terminal, would break on M6b. Their README said "the branch's cut, before O8 M6b".
     - Every widening now goes through A's `record.access` or `record.shares` act over A's relayed channel, and every narrowing stays in the shell. That is the product path, so the scenes prove it rather than route around it.
     - Item 8 expects THROUGH_APP's refusal. Item 4's Can message share is A's act, and item 8 runs again rather than being cited.
  2. **"Endorse the second profile's device" becomes "list it unendorsed". This overturns the wording of the ruling in "The real-member sitting", item 4(b).**
     - An admin can't endorse another member's device: endorsement is that member's own step-up signature (P5 Decision Log 34; `src/main/org/edits.ts:70`, the path `sign-in.local.test.ts` proves). So the protocol lists another member's first device unendorsed.
     - The ruling's intent holds: B's device takes no owner step.
     - The architect, 2026-11-07, who made the ruling without that fact.
  3. **`real-member add | pair | remove` is a deploy command of its own.**
     - It is not `admin pair --member`. `admin pair` pairs the admin's own device, endorses it with the admin's key, prints its code and confirms at `/dev/tty`.
     - `real-member` reuses org-protocol's `judgeEntry` and `pairingFingerprint`. `staging-run.sh real-member` hands it the token on stdin.
     - The refusals:
       - a hub that isn't staging's, refused before the admin device opens;
       - an email file that is not a regular 0600 file of the user's, is a symlink, or has a `.git` in any ancestor;
       - a code file that already exists or lies in a checkout;
       - adding the admin's own email or an existing member's;
       - pairing a member who already lists a device;
       - removing an admin.
     - The email and the code are scrubbed from every line, the hub's own text included. They are also added to `--scan`, and `secret_scan` fails the run if its log holds either.
  4. **The pitfall's guard.** `pair` reads `GET /api/devices/pending?member=<B>` (H1), so an entry posted under the owner's Access identity is never listed for B. The step times out instead.
  5. **The scratch profile** is `~/.local/share/maws-m6b-second-member`. The name is fixed, not `mktemp`, so teardown can name it. `MAWS_USER_DATA` sets it (`src/main/index.ts:22`), as M1's sitting did.
     - Its mawsd outlives the app and has no stop verb. Teardown names its pids with `pgrep -f` and ends them with `kill -TERM`, not `pkill`, which auto mode refuses in some sessions (the architect).
     - The owner copies the pairing code with `pbcopy < <file>` and never displays it.
     - A dialog macOS raises at the first launch is the owner's to answer. No agent clicks one.
  6. **The scenes.**
     - Lane B runs on A1 only. M6a's reader offers are lane B's, and A1 is the scene the reader item needs.
     - The sminos floor is 9a694999 (1.40.1), and the default is a3d4a8f8 (1.40.3).
     - The capability is read once from A1's `audiences.json`, which is written at welcome.
     - The new items are `m6b-cutover` (after item 8), `m6b-visibility` and `m6b-reader`.
  7. **`policy.local.test.ts`**, five cases on the Miniflare hub with a real endpoint and a sminos stand-in executing §Q. It is registered in node-timing.
     - B is added with no devices. B's app registers from a code naming B, and is listed unendorsed.
     - `ROWS_CHANNEL_MS` is a 1 s timing seam.
     - The stand-in answers the admission query from its own ledger, refuses a bad shape or a missing session, and sends the member frame before `rpc-result`.
     - Discovery: `rows.ts` draws only roster machines (`rows.ts:626`).
  8. **actions-whole** exempts only a form's mirror input: a control under `aria-hidden` that also has `tabIndex < 0`, `pointer-events: none` and opacity 0, all four together. Probes cover a visible clipped button under `aria-hidden`, which must be named, and a clipped mirror input, which must not be. This closes Task 3's re-review Minor.
  9. **Not verified live.** These are the shared run's checklist (Concrete Steps):
     - lane B inside the reach scenes;
     - record acts over the relays;
     - pairing through real Access with a second identity;
     - the profile daemon's teardown.
  10. **Gates.** Static is green after each commit: 42423743780, 42424222843 and 42425038671. Run 42425644208 (static, unit, e2e:settings, on the hosted lane) is green on its first attempt.
  Date/Author: 2026-11-07, O8's executor (controller), from Task 4's report and the architect's notes.
- Decision: M6b Task 4's review fixes. The frontier review found five Importants and two Minors. The desk track's desk 641 found layer 1 (5bcd83565) clean and raised four P2s on layer 2. Three of those overlap the review's; the fourth is new: refusals echoed the email file's path. The fixes are 3c8fb5cdc, d0c031dbf, 23b88d6cc, a3954e3f3, 3c8d1b1e9 and fc6aff4cc in layer 2, a21c6e561 and 665e938e6 in layer 1, and f6246b4a3 in the app. They settle these points.
  1. **The email file is opened once.**
     - The open is `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`. `fstat` on that descriptor checks its type, its owner and a mode of exactly 0600 (`& 0o7777`), and the text is read from the same descriptor.
     - The checkout check runs on `realpath(path)`, whose dev and ino must equal the descriptor's. A swapped file is refused.
     - A swapped parent directory is out of scope, since the file sits in the desk track's own home directory. The function's comment says so.
     - A refusal before the email is registered as a secret says "the email file", with no path or directory (055778370, desk 642 (a)). A directory named after an address would otherwise print it.
  2. **The pairing-code file is removed on every exit.**
     - It is created with `O_CREAT|O_EXCL|O_NOFOLLOW`, and its removal is registered at once through `withExitCleanup`. That mechanism was extracted from run-lock's signal cleanup, which `withRunLock` now builds on.
     - It covers SIGINT, SIGHUP and SIGTERM, which exit 128+n; a write that fails partway; a throw; and the end of the wait.
     - `staging-run.sh` doesn't remove the code file itself (5ce55a8b8, the second wave). A shell-side removal judged by absence at the start could delete a file another run had made in between, as the re-review and desk 642 (b) found. So only node removes the file. A file a SIGKILL leaves makes a retry refuse with EEXIST, which is visible and safe.
     - This matters at the sitting: the desk track runs `pair` in the background and stops it with SIGTERM.
  3. **Scrubbing.** `remove` registers the member's email as soon as it resolves the member, by `--member` too. The printer, `scrubbingIo`, matches case-insensitively.
  4. **Removal from a stale head.**
     - The revocations and the admin check are derived inside the edit `amend` replays, from the head being edited.
     - A device the edit has no key id for (one listed in the meantime) makes the edit post nothing, and `remove` reads again and retries, up to 3 times.
     - An admin in the edited head is refused. A member gone from it is nothing to remove.
     - The desk track's alternative, refusing when the device ids changed, also met the intent. The architect preferred deriving from the edited head.
  5. **The sminos stand-in holds each record rpc to its proof's binding,** independently of the endpoint, as `sminos_rpc.py`'s `proof_refusal` does:
     - the proof passes `isAction`;
     - its name equals the rpc's;
     - its signed target and change equal the frame's;
     - its machine and device are the run's.

     Its lane B check is stricter than sminos's: `appSessionId` must resolve to the rpc's `session`.

     On top of `isAction`, it requires exactly a record act's fields, sminos's `ACT_KEYS` (a80ae3eaa, the second wave): `stepUp` must be present, `webauthn` is the only optional extra, and `session`, `context` and `requestDigest` are refused.

     Five probes tamper with the rpc between the endpoint and sminos: a different change, a malformed proof, another machine's proof, `stepUp` stripped, and a `requestDigest` added. Each is refused `bad-shape` and shows on A's save, with the record unmoved.
  6. **Layer 1's assertions.** `m6b-visibility` reads each level back through A's `record.policy`. `m6b-reader` compares B's whole reading, `lastSeen` included.
  7. **Gates.**
     - 42429105079 was red on `native/session-host`'s reap-record race. Master's #517 (6f89f9d11) fixed that race, and this branch predates it, so master's merge before the final gate carries the fix.
     - 42430122324 and 42430267448 were red on a TS2339 in a test, which fc6aff4cc fixes.
     - 42430515249 at fc6aff4cc (static, unit, e2e:settings and e2e:cross-build, on the hosted lane) is green on its first attempt.
     - The second wave is green on first attempts: 42431972737 and 42432068815, then 42432343440 at 055778370 (static, unit and e2e:settings, on the hosted lane).
     - The gate's 58 advisory spec-import warnings are copied in the task report. The PR body carries them.
  Date/Author: 2026-11-07, O8's executor (controller), from both fix waves' reports, desks 641 and 642, the re-review and the architect's notes.
- Decision: M6b's branch review (reviewer-high, with a security lens, over 48e0ed15a..7405d3629) found three P2s. The architect accepted all three fixes (2026-11-08).
  1. **A save belongs to the sign-in it started under** (eaafe05af).
     - `save()` captures that sign-in, using the same generation fence as the reads. It checks the sign-in still stands before Touch ID, before each send, and before the read-back.
     - Before this fix, a sign-out followed by any new sign-in let the unsent lines go out with the first member's signed acts. The local door accepted them, since that member's device was still listed in the head.
     - A sign-out before Touch ID refuses the whole save `signed-out`. A sign-out after Touch ID makes the first unsent line read `refused signed-out` and the rest `not-sent`. A later sign-in, even the same member's, never sends them.
     - A stopped save returns no policy.
     - The door's own signed-out check, which answered `offline`, is gone. The save's fence covers it.
  2. **The Share sheet closes when its reader changes** (df906b6e9).
     - The sheet remembers the member it opened for. When `useHubAccess.member` changes (a sign-out, a lost registration, or another member), it renders nothing and closes. Its reload and save callbacks are fenced, so a late reply draws nothing.
     - It closes rather than rekeys. A sign-out and a sign-in as the same member pass through "signed out", so it closes then too.
  3. **`real-member.ts` passes `io.print` to `OrgAdmin.open`** (95be41576, deploy only).
     - It used to pass the unbound global `print`. Under Node, every real `add`, `pair` and `remove` threw a ReferenceError after loading the keys, so the sitting would have failed at its first command.
     - The tests injected `open`, and the deploy tsconfig includes DOM globals, so neither caught it. A test now runs the CLI composition in a Node child: `main(['add', …])` against a faked hub of another org must reach `/api/me` and print the org refusal.
     - The other bare `print`s under `apps/desk-hub/deploy` are parameters or locals in scope, or appear in comments.
  4. **Gates.** Static is green at eaafe05af (42435153749) and df906b6e9 (42435451512). `static,unit,e2e:settings` is green at 95be41576 (42435464666), and all 18 e2e:settings tests passed on their first attempt.
  Date/Author: 2026-11-08, O8's executor (controller), from the fix wave's report and the architect's notes.
- Decision: M6b lands before the shared run. M6b lands on its gates, and the shared staging run, with its real-member sitting, follows from master at or after the merge.
  - The spec read both ways. The rest's plan says the run waits on "M6b's offers on master", which this ruling follows. The owner's launch step assumed a sitting before the landing.
  - The scenes' MAWS is "the branch at or after M6b", and master at or after the merge meets that. M6b changes no hub code.
  - A defect the live run finds becomes a fix PR, as for M7b's live check.
  - Rationale: the owner's time. The sitting can't come before about 23:00 PST on 2026-11-08 and waits on the owner's word. Holding the PR for it would idle M4b and the rest.
  - Rejected: holding the PR for the sitting, as O18 M6 did. That sitting's date was fixed in advance; this one waits on the owner's time.
  - **Amended 2026-11-08, the architect.**
    - The owner answered, verbatim: "any time. I'm all available, js tell me when from your side".
    - So the shared run starts now, during the final gate, on the branch head. That is "at or after M6b": 1d4204118 carries 169108598's gated code and differs only in the report.
    - The landing doesn't wait for the run unless the run finds a defect. A defect it finds is fixed before landing.
    - The sitting launches from the architect's prepared worktree at that head.
  Date/Author: 2026-11-08, the architect, recorded by O8's executor (controller).

- Decision: M4b's refresh at its cut (2026-11-08, master bd2b59baa). M4b's section and §R were reconciled against the code; a read-only pass checked every citation. Neither the move nor any grants interface has landed. These corrections bind M4b. Each keeps the section's intent.
  1. **Citations that moved.**
     - The v2 enrollment codec is at `identity.ts:474-510`: the type at 483, validation at 488-501, the encoder and decoder at 503-510. It uses `checkHub` (399) and `body` (413).
     - The enrollment-key poll is `registry.ts:1460-1467`. It answers `unknown-enrollment`, `not-yours` or `no-key`. It doesn't recheck the admin role, so `403 not-admin` is not one of its outcomes. `createEnrollment` is at 295-324.
     - The live signature check is `signedBy` (`records.ts:48-52`). `signedByIn` is 66-69.
     - The other citations still hold: `admin.ts` 878-946, 924-943 and 1100-1131; `records.ts` 72-105; `grants.ts` 38-51 and 56-65; `endpoint-actions.ts` 15-18 and 103-108; `store.ts` 286-300; `enroll.ts` 208-225.
  2. **The on-machine command** is `mawsd enroll`, with the code pasted at its hidden prompt, and `--replace` when the machine still holds an enrollment. It is not "`mawsd endpoint enroll <code>`": the parser refuses a code argument, and it would put the secret on the command line (`src/mawsd/cli.ts:473-498`, `enroll.ts:82-90`). The sheet's line says so.
  3. **The name checks.**
     - Before the mint, the composer refuses a name already listed, unless it is `replace`'s own, and a name inside a delegation's prefix.
     - The permanent name/ref binding (`machineNames`) can only be judged once the candidate's ref is known, so it is checked at the candidate and again at approval, as `admin.ts:928-931` does.
     - The refusal codes are the package's where it has them: `machine-name-taken`, `machine-names`, `prefix-names-machine`, `owners-unknown`, `shape` (`org-state.ts:87-125`).
     - The mint's replace argument is the machine's **name**, and it needs an active hub row (`registry.ts:305-308`).
     - The mint's TTL is 3600, the maximum the hub accepts. The CLI's default is 900.
  4. **Delivery.**
     - `endpoint.grant` goes as an act with `stepUp: 'never'`, as M3's deliveries send self-signed records (`deliveries.ts:307`). `none` is not an `ActRequest.stepUp` value.
     - A grant intake refusal such as `not-newer` arrives as `{state: 'failed', error: {code}}`, over the link and through the door once the door has passed the grant (`src/endpoint/actions.ts:116-120`, `src/main/machines/remote/acts.ts:154-159`; corrected 2026-11-08 from "inside a `done` whose result is `{ok: false, error}`", which Task 2's decision 6 and Task 4 found wrong). The door's own refusal is `{state: 'refused', reason}`. An orphaned op reads `unknown`/`expired` at the link (`acts.ts:467-485`).
  5. **Signing a grant is not a state signing.**
     - `RecordSigner` is new. It reuses `Confirm` and `StateSigner`'s canonical-copy and `live` behaviour (`step-up.ts:209-248`).
     - It is not routed through `OrgSigner`, `signActions` or `actMany`. Those sign root states or outer transport actions, and either would add a wrong confirmation or signature layer.
  6. **`grantProblems`** returns its own async diagnostics, not the successor-only `Problem` union. It keeps `verifyGrant`'s verdict order and its revoked-signer semantics.
  7. **Wiring.**
     - The main composition is in `src/main/app.ts` (312-388), not `index.ts`.
     - New commands also join `register.ts`'s production and development lists (89-105), and the session's wrapped `signerHub` (`org-session.ts:805-822`).
     - Enrollment and grants join `close()` in its current order (`org-session.ts:1710-1742`) and the sign-out fence (1663-1697).
     - `orgView` gains the certificate set, so certified machines appear.
     - `page-fixture.ts`'s answer map gains the grants and enrollment answers for the e2e case.
  8. **`grants.json` fails closed by an explicit rule.** `files.ts`'s `read` collapses missing, unreadable and malformed files to null. So `grants.json` takes `signing-store.ts`'s marker model (45-109) to tell a pristine absence from damage.
  9. **Tests.**
     - `apps/org-protocol/test/enrollment.test.ts` and `records.test.ts` are new files.
     - `verifyGrant`'s unchanged-verdict proof is the existing vector replay (`vectors.test.ts`), the grant scenarios (`vectors/scenario.ts:743-770`) and `attest.test.ts:41-44`.
     - `org-page.local.test.ts`'s cases 7-11 recreate member B, since case 6 removes B, and the suite's signed-change and prompt totals move with them.
     - `local-org.ts`'s `enrollEndpoint` stays a setup helper, because it bypasses the app's enrollment. Case 7 enrolls through the app.
  10. **No new machine-drop delivery is needed.** M3's `endsKeys` already covers a key that is retired or revoked (`deliveries.ts:96-103`).
  11. **The endpoint call's footprint** is `src/endpoint/grants.ts` (the ledger projection, and members read from the head, not from the surviving grants), `offers.ts`, `calls.ts`, `endpoint.ts` (the callback's injection at `new Calls({...})`), and `test/endpoint/grants-call.test.ts`.
     - `channel-view.ts` and `authorize.ts` don't change.
     - `endpoint.ts` is also edited by the channel-reach fix (P5 Decision Log 251), so the architect is told before it is edited.
     - `record.policy`, the pattern to follow, has no `sminos` offer gate, and `endpoint.grants` takes none.
  Two forks went to the architect: whether this Mac's own machine gets grants through the local door, and who sees Grant…, by `verifyGrant` eligibility or by `maySign`. Task 3 waits on the rulings.
  Date/Author: 2026-11-08, O8's executor (controller).

- Decision: M4b is built as six tasks under subagent-driven execution, each reviewed at its frontier. Then reviewer-high reviews the branch with a security lens, as the rest's verification entry names. The desk track reviews every `apps/org-protocol`, `apps/desk-hub` and `src/endpoint` hunk, in commits of their own.
  1. **The move and `grantProblems`.** The v2 codec and its validation go to `apps/org-protocol/src/enrollment.ts`, and `certificateViews`, `resolveMachine` and `machineRows` to `apps/org-protocol/src/machines.ts`. The package's structural input row is not `admin-machines.ts`'s output `MachineRow`. Then `grantProblems`, with `verifyGrant` built on it. The admin suites pass unchanged, `pnpm --filter desk-hub build` stays clean, and the strip-types import line holds.
  2. **`endpoint.grants`**, with its test. Master is merged in before `endpoint.ts` is edited.
  3. **Main's machine edits and enrollment.** `edits.ts`'s four kinds, `enroll.ts`, `hub-client.ts`'s three routes, the schema (`OrgView.machines`, `OrgStatus.registered.enrolling`, `org.enroll.*`), `view.ts`, the wiring, and their tests.
  4. **Main's grants.** `RecordSigner`, `grants.ts`, `grants.json`, delivery, the missing-grant judge, `org.grants.*`, and their tests.
  5. **The renderer.** `MachinesGroup.tsx`, `EnrollSheet.tsx`, `GrantSheet.tsx`, `ChangeSheet.tsx`'s machine fields, `copy.ts`, `page-fixture.ts`, and `e2e/org-page.spec.ts`'s seed and screenshots.
  6. **The local suite.** `org-page.local.test.ts`'s cases 7-11.

  Each task's gate set includes unit (M6b's lesson). From M6b's retrospective, each task's tests end the owning sign-in, head or process mid-flight wherever state outlives a confirmation.
  Date/Author: 2026-11-08, O8's executor (controller).

- Decision: The architect's rulings on M4b's two forks (2026-11-08).
  - **Fork B: Grant… follows `verifyGrant`'s eligibility, not `maySign`.**
    - Grant… shows when `grantProblems` would admit this device's step-up kid as the signer for this machine.
    - Enroll, Owners and Drop, which change the org state, stay read-only without `maySign`.
    - The deciding case: most members aren't admins. `maySign` means a root, and a typical member is a non-root owner of their own Mac. Gating Grant… on `maySign` would leave that member unable ever to grant rights on their own machine. That contradicts M4b's own rule ("an owner of the machine, or an admin when its owners are `'org'`") and P5's privacy model, in which each person controls their own machine.
    - Rejected: gating Grant… on `maySign` as well. It is simpler, but it shuts out the ordinary owner.
  - **Fork A: M4b extends the local door with `endpoint.grant` and `endpoint.grants`.** Fork B forces this. A non-root member with one Mac has no other device, so pointing them to one would leave the only machine they own with no way to grant on it, failing acceptance 4b for that machine.
    - **The boundary barely moves.** A grant carries its own signature, and the same signed grant is already accepted over any link with `stepUp: 'never'`.
    - **What the door admits.** It admits `endpoint.grant` only when the grant passes `verifyGrant` against the endpoint's held head, checked at the door before dispatch. It asks no act step-up signature as well: the grant's signature is the authority, and a second Touch ID adds nothing. Everything else outside `record.*` stays refused.
    - **Reads.** `endpoint.grants` through the door's `call` answers as the machine owners' member, as M6b's `record.policy` does.
    - **Main.** Main's grants use the door when the target is this Mac's own machine and the link otherwise, as `policy.ts` does.
    - **Review.** This is part of Task 2's endpoint commit. The desk track reviews it as an amendment to M6b's door rule ("the local door takes the three `record.*` acts only").
    - **Tests:**
      - a forged or ineligible grant is refused at the door;
      - a valid grant is stored;
      - `grants` is read through the door;
      - one local-suite case grants on this Mac's own machine.
    - Rejected: keeping the door closed and pointing to another device, which strands the single-Mac owner.
  - **The `endpoint.ts` collision.** Task 2 follows the move and merges master before editing `endpoint.ts`. If the channel-reach fix hasn't landed by then, the hunk stays at the one injection site, and the architect is told before the commit.
  - **The refresh's corrections** are all accepted. That includes the enrollment sheet's line, which names `mawsd enroll` with its hidden-prompt paste, and `--replace` for a machine already enrolled.
  Date/Author: 2026-11-08, the architect, recorded by O8's executor (controller).

- Decision: M4b Task 1, the move and `grantProblems`. The commits are 099c7cf77 (the move), 0ad9a8ff5 (`grantProblems`) and b2ddf6b1d (a type-only fix to it), all `apps/org-protocol` and `apps/desk-hub`, for the desk track. They settle these points.
  1. **The v2 codec** (`EnrollmentCodeV2`, its encoder, decoder and validation) moves unchanged to `apps/org-protocol/src/enrollment.ts`.
     - Its two helpers, `checkHub` and `body`, are copied in as private functions, because the hub's v1 codecs still use them. Exporting them would set a second hub check with other rules beside `isHubOrigin`.
     - `identity.ts` re-exports the codec, so its importers don't change. `admin.ts` imports it from the package.
  2. **The machine helpers.** `certificateViews`, `resolveMachine` and `machineRows`, with `CertView` and the table's `MachineRow`, move to `apps/org-protocol/src/machines.ts`. Their input is a new package row, `HubMachine`, which the hub's `MachineView` satisfies. `resolveMachine` is typed on it, not made generic, because `admin.ts` reads only the name. `admin-machines.ts` keeps `table`.
  3. **`grantProblems(state, certificates, body, signerKid, now?)`** returns `Promise<GrantProblem[]>`, its own union, so §R's `-> Problem[]` reads that way.
     - The codes are `malformed`, `unknown-rights`, `other-org`, `member-not-listed`, `machine-contested`, `machine-not-listed`, `machine-key-not-current`, `signer-not-owner` and `signer-revoked`, in `verifyGrant`'s order.
     - It collects every problem rather than stopping at the first, except after a shape failure, a contested machine, or a machine with no known owners.
     - `verifyGrant` is now shape, then the first problem as its verdict, then the signature. Its verdicts and their order are unchanged, revoked signers included.
     - One cost moves: a grant whose member isn't listed is now judged against the machine's certificates before it is refused. The cost is bounded by the endpoint's own certificate set, and the architect accepts it. A first-problem mode could restore the early exit if the desk track asks.
  4. **Evidence.**
     - `enrollment.test.ts` 19 and `records.test.ts` 20 are new. They check `grantProblems` against all 14 grant vectors, the `'org'` admin case and an ordered multi-problem draft.
     - These pass unchanged: `vectors` 11, `attest` 40, `admin` 41, `admin-verbs` 39, `production-scripts` 57, `identity` 72.
     - `pnpm --filter desk-hub build` is clean, and the strip-types line prints `function` five times.
     - Static is green at 099c7cf77 (42444964311). 42445146111 was red on a type error, fixed in b2ddf6b1d. Static and unit are green at b2ddf6b1d (42445527550).
  5. **The frontier review's fixes.**
     - **I1 (3112033dd).** `grantProblems` admitted a body that `isGrant` accepts but the canonicalizer refuses: a sparse `rights` array, which the shape check iterates past. `verifyGrant` answered `malformed` on it, and signing would have thrown.
       - `grantProblems` now requires `canonicalizable(body)`, the check `isSigned` makes, and answers `malformed` otherwise. So what passes before Touch ID is exactly what can be signed.
       - `verifyGrant` is unchanged, since it already refused such a body at `isSigned`.
       - `records.test.ts` 21 includes the red-first "rights with a hole" case.
       - 42446714780 (static) and 42446714963 (static, unit) are green.
     - **I2, dismissed.** The private copies of `checkHub` and `body` are this entry's item 1. A shared export would set a second hub check beside `isHubOrigin`. The desk track reviews the move and may weigh it.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 1's report and its review.

- Decision: The desk track's verdict on M4b Task 1 (69a82849c..3112033dd) is READY, from its own read and an independent reviewer-medium (2026-11-08).
  - The move is behaviour-identical.
  - `verifyGrant` reads `isSigned`, then `grantProblems`' first problem, then the signature. A read-only differential matched the base verdicts on all 14 grant vectors and on 416 more input combinations, and the canonicalizable gate moves no verdict.
  - The cost change stands. It reaches only the endpoint's own certificate set, and only for an authenticated, listed device's request, so it opens no amplification path. A first-problem mode isn't worth a second code path.
  - The `checkHub` and `body` copies stay private. At the desk track's request, a comment names `isHubOrigin` as the public check (e07f9f42c).
  Date/Author: 2026-11-08, the desk track, recorded by O8's executor (controller).

- Decision: M4b Task 2, first half, before the master merge that the channel-reach fix (#524) needs. The architect accepted these points (2026-11-08).
  - **What is committed:**
    - e07f9f42c, the `isHubOrigin` comment;
    - 0537d9aff, shared IPC and mawsd;
    - 0adff8c99, endpoint only: `grantsView` and `grantsAnswer` in `grants.ts`, and the offer row.
  - **What waits for the merge.** The door extension and `grants-call.test.ts` are held in the worktree. They need context members (`certificates`, `now`, `grants`) that only `endpoint.ts` supplies.
  1. **The door's grants read is a command of its own, `endpoint.local.grants`,** machine-owned, main-only, taking no input, at `WIRE_MINOR` 33. mawsd forwards it to the door's `call('endpoint.grants', null)`.
     - Widening `endpoint.local.call`'s `name` from `const 'record.policy'` to two names is breaking under `classifyWireChange`, so it would need a wire major. That alternative was rejected.
     - `wire-manifest.json` was regenerated. `wire-fingerprint.json` is unchanged, since it hashes engine-host commands only.
  2. **`endpoint.grants` takes no input.**
  3. **A non-member is answered `{members: []}`, not refused.** A member removed mid-read gets no answer, because their channel closes `removed`.
  4. **Through the door, the reader is the machine's owners, as one.** It sees every member's entry while the head names any owner, and none otherwise.
  5. **The judging follows `record.policy`.** The owners are read up to 3 times, and the answer is built in the step it goes out, against the head those owners were read under.
  6. **A grant the door refuses answers `{state: 'refused', reason: <verifyGrant code>}`.** Over a channel, the same grant answers `done` with `{ok: false, error}`. The door still requires the act's device to be listed in the head exactly once.
  - **Gates.** At 0adff8c99, static (42448460100) and static plus unit (42448470707) are green.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 2's report and the architect's notes.

- Decision: A grant's force doesn't depend on its signer's later standing. The desk track asked this, and RL already answers it: RL §6.3 (`docs/doperpowers/specs/2026-10-26-remote-layer-design.md:558-560`) and RL Decision Log 24 (:953).
  - The question: should a grant end when its signer stops being an owner of the machine, or an admin for an `'org'` machine, without a key revocation?
  - RL's answer is no. A machine verifies a grant once, when it arrives. The grant stays in force when its signer later stops being an owner or an admin, or retires the device that signed it. It ends only when a higher version replaces it or its signer's key is revoked.
  - RL's reason holds. Re-checking at each head would put a lower grant back in force once the signer of its replacement was demoted.
  - The code agrees. `acceptGrant` judges a grant at arrival, `machineRights` reads the ledger, and at each new head and at startup `dropRevokedGrants` ends only the grants whose signing kid is revoked, keeping `highWater`.
  - **Left in force by design.** A demotion, or an owner change with no key revocation, leaves that person's grants in force. Removing a member or a device revokes its keys, and that ends the grants it signed, so the common case already closes.
  - **Rejected:** lapsing grants by their signer's standing. It would be an RL amendment, not part of M4b. It would also need a durable lapsed reason in the ledger, a shared stored-grant judge in `org-protocol`, and a permanent end, so that a re-added owner wouldn't revive the grant. Nothing in M4b changes.
  - The architect notes it in P5's Decision Log at M4b's landing.
  Date/Author: 2026-11-08, the architect, on the desk track's question, recorded by O8's executor (controller).

- Decision: The channel's project gate is gone (#524, merge 2600f3732, 2026-11-08; P5 Decision Log 252). This amends items 3 and 4 of the entry "M7b Task 2, the endpoint".
  - The feed and `channel.history` now admit any project id. Each entry's `view` rank is the only gate.
  - The `removed` end reason and the authorize refusal are gone. The `no-target` end no longer answers a project absent from the head.
  - The reasons are in `src/endpoint/channel-view.ts`'s header. The M7b live check found every cross-machine channel read refused, because no production head has ever carried a project (genesis writes `projects` empty, and nothing adds to it). A project's channel is no wider than its sessions: an entry goes only for a session whose transcript the member may already read.
  - The header also records what was rejected, and why, and the timing signal that remains. Whether the machine holds entries of an id can be told from how long an answer takes. That is org-internal metadata, not content, and it is tracked as tech debt.
  Date/Author: 2026-11-08, O8's executor (controller), from #524's worker by the architect.

- Decision: M4b Task 2, second half. Master ddb4ac6dd (#524, #528 and #529) was merged in at 79beb549f with no conflicts. After the merge, the wire and fingerprint checks pass with no rewrite. The commits are 62c862351 (the dispatch) and e086ef5a0 (the door), both endpoint only. The architect accepted these points (2026-11-08).
  1. **The dispatch.** `CallsContext.grants?(member)` routes `endpoint.grants`. `endpoint.ts`'s `#grants` and `#grantsRead` are injected at `new Calls({...})`.
  2. **The door** (Fork A) gains `certificates`, `now` and `grants` in its context. It reads the grants as the machine's owners. Everything outside `record.*` and `endpoint.grant` is still refused. `endpoint.state` is a test case.
  3. **Two refusal shapes, corrected from the first half's item 6.**
     - A grant the door itself refuses answers `{state: 'refused', reason: <verifyGrant's code>}`.
     - A grant that passes the door but that the ledger then refuses answers `{state: 'failed', error: {code}}`, as it would over a channel.
     - Main's grants (Task 4) read both shapes.
  4. **Tests.** `grants-call.test.ts` has 16 cases:
     - desk 674's nine, numbered in their names;
     - the offer row;
     - a machine moving to another owner mid-read;
     - the door's cases: forged, ineligible, a device not in the head, `endpoint.state` refused, a valid grant stored, and `grants` read through the door.

     The red evidence: 7 cases failed before the dispatch, and 5 failed against M6b's door. A mutation check confirmed that the held-read cases reach the projection's own fence.

     The suite's hold on owner reads gained a `pass` count. This is test-only: a remote call's admission reads the owners once, in `authorize.ts`.
  5. **Gates.**
     - Static at 62c862351: 42468308490 failed on a gitleaks download 504, and the rerun, 42468632268, is green.
     - `static,unit` at e086ef5a0 (42468417824): static and unit 1–4 are green. The planner added an e2e:cross-build job, which failed in setup on a release-CDN 504 on both attempts, before any test ran. It is to be rerun once downloads recover. It is not a review blocker (the architect).
  Date/Author: 2026-11-08, O8's executor (controller), from Task 2's report and the architect's notes.

- Decision: M4b Task 3, main's machine edits and enrollment. The commits:
  - 1f82a49ff, endpoint only: desk 683's notes (a) and (b);
  - 1b9c48fa6: the stored-grant comment;
  - ca3f145ce: Task 3 itself;
  - 7f7ba3acb: the RL2 boundary-test allowance.
  Master 5fc234da2 (#534, the download fallback) was merged in at 4050bb5ec. These points are settled.
  1. **`member.remove` of a machine owner is refused by the composer** (`owners-unknown`), with one finding per machine whose owners name the member: "`<email>` owns `<name>`: Change the machine's owners first". The package's own detail names neither. An org-owned machine blocks no one, and delegation owners are still the package's finding (M4c).
  2. **`OrgView.machines` gains `keyId`, not `pub`.** The field holds a key id, and §R's "`pub` (key id)" reads so.
  3. **Certified machines.**
     - For a refusal, "certified" means any ref a served certificate names that the state doesn't list.
     - The view shows only `live` certificates, through `certificateViews`. It skips a ref that is also listed, and a certificate whose delegation the head lacks.
  4. **`machine.add` and `machine.replace` are refused `invalid` through `org.preview` and `org.change`.** Only an enrollment's approval composes them, from the key whose MAC it checked.
  5. **A drop's hub row.**
     - The row is deleted only after the sign returns `ok`, as `machine drop` deletes after its amend.
     - A row whose delete fails is kept in `OrgStatus.registered.hubRowsLeft: {name, ref}[]`. `org.drop.retry {name}` deletes only a row this run's drop left. It answers `none` for a name the held head lists again.
     - The list is cleared at sign-out. A delete that answers after the sign-out records nothing.
  6. **The enrollment.**
     - `enrolling` carries `replace: ref | null`. A re-enrollment's name must name the replaced machine, and its posted key must be under the replaced ref.
     - The start refusals are `not-root`, `not-admin`, `busy`, `hub`, `shape`, `machine-name-taken`, `prefix-names-machine`, `certified-machine`, `no-machine`, `refused` (the hub's mint refusal, such as `409 unknown-machine`) and `cancelled`.
     - Approval reads the key again: a changed key reads `stale` and ends it `key-changed`.
     - Its `live` also needs the sign-in to stand. Sign-out cancels it.
     - It ends at the earlier of the hub's `expires` and now + 3600 s. `ENROLL_POLL_MS` is 5 s.
     - Pairing, rekey and enrollment exclude one another in both directions.
     - `notAfter` for a retirement is the successor's `issued`.
     - `EditSelf.machine` is main's `machine.identity` ref, the ref the endpoint enrolls under.
  7. **The on-machine command** for the copy is `mawsd enroll` (`cli.ts:126`, also `mawsd endpoint enroll`). The code is pasted at its hidden prompt, or given on stdin, never as an argument. `--replace` is for a machine still enrolled.
  8. **The RL2 boundary test** (`src/main/machines/remote/boundary.test.ts`, O7 M1) counts each opener per file. It has a named allowance of one for `hub-client.ts`'s Registry `DELETE /api/machines/<name>`, which reaches no machine, and a second occurrence still fails. A narrow allowance was chosen over hiding the literal behind a constant.
  9. **Residue candidates** (concerns the branch review may weigh):
     - A drop that signs but stays pending (`hub`) leaves the hub row with no Retry. `deployment admin machine drop` still clears it. The full fix deletes at the slot's settlement.
     - The CLI's pre-mint check for an existing hub row of a new name isn't made, because the app has no `GET /api/machines` read.
     - `deleteRow`'s fence is the session's generation, which a cancelled sign-in also advances.
  10. **Tests.** Each ran on its own: edits 31, enroll 21 (new), org-session 126, hub-client 9, view 3, boundary 2, grants-call 17. Each has red evidence, plus mutations on `live`, `key-changed` and `close()`'s join.
  11. **Gates.** Typecheck, lint and build pass in static at 7f7ba3acb, and unit 1–4 and e2e:cross-build are green (42472451586). Its "gate scripts' tests" step and 1b9c48fa6's static runs failed or were cancelled on download 504s, which is infra; #534 is now merged in.
  12. **Review fixes (task review of ca3f145ce..db6605f3e).** Master cda04be85 (#535, #536) was merged in at 4fdd40cd7 afterwards.
     - a610c538f, Important: point 5's ok-only delete and point 9's first residue are superseded. A drop's hub row is written into its durable signing slot (`Pending.hubRow`, validated by `isStoredPending`). The signer's `clear()`, the one place a slot leaves because the held chain holds its state, now hands the cleared slot to a new `OrgSignerDeps.settled?(slot)` dependency, and the session queues `deleteRow(slot.hubRow)` on a serial chain. The row is deleted when the drop settles, however it settles: at once, a later feed or resume, the signer's start-time refresh after a relaunch, or the next sign-in. A discard or a fork never reaches `clear()`, so neither deletes. `settled` is a dependency rather than a subscription so the start-time refresh cannot clear before a listener exists. A settled row whose delete fails still goes to the memory-only `hubRowsLeft`.
     - 309cf86e6, Minor: point 9's third residue is fixed. `deleteRow`'s answer is fenced by a `signIns` counter that only `signOut()` advances, not by the attempt `generation`, so a cancelled, unrelated sign-in attempt keeps the owning sign-in's Retry. `generation` still fences attempts.
     - Still residue: the pre-mint hub-row check (point 9), and `hubRowsLeft` being memory-only once a drop has settled.
     - Tests: org-session 133, signer 46, signing-store 9, dev-session 10, each run on its own with red evidence. Gates: static green at a610c538f (42475741770); static,unit green at 309cf86e6 across 42475844068 (unit 1–4 and cross-build) and its static rerun 42477359635, the first static's one red being #534's `scripts/mawsd-pack.test.mjs:279` flake, sent to CI-opt.
  13. **The second review's fix (fix wave 2, 65f17c80c, c79c19683, 2822e9be9).** The review found that the settlement delete sent the name-keyed `DELETE /api/machines/<name>` unchecked: a pending drop adopted in the same chain read as a later re-enrollment of that name would revoke the new machine's row and credential.
     - **D23.** `deleteRow` sends nothing while the held head lists the name again. The check runs before the row read and again just before the send, on every path (the settlement, its queue, the immediate-ok path, Retry); `dropRetry` no longer repeats it.
     - **D24, with the desk's hub change (#538, `revokeKeyed`; desk 686–688).** The delete carries the dropped machine's raw `ref` and `pub` as `?ref=&pub=` (both or neither; half answers `400 bad-shape`), and the hub removes the row only when its current enrollment posted that key, answering `200 {revoked}` and touching nothing otherwise. A listed machine's row can hold no posted key: a re-enrollment in place moves the row to a new enrollment with no key at redemption (`apps/desk-hub/src/objects/registry.ts:464-467`), and the posted key is looked up by the current enrollment (`org-records.ts:176`), so a re-enrollment that never lists leaves the state's `{ref, pub}` beside a row with no key or an unlisted one. So `GET /api/machines` is read just before each delete: the row holds the drop's key, a keyed delete; no posted key, a name-only delete; another key, nothing is sent and the drop settles; absent, already gone; a failed read, Retry. `Pending.hubRow` gains `pub`, required by `isStoredPending` whenever `hubRow` is present; `hubRowsLeft` stays `{name, ref}`.
     - **Answers.** `404 unknown-machine` settles as already gone. `503 hub-updating` (an older Registry mid-deploy, which lacks `revokeKeyed`) is offered again, never gone. A certified machine's drop is refused (`certified-machine`), and a test pins that no DELETE goes.
     - **The deploy.** Until a hub deploy carries #538 (staging the desk's, production the owner's), the hub ignores the parameters and D23 is the only guard. The window that leaves, a re-enrollment of the name landing at the hub after the app's last read and before the delete, closes at the production hub deploy. M4b's PR names the dependency.
     - **Residue, recorded and not closed in M4b** (the architect, 2026-11-08): a key posted between the read and a name-only delete of a row with no key. It needs a re-enrollment in place that never lists and a key post landing in that interval. Its exit is a `revokeKeyed` form that requires the row to hold no posted key.
     - Tests: org-session 143, hub-client 11, signing-store 10, signer 46, each with red first; a mutation reading 503 as gone fails. Gates: 65f17c80c (42478399402), c79c19683 (42479689946) and 2822e9be9 (42480136294) green.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 3's report.

- Decision: M4b Task 4, main's grants. The commits are f519c4804 (Step 0, Task 3's last Minor), b4888335e (Task 4), 556e3061b (the fixtures' types), the spec commit ce4931a7e, and the three fix waves: b051e0b35; 9a35790bd, 5ccc78b0c and fe2bac5c1; and a8aed197c. None touches `src/endpoint`, `apps/org-protocol` or `apps/desk-hub`, and the RL4 `Action` shape is unchanged. These points are settled.
  1. **The hub row's keyed delete** answers `acknowledged` for a keyed 200 and `deleted` for a name-only one, and is logged "cleaned up: the hub acknowledged the removal". Under #538 a keyed 200 can also mean the hub touched nothing, so neither answer claims a verified deletion. Both settle as gone.
  2. **`RecordSigner`** (`src/main/device/step-up.ts`).
     - `sign` and `signMany` take several records under one confirmation, so Re-grant… is one Touch ID for a machine's missing grants, following M6b's `signActions` batch. `sign` is `signMany` of one.
     - It signs only `RECORD_DOMAINS` (`grant`) and throws before asking otherwise, so the device module's third signer can sign neither a state, an action nor a channel input.
     - It confirms once, checks `live`, then calls `signRecord` on canonical private copies.
     - The prompt escaping moves to `prompt-text.ts`, so `grants.ts`, which composes the grant prompt, stays Electron-free.
  3. **`grants.json`** (`src/main/org/grants-store.ts`, its one writer) follows the signing store's marker model, as a lean copy rather than a generalization.
     - The mark is `registration.json`'s `grants: true`, written before the file's first write.
     - `isGrantsFile` refuses two grants for one (machine, member).
     - Each record also stores `headVersion`, the version of the head the grant was verified and kept under. It is required, and a file without it reads `damaged` (§C).
     - There is no `org.grants.reset`. A reset that drops the file would forget withdrawals and pending grants. That would re-offer what the design never re-offers. A rebuild from the ledger can't restore what the ledger no longer holds, or what an offline machine holds. So a damaged file blocks grant signing on that profile (residue).
  4. **The IPC** (`src/shared/ipc/schema/org.ts`), refining §R:
     - `org.grants.view {ref}` → `{ok: true, ref, live, asOf, grants: {member, rights, version, state: 'on-machine' | 'pending' | 'refused', reason?}[], missing: {member, rights, version}[], digest} | {ok: false, ref, reason: 'signed-out' | 'damaged'}`.
       - `missing` is a list with the digest that names it, not a count, because Re-grant… shows each grant.
       - `live` is false when the view comes from the last answer; `asOf` is that answer's time.
       - It reads the ledger on each call, so the page reads it when a sheet or row opens and at `org.grants.changed`, not at every `org.changed`.
     - `org.grants.set {ref, member, rights}` (withdraw: `[]`) takes no digest, because the confirmation renders the grant itself, version included. `org.grants.regrant {ref, digest}` names the missing list shown (M4a's rule).
     - The refusals are `signed-out`, `damaged`, `storage`, `busy`, `invalid`, `no-change`, `ineligible` (with `grantProblems` codes), `ledger-unread`, `cancelled`, `refused`, `stale` and `none`.
     - The event `org.grants.changed {ref}` fires when a background delivery's outcome moves a row.
  5. **Fork B** is `OrgView.machines[].mayGrant`. It is `grantProblems` on a probe draft (the machine's current key, the signed-in member, no rights, version 1) with this device's step-up kid. It is false without a record signer, and independent of `maySign`.
  6. **Signing.**
     - `grantProblems` judges the draft before any ledger read or confirmation.
     - The ledger read needs the member's entry. The endpoint answers only the members its own head lists, so over a link, an answer that lacks a needed member first brings the machine to the held head through the delivery push (below) and then reads once more. `regrant` checks the members its issued grants name that the held head lists. An entry still absent refuses `ledger-unread`, and no mark is guessed. Through the door there is nothing to push, so the refusal says this Mac's own endpoint hasn't seen the member yet and to try again shortly.
     - The draft is rebuilt at `max(issued, highWater) + 1` on the head held after the read and judged again.
     - Then one confirmation, then `verifyGrant` against the head held then.
     - The keep is fenced on head identity (fix wave): `head` and `certificates` are compared by identity inside the store update that persists the grant, with no await between. A moved head or certificate set answers `stale`, keeping and sending nothing. Stored grants are never judged again (verify-once).
     - Only one sign runs at a time (`busy`).
     - `no-change` compares with what the machine can hold under its current key: a pending grant above the mark for the current key, else the ledger's grant.
  7. **Delivery** (the architect's ruling, 2026-11-08, replacing the first build's retry of `verifyGrant` verdicts and fix wave 1's curable class).
     - Through the local door, for this Mac's own machine, the grant goes as an unsigned act checked by `isAction`, sent at once. Over a link it goes with `stepUp: 'never'`.
     - **Push, then grant.** Over a link a grant is sent, the first time and every time after, only on a fresh `done {version}` at or above the record's `headVersion`. That answer comes from the machine's endpoint adopting the app's line, pushed as `endpoint.state` by `createHeadPush` (deliveries.ts), which shares M3's planner (`planRun`, `takeRun`, `answerOf`, `lineOf`). Concurrent grants to one ref share the push in flight. A regrant batch makes one serialized push per grant, each byte-bounded. The send is gated, synchronously with the act, on the answer's line being the app's current line, the sign-in standing and the link being up. Anything else keeps the grant `pending` under the ordinary resend: an answer below `headVersion`, a moved line, a dropped link, a timeout, or a machine past the app's held line, which is sent once the app adopts that line.
       - Why: neither a link's cached `caps().stateVersion` nor M3's per-machine cursor is a lower bound on the machine's head. Caps isn't re-sent when grades are unchanged (`src/endpoint/channels.ts:524-531`). A recovery rewind lowers the head (`org-sync.ts:233-239`). M3's `known[ref]` exists only while a revocation is owed. A fresh adoption answer on the checked line is the only bound that is both current and line-safe without an endpoint change, and it keeps add-member-then-grant to one Touch ID.
     - **Every verdict is final**: the ledger's `not-newer`, `not-held` and `other-machine`, and all of `verifyGrant`'s (`malformed`, `bad-signature`, `revoked`, `not-listed`, `unknown-signer`, `contested`). The machine judged it under the signing head or later, so nothing is resent after a verdict, and a refused grant shows its reason with "sign again". This is RL's verify-once: the machine judges once at arrival.
     - The door takes no `endpoint.state` and answers no version (`src/endpoint/local-door.ts:10, 23-31`), so its verdicts are final as sent. A refusal caused by a moment's lag shows as refused, with "sign again".
     - Both refusal shapes are read: the door's own `{state: 'refused', reason}`, and `{state: 'failed', error: {code}}` from the ledger behind the door or over a link.
     - On `not-newer`, the ledger is read once more. This very grant there is `done`; anything else is `{refused: 'not-newer'}`, shown as "Another device changed this grant: sign again".
     - An `expired` op is resent at once as a new op, and a down link resends at link up, at feed open and at `DELIVERY_RETRY_MS`. Neither is a verdict. `op` is the last unknown act's id, kept while `pending`.
  8. **Missing grants** are judged from the fresh ledger and the machine's current key, of this org, on a machine one uncontested key speaks for. A grant this Mac issued with rights is missing when its member is listed and the ledger lacks it. That covers a `done` grant the ledger lost, and a `pending` grant, or one refused `not-listed` or `not-held`, for a dead key, which a lost reply followed by a re-enrollment leaves behind. `verifyGrant` answers `not-listed` for an old machine key before the ledger's held-key check (`src/endpoint/grants.ts:53-56`). A withdrawal is never offered, and neither is a grant another device replaced or one a kept ledger holds.
  9. **The fence** is the session's `signIns` with the org, member and device, so a rekey fences too. A sign-out drops the held ledger answers. `close()` joins the grants part.
  10. **Tests.** grants 46, deliveries 30, grants-store 4, step-up 39, view 4, org-session 149, plus the fixture, schema and route suites, each run on its own with red first. Each guard is mutation-checked, 23 of them across the fix waves, including the push removed (the member-add test goes red, `not-listed` at delivery and `ledger-unread` at the read), the line check, and `not-listed` made non-final. `grants.ts` was drafted before its suite, so its red is the suite failing with the module absent, then one mutation per guard.
  11. **Gates.** Static at f519c4804 (42481994420). `static,unit` at b4888335e failed on test-fixture types (42484094541), fixed in 556e3061b. `static,unit` at 556e3061b (42485370595), b051e0b35 (42487911146), fe2bac5c1 (42492571560) and a8aed197c (42494746695) are green. 5ccc78b0c's (42491547957) was red on a new deliveries test that answered before the run's adoption, fixed in fe2bac5c1.
  12. **The review** took four rounds with our task reviewer:
      - Round 1, three Important and one Minor: the keep wasn't fenced on its verification head; every `verifyGrant` verdict was resent forever; a pending dead-key grant couldn't be recovered; a storage failure read `signed-out`.
      - Round 2: the fence and the storage refusal fixed. Finality still rested on stale caps or no version at all, so a refused grant could land later with no confirmation. Recovery missed the real old-key verdict (`not-listed`). Two Minors (the context for `no-change`, and the kept `headVersion` on both paths).
      - Round 3: the push-then-grant route met the architect's conditions, but the member-add flow stopped at the ledger read before signing, which the fixture had hidden by projecting the app's head.
      - The fix wave a8aed197c closed it. The controller read that diff.
  13. **Residue.**
      - A damaged grants.json blocks grant signing on that profile (item 3).
      - The door's lag refusal asks the user to sign again, and a recovery rewind can land between the push's answer and the grant's arrival, on the fork path, where the machine's verdict is then final. The exit for both is a desk-reviewed `src/endpoint` change carrying the judging head's version on the refusal, which makes the door's lag refusal resend instead of asking again.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 4's report and its review.

- Decision: M4b Task 5, the renderer. The commits are 484d9fd2f (the renderer, `page-fixture.ts` and the e2e seed), 65a547a54 (its self-review) and the fix waves fccfe6803, 0d518e9a3 with f044b0e72, and 7b1b1780f. The one change to main and shared IPC is the enrollment cancel's scope (item 5, the architect's ruling). Otherwise, under `src/main`, only `page-fixture.ts` changes: its answers, plus the e2e-only `holdGrantSave`, which only the strictly parsed page fixture can set, under `MAWS_E2E=1` on an unpackaged build. These points are settled.
  1. **Structure.** `MachineRow.tsx` is new. It holds a row, its rights, its grants read and its grant sheets. `MachinesGroup.tsx` keeps the group, the enroll row, the hub rows left, and the two org-state sheets (change and enrollment). `GrantSheet.tsx` and `EnrollSheet.tsx` are new.
  2. **When a row reads its grants:** on mount, when one of its sheets opens, at `org.grants.changed` for its ref, and when the sign-in changes. It never reads at `org.changed`. The sheets use the row's read. Nothing a previous sign-in read ever renders.
  3. **Gating.**
     - Grant… follows `mayGrant` (Fork B).
     - Enroll, Owners… and Drop… follow `maySign`. Re-enroll… also needs an admin, because the mint is admin-only.
     - A certified machine has no Owners, Drop or Re-enroll, and its row says its owners are its delegation's.
     - This Mac's own machine has no Drop.
  4. **The grant sheet.**
     - It offers no owners, unless one still holds a grant that can be withdrawn. For `'org'`, the owners are the admins.
     - Rights show under their own names (`spawn`, `shell`, `machine-admin`), each with one line taken from RL §5.5.
     - While `set` or `regrant` is out, a status line reads "Bringing <machine> up to date, then Touch ID shows the grant…" and the button reads "Saving…". That covers the push before the read and the confirmation (I2's ruling, condition 3). There is no cancel, so the sheet's button reads Close.
     - A machine's verdict codes get plain lines, with the code kept secondary.
     - A pending grant says this Mac keeps sending it until the machine answers.
  5. **The enrollment sheet.**
     - It shows the code once, with Copy, and the line naming `mawsd enroll`. The machine pastes the code at its hidden prompt, and `--replace` is always mentioned. Then it shows the expiry for the whole wait, including when the sheet is reopened without the code. Then the name, ref and key id to compare.
     - The code is cleared at the state boundary when the candidate arrives, and a test pins that.
     - The sheet belongs to the sign-in it opened under (`useOwnSignIn`, latched apart from its run). That ownership ends for good at the first different sign-in, including a sign-out and a sign-in again as the same member, and no start or Start over is offered after it. A start attaches to the first later run whose machine and name match. A newer run that isn't its own ends the start ("Another enrollment is under way"): it cancels nothing and never shows a late code. An approval's progress and answer show only beside its own run. Closing the sheet on an ended run cancels the run.
     - **The cancel is scoped** (the architect's ruling; fix waves 2 and 3). `org.enroll.cancel {generation: number | null}` with a number ends only that run while it is the current one. `null` comes from a sheet whose start has no generation yet, and ends only the start the same window (the asking client's id) sent while its token is minted, or the run that start made while it is still current. A start refused `busy` records nothing. Anything else answers `{ok: false, reason: 'not-current'}`, and the sheet shows nothing. No window can cancel a start or a run it doesn't own. A `null` from a closing sheet, rather than nothing, keeps a minted run from being orphaned, with no code shown and enrollment blocked for up to an hour. A window closed while its run waits leaves that run to be cancelled by generation from the row, or to expire.
  6. **The change sheet's machine fields.**
     - Owners… waits for a non-empty list that differs from the machine's current owners. The list is bounded and scrolls, so Review and Cancel stay reachable; `Sheet.tsx` doesn't change, because about thirty sheets use it.
     - Drop… has "Its key may be compromised".
     - A row left in `hubRowsLeft` offers Retry.
     - The refused-removal line "Change the machine's owners first" links to the machine's row through the `machines` and `onGoTo` props, never by parsing the refusal text.
     - A sheet's answer reaches the page only while the sheet is open under its sign-in. An answer after its sign-in ended stays in the sheet ("Signed version N.").
  7. **The e2e seed** (`e2e/org-page.spec.ts`, `e2e:settings`) gains the Machines group's actions, a machine with on-machine, pending and refused grants, a missing grant, an enrollment awaiting its key, and the grant sheet held while saving (`holdGrantSave`). It shows a pairing and an enrollment together, which main never allows; the header says so.
  8. **Tests.** EnrollSheet 17, enroll 25, ChangeSheet 18, GrantSheet 10, MachinesGroup 11, PeopleGroup 9, OrgGroup 18, OrgSection 12 and page-fixture 7. Each runs on its own, under both the renderer and compiled projects. The red came first, or, for the two sheets written before their tests, 14 mutations. The fix waves' mutations are all killed (12 + 6 + 4) except one (ChangeSheet's lifetime guard, defence in depth behind the delivery path's own block, which the architect accepted).
  9. **Gates and evidence.** The `static,unit,e2e:settings` runs are green: 42497863362 at 484d9fd2f, 42498673277 at 65a547a54 (with evidence) and 42502411003 at fccfe6803 (with evidence). `static,unit` at f044b0e72 (42504702480) and 7b1b1780f (42506305752). Every screenshot was reviewed by the executor and the task reviewer.
  10. **The review.** Our task reviewer found four Important issues, all fixed in fccfe6803 with red regressions from the reviewer's probe:
      - the enrollment sheet wasn't latched to one run or sign-in;
      - a closed change sheet's late answer closed its successor;
      - a reopened enrollment had no expiry;
      - the owners picker overflowed.

      It also found three Minor issues: the code's clearing wasn't pinned, some lines stated false things, and npm warnings showed in the test output.

      Two more rounds then closed the enrollment's ownership. An ended sheet lost its sign-in latch. A start that never attached cancelled an unrelated run, because the cancel was global. A `null` cancel reached another window's mint, and left its own window's published run orphaned. The architect ruled that the cancel be scoped in main. The controller read fix wave 3's main-side diff.
  11. **Residue.**
      - The Org page reads each machine's ledger once when it opens. That matters once an org has enough machines that the page opens slowly; the fix is to read each row when it becomes visible.
      - Fourteen refusal and copy lines name a condition without a clear next step ("Copy for the UX pass" in Task 5's report). They go to the UX pass as one board ticket at M4b's landing.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 5's report and its review.

- Decision: M4b Task 6, the local suite. The commits are 63409dab2 and the fix wave f098db1ee. Both are test-only: `test/org/org-page.local.test.ts`, and the suite's comment in `vitest.config.ts`. These points are settled.
  1. **The cases**, against desk-hub's Worker in Miniflare and real endpoints, driven through the session's surface:
     - **7.** A enrolls a machine from the app. The code is passed as secret input, A compares the candidate with the endpoint's own key display and approves under one confirmation, and the endpoint reads `org-listed`.
     - **8.** B is recreated as a member only, then granted `spawn` on a machine held behind B's addition. Its own `/machine/org/state` reads are refused, and the case waits until one has been refused and none is in flight. Under one confirmation, the link carries:
       - before the confirmation, only `endpoint.state`, one of them answered at or past B's addition (the ledger read's push);
       - after the confirmation and before the one `endpoint.grant`, at least one more `endpoint.state` answered there (the delivery's own push).
       The ledger holds the grant, and `machineRights` gives B `spawn`.
     - **A (Fork A).** A grant on this Mac's own machine goes through the real local door, as one unsigned act with nothing over a link. The ledger holds it, and `endpoint.local.grants` reads it back. The own machine is a second endpoint enrolled at setup, before `root add`, under A's `local` ref. Case 10 drops the first machine, and the composer refuses to drop this Mac's own.
     - **9.** The endpoint is stopped, its `grants.json` removed, and a fresh endpoint started over the same state directory. The startup invariant moves the key, the ledger and the enrollment aside, and the endpoint reads `enrollment: 'none'`. A re-enrolls it (Re-enroll, `machine.replace`, a new key). The page shows B's grant missing under the earlier key and re-grants it for the new key above the mark, and the new ledger holds it.
     - **10.** The owners change to B and back. The drop's DELETE carries `?ref=&pub=`, and #538's Registry removes the row.
     - **11.** Every state the hub accepted verifies from genesis: 14 states and 17 confirmations. No pairing or enrollment code, token or `k` appears in A's logs, either endpoint's logs or any status.
  2. **No red-first run.** The suite covers behaviour that Tasks 1–5 built and unit-tested, and it doesn't run on the MacBook. Its review read each case against the regression it names.
     - The first draft's case 8 was masked: the ledger read's push, before the confirmation, satisfied it, so removing the delivery's push would have stayed green. The fix wave splits the link's acts at the confirmation.
     - The fix wave also replaced a fixed 300 ms wait with the counted, refused reads.
  3. **Runs.** `static,unit` on macOS. The suite runs in unit 3/4, 12/12, at 63409dab2 (42508559657, 42513559429, 42513571450) and at f098db1ee (42515095022, three attempts: 4114, 4223 and 4334 ms).
  4. **Residue (owner: the MAWS architect, as O8's; the desk track reviews the endpoint change).**
     - The problem: after the startup move-aside, an unenrolled endpoint's status reads `refusing: 'stale-state'` beside `enrollment: 'none'`, although nothing is refused (`src/endpoint/status.ts:47-59`, from the startup `stale` flag). A person reading `mawsd endpoint status` or `mawsd status` sees "refusing".
     - The exit: `status.ts` reports `refusing` only while a refusal applies, with the unenrolled state outranking the startup flag, pinned by a status unit test.
     - It goes to the tracker at M4b's landing. It is a CLI status contract, not renderer copy, and case 9 no longer pins it.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 6's report and its review.

- Decision: M4b's branch review, at the verification entry's rung. reviewer-high took the production code (src/main, src/endpoint, src/mawsd, src/shared, apps; 41 files, about 2,700 lines) with a security lens, and reviewer-medium took the renderer, e2e and the local suite, both on the net diff against master d7586dada. Each had one re-review round on its own wave. After that, only a finding that broke finality, authority, secrets or a silent wrong action got a fix; anything smaller went to the PR's residue or the UX ticket (the architect, 2026-11-08).
  1. **Grants: a refused grant never lands without a new confirmation** (reviewer-high found three P1s; fixed in a5f07d5c7). It reproduced each with production `createGrants` and real `signRecord`/`verifyGrant`:
     - `pass()` sent from a snapshot taken before a concurrent `regrant` had recorded a refusal;
     - a verdict that arrived after a sign-out or a `close()` was dropped, leaving `pending` to be resent;
     - a failed outcome write was swallowed, again leaving `pending`.
     The fixes:
     - **A write-ahead.** Before each act, through the door or a link, the grant is written `sending`. That write happens only while the grant is still the latest of its (machine, member) and still `pending`; over a link, it comes after the head push. `pass()` judges each entry against the store as it stands at that moment.
     - **Outcomes belong to the record, not to the sign-in.** A terminal outcome is written after a sign-out too, onto the exact signed grant, while new signing and sends stay fenced to the sign-in. `close()` joins the work in flight through the grants' own door into the commit queue, so an act that is already out writes its outcome before the store closes. This replaces Task 4's first rule ("outcome not recorded, the next sign-in's pass settles it"), for terminal verdicts.
     - **A failed outcome write** is held in memory and retried at each pass; the grant itself is never resent. `set` and `regrant` answer `storage`.
     - **On start,** an entry still `sending` becomes `{refused: 'outcome-unknown'}` and is never sent, failing closed under the finality rule. A plain `pending` entry still resends. Within one process, an outcome that isn't terminal returns the entry to `pending`, and it is resent as before.
     - **grants.json is one member's:** a profile's registered member never changes (`register` becomes `signIn`; `signIn` checks the registered member; re-anchor and rekey refuse another member; rekey changes only the device: `src/main/org/org-session.ts:1510-1513, 1646, 1674, 1743, 1833`). So a late verdict always lands in its issuer's file.
     - Tests: grants 51, org-session 149, grants-store 4, red first. The guard mutations are caught; the snapshot one survives alone only because the write-ahead check also blocks it, and removing both turns both tests red. Gate: 42519527995.
     - The re-review closed all three sequences with probes pinned to the commit, and confirmed that every act it observed had `sending` written first.
  2. **Residue from it.**
     - A crash after the write-ahead, or while an outcome is held unwritten, comes back as `outcome-unknown` and asks the person to sign again. That is safe and rare.
     - A write-ahead whose rename lands but whose directory sync then fails leaves the entry `sending` with no act sent. The row reads pending and the same rights answer `no-change` until the next start makes the entry `outcome-unknown`. It fails closed. Its exit is to reconcile a `sending` entry this process knows it never sent, or to surface it as a recoverable `storage` state.
  3. **The renderer** (reviewer-medium found five P2 and two P3; all fixed in 3da222810 and 69b23d6c3, with nothing changed under `src/main`).
     - **Save before the first read.** It sent `rights: []`, a withdrawal, with no Withdraw label. Now the grant sheet reads as loading until the first grants read answers: every right is disabled and Save is off. Empty rights can be sent only under Withdraw.
     - **A refused or failed grants read** shows its reason with Retry in the row and in both sheets, never "Reading…" forever. Nothing signs until a read has answered ok (the architect: the same class as #525's "loads forever").
     - **An enrollment start adopted a run by name** before its own answer arrived, so a window refused as `busy` could approve, or cancel by number, another window's run. Now a start attaches only after its own answer brings the code, and before that closing sends only the sender-scoped `null`.
     - **A recipient who stops being offered** (made a co-owner, or removed) resets the selection, with a line saying so. The person shown can never differ from the grant's recipient.
     - **A ticked owner who leaves the org mid-edit** stays listed as a former member.
     - **The re-grant list** is bounded and scrolls, with the footer outside it.
     - **`outcome-unknown`** reads "This Mac stopped before <machine>'s answer came: sign again", and doesn't blame the machine.
     - **The refusal-uniqueness tests** now hold with a shared detail and with no detail.
     - **Two fixed sleeps are gone.** ChangeSheet.test now waits for Radix's focus-restore event. `test/endpoint/grants-call.test.ts` now joins B's own answer; that confirms the endpoint finished, but doesn't make the check stricter.
     - Gates: 42521609003 and 42523055883 (`static,unit,e2e:settings`, with evidence).
  4. **Enrollment ownership is bound to main's answer** (the architect, 2026-11-08, closing the line after a fourth round; d48d740b1 and 8ab88725b).
     - Every earlier fix had the renderer infer which run was its own, from generation order and then from name and machine. Each inference left an ordering in which a late answer adopted another run. The reproduced cases were an ended run's code shown again, and another window's run of the same name approved or cancelled by number.
     - Now `org.enroll.start`'s ok answer carries the exact `generation` of the run it made (required in `EnrollStartResultSchema`).
     - The sheet owns exactly that generation and ignores every other one. While the answer is still out, it owns none, and its only cancel is the sender-scoped `null`.
     - An answer whose generation isn't the current one ends the sheet with "This enrollment is no longer running.": no code, no Approve, nothing cancelled. Main publishes the run before it answers, so a mismatch means that run has already ended or been replaced.
     - A numbered cancel can only name the sheet's own generation.
     - The name match, the `elsewhere` end and its copy are gone. Another window's blocking run comes back as main's `busy`.
     - Tests: EnrollSheet 21, enroll 26, each red first where the old code allowed it. Gates: 42524547829 and 42524844058 (`static,unit,e2e:settings`, with evidence).
     - The short round reran the reviewer's own three page-level probes against 8ab88725b, and all three pass.
  Date/Author: 2026-11-08, O8's executor (controller), from the branch reviews and the fix waves' reports, under the architect's rulings.

- Decision: M4c's refresh at its cut (2026-11-08, master cfff902f7). M4c's section and §S were reconciled against the code; a read-only pass checked every citation. The renew route is on master (#493) and deployed. Neither the move nor any delegations interface has landed. These corrections bind M4c. Each keeps the section's intent.
  1. **Citations that moved.**
     - `admin.ts`: `prefixProblem` is 814-830; `MINT_SKEW_MS` and `mintDisagrees` are 952-974 (the comparison 956-966); `delegationCreate` is 988-1058 (the mint, comparison and signed expiry 1012-1029); `delegationDrop` is 1073-1095.
     - `signer.ts`: settlement and its repost are 458-486 (the repost 475-478); the post path is 375-412 (exposure written at 396, the POST at 412); `sign` is 568-604; Discard 632-678.
     - `org-session.ts`: the feed's reopen settles at 769, the start at 950.
     - Still correct: `signing-store.ts` 29-38 and 92-109; `provisioning.ts:122`.
  2. **The pending slot's type is `files.ts`'s** (60-73, validated at 287-311), not `signing-store.ts`'s, so the unsent marker goes there and in its validator. It is named `unsent: {kind: 'delegation', id} | null`, not `held`: the signer's refusal reason `held` already means "the hub's chain holds this proposal" (Discard, 632-678), and one word must not mean both.
  3. **The barrier is wider than the repost.** `sign` settles, refuses an occupied slot, writes and posts at once; deliveries place a pending candidate in their chain (`deliveries.ts:343-353`); the weekly asking stops on any pending slot (`weekly.ts:71-74`). An unsent slot is excluded from settlement's repost, from delivery placement and from the held sign's own post. A held `sign` answers the slot's hash, which `publishHeld(hash)` binds to.
  4. **Discard keeps its meaning.** An unsent slot is discarded through the same hash-bound path. Its delegation's hub key is then revoked; a failed revoke leaves the key a stray (item 8), with Revoke, never a held-up Discard.
  5. **`SignResult`'s reasons gain `secret-store`**, and its success admits `secret?: {version, createTime}` (`org.ts:160-165`); `SignOutcome` stays internal.
  6. **`delegation.add` is the create transaction's alone.** `org.change` and its preview refuse it, as they refuse `machine.add` (`org-session.ts:1123-1169`), so a delegation can't be signed outside the custody transaction.
  7. **The hub halves follow from the head, not from a durable continuation.** The head is the authority and both hub calls are idempotent, so what's left to do is read off the head against `GET /api/provisioning-keys`:
     - `hubBehind: 'renew'`: the head's delegation expires later than the hub's unrevoked, unexpired key;
     - `hubBehind: 'revoke'` (`state: 'dropped'`): the head's `revoked` names the delegation and its hub key is listed unrevoked.
     - The command runs its hub half once its edit settles, through the signer's settlement callback as M4b's drop does (`signer.ts:129-133, 293-309`), and a later run or a relaunch shows Retry from the comparison alone.
     - `409 not-renewed` also answers a renewal already applied, so a lost 200 followed by Retry reads that code. The app then reads GET and takes equal `expires` as done.
     - Drop's DELETE is a soft revoke (200 `{revoked}`); case 15's "the hub key is gone" means listed with `revoked` set.
  8. **Stray keys.** A mint whose sign never happened (a crash between them, a refused Touch ID, a mint disagreement whose revoke failed) leaves a hub key no state names. `OrgView.strayKeys` lists unrevoked, unexpired keys that no head delegation, revoked holder or unsent slot names, each with Revoke (confirmed; its copy says a CLI `delegation create` in progress would lose its key). Admin's message says the same (`provisioning revoke`).
  9. **The view.** `OrgView.delegations` joins the head's delegations, the unsent slot's (absent from the head) and dropped ones whose hub key is still live. `unsent: {rewrite, problem}` tells "Write the code again" (this run holds the key pair) from Discard only (after a relaunch), and carries the failure. M4b's `enrolling` and `hubRowsLeft` drew the same distinctions. Certified machines come from the held certificate set (`view.ts:36-80`, `certificateViews`), not from `OrgView.machines`, which drops retired ones.
  10. **The move's dependencies.**
     - `prefixProblem` needs only `OrgState` and `machineNameKey`. `mintDisagrees` takes a package-owned structural input (M4b's `HubMachine` is the precedent), carries `MINT_SKEW_MS` and the escaping its messages use, and keeps every message `admin-verbs.test.ts` (384-404, 529-532, 675-687) and `admin.test.ts` (498-519) pin.
     - Main imports nothing from desk-hub, so `MIN_/MAX_PROVISIONING_KEY_TTL_S`, `MAX_PROVISIONING_KEY_USES`, `NO_USE_CAP` and `NEVER_OFFLINE` move to `delegations.ts` too, and `identity.ts` re-exports them.
  11. **One finding per collision.** Today `checks.ts` suppresses its own row only when the package reported the same code, so a new delegation's collision yields both the package's `prefix-overlaps` and the app's directional code (pinned at `checks.test.ts:251-278`). `successorProblems` reports the directional code for a collision with a delegation new in `after` *in place of* `prefix-overlaps` for that pair; collisions among prefixes the head already held keep `prefix-overlaps`. `stateProblems` and `verifySuccessor` don't change, so neither the hub's acceptance nor the Worker's behaviour moves (the Worker calls `verifySuccessor`, which uses `stateInvariants`, `org-chain.ts:134-137`). The bundle changes by the moved code only; no hub deploy is needed for M4c.
  12. **`drops-delegation` names the certified machines**, from the certificate set; today its warning is generic (`checks.ts:203-207`). The drop's proof checks the certificate's event key reads revoked through `verifyEvent`. `verifyMachineCert` answers `not-listed` once the delegation is gone, and admin's drop revokes only the delegation key and moves the `retired` entries.
  13. **Wiring.**
     - The composition is `src/main/app.ts` (334), not `index.ts`. `engineEnv` is the async login-shell capture (592, `shell-env.ts:114-128`), so the gcloud resolver is an injected async read.
     - The destination is a new machine-settings section `org: {provisioningSecret: … | null}`, default null. It goes through unified `Settings`, `MachineSettings`, both patch schemas, defaults and the split (`settings.ts:153-248`, `defaults.ts:309-375`), and an older file without it still parses (version 1, no bump). Main reads it through the settings service (`app.ts:278-281`).
     - New commands join `register.ts`'s three lists, `routes.json`, `names/org.ts` and `page-fixture.ts`'s answer map. The grade is the namespace's.
     - The hub client's four methods join `signerHub`'s wrapper (`org-session.ts:888-909`). The mint checks 201, not any 2xx; the renew answer is the bare record.
     - The key pair and the code join the sign-out fence (1903-1919) and `close()` (1962-1994), scoped by the sign-in generation. A create reserves its run before the mint, as enrollment does (`enroll.ts:257-316`), so a second create answers `busy`.
  14. **Each external step's outcome is bound and named.** Every answer from the mint, `versions add` and `describe` is bound to its run and slot hash, and is one of: not attempted, failed, or may have succeeded. A failed or unanswered `describe` never clears `unsent`; "Write the code again" adds a new version, which is harmless, since devcloud reads `latest`.
  15. **The local suite has 12 cases, not 11.** M4b's own-machine grant (`org-page.local.test.ts:564`) is unnumbered. It becomes 9, the rest move up one, and M4c's cases are 13-15. The aggregate totals (14 signatures, 17 confirmations) move with them. A real endpoint provisions through `endpoint.cli('provision', ['--name', name, '--wait', '30', '--json'], code)`, the code on stdin, as `provision.test.ts:120-151` does. The local hub serves all four routes.
  16. **The renderer.** Delegations is a section inside `OrgGroup`, not a fifth group. `MachinesGroup` is the pattern for rows and hub-half Retry. `DelegationSheet` follows `EnrollSheet`'s ownership guards (a request token, a generation, the opening sign-in) but none of its code display. Copy is `settings-tab/copy.ts`.
  Date/Author: 2026-11-08, O8's executor (controller).

- Decision: M4c is built as six tasks under subagent-driven execution, each reviewed at its frontier. Then reviewer-high, with a security lens (custody and finality), and reviewer-medium (renderer and tests) review the branch. The desk track reviews every `apps/org-protocol` and `apps/desk-hub` hunk, in commits of their own.
  1. **The move** (desk-reviewed): `apps/org-protocol/src/delegations.ts` (`prefixProblem`, `mintDisagrees`, the provisioning constants), the directional codes in `successorProblems` (refresh item 11), `admin.ts` and `identity.ts` importing them. Then, in an app commit, `checks.ts` drops its directional rows: one finding per collision.
  2. **The unsent slot**: `files.ts`'s marker and validator, `Edit.hold` and its hash, the exclusions (settlement, delivery placement, the held sign's post), `publishHeld(hash)` in its two steps, Discard's answer naming the unsent delegation, and their tests, including both crash points and the relaunch.
  3. **Composers, the hub client, custody and the destination**: `edits.ts`'s three kinds (with `renew-past-cap` and the enriched `drops-delegation`), the refusal of `delegation.add` in `org.change`, `hub-client.ts`'s four methods, `secret-store.ts` with its injected resolver, and the `org.provisioningSecret` machine setting.
  4. **The transaction and the session**: `src/main/org/delegations.ts` (create, rewrite, renew's and drop's hub halves, Discard's revoke, stray keys), `view.ts`'s projection, the schema and wiring, the fence and `close()`, and `delegations.test.ts` with the fake `gcloud`.
  5. **The renderer**: the Delegations section, `DelegationSheet.tsx`, the destination field, `copy.ts`, `page-fixture.ts`, and the e2e seed.
  6. **The local suite**: cases 13-15, and the renumbering.
  Each task's gate set includes unit. M4b's retrospective binds the briefs:
  - state each guarantee as an invariant over every path that acts on durable state: send, resend, restart, sign-out and close;
  - test with fixtures that answer from the other side's real view (the local hub's own parser, a fake gcloud that records argv and stdin);
  - name ownership from the authority that creates it (the slot hash, the run's generation);
  - test mid-flight endings: during Touch ID, while the mint or a `gcloud` call is out, and between `publishHeld`'s two steps.
  Date/Author: 2026-11-08, O8's executor (controller).

- Decision: The architect's rulings on M4c's refresh (2026-11-08). All five of the refresh's design decisions are accepted against the design: the hub halves read off the head (item 7), stray keys (item 8), the `unsent` marker and its wider barrier (items 2-3), `delegation.add` the create transaction's alone with the revised view (items 6, 9), and the directional codes in `successorProblems` (item 11).
  - **Stray keys show their age** from the hub record's `created`. A key minted in the last few minutes is likely a CLI `delegation create` or another admin's create still under way, so Revoke's confirmation says so more strongly for a young key. `OrgView.strayKeys` gains `created`.
  - **The worker bundle changes** by the moved code, so at M4c's landing the desk track deploys that master to staging before any production deploy, as for M4b. The PR's line stays: live use needs no hub deploy.
  Date/Author: 2026-11-08, the architect; recorded by O8's executor (controller).

- Decision: M4c Task 1, the move (e5655af5f for the desk track; 76f72df85 for the app). Built as briefed. Its decisions:
  1. `printable` moves into the package too (`apps/org-protocol/src/printable.ts`), and `admin.ts` re-exports it, so the app and admin escape alike.
  2. `mintDisagrees` takes a package-owned `MintAnswer | null`, with `unknown` fields, since it judges the hub's answer; a null answer reads "no key in it". `MINT_SKEW_MS` is exported beside it, so the sheet can state the window.
  3. A delegation is **new in `after`** when the head held its id neither live nor revoked. A same-id delegation whose key or prefix changed keeps `prefix-overlaps`, and is refused `keys-unaccounted` besides.
  4. Two new delegations colliding are named once, from the one listed first, as the app's rows did. The directional details use the app's former wording, now held once in the package.
  5. `checks.ts` drops its `delegation-id-used` and `prefix-names-machine` rows too, with the same-code filter that hid them; without it they would repeat the package's findings. The word-for-word dedupe stays, since the package names a machine under a prefix once per list holding its name. `CheckCode` is now `renew-expired | renew-not-extension | drops-delegation | superseded-keys`.
  6. `stateProblems`, `stateInvariants` and `verifySuccessor` are unchanged in what they accept; a test shows each directional successor still refused by `verifySuccessor`, with `stateProblems` still naming `prefix-overlaps`.
  - e5655af5f alone fails six of the app's old `checks.test.ts` pins, which 76f72df85 fixes; the PR lands as one merge, so no master holds the first alone (the architect, 2026-11-08).
  - Tests: org-protocol `delegations.test.ts` 11 (new), `successor-problems.test.ts` 82; desk-hub `admin.test.ts` 41 and `admin-verbs.test.ts` 39, unchanged; app `checks.test.ts` 38. Six mutations of the replacement rule caught. Green: static at e5655af5f (42538332291); static and unit at 76f72df85 (42538499882).
  - **Reviews.** The desk track found e5655af5f CORRECT with no findings (desk 701). Its own read and an independent reviewer-medium agree: the move is byte-equal except `MintAnswer | null`, every pair the old code reported still yields exactly one problem, and no hub path calls `successorProblems`. Its one nit, `identity.ts` importing from `org-protocol` twice, is folded in only if a later commit touches that file. Our task reviewer found the directional consolidation correct, the app's preview refusing a same-id change with `keys-unaccounted` (decision 3; `org-state.ts:378-381, 619-620`), and acceptance unchanged.
  - **One diagnostic retired, by decision** (the reviewer's I1). A successor that keeps a delegation's id and key but changes its prefix used to show the app's `delegation-id-used` ("delegation id A is a live delegation's") beside `keys-unaccounted`. It now shows `keys-unaccounted` alone, whose words already name the case ("… or a delegation changed beyond its expires"). It is still refused, in the preview and at the hub, and no composer can produce it (renew keeps the prefix). Restoring it would put a second id rule back into the package for a proposal nothing composes, so the exception is recorded instead of fixed.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 1's report.

- Decision: M4c Task 2, the unsent slot (1650daf4f). Built as briefed. Its decisions:
  1. `Edit.hold` is `Unsent` (`{kind: 'delegation', id}`), not `true`, so the marker is named by the edit that makes it. §S is revised.
  2. A held sign answers `HeldSigned = {ok: true, version, hash}`, a member of `SignOutcome`, told apart by `'hash' in outcome`. An overload or a generic on `sign` would break the existing fakes' typing. It never passes through `signResult`: the strict `SignResult` schema refuses `hash`, so Task 4 maps a create's outcomes itself.
  3. The barrier sits in the post path's exposure update, which every hub post passes through (a sign, settlement's repost, a publish), and is judged there atomically in the commit queue. Delivery placement reads a marked slot as suspended. Settlement still judges a marked slot held or forked. A held sign starts no delivery run.
  4. `publishHeld`'s refusals all answer `stale`, with details telling discarded, replaced and already published apart.
  5. `publishHeld` asks a signed-in session, not root or marked: publishing turns an already signed slot into an ordinary one, which settlement posts with no such check either.
  6. Once the marker is cleared, `publishHeld` answers the post's own outcome, and settlement owns the slot from then on.
  7. Discard's ok answer gains `marker: Unsent | null` (`unsent` is taken by the boolean "never exposed", `held` by the refusal). The session's IPC answer leaves it out, since IPC outputs are validated against strict schemas (`src/shared/ipc/validate.ts:38-41`).
  8. `Pending.unsent` is required, as `hash` is; it is optional only on disk, filled at load.
  - Tests: `signer.test.ts` 59 (13 new), `signing-store.test.ts` 14 (4 new), `deliveries.test.ts` 31 (1 new); nine mutations caught (both barriers, the hash check, two orders of the marker's clearing, the fence, the already-published refusal, the held sign's early return, Discard's marker). Green: static and unit at 1650daf4f (42541105062).
  Date/Author: 2026-11-08, O8's executor (controller), from Task 2's report.
  - **The fix wave (0e332c014), from the frontier review's I1.** `publishHeld` checked only a signed-in session, the hash and the marker, so a same-member sign-in after a sign-out, or a relaunch, could publish an earlier run's held slot by its hash, though that run's key pair was gone. The right to publish now lives only in the signer's memory: the held sign records `{hash, epoch}` (the epoch it was asked under) inside its exclusive operation; `publishHeld` checks it inside the marker-clearing update, with no await between; a sign-out, `close`, the slot's Discard or any new slot drops it; a fresh signer has none. Without it the answer is `stale`, "this slot was held by a run that has ended: only Discard". So the create transaction's publish and "Write the code again" run in the sign-in that held the slot, where the key pair lives. Four cases, each red first and refused with `signing.json` unchanged byte for byte: after a relaunch, after a same-member sign-in, a sign-out landing during the held write, after Discard. Removing the sign-out's clearing alone survives by construction (epochs only grow, so the comparison refuses any surviving record; the re-review confirmed it). Green: static and unit at 0e332c014 (42542743616). The re-review approved.

- Decision: The destination is its own file, not a settings section (2026-11-08, the controller's ruling on Task 3's question; the architect concurs). This overturns refresh item 13's placement of `org.provisioningSecret` in machine settings. O7 M9's binding rule says `machine-settings.json` "is never given a new property": older strict readers (an older mawsd still running after an app update, older engine hosts, a downgrade) fall back to defaults for the whole file and refuse writes, and `src/services/settings/machine.test.ts` holds every written file to an older build's reader (`test/fixtures/settings/master-828114952/`). `settings.json` has the same rule. So the destination lives in main's own `<profile>/provisioning-secret.json`, `{version: 1, provisioningSecret: {project, secret, account} | null}`, reached through `org.*` commands (`get`, `set`, and `reset`, which removes the file and is the one way out of a damaged one; the renderer confirms it). Losing the file costs a re-entry and nothing more, unlike `grants.json`, which is authority state. §S is revised.
  Date/Author: 2026-11-08, O8's executor (controller); the architect concurs.

- Decision: M4c Task 3, the composers, the hub client, custody and the destination (2a3960e52, c8a8bc6e2, a79eda70f, 09a450ef6, d8dfc032f). The executor that wrote 2a3960e52 was lost in the parent session's crash at about 01:22Z, with the rest uncommitted. A second executor read that work, kept and finished it, and reconstructed its red-first evidence by mutating about 25 guards. The crash had also hidden a red static gate on 2a3960e52 (42544713523, a readonly `owners` tuple in a test), fixed at c8a8bc6e2: after a crash, every gate nobody watched is checked again. Its decisions:
  1. **Composers.** `delegation.add` signs uncapped as `NO_USE_CAP` and `NEVER_OFFLINE` as 0; the composer leaves prefix collisions to `successorProblems`. A renewal to the same `expires` is `no-change`; a renew or drop of an id the draft lacks is `StaleEdit`. `renew-past-cap` is inclusive at the cap (the hub refuses only past it). The drop's lines and its warning leave out machines whose key the head already revokes; the warning adds live, retired or not live from `certificateViews`. `checkSuccessor` takes the certificate set at its three call sites (the preview, the superseded offer, the signer).
  2. **The hub client.** `revokeProvisioningKey` answers `'revoked' | 'absent'`, the body's id checked; `404 not-found` stays a failure. The 201 rule is a generic `expect` on the shared request: another 2xx reads `unexpected-status`. One malformed key fails the whole list, so the view shows the hub column unavailable rather than partial. `ProvisioningKey` carries the eight fields the app reads.
  3. **Custody.** The resolver is called at every step (a gcloud installed after launch is found); tests inject no fallbacks, so the real gcloud is never reached. The code travels in a `ProvisioningCode` holder whose printing is a placeholder (`reveal()` only). An error line holding any 16-character run of the code is withheld. Each call has a 60 s timeout and kills its process group; its answer waits for `close`, or 1 s after `exit`. stdin counts as closed only when written without error. A non-zero exit of `versions add` reads `failed`, on gcloud's word, though the version may exist; writing again adds a harmless version, so the next step is the same (accepted as is). `createTime` comes through as gcloud writes it (microseconds). The destination's grammar refuses a leading hyphen in all three values, so nothing in argv reads as a flag.
  4. **The destination's file** (`provisioning-secret-store.ts`): `openProvisioningSecret(file)` with `read()` (the value, null for a missing file, or `damaged` with its reason) and `write(value)` (the value, or `invalid | damaged | io`). It classifies reads itself, since `openSettingsFile` returns the same defaults for missing, unreadable and invalid files, and writes through `writeSettingsFile` (atomic, 0600). A damaged file is never read as null and never written over; another version reads damaged. No cache and no listener: main is the only writer. `ProvisioningSecretSchema` is in `org.ts`; `settings.ts` is byte-identical to before, and the older-reader test passes.
  - Tests: `edits` 36, `checks` 40, `org-session` 151, `hub-client` 17, `secret-store` 15, `provisioning-secret-store` 10. Green: static at a79eda70f (42546059888); static and unit at 09a450ef6 (42546595925) and d8dfc032f (42547656434).
  Date/Author: 2026-11-08, O8's executor (controller), from Task 3's report.
  - **The fix wave (fb9743f0a, 09c349d2c), from the frontier review.**
    - **gcloud's own logging** (I1): a machine with `core/log_http` on would have written the AddVersion body, the code, into gcloud's log files. Every child now runs with `CLOUDSDK_CORE_LOG_HTTP=false` and `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true`, which Google documents as taking precedence over `gcloud config set`. No `--log-http=false`, since only the bare flag is documented.
    - **An uncertain write is uncertain** (I2): `versions add` can announce "Created version [N]" and then fail its checksum confirmation, and a lost response can leave a version behind. `failed` now means only that gcloud never received the whole code, or that Secret Manager refused before announcing a creation (NOT_FOUND, PERMISSION_DENIED, INVALID_ARGUMENT, FAILED_PRECONDITION, UNAUTHENTICATED). Every other ending is `may-have-succeeded`, with the announced version when there is one, for Task 4 to confirm through `describeVersion`.
    - **Error codes are an allowlist** (I3): a 40-character prefix of the 43-character token would have passed the slug grammar into a failure. Only desk-hub's vocabulary, plus `not-head` and `rollback`, passes; any other string reads `unrecognized`. Every code another caller branches on still passes. Task 4 pins the list against desk-hub's exported vocabulary, so a new hub code fails CI.
    - **The exit fallback cleans up** (M1): streams destroyed, handlers dropped, the remaining process group killed.
    - Each fix red first; 11 mutations caught. Green: static at fb9743f0a (42550048833); static and unit at 09c349d2c (42550283250). The re-review approved.

- Decision: M4c Task 4, the create transaction, the hub halves, the view and the wiring (5d225154d, 12db19412; the fix wave dc67415cc and d39a90cbb). Its decisions:
  1. **The shape.** `src/main/org/delegations.ts` is a thin facade over two state owners, split at the frontier review because their endings differ: `delegation-create.ts` owns a create's run and its custody (token, key pair, code, slot hash); `delegation-hub.ts` owns the hub halves' queue, the key list with its read time, and the per-id problems.
  2. **Two create reasons.** `secret-store` is a refusal before any mint (no destination or a damaged one, no gcloud, not signed in, no secret); `unsent` is signed and held, the code not stored or not published. A held sign never passes through `signResult`. A dry composition runs before the mint with a stand-in id and key, so a refusal of the checks costs no hub key.
  3. **The status and the view.** The status gains `delegations {creating, rev}` (`rev` fires `org.changed` for what only the view shows). A row gains `hubProblem {reason, detail}`; the view gains `hubKeys {at, failed}`, so a failed read never reads as "no keys"; `maxUses` is null for no cap. Hub-half answers: `no-route`, `updating`, `ended`, `not-renewed`, `too-long`, `hub`, `refused`, and `none` for a Retry with nothing to do.
  4. **Hub halves.** Each awaits a fresh key read; a `409 not-renewed` counts as done when the hub's key isn't behind. Every half, revoke follow-up and key read is bound to the sign-in that asked, and the queue is dropped at the fence; after a sign-in the halves are derived again from the comparison, as at a relaunch.
  5. **Endings.** A sign-out, Discard, `close` or a replacing run drops the run's token, key pair and code (`ProvisioningCode.drop()`, after which `reveal()` throws) and kills its gcloud through an `AbortSignal`. Endings never call the hub: a key minted for an ended run is a stray under the next sign-in. The run is checked again after `publishHeld`, so an ended run never relays its outcome.
  6. **Custody is released just before `publishHeld`**, since the signer reports no step-1 point. A publish refused while the run stands leaves the row Discard-only, with its reason, and Discard revokes the minted key.
  7. **The active create's key is reserved**, by id once minted and, while the mint is out, by prefix and a start 60 s early (a hub clock behind this Mac's). The stray list leaves it out and Revoke refuses it; the reservation ends with the run.
  8. **Strays and revoke exclude every delegation in the pending slot**, not only an unsent one, so a published delegation not yet settled is never a stray. Young is under 15 minutes (`YOUNG_STRAY_KEY_MS`), computed in main.
  9. **The destination's commands**: `get`, `set {value}` (null clears), `reset {confirmed: true}`, over main's file; `reset` was added to Task 3's store. `rewrite` reads the destination again, since the owner may have fixed it.
  10. **Smaller.** `createTime` is normalized to ISO millis when it parses. The stored code ends with a newline, as admin's stdout does. Publish success is judged by the slot. `ERROR_CODES` gained `WrappedKeyError`'s four codes, which the new drift test found; the test cross-checks the allowlist by type against desk-hub's three exported error unions and scans the Worker's literal codes.
  - **The frontier review's fixes** (the wave): I1, custody held past a run's end (redundant references, an unrevocable holder, custody through the publish's post, gcloud not killed); I2, this app's own fresh key revocable as a stray before its slot existed, after which the create would have published a delegation backed by a revoked key; I3, queued hub work running on a later sign-in's credential. Each was proved by tests that end the run while the operation is still out.
  - Tests: `delegations` 52, `secret-store` 21, `view` 9, `org-session` 157, `hub-client` 20; 26 mutations caught in the wave. Green: static and unit at 12db19412 (42555393469) and d39a90cbb (42559947638, after the index-watcher flake on 42559085408); `e2e:settings` at 12db19412 (42556487805), for the org-page, channel and share literals Task 4 changed.
  - The re-review approved, with one Minor carried to Task 6: a regression case for a publish refused while the run stands (the kept reason, `rewrite: false`, rewrite's stale answer, then Discard's revoke).
  Date/Author: 2026-11-08, O8's executor (controller), from Task 4's report.

- Decision: M4c Task 5, the renderer (56a5dbd26, 5e1bca3f7; the fix wave 50dd920af and 404ff969b). Its decisions:
  1. **Files.** `DelegationsSection.tsx` with `DelegationRow.tsx` (and `StrayKey`), rendered at the Org group's end: a section, not a fifth group, in files of its own as M4b split `MachineRow.tsx` out. `discardOutcome` moved to `parts.tsx`, shared by the Org group's Discard and an unsent delegation's.
  2. **The hub's side is an admin's.** The hub lists its keys to admins alone, so a member sees no hub line, no key-read failure and no uses count.
  3. **Rows.** Retry's failures come back through the view as the row's `hubProblem`; Retry shows a line of its own only for `none`. An unsent row with `rewrite: true` offers Write the code again and Discard (abandoning a held delegation needs no relaunch); with `rewrite: false`, Discard alone. The Pending row names an unsent delegation's slot rather than "waits for the hub". Create is disabled while a signed state is pending, saying so. Outcomes of create, Renew, Drop, a rewrite and Discard land on the New delegation row, since the row that sent them may be gone once they settle.
  4. **The create sheet.** Defaults: 90 days, no cap, owners you (admin's). A success closes the sheet, its line naming the version and the code's time. Renew's bounds are checked in the sheet (at least one day past the current expiry, at most 365), so `renew-not-extension` and `renew-past-cap` never reach a preview. The destination form takes all three values or none, each held to `ProvisioningSecretSchema`'s grammar, and shows only to an admin whose Mac may sign.
  5. **The e2e seed's unsent row has no pending slot**, so Create stays enabled for the create sheet's photograph; it draws with no actions, which the case asserts, and the unit suite covers its actions.
  - **The frontier review's fixes** (the wave):
    - **A create is bound to main's run** (I1). A held, failed sheet in one window could adopt another window's replacement delegation (offering Write again for it, its result landing under the first prefix). The create's and rewrite's answers now carry main's run generation, the delegation id and the held slot's hash; the sheet acts only on a row and slot matching them, and otherwise ends with "this create is no longer running". `pending.delegation` is the unsent marker's id, else the delegation the slot's state adds, else null.
    - **A row's Discard is its own slot's** (I2). Every row had been handed the status's current slot, so while the view lagged, a row could confirm Discard with an unrelated slot's hash. A row offers Discard only when the slot's delegation is the row's.
    - **A failed key read has Retry** (I3, and the architect's note on decision 4): `org.delegation.readKeys {force: true}` bypasses the 30 s freshness, bound to its sign-in like every hub read.
    - **Copy follows the transaction's phase** (I4). A post that failed after the marker cleared had read "Create again" for a signed, stored, pending delegation. The answers carry a structured phase; published reads as a muted status line, with neither Create nor Write again; Write again versus Discard comes from custody.
    - The strict-output test claims only what it proves (an unexpected `code` property is refused); admitted strings are kept secret-free by main's redaction, with a renderer-facing regression on a stderr that held the code.
    - **Fix wave 2** (c2e51a9a9), from the re-review: three finality cases the first wave left.
      - **The status can trail the answer.** Main emits the status before it answers, but events (`webContents.send`) and answers (`ipcRenderer.invoke`) travel separate Mojo pipes in Electron 44 with no order between them. So every create and rewrite answer carries `rev`, the status's `delegations.rev` after its run's final slot was published, and the sheet reads a missing or other slot as gone only from a status at or past it; before, unknown.
      - **A slot's held phase is the status's.** `pending` gains `held` (the signer's unsent marker). A row's Write again and Discard need it, and an open "never sent" confirmation closes when it clears under the same hash, since another window's rewrite can publish the same slot. An exposed slot is discarded from Org › Pending, in its ordinary words.
      - **Publication is the signer's own word.** `publishHeld` answers `published: true` only after its own update cleared the marker; a slot discarded or replaced ahead of it answers the new phase `discarded`, never `published`.
      - Two mutations survive: `finalAnswer`'s extra publication (G6), redundant since `settleRun` publishes after the final slot; and the flag in `publishLocked`'s catch (G8), a branch no test reaches, since the post absorbs store failures. G8's focused regression is Task 6's.
  - Tests: `DelegationSheet` 14, `DelegationsSection` 15, `ChangeSheet` 21, `delegations` 56, `org-session` 159; 11 of 12 mutations caught at first (the survivor, the sheet's open-ness check, is unreachable since a closed sheet unmounts), 10 of 10 in the first wave, 6 of 8 in the second. Green: static, unit and `e2e:settings` at 5e1bca3f7 (42565940647), 404ff969b (42573528428) and c2e51a9a9 (42578958501, with evidence; photographs `org-page-delegations` and `org-page-create-sheet`). The final re-review approved.
  Date/Author: 2026-11-08, O8's executor (controller), from Task 5's report.

- Decision: M4c Task 6, the local suite (785001ba2, 7e2b0885a, e0eb559fb; test-only). M4b's own-machine grant is case 9, the later cases 10-12, and M4c's are 13-15:
  - **13** creates a delegation with a use cap of 3 through the app, against the real local hub's mint, with a fake `gcloud` recording argv and stdin. It checks the request and the hub's stored fields, the signed `expires` within a minute of now + `ttlDays`, and the code on the fake's stdin and nowhere else (argv, logs, statuses, the answer and view, every file under the profile). A real endpoint then provisions from the code the fake received: its certificate verifies, its key reads one use, and the hub lists it.
  - **14** reads the hub's expiry, renews through `org.change`, sees the renew route called, and the hub's expiry follow; A's page lists the VM.
  - **15** drops it: the certificate's event key reads `revoked` through `verifyEvent`, and the hub key stays listed with `revoked` set. The totals close at 17 states and 20 confirmations.
  - Two carried unit cases: a publish refused while the run stands (Task 4's re-review), and a post that throws after the marker cleared (Task 5's G8).
  - Green: `org-page.local.test.ts` 15 of 15 on three CI attempts at e0eb559fb (42584197185). The task reviewer approved; its Minor, that case 14 doesn't by itself prove `org.change` answers after its hub half, is pinned by Task 4's session test.
  - **Found by it, left as residue** (the architect's ruling): the hub announces new org states to apps but not new certificates (`apps/desk-hub/src/objects/registry.ts:1321`), so a VM just provisioned is missing from its delegation's row until the app's next hub read, and a drop previewed before then answers `stale` at sign. It fails closed, and the copy says to preview the drop again. Closing it needs a hub change and its deploy.
  Date/Author: 2026-11-09, O8's executor (controller), from Task 6's report.

- Decision: M4c's branch reviews (2026-11-09). reviewer-high (production code, a security lens) and reviewer-medium (renderer and tests) read the net diff against cfff902f7 at a939dbf52, while Task 6's test-only commits went on. Both found it incorrect. One fix wave (bac4a425e, 143f7ead2, and the typecheck fix 5fc80df73) closed all eight findings, and each reviewer's one re-review round found it correct.
  - **R1, custody.** A mint disagreement quoted the hub's `key.prefix`, any string up to 256 characters, so a hub answer carrying the token there would have put a live credential into the IPC answer. The app now names the disagreeing fields (id, prefix, expiry, use cap, token), never their values; admin's CLI wording is unchanged.
  - **R2.** A marker-clearing write can replace `signing.json` and still throw (`writePrivateFile` syncs the directory after the rename). The signer reads the store back, and a cleared marker on the same hash answers `published: true`.
  - **R3.** A mint whose answer was lost, or a 2xx it can't read, may have minted: it answers the minted phase and reads the key list again, so the key shows as a stray.
  - **R4.** A Discard during `versions add` or `describe` is recorded on the run before it ends, so the create answers `discarded`, not `held`.
  - **R5.** `unsent.writing`: while main writes the code, the row says so and offers nothing, rather than reading the working run as lost custody.
  - **R6.** A Write again answered published or discarded withdraws the row's unsent actions and confirmation for that hash until a status at or past the answer's `rev`, the sheet's rule.
  - **R7.** The lost-answer renewal test now keeps the key reads failing until Retry, so it catches a Retry that trusts its cache.
  - **R8** (the architect). A drop answered `stale` says "This delegation may have certified a machine since you opened it: preview the drop again". It says "may have" because a stale answer has other causes the app can't tell apart.
  - 14 mutations caught. Green: static, unit and `e2e:settings` at 5fc80df73 (42592828180), after a typecheck red on bac4a425e (42588381451) that the API quota hid for half an hour.
  Date/Author: 2026-11-09, O8's executor (controller), under the architect's rulings.

- Decision: M5b's refresh at its cut (2026-11-09, master e181a1944, branch `p5-o8-m5b`). M5b's section was reconciled against master. The parent is re-pinned at P5 Decision Log 260; 259 and 260 change nothing M5b consumes. These corrections bind M5b, and each keeps the section's intent.
  1. **Both waits are met.** DL190 (b)'s spawn-act placement is `#bySpawn` (`src/endpoint/rl10/members.ts:338-347`). sminos ships the `record.*` executors from 1.38.0 (Decision Log, "The record.* executors ship in sminos 1.38.0"). The executor's contract, read from doperpowers main 8afbfb6b: the member is added to `owners`, the signed act is appended verbatim to `ownersProof`, `policyRev` is bumped, and the session is re-listed; an existing owner changes nothing (`sminos_visibility.py`'s `add_owner`; `test_visibility.py`'s `test_record_owners_*`).
  2. **The scope shrinks to the renderer and one local case.** M6b built the main side, which the section listed as M5b's: `org.owners.add` (`policy.ts:263-264`), its schema, name, route and handler, the fixtures' answers, the act's shape test (`policy.test.ts:135-140`) and the stand-in's `record.owners` branch. What remains:
     - the renderer: `AddOwnerSheet.tsx`, its dialog kind, the "Add owner…" item beside Share in the row menu and the header menu, copy, and tests;
     - the local suite: the stand-in appends the verified act to `ownersProof` (it keeps only `owners` today, `policy.local.test.ts:209-210`), and one case, in which A adds B as an owner of a lane A and a lane B session and the next listing names both.
     The architect accepted the shrink (2026-11-09) and carries it into P5's Decision Log at landing.
  3. **Where the item is offered: Share's gate.** The section says "a listed row you own" and "a local session's row that has a listing". Add owner acts through the same record path and door as Share, so it is offered exactly where Share is (`useCanShare`, `sessions/share/target.ts`): a remote listing that names you an owner, or a session on this Mac whose `record.policy` names it. A machine whose sminos can't keep a reach shows the sheet's "can't yet" line and offers nothing, as Share's does. Rejected: a narrower gate of listed rows only. It would hide the item on a private session of yours that the same act serves.
  4. **Who the sheet offers.** It offers the head's members (`org.view`) who aren't you and whom the session's known owners don't name: the listing's `owners` where there is one. A local session with no listing reads no owners, so it offers every member but you. An add that changes nothing (`changed: false`) reads "already an owner", not as a failure.
  5. **The lane B record in the local case carries its spawn act ahead of the owner act**, so its re-list goes through DL190 (b)'s placement, which is why M5b waited on that fix.
  6. **The live proof moves to M8's sitting** (the architect, 2026-11-09, so the owner sits once). Production has no second member, and none joins in P5 (P5 §"Deferred"; Decision Logs 235 and 248). So the step is staging's, with the owner's second staging identity as M6b's layer 2 used it: M8's Concrete Steps, step 7.
  Date/Author: 2026-11-09, O8's executor (controller); items 2 and 6 the architect's rulings.

- Decision: The architect's rulings on M5b's refresh (2026-11-09).
  1. **Item 3 is accepted, on a condition.** The act's authority must be enforced below the renderer: the endpoint grades every `record.*` act `manage` (`offers.ts:163`), and `manage` is held only by the session's owners and the machine's (`grades.ts:8, 38`). A share tops out at `approve`, so a share holder never qualifies. The menu item is only a hint.
     - Task 2 pins this: a non-owner who holds a share at `approve` and forces `record.owners` is refused `grade`, and the record is unchanged.
     - Task 1's review confirms that `useCanShare` admits only owners. If it admits anyone the door would refuse for an owners act, the item narrows to owners, and the architect is told.
  2. **Step 7 runs inside M8's sitting**, as its first part, on staging, before the production steps.
  3. **The adder is a MAWS profile the owner drives**, signed in to staging with the owner's own staging identity. The row names B, the owner's second staging identity, so the sheet itself is proved. If that profile can't be signed in to staging at the sitting, the harness member adds, and Outcomes records that the sheet is proved by the unit and local suites only.
  Date/Author: 2026-11-09, the architect; recorded by O8's executor (controller).

- Decision: M5b Task 1, the renderer (fea94bdaa). Built as briefed, with these decisions:
  1. **The ruling 1 check found `useCanShare` admitting non-owners on this Mac's own sessions.** This Mac's `record.policy` answers for all of its owners and names every session any of them owns. The local door, though, authorizes the act as the member who owns the signed-in device. So Add owner is offered:
     - on a listing that names you an owner, which is exact already;
     - on this Mac's own session, only while you are this Mac's one owner.
     The architect accepted the narrowing (2026-11-09) as what ruling 1 asked for.
  2. **"This Mac's one owner" comes from a new store, `stores/local-owner.ts`.** It reads `org.view` at connect and at each `org.changed`, and finds the machine whose ref is this Mac's. An org-owned Mac resolves to its admins. The store is wired in `App.tsx`.
  3. **The sheet opens on a policy read, as Share's does.** If the Mac's sminos can't keep a reach, it shows the "can't yet" line. If the reach can't be read, it offers Reload. It adds one person per save. "Already an owner" reads as a no-op, not as a failure.
  4. **`copy.ts` gains a `grade` refusal line**, so both sheets name the endpoint's owners-only refusal.
  5. Main and the e2e fixture are unchanged, because no test showed a defect in `org.owners.add`.
  6. **The architect's rulings on the task's concerns:**
     - Share's own gate admits the same non-owners on this Mac. It takes the same one-owner clause in this milestone: in Task 1's fix wave, or in Task 2 if the review finds nothing to fix. The endpoint's contract doesn't change.
     - The exact check needs a local `record.policy` that answers as the calling device's member. That is a residue row for the architect, with the desk track reviewing. It carries two costs. On a Mac with more than one owner, Add owner and Share are hidden on its own sessions, which costs nothing while every Mac has one owner. Under `MAWS_DEV_ORG`, `org.view` is null, so neither shows on this Mac's sessions. It triggers on a Mac with more than one owner, or a change of a Mac's owners (widened on 2026-11-09 for the review's I1). It ends when the local `record.policy` answers as the calling device's member and both menus use the exact check.
     - **I1, the head skew, is one of its costs** (the architect accepted it as residue, 2026-11-09). The gate reads "you are this Mac's one owner" from the app's `org.view`, and the session from mawsd's `record.policy`, which answers from mawsd's own held head. Until mawsd takes the head that hands this Mac to you, both menus and the sheet can offer an add the door refuses `grade`. The door stays the authority, so this is a wrong offer, not a bypass.
     - In the fix wave (4d33e84f9), Share takes the same one-owner clause through one helper, `useOneOwnerHere`, and Add owner's gate is `useCanShare` itself. The gate's comments call it a hint that the door decides. The PR lists I1 under Unresolved Review Findings, and M5b makes no endpoint change.
  Date/Author: 2026-11-09, O8's executor (Task 1) and controller; item 6 the architect's rulings.

- Decision: M5b Task 2, the local suite (67af5b945, 3767a4ba6, 51b93834e). Built as briefed. Its decisions:
  1. **The stand-in executes `record.owners` as sminos's `add_owner` does.** The member is added, the verified act is appended verbatim to `ownersProof`, and `policyRev` is bumped. An existing owner changes nothing.
  2. **Lane B is placed by its spawn from its first join.** A record is placed only once, at its first join, so the owner add's re-list can't run `#bySpawn` again. Instead `app-c` is placed by its spawn from the start, as when a `/clear` races its first record. The re-list carries [spawn act, owner act] and keeps its listing under `app-c`. The case asserts both the order and the placement. The spawn act is the minimal `{device, opId, action: 'session.spawn'}` that `targets.test.ts` uses; the endpoint reads only `action` and `opId`.
  3. **One case covers both routes.** S's owner is added over A's link, and `app-c`'s through the local door.
  4. **The refusal of a share holder is pinned (the architect's ruling 1).** B, at `approve` and not an owner, adds through the app's own `createOrgPolicies.addOwner`, with B's real signing and step-up. The act is refused `grade`, and the record is unchanged. Grading `record.*` at `approve` makes the case fail.
  5. **The race at `share.spec.ts:251` has a `showPeople` helper.** It waits for the project's hover card to close before the right-click. If the right-click's own hover opens the card again, it closes the menu and the card with Escape and retries inside `toPass`.
  6. **What the case proves, by its review** (the architect asked for this). For both lanes, B's real rows go from `owners: [A], mine: false` to `owners: [A, B], mine: true` from the next listing. Lane B is also confirmed in the hub's machine-signed listing under `app-c`. So both halves prove the outcome, the owners a row shows, and not only that the act was carried.
     - **What it doesn't prove.** For lane B, it doesn't prove that B gains effective owner authority: the suite's lane B authorization records are a fixture separate from the member frames, and they still name A alone after the add. It doesn't prove the label rendered on the row: `owners.test.ts` (M5) covers the label from row data, and M8's step 7 covers the label on staging. And it doesn't prove execution by real sminos, which step 7 also covers.
     - The review left this as a Minor, carried to the PR's Unresolved Review Findings. A future case in which B acts as an owner derives the lane B authorization records from the member updates and asserts a `manage`-only act by B.
  Date/Author: 2026-11-09, O8's executor (Task 2).
  Item 6: the controller, from Task 2's review.

- Decision: M8's sitting script (2026-11-09, master cf30dafdd; branch `p5-o8-m8-sitting`, docs only). M8's Concrete Steps are rewritten as one ordered script, with step 7 first, a role on each step, and the exact verbs. The script is checked against master:
  1. **B4 is done** (O14's document: steps 4 to 8 on 2026-11-07), so step 2 is a check only.
  2. **Both hubs suffice,** read credential-free at the refresh. Production serves `hub@14ec1177`; `device.remove` (M4a) and M3's deliveries need nothing newer, and #538's key-bound delete isn't on M8's path. Staging serves `hub@e181a194`, and M5b is renderer only.
  3. **The swap is unmet at the refresh:** the MacBook read `cfff902f`. The swap of all three machines to cf30dafdd is the first precondition. The architect has asked the owner for it.
  4. **Step 7 needs no browser sign-in from B.** The check is the owner's row naming B, and `real-member add` makes B a member of the head without B signing in. So step 7 skips `access-sync`, B's pairing and M6b's browser pitfall. Those come back only in its fallback, where B's profile is the check. Rejected: running all of M6b's layer 2. It would put a second identity's Access session in the owner's browser for a check that doesn't need one.
  5. **The owner's staging profile pairs as the owner's own staging member,** with `staging-run.sh admin pair --class native-mac`, as at M1's staging sitting. Staging's admin device belongs to that member. The staging machine is a VM the desk track enrolls with that member among its owners, so that both sessions are the owner's.
  6. **Unknown, and settled at the sitting:** whether the app's device is already a production root (step 1's `show`), and whether a scratch dev profile steps up for `record.owners`. The desk track's rehearsal answers the second before the sitting, and the fallback covers a no.
  Date/Author: 2026-11-09, O8's executor, at the architect's request.

- Decision: M8's sitting (2026-11-10, on master cf30dafdd at all three machines; P5 Decision Log 262). It ran as the script says, with these deviations. Each is recorded here, and the script is corrected where one applies.
  a. **The pairing race** (Surprises, M8 7.2). Step 7.2 now starts only once the desk says 7.1 and the scene are done. The tooling half is board #547.
  b. **The early teardown** (Surprises, M8 7.6). Step 7.8's teardown now starts only on the owner's explicit word after the relaunch.
  c. **keep-a1's own lane A and lane B sessions served as the two rows,** agreed with the desk track beforehand, instead of a terminal session and a New chat of the owner's. The owner's staging member owned both, so the act and the check are the same. Step 7.4 says so.
  d. **The owner's staging admin verbs needed `DESK_STAGING_DEVICE`** to name this Mac's staging admin keys. Fixed in the script before the sitting (0f4b783f1).
  e. **The first root add's confirmation read something other than `y`** (Surprises, M8 step 1). Step 1 now says to run it again in a fresh Terminal window. #547 makes the refusal say what it read.
  f. **Step 1's Re-sign check didn't apply** (Surprises, M8 step 1). Step 1 now names step 3's signature as the proof instead.
  g. **One precondition added:** before the removal, the architect asked whether the owner holds the paper recovery key. The owner answered "Go, I have the key (Recommended)". It is now in the script's preconditions.
  h. **The architect drove the page at the owner's request.** The owner's regular MAWS wasn't running at step 2, so the architect opened it and read Settings › Org through `cua_repl`, and pressed Sign at step 3 on the owner's go while the owner was at the window. Touch ID was the owner's. The script now allows this.
  Date/Author: 2026-11-10, the architect's record; written by O8's executor.

- Decision: M5b is built as two tasks under subagent-driven execution, each reviewed at its frontier, then one branch review at reviewer-medium (the section names none; M5b signs nothing new and adds no wire). Neither task touches `src/endpoint` or `apps/`, so the desk track has no hunk to review.
  1. **The renderer**: `AddOwnerSheet.tsx` and its test, the `addOwner` dialog kind, the menu items in `menus.tsx` and `Toolbar.tsx` under Share's gate, the copy, and the e2e fixture's answer if a spec opens it.
  2. **The local suite**: the stand-in's `ownersProof` append and the lane A and lane B case.
  Disk on this MacBook is thin (about 7 GiB free at the cut): one worktree, and its install limited to what the gates need. Work stops if free space falls under about 2 GiB.
  Date/Author: 2026-11-09, O8's executor (controller).

## Outcomes & Retrospective

**M1 (2026-10-28, PR from `p5-o8-m1`; the live staging sitting pending at the owner's hand).** The app signs in to the org from a pairing code, registers its device, holds the org's chain from genesis behind an anchor, follows the hub over the `?app=1` feed, and hands O7's links a production session. A never-signed-in profile makes no keys, files or requests. Evidence: the unit suites (`access-login` 32, `held` 22, `registry-feed` 29, `hub-client` 3, `org-session` 56, `OrgSection` 13) and `test/org/sign-in.local.test.ts` (7, on desk-hub's Worker in Miniflare with O13's real `pair` approving, the app's fingerprint equal to `pair`'s, and O7's link up over the hub on the production session), class 1a and the hosted Electron groups (the PR body has the runs). Still owed: the staging sitting (the fingerprint match on a real Access login, `/api/me` through `cf-access-token` from the app, a relaunch with no browser), recorded here when it runs.

**M2 (2026-10-28, PR from `p5-o8-m2`; the live check held 2026-10-30 at O14 B3, P5 Decision Log 154).** Main keeps every hub-served session listing that verifies against the held head, judged per key against a persisted mark that a withdrawal keeps and only a signed head ends, cached in `listings.json` and verified again at load and at each head; `org.rows` gives the renderer the RL2 roster's rows, `complete` and `pending`; the sidebar draws the member's own listed sessions under their org projects, and a covered machine is loaded and settled only once its rows are known. Evidence: `rows.test.ts` 22, `test/org/rows.local.test.ts` 4 (desk-hub's Worker in Miniflare, a real endpoint's lane A and lane B listings), the renderer suites (events 42, derive 38, Sidebar 91, org-projects 6, remote-openers 2), and the final gate (run 40691164424). Still owed: the live check at the first cut-over machine.

**M3 (2026-10-28, PR from `p5-o8-m3`; the owner's sitting pending).** The app becomes an org signer once the held head lists its step-up key as a root:
- it signs typed successors behind Touch ID, through the checks before signing and the package's `verifySuccessor`, from a durable pending slot whose exposure is written before every send;
- it signs the weekly successor at a focus;
- it offers the revocations a recovery left lost, each closure shown before Touch ID;
- it delivers every key-ending state to the roster's machines over O7's links, recovering first after a recovery and paging within RL2's bound;
- it makes new keys through a transaction that recovers at every boundary.

`deployment admin root add` makes a listed admin `native-mac` device a co-root.

Evidence:
- the unit suites: `checks` 35, `signer` 39, `signing-store` 8, `weekly` 13, `deliveries` 22, `org-session` 94, `keys` 40, `step-up` 20, `OrgSection` 31, `admin` 35;
- `test/org/signer.local.test.ts` 8, on desk-hub's Worker in Miniflare with O13's real admin and an enrolled endpoint, including a run at the delivery bound over the real link;
- the gates the PR body lists.

Still owed: the owner's sitting, `root add` on staging and then on production.

**M4a (2026-10-29, PR from `p5-o8-m4a`).** Settings › Org is the Org page, in Q1's four groups:
- **You:** this Mac, the hub sign-in, new keys, and your other devices.
- **People:** each member with their devices, the roots marked.
- **Machines:** each machine, read-only, with its owners and whether it is up.
- **Org:** the state, the roots, the recovery key, and M3's signer lines.

A root Mac signs the page's changes from it:
- add or remove a person, change a role or an email;
- pair a device: the app makes the code, polls H1, and endorses its own member's later device inside the same Touch ID;
- remove a device, make a root.

Each change is shown line by line, judged by `org-protocol`'s `successorProblems` before Touch ID, and bound to the digest of what was shown. `Edit.live` guards it at apply, before Touch ID, after the confirmation, and before the slot's write. A refusal shows under the control that sent it, or in a row of its own when it names none. `close()` fences every writer under `org/` and joins it, and the two test workarounds are gone. The desk-hub admin's `amend` runs the same pre-sign check, and the pairing judges moved into `org-protocol`.

Evidence:
- the unit suites:
  - `successor-problems` 62, `pairing` (package) 19, `edits` 21, `checks` 38, `step-up` 25, `signer` 46, `pairing` 16, `org-session` 113 (20 runs in a row, the workarounds removed), `held` 24, `page-fixture` 5;
  - the Org page's renderer suites: `OrgSection` 12, `YouGroup` 11, `PeopleGroup` 9, `MachinesGroup` 3, `OrgGroup` 18, `ChangeSheet` 11, `PairSheet` 6;
- `test/org/org-page.local.test.ts` 6, on desk-hub's Worker in Miniflare: a second member added, paired through H1, promoted, made a root, demoted, an own device paired endorsed, the device and the member removed, and every accepted state verified from genesis;
- `e2e/org-page.spec.ts` in `e2e:settings`, the page's look over a seeded org under forced classic scrollbars, its screenshots attached;
- the gates the PR body lists.

Retrospective (M4a). Built as eight tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-high on the whole branch, which found nothing material.
- **The task reviews.** They found real defects in five of the eight tasks (2, 3, 5, 6 and 8).
  - Three had M3's shape, a fact checked before an await and acted on after it: the liveness window during the first write's registration mark (Task 3); a closed commit queue reached after an await (Task 5); a pairing's end, published before approve answered, hiding the answer (Task 6).
  - Two were a capability a surface kept after losing it: an open sheet still offering Sign (Task 6), and a fixture's seeded status overwritten by the real publisher (Task 8).
  - One was cost: quadratic diagnostics built for unauthenticated input (Task 2).
- **Task 8 paid for itself on its first run.** It was added mid-milestone to make the page's look checkable through the gate. That run caught a member name overrunning its label column on both the EC2 and hosted Macs, which happy-dom could never have shown. The architect read the same screenshots and found a second defect, a raw machine ref where a person reads.

A future child that ships a renderer surface should seed it with realistic extremes (long names, many devices, every refusal shape) and photograph it through the gate before the branch review, not after. Structural assertions (overflow, whole actions) catch what unit tests can't, and the screenshots catch what assertions don't name.

**M5 (2026-10-28, PR from `p5-o8-m5`).** A row of a session you don't own alone shows its owners as first names after the title ("you, Ana", "Ana, Ben +3"), and its hover card lists them with their emails. Names are derived from the head's emails in main. A People toggle, remembered per row under `sidebar.people`, draws other people's sessions in place; while it is off the row reads "+N others". It shows only where it can act. Rollups, ranking and search see only what is drawn and yours.

Evidence:
- the unit suites: `member-name` 6, `rows` 23, `owners` 6, `people` 7, `derive` 45, `Sidebar` 100, `HoverCard` 40, `events` 43;
- the final gate, run 40794571273.

Retrospective (M5). Only the whole hosted set caught the build's one real regression: a new hover button took the click an e2e helper aimed at the line's center at the 200px floor. Its unit tests couldn't see it, since happy-dom has no layout. The underlying fault was a design one, a control shown where it can't act, and fixing that also fixed the geometry. The task review's one finding was the shape M3's retrospective named: an early toggle replayed over state it hadn't seen. A future child adding a control to a dense row should show it only where it acts, and run the e2e groups that click that row.

Retrospective (M3). Built as eight tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-high on the whole branch.
- What the reviews found: ten task reviews found real defects in five of the eight tasks, and the whole-branch review found five more across tasks.
- The defects shared one shape: a fact checked before an await and acted on after it. That covers a run planned on a held line that moved, a registration snapshot that overwrote a sign-out, a queued attempt that missed an intent recorded meanwhile, a confirmation that outlived its proposal, and a post that captured a sibling as its parent.
- Every task-scoped review that read each module alone missed the cross-module form. The whole-branch review caught it, and its race reproductions held the named await open.

A future child that composes async modules over shared state should list each act's preconditions and re-check them synchronously at the act, with a test that holds each await open. It should also bind any person's consent (a sheet, a confirmation) to the identity of what was shown.

Retrospective (M2). The mark rule and the coverage rule, which the planning rounds had sharpened, were exactly where the build's two real defects lay: an unverified certificate read beside a verified record, and a set emptied across an await while another reader treated it as coverage. Both are the same shape: a trust or coverage fact derived from something that was not itself the verified or settled thing. A future child deriving state from verified records should take every derived fact from the verified object itself, and keep in-flight work visible in whatever a reader treats as coverage.

Retrospective. The document held: every decision it made stood, and the gaps it left were small (a `directory` refusal, a feed close hook, the chain re-read from below the head for a recovery). What it didn't foresee was the session's write concurrency: four parallel actors (attempts, adoptions from two sources, sign-out, recovery) each writing `registration.json`. Ad hoc fences left three windows, which the review found; one serialized commit queue closed them. A future child holding a trust anchor beside a credential should start from that queue. The test-writing workers found three real bugs each time they were given a module they hadn't written, which paid for the split.

**M7a (2026-11-06, PR from `p5-o8-m7a`).** A project's Channel tab, opened from the project's menu, draws the project's signed log as main verified it against the held head:
- exchanges between two sessions folded, broadcasts, people's words, and earlier to-human entries;
- DX1 history "attested at migration by <machine>", and unattested history as legacy;
- an unverified count for what failed;
- "as of" from the cache while offline;
- "Waiting on you", where the MAWS ask is answered in place.

Main reads the log over the Project socket into a bounded cache, one reader's (org and member), and sends the renderer verified events with `rev`-ordered deltas. The renderer folds them in a pure projection. The composer signs words with the device's channel key. Main is the only source of a word's state: sending, sent, refused, or Not sent within the app's life. That state stays bound to the org, member and device that signed the word.

Evidence:
- the unit suites (each run alone):
  - `verify` 15, `cache` 22, `channel` 23, `words` 14, `address` 7, `project-socket` 9, `holds` 3, `channel-fixture` 4;
  - the renderer's `project` 15, `state` 5, `ChannelView` 24;
- `test/org/channel.local.test.ts` 4, on desk-hub's Worker in Miniflare:
  - a v2 exchange folded with its owners;
  - a DX1 writer attested at migration;
  - a revoked key's event, and a forgery on A's transport, both counted and not drawn;
  - A's words received signed and unmacked on B's socket, then drawn back as A's;
  - "as of" across a relaunch with the hub down;
- `e2e/channel.spec.ts` in `e2e:settings`, over a harness-only seeded channel under classic scrollbars, with its screenshots;
- the gates the PR body lists.

Retrospective (M7a). Built as three tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-medium on the branch over three rounds.
- **The task reviews' findings.** Most had one shape: a fact inferred from a transition the observer might not see.
  - the renderer's ack inferred from a pending word's disappearance, under coalescing and across unmount;
  - an older buffered reset applied over a newer open;
  - a recalled receipt the log already held.

  Each was closed by moving the truth to the one process that sees every transition (main), and numbering what it publishes (`rev`).
- **The branch review's findings.** They were trust boundaries the tasks had each held locally but not at their seams:
  - the cache scoped by org, not by reader, against O18's per-member reach;
  - a judgment recorded after its await;
  - legacy lifecycle feeding identity, first for addressing and then for attribution;
  - a superseded channel's write.
- **Task 3's screenshots.** They caught two layout faults that happy-dom couldn't, as M4a's did.

A future child that reads hub-served content into a cache should key the cache, its cursor and every projection by the reader whose rights fetched it. It should also carry each datum's provenance to the point of display, not just to the point of judgment.

**M7b (2026-11-07, PR from `p5-o8-m7b`).** A project's Channel tab shows every session's to-human entries from every machine, placed by time among M7a's entries. Each entry carries its session's title and machine chip. A machine that isn't live shows "as of", and one that can't be read is greyed. The entries are:
- messages: lane A's to-human tool, lane B's message tool and `<message>` spans;
- questions, MAWS asks among them, with their choices;
- the answers given to them.

Each machine keeps its own entries in its spine's journal, an `ADDED_TABLES` table, so a downgraded build keeps its index. It holds the newest 2,000 per project and 30 days. Lane B's entries come from the one extraction the report view uses. Lane A's come from sminos's host messages, handed over beside `notifier.hostMessage`.

The endpoint serves a member only the entries of sessions they may `view`:
- through `channel.history`, paged with opaque cursors;
- through a project-scoped `channel` feed (`rl2.channel`, RL2 1.12), whose rank is re-checked at every change of rights. Another member's private activity never makes a frame.

Main reads this Mac's spine and each roster machine. It falls back to history against an older endpoint, dedupes on (machine, id), and caches per machine for one reader.

Evidence:
- the unit suites: `journal`, `to-human-items`, `channel-view`, `channel-cursors`, `channel-feed-queue`, `channel-feed`, `machines`, the renderer's `state`, `project`, `ToHumanEntry` and `ChannelView`;
- `test/org/channel.local.test.ts` 7, on desk-hub's Worker in Miniflare, with a real endpoint and a real spine journal over RL10. It covers to-human entries from both lanes with their titles and machines, "as of" after the link drops, and an older peer read through history alone;
- `e2e/channel.spec.ts`'s to-human entries, photographed;
- the gates the PR body lists.

**M7b's live check passed** on 63443a3bd (the owner's screenshot on the MacBook, 2026-11-08 22:41Z, P5 Decision Log 257). The m7b-live-check Channel tab shows m7b-vm's question (11-07 21:21Z, two choices) and m7b-mini's to-human message (11-07 22:55Z), both test content. The check that failed at P5 Decision Log 251 now passes. The desk track is retiring the test seats.

Retrospective (M7b). Built as four tasks, with a review at each frontier and reviewer-high on the branch. The desk track reviewed the endpoint and org-protocol commits over six rounds.
- **Where the rounds went.** Thirteen items came down to five, then two, then two, then nothing under the agreed final-round bar. Nearly every item was one shape: an endpoint that answers a member must never let what that member can't see change what it sends, whether in content, existence, frame type, timing of an end, or completeness of a page. Such leaks hide in recovery paths that run only under load, such as overflows and restarts, where "send something reasonable" quietly depends on hidden state.
- **A ruling that was overturned.** The round-4 position ruling held a journal position. It assumed delivery runs in id order, which snapshot pages ordered by `(at, id)` broke. Recovery from an explicit list of let-go ids replaced it.
- **The architect's binding conditions.** One extraction of a message, asks from their own record, and no start-path drops kept the channel and this machine's own to-human view from disagreeing.

A future child that serves session content through a feed should state, before building, which inputs may influence each output (content, existence, frame type, end reason, paging) and test each one against a hidden-only variant. It should also key identities on an append-only id, never on a sort order.

**M6a (2026-11-07, PR from `p5-o8-m6a`).** A session's unread, last seen, pinned and draft are now kept per member in the spine's index. The machine's owners keep the session row, shared among co-owners. Every other member keeps their own rows, in `reader_state` and `member_drafts`, both `ADDED_TABLES` entries. Nothing one member reads, pins or types moves what another sees.

**Reaching the rows remotely.** A remote member reaches them over RL2 through a new machine command, `session.reader.update` (`WIRE_MINOR` 31, graded `list`, answering a four-field `ReaderState`), and through `session.drafts.get` and `.set`.
- Each call carries the reader that the authorization decision named, and the reader is checked again where the call leaves for the machine.
- Every record the endpoint sends a member carries that member's own reading, or none: answers, `session.changed`, snapshots, history pages and remote rows. An owner's queued change goes out only while the head that made them an owner still stands.
- A reopened checkout feed reads the record again, ordered and retried.

**The device.** On a machine that keeps the rows, a remote lane B session's reading, pin and draft survive a relaunch. On an older machine, today's in-run fallback runs unchanged.
- One session's draft saves are serialized. A save names the draft it replaces (a compare-and-set on the writer's stamp), and a clear leaves a tombstone.
- A draft's text always persists. Attachments over the link's budget stay in the run, with a note, and are never deleted just because they were left out.

**Also in M6a's PR:** the certificates parity fix that the desk track asked for, outside the reader work (65e0532b1).

**Evidence:**
- the unit suites: `migrations`, `sessions`, `drafts`, `register`, `test/endpoint/reader-state` (22, every surface through real channels), `subscriptions-b`, `remote-checkout`, `test/lane-b/remote`, the renderer's `remote-reading`, `remote-drafts` and `visibility`;
- `test/lane-b/drafts-enumerated.test.ts`: every order of up to 5 events from 7, against the real `DraftStore` and the renderer's queue, for an owner and a member. It checks that the machine never ends on an older draft, and that no attachment disappears unless removed;
- the gates the PR body lists.

**Retrospective (M6a).** Built as three tasks, each with a review at its frontier. The desk track reviewed the endpoint over four rounds, then the renderer, then each draft-path delta, and our reviewer-medium reviewed the branch.
- **Where the rounds went.** Each fix had the same shape: authority, or currency, checked at one point and assumed at a later one. A reader named at authorize and used at dispatch. An owner checked at enqueue and sent at dequeue. A reply applied after a newer record. A save released at a timeout while its act still ran. A clear that left nothing to compare against. A transport omission read as a deletion.
- **What found the draft-path orders.** Review found the draft-path bugs one interleaving at a time, three rounds running. The enumerating test found 361 failing orders on the tree it was written against, then 822 more once its alphabet gained an edit over the budget. Its blind spot was its alphabet, not its orders.
- **The fork.** The spec's "`session.update` answers `ReaderState`" met the strict output check of a machine-owned wire entry. A new command at a minor resolved it; a union would have needed a major.

A future child that keeps state written from more than one place over an unreliable link should write the enumerating test first, before any review. Its alphabet should include every event that changes what crosses the link: a timeout, a late landing, a read-back, and a crossing of the size budget. It should also check authority at the point where data leaves, never at the point where the decision was made.

**M6b (2026-11-08, PR from `p5-o8-m6b`; the live proof at the shared staging run, with the real-member sitting).** A member can widen or narrow a session's reach from MAWS, and nowhere else, once its machine's sminos can keep it.
- **The Share sheet** opens from the session's header and from its row's menu, on a session you own in a hub project.
  - It sets General access (Private, Listed, Org can view, Org can talk) and each person's grade (Can message, View, Converse, Approve), with the spec's help text word for word.
  - It lists the changes in the order Save sends them. A removed person stays struck through, with Undo, until Save.
  - Save asks Touch ID once for every line. Each line shows its own outcome: a refusal in words naming the machine, never blank, and an unknown outcome with Reload.
  - A revision that moved before or after Touch ID sends nothing and reads "Changed elsewhere: reload".
- **Rows carry marks:** a lock for Private, a people mark for shares. Your own sessions' marks are read from `record.policy`, and another member's private session shared with you is read from its listing's `audience`.
- **Private sessions reach their people over the channel.** Their listings come from each machine's link and merge into the rows by two memberships per key, so a session going private never blinks.
- **This Mac's own sessions** change through the local door. It verifies the step-up signature every time, derives the member from the head, then authorizes as a channel does.
- **Reads and saves are fenced to one sign-in.** A policy read or a save that outlives its sign-in publishes and sends nothing. The sheet closes when its reader changes.
- **The welcome's `record`** appears exactly when the offers are served. sminos keys its CLI cutover on it: widening at the terminal reads "use MAWS", and narrowing stays. That cutover and this milestone are preconditions of a second member joining production.
- **The staging harness** widens through A's record acts, adds the items m6b-cutover, m6b-visibility and m6b-reader, and carries the real-member steps for the sitting.

**Evidence:**
- `test/endpoint/record-acts.test.ts` (23);
- `policy.test.ts` (25), `step-up.test.ts`, `rows.test.ts` (36, with the enumerating test over 5,040 permutations and 16,807 five-event sequences), `policies.test.ts` (8), `ShareSheet.test.tsx` (15);
- `test/org/policy.local.test.ts` (6, on desk-hub's Worker in Miniflare, with a real endpoint and a sminos stand-in that holds each rpc to sminos's proof binding and field set, with five tampering probes);
- `e2e/share.spec.ts`, with its screenshots;
- the deploy suites: `reach-acceptance` (37), `real-member` (24), `staging-scripts` (33);
- the gates the PR body lists.

The shared staging run (Concrete Steps), 2026-11-08, on the branch head 169108598, whose code is the gated tree; it found no defect in what M6b admits, so the landing stood (P5 Decision Log 252):
- **Layer 1, the harness member,** passed every item, among them lane B inside the reach scenes and the record acts over the relays. The first pass from 02:51Z failed on infrastructure: the MacBook couldn't resolve the staging names for about a minute at a load near 147. The rerun from 03:25Z passed all but 3d, an archive-window flake that passed alone at 03:54Z. Nothing was left behind, the secret scan was clean, and production was unchanged.
- **Layer 2, the real-member sitting,** from about 04:40Z. A was the harness, kept up by the desk track's driver, and the owner played B, signed in through real Access with their second email and paired as B's first device. A private session left B's sidebar. Shared at Can message, it came back as "Private · shared with you" with no transcript. At View, its transcript showed. At View, B's Send sent nothing, and A's endpoint logged no act from B. At Converse on a lane B session, B pinned, read and drafted, and A's reading and draft were unchanged. `sminos share` at a terminal answered "use MAWS".
- **Three reader-side defects,** board #525: the pane at Can message never settles, the owner's prompts read "Your message" to a reader, and View's Send fails without a word. They join the second-member precondition. Fixed by PR #530 (merge 3527b7248, P5 Decision Log 255).
- **The sign-in pitfall was wrong twice** (Concrete Steps, corrected). Access's logout URL revoked the owner's cloudflared CLI token too, which ended the pair until the owner signed in again. Afterwards, a stored Google session still completed Access as the owner, until the browser's site data was cleared and the one-time PIN was used.
- **Teardown** was complete at 05:27Z: B was removed and its keys revoked, Access admits only the owner, the run's entries were swept, the VM was deleted, and the profile's daemon was ended and its directory removed.

**Retrospective (M6b).** Built as four tasks, each reviewed at its frontier. The desk track reviewed the endpoint and the deploy harness, and reviewer-high reviewed the branch.
- **Where the rounds went.** M6a's lesson held, one layer up. Almost every material finding was an identity or authority checked once and assumed later, at a lifecycle boundary:
  - a policy read published after its sign-out ended;
  - a save that kept sending under a later sign-in;
  - a sheet that outlived its reader;
  - a shell trap that took absence at the start as ownership;
  - a removal whose revocations came from a head `amend` had already replaced.

  The enumerating test written first (Task 2's rows) found its own class early. The lifecycle boundaries had no such test, and review found them one at a time.
- **What the tests couldn't see.** The `print` miss passed four reviews and every test: the tests injected the very function whose argument threw, and the typecheck's DOM lib hid the unbound name. Only a test that runs the real composition, in the real runtime, catches that class.
- **A gate gap.** Running static alone on the first two tasks hid a red unit gate for two tasks.

A future child should write, for each piece of state or authority that a sign-in, a head or a process owns, a test that ends that owner mid-flight: during a confirmation, between two sends, before a read-back. It should also run each operator-facing command at least once, end to end, in its real runtime, before review.


**M4b (2026-11-08, PR from `p5-o8-m4b`; live use needs the next swap, for `WIRE_MINOR` 33, and the hub deploy that carries #538).** The Org page's Machines group is no longer read-only.
- **Enroll a machine.** An admin whose Mac may sign enrolls a machine, or re-enrolls one from its row. The page:
  - mints the enrollment;
  - shows the code once, with Copy, and the line that the machine runs `mawsd enroll` and pastes the code at its hidden prompt (`--replace` for a machine still enrolled), with the expiry throughout the wait;
  - polls for the machine's key, MAC-checked under `k` and frozen at its first good answer;
  - shows the name, ref and key id to compare;
  - signs `machine.add` or `machine.replace` behind one Touch ID.

  The sheet owns exactly the run its start's answer names. A numbered cancel can name only that run, and a `null` cancel only the sender's own start.
- **Owners and drop** go through the change sheet. A certified machine's owners are its delegation's, and this Mac's own machine has no Drop. A drop deletes its hub row when the drop's state settles, however it settles, and never while the held head lists the name again. The delete is bound to the dropped key (`?ref=&pub=`, #538) and preceded by a read of the hub's rows. A row left behind offers Retry. Removing a member who owns a machine says "Change the machine's owners first", linked to the machine's row.
- **Rights.** Each row lists the members holding a grant on it, read from the machine's own ledger, with pending, refused and missing grants marked.
  - Grant… shows wherever `grantProblems` admits this device as the signer: an owner, or an admin of an `'org'` machine (Fork B), whatever `maySign` says.
  - A grant is one Touch ID. The sheet loads until the first read answers, and empty rights can be sent only under Withdraw.
  - A grant goes through the local door for this Mac's own machine (Fork A), and over the link for any other. Over a link it goes only once the machine answers at or past the signing head, on the app's current line; the app pushes its line first. Every verdict is final.
  - A grant this Mac issued that the ledger no longer holds, after a re-enrollment, is offered for Re-grant… above both marks.
- **Underneath.**
  - `org-protocol`: the v2 enrollment codec and the machine readers moved from desk-hub, and `grantProblems` (with `verifyGrant` built on it).
  - The endpoint: `endpoint.grants`, and the door's `endpoint.grant`.
  - mawsd: `endpoint.local.grants` at `WIRE_MINOR` 33.
  - Main: `RecordSigner`, which signs the grant domain only; `grants.ts` with grants.json (fail-closed, with a write-ahead `sending`); `enroll.ts`; the machine edits; the hub client's mint, key read, delete and row read.

**Evidence:**
- `org-protocol`'s `enrollment.test.ts` (19) and `records.test.ts` (21), with the admin, vector and identity suites unchanged.
- `test/endpoint/grants-call.test.ts` (17).
- The main suites: `edits` (31), `enroll` (26), `hub-client`, `grants` (51), `grants-store`, `deliveries` (30), `step-up` (39), `org-session` (149).
- The renderer suites: `MachinesGroup`, `GrantSheet`, `EnrollSheet`, `ChangeSheet`.
- `e2e/org-page.spec.ts`, with its screenshots.
- `test/org/org-page.local.test.ts`: cases 7–11 and Fork A's, 12 tests, green on three CI attempts.
- The final gates the PR body lists.

**Retrospective (M4b).** Built as six tasks, each reviewed at its frontier. The desk track reviewed every `apps/org-protocol`, `apps/desk-hub` and `src/endpoint` hunk, and reviewer-high (production code, with a security lens) and reviewer-medium (the renderer and tests) reviewed the branch.
- **Where the rounds went.** The deepest work was one rule, *a grant lands only under a head at or after the one its signer saw, and a refused grant never lands without a new confirmation*, and the many places where state outlives a moment:
  - Task 4 first retried every verdict.
  - It then trusted a version that wasn't a lower bound: caps not re-sent, a rewind lowering the head.
  - Its fixture projected the app's head where the endpoint projects its own.
  - The branch review then found three paths that resent a refused grant: a stale snapshot, a verdict after sign-out, and a swallowed write.

  Each was a guarantee checked once and assumed later, which is M6b's lesson again.
- **Inference is the failure mode.** Enrollment ownership took four rounds because the renderer inferred which run was its own, from generation order and then from name and machine, and each inference left a racing order. The fix was to stop inferring: main's start answer names its generation. The cancel was the same: it was global until the architect scoped it, first by generation and then by sender.
- **Fixtures can lie in the direction of the code.** Two masked tests passed because the fixture answered from the app's view, not the machine's: the endpoint's ledger projection, and case 8's push that the earlier push satisfied. A reviewer reading each case against the regression it claims to catch found both.

A future child should state each guarantee as an invariant over every path that can act on durable state: a send, a resend, a restart, a sign-out, a close. It should test that invariant with the fixture answering from the other side's real view. Where ownership can be named by the authority that creates it (a generation, a signer), name it rather than infer it.

**M4c (2026-11-09, PR from `p5-o8-m4c`).** The Org group gains **Delegations**.
- **The rows.** Each delegation shows its prefix, owners, expiry, uses and the certified machines it has made, with the hub's key beside it for an admin. A half-done renewal or drop offers Retry, which calls only the hub's route.
- **Create.** While this Mac may sign, an admin creates a delegation from a sheet. The app mints the hub's key, makes the delegation's key pair in main, signs it into the pending slot unsent behind one Touch ID, and writes the provisioning code straight into Secret Manager on a `gcloud` child's stdin, confirmed by `describe` and never read back with `access`. Only then does it publish the slot. A failed write leaves the delegation unsent, with "Write the code again" while this run holds the key pair, and only Discard (which revokes the key) after that.
- **Renew and drop.** They go through the change sheet. Their hub halves follow from the signed head against the hub's key list: no continuation is stored, and a relaunch shows what's left from the comparison alone.
- **Stray keys.** Hub keys that no state names (a crash between mint and sign, a refused Touch ID, a failed revoke) are listed with their age, each with a confirmed Revoke. A key under 15 minutes old gets a stronger warning, since a CLI or another admin's create may still be using it.
- **The destination.** It is main's own `provisioning-secret.json`, not a settings section (O7 M9). It has Save, and a Reset for a damaged file.
- **The code never shows.** It isn't displayed, copied, written to disk, logged, or sent to the renderer.
- **The prefix rules live in `org-protocol`.** `prefixProblem` and `mintDisagrees` moved there, with directional prefix codes in `successorProblems`, so the app and the deployment admin judge collisions alike. The hub's acceptance is unchanged.

Evidence:
- the unit suites:
  - main: `delegations` 64, `signer` 67, `secret-store` 21, `provisioning-secret-store` 10, `hub-client` 20, `edits` 36, `checks` 40, `view` 9, `org-session` 160;
  - `org-protocol`: `delegations` 11, `successor-problems` 82;
  - the renderer: `DelegationsSection` 18, `DelegationSheet` 16, `ChangeSheet` 22;
- `test/org/org-page.local.test.ts` 15 of 15 on three CI attempts. Cases 13-15 create a delegation against the real local hub through a fake `gcloud`, provision a real endpoint from the code it received, renew it, and drop it;
- `e2e/org-page.spec.ts` in `e2e:settings`, with the section and the create sheet photographed;
- the gates the PR body lists.

Retrospective (M4c). The milestone was built as six tasks, each reviewed at its frontier, then by two branch reviewers. Every task review but Task 1's asked for fixes. Every material finding was one of three kinds, each the shape M4b's retrospective named.
- **An ending that didn't reach everything the run held.** Publication was bound to a hash, not to the run holding the key pair (Task 2). Custody outlived its run in locals and in-flight children (Task 4). Hub work was queued under one sign-in and ran under the next (Task 4). A Discard ended a run without recording itself (branch).
- **A secret reaching a string.** gcloud's own HTTP log (Task 3), a token fragment through the error grammar (Task 3), and the hub's own field echoed in a diagnostic (branch).
- **An outcome claimed from an inference rather than from the authority that knew it.** "Published" was read from a slot's absence. "Not minted" was read from an unreadable 201. A renderer adopted whichever unsent row was there. A row treated the status as current though it travels a different Electron pipe from the answer. The fixes all moved the claim to its source: the signer's own word, main's run identity, and a revision the answer names.

A future child that holds a secret across awaits should state, before it builds, which owner holds each secret and which endings drop it. Its tests should end the run while each external step is still out, and they should read every outcome from the party that performed the step.

**M5b (2026-11-09, PR from `p5-o8-m5b`).** An owner adds an owner.
- **Where it is offered.** "Add owner…" sits beside Share, in the row menu and in the session's header menu, under one gate:
  - on a remote listing that names you an owner;
  - on a session of this Mac while you are its one owner.
  Share takes the same gate. The gate is a hint, and the door decides: every `record.*` act is graded `manage`, which only an owner holds.
- **The sheet.** It offers the head's members who aren't you and aren't already owners. Saving sends `record.owners {add: true, member}` behind one Touch ID, through M6b's record path or this Mac's door, and the outcome shows in the sheet: added, already an owner, or the endpoint's refusal in words.
- **The scope shrank to the renderer and one local case**, because M6b had built main's `org.owners.add`.
- **The live proof moved to M8's sitting.** It is its first part, step 7, on staging with the owner's second staging identity, since production has no second member.

Evidence:
- the renderer: `AddOwnerSheet` 9, `local-owner` 5, `reach` 9, `App` 12, `ShareSheet` 15;
- `test/org/policy.local.test.ts`, 8 cases. The sminos stand-in runs `record.owners` as sminos's `add_owner` does. A adds B as an owner of a lane A session over A's link, and of a lane B session placed by its spawn act through this Mac's door. B's rows then read both as `[A, B]` and B's own, and the hub's signed listing under `app-c` agrees. B, holding a share at `approve`, is refused `grade`, and the record is unchanged;
- `e2e:settings`, with `share.spec.ts`'s race fixed;
- the gates the PR body lists.

Not proved here: B's effective authority over the lane B session (the suite's lane B authorization fixture is separate from the member frames), the label rendered on a row (covered by M5's `owners.test.ts`), and execution by real sminos. M8's step 7 proves the last two.

Retrospective (M5b). The refresh mattered more than the build. Read against master at the cut, half the section had already landed with M6b, so the plan became two tasks instead of a main, shared and renderer build. Both task reviews turned on one question the architect asked up front: is the menu's gate the door's authority, or only a hint at it?
- The first answer found the gate admitting non-owners on this Mac's own sessions. This Mac's `record.policy` answers for all its owners, while the door authorizes as the device's member.
- The second answer found a head skew, which no renderer check can close.
Both came from reading the renderer's evidence against the authority that decides. That is M4c's lesson of reading every outcome from the party that performed it, applied to a permission instead of an outcome. The exact check needs the local `record.policy` to answer as the calling member, which is residue.

A future child that shows an action conditionally should name the authority that decides it, and say what evidence the menu reads and whose head that evidence comes from. Where the two differ, it should test the case in which they disagree.

**M8 (2026-11-10, the owner's sitting; master cf30dafdd on all three machines).** This Mac's device is production's only root. The deployment admin is ended, and its files are deleted. Step 7 ran first, on staging, then steps 1 to 6 on production.
- **Step 7, Add owner on staging: passed.**
  - The scene: VM `dc-m8-87b3`, with machine `o18-a1-966610` enrolled for A (the owner's staging member, `c34416f0…`) at v360, and keep-a1's lane A session S (`afa43ecf…`) and lane B session L (`960c31fe…`). B, the owner's second staging identity, was added with `real-member add` as `24009a66…` at v359.
  - The adder was a dev profile from the sitting worktree, on its own `MAWS_USER_DATA`, paired as A with `admin pair --class native-mac`. Its device, `eR5cNriJw9aZUfPsTiCnGg`, landed at v361 (04:49:57Z), after the pairing race (Decision Log, "M8's sitting", item a).
  - The act: Add owner on both rows from the sheet, with Touch ID in the dev profile once per row. After Save the sheet read "<B's first name> · Added as an owner" and "Its row names them once <machine> lists the session again", and its picker then read "Everyone in the org already owns it."
  - The hub's listings named owners `[A, B]` for L at 04:51:47.411Z (revision 1794286307411) and for S at 04:52:58.865Z (revision 1794286378865). The hover card read the machine with "direct (tailnet)", then "you" and B's first name, each with its address.
  - The relaunch check ran on a second scene (item b): B as `166912a7…` (v364), machine `o18-a1-1c80f2` (v365), with S `5ce53dfa…` and L `65378563…`. The owner added B on S (`[A, B]` at 05:01:47.988Z, revision 1794286907988) and on L (05:11:04.002Z, `policyRev` 0→1). After quitting and relaunching the profile, both rows named both owners, in the row and in the hover card (the owner's words, to the desk track).
  - Teardown: both scenes went down with their keys retired (v362, v366), and B was removed (v363, v367). No `access-sync` was needed, since B never paired. The owner's `admin remove-device` of the profile's device came at v368 (05:17:42Z). The profile's processes ended, and its directory, both email files and the VM were deleted. Production was unchanged at `hub@14ec1177`, and the desk track's log scans found no leak.
- **Step 1, the root add: version 23.**
  - The page before: org-state version 22, 5 days old, with one root, the deployment admin device's step-up key `8nSM5mHMn7jCSbEFzX4pwQ`. This Mac's device, `QesKSyD1pZgF_UGIAA5GGA` (fingerprint `mtfkb-224r6`), wasn't a root: the Signer line gave the root add command, and Delegations read "This Mac can't sign".
  - The first try, at 05:25:06Z, refused after the owner's `y`, with nothing signed (item e). The second, at 05:36:25Z in a fresh Terminal window, read "root added: QesKSyD1pZgF_UGIAA5GGA, step-up Uye8mN5gmOv1IVP3H-MyuQ (version 23)".
  - The page after: version 23, two roots, Signer "This Mac signs the org state.", recovery key id `HfZtE-wLmrEoK51Nh0x4Gw`. Re-sign wasn't offered, since the state wasn't due (item f).
- **Step 2:** a check only. B4 ran on 2026-11-07.
- **Step 3, the revocation: version 24, signed by this Mac.**
  - Before it, the owner confirmed they hold the paper recovery key (item g).
  - People listed the admin device as "deployme · Mac · root", with Remove device…. The sheet read: "Remove a device of <member>?", "One new org state carries this, signed with Touch ID:", "Remove <member>'s device deployme (native-mac) and revoke its keys", "Its step-up key leaves the root set". The architect pressed Sign through `cua_repl` on the owner's go, with the owner at the window; the owner's Touch ID gave "Signed version 24." (item h). There is no screenshot, because the sheet's text holds the owner's address, so this text is the record.
  - The page after: version 24, one root (`Uye8mN5gmOv1IVP3H-MyuQ`, device `QesKSyD1`), and Signer "This Mac signs the org state." People lists `Y4NFQOnw` (browser), `QesKSyD1` (Mac, root, this Mac) and `HvrQ9JMH` (Mac). No Deliveries line showed when it was read.
  - The hub, read by the desk track at 05:40Z: head version 24, issued 05:38:50.167Z. `root.keys` holds the one key. The device `deployment-admin-4d9cdf736347` is not listed. `revoked` holds its step-up key `8nSM5mHMn7jCSbEFzX4pwQ` and its channel key `GptYhzH9NLDNfpCsG4gN3A`.
  - The last `admin show`, at 05:40:46Z (`admin-show-20261110T054046Z.log`), read:
    - head version 24, with the member's three devices and one root line (`Uye8mN5gmOv1IVP3H-MyuQ`, device `QesKSyD1pZgF_UGIAA5GGA`);
    - machines: `mini` and `macbook` listed, `dc-linux171-1e68` certified, the rest retired;
    - delegation `7872ff6c6ff6a58065ae0a68160b5dcb`, prefix `dc-`, expiring 2027-01-26T22:11:51.983Z;
    - `legacyRetired` at version 16.
  - Adoption of version 24: the MacBook's endpoint at 05:40:36Z, and the mini's at 05:41:41Z (`mawsd endpoint status`, hub generation 925). `dc-linux171-1e68`'s at 05:38:54.091Z, 4 seconds after the head was issued (its `mawsd.log`: "endpoint: org state 24 removed 0 member(s), 1 device(s), revoked 2 key(s)"), read by the desk track at 06:12:31Z from the endpoint's files (`orgHighWater` 24, enrollment `org-listed`) once `cua_repl` released that VM.
- **Step 4, the deletion.** The owner removed `keys.json` and `keys.json.org.json`. The architect listed `~/.local/state/desk-hub-production/device/`, and it is empty. The offline recovery key is untouched.
- **Step 5, O15's check.** The page's Roots name one key, this Mac's device.
- **Step 6, the acceptance run.**
  - Items cited from earlier live proof:
    - 1: M1's staging sitting (P5 Decision Log 116) and production's sign-in.
    - 2: the rows at the first cut-over machine (P5 Decision Log 154).
    - 6: M6b's shared staging run (P5 Decision Log 252).
  - Items read at this sitting:
    - 3: the page reads "This Mac signs the org state." at version 24.
    - 4a: step 3's sheet, its words above.
    - 4b: Machines lists `mini`, `macbook` (this Mac) and `dc-linux171-1e68`, each Up and "Owned by you", the last "Certified through delegation 7872ff6c…".
    - 4c: Delegations lists "dc-", owned by you, expiring in 77 days, used 19 times, no cap, id `7872ff6c`, with Renew… and Drop….
    - 5: step 7 above. On production the sidebar's rows from `@mini` under the MAWS project carry no owners label, as they shouldn't, since the owner owns every session alone.
  - 7: cited from M7b's live check on production (P5 Decision Log 257). It wasn't looked at again this sitting, because a row's context menu can't be opened in a background window through `cua_repl`. **Pending:** the owner's word on a fresh look.
  - 8: steps 1 to 5.

Retrospective (M8). Every deviation came from timing between two actors, or from a check the script assumed and the product doesn't offer.
- A waiting verb signed against a head another actor moved.
- A teardown ran before the check it should have followed.
- A confirmation read input nobody could see.
- A Re-sign button appears only when the successor is due.
Each was safe, because the authority refused rather than accepted: the hub's `409`, the verb's "nothing was signed", and the sheet's digest-bound signature. A future sitting script should order every step that moves the head before any step that waits on it. It should start a teardown only on the person's word, and name only checks the product shows in the state the sitting will be in.

**O8 as a whole (2026-11-10).** Every milestone has landed: M1 to M8, with M4 and M5 each split (M4a to M4c, M5 and M5b), and M6 and M7 too (M6a, M6b, M7a, M7b). The Purpose holds:
- The app signs in to the org as its own device.
- It draws other machines' sessions and other people's, with their owners.
- It is the org's signer, now its only root.
- Its Org page administers people, devices, machines and their rights, and delegations.
- Owners set each session's reach and add owners.
- Each project's channel is the app's one reader of the log plane.
- The deployment admin's software root is revoked, and its key file is deleted.

Acceptance 1 to 8 is recorded. All three machines adopted version 24. Item 7 stands on M7b's live check (P5 Decision Log 257); the owner's fresh look at it was not recorded at the sitting and is O15's to take. The residue O8 leaves is in each milestone's section of `2026-10-28-p5-o8-report.md`, and the architect filed it as tracker rows at each landing. Two rows bear on the next work:
- the hub doesn't announce new certificates (m4c-r1);
- this Mac's `record.policy` answers for all its owners (m5b-r1).

Retrospective (O8). Built over 13 days as 13 landings, nearly all under subagent-driven execution, with a review at each frontier and a branch review at the rung each section named. The milestone retrospectives above found the same few shapes again and again:
- **A fact checked at one moment and acted on at another** (M2, M3, M4a, M5): across an await, a sign-in or a head change.
- **An outcome or a permission inferred, not read from the authority that decides it** (M7a, M4b, M4c, M5b): a slot's absence read as "published", a menu's evidence from another head than the door's.
- **An ending that didn't reach everything its owner held** (M6b, M4b, M4c): custody, queued hub work, a pairing's run.
- **A hidden input changing what a member is sent** (M7b): content, existence, timing, paging.
Two practices caught most of these before review: an enumerating test written first over every event that crosses a link (M6a), and running each operator-facing command end to end in its real runtime (M6b, and M8's rehearsal). Two practices paid off at every milestone: the refresh at each cut, which reconciles the section against master before anything is dispatched (it halved M5b), and the architect's rulings recorded in the Decision Log as they came. The live sittings found what no suite could. M6b's found a sign-in completed as the wrong identity, a logout URL that revoked the CLI's token, and three reader-side defects (#525). M8's found a confirmation that read the wrong line.

A future child of this size should write each milestone's invariants over every path that acts on durable state before it builds, and name the authority that decides each fact it shows. Its sittings should be scripts in which the person decides when each part ends.
