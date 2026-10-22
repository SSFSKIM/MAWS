# Reaping signals in the interactive TUI: SIGTERM, and where a turn can be held

Written from the spike agent's hand-back, 2026-10-22. It settles two unknowns in [session-holder-design.ko.md](session-holder-design.ko.md) §9: whether SIGTERM is an acceptable way to end an idle session, and whether a mod can fence every turn start.

**Labels.** **M** = measured in this spike. **R** = read from code, not run.

- **Binary (M):** Claude Code **2.1.308**, the interactive TUI under a PTY the probe owned directly (not `-p`).
- **Code references (R):** the **2.1.307** reprint, [cli.pretty.js](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js). They are not a claim about 2.1.308's source.

## Bottom line

1. **SIGTERM ends an idle session gracefully and promptly.** It runs SessionEnd, restores the terminal, persists the conversation, and exits within about a second. It does so even with a panel or dialog open. It also skips the confirmation `/exit` shows for running background work. So the confirmation cannot catch a wrong verified-empty; that responsibility is entirely the work-state sensor's.
2. **The prompt hooks cannot be the fence.** `prompt.submit` and the classic UserPromptSubmit hook miss two kinds of turn start:
   - a turn started when a `!` shell command finishes;
   - a prompt accepted into the queue before the fence armed, which is not screened again when it is dequeued.
3. **`turn.start` cannot be the fence either.** It is observational: the model request went out about 40 ms into a 6-second hook.
4. **`turn.step` can be the fence.** An async-generator hook held a turn for 3 s and stopped it before the main model request. That included the `!`-mode turn the prompt hooks missed. Two caveats:
   - A refusal at that point is a consumed turn. The prompt is already in the transcript, and the refusal appears as the assistant's reply.
   - The engine falls back to the model if the streaming chain fails before the request, so the gate fails open unless the holder treats bridge health as part of the fence.

## 1. SIGTERM versus `/exit` (M)

| Case | SessionEnd reason | Exit code | Time to exit | Result |
|---|---|---:|---:|---|
| SIGTERM, background Bash running | `other` | 143 | 1.043 s | Shell received TERM and was gone |
| `/exit`, background Bash running, confirmed | `prompt_input_exit` | 0 | 1.318 s (including the confirmation) | Shell received TERM and was gone |
| SIGTERM, `/usage` panel open | `other` | 143 | 0.993 s | Exited without closing the panel first |
| SIGTERM, Bash permission dialog open | `other` | 143 | 1.015 s | Exited; the proposed command never ran |
| `/exit`, empty session | `prompt_input_exit` | 0 | 1.248 s | Exited directly |
| SIGTERM, completed conversation | `other` | 143 | 0.865 s | Final assistant text and persistence rows present |
| `/exit`, completed conversation | `prompt_input_exit` | 0 | 1.225 s | Same persistence outcome |

- **Hooks and confirmation.**
  - Both the classic SessionEnd hook and the mod `session.end` event ran on both paths.
  - `/exit` with background work opens "Background work is running / Exit and stop tasks / Stay"; SIGTERM skips it.
  - SIGTERM sent while that confirmation was open also exited normally, through the SIGTERM path.
- **Terminal.** The controlling shell's `stty -g` matched before launch and after exit in every completed comparison. The raw PTY captures contain the mode-cleanup sequences. Populated conversations printed the resume command on both paths.
- **Transcript.**
  - Both real-response transcripts were valid, newline-terminated JSONL with the final assistant response, last-prompt and mode rows, and the final `cost-state` rows.
  - A zero-inference check snapshotted `$.session.messages()` just before each exit, and every user and assistant message in it was persisted.
  - JSONL has no "closed" row, so the evidence is completed writes plus process exit. This does not cover disk failure, hung hooks, or a kill mid-generation.

**Why (R):**
- [L998456](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L998456): interactive SIGTERM calls `shutdown(143)`.
- [L998676](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L998676)–998727: `shutdown` defaults its reason to `other`. It restores the terminal, drains cleanup, stops shells and runs SessionEnd.
- [L997875](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L997875)–997882: shell cleanup kills registered running commands.
- [L1001304](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1001304)–1001327: session-storage exit drain and flush, with a warning if the transcript writer is degraded.
- [L286088](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L286088) and [L286508](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L286508)–286510: the background-work confirmation and the `prompt_input_exit` path.
- Shutdown has bounded cleanup and failsafe timers, so "graceful" does not mean unlimited durability under broken I/O.

## 2. Which surfaces see a turn start (M unless marked)

