# Project registry, M8 to M12: the execution report

Spec: `docs/doperpowers/plans/2026-11-10-project-registry.md`. Design: `docs/doperpowers/specs/2026-11-10-project-registry-design.md`. Board: MAWS #521 (the app's half; acceptance is M13's).
Branch `registry-app`, built in its own worktree off origin/master, merged with master (never rebased) at every master move, P5 O15's two landings (#562, #567) and #561 included. One PR to `master`; M1 to M7 are the desk track's and M13 is the owner's live check, neither started here.

## How it ran

Subagent-driven execution with this session as controller and the spec's one writer on the branch (Progress for M8 to M12, Surprises & Discoveries, Decision Log 10 to 26). A fresh `doperpowers:task-executor` per milestone (opus, high); each milestone reviewed at its boundary until clean (`doperpowers:reviewer-high` for M8 to M10, `doperpowers:task-reviewer` for M11 and M12; Decision Log 10). Then a whole-branch review at reviewer-high scoped to the seams, which was material, so the coordinator ran an xhigh panel on the full range, then one reviewer-high pass on the panel's fixes. The ledger, gitignored, is `.doperpowers/sde/2026-11-10-project-registry/`: the executors' reports, every review's findings, the panel's findings (`registry-panel-1.md`/`.json`) and the fix reports.

Local runs followed the owner's rule: no Electron, no e2e, no packaged build, no typecheck and no multi-file eslint or vitest on this Mac; eslint on one file and vitest on one test file only, local timings a signal and never a verdict. Typecheck, lint, the unit suite and the probes ran as class 1a on GitHub Actions (`scripts/ci-gate.sh <worktree> --gates static,unit,probes`); every Mac-holding gate ran on the coordinator's clearance.

## Milestones

| Milestone | Commits | Review | Decision Log | Class 1a |
|---|---|---|---|---|
| M8 — the wire (`WIRE_MINOR` 34) and the index: stored statements, anchors, the rule, states | d563695ff..bc1c2f7ce | 3 rounds, reviewer-high (20 findings: 18 fixed, 2 deferred) | 13, 14 | 42809400448 |
| M9 — the endpoint: the signed record, `locations` to sminos, the directory, the offers (35) | 862266399..11f5be9ca | 5 rounds, reviewer-high | 15, 16 | 42827137236 |
| M10 — main: records verified and kept; row keys; held removals | 7407b65e1..cf8e2b2fe | 5 rounds, reviewer-high | 17 | 42840236348 |
| M11 — the page: one project per id, its locations, Add project, states | 1ba432458..da785cb15 | 3 rounds, task-reviewer | 18 | 42854702293; `e2e:settings` hosted 42857042412 (19 passed, the group held 18) |
| M12 — `maws project` (36), the confirmation sheet, withdrawal | 0fc1d62d6..057a43d00 | 3 rounds, task-reviewer | 20 to 24 | 42869703126, 42872437271 |

## The whole-branch reviews

1. **reviewer-high on the seams** (`origin/master...0c9b1059c`): two Important, both fixed (Decision Log 25). A hub-supplied certificate could aim `maws` at another machine: `directoryMachines` now takes certificate machines from org-protocol's one view of standing (`certViews`, through `standingCertMachines`), live and uncontested only, which also closed delegation-signed retirements; a contested name is refused `contested` (42257ce03, 75ff31bef, fe9a497fd). Retained rows were not derived again across an enrollment change (9df6648e0). Class 1a 42878543393.
2. **xhigh panel** on `5d7145b8c..cadbd36b6`: fourteen findings (one P1, thirteen P2), all reproduced and fixed with a test that failed first, none dismissed (Decision Log 26). The triage:

| Finding | Verdict |
|---|---|
| scalpel-1#1 (P1) forwarded remove/link carry only the id | fixed: remove f4365ca4c (expect {path, project}); link 7a993852e (session.projects.link gains expect {path}, Statements.link refuses changed; main and the page send it; WIRE_MINOR 36, one manifest line) |
| sweep#1 replaced location loses its registry identity | fixed e1242198f (own statement's project, no `stated`; its Remove checked against that id); f341e9368 Add project's default link never takes a replaced location |
| sweep#2 session-only registry project not listed | fixed 008440c59; spec already settled it (§I l.626 "listed with no locations", §J l.634 "listed when OrgProjects.projects holds it"), not a design point |
| sweep#3 remote-only New chat in the no-project set | fixed 0fa2fb805; off residue. The reload debt (projectless after a page reload) does NOT close: the registry id lives only in page memory; stays debt |
| scalpel-1#2 held mark deleted on a temporary contest | fixed 226a25e00 (mark kept until the key is retired or revoked; §H reworded) |
| scalpel-1#3 machine names case-exact | fixed b61d75ec1 (machineNameKey in CLI and main); off residue |
| scalpel-2#1 unenrolled clone forms a separate row | fixed 64358fa10 + 70f5ff945 (OrgProjects.ownIds, keyed by ProjectId) |
| scalpel-2#2 rename past 262,144 bytes | fixed 89c7b00fe (admission's fits check reused, ~4 lines; refused too-many-locations) |
| scalpel-3#1 reconnect signs an empty known | fixed 9de74306b (restatement open before link listeners) |
| scalpel-3#2 local daemon assumed to serve project acts | fixed 9fbff4a32 + cb59ed0ec (negotiated from the welcome's wire minor on the daemon shape; the embedded shape never reads the supervisor) |
| scalpel-4#1 held request when the last window closes | fixed f286646b6 (refused no-window; windows watched only while one is held) |
| scalpel-5#1 snapshot publishes changed statement with old id | fixed 6f24be4a7 (no snapshot while a changed statement awaits derivation) |
| scalpel-5#2 stale derivation overwrites a relocated row | fixed 0b6e27f2e (statements_gen/directory checked; read again up to 3 times, then the refresh queue) |
| scalpel-5#3 enrollment replacement not notified | fixed b87164987 |

   Class 1a after the wave: 42893568287 (e2e:cross-build included; its first run caught an app-start crash in the embedded shape, fixed in cb59ed0ec, and a plain-string record key, fixed in 70f5ff945).
3. **reviewer-high on the panel's fixes** (`cadbd36b6..70f5ff945`): all fourteen closed; one new P1, `moved ||= delete` skipping the delete once `moved` was true, so a second invalidated held record kept counting (1839872f5, with a two-record test). Class 1a 42897036439. The review closed there.

## Merges of master

