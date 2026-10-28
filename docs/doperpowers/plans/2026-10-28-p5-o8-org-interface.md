# P5 O8 — The org interface (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O8**, §"O8: The org interface". Parent pin: blob `e74a3c5d58e682790627cf0fc54abe23e161930e` at master `1bf619c83` (P5's Decision Logs 1–116; first drafted at `5b46682f1`, re-pinned for Decision Logs 95 to 97, and again on 2026-10-28 for M3's and M5's re-plan: Decision Log 101 refuses O3's D2, so lane B's owner changes route to sminos's member record; 105 and 113 land M1 and M2; 111 answers Q1 to Q7; 116 passes M1's staging sitting and finds the double sign-in, fixed in its own PR; the others, 114 and 115 among them, change nothing here).
>
> **What binds.** O8's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5 §7 (people: owners, visibility, machine owners and grants, agents talk as today, credentials) and §8 (the sidebar's per-project toggle, the project channel, the Org page, attention across machines); parent acceptance 3 (its remote rows: Decision Log 93), 11 and 12.
> - The remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (blob `437a03eb`), cited *RL §n*: RL5 (the signed org state), RL6 (the session record, its listing and its withdrawal), §5.2 (writers, the backstop, the software root and its end), §5.3 (a device's pairing), §5.6 (step-up), §5.7 (the log plane), §5.9 (what the hub can't do), §6 (owners, visibility, grants).
> - P5's contracts OX2, OX3, OX8 and OX9, and Decision Logs 26 and 30 (the admin's signing checks), 31 (a delegation's prefix and id used once), 34 (a member's new device), 36 (reader state and drafts per member), 38 (Access's login transfer; the Registry socket's `?app=1`), 50 (an owner add is `record.owners {add: true, member}`), 59 (`gone` listings), 69 (the deployment admin and its end), 71 (the device key's backup mark), 75 and 80 (words v2-only; migrated history by O14's Interfaces §D), 92 (this document's first milestone; the project channel is the app's one reader of the log plane) and 93 (O9's requests of the rows; acceptance 3 closes with this first milestone).
>
> **Built on.** O7's document `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (blob `6f67459b`, PR #276), whose M1 is being built in parallel: its Interfaces §B (`OrgSession`, `SignedIn`, `HubAccess`, `signedOut()`), which M1 here implements for production, and §A (`Machines.remote`, `Machines.onRemote`), whose roster M2 reads. O9's document `…-p5-o9-lane-a.md` (blob `5aaaae49`, PR #277; its M1 landed, P5 Decision Log 97): its Interfaces §G, R1 to R6, which M2's rows answer. O6, landed (`…-p5-o6-machine-dimension.md`, blob `f5a91406`): addresses, OX3's org keys and `smnsId`, the sidebar's settled forms T1 to T5. O10 M1–M9, landed (`…-p5-o10-endpoint.md`, blob `315bc8cf`): `src/main/device/` (keys, step-up, the backup mark), the endpoint's listings (`src/endpoint/listings.ts`) and `endpoint.listings`. O11, landed (`…-p5-o11-hub-v2.md`, blob `4c4ac1ff`): the Registry's chain, pairing exchange, listings and app socket. O13, landed (`…-p5-o13-web-cards.md`, blob `04e88ca6`): `deployment admin` (`apps/desk-hub/deploy/admin.ts`), production's root until O8, and the pairing code, MAC and fingerprint in `org-protocol`. O14's Interfaces §D (`…-p5-o14-cutover.md`, blob `511deaba`) for M7.
>
> **What this file holds.** The execution only. P5 Decision Log 92's first milestone is specified to be built now, as two milestones: **M1, the app's org session** (sign-in, the device's registration, the held org state) and **M2, the remote rows**. **M3, the app as the org's signer**, and **M5, owners on rows and the People toggle**, were re-planned to that depth on 2026-10-28 on the owner's answers (P5 Decision Log 111), with "Add owner" split out as M5b. M4 and M6–M8 are **advisory**: what each needs, adds and proves, not how. Much of them turns on the owner's taste, asked under "Open questions for the owner"; M1 and M2 pre-empt none of those answers. Residue decisions are made where they bind, each with the alternative that lost, and listed in the Decision Log for P5's writer.

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
- [x] M2 — The remote rows — landed (PR #295, master cfa0f0e7b, P5 Decision Log 113); the live check at the first cut-over machine owed
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
- [ ] M4 — The Org page — *advisory; Q1 answered; needs M3 and O11's H1*
- [ ] M5 — Owners on rows and the People toggle — **executable** (re-planned 2026-10-28; needs M2, landed)
  - [x] (2026-10-28) Built on `p5-o8-m5` at b78445447, one task: `memberName`, `OrgRows.members` and `member`, the `sidebar.people` key and `stores/people.ts`, `ownersLabel` and `RowTitle`, `projectList`'s ownership-first filing, the People hover action and menu item, owners in the hover cards. The focused suites pass locally, each file alone.
  - [ ] Class 1a on the merge with master, reviewer-medium, and the final gate (the full hosted set).
- [ ] M5b — Add owner — *later; needs O10's `record.owners` offer row and O12's sminos executor*
- [ ] M6 — Visibility, shares and per-member reader state — *advisory; taste (Q4); needs O3*
- [ ] M7 — The project channel — *advisory; taste (Q5); needs O7 M2 and M6, O3, O12's to-human store; its people's words wait for O14's last machine*
- [ ] M8 — The deployment admin's end, and acceptance — *advisory; needs O14's B4*

## Acceptance

Items 1 and 2 are the first milestone, landed. Items 3 and 5 are executable (re-planned 2026-10-28). Items 4 and 6 to 8 restate P5's O8 acceptance and are advisory until their milestones are re-planned.

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
4. **The Org page (M4).** Members and their devices, machines with enrollment codes, per-machine rights, delegations and the recovery key's id, each change shown before it is signed. A re-enrolled machine's grants are re-signed, each shown first. An admin enrolls a member's first device directly (P5 Decision Log 34).
5. **Owners are visible and carried (M5; P5 acceptance 11).** Every row of a session you don't own alone shows its owners, as first names after the title, and its hover card lists them all (Q2). A per-project People toggle, off by default and remembered per project, adds other people's sessions, each with its owners and machine; while it is off the project row says "+N others" when there are any (Q3). Owners add owners (`record.owners {add: true, member}`, P5 Decision Log 50) in M5b, once O10 and O12 build its row and executor.
6. **The people model (M6; P5 acceptance 12).** A second member, added by an org-state edit on staging, sees listings per each session's visibility and their own sessions in full. With sessions at the default `listed`, `converse` and `approve` are refused on sessions not shared with them. Reader state (unread, last seen, pinned) and drafts are kept per member, so nothing the second person reads, pins or types changes what the owner sees (P5 Decision Log 36).
7. **The project channel (M7).** A project's to-human messages and cards across machines, agent-to-agent traffic folded, people's own messages, and migrated events drawn "attested at migration by `<machine>`" by O14's Interfaces §D. The app sends the owner's words v2-only (P5 Decision Log 75).
8. **The deployment admin's end (M8).** After O14's last verb on it, the app signs the successor that revokes the deployment admin device, its key file is deleted, and no device but the app's is a root (P5 Decision Log 69; O15 checks it). Items 1 to 7 run as the acceptance, with evidence in Outcomes.

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

M1 runs now and lands by its own PR. M2 needs M1 and O7 M1 on master, and lands by its own PR. M3 needs M1 and O7 M1 (both landed) and lands by its own PR, reviewed at reviewer-high, since it signs the org state; its owner's sitting follows M1's. M4 needs M3 and O11's H1. M5 needs M2 (landed) and lands by its own PR after M3's, reviewed at reviewer-medium; M5b needs O10's offer row and O12's executor (Interfaces §I). M6 needs M5 and O3. M7 needs O7 M2 and M6 and O3, and its people's words wait for O14's last machine. M8 needs O14's B4 and every milestone before it. Each advisory milestone is re-planned, with its own buildability round, when its dependencies land and the owner has answered its questions.

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

### M4 — The Org page *(advisory; taste: Q1, answered)*

**What it adds.** Settings › Org grows into the Org page in Q1's four groups (You, People, Machines, Org), each change through a sheet that shows exactly what will be signed and asks Touch ID, through M3's signer and checks; desk-web's `apps/desk-web/src/views/{org,key,machines}` are the reference:
- **People and devices.** Pair a device from the app, which shows the code, judges entries as `judgeEntry` does, compares the fingerprint and approves; remove a device; add or remove a member; change a role or an email. On production a member's Access admission is an Access change, so it is the owner's.
- **Machines.** Enrollment codes for `mawsd enroll`: `k` by hand, the machine's MAC checked through `GET /api/enrollments/<id>/key`, and the machine signed in with its owners. Re-enrollment re-signs each grant, shown first.
- **Rights.** Per-machine grants (`spawn`, `machine-admin`, `shell`).
- **Delegations.** Created, renewed and dropped under M3's checks.
- **The recovery key's id**, and a root transition's flow should one ever be needed; becoming a root and ending the deployment admin as guided flows (Q6).
- **The org state's age and the machines owing a revocation** (M3's deliveries).

It settles P5 Decision Log 34: an admin enrolls a member's first device directly. The member's new device posts its entry as itself, and the admin reads it through H1. A member adding a later device of their own with an admin's countersignature (RL §5.2) waits until a second member needs it. Rejected: building the countersign flow now, for an org of one.

**H1, the shape the desk track builds** (O11's hub; Interfaces §I). `GET /api/devices/pending?member=<member id>`:
- no `member`, or the caller's own id: as today, the caller's entries;
- another member's id: the Registry checks the caller with `current(you, 'admin')` (`403 not-admin` otherwise) and answers that member's entries, `404 no-member` for an id the current head doesn't list;
- the answer is today's `PendingDevices`, `{pending: PendingDevice[]}`, each entry as stored (`member`, `created`, `expires` and the posted fields with its `mac`), the MAC unchecked: the admin's app judges it under the `k` of the code it showed, as `judgeEntry` does;
- posting stays the member's own; nothing else changes.

**Needs.** M3; O11's H1 above.

**Proves.** Acceptance 4.

*H1 landed (2026-10-28, PR #306, master 409920137, P5 Decision Log 121).* `GET /api/devices/pending?member=<id>`. Its answers:
- `403 not-admin` for anyone but an admin. The admin check comes first, so a 403 never says whether the id is a member.
- `404 no-member` for an id the head doesn't list, a removed member's lingering entries included.
- `503 hub-updating` from a Registry before H1. M4 reads it as "try again".
- Otherwise `{pending}`, stored as is with the MAC unchecked; the approving device checks the MAC.
- No id, or the caller's own id, is today's read.
M4 adds `?member=` to `hub-client.ts`'s own `PENDING_DEVICES_PATH` copy.

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

### M5b — Add owner *(later; waits on O10 and O12)*

**What it adds.** "Add owner…" on a listed row you own, the one item of its menu, and on a record's row at a listed address: a sheet listing the head's members who aren't owners, then `record.owners {add: true, member}` sent as a `manage` act with step-up over the row's machine's link (`machines.remote(ref).act({action: 'record.owners', session, args: {add: true, member}, stepUp: 'required'})`; P5 Decision Log 50). Its proof is the act, which the hosting machine keeps in `ownersProof` (RL §6.1), and the session's next listing names the new owner, which M5's label then shows.

**Waits on.**
- O10: an offer-table row for `record.owners` in `src/endpoint/offers.ts`, `manage`-graded, with step-up (the endpoint already requires step-up for `record.*`), executed by sminos for both lanes. P5 Decision Log 101 refused O3's D2, so lane B's record changes route to sminos's member record as lane A's do (Decision Log 45).
- O12: sminos's executor for `record.owners` under its opId ledger, keeping the act in `ownersProof` and re-listing the session.
- Owners on local sessions wait for O3-D's records.

**Proves.** Acceptance 5's add half.

### M6 — Visibility, shares and per-member reader state *(advisory; taste: Q4; needs O3)*

**What it adds.**
- Each session's access level and shares, set by its owners with step-up (RL §6.2). Where `private` is chosen, the warning that its agent's say messages stay org-readable.
- `endpoint.listings` over each link merged into M2's rows, so a `private` session reaches its owners and shares.
- Reader state (unread, last seen, pinned) and drafts kept per member, keyed by session and member in the machine's index (P5 Decision Log 36), for a remote member and for the local app as the machine owner's member.

**Needs.** M5; Q4. O3: the index in `mawsd` with per-member keys (O7's C5). sminos's records carrying `access` and `shares`, and its executors for their changes (O12). The offer-table rows for access and share changes (O10). A second member on staging (O11's staging, the owner's Access change).

**Proves.** Acceptance 6.

### M7 — The project channel *(advisory; taste: Q5)*

**What it adds.**
- **The channel view per project** (P5 §8). It shows to-human messages and asks from every machine, the same pending cards attention shows and answerable in either place (owner, Decision Log 11), agent-to-agent traffic folded to one row, and people's own messages.
- **The app's one reader of the log plane** (P5 Decision Log 92). It holds the Project socket per project (`/api/projects/<id>/socket`), verifies each event by RL8 against the held org state, draws RL9's owner labels, and draws migrated events "attested at migration by `<machine>`" by O14's Interfaces §D (`verifyHistoryAttestation(record, events, head, certificates, at, now?)`).
- **People's words,** sent v2-only, wait for O14's last machine (P5 Decision Log 75).
- **Scheduling note.** O14's B4 waits on one reader drawing a migrated event (P5 Decision Log 75 (5)). The reader half (the sockets, verification, the attestation label in a plain list) can land before Q5 is answered, so the owner's answer never holds B4 (finding F4).

**Needs.** O7 M2 (lane B's cards over the link) and O7 M6 or O3's attention feed (cards across machines). O12 item 6's machine-local to-human store served over RL3, and lane B's owner channel in `mawsd` (O3), with the RL2 view the channel subscribes to (Interfaces §I). O14's Interfaces §D. Q5.

**Proves.** Acceptance 7.

### M8 — The deployment admin's end, and acceptance *(advisory)*

**What it adds.** Once O14's final brief (B4) has run its last `deployment admin` verb, the app signs the successor that drops the deployment admin device and moves both its keys into `revoked`, its step-up key out of `root.keys`. The owner deletes its key file and anchor. P5's O15 then checks that no deployment admin device is a root. The acceptance run of items 1 to 7 follows, on production and staging, with evidence in Outcomes.

**Needs.** O14's B4; M3 to M7.

**Proves.** Acceptance 8.

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
- **Later (advisory):** the Org page (M4); owner changes as acts through O10's row and O12's executor (M5b, M6); the project channel's sockets (M7).

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

  A row whose access isn't the default shows a small lock or people mark. *Alternatives:* visibility only in the session's info panel; a default per project. **[owner, 2026-10-28: as recommended; P5 Decision Log 111.]**
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
  11. A toggle made before the stored set is read is applied over it when the read lands, and nothing is written before. Rejected: `summary.ts`'s "toggle wins", which would replace the whole stored set with one early toggle.
  Debt, not built: `sidebar.people` keys are neither moved when an address key becomes an org key (`layout-model.ts`'s `rekeySets` does so for `expandedProjects`) nor pruned; the toggle reads off until set again. Others' records still reach Needs you and "Mark all read"; attention across machines is O7 M6's and O3's.
  Date/Author: 2026-10-28, O8's executor.

## Outcomes & Retrospective

**M1 (2026-10-28, PR from `p5-o8-m1`; the live staging sitting pending at the owner's hand).** The app signs in to the org from a pairing code, registers its device, holds the org's chain from genesis behind an anchor, follows the hub over the `?app=1` feed, and hands O7's links a production session. A never-signed-in profile makes no keys, files or requests. Evidence: the unit suites (`access-login` 32, `held` 22, `registry-feed` 29, `hub-client` 3, `org-session` 56, `OrgSection` 13) and `test/org/sign-in.local.test.ts` (7, on desk-hub's Worker in Miniflare with O13's real `pair` approving, the app's fingerprint equal to `pair`'s, and O7's link up over the hub on the production session), class 1a and the hosted Electron groups (the PR body has the runs). Still owed: the staging sitting (the fingerprint match on a real Access login, `/api/me` through `cf-access-token` from the app, a relaunch with no browser), recorded here when it runs.

**M2 (2026-10-28, PR from `p5-o8-m2`; the live check at the first cut-over machine pending).** Main keeps every hub-served session listing that verifies against the held head, judged per key against a persisted mark that a withdrawal keeps and only a signed head ends, cached in `listings.json` and verified again at load and at each head; `org.rows` gives the renderer the RL2 roster's rows, `complete` and `pending`; the sidebar draws the member's own listed sessions under their org projects, and a covered machine is loaded and settled only once its rows are known. Evidence: `rows.test.ts` 22, `test/org/rows.local.test.ts` 4 (desk-hub's Worker in Miniflare, a real endpoint's lane A and lane B listings), the renderer suites (events 42, derive 38, Sidebar 91, org-projects 6, remote-openers 2), and the final gate (run 40691164424). Still owed: the live check at the first cut-over machine.

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

Retrospective (M3). Built as eight tasks under subagent-driven execution, each reviewed at its frontier, then reviewer-high on the whole branch.
- What the reviews found: ten task reviews found real defects in five of the eight tasks, and the whole-branch review found five more across tasks.
- The defects shared one shape: a fact checked before an await and acted on after it. That covers a run planned on a held line that moved, a registration snapshot that overwrote a sign-out, a queued attempt that missed an intent recorded meanwhile, a confirmation that outlived its proposal, and a post that captured a sibling as its parent.
- Every task-scoped review that read each module alone missed the cross-module form. The whole-branch review caught it, and its race reproductions held the named await open.

A future child that composes async modules over shared state should list each act's preconditions and re-check them synchronously at the act, with a test that holds each await open. It should also bind any person's consent (a sheet, a confirmation) to the identity of what was shown.

Retrospective (M2). The mark rule and the coverage rule, which the planning rounds had sharpened, were exactly where the build's two real defects lay: an unverified certificate read beside a verified record, and a set emptied across an await while another reader treated it as coverage. Both are the same shape: a trust or coverage fact derived from something that was not itself the verified or settled thing. A future child deriving state from verified records should take every derived fact from the verified object itself, and keep in-flight work visible in whatever a reader treats as coverage.

Retrospective. The document held: every decision it made stood, and the gaps it left were small (a `directory` refusal, a feed close hook, the chain re-read from below the head for a recovery). What it didn't foresee was the session's write concurrency: four parallel actors (attempts, adoptions from two sources, sign-out, recovery) each writing `registration.json`. Ad hoc fences left three windows, which the review found; one serialized commit queue closed them. A future child holding a trust anchor beside a credential should start from that queue. The test-writing workers found three real bugs each time they were given a module they hadn't written, which paid for the split.
