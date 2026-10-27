# Handing a live terminal session to a headless holder: what happens to its background work (measured)

The holder's plan is to end a terminal session and continue it with `claude -p --resume <id> --input-format stream-json --output-format stream-json`. This note covers whether the session's running background work survives that handoff, and whether the headless process can take it over.

Marks: **M** means measured in an isolated run (§7). **I** means inferred from code and not run.

**Versions.** The runs used Claude Code **2.1.307**, the installed build (`/Users/new/.local/share/claude/versions/2.1.307`). The code was read in the 2.1.300 reprint (`cli.pretty.js`) and cross-checked in the 2.1.307 reprint (`../../2.1.307/cli.pretty.js`).
- Every path this note relies on has the same shape in both builds. Only the minified names and the line numbers differ (§6).
- No behaviour in this note differs between 2.1.300 and 2.1.307.

## 1. Verdict

**A headless stream-json process cannot adopt a handoff.**
- **I** (code): `adopt.json` has exactly one reader in both builds. It is the interactive REPL's `SessionController.restoreOnMount`.
  - It runs only when `CLAUDE_CODE_SESSION_KIND=bg`. The other condition, a "bg takeover", is never set: neither build calls `setBgTakeover`.
  - The print runner never reads the file.
- **M** (run C): a headless `--resume` of a stopped job left the job's `adopt.json` untouched, both times:
  - with a plain resume;
  - with `CLAUDE_JOB_DIR=<job dir>` and `CLAUDE_CODE_SESSION_KIND=bg` set.

  The detached shell it described kept running. The headless session reported that shell as "stopped" and never received its completion.

**What a headless `--resume` does recover, whatever the path:**
- the conversation;
- session crons, resurrected from the transcript with their ids (**M**, runs A, B and C);
- stopped subagents, which the model can continue from their transcripts with `SendMessage` (**M**, runs A and C);
- a cut-off turn, re-run when `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` is set (**M**, runs C, D, F and H).

Live processes and the notifications they would send do not come across.

**Only an engine background job preserves live work.** `/background`, or "Move to background and exit" in the exit dialog, moves the session into a daemon job. The job's interactive worker adopts (**M**, run B):
- background shells, alive with the same pid;
- subagents that are not in a long foreground command;
- session crons;
- the turn in flight.

A job that exits leaves an `origin: "exit"` carrier for its next wake. `claude respawn` adopted that carrier and delivered the shell's completion; a headless resume did not (**M**, run C).

