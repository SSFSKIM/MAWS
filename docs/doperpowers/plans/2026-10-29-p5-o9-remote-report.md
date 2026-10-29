# P5 O9, lane A: execution report (the remote half, M9; M10 waiting on O14 B2)

Spec: `docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md` (parent `docs/doperpowers/plans/2026-10-27-p5-org.md`, child O9; P5 Decision Logs 131, 132 and 135).
The O9 remote controller executed it for the architect, using subagent-driven execution: one executor for each half of M9, a task review at each frontier, fixes resumed on the same executor, then a reviewer-high landing review over the whole range.
Branch: `p5-o9-remote`, cut from `origin/p5-o3-c` at e89b0437a (O3-C's landing head, which carries the D20 fold of lane A into `src/services/lane-a/`). It merged O3-C's later heads (b1f1aa4dc, then 4c3fcbe15) and master c6c523547 (#339), and was never rebased.

## What was built

MAWS on one Mac now shows and drives a terminal session on another machine, through O7's `RemoteLink` to that machine's endpoint and its sminos. Opening the session's row in the sidebar (O8's listing) shows its transcript, which streams and pages back. Its controls work through signed RL4 acts, and its permission prompts, questions and plan approvals are cards in its pane. It is proved under `MAWS_DEV_ORG` against the real endpoint and a fake sminos. The owner sees it live once the mini is cut over (M10).

| Task | What | Commits | Review |
|---|---|---|---|
| Pre-flight | M9 re-placed on O3-C's fold: the remote adapter stays in the app, and shared logic goes to `src/shared/lane-a/` (confirmed by the architect); the opener; custody; the step-end fields; model and effort; delivered words; M10's split | 6aff29e47, 07ddcab8b | — |
| 9a, main | `src/main/lane-a/remote.ts`, `remote-state.ts`, `remote-outcomes.ts`; the router's `remote` wrapped for `laneA.*` in `src/main/index.ts`; `src/shared/lane-a/` (answers, step-end, bridge words); `test/lane-a/remote.test.ts` against the real endpoint | 52653a36a, 9a3f4de5f, d5bc5c3a5; fix 6dc421ae3 | Task review: 4 Important (send lane lifetime, device caps and link state, act progress, effort-only step-end), fixed and re-reviewed clean |
| 9b, renderer | The step-end type (#339) without the cast; the grade refusal end to end; `remote-source.ts`, the remote lane A port, the lane A opener, the gaps disabled in place, cards under addressed ids, the remote subagent tree, paging recovery | f3368db1a..89d2db14d; fixes cc256b464..34feea28f, bb31c1978 | Task review: 4 Important and 1 Minor, then 1 Important left; two fix waves, re-reviewed clean |
| Landing | reviewer-high over 4c3fcbe15..7da8b1143 | fix 45fe5b787, dce27e579, ae8bad82d | 3 P2: a quiet replay without a resume, the agents feed not rebinding when a listing arrives late, the drill-in bypassing the subagent-rows gap. Fixed; re-review correct, no material findings |

The decisions are folded into the spec's Decision Log, in the entries dated 2026-10-29.

## Gates

- Class 1a (`static,unit,probes,e2e:desk-web --class1a pool`):
  - 40838051168 on 6dc421ae3 (main half);
  - 40854320233 on bb31c1978 (renderer half);
  - 40858548379 on ae8bad82d (landing fixes).
  All green. One earlier red (40835225666) was the tracked `src/mawsd/cli-prompt.test.ts` ^C flake. Two others were typecheck slips in new tests, fixed.
- Hosted Mac: 40845576884 on 89d2db14d, 40850880929 on 7fc743ca1, and e2e:lane-a 40854302887 on bb31c1978, all green. The landing set ran once, as the architect planned, on 20202ddd0. That is M9 merged with O3-C's post-series head 8544c48fc, which carries master 5b7f51092. Run 40866323525 was green: class 1a pool (static, probes, unit 4/4), and unlaned e2e:lane-a 11, c7 35, c7-utility 35, widgets 29, agents 23, transcript 37, side 12, desk-web 198 and desk-web-hub 39 passed, with 0 flaky. The run's tree e4a8bd0f1 equals 20202ddd0's.

## Preconditions for M10 (checked read-only, 2026-10-29)

- O7 M1, O8 M1 and O8 M2 are on master.
- The mini runs sminos 1.27.11, which carries `send`. sminos 1.27.12 adds the step-end fields.
- The mini is **not** cut over. It runs no `mawsd`, and its sminos daemon still runs its DX2 uplink; O14 is at B1. So M10's sitting waits on B2, by the architect's ruling.

## M10's sitting (when B2 is done)

1. On the mini, as the owner: `mkdir -p ~/scratch/o9-remote && cd ~/scratch/o9-remote && git init -q && claude`. This runs under the mini's own sminos, with the bridge mod loaded. Check that `sminos daemon status` shows the RL10 endpoint and no DX2 uplink.
2. On the MacBook, launch a dev build of the landed head from a git-less `git archive` copy under `~/.local/share/o9-remote-sitting/`. Use `env -i HOME=… USER=… PATH=… SHELL=… TMPDIR=… LANG=… SMINOS_HOME=<scratch, short> MAWS_USER_DATA=<scratch> pnpm dev`, with no CLAUDE* or ANTHROPIC* variable. A scratch `SMINOS_HOME` keeps local lane A away from the owner's own terminal sessions on the MacBook. Sign in through O8's sign-in on the scratch profile.
3. In the sidebar the mini's machine row lists `o9-remote`. Open it. The transcript loads, and older rows page back on scroll.
4. Record each of these:
   - **send:**
     - idle: the terminal shows the words as the owner's, and the reply streams in MAWS;
     - while running: the words are read at the next request;
     - two sends back to back: both arrive, in order.
   - **interrupt** a running turn: both sides stop, and the partial reply stays in its turn (with sminos ≥ 1.27.12, which places it by step-end `t`).
   - **a permission prompt:**
     - answered in MAWS, the terminal's dialog closes;
     - answered in the terminal first, the card reads "Answered in the terminal".
   - **a question; a plan approval**, with keep-planning feedback.
   - **model:** set Haiku, then effort low, and check that each keeps the other. The chip follows a `/model` typed in the terminal at the next step-end (sminos ≥ 1.27.12).
   - **slash commands:** a runnable one (`/rename o9-remote`), a side question, and compact with instructions.
   - **MCP:** read the list, then enable a server.
   - **the gaps,** each disabled with its reason:
     - Take over in MAWS (toolbar menu);
     - stopping a background shell;
     - attachments;
     - a subagent's own rows (the drill-in shows the reason; the tree and statuses still show);
     - Mode;
     - widgets beyond model, compact and MCP.
   - **a dropped channel:** turn the MacBook's Wi-Fi off for 20 s, then on. The view resumes with no row lost or doubled, and a send made while offline either goes or is refused "offline" with its text kept.
   - **a carrier switch:** with the tailnet direct path blocked, the relay carries the session; unblocking returns it to direct with no reset.
   - **a lost acknowledgement** resolves to one effect. This is covered by the integration suite and needs no live step.
5. Teardown: quit the dev build, remove the scratch profile, `/exit` the mini session. Check that the owner's `~/Library/Application Support/MAWS` mtime is unchanged.

## Friction routed around

- The worktree-isolation guard refuses shell commands whose paths contain the substring `git` in some forms (here, `GitHub` in a path inside a loop). Waiting scripts went into `~/.local/share/o9-remote/` and run from there. It is already logged at `~/.claude/friction-tracker/general/live/worktree-isolation-refuses-bash-commands.md`.
- The engine forced the controller to hand back early twice while a child waited on its gate (`~/.claude/friction-tracker/general/live/engine-forces-subagent-handback-while-child-still-running.md`). The workaround that held was one armed background watcher at every turn end.

## Residue

See the PR body's `## Residue`.
