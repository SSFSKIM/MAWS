# The question sheet's recorded session (C3's live check)

One terminal session of Claude Code 2.1.332 (2026-11-27), recorded by the question sheet's live check
(`e2e/sheet-live.rig.ts`; `docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md`, M6) in a scratch project:
the doperpowers checkout's sminos plugin at C2's merge, function hooks and `SMINOS_QUESTION_SHEET` on, C2's stand-in
surface running, the model haiku. The words of the questions and replies are the model's; the answers were given in MAWS.

- `session.jsonl` — the main transcript's rows, oldest first. No subagent ran.

What it covers: a call of three questions (one with two options and a recommendation, one referencing README.md, one
with no options) answered by one Send and delivered by the plugin's prompt; a call of two, the first withdrawn by a
later call; the second answered while the session was stopped, one answer taken back and another sent, delivered with
the resumed session's next prompt in its added context; a call of one, answered from two windows, the first line taken
and the second refused.

Scrubbed before commit, as `test/fixtures/lane-a/README.md` describes: the engine's request bookkeeping rows
(`api-request*`, `atis-latch`, `last-prompt`, `cost-state`, `queue-operation`, `file-history-snapshot`) and the
attachments that carry the machine's environment (instructions, skill, agent and tool listings, prompt snapshots, the
environment, model, date and session context, token reminders) are dropped, with `parentUuid` re-chained past each;
the project's path becomes `/work/demo` and the rest of the scratch `/work/scratch`; hook commands `hook-<n>`, request
ids and references `req_scrubbed`, signatures `scrubbed`.
