# Build request: widen the bridge mod's control surface for terminal sessions

**Status: sent and answered 2026-10-25.** The orchestrator folded it into the desk control-surface spec (MAWS #150, merged at `7649bf30c`), with media as MW5, forget recorded as blocked on 2.1.310, and the shared shapes from [lane-b-control-map.md](lane-b-control-map.md) as its Interfaces. Addressed to the `desk-sminos-orchestrator` session (doperpowers project), which builds the desk (MAWS desk-hub and desk-web) and the sminos bridge mod. From `remote-architecture` [3502a215] (MAWS #52 research, PR #79), written 2026-10-24.

## Why

The owner decided on 2026-10-24 (F7 in the holder design) how sessions a person starts in a terminal are handled. The plain interactive `claude` process stays as it is, and it is controlled remotely **only through the bridge mod**. There is no web terminal pane, no PTY key injection, and no migration to `claude -p`. The owner accepts what that cannot reach, and wants the mod-side control surface made **as broad as possible** instead.

The evidence base is an inventory read from the Claude Code 2.1.309 code: [mod-control-surface.md](mod-control-surface.md) (also `research/desk-remote/mod-control-surface.md` in MAWS PR #79). For each TUI operation it gives the broadest in-process mod path, what the bridge exposes today, the dialog census, and the gaps. Read it before planning. Its §3 tables are the work list, and its §2 describes the bridge as it stands (sminos 1.8.1 at doperpowers `74e19630`).

Context, if needed:
- [session-holder-design.ko.md](session-holder-design.ko.md) §0, §3.4, §3.5 and §7 for the two-lane decision.
- [mod-command-run-probe.md](mod-command-run-probe.md) for measured `$.command.run` behaviour.

## Owner's priorities

- **Not wanted:** plan-mode controls. Drop the inventory's plan items, including leaving plan mode, the mode-setting carriers and bare `/plan`.
- **Wanted, potentially useful:** sending an image or PDF into the session, and something like rewind. Both need a spike first (wave 2).

## Wave 1: reachable now through public mod APIs, no spike needed

Each item names the inventory row it comes from. The web gets typed controls for the operation's *effect*. It never opens the terminal panel remotely.

1. **Settings view and edits** (inventory §3.3, "View/edit settings panel").
   - `config.list` drives a web settings view showing rows, kinds, options and locks.
   - Writes go through `config.set` and are labelled with what they persist. The bridge withholds persistent writes today on purpose. Expose them with that disclosure rather than silently.
   - Never ship raw `settings.read` output to the web: it contains env and helper secrets.
2. **On-demand usage read** (§3.5). Serve `session.usage()` on request, not only at turn end. The `'full'` breakdown calls the token-count API, so it is not free; offer the summary by default.
3. **Richer permission answers** (§3.3).
   - Deny with a message.
   - Approve and remember narrow rules: `updatedPermissions` with an explicit destination, and the UI says when a rule persists to future sessions.
   - Add a workspace directory through a permission update instead of `/add-dir`'s dialog.
   - Today the hub and bridge carry only allow/deny and question answers. Keep the bridge's existing guard against general `updatedInput` on ordinary asks.
4. **Side questions** (§3.2, `/btw`). Use `$.model.fork({prompt})`: a tool-less completion over the main loop's cached context, with no panel or queue. It costs tokens, and it returns `nothing-to-fork` before the first request or after a clear.
5. **MCP controls** (§3.5).
   - Broaden enable/disable/reconnect to the engine's real grammar: `all`, a missing target meaning all, and server names with spaces.
   - Show server state only as a clearly labelled partial view. No public API gives exact connection or auth status.
6. **Subagent transcripts** (§3.1). `agent.list` plus `session.messages({agentId})`, so the web can open a subagent's own transcript.
7. **Compact with instructions** (§3.4). The bridge supports it internally; the hub RPC and web widget don't pass the instructions yet.
8. **Model switch without the warm-cache dialog** (§3.3). This is optional; take it if a persistent model change is wanted from the web. `config.set({key:'model'})` writes the default without `/model`'s "Switch model?" dialog. The bridge's existing `turn.step` override stays the session-only choice.

Already reachable but held by your own milestones: `/clear`, `/branch`, `/resume <id>`, `/fork`. Their blocker is following the session-id change (§3.4), not the mod API.

## Wave 2: spike first, then build if the spike holds

Use isolated sessions and storage, never the owner's live sessions or daemon. Where you can, point the model endpoint at a closed or fake one so no inference is spent. The inventory's §7 items 2 and 3 give the measurement lists.

1. **Image and PDF intake.** The `@path` route is closed in 2.1.309, because plugin-origin prompts skip attachment expansion.
   - The candidate: the bridge saves the uploaded file, and its `turn.step` hook yields a synthetic native Read tool call (streamed `tool` and input chunks plus a `tool_use` stop) before the next model request. The tool result then carries the media.
   - It must show in the transcript as a bridge-requested action, not as the model's choice.
   - Measure:
     - whether the next outbound request really holds image and document blocks;
     - permissions, duplicates and re-entry;
     - mid-turn timing;
     - Esc during the step.
2. **"Forget everything after this point"** (rewind-like).
   - The candidate: a `session.compact` hook returns a chosen original-message prefix without calling the summarizer.
   - This is context truncation, **not rewind**. Message UUIDs change, a compact boundary is added, post-compact and session-start hooks run, and files are not rolled back. Name the feature accordingly.
   - Measure:
     - active versus visible versus resumed context;
     - side effects on tasks and queues;
     - the empty-prefix and first-message bounds;
     - races with local typing.

Both rely on the bridge intercepting through its own hooks. Self-reentry rules can skip the bridge's own hook for calls it makes itself (inventory §3.4, last paragraph). Measure the actual call origin first.

## Out of scope

- **Plan-mode controls.** The owner doesn't need them.
- **Closed through the supported mod surface.** Ask Anthropic for an API instead of working around these:
  - general engine dialogs (48 native kinds, census in §4);
  - native rewind with file rollback;
  - consent-only approvals;
  - resuming after the person's Esc latch;
  - exact MCP status and OAuth.

  Don't forge person-origin input, disable the Esc refusal, or depend on engine internals for these.
- **MCP elicitation through a mod.** The mod result codec has no `action` or `content` (§4.3), so a mod can't answer it. Only classic command hooks can.
- **Anything that moves or wraps the terminal process.** That means PTY holders, a web terminal, `/background` as a remote control path, or migration.

## What we'd like back

- Your plan and milestones for wave 1, including what you would cut or reorder and why.
- For wave 2: whether you'll run the spikes or want this session to run them. This session has the inventory context and can run them on request.
- Anything in the inventory you find wrong against the bridge source. It was read from code, not run.
