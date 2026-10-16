# DC6 (the web: session depth): controller's report (2026-10-15)

**Status: done.** PR https://github.com/SSFSKIM/MAWS/pull/12 targets `smns-erb-web`, is ready for review, and is stacked on DC5. The composite's writer retargets it to `master` once DC5's PR merges.

- **Spec:** `docs/doperpowers/plans/2026-10-15-desk-dc6-depth.md`. All three milestones are ticked. The spec's Decision Log, Surprises & Discoveries, and Outcomes & Retrospective are current.
- **Parent:** the composite at MAWS `8f7e09d3` and the later commits folded into the Decision Log, up to `43a27604`/`0473e509`.
- **Ledger:** `.doperpowers/sde/2026-10-15-desk-dc6-depth/progress.md` (gitignored). The executor and review reports sit in the same directory.

## What was built

`connectDepth()` (`apps/desk-web/src/depth/connect.ts`) registers two DX8 slots.

- **`depth`** has four tabs:
  - **Transcript:** MAWS's transcript view over a `TranscriptSource` built on `SessionPlane`. Streaming settles per block in the adapter's own layer, older pages arrive by chronological rebuild with the reader's place kept, and `<message>` marks are drawn.
  - **Subagents:** a desk tree over MAWS's `tools/agents/model/*`, with each agent on its own subscription.
  - **Diff:** `Subscription.diff()`, drawn through `splitPatch` and `ReviewView`.
  - **Info:** from `DeskSession`, the transcript's model, and DX4 `usage`.
- **`transcript`** draws one fold of a direct channel's working record over an exclusive `range`, through the to-human Presenter. DC5's WorkingRecord already mounts it.

## Commit range

- **Whole range:** `6ada9f12..9bf09d6e` on `smns-erb-depth`.
- **Merges:** DC5's work arrives through `df8c8776` and `a9abd794`, `948fd575` (`smns-erb-web`), and DC3's through `4e464576`, `722dbbfd`, `481d05b3`, and `8d9814df` (`smns-erb`).
- **DC6's own commits:** the first-parent, non-merge commits of that range.
  - **M1:** `ba2896bc`..`ba48dcda`, then fix wave `99512e8a`, `492d4b56`, `f6d42944`.
  - **M2:** `7ac8c095`, `fb674567`, `c86352d8`, then fix waves `7e741316`, `dbedd79e`, `f6f288c9`.
  - **M3:** `7a1a9911`..`1eb05c84`, then fix wave `78206d52`, `e4c9a4c3`, `4f3c58f4`.
  - **Final fix waves:** `64481c89`, `82b812e4`.

## Reviews

- **Task reviews:** M1, M2, and M3 each came back clean after their fix waves. Their findings are in `review-1.md`, `review-2.md`, and `review-3.md` in the workspace.
- **Final whole-branch review:** a `high` review (doperpowers:review-code, reviewer-high).
  - It found one P2: a tight resubscribe loop on terminal errors.
  - The first fix stranded a transcript when the hub replaces a machine online-to-online.
  - The second fix (`82b812e4`) re-checked clean, with all four of the reviewer's lifecycle probes passing.

## Evidence

- **Gate:** green on the Linux lane, run 38818748087 on `82b812e4` (static, unit, e2e:desk-web with 67 browser tests, including 8 acceptance specs against DC3's fake machine).
- **Unit tests:** `pnpm --filter desk-web exec vitest run src/depth` passes 94/94 across 13 files.

## After DC5 landed (2026-10-16)

- **Retarget and first merge.** DC5 merged to `master` as `76b1de78`, and
  PR #12 was retargeted to `master`. `origin/master` was merged in as
  `1a59b984`. The one conflict was `apps/desk-web/src/main.tsx`, resolved by
  keeping both sides: master's `followLandings()` and
  `installPreviewPolicy()`, and DC6's `connectDepth()`.
- **Gates on `1a59b984`, all green.** `static,unit` 38902444847;
  `e2e:desk-web` on the mini 38903248599 and on the Linux lane 38903677809;
  `e2e:desk-web-hub` 38904233453.
- **The composite writer's xhigh panel** read `76b1de78..1a59b984` and
  confirmed three P2s:
  - paging stalled on pages that draw nothing;
  - folds cut rows with a grammar other than the export's;
  - a tool result lost its call across a fold boundary.
- **The fixes.** `f70de6fc` fixed all three, and the task review found that
  its result filter dropped rows holding no result. `2ebd3e05` fixed that,
  and the re-review is clean. The changes:
  - older pages keep loading until a page draws or `more` is false
    (`view/older-pages.ts`);
  - folds are cut by a port of `sminos_marks.py` `_parse_marked`
    (`source/export-marks.ts`);
  - a fold that holds a call takes that call's results, and rows without
    results pass through unchanged.
  - `src/depth` passes 111/111 on named files.
- **Second merge.** `origin/master` (`9cf2b480`) was merged once more as
  `f8a5cdf2`, with no conflicts.

## Environmental friction routed around

- **Linux lane instead of the local load rule.** The harness refused `/tmp/maws-review/with-slot.sh`, and the Mac's load stayed at 25 to 290, so `waitload20.sh` never cleared. Following the composite writer's ruling, heavy suites ran on the gate's Linux lane, and the M2 screenshot was taken there.
- **A restart killed one watcher.** The parent session restarted once, mid final fix wave. The executor read its gate run back with `gh run view` instead of re-dispatching it.
- **The worktree-isolation guard refused variable-bearing and `xargs`-fed git commands.** I split them into literal commands.

## Owner actions

None outstanding. The bases `smns-erb-web` and `smns-erb` were pushed by the composite's writer.

## Residue

- **The gate returns no desk-web browser traces.** It uploads only the repo root's `test-results/`, so a failing desk-web trace never comes back from the Linux lane. Adding `apps/desk-web/test-results/` to `.github/workflows/gate.yml`'s artifact upload fixes it.
- **desk-hub's `enrollment.test.ts` flakes on the Linux lane.** It has failed twice, with 502 against 404 and 502 against 400, and passed on rerun both times. It is DC3's, and is already reported to the composite's writer.