**Recommendation** (§5):
1. Move the session into a job.
2. Drive the job until its carried work has drained.
3. Then stop the job and resume headless with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`.

Nothing is lost at that last step (**M**, run B).

## 2. Work kind × path

How to read a cell:
- **Preserved** means the live process or in-process state carries over.
- **Resumed** means it restarts from its transcript.
- **Lost** means it is killed or not delivered.

After each outcome, the cell says what the resumed or receiving session is told.

The terminal-exit columns use the transcript's own session id. The job columns use the job's session id, which is new (§4.6).

| Work | Terminal `/exit` · SIGTERM · SIGHUP, then headless `--resume` | Terminal SIGKILL, then headless `--resume` | `/background` (the job's worker adopts) | Job exits (`claude stop`), then headless `--resume` | Job exits, then its next wake (`claude respawn`) |
|---|---|---|---|---|---|
| Background Bash (`run_in_background`) | **Lost**: killed at exit. Notice: "Orphaned by a previous Claude Code process exit" (stopped). No completion. **M** (A, E, G) | **Process preserved, unread**: it lives on (ppid 1, own process group) and keeps writing its output file. Notice: "stopped, orphaned", which is false. No completion. **M** (D) | **Preserved**: same pid, output re-linked. Completion delivered as "completed (exit code -1)" with its output; the real exit status is lost. **M** (B) | **Process preserved, unread**: detached into `adopt.json`, still running. Notice: "stopped, orphaned", which is false. No completion. **M** (C) | **Preserved**: carrier claimed, shell re-registered. Completion delivered as "exit code -1". **M** (C) |
| Subagent whose current tool runs under 2 s | **Lost** in process. Notice: "didn't finish before the previous session ended" (stopped). **Resumed** only if the model sends it a message: it restarts from its transcript, and a command it was running restarts too. **M** (A, D) | Same as the previous column. **M** (D) | **Resumed** automatically: checkpointed, then continued in the job ("stepper" went from 12 to 50 steps). Completion delivered. **M** (B) | Same as the first column. The stepper continued at step 28, and its completion reached the headless session. **M** (C) | Carried in `adopt.json`, but the wake refused to resume it: "could not confirm from its own records that its owner launched it and that it is still running". **M** (C, after a headless resume had already finished it; the cause is **I**) |
| Subagent in a foreground command over 2 s, or holding a monitor | As above. **M** (A: the sleeper re-ran its whole loop) | **Agent lost, its command preserved as an orphan**: the loop kept writing. Resuming the agent would run that work twice. **M** (D) | **Lost**: the agent's task tree is not carryable, so it is stopped. The job's notice says it failed ("in-process state was lost"), because its transcript sits under the old session id. **M** (B, C) | As in the first column | As in the first column |
| Monitor (command) | **Lost**: killed. Notice: "didn't finish" or "Orphaned". Never fires again. **M** (A, E, G) | The `tail` lives on, but its stdout is a socket to the dead process, so events have no reader. **M** (D: `lsof` shows fd 1 is a unix socket; the appended line was never delivered) | **Lost**: monitors are excluded from the carrier. The parent queues "killed"; the job receives "didn't finish". The appended line never fired. **M** (B) | Lost (it was already gone) | Lost |
| Monitor (WebSocket) | **Lost**: an in-process socket (`monitor_ws`) with no carry path. **I** | **I** lost | **I** lost (not a shell, agent or workflow, so not carryable) | **I** lost | **I** lost |
| MCP task, stdio server (an auto-backgrounded call) | **Lost**: the server process exits when its stdin closes. "MCP task … failed" is queued but never delivered; the resumed model does not know. **M** (A: `mcp.log` shows `exit` with no `slow done`) | **Lost**: the server died on EOF. **M** (D) | **Lost**: "failed: Connection closed" is queued in the parent; the job gets no notice at all. **M** (B) | Lost | Lost |
| MCP task, remote server | Auto-backgrounded call: **lost**, the request is abandoned ("does not survive exiting this session"). Protocol (`sep2663`) task: runs on the server, and its resume record would be restored on resume, by headless too (`restoreMcpTasks`). But that requires `tengu_glowing_lark`, which is **off** in the owner's gate cache. **I** (M only that the restore was skipped: "[print.ts] MCP task sidecar restore skipped: tasks gate off") | **I**, as in the first column | **I** auto-backgrounded: lost. Protocol task: the job restores it from its resume record when the gate is on | **I**, as in the first column | **I**, as in the first column |
| Session cron (`CronCreate`) | **Resumed from the transcript**, with the same id (`CronList` showed it). **M** (A) | **I**, same as the first column | **Preserved**: carried in `adopt.json`, and it fired in the job. **M** (B) | **Resumed** from the transcript (`session_cron_carry`). The exit carrier writes `cron: []`. **M** (C, B) | **Resumed** from the transcript. **I** |
| Loop wake (`ScheduleWakeup`) | **Lost**: wakes are restored only in bg sessions with a job dir (`Ei` runs only when the resume callback is passed). **I** | **I** lost | **I** carried (`loopWakeFires`, the loop cron's `scheduledFor`) | **I** lost | **I** restored if still in the future; an overdue wake gives a passive "stopped" notice |
| Workflow | **Lost**: aborted. Notice: "background workflow(s) orphaned". **I** | **I** lost | **I** checkpointed. The job tells the model to resume it with `Workflow({scriptPath, resumeFromRunId})`, which goes through permission again. A hidden-script workflow is restarted by whatever launched it | **I**, as in the first column | **I**, as the `/background` column |
| Turn in flight (cut off while streaming, or with a tool running) | **Resumed** only with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`: the turn is re-run from its prompt. **M** (F SIGTERM, H `/exit`). Without the variable it is not resumed, and the turn is sealed (§4.4). **M** (E) | **Resumed** with the variable. **M** (D) | **Resumed**: the job re-ran the turn (`--reply-on-resume`), restarting the in-flight command (`fg.log` got a second, full run). **M** (B, C) | **Resumed** with the variable: the cut-off Bash ran again from i=1. **M** (C) | **I** resumed (the daemon sets the variable on respawns that find a transcript) |

