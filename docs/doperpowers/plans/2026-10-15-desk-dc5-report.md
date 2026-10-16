# DC5 (the web: projects and the conversation): controller's report (2026-10-16)

- **Plan:** `docs/doperpowers/plans/2026-10-15-desk-dc5-web.md`. Its Progress, Decision Log, Surprises, and Outcomes & Retrospective sections are current.
- **Ledger:** `.doperpowers/sde/2026-10-15-desk-dc5-web/progress.md`, gitignored. It holds every base, head, and agent handle.
- **PR:** https://github.com/SSFSKIM/MAWS/pull/13, based on `smns-erb` and stacked on it.
- **DC5's own range:** `895e27d10..130da278c`. The merge-base with `smns-erb` is 895e27d1, and every merge of `smns-erb` in the branch history brought in DC3's work.

## What ran

Execution used doperpowers:subagent-driven-execution with a fresh executor per task (opus/high) and a task reviewer at each boundary (sol/xhigh).

| Task | Scope | Fix waves | Result |
| --- | --- | --- | --- |
| 1 (M1) | shell, hub client, DX8, DX3 double | 1 | clean |
| 2 (M2) | key derivation, enrollment, holder lifecycle | 4, on the holder's races | clean |
| 4 (M2b) | the owner's ruling: one random key wrapped per method, DX7 `/api/org/keys` | 1 | clean |
| 3 (M3) | the conversation and every action of §5; the MAWS cut 5bd20087 | 2 | clean |
| 5 (M4) | PWA, Web Push, phone layouts (the owner's 3A verdict), split bundle, owner's walk | 2 | clean |
| 6 | proofs owed against DC3's real hub and fake machine, plus contract catch-up (decided, RpcError, toolUseId, retired versus ended, steer `row` null, DX3 paging) | 3 | clean |

## Evidence

- **Unit:** 256/256. Typecheck and lint are clean.
- **Linux lane, e2e:desk-web:** 38/38 (runs 38846307022 and 38847209275).
- **Local hub with DC3's fake machine, 2026-10-15 20:31, under the writer's load ruling:**
  - session-plane 9/9;
  - local-hub 7/7;
  - the grid within 2 s: busy 79 ms, waiting 72 ms, shell 33 ms, offline 1,344 ms.
- **The owner's walk, Part 1 and Part 2:** recorded in the plan. It closes §8 unknown 4's first half. P2.11 is pending.

## Still owed

- **The xhigh whole-branch review** over `895e27d10..3de8a15e9`. It is running from the writer's session (run wf_2647f569-98e). Its fix wave comes back here.
- **P2.11:** a push tapped 4 hours or more later. The owner runs it.
- **The redeploy of web 3de8a15e9,** which carries DX3 paging. That is DC3's.

## Deferred minor findings

These are rows of `docs/tech-debt-tracker.md` (owner DC5), logged by the xhigh review's fix wave:
- `KeyDialog.test.tsx:117-121`: a fixed 50 ms wait;
- `test/local/hub.ts:46-52`: the state directory is not removed when startup fails;
- three lazy third-party chunks over 500 kB, accepted by the writer.

## Environmental friction

- **The worktree-isolation guard** refused `with-slot.sh` and compound shell commands for a while. The owner ruled that a direct run is acceptable. M3's executor had already run four heavy commands plainly before that ruling, and they were reported.
- **The Mac's load stayed between 30 and 400 for hours.**
  - Heavy browser suites moved to the gate's Linux lane.
  - The local-hub suite first waited 5 hours for a load threshold. It then ran under the writer's ruling: below 60, inside `with-slot.sh`, one chain.
- **The parent session restarted once,** at about 15:25 PDT on 2026-10-15. The writer resumed Task 6's executor, and no work was lost.

## Residue

- **Labels of wrapped-key methods collide** when two methods are added in the same minute, because no rename endpoint exists.
