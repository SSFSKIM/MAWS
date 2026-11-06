# P5 O8 — The org interface (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O8**, §"O8: The org interface". Parent pin: blob `b99c1767b471e33857dbd3dc009ead783d09daa2` at master `910539147` (P5's Decision Logs 1–228; re-pinned on 2026-11-06 for the re-plan of the rest: 223 to 228 make M6's Share sheet O18's M5, with the `list` grade and audience streams; 154 moves the last machine, so the owner's words no longer wait; 155 waives B4's wait on M7's reader; 168 closes O3 and 222 closes O7; 190 makes the spawner an owner and leaves its residue (b) due before owners move; earlier pin blob `d07bfc4ea2466d7d5ca7ca3164aed4d93021311a` at master `6fb933626`, P5's Decision Logs 1–129, re-pinned on 2026-10-29 for M4's re-plan: 121 lands H1, 126 leaves M4 the refused attempt and the section's split, 129 lands M5 and names M4 next; earlier pin blob `e74a3c5d58e682790627cf0fc54abe23e161930e` at master `1bf619c83`, Decision Logs 1–116; first drafted at `5b46682f1`, re-pinned for Decision Logs 95 to 97, and again on 2026-10-28 for M3's and M5's re-plan: Decision Log 101 refuses O3's D2, so lane B's owner changes route to sminos's member record; 105 and 113 land M1 and M2; 111 answers Q1 to Q7; 116 passes M1's staging sitting and finds the double sign-in, fixed in its own PR; the others, 114 and 115 among them, change nothing here).
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
- [ ] M7a — The project channel: the log reader, the Channel tab and people's words — *executable (re-planned 2026-11-06); first*
- [ ] M7b — The project channel: to-human messages across machines — *executable; after M7a; the owner's week (P5 acceptance 16) starts when it lands*
- [ ] M6a — Reader state and drafts per member — *executable; after M7b*
- [ ] M6b — Visibility and shares (O18's M5) — *executable; after M6a; its live proof is the staging run it shares with O18 M6, which needs the desk track's sminos executors and a real second member (the owner)*
- [ ] M4b — Machines and their rights — *executable; after M6b*
- [ ] M4c — Delegations — *executable; after M4b; needs the desk track's renew route*
- [ ] M5b — Add owner — *executable; after M4c; lands once the desk track's `record.owners` executor and DL190 (b)'s fix are on master*
- [ ] M8 — The deployment admin's end, and acceptance — *owner steps and evidence; last; needs O14's B4 steps 4 to 8 and M3's root-add sitting (its first step)*

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
- **Amended 2026-11-06** (Decision Log, "the constraints for the rest"): M4b, M4c, M6a, M6b and M7b change `src/endpoint/`, `src/services/` and `src/mawsd/endpoint-seam.ts`, and M4b and M4c move code into `apps/org-protocol/src/`. The desk track reviews every `src/endpoint` and `apps/org-protocol` hunk, in commits of their own. `apps/desk-hub/src/` stays as landed: the renew route M4c consumes is the desk track's PR. The bullets above stand as written for M1 to M5. For the rest, on this MacBook: eslint runs on one file at a time and never over more than one, and typechecks, broad lint and full suites go to the gate. The gates are the worktree's own `scripts/ci-gate.sh W --gates <list> --runner macos --label <label>` (Concrete Steps, "The rest"), not the class 1a lines above.

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
- **M5b lands** only once the desk track's `record.owners` executor and DL190 (b)'s fix are on master.
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
- **The desk track's PR, before M4c's** (the architect's ruling 2, 2026-11-06): `POST /api/provisioning-keys/<id>/renew`.
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
- `signing.json`'s `pending` gains `held: {kind: 'delegation', id} | null`, written in the same `update` that writes the slot.
- **Nothing automatic posts a held slot.** It is excluded from `settleLocked`'s repost (`signer.ts:444-464`), which the session runs at startup and at a feed's reopen (`org-session.ts:643, 812`), from deliveries and from the weekly asking. Any other signing attempt meanwhile answers `pending`, as an ordinary unsettled slot does.
- **`publishHeld(hash)`** runs under the signer's existing exclusive operation, in two steps. First, one `SigningStore.update`, whose callback stays pure and synchronous (`signing-store.ts:29-38, 92-109`), checks that the slot's stored hash is `hash` (the slot this create made) and still `held`, and durably clears `held`. Only after that update resolves does it run the normal post path, which writes exposure first, as every post does (`signer.ts:361-382`). So a gcloud operation that finishes after a Discard, or after another slot replaced it, publishes nothing, and a crash between the two steps leaves an ordinary pending slot that settles.
- **A relaunch** finds `held` with no key pair in memory. The row offers only Discard. It names the minted hub key, and Discard also revokes it, as admin's message says (`provisioning revoke`).

A failure at 4 or 5 leaves the slot held, with the reason under the delegation row. "Write the code again" retries 4 and 5 while this run holds the key pair. Once the app has quit, the key pair is gone, and the row offers only Discard (M3's), since a delegation whose private key nobody holds must not be published. The key pair and the code live only in main's memory and the child's stdin, and are dropped at publish, discard, sign-out or quit.

*The destination.* `org.provisioningSecret {project, secret, account}` is a machine setting, set once in the Delegations section. Nothing is read from devcloud's files.
- Production's is project `ytdownload-505811`, secret `desk-provisioning-v2` and account `cli-owner@ytdownload-505811.iam.gserviceaccount.com`. These are the secret B4 step 6 versions, and the account O14 names as the MacBook's gcloud identity with Secret Manager access (O14's Dependencies).
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
  12. A creates a delegation through the fake gcloud, against the real local hub's mint (so the request's mapping meets the hub's own parser). The case asserts the request's fields, and the signed `expires` within a minute of now + `ttlDays` days. A real endpoint provisions from the code the fake received, its certificate verifies, and it lists.
  13. A renews it, and the hub's key expiry follows.
  14. A drops it. The certificate's key reads revoked, and the hub key is gone.

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

**Touches.**
- Renderer: `sessions/share/AddOwnerSheet.tsx` (new), the row menus' item (M6b's menus), `copy.ts`, tests.
- Main: `src/main/org/policy.ts` gains `org.owners.add {address, member}` (M6b's act builder).
- Shared: `org.ts`, `routes.json`.

**Interfaces.** It consumes M6b's `record.owners` offer, record path and local door (§Q), and the desk track's sminos executor for `record.owners`. That executor appends the act to `ownersProof` and re-lists the session.

**Waits on.**
- The desk track's executor, behind sminos's `record` capability (M6b, *Offered only when sminos can*).
- DL190 (b)'s fix: the endpoint places a lane B record by `ownersProof[0].opId`, failing closed when one opId names two app sessions (`src/endpoint/rl10/members.ts:280-298`; tracker row `docs/tech-debt-tracker.md:556`). It must be on master first, since an owner add re-lists a lane B record.

**Proves.** Acceptance 5's add half.
- `AddOwnerSheet.test.tsx` (the members offered; the outcome shown).
- `policy.test.ts`: the act's shape, which is M6b's record target, never M5's old sample with `session` and no context.
- `test/org/policy.local.test.ts` gains: A adds B as an owner of a lane A and a lane B session on a real endpoint with a sminos stand-in that executes as the desk track's contract says, and the next listing names both.
- Live, at M6's staging run: B's name appears on the owner's row.

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
  - `migrations.ts`, a new entry: `reader_state (app_session_id, member, pinned, last_seen_uuid, last_seen_at, unread, PRIMARY KEY (app_session_id, member))` and `member_drafts (app_session_id, member, doc, attachments, updated_at, PRIMARY KEY (app_session_id, member))`, both `ON DELETE CASCADE`;
  - `sessions.ts` and `drafts.ts`, the reader argument;
  - `register.ts`: `applyPatch` and the draft commands read `context.reader`;
  - their tests.
- `src/shared/spine/` or wherever the router's command context is typed: `context.reader: 'owner' | MemberId`, absent meaning `'owner'`.
- **`src/endpoint`** (desk-track reviewed):
  - offer rows for `session.update` (reader fields only; `title` and `archived` stay the owner's), `session.drafts.get` and `session.drafts.set`;
  - the dispatch sets `context.reader`: `'owner'` when the caller is one of the machine's owners (`machineOwners`), else the caller's member id;
  - `remote-unavailable.ts` drops the three rows;
  - tests.
- Renderer: `lane-b/read-marks.ts` and the draft interception fall back only while the machine's answer is refused (an older endpoint). Tests.

**Interfaces.** It produces §P. It consumes the spine's index (O3-D), the endpoint's dispatch of machine commands (O7), and `machineOwners` (`org-protocol`).

**Decisions.**
- **Reading.** A member's reader fields are their own row's, with no row reading `pinned: false`, `unread: false`, `lastSeen: null`. An `'owner'` reader reads the session row as today.
- **Unread.** When a new turn ends, the index sets `unread` on the session row and on every `reader_state` row of the session. A member's first sight of a session is not unread. Only `markSeen` clears a member's own.
- **Grades.** `session.update` (reader fields) is graded `list`, `session.drafts.get` and `.set` `converse`, and `title` and `archived` stay `manage`. A patch mixing reader fields with others is refused `malformed` remotely.
- **What a remote reader update answers.** Never the record: `applyPatch` returns the whole `SessionRecord` (`register.ts:38-46`), which holds checkout paths, settings and `launchedBy.action` (a spawn's signed act, its brief included; `src/services/sessions/spawn.ts:51-53,75`), and a `list` caller must not read those. With a `reader` in the context, `session.update` answers `ReaderState {appSessionId, pinned, lastSeen, unread}` (a new schema beside `SessionRecordSchema`). The renderer's remote path applies that projection to the record it holds. Local `session.update` answers as today.
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

*The CLI's widening.* Once these offers are on master, the desk track makes `sminos access` and `sminos share` refuse every widening with "use MAWS", and keep narrowing (the architect's brief, 2026-11-06).
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
- The draft lives in main's memory, and a relaunch drops an unsent word with "Not sent".
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
  - messages, from lane A's to-human tool and lane B's `mcp__maws__message`;
  - questions, as they were asked;
  - answers, as they were given.

  They sit by time among M7a's entries. A question still waiting is a card in "Waiting on you" (M7a); here it is its history.
- **Offline machines.** An offline machine's entries come from the app's cache with "as of <time>", the last time its feed was live (Q5).
- **Each machine keeps its own entries.** Each machine keeps its sessions' to-human entries per project in its spine, bounded: the newest 2,000 per project and 30 days.
- **Who reads them.** Over RL2, a member reads them only for sessions they may `view` (to-human text is the session's content).
- **The owner's week** (P5 acceptance 16) starts when M7b lands (the architect, 2026-11-06).

**Touches.**
- **`src/services/channel/` (new, the spine):**
  - `journal.ts`: an index table `channel_entries (id, project, app_session_id, engine_session_id, lane, kind, text, choices, at, src, UNIQUE(src))`, in a new migration entry, pruned at the bounds above;
  - `register.ts`: `channel.history {project, before?, limit ≤ 200}` (newest first, paged) and the event `channel.changed {project, entry}`;
  - **lane B's source:** the owner channel's event batches (`src/services/owner/register.ts`'s `onEvent`), taking each accepted `mcp__maws__message` call as a `message`, and each answered ask with its question and answer as `question` and `answered`;
  - **lane A's source:** the endpoint's sub-less RL10 `host` messages (`rl10/link.ts:612-643`'s `#host`), handed in through a new `EndpointServices.channel.record(entry)` seam. Each message carries its project and its `src`, and `UNIQUE(src)` dedupes sminos's resend of the last 50;
  - the project id is sminos's project id (`smnsId`), lane B's through `src/services/index/org-project.ts`'s join;
  - tests.
- **`src/endpoint`** (desk-track reviewed): `offers.ts` rows for `channel.history`, and the feed `channel` beside `attention`. The feed's frames: `snapshot` (the newest page) and `changed`. Also the `#host` hand-off and its test.
  - **Filtering is lane-aware.** `attention.list`'s `eachSession` path places every id as a lane B `appSessionId` through the spine (`calls.ts:179-193, 451-463`; `targets.ts:260-278`), which a lane A entry doesn't have. So a new filter ranks each entry at `view`:
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
- **What counts as an entry.** For lane B, what the report view already marks as `to_human` (P4-R7: the message tool's message), plus answered asks; plain marked text is not a message, by Q5's "each to-human message". For lane A, sminos's host kinds as they arrive (`message`, `question`, `answered`).
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

**Touches.** O8's document (Outcomes, Progress) and the report. No code: M4a's `device.remove` already composes the revocation for any device but this profile's own (`edits.ts:232-246`), and M3 delivers it. A defect found on the way gets its own PR.

**Decisions.**
- **The root-add sitting is M8's first owner step.** The records show none (O8's Outcomes; P5 Decision Log 155). It is skipped when `production-run.sh admin show` already lists two root lines, one of them the app's device.
- **The order.**
  1. The root add.
  2. B4's steps 4 to 8 (O14:277-282), the last of which may run `machine drop`.
  3. The revocation.
  4. The deletion.
  5. O15's check.

  No admin verb signs after step 3. One read-only `admin show` checks the result, and moves the anchor to the revoking head, which is harmless once the files are deleted next.
- **Removing a root.** The revocation is `device.remove {member: <the admin device's member>, device: <its id>}` from the People group. The member is the owner's own, since genesis lists `/api/me`'s member with the admin device (`admin.ts:604-617`).
  - The sheet's lines name it as the deployment admin's device, by its id (`deployment-admin-<12 hex>`, or `a1` for an old file; `admin-device.ts:15-19`).
  - The checks refuse it unless the app's device is a root (`empty-roots`).
  - Removing it from the app is the intended path, since admin's own `remove-device` refuses its own device (`admin.ts:676-693`).
- **Copy.** The Org group's root lines name the deployment admin device as such until it is gone (Q6's "ending the deployment admin" as a guided step): "Deployment admin (the CLI's software root): remove it once O14's last step has run". The row offers its removal only while this Mac is a root.

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

**The shared staging run** (M6b with O18 M6). The architect schedules it with the owner and the desk track: from 2026-11-07, never 06:45 to 07:00Z (the mini), never in a cua_repl hold. The owner's steps:
1. **A real second member.** The owner adds Access's admission for a second email they control (an Access change, the owner's). Then, from the owner's staging scratch profile, the Org page adds that member (Add person), and pairs a second scratch MAWS profile as their first device (Pair a device, H1).
2. **A VM under them.** The desk track's `staging-run.sh endpoint-vm setup <base commit>` prepares a VM. The owner's Org page enrolls it (M4b's flow once M4b lands; before that, `staging-run.sh admin enroll <name>`) and sets its owners to the second member.
3. **The builds.** The desk track deploys O18 M1's hub to staging, and puts sminos 1.38.0 or later and a MAWS at or after M6b on the staging machines.
4. **The run.** O18's acceptance 1 to 8, then O8's 6:
   - the owner makes a session private, shares it Can message, then View;
   - the second member's rows and agents follow;
   - `converse` is refused;
   - the second member pins, reads and types a draft, and the owner's sidebar and draft are unchanged;
   - `sminos share … view` from the owner's terminal says "use MAWS" once the desk track's refusal is in.
5. **Teardown.** The second member is removed from the Org page; the VM goes with `endpoint-vm teardown`; the Access admission goes (the owner's).

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

The live check is the owner's, on staging first. In the Delegations section the owner names staging's secret (a scratch secret in `ytdownload-505811`, which the owner creates), creates a delegation, then checks the secret's new version by metadata alone (`gcloud secrets versions list <secret>`). A VM provisioned from it (`devcloud vm up` with the profile naming it, or the endpoint harness) lists. Then the owner renews and drops it. Production's first app-created delegation is the owner's, after M8.

**M5b.**

    npx vitest run --project renderer src/renderer/src/sessions/share/AddOwnerSheet.test.tsx
    npx vitest run --project node src/main/org/policy.test.ts
    npx vitest run --project node-timing test/org/policy.local.test.ts

Live: at the staging run, or the next sitting after it: the owner adds the second member as an owner of a lane A and a lane B session, and both rows name them.

**M8.** The owner's, at the owner's hand, each in Terminal or iTerm from a checkout of master at or after this re-plan. The architect sets the sitting.
1. **The root add, unless done.** Run `apps/desk-hub/deploy/production-run.sh admin show`.
   - If it already lists two root lines, one naming the device in the owner's MAWS's Settings › Org › You, skip to step 2.
   - Otherwise run `production-run.sh admin root add -- <that device id>`. Compare the fingerprint it asks about with the one the Org page shows, and answer `y`.
   - Check: `show` reads `head version N+1` with two root lines. The Org page reads "This Mac signs the org state." Re-sign now asks Touch ID and gives "Signed version N+2.". From then on the owner stops running `refresh` (the steps in `2026-10-28-p5-o8-report.md`, "M3's owner sitting", are the same).
2. **B4's steps 4 to 8**, as O14 writes them, after the soak (2026-11-06T22:18Z at the earliest). The desk track brings them. M8 waits until step 8's record is on master.
3. **The revocation.**
   - In Settings › Org › People, the owner's own member lists the deployment admin's device (`deployment-admin-<12 hex>`, or `a1`). Remove device… shows its lines: both keys revoked, the root removed. Sign with Touch ID.
   - Check: "Signed version M." The Org group's roots list only this Mac. Its Deliveries line empties once every machine has acknowledged (M3's deliveries).
   - What was signed is what the sheet showed, bound by its digest (M4a). The sheet's lines name both of the admin device's keys revoked and its root removed. A screenshot of the sheet is the record.
   - Check, the last `admin` command, read-only: `production-run.sh admin show` reads `head version M` with one root line (the app's device), and the owner's member no longer lists the admin device. `show` moves the admin's anchor up to version M (`anchored`, `admin.ts:366-421`), which is intended: the files go in step 4, and nothing signs with the admin device again. `show` prints no revoked device keys, so the sheet's lines and the signed state are the revocation's evidence.
4. **The deletion.** Delete the admin's key file and anchor: by default `~/.local/state/desk-hub-production/device/keys.json` and `keys.json.org.json` (`production-run.sh:28-44`; `DESK_PRODUCTION_DIR` or `DESK_PRODUCTION_DEVICE` move them). The offline recovery key is not touched.
   - Check: the files are gone (`ls` of the directory). The Org page still reads "This Mac signs the org state."
5. **O15's check**, read-only: the Org page's root lines name one device, the app's. The architect records it for O15.
6. **The acceptance run.** Items 1 to 7 on production (and staging where the item says so), each recorded in Outcomes with its evidence: a screenshot, a version, or a transcript line.

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
- **The rest (executable, 2026-11-06):** §N (M7a), §O (M7b), §P (M6a), §Q (M6b, with M5b's `record.owners`), §R (M4b) and §S (M4c). No `WIRE_MINOR` moves: the new endpoint offers and feeds are additive rows (OX1), and the index takes a new migration entry. M7a adds the `channel` tab kind with no layout version.

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

    // src/services/index/migrations.ts (a new entry)
    reader_state  (app_session_id, member, pinned, last_seen_uuid, last_seen_at, unread, PRIMARY KEY (app_session_id, member))
    member_drafts (app_session_id, member, doc, attachments, updated_at, PRIMARY KEY (app_session_id, member))
    // the router's command context gains reader?: 'owner' | MemberId   (absent: 'owner')
    // with a reader, session.update answers ReaderState {appSessionId, pinned, lastSeen, unread}, never the record
    // src/endpoint/offers.ts: 'session.update' (reader fields only, list), 'session.drafts.get' and '.set' (converse)

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
    // OrgChange gains delegation.add {…the delegation} | delegation.renew {id, expires} | delegation.drop {id}
    // org.delegation.create {label, prefix, ttlDays, maxUses: number | null, owners} -> SignResult & {secret?: {version, createTime}}
    // org.delegation.rewrite {id}; org.delegation.renewHub {id}; org.delegation.revokeHub {id}
    // OrgView gains delegations: {id, prefix, owners, expires, maxUses, machines: {ref, name, live}[], hub: {expires, uses} | null, held: 'unsent' | null}[]
    // machine settings: org.provisioningSecret {project, secret, account} | null
    // Edit gains hold?: true; signing.json's pending gains held: {kind: 'delegation', id} | null (never reposted by settle, deliveries or weekly)
    // OrgSigner gains publishHeld(hash): Promise<SignOutcome>   (under the signer's exclusive operation: one pure update clears `held` for the slot whose stored hash is `hash`; then the normal post path)
    // the desk track's route (branch p5-hub-key-renew; the architect lands it): POST /api/provisioning-keys/<id>/renew, admin-only, no body
    //   200: the key exactly as GET /api/provisioning-keys lists it, delegation included; `expires` is the head delegation's string verbatim
    //   403 not-admin | 404 unknown-key | 410 key-revoked | 410 key-expired (an elapsed key is never revived)
    //   409 not-renewed: the head has no delegation with that id, or its expires isn't later than the hub's (submit the state first; the half-done case, retried with the route alone)
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
  - The destination (`project`, `secret`, `account`) is a machine setting. Production's is `ytdownload-505811` / `desk-provisioning-v2` / `cli-owner@ytdownload-505811.iam.gserviceaccount.com`, O14's.
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
  Date/Author: 2026-11-06, the desk track through the architect, recorded by O8's executor.

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
