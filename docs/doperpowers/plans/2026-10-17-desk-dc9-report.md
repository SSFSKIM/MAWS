# The desk, DC9 — the session view: report (2026-10-17)

**Status: done.** Every milestone has been built and reviewed clean, the whole-branch xhigh panel's findings are fixed and
re-reviewed, and the PR to `master` is open, not merged. The composite's writer merges and deploys it, hub first.

- **Plan:** `docs/doperpowers/plans/2026-10-17-desk-dc9-session-view.md`. Its Progress, Decision Log, Surprises and
  Outcomes are the full record.
- **Composite:** `docs/doperpowers/specs/2026-10-15-desk-design.md`, child DC9, last pinned at `417b8d2d3`. Later
  composite commits recorded DX8 as built, the tab list and the G3 amendment, all of which the plan already carries.
- **Branch:** `desk-dc9`. Merge-base with `master`: `d94663760`.
- **Mechanics:** the per-task reports, review packages and screenshots are in the SDE workspace
  `.doperpowers/sde/2026-10-17-desk-dc9-session-view/` (gitignored, in `/tmp/desk-dc9`).

## What landed

| Piece | Range | Review |
| --- | --- | --- |
| S1: the ask tool classified as a question | `a2fc6a2c..dd7c37ab`, merged to master as #26 (`67710ddd`) | reviewer-medium clean; gate 39071873678 |
| S2: shell and monitor starts in MAWS's backfill | **parked**: `desk-backfill-jobs` @ `f51cc205`, pushed, no PR | its review's open findings are in the residue |
| T0: mockups of the four taste surfaces | `mockups/desk/09-session-view.html` | the owner chose 1B, 2B and 4A, with Stop disabled |
| M1: the hub's `output` frame and kind, the widened bodies, DX8 `output()` | `d2c8fec5..af560476`, fix `..89b2e560` | task review clean |
| M2: the fake machine as DC8's producer, and the `session-view` recording | `36131d48..c4a17632`; DC8's fixture follow-ups `97e3b111..458f60c1`; rpcs flake `ec8021c6` | clean |
| M3: one owner per session, the session view, streaming in the report, history in the center | `36131d48..55c6e118` (branch `desk-dc9-m3`), merged `582aecfd` | clean after 3 fix waves |
| M4: tail sends, inline requests, ask overlay, end marker, fallbacks, retired folds | `ec8021c6..38791976` | clean after 2 fix waves |
| M5: the column's DX4 statuses, the jobs view, `output`, MCP names, the interrupt's end | `34d32461..4cca48d8` (branch `desk-dc9-m5`), merged `ec0e9013` | clean after 1 fix wave |
| M6: the acceptance, the phone bundle, polish, gate | `d2772a0e..4f4495ad` | clean after 1 fix wave |
| Whole-branch xhigh panel (`d9466376..79a8c812`, run by the composite's writer) | 4 P2s and the `$` escape fixed in `c4492a96`; debt rows `48ad4b43`; the high rung's 1 P2 fixed in `13ff05e7` | reviewer-high clean on the fix delta |

DC9's acceptance, G1–G5, is mapped clause by clause in M6's task report: each clause, the test that proves it, and the
producer it runs on. G6 is S1's PR. Two things cannot be proved against the fake machine:
- DC8's machine side end to end. It waits for the deployment, and the hub ships first.
- The n-0 fallback. It is proved on DC5's DX3 double, while the fake's own n-0 rule is proved in desk-hub's suite.

## Residue (for the composite's writer to register)

- **The MAWS app's disk-only background jobs** (one follow-up owning the whole feature). It covers:
  - the backfill parked on `desk-backfill-jobs`;
  - a disk-only `session.events` read, which reverses C8b's documented line;
  - an exited rule for disk-only sessions;
  - dropping BackgroundTool's live gate and its product line;
  - hiding Stop for reconstructed jobs.

  Open findings that ride with it:
  - a monitor's expiry attachment is lost on a branch rejoin (`chain-follower.ts:512-515` skips attachments);
  - the backfill misses the preamble-form plain-row notification.
- **maws-fe, to propose to the MAWS app:**
  - the bubble's delivery foot for `UserRow`;
  - a `QuestionRow` prop, to replace the desk's portal overlay;
  - names in `agent_message` rows (a tech-debt row);
  - a disk-only async ask-mod question that stays "Not answered";
  - a peer label's semantics: the bubble is still announced as "Your message".
- **Web Stop for jobs.** It needs a DX6 RPC, a hub route and the machine side. It is the first follow-up after DC8 and
  DC9.
- **A relayed DX4 `turn-end` kind**, produced by DC8. It would be more exact than ending a turn at its interrupt marker.
- **Lazy shiki and KaTeX on the phone**, loaded only when a message holds code or math.
- **The bridge's async-answer prompt** ("The doperpowers plugin sent a message: …") still draws as a raw bubble. It
  could get the frame-line treatment.

## Tech-debt rows this branch adds to `docs/tech-debt-tracker.md`

1. MAWS's live path types a command Monitor as `local_bash` (owner C3 or C8b).
2. An idle or ended session's last open turn still reads "working" when the transcript never ended it (desk only).
3. Agent names in `agent_message` rows (maws-fe).
4. A steer of an exact interrupt marker through a plugin older than #225 ends a turn.
5. The fake machine's output resolver does not refuse a `..` that follows a dangling symlink. The read stays inside
   the root.
6. When DX4's status equals the held status, the held end time stays.

## Friction routed around

- **The worktree guard.** Agents dispatched from this session inherit a guard that refuses `git -C` on other paths and
  complex shell. So every reviewer read a diff file the controller wrote (`/tmp/desk-review/dc9-diff.zsh`).
- **A cmux restart paused execution.** Every worker committed WIP first and the ledger carried every handle, so
  nothing was lost or redone.
- **A flake in DC3's `rpcs.test.ts`** (a setUp race) was fixed in a test-only commit, `ec8021c6`.