The exit paths that run cleanup (`/exit` choosing "Exit and stop tasks", SIGTERM, SIGHUP) killed every shell, monitor and MCP server within 2 s (**M**, A, E, G). Only SIGKILL skips cleanup.

## 3. Why the kinds differ (code)

**Carryability** (2.1.300 cli:159362-159399 `C9`; 2.1.307 cli:236342). The carrier takes a root task only when its whole tree is carryable:
- A **background agent** needs `isBackgrounded` and an abort controller.
- A **shell** needs `isBackgrounded`, a live handle with `detach`, and `kind !== "monitor"`.
- A **legacy workflow** needs its script path, run id and abort controller.
- Anything else is not carryable: `monitor_ws`, MCP tasks, and foreground shells.

A foreground Bash call becomes a registered, non-backgrounded task after 2000 ms (2.1.300 cli:631697, `Xzn = 2000`). That is why an agent sitting in a long command makes its whole tree uncarryable.

**Output transport.** Measured with `lsof`:
- A background shell's stdout is a regular file under `/private/tmp/claude-501/<project>/<session>/tasks/<id>.output`, and the shell runs in its own process group. It outlives its parent, and anyone can read its output.
- A Monitor's stdout is a unix socket into the owning process. Its events die with that process.

**The adopted shell** (`yoe`, 2.1.300 cli:817610). It polls the pid together with its start time. When the process is gone, it appends `[process exited while detached; exit code unknown]` and completes with code -1 (**M**).

**Plain-terminal exit** (2.1.300 cli:695370-695460; 2.1.307 cli:31426). The exit handoff `L()` proceeds only when `hc()`/`Bd()` is true and a job dir exists. A terminal session has neither, so `IQn` kills every running shell and aborts every running agent. The headless runner registers the same cleanup (2.1.300 cli:906031; 2.1.307 cli:984930).

**Orphan reconcile on resume** (2.1.300 cli:239472 `X_t`; 2.1.307 cli:1131636). Both the REPL and headless rebuild the tasks of the last process from the transcript. Each one that has no completion record becomes a notice:
- background agents: "didn't finish before the previous session ended";
- shells and monitors: "Background shell command didn't finish", or the aggregate "Orphaned by a previous Claude Code process exit";
- workflows: an orphaned-workflow notice.

The same reconcile resurrects session crons (`Mi`). Only a bg session with a job dir passes the resume callback, which does two more things:
- it auto-restarts orphaned agents whose transcript is under 48 h old and on disk (`resumeOrphanedAgents`);
- it restores loop wakes (`Ei`).

These notices are queued with `shouldQuery: false`, so they reach the model on its next turn.

## 4. Who adopts, and when

### 4.1 Writers

**`/background`** (2.1.300 cli:810734 `vYn` → `Azs` → `$et`):
- It writes `jobs/<new short>/adopt.json` with no `origin`, which counts as background.
- It holds the carried shells (detached), crons and agents (by transcript path), workflows and `frameLive` entries.
- It then aborts the carried agents and workflows in the parent, so the job can resume them.
- The confirmation dialog "Background this session?" appears only when something would be stopped. Otherwise the handoff runs at once (2.1.300 cli:810824, `Ko = Lo.count === 0 && Co.running === 0`).
- **M** (B): "3 background tasks will be stopped. 3 tasks will carry over to the background session." The captured carrier held the ticker shell (pid 66892), cron `e217109b` and the stepper agent. Copy: `/private/tmp/bg-handoff/B/out/adopt-copies/`.

