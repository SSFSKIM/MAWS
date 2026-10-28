# P5 O8 — The org interface (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O8**, §"O8: The org interface". Parent pin: blob `0e2ac907cc753fbf0dfcf7f7b18045e508db25e4` at master `032ce466b` (P5's Decision Logs 1–97; first drafted at `5b46682f1`, re-pinned for Decision Logs 95 to 97, none of which changes O8).
>
> **What binds.** O8's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5 §7 (people: owners, visibility, machine owners and grants, agents talk as today, credentials) and §8 (the sidebar's per-project toggle, the project channel, the Org page, attention across machines); parent acceptance 3 (its remote rows: Decision Log 93), 11 and 12.
> - The remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (blob `437a03eb`), cited *RL §n*: RL5 (the signed org state), RL6 (the session record, its listing and its withdrawal), §5.2 (writers, the backstop, the software root and its end), §5.3 (a device's pairing), §5.6 (step-up), §5.7 (the log plane), §5.9 (what the hub can't do), §6 (owners, visibility, grants).
> - P5's contracts OX2, OX3, OX8 and OX9, and Decision Logs 26 and 30 (the admin's signing checks), 31 (a delegation's prefix and id used once), 34 (a member's new device), 36 (reader state and drafts per member), 38 (Access's login transfer; the Registry socket's `?app=1`), 50 (an owner add is `record.owners {add: true, member}`), 59 (`gone` listings), 69 (the deployment admin and its end), 71 (the device key's backup mark), 75 and 80 (words v2-only; migrated history by O14's Interfaces §D), 92 (this document's first milestone; the project channel is the app's one reader of the log plane) and 93 (O9's requests of the rows; acceptance 3 closes with this first milestone).
>
> **Built on.** O7's document `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (blob `6f67459b`, PR #276), whose M1 is being built in parallel: its Interfaces §B (`OrgSession`, `SignedIn`, `HubAccess`, `signedOut()`), which M1 here implements for production, and §A (`Machines.remote`, `Machines.onRemote`), whose roster M2 reads. O9's document `…-p5-o9-lane-a.md` (blob `5aaaae49`, PR #277; its M1 landed, P5 Decision Log 97): its Interfaces §G, R1 to R6, which M2's rows answer. O6, landed (`…-p5-o6-machine-dimension.md`, blob `f5a91406`): addresses, OX3's org keys and `smnsId`, the sidebar's settled forms T1 to T5. O10 M1–M9, landed (`…-p5-o10-endpoint.md`, blob `315bc8cf`): `src/main/device/` (keys, step-up, the backup mark), the endpoint's listings (`src/endpoint/listings.ts`) and `endpoint.listings`. O11, landed (`…-p5-o11-hub-v2.md`, blob `4c4ac1ff`): the Registry's chain, pairing exchange, listings and app socket. O13, landed (`…-p5-o13-web-cards.md`, blob `04e88ca6`): `deployment admin` (`apps/desk-hub/deploy/admin.ts`), production's root until O8, and the pairing code, MAC and fingerprint in `org-protocol`. O14's Interfaces §D (`…-p5-o14-cutover.md`, blob `511deaba`) for M7.
>
> **What this file holds.** The execution only. P5 Decision Log 92's first milestone is specified to be built now, as two milestones: **M1, the app's org session** (sign-in, the device's registration, the held org state) and **M2, the remote rows**. M3–M8 are **advisory**: what each needs, adds and proves, not how. Much of them turns on the owner's taste, asked under "Open questions for the owner"; M1 and M2 pre-empt none of those answers. Residue decisions are made where they bind, each with the alternative that lost, and listed in the Decision Log for P5's writer.

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
  - [ ] The owner's staging sitting.
- [ ] M2 — The remote rows — **executable** once M1 and O7 M1 are on master
  - [x] (2026-10-28) Built on `p5-o8-m2`, branched from `p5-o8-m1` (the architect lands them in order): `rows.ts`, `org.rows`, main's wiring, the renderer's listed partition and rows; the unit suites and `test/org/rows.local.test.ts` pass locally.
  - [x] (2026-10-28) reviewer-high converged: round 1 at 11846ed8a (2 P1, 1 P3, all fixed at f8764a1ca, cf1e4451e and 529ae1522), round 2 on the fixes found nothing.
  - [ ] The final gate on the PR's tree, and the live check at the first cut-over machine.
- [ ] M3 — The app as the org's signer: a co-root, the weekly successor, the signing checks — *advisory*
- [ ] M4 — The Org page — *advisory; taste (Q1)*
- [ ] M5 — Owners on rows and the per-project toggle — *advisory; taste (Q2, Q3)*
- [ ] M6 — Visibility, shares and per-member reader state — *advisory; taste (Q4); needs O3*
- [ ] M7 — The project channel — *advisory; taste (Q5); needs O7 M2 and M6, O3, O12's to-human store; its people's words wait for O14's last machine*
- [ ] M8 — The deployment admin's end, and acceptance — *advisory; needs O14's B4*

## Acceptance

Items 1 and 2 are the first milestone and executable now. Items 3 to 8 restate P5's O8 acceptance and are advisory until their milestones are re-planned.

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
3. **The app as the org's signer (M3).** The app's device, its key file carrying `excludedFromBackupAtCreation` (else registered again with new keys first), is a root beside the deployment admin. It signs the weekly no-change successor, so the deployment admin's `refresh` stops. Before signing anything it refuses a state that makes a revoked key current again, offers the superseded states' revocations after a root transition, warns before dropping a delegation, refuses a delegation prefix that equals, nests in or covers another or a name, and one whose prefix or id was used before (revoked ones included), and renews a delegation only while it is live (P5 Decision Logs 26, 30 and 31). Each removal it signs is also delivered to every machine and acknowledged (RL §5.2).
4. **The Org page (M4).** Members and their devices, machines with enrollment codes, per-machine rights, delegations and the recovery key's id, each change shown before it is signed. A re-enrolled machine's grants are re-signed, each shown first. An admin enrolls a member's first device directly (P5 Decision Log 34).
5. **Owners are visible and carried (M5; P5 acceptance 11).** Rows show their owners in the form Q2 settles, owners can add owners (`record.owners {add: true, member}`, P5 Decision Log 50), and the per-project toggle adds other people's sessions, each with its owner and machine.
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
- **The protocol, the hub and the endpoint are as landed.** M1 and M2 change nothing under `apps/org-protocol/src/`, `apps/desk-hub/src/`, `apps/desk-hub/deploy/`, `src/endpoint/` or `apps/desk-web/`. A need there is a contract request to P5's writer (Interfaces §I).
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

M1 runs now and lands by its own PR. M2 needs M1 and O7 M1 on master, and lands by its own PR. M3 needs M1 (and O7 M1 to deliver revocations). M4 needs M3. M5 needs M2, and for owner changes O7 M1 and the executors' rows (Interfaces §I). M6 needs M5 and O3. M7 needs O7 M2 and M6 and O3, and its people's words wait for O14's last machine. M8 needs O14's B4 and every milestone before it. Each advisory milestone is re-planned, with its own buildability round, when its dependencies land and the owner has answered its questions.

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

### M3 — The app as the org's signer: a co-root, the weekly successor, the signing checks *(advisory)*

**What it adds.**
- **A signer in main.** It builds successors from typed edits, renders each change, and signs the org state with the device's step-up key behind the same confirmation step-up uses; `src/main/device/step-up.ts`, which signs RL4 actions alone today, gains that path. The root keys are admin devices' step-up keys, so every successor the app signs takes the person's Touch ID (RL §5.2, "signing takes the person"). It keeps O13's rule of no two successors of one parent: a pending slot written before the post and settled before anything else is signed, and `not-head` signed again on the new head.
- **The checks before signing** (P5's O8 acceptance; Decision Logs 26, 30 and 31). The package's `verifySuccessor` already refuses a revoked key made current; the app checks first and says why. After a root transition it offers the superseded states' revocations, which M1 keeps. It warns before dropping a delegation. It refuses a delegation prefix that equals, nests in or covers another or a machine's name, and a prefix or id used before. It renews a delegation only while it is live.
- **Direct revocation delivery.** Each removal it signs is sent to every machine as an RL4 act over O7's links (`endpoint.state`, the new state), and each acknowledgement is kept. The Org page (M4) lists the machines still owing one (RL §5.2).
- **A co-root.** The owner's terminal (`deployment admin`, a successor adding the app device's step-up key id to `root.keys`) makes the app's device a root beside the deployment admin. Before that, a device whose key file lacks `excludedFromBackupAtCreation` registers again with new keys: its old keys are moved aside and destroyed, new ones made, the new device paired, and the old one removed (P5 Decision Log 71).
- **The weekly no-change successor** is the app's from then on, and the deployment admin's `refresh` stops. How it asks is Q6.
- **The deployment admin stays a root until O14's last verb on it** (M8; finding F1). Two signers share one chain: a deployment admin verb that races the app's weekly successor gets `not-head`, and its next run refuses `fork` until the owner runs `abandon-pending`. That is rare, visible and recoverable, and recorded as residue.

**Needs.** M1; O7 M1 (the links that carry revocations); the owner's hand twice (the co-root successor, and on production its rollout); Q6.

**Proves.** Acceptance 3.

### M4 — The Org page *(advisory; taste: Q1)*

**What it adds.** Settings › Org grows into the Org page P5 §8 names, with desk-web's `apps/desk-web/src/views/{org,key,machines}` as reference:
- **People and devices.** Pair a device from the app, which shows the code, judges entries as `judgeEntry` does, compares the fingerprint and approves; remove a device; add or remove a member; change a role or an email. On production a member's Access admission is an Access change, so it is the owner's.
- **Machines.** Enrollment codes for `mawsd enroll`: `k` by hand, the machine's MAC checked through `GET /api/enrollments/<id>/key`, and the machine signed in with its owners. Re-enrollment re-signs each grant, shown first.
- **Rights.** Per-machine grants (`spawn`, `machine-admin`, `shell`).
- **Delegations.** Created, renewed and dropped under M3's checks.
- **The recovery key's id**, and a root transition's flow should one ever be needed.
- **The org state's age and the machines owing a revocation.**

It settles P5 Decision Log 34: an admin enrolls a member's first device directly. The member's new device posts its entry as itself, and the admin reads it through a hub route that lists a member's pending entries to an admin, asked of O11 (Interfaces §I). A member adding a later device of their own with an admin's countersignature (RL §5.2) waits until a second member needs it. Rejected: building the countersign flow now, for an org of one.

**Needs.** M3; Q1; O11's admin read of pending entries.

**Proves.** Acceptance 4.

### M5 — Owners on rows and the per-project toggle *(advisory; taste: Q2, Q3)*

**What it adds.**
- **Owners on rows,** from M2's rows (`owners`) and records (once their sessions' records carry owners), named from the org state, in the form Q2 settles.
- **The per-project toggle** (P5 §8; O6's T6), which draws the rows M2 already holds with `mine: false`, in the form Q3 settles.
- **"Add owner"**: `record.owners {add: true, member}`, a `manage` act with step-up over O7's link (P5 Decision Log 50). Its proof is the act, which the hosting machine keeps in `ownersProof` (RL §6.1).

**Needs.** M2; Q2 and Q3. For owner changes: O7 M1, and offer-table rows for `record.owners` executed under a ledger by sminos (lane A) and by the lane B record's owner in `mawsd` (P5 Decision Log 45; Interfaces §I, to O10, O12 and O3).

**Proves.** Acceptance 5's app half. RL9's label on a `sminos say` is O12's; M7 draws it.

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

**§I. Contract requests** (for P5's writer to carry; each says what O8 needs, not how).

*To O3* (the services host and the spine):
- **D1. Per-member reader state and drafts** (P5 Decision Log 36). The index in `mawsd` keys unread, last seen, pinned and drafts by session and member, reachable over RL2 by a remote member and locally as the machine owner's member (M6). The same index answers a member's `session.get` and `session.list` by rank, O7's C5, which gives a remote session's pane its record (M2's yield rule).
- **D2. Lane B's record changes.** The lane B session record in `mawsd` (O2's records) accepts `record.owners`, access and share changes as acts under a ledger, keeps their proofs in `ownersProof`, and re-lists the session (M5, M6).
- **D3. Lane B's to-human messages over RL3.** The owner channel's messages and asks of lane B sessions, served per machine on a subscription the project channel opens (M7), as O12 item 6 does for lane A.
- **D4. The project of a session** stays sminos's project id in every record and listing, so the join in M2 stays one rule.

*To O10* (the endpoint): offer-table rows for `record.owners`, access and share changes, `manage`-graded with step-up for another's removal (RL §6.1), routed to sminos for lane A and to D2's executor for lane B (M5, M6; P5 Decision Log 45). `endpoint.state` stays the act that delivers a revocation directly (M3).

*To O11* (the hub):
- **H1.** An admin's read of a member's pending device entries (`GET /api/devices/pending?member=<id>` for an admin), so an admin can enroll a member's first device (P5 Decision Log 34; M4).
- **H2.** An app frame on the `?app=1` socket when a machine certificate or its retirement is stored, so the app needn't poll for a new devcloud VM (M1's `CERTS_REFRESH_MS` until then).
- **H3.** A way for a member's app to read the state that removed the member: the hub sends it (or its version and the chain since the app's head) before closing `4403`, or answers `GET /api/org/state` for that version to a member it has just dropped. Until then the app reads `denied` and learns the removal from an endpoint (M1).

*To O12* (sminos): `access` and `shares` in `member` frames, and the executors for `record.owners`, access and share RPCs under the opId ledger (M5, M6); the RL2 view of the machine-local to-human store of item 6, for the project channel (M7).

*To O7*: M2's `registerRemoteOpener('B', …)` and the yield rule (a record at a listed address replaces the row), which O7 M2's re-plan adopts; and the snapshot rule for RL2 machines, which O7 M2 replaces for lane B. A contract question for O7 M2's re-plan (finding F8): its pane for a remote lane B session draws from the `ListedSession` and its subscription, or waits for O3's per-member read (C5) to supply a record.

*To O9*: M2's rows meet R1, R2, R4, R5 and R6 as asked. R3 is met as far as a listing can say: a lane A row reads `availability: 'foreign_held'`, carries no holder kind or pid (RL6 has none: finding F6), and offers no action. O9 M9 registers `registerRemoteOpener('A', …)`. A contract question for O9 M9 (finding F8): a remote lane A session is a `ListedSession`, and no source produces a `SessionRecord` for it before O3 (its plane's `presence` is not one), so `controlsFor(record, …)` and the pane need either a remote variant that takes the `ListedSession` with the watch's `LaneAState`, or O3's per-member read.

**§J. Contract additions.**
- **Now (M1):** `OrgSessionService` and `createOrgSession` (§A), which implement O7 §B; `org.status`, `org.register`, `org.signIn`, `org.reanchor`, `org.cancel`, `org.signOut` and `org.changed` (§B); `<userData>/org/` (§C); `HeldOrg` (§D); the login and `MAWS_DEV_STANDIN_USER` (§E); the Registry feed (§F); `tweetnacl` 1.0.3. No `WIRE_MINOR`, no settings version, no e2e group.
- **Now (M2):** `RemoteRow`, `OrgRows`, `org.rows` and `org.rows.changed`; the listed partition, `rowOfListed` and `registerRemoteOpener` (§G); `listings.json`.
- **Later (advisory):** the signer and its pending slot (M3); the Org page (M4); owner changes as acts, and offer-table rows through O10 (M5, M6); the project channel's sockets (M7).

## Open questions for the owner

Each is built as its recommendation when its milestone is re-planned, unless the owner answers otherwise. M1 and M2 build only Q7's recommendation, and pre-empt the rest.

- **Q1. The Org page** (M4). *Recommendation:* one Settings section, Org, grown from M1's, in four groups:
  - **You**: this Mac, your other devices, and the hub sign-in with its renewal;
  - **People**: members with role and devices, and Add person;
  - **Machines**: name, owners, online, rights, and "Enroll a machine" giving a code;
  - **Org**: the state's version and age, the roots, the recovery key's id, and revocations still owed.

  Each change opens a sheet that shows exactly what will be signed and asks Touch ID. *Alternatives:* a dedicated Org tab outside Settings, with more room for a page opened rarely; or machines managed from the sidebar's machine rows, closer to where machines appear but splitting administration across two places.
- **Q2. Owners on rows** (M5). *Recommendation:* show owners only where they aren't just you. Your own sessions look as today. A session someone else owns, or you co-own, shows first names after the title in the chip's secondary style ("Ana, Ben +3" past two), and the hover card lists them all. This rewords P5 acceptance 11's "every session row shows its owners" to "every row of a session you don't own alone", for P5's writer. *Alternatives:* an owner chip on every row, as acceptance 11 is worded; avatars.
- **Q3. The per-project toggle** (M5; O6's T6). *Recommendation:* a "People" toggle on the project row's hover and in its menu, off by default and remembered per project. When it is on, others' sessions join the list in activity order, each with its owner. While it is off, the project row says "+N others", faint, only when there are any. *Alternatives:* one toggle in the sidebar's header for every project; others' sessions in an "Others" group under each project.
- **Q4. Visibility and shares** (M6). *Recommendation:* a Share sheet from the session's header and its row menu, shaped like a shared document's:
  - General access: Private, Listed (the default), Org can view, or Org can talk, each with one line on what it means;
  - People, each with View, Converse or Approve, and Add person;
  - Touch ID on save;
  - with Private, the line that the messages its agent sends other agents stay readable across the org (RL §6.2).

  A row whose access isn't the default shows a small lock or people mark. *Alternatives:* visibility only in the session's info panel; a default per project.
- **Q5. The project channel** (M7). *Recommendation:* a tab opened from the project row (a "Channel" item), reading like the desk's group chat:
  - one stream for the project across machines;
  - each to-human message as an entry with its session's title and machine chip;
  - questions and permission cards inline and answerable there (owner, P5 Decision Log 11);
  - agent-to-agent traffic folded to one row per exchange ("3 messages between maws-45 and ci-opt"), opening on a click;
  - people's own messages with a composer at the bottom, once words are v2 (after O14's last machine);
  - an offline machine's entries from the cache, with "as of" its time;
  - migrated events labelled "attested at migration by `<machine>`".

  *Alternatives:* one inbox across projects, filtered by project; agent-to-agent traffic shown unfolded.
- **Q6. The signer's prompts** (M3, M8). *Recommendation:* the weekly successor asks once, with Touch ID, at the first focus of the app after the head turns 7 days old: a quiet line in the Org section and one notification, never more than once a day. Making the app a root, and later ending the deployment admin, are guided flows in the Org page, each step named. *Alternative:* re-sign only once the head nears 21 days, with fewer prompts and less margin before the 30-day backstop.
- **Q7. Renewing the hub sign-in** (M1, built as recommended). *Recommendation:* one browser trip each time the Access session ends (720 h on staging), shown in the Org section and as one notification; Cloudflare's team-wide org token discarded. *Alternative:* keep the org token as `cloudflared` does, so the app renews with no browser, at the cost of holding a credential that signs you in to every Access application of the team, not only the hub.

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

## Outcomes & Retrospective

**M1 (2026-10-28, PR from `p5-o8-m1`; the live staging sitting pending at the owner's hand).** The app signs in to the org from a pairing code, registers its device, holds the org's chain from genesis behind an anchor, follows the hub over the `?app=1` feed, and hands O7's links a production session. A never-signed-in profile makes no keys, files or requests. Evidence: the unit suites (`access-login` 32, `held` 22, `registry-feed` 29, `hub-client` 3, `org-session` 56, `OrgSection` 13) and `test/org/sign-in.local.test.ts` (7, on desk-hub's Worker in Miniflare with O13's real `pair` approving, the app's fingerprint equal to `pair`'s, and O7's link up over the hub on the production session), class 1a and the hosted Electron groups (the PR body has the runs). Still owed: the staging sitting (the fingerprint match on a real Access login, `/api/me` through `cf-access-token` from the app, a relaunch with no browser), recorded here when it runs.

Retrospective. The document held: every decision it made stood, and the gaps it left were small (a `directory` refusal, a feed close hook, the chain re-read from below the head for a recovery). What it didn't foresee was the session's write concurrency: four parallel actors (attempts, adoptions from two sources, sign-out, recovery) each writing `registration.json`. Ad hoc fences left three windows, which the review found; one serialized commit queue closed them. A future child holding a trust anchor beside a credential should start from that queue. The test-writing workers found three real bugs each time they were given a module they hadn't written, which paid for the split.
