# The desk, DC9 — the session view: report (interim, 2026-10-17)

**Status: paused at the composite's writer's instruction for a cmux restart, mid-execution.** This is the controller's
interim account. The living record is the plan,
`docs/doperpowers/plans/2026-10-17-desk-dc9-session-view.md` (Progress, Decision Log, Surprises). The mechanics needed
to resume (bases, heads, agent ids) are in the SDE ledger,
`.doperpowers/sde/2026-10-17-desk-dc9-session-view/progress.md` (gitignored, in `/tmp/desk-dc9`).

Parent pin: composite `417b8d2d3` (MAWS `smns-erb`).

## Where each piece stands

| Piece | State | Where |
| --- | --- | --- |
| S1: the ask tool classified as a question | Done. Reviewed clean (reviewer-medium), gate run 39045490193 green, PR open, merged into `desk-dc9` | [SSFSKIM/MAWS#26](https://github.com/SSFSKIM/MAWS/pull/26), branch `desk-ask-classify` @ `dd7c37ab9` |
| S2: shell and monitor starts in MAWS's backfill | Parked by the composite's writer: no PR, branch pushed. Residue below | `desk-backfill-jobs` @ `f51cc2056` |
| T0: mockups of the four taste surfaces | Done. Owner chose 1B, 2B and 4A, with Stop disabled | `mockups/desk/09-session-view.html` (merged) |
| M1: the hub's `output`, the widened bodies, DX8 `output()` | Reviewed clean | `d2c8fec5..af560476`, fix `..89b2e560` |
| M2: the fake machine's part | Reviewed clean, including the follow-ups: DC8's fixture at `48f254aa`, launch text read only without a `toolUseResult`, and the `rpcs.test.ts` flake fix | `36131d48..c4a17632`, then `97e3b111..458f60c1`, then `ec8021c6` |
| M3: per-session owner and session view | Reviewed clean after three fix waves; merged | `desk-dc9-m3` `..55c6e118`, merge `582aecfd` |
| M4: the channel around the view | Built, plus fix waves 1–2. **Re-review of fix wave 2 pending** | `desk-dc9`: `7e2bbe64`, `1b05db7a`, `e8f5c743` + `38791976` |
| M5: the column | Built and green, not yet reviewed. **Pending:** desk-side normalization of the bridge's multi-line interrupt row (Decision Log) | `desk-dc9-m5` @ `ca591debe` (`/tmp/desk-dc9-m5`) |
| M6: acceptance, phone bundle, gate, polish | Not started | plan M6 |
| Whole-branch xhigh panel; merge `origin/master`; DC9 PR | Not started | the panel is handed up to the composite's writer |

## To resume

1. Re-review M4's fix wave 2 (`1b05db7a..38791976`) with the M4 task reviewer.
2. Resume M5's executor for the bridge-interrupt normalization. Then run M5's task review, merge `desk-dc9-m5` into
   `desk-dc9` (`desk-transcript.ts` needs a small textual merge with M4's range deletions), and send the composite's
   writer the final depth tab list (Subagents, Jobs, Diff, Info).
3. Dispatch M6 (plan text).
4. Run the whole-branch xhigh panel. Hand the pinned range to the composite's writer.
5. Merge `origin/master`, push, and open the DC9 PR. It notes that it lands after #26.

## Residue so far (for the composite's writer to register)

- **The MAWS app's disk-only background jobs** (one follow-up owning the whole feature). It covers:
  - the parked backfill on `desk-backfill-jobs`;
  - a disk-only `session.events` read, which reverses C8b's documented line;
  - an exited rule for disk-only sessions;
  - dropping BackgroundTool's live gate and its product line;
  - Stop hidden for reconstructed jobs.

  Two open findings ride with it. A monitor's expiry attachment is lost on a branch rejoin
  (`chain-follower.ts:512-515` skips attachments). And the backfill misses the preamble-form plain-row notification.
- **maws-fe suggestions:**
  - the bubble's delivery foot, which the owner wants proposed to MAWS's `UserRow`;
  - a `QuestionRow` prop, to replace the desk's portal overlay;
  - names in `agent_message` rows (tech-debt row);
  - a disk-only async ask-mod question that stays "Not answered" in the desktop app.
- **Web Stop** for jobs (DX6 RPC, hub route, machine side). It is the first follow-up after DC8 and DC9 land.
- **A relayed DX4 `turn-end` kind** (DC8 producing it), more exact than ending a turn at its interrupt marker.
- **The bridge's interrupt row** should write the engine's exact marker, with the "Task …" lines in a separate row.
  The composite's writer dispatches this to doperpowers.