**The exit dialog.** On `/exit` with work running, a terminal session shows "Background work is running … Exit and stop tasks / Move to background and exit / Stay" (**M**, A). "Move to background and exit" runs the same handoff (`kYn` → `vYn`).

**Job exit** (2.1.300 cli:695383-695430):
- The process must be a bg session (`CLAUDE_CODE_SESSION_KIND=bg` and `CLAUDE_JOB_DIR`), and `CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF` must be unset.
- It merges `{origin: "exit", shells, agents, workflows, frameLive, cron: []}` into `adopt.json` for "the next wake of this session".
- **M** (C): `claude stop c8f8f275` wrote it with the still-running ticker (pid 51374) and the stepper agent.
- **I**: a headless process started with those two variables would also write this carrier on exit, although it never reads one. Our run had nothing carryable, so nothing was written.

### 4.2 The reader and its conditions

| Condition | Code (2.1.300 / 2.1.307) | Effect |
|---|---|---|
| Interactive REPL only | `restoreOnMount`, cli:819071 / cli:248227, the only call to `readAndConsumeAdoptJson` (`wGr` cli:158705 / `KJr` cli:235662) | The print/stream-json runner (2.1.300 cli:73240-73280) never reads it. **M** (C h1, h2) |
| Resumed conversation | runs only when `initialMessages` is non-empty | — |
| Session kind | `hc()` cli:977315 / `Bd()` cli:468253: `CLAUDE_CODE_SESSION_KIND === "bg"` or a bg takeover. `setBgTakeover` has no caller in either build | Only the daemon's job worker qualifies |
| Job dir | `S0()` / `A0()`: `bgTakeover.jobDir ?? CLAUDE_JOB_DIR` | The file looked for is `<jobdir>/adopt.json` |
| Claim | rename to `adopt.json.<pid>`, parse, unlink in `finally` | **M** (C: the watcher caught `adopt.json.10909` from the respawned worker) |
| Age | A non-`exit` carrier older than 120000 ms is stale: shells, crons and agents are dropped, and `frameLive` is kept, marked stale. An `exit` carrier has no age limit | **M**: claimed 437 s after it was written (C) |
| Schema bounds | at most 1e6 UTF-16 units for the merge, ≤ 256 entries; output re-root capped at 64 MiB | **I** |
| Queued prompts | `adopt.json.queued-prompts` is accepted only when `CLAUDE_BG_CARRIED_PROMPTS_SHA256` matches, a job row exists, the age is ≤ 3600000 ms and ≤ 60000 ms in the future | **I**; not run |

### 4.3 What the adopter does with each kind

The adopter is the job worker. **I**, from cli:819071-819150, confirmed where marked.