All merges, never a rebase. 7f3694f10, caaef871c, ed321a514, a2624903f, f62734932, 37f68b4db: clean. 67e104ba4 (#558): `conversation.local.test.ts` read the welcome's new `locations`; the fixture's endpoint side fixed at 0e8bc6204, which the desk track replayed against sminos 1.44.0 (107 ok). 0e1718bbd and 5d7145b8c: clean. **P5 O15's first landing** (10e30f17f, #562, then 9301b5416) at fbf798edb and 0439c1678: `app.ts` (the route's not-offered hook beside O15's router, now unconditional), the e2e count (108), the tracker and the plan's Progress; the embedded shape gone, the branch's embedded case removed with it; class 1a 42913006641 after cross-build's two daemon cases took O15's skip for a peer with no embedded shape (ce398b004, cherry-picked). **The wake landing** (dca928640, #567) at 47f13191a: `registry-feed.ts` (master's wake and reach beside the registry's two frames), its test, `remote.test.ts`; no fake of the branch's implements `WebSocketLike`; class 1a 42972616310. **#561** (d15b800d0) at b252b0b83, clean; the endpoint keeps the highest revision per machine (`src/endpoint/projects-held.ts:189`, serialized at :97 and :225), as #561's residue asks.

## The Mac gates

On b252b0b83, `--gates all` (43206290258): three reds. `unit:darwin`'s 4,000-upsert CPU bound read 605.9 ms against 500 on a loaded mini; the measured test never reaches the branch's code (0 `sessionJoined` calls), but the per-session project check did repeat per session on real scans, so it is now once per project per transaction (1adcd0db4, Decision Log 14 (5) kept). `e2e:remote` failed at its first wait for B's session under B's machine row on both tries, where master's sightings fail later and pass on retry: by design under §J.1, so the test now finds B's session under its registry project's row and keeps every reachability check (de7870388). `packaged 2/2`'s pin popover focus is the tracker's known flake (row of 2026-11-06), green on the rerun.

On de7870388, `--gates all` again (43216970387): 49 green, e2e:remote, e2e:presentations, packaged 1/2 and 2/2 among them; packaged's two hosted shards are the whole of what `--gates packaged` plans (gate-plan.mjs:244, :249; gate.yml:702 to 716), so no separate packaged run. Fifteen jobs on the mini failed in Set up job on codeload timeouts, no test run. Their hosted rerun (43230352080): ten green; `e2e:settings` red at `e2e/registry.spec.ts:192` on both tries, a harness race that the panel's scalpel-3#2 exposed (production's `machines.changed`, at each change of mawsd's link, replacing the fixture's seeded roster), fixed in the fixture (9dd64cbe4). Four groups stay on the mini whatever the lane (unit:darwin, e2e:default, e2e:discover, e2e:connectors-oauth).

On 9dd64cbe4: `--gates static,unit,e2e:settings --lane hosted` green (43235987877), registry.spec passing, with one flaky, `e2e/share.spec.ts:250`, the same race in `src/main/org/share-fixture.ts`; the share fixture follows the production roster too (bc2d7d1a7), and on bc2d7d1a7 the same call is green with 19 passed and no flaky (43238753411). On bc2d7d1a7: The four mini-only groups: MINI-RUN. The measured cases (daemon-idle, render) under CI-opt's hold: MEASURED-CASES.

mawsd's idle footprint, from reading the code (no measurement): before the spine or the endpoint loads, the branch adds the zod schema objects built at import and a handful of empty collections; `maws-cli.ts` loads only in its own process; the spine and endpoint chunks load as lazily as on master; once the spine is in, the index's folder check is an unref'd interval every ten minutes (the design's).

## Friction

- The GitHub API core budget (5,000) ran out once while ci-gate watchers ran in parallel; one gate lost its verdict (`~/.claude/friction-tracker/general/live/parallel-gh-watchers-exhaust-owner-api-budget.md`).
- The mini's codeload path timed out every action download in two runs on 2026-11-12 (`~/.claude/friction-tracker/MAWS/live/gate-job-ci-kit-action-archive-download-timeout.md`, back to live); `--lane hosted` moves the MAC_VM_E2E groups only.
- A macOS-only measured unit failed on a path the change does not reach (`~/.claude/friction-tracker/MAWS/live/unit-darwin-cpu-bound-fails-on-unchanged-path.md`).

## Residue

Each deserves its own ticket or tracker row; none blocks M13.
- M8: automatic declarations (first use, `.smns` promotion) are not admitted near the 1,000-location / 256 KiB bound (tech-debt row of 2026-11-10).
- M9: labels from the machine's own derivations are visible to a remote caller through `update`, a no-change `link` and `session.projects.list` (design §11 publishes the same labels in every record).
- M10: `member-grants.json` holds one member per device; a second member's sign-in replaces it until the next link-up.
- M11: after a page reload a registry New chat is projectless; the registry id lives only in the page's memory.
- M12: the "enrolled endpoint, no app" proof feeds the other machine's record directly, with no hub; a local `maws project add link/../x` is folded lexically before realpath; `maws project link` on its own machine sends no `expect` (it resolves and acts in one round with no confirmation pause).
- The panel wave: on an enrolled machine where statements are not possible, re-adding a removed stated row leaves its project stale until the next refresh; a machine retired only by its delegation's signed record keeps a silent held entry (it never counts); a replaced location carries the new folder's label, which a git remote there can make the old project's name.