| Origin | Mod `prompt.submit` | Classic UserPromptSubmit |
|---|---|---|
| Typed prompt, idle | yes, `origin.kind = composer` | yes, when the mod calls `next` |
| Another mod's injected prompt | yes, `plugin`, with the plugin name | yes |
| **The same mod's own injected prompt** | **no: a mod's hook is skipped for its own prompts (re-entry guard)** | yes |
| CronCreate one-shot fire | yes, `scheduled-trigger`, `isMeta: true` | yes |
| ScheduleWakeup fire | yes, `scheduled-trigger`, `isMeta: true` | yes |
| Background Bash completion while idle | yes, `task-notification` | yes |
| Prompt typed during a running turn | yes at submission, `composer`, with the running `turnId` | yes, when passed |
| **Prompt accepted before the fence armed, dequeued later** | **not screened again** | **not screened again** |
| **`!` shell-mode completion that starts a model turn** | **no** | **no** |

- **`source` is absent.** No classic hook input carried a `source` field. The d.ts marks it optional, and the engine's input constructors omit it ([L1084687](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L1084687)–1084695). Nothing should depend on it.
- **Why the queue is not screened again (R).** A queued prompt reuses its screening result unless the hook configuration changed ([L560999](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L560999)–561016). An external fence flag is not a configuration change.
- **Why `!` mode is missed (R).** Bash mode and several other input shapes bypass the prompt-hook path ([L561079](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L561079) onward).
- **Not run (R).** SDK input uses the same processor ([L929577](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L929577)). SDK, Remote Control, peer and channel origins share it, along with its bypasses. `/loop` itself was not invoked; its two firing mechanisms, CronCreate and ScheduleWakeup, were.

### Holding and refusing at the prompt hooks (M)

`prompt.submit` can await and then decide: a typed refusal took 3.004 s and an injected one 3.001 s. A classic command hook can also hold for 3 s before blocking; mod plus classic held about 6.1–6.5 s with no model turn.

What a refusal looks like to whoever sent the prompt:
- **Typed prompt (idle or busy):** a visible refusal notice, and the text goes back into the composer.
- **A mod sending a prompt:** its promise resolves with `{drop: "<reason>"}` and does not reject. Nothing is requeued.
- **A classic-hook block:** reaches the sending mod as `{drop: "UserPromptSubmit operation blocked by hook: ..."}`.
- **A scheduled fire or task notification:** the refusal is shown, but there is no draft to restore. The tested one-shot schedule fired and deleted itself, so blocking does not retry it later.

### `turn.start` does not block (M, R)

A `turn.start` hook waited 6 s; the first main-model request began about 40 ms after it was entered. The engine consults the turn-start latch only when a `turn.step` hook is installed ([L405531](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L405531)–405535), and then waits at most 3 s ([L405881](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L405881)–405895). The types call `turn.start` observational.

### `turn.step` holds the model request (M)

- **Refusing.** An async-generator `turn.step` hook held for 3 s. It then yielded a refusal instead of calling `next`. That stopped both the `!`-mode turn the prompt hooks missed and an ordinary mod-submitted turn, and neither made a main-thread API request.
- **Passing.** In a pass test, `yield* next(e)` after 3.001 s led to the main request 14 ms later.
- **Caveats:**
  - **It refuses the model call, not the prompt.** By the time it runs, the sender has received success and the prompt is in the transcript. A refusal becomes the assistant's reply and is not requeued.
  - **It knows nothing of where the prompt came from.** `turn.step` carries `turnId`, the step index and the model, not the origin. Keep `prompt.submit` for that and for an early, friendly refusal.
  - **It fails open (R).** If the streaming chain fails before the request, the engine goes to the model anyway ([L405905](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L405905)–405910).
  - **It gates only the main loop.** Auxiliary title and suggestion requests are outside it. They were still attempted in the loopback runs. They start no tools, but this is not a barrier for all engine work.

## Method and limits

- **Isolation.** Temporary HOME, config and trusted work directories, with `daemonColdStart: transient`. No tmux: the probe owned its PTYs and never attached to the owner's terminals.
  - Credential env files were mode 0600 and were deleted afterwards. An exact-token scan found no credential in the retained captures.
  - Every recorded Claude pid exited. No owner session, job, sminos state or daemon was touched.
- **Model spend.** The cap was three short turns; the spike made **four**, for eight gateway requests, all pinned to `claude-haiku-5-5[1m]`. The CLI reported a total of **$0.0077**.
  - Two turns came from setup mistakes: the probe's own blocker was skipped by the re-entry guard, and a second plugin path was parsed as a positional prompt.
  - Two came from `!`-mode completions that started model turns, which is how that gap was found.
  - After that, probes pointed the endpoint at a closed loopback port with a dummy token: 23 failed request attempts, no inference.
  - The per-request log is in `reap-spike/audit.json`.
- **Files.** Scripts are kept in `reap-spike/` beside this note: the harness, the fence mod in `guard/`, the injecting mod in `plugin/`, and `audit.json`. Raw captures stayed in `/private/tmp/reap-spike/`. The scripts expect that scratch layout and are not runnable as-is.