- **Agents.** Sorted by spawn depth; an agent is skipped if its parent was not registered. The adopter links each transcript into the new session, registers it, waits for MCP to settle (up to 30 s), then `resumeAdoptedAgents` continues each with `continueInterruptedTurn: true`. **M** (B: the stepper continued).
- **Shells.** The output is linked (**M**: a symlink in the job's `tasks/` dir) and registered with the pid-polling handle. **M** (B, C).
- **Crons.** Re-registered (`NGr`), loop wake fires included. **M** (B: the cron fired at 03:13Z).
- **Workflows.** Registered, then answered with a failed checkpoint notice that asks for a manual `Workflow` resume.
- **Orphan reconcile.** Runs with the bg auto-resume callback. An agent that was not carried gets "failed". **M** (B: the sleeper got "failed", not restarted, because its transcript sits under the parent session id).

### 4.4 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` in headless

- **Effect.** Headless reads it through the park lane (`uT()`, 2.1.300 cli:67762). `resumeInterruptedTurn()` (cli:66842) re-enqueues the interrupted prompt for any interruption kind other than `none`, whether the session was cut mid-stream or with a tool call unresolved. **M**: "[print.ts] Auto-resuming interrupted turn (kind: interrupted_prompt)" after SIGKILL (D), SIGTERM (F), `/exit` (H), and `claude stop` with a Bash call running (C).
- **The turn re-runs from its prompt.** A command that was running runs again from the start. **M** (C: the full 150-step loop ran a second time). Plan for non-idempotent tools.
- **The first resume must set it.** **M** (E): a resume without the variable appended a synthetic assistant row, "No response requested.", plus the orphan notices. A later resume with the variable then found nothing to resume. So the holder must set the variable on its very first resume.
- **One shape is not detected.** **M** (A): the turn was cut right after the harness's own nudge row ("[Your previous response had no visible output. Please continue…]", `isMeta`). That row classifies as a hidden row, so nothing was resumed even with the variable set.
- **Age bound.** The bound applies only when `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` is set. The daemon sets it to 3600000 on respawns of interactive-lineage jobs (2.1.300 cli:1148380-1148384). With the resume variable alone, headless applies no age bound (`AVt()` returns undefined, so `NCt` reports not-stale). **I**. Set the bound yourself if a stale turn must not run.
- **Interactive path.** In the REPL the variable resumes only an `interrupted_prompt` with a human origin (2.1.300 cli:495507).
- **Stability.** Both variables are internal: they appear in the daemon's forwarded-environment list, not in the user docs.

### 4.5 Could anything headless adopt?

- **Not through any supported path** (**I**, code). Every route into `restoreOnMount` is the interactive REPL.
- **A pretend job worker.** The holder could start the interactive REPL itself in a PTY, with `CLAUDE_CODE_SESSION_KIND=bg` and `CLAUDE_JOB_DIR`, to make it claim the carrier. That process would be outside the daemon's supervision while running bg-session code paths. It would also give PTY plus mod control, not stream-json. Not recommended (**I**).

### 4.6 Session ids

`/background` forks: the job runs under a new session id, whose first 8 hex digits are the job's short id. The parent transcript gets a `continued-in` row (**M**, B). The web client has to follow the new id.

## 5. Recommended handoff procedure for the holder

**Route: hand the session to an engine job first, then to headless once the job's carried work has drained.**

1. **Move the terminal session into a job.**
   - The person types `/background`, or picks "Move to background and exit" when they quit.
   - A mod in the session can run it with `$.command.run({command: "background"})`. It proceeds without a dialog when everything carries. Otherwise the "Background this session?" dialog waits for Enter in the person's terminal; a mod cannot close it.
   - Read the new short id from the banner or `claude agents --json`. The session id is `jobs/<short>/state.json`'s session.
   - Still lost at this step (**M**):
     - monitors;
     - MCP tasks, silently;
     - any agent that is in a foreground command over 2 s, or holds a monitor;
     - the exit status of every carried shell;
     - the progress of the in-flight command, which re-runs.
2. **Drive the job while it drains.**
   - The job is an interactive worker. Its live surfaces are a mod loaded in the worker (mods load in bg workers, per `mod-command-run-probe.md`), the daemon's `control.sock` (`reply`, `subscribe`), and `claude attach`.
   - Watch `jobs/<short>/state.json`. Carried work shows in `fan` and `inFlight.kinds` (**M**: `local_agent`, `local_bash`, `session_cron`).
   - The job has drained when `fan` is empty, `tempo` is `idle`, and `inFlight.kinds` holds nothing but `session_cron`. Crons survive the next step anyway.
3. **Switch to headless.**
   - `claude stop <short>`. Nothing carryable remains, so no carrier is written (**M**, B).
   - Then run `claude -p --resume <job session id> --input-format stream-json --output-format stream-json --verbose` with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` set on this first resume.
   - **M** (B): no notices, the cron is back (`CronList`: `e217109b`), and the session has full SDK control.

What this route costs: until the drain, the web client has job-level control instead of stream-json. Per the earlier probe, `reply` input is queued as prompts, and permission prompts appear in the worker's PTY.

**When the job never drains** (a dev server, a watch), there are two sound options:

- **Stay in the job.** Use this when the long-running shell matters more than stream-json.
- **Stop the job anyway.** The `origin: "exit"` carrier keeps the shells alive and records `pid`, `procStart`, `outputPath` and `toolUseId` (**M**, C). The holder can then read that file (only read it) and supervise those processes itself:
  - tail `outputPath`;
  - poll the pid against `procStart`;
  - when the process exits, send the headless session a user message with the output tail;
  - remove the carrier afterwards, so a later `claude respawn` does not adopt the same shells a second time.

  Costs of this option:
  - The headless session first receives the engine's false "stopped/orphaned" notice for each such shell. The holder's first message has to correct it.
  - The holder now depends on an internal, versioned file. Its schema has gained fields across releases (`frameLive`, `loopWakeFires`, `prefill`).
  - The carried agents in that file need a `SendMessage` from the model to continue (**M**, C).

**Direct route, for comparison** (the current plan): SIGTERM or `/exit` the terminal, then headless `--resume` with the variable.
- Keeps: the conversation, crons, the cut-off turn (re-run), and stopped agents that the model chooses to message.
- Loses: every running shell, monitor and MCP task, plus the completions they owed (**M**, A, E, F, H).

It is the simplest route, and the right one when the session's background work can be restarted.

**Routes to avoid.**
- **SIGKILL the terminal to keep its shells.** Its shells, and its agents' in-flight commands, survive as untracked orphans (**M**, D). The monitors' `tail` processes leak. Resuming an agent duplicates work that is still running. The engine tells the model all of it stopped.
- **Write `adopt.json` ourselves.** As a finding about fragility, not a recommendation:
  - The only reader is the bg-session REPL, so a hand-written carrier would also need a pretend job worker (§4.5).
  - The file lives in `jobs/<short>/`, which the engine's permission checks keep the model's tools from writing.
  - It is validated against an internal schema with identity checks (pid with `procStart`, output-path vetting, ownership confirmation for agents).

  It would break silently on any engine change.

## 6. Code map (2.1.300 → 2.1.307)

| What | 2.1.300 | 2.1.307 |
|---|---|---|
| Carrier reader `readAndConsumeAdoptJson` | `wGr` cli:158705 | `KJr` cli:235662 |
| Its only caller (`restoreOnMount`) | cli:819071 | cli:248227 |
| bg-session gate / job dir | `hc()` cli:977315, `S0()` cli:977318 | `Bd()` cli:468253, `A0()` cli:468256 |
| Carryability | `C9` cli:159362 | cli:236342 |
| Exit handoff gate | `L()` cli:695383 | cli:31426 |
| Headless registers exit cleanup | cli:906031 | cli:984930 |
| Headless interrupted-turn resume | cli:66842, log cli:66872 | log cli:927236 |
| Orphan reconcile | `X_t` cli:239472 | cli:1131636 (agents), 1131739 (shells) |
| Respawn env (`RESUME_INTERRUPTED_TURN`, 3600000) | cli:1148380 | cli:342683 |

## 7. Method

**Isolation.** Each run was a directory `/private/tmp/bg-handoff/<run>/`, set up after `sminos/tests/mods/live-bridge-check.py` and the `cmd-probe` harness:
- a temp `HOME` whose `.claude` is `CLAUDE_CONFIG_DIR`, with trust and onboarding pre-set;
- a git work dir and its own tmux server (`-L bgh-<run>`);
- `env -i` plus a 0600 env file carrying only the gateway keys, `HOME`, `PATH` and a few base variables;
- settings: `daemonColdStart: "transient"`, allow rules for the tools used, haiku at low effort, `CLAUDE_CODE_SUBAGENT_MODEL=haiku`, and `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=10000` (MCP calls background after 10 s);
- the owner's `cachedGrowthBookFeatures`, copied read-only from `~/.claude.json`. Without it, Monitor is gated off in an isolated config. The copy gives the owner's gates: Monitor on, MCP task protocol off;
- a stdio MCP server with a `slow` tool that logs to `<run>/mcp.log`.

Isolated supervisors lived under `/tmp/cc-daemon-501/<sha256(config)[:8]>`. They exited by themselves after their last job stopped, and both roots were gone afterwards. Nothing of the owner's was touched: sessions, `~/.claude/jobs`, `~/.claude/sminos/`, and the daemon under `/tmp/cc-daemon-501/` (empty at the start). The env files were deleted, and no file under `/private/tmp/bg-handoff` holds the token (scanned). Task-output dirs were copied into each run's `out/task-outputs/`, then removed from `/private/tmp/claude-501/`.

**Work started in each full run** (one haiku turn reading `w/task.txt`):
- a background Bash ticker printing a line per second (420, 900 or 600 lines);
- subagent "stepper": 50 sequential `sleep 1.9; date >> stepper.log` calls;
- subagent "sleeper": one foreground 400-s loop appending to `sleeper.log`;
- Monitor `tail -n0 -F w/mon.txt`, fired by appending a line;
- `mcp__probe__slow` for 900 s;
- a `*/30` session cron.

The turn in flight was either a 150-s foreground `for` loop writing `fg.log`, or a reply streaming 1–2000 with no tools. A plain `sleep` is blocked by the engine's foreground-sleep guard.

**Runs.**

| Run | Path | Checked |
|---|---|---|
| A | full work → streaming turn → `/exit` → "Exit and stop tasks" → headless `--resume` with the variable → `SendMessage` to the sleeper → `CronList` | processes, transcript tail, debug log, stream events |
| B | full work → fg loop in flight → `/background` → job ran ~23 min → drained → `claude stop` → headless `--resume` | carrier capture, pids, job transcript, `state.json`, `MON-EVENT` grep, `CronList` |
| C | full work (900 ticks) → fg loop → `/background` → `claude stop` mid fg loop → headless with the variable (h1) → `SendMessage` to the stepper → headless with `CLAUDE_JOB_DIR` + `SESSION_KIND=bg` (h2) → `claude respawn` | exit carrier, carrier untouched after h1/h2, claim by the respawned worker, completion at the ticker's end |
| D | full work → streaming turn → SIGKILL → headless with the variable | orphan pids, ppid and pgid, monitor fd, `MON-EVENT-D` not delivered |
| E | full work → streaming turn → SIGTERM → headless without the variable, then with it | survivors, the sealing row |
| F, H | streaming turn → SIGTERM (F) or `/exit` (H) → headless with the variable | auto-resume |
| G | ticker + Monitor → SIGHUP | survivors |

**Files** (`/private/tmp/bg-handoff/`):
- scripts: `hb.py` (isolation), `scen.py` (setup and snapshots), `hl.py` (headless driver), `mini.py` (interrupted-turn runs), `watch_adopt.py` (carrier capture), `mcp_slow_server.py`;
- per run: `out/run.log`, `out/notes.jsonl` (snapshots), `out/h*.jsonl` (stream-json, time-stamped), `debug-*.txt`, `out/adopt-copies/`, transcripts under `home/.claude/projects/`, and job records under `home/.claude/jobs/`.

**Spend.** Haiku only: about 25 short main turns, three 50-step stepper agents, and four 2000-number replies.

**Not run** (all **I**):
- WebSocket monitors (a private-address target is refused, and an external endpoint was out of scope);
- remote MCP servers and the MCP task protocol (gated off);
- workflows;
- loop wakes;
- queued-prompt carry;
- a job worker crash (SIGKILL), which the daemon respawns with the variable set.

**Scripts kept.** The scripts are copied into `bg-handoff/` beside this note; the raw runs stayed in `/private/tmp/bg-handoff/` and are not kept.
