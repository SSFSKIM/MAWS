# "Forget after this point" through a compaction hook (measured)

Ran on **Claude Code 2.1.310**, the build installed on this Mac (`/Users/new/.local/share/claude/versions/2.1.310`), on 2026-10-25 local time (10-26 UTC). Wave 2, item 2, of [desk-build-request-mod-surface.md](desk-build-request-mod-surface.md), testing [mod-control-surface.md §3.4](mod-control-surface.md#L149) and §7 item 2. Engine line references are to the [2.1.310 reprint](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js).

**M** = measured (an observed result plus an independent check of the effect). **I** = inferred from source, or a recommendation, not run.

There were 14 isolated runs and 104 recorded stub requests, with zero inference spend. The probe ran as an astra subagent of `remote-architecture`, which wrote this note from its hand-back.

## What it comes to

- **M** The bridge cannot rely on its own `session.compact` hook. A direct `$.session.compact` from the bridge's real origin (the stdout loop of a session-lifetime child) skipped that plugin's compact hook and ran the summarizer. The debug log says so: `session.compact skipped: re-entry (the plugin's own code raised it; origin trunc-caller)`.
- **M** Two routes do intercept, with no summarizer request:
  - a separately named plugin's compact hook, on the bridge's direct `$.session.compact` (it sees `trigger: 'plugin'`);
  - the bridge's own hook, when the bridge queues `$.command.run({command:'compact', args})` (it sees `trigger: 'manual'`).
- **M** The active context is cut correctly at once. **Resume breaks it.** After `--resume`, every kept assistant text and thinking block appears twice. A cut inside a multi-block assistant reply brings the excluded text back. A cut between a tool call and its result brings the excluded tool result back.
- **I** So on 2.1.310 this is **blocked**, not a desk feature. Don't ship it as rewind, "forget everything after here", or a reliable trim. The fix has to come upstream: an engine fix to resume reconstruction, or a supported context-cut API. Allowing cuts only at completed turns avoids the resurrection, but not the duplication.

## Results

### Call origin

**M**, run `origin`, all three routes driven from the child's stdout loop:

| Route | Hook that ran | Summarizer requests | Outcome |
|---|---|---:|---|
| Bridge → `$.session.compact`, bridge's own prefix hook | own hook skipped | 1 | ordinary summarization |
| Bridge → `$.command.run` `/compact`, bridge's own prefix hook | own hook, `trigger: manual` | 0 | prefix replacement |
| Bridge → `$.session.compact`, a distinct guard plugin's hook | guard hook, `trigger: plugin` | 0 | prefix replacement |

The second component that worked had **its own plugin identity**. A different file in the same plugin was not tested.

**I**, why:
- [Origin construction, L229934–229946](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L229934) adds a registration frame only when there is a live dispatch and registration, so a detached call gets the plugin-wide origin.
- [Selection, L670965–670977](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L670965) excludes that plugin's registrations on re-entry.
- [Direct compaction, L153921–153932](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L153921) passes the origin through to hook selection ([L176637–176649](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L176637)).
- The slash route behaves differently:
  - the command is queued with its origin for the outer `command.run` dispatch ([L229599](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L229599), [L266738](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L266738));
  - the local-command invocation passes `submissionOrigin` ([L1047904](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1047904));
  - `/compact` then compacts from that execution context ([L585710](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L585710)).

  On the measured route, that did not exclude the calling plugin's hook. This is one route's measurement, not a rule that command origin is always dropped.

### Active, visible and saved context

**M**, run `basic`. The turns were `KEEP_ALPHA`, `DROP_BETA` and `DROP_GAMMA`, and the hook kept the first two rows.
- **Active.** The next conversation request ([basic-request-006.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/basic-request-006.json)) holds `KEEP_ALPHA`, its original reply and `NEXT_AFTER_CUT`. Neither dropped marker is there, and there was no summarizer request.
  - A title-generation request came first, so the next HTTP request is not necessarily the next conversation request.
- **Visible.** The fullscreen TUI still shows the dropped rows ([basic-pane-after.txt](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/basic-pane-after.txt)).
  - `$.session.messages()` also still returns them, beside the new prefix: its count went from 6 to 8, not down to 2.
  - Its row count is no evidence of truncation.
- **Saved.** The JSONL keeps the whole old history and appends the replacement under a compact boundary ([basic-transcript.jsonl](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/basic-transcript.jsonl)).
  - The boundary has `parentUuid: null`, and its `logicalParentUuid` points at the old tail.
  - The replacement rows have new UUIDs, but the kept assistant row keeps its API `message.id` (`msg_stub_1`).
  - Every non-null parent link resolves.

**I**, source:
- [handle lookup, L176589–176621](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L176589);
- [UUIDs reminted, API message ids kept, L176633–176636](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L176633);
- [fullscreen keeps rows, L1202843–1202868](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L1202843).

### Resume (the blocking finding)

**M**, both working routes, in fresh runs. I spot-checked each count below against the kept request bodies.

| Run | Before resume | First request after `--resume` |
|---|---|---|
| `resume-guard` (distinct plugin) | `RETAIN_ASSISTANT` ×1, `PRESERVE_THINKING` ×1 ([005](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-guard-request-005.json)) | ×2 and ×2 ([006](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-guard-request-006.json)) |
| `resume-self` (queued `/compact`) | ×1, ×1 ([005](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-self-request-005.json)) | ×2, ×2 ([006](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-self-request-006.json)) |
| `resume-partial`: the cut keeps the first user row and the thinking block, and drops `SHOULD_BE_CUT_ASSISTANT_TEXT` from the same reply | absent ([005](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-partial-request-005.json)) | **present** ([006](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-partial-request-006.json)) |
| `resume-pair`: the cut falls between a tool call and its result `SHOULD_BE_CUT_TOOL_RESULT` | absent; a synthetic `[Tool result missing due to internal error]` instead ([006](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-pair-request-006.json)) | **the original result is back** ([007](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/resume-pair-request-007.json)) |

The later *user turns* stay excluded after resume, as `basic` shows ([basic-request-007.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/basic-request-007.json)). The damage is to assistant blocks and tool results.

**I**, why:
- Building the parent chain calls sibling recovery after walking the chain ([L142440–142460](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L142440)).
- That recovery indexes **every assistant row in the transcript by `message.id`**. It then brings back missing siblings and their tool results ([L142635](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L142635), [L142700–142746](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L142700)).
- Reminted UUIDs with unchanged API ids make the old and new rows look like fragments of one reply.
- The outbound normalizer then merges same-id assistant blocks by concatenation ([L263680](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L263680), [L263822](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L263822)).

### Hooks

- **M** A replacement without `next` skips `PreCompact`. It then runs, in this order:
  1. `classic.PostCompact`, with `trigger:'manual'` and `compact_summary:''`;
  2. `classic.SessionStart`, with `source:'compact'`.

  This holds even for the distinct-plugin route, where the mod hook saw `trigger:'plugin'`. The payloads are in [evidence.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/evidence.json).
- **M** The mod's `session.start` event does **not** fire again.
- **M** Ordinary `/compact` (mod trigger `manual`) and autocompact (`auto`) passed through both prefix hooks. Each hook called `next` when no cut marker matched, and each run reached the stub's summarizer.
  - Ordinary compaction runs PreCompact → SessionStart(compact) → PostCompact, a different order from the replacement's.
- **I**, source: [replacement, L196059–196085](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L196059); [core wrapper, L585737–585776](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L585737).

### Tasks, queued input, read state, typing

- **M** **Background Bash survives.** A canned `run_in_background` Bash started an owned process. It was alive before and after the replacement, and it later wrote its completion marker. Files are not rolled back.
- **M** **Read state.** The replacement clears read state. A later Edit still succeeded, with `contentNotInModelContext:true`; it was not refused. The clearing is explicit at L196063 (**I**).
- **M** **A busy turn.** Direct `session.compact` refuses with a running-turn error. It never cut beneath an in-flight response.
- **M** **Queued input.** A queued `/compact` waits behind input already queued, and leaves it in place. A local `QUEUED_WHILE_BUSY` prompt entered before the remote `/compact` ran and got its reply first. A cut chosen before that point is then stale.
- **M** **Drafts survive.** The guard hook was held for 1.2 s. Meanwhile, `DRAFT_BEFORE` in the composer was extended by typing to `DRAFT_BEFORE_TYPED_DURING_CUT`. It stayed visible and was sent intact by Enter ([typing-pane-after.txt](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/typing-pane-after.txt), [typing-request-005.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/typing-request-005.json)).

### Bounds and original blocks

- **M** **An empty prefix fails open.** `{messages:[]}` made the engine skip the hook and run ordinary summarization, and the command resolved as a success. The debug log says: "returned the wrong shape (an empty messages (a compaction leaves at least one)) … what is below it ran in its place".
  - To refuse, validate first and return `{skip: reason}` (**I**).
- **M** **Keeping only the first message works.** The next request held it and the new prompt. Consecutive user content is merged in the outbound body.
- **M** **A cut mid tool pair is accepted, then repaired.** The kept tool call gets a synthetic `is_error:true` result, and resume brings back the original (above). Reject such cuts.
- **M** **Kept image and thinking blocks survive** byte for byte in the active request. This was checked by SHA-256 of the canonical blocks before and after ([media-request-004.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/media-request-004.json) vs [media-request-006.json](/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike/requests/media-request-006.json)).
  - The thinking signatures were canned, so whether a real provider accepts the rewritten thinking history is not established (**I**).

## What contradicts or narrows the inventory

1. **M** The self-reentry warning was right: the bridge's direct call cannot use its own compact hook. Both alternatives are now measured, and the queued `/compact` route needs no second plugin.
2. **M** "Original blocks are preserved" holds for the active request, **not for a resumed conversation**. The inventory missed the sibling-recovery interaction. Gap C moves from "candidate" to "blocked on 2.1.310".
3. **M** "An empty prefix is invalid" is right, but the hook's invalid output falls through to summarization instead of failing closed.
4. **M** "Session-start hooks run" means `classic.SessionStart`, not the mod's `session.start`.
5. **M** Clearing read state did not make the next Edit fail.

## Recommendation

- **I** **Keep this as a blocked experiment.** Ask Anthropic for one of two things:
  - an engine fix, so that sibling recovery does not join rows across a replacement boundary by the same API id;
  - a supported atomic context cut or checkpoint API.

  Meanwhile, don't rewrite a live JSONL, and don't import engine internals. Stripping the handles would rebuild flattened public rows, and that would lose image and thinking blocks; this alternative was not measured.
- **I** **Once resume is safe,** prefer the distinct-origin guard plugin plus direct `session.compact`. It refuses predictably while busy and returns a structured result. Queued `/compact` works from the same plugin, but it brings queue ordering, command rows and stale cuts.
- **I** **The request needs these parts:**
  - a one-shot nonce, the session id, the expected tail or revision, and a completed-turn prefix;
  - the hook consumes only that exact pending request;
  - it rejects empty prefixes, stale tails and split assistant/tool groups with `{skip}`;
  - every ordinary manual, auto or precompute compaction calls `next`.

  Fence foreground work, queued input and background tasks explicitly, because compaction cleans up none of them. Re-read the transcript afterwards, because the UUIDs changed and the visible rows include inactive history. Leave the composer alone.
- **I** **An honest name, if it ships:** "Trim active context after this point". Say that files, background work and the saved transcript stay. Don't call it rewind or undo, and don't promise deletion.

## Method

- **M** **Isolation.** Each run used `/private/tmp/wave2-trunc/<run>`, with:
  - its own HOME, CLAUDE_CONFIG_DIR, git work dir and plugin dirs;
  - `tmux -L wave2-trunc-<run> -f /dev/null`;
  - an `env -i` launch, with a dummy key and a local `ANTHROPIC_BASE_URL`;
  - function hooks on; the updater, telemetry, error reporting and nonessential traffic off;
  - `daemonColdStart:'transient'`.

  Nothing of the owner's (sessions, plugin cache, jobs, sminos state, daemon, launchd label) was touched. [cleanup.json](trunc-spike/cleanup.json) records that no process, tmux server, daemon socket or env file was left.
- **M** **The mod** reproduces bridge.tsx's chain: `session.start` → `$.process.spawn` → an unawaited `for await` over the child's stdout → `void runCommand($, …)`. It does not run the real sminos child.
- **Scripts** are in [trunc-spike/](trunc-spike/):
  - `harness.py`: the recording SSE stub and the tmux driver;
  - `origin.py`, `measure.py`, `effects.py`, `followup.py`, `resume-cut-edge.py` and `typing.py`: the scenarios;
  - `audit.py`: rechecks the request bodies;
  - `register.ts`, `guard.ts` and `child.py`: the mods and the child.
- **Evidence.** The assertions and hook payloads are in `evidence.json`. The cited request bodies, panes and the `basic` transcript are copied into `trunc-spike/requests/`. Everything else raw is under `/private/tmp/wave2-trunc/`, which is not kept.
- **Harness lessons** (logged in MAWS #92):
  - Offline interactive runs send title-generation requests between conversation requests, so classify each request before handing it a canned answer.
  - `/autocompact` accepts only 100k–1M. Autocompaction was triggered instead with a canned 999000-input-token usage.
