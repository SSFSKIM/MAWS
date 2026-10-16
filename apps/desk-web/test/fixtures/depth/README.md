# The depth column's recorded session

One throwaway `claude -p` session (Claude Code 2.1.300, 2026-10-15), run in a scratch directory outside every
repository with two small files in it, function hooks and the bridge off, and asked to think, start two background
`general-purpose` subagents in parallel (each reads one file with `Read` and hands back), and then answer. It is the
DC6 plan's fixture (Decision Log, "The double's fixture") until DC3's fake machine and its recording replace it.

- `session.jsonl` — the main transcript's rows, oldest first.
- `subagents/agent-<id>.jsonl`, `subagents/agent-<id>.meta.json` — each subagent's rows and its meta, as the engine
  wrote them beside the transcript.

What it covers: a response of two `tool_use` blocks (the two `Agent` calls, one API message, two rows), a response of
a `thinking` block and a `text` block, plain text responses, one wrapped in `<message>` (the to-human output style),
tool results, subagent hand-backs and task notifications as user rows, hook attachments, and stop-hook system rows.

Scrubbed before commit: the engine's request bookkeeping rows (`api-request*`, `atis-latch`, `last-prompt`,
`cost-state`, `queue-operation`) and the attachments that carry the machine's environment (instructions, skill and
agent listings, system-prompt snapshots, the output style's text, deferred tool lists, the environment block) are
dropped, with `parentUuid` re-chained past each; paths become `/work/demo`, hook commands `hook-<n>`, request ids
`req_scrubbed`, the thinking signature `scrubbed`. The recorded thinking block came back with its text omitted
(`thinkingDisplay: "omitted"`, `thinking: ""`); a one-sentence stand-in replaces the empty text so a thinking block has
something to stream and settle.

The live part is not recorded: `test/double/session-stream.ts` synthesizes it from these rows.
