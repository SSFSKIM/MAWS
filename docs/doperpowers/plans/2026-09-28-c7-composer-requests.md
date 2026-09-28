# C7 — Composer and requests

Child of the composite spec `docs/charter.md`, child id **C7**, parent pin `fa064f66f862afec8b2a2e4684369f0f235a8de3`. Design lives in the charter: the C7 section in §12, §5.4 (composer and strip), §5.5 (status line), §5.7 (attention: Enter and Esc bind to the focused pane), §4.2 "further engine semantics" (queue ownership, plan outcomes, `!` and `#`, edit-and-resubmit forks), D-13, D-17, D-18, D-19, contract X4 (owned here) and X1, X2, X3, X6 (consumed), the binding grades in §11, and the Decision Log §19. The concrete shapes this document codes against are on master (C1: `src/shared/`) and in the reviewed execution documents of C3 (`docs/doperpowers/plans/2026-09-28-c3-engine-host.md`), C5 (`…-c5-shell.md`) and C6 (`…-c6-transcript.md`), reconciled in `docs/doperpowers/plans/2026-09-28-wave2-interface-ledger.md`. C7 executes after C3 and C6 have merged to master (§14, wave 3), in its own worktree branched from that point. This document carries the constraints, the interfaces C7 adds, the milestones with their gates, the residue decisions to be pasted into the charter's C7 section, and the record.

## Purpose

After C7 the owner talks to a session. Under the transcript sits a real editor: type, paste a screenshot or a page of logs, drop a file, mention `@src/main.ts` or `@agent-Explore`, type `/` and pick a command from the engine's own catalogue, and press Enter; while the engine works the same control reads Queue (the message waits, survives a process exit, and goes when the turn ends), ⌥Enter steers it into the running turn, ⌘. stops, and after an interrupt Resume releases the queue. The queued list above the editor edits, deletes and promotes entries. `!ls` runs a shell command through the engine and the model sees its output; `#remember this` appends to the memory file you chose. ArrowUp on an empty editor recalls what you sent, in this session and then across sessions and the terminal. When the engine needs the human, the editor gives way to one card, the same card that appears inline in the transcript, on an Overview card and in a Needs-you hover: a permission with its exact command and the grant scopes the engine will honour, a question form, a plan with its three outcomes, an MCP elicitation form, a dialog. Enter and Esc answer it, but only in the pane that holds focus. Under it the status line shows cwd, context, the account's 5h and 7d windows read from ClaudeUsage's own files, cost and mode, each with a popover, and a near-limit banner appears once per window, not once per composer.

What C7 does not do: launch or resume sessions (C10; a dev-only resume affordance exists for acceptance), render the transcript (C6), build the palette widgets behind `/model` and kin or the accounts and settings screens (C11), fork a session from an edited message (C10 supplies the provider; C7 supplies the seam and the explicit-rewind alternative), or write anything into `~/.claude` (D-12, §4.3).

## Progress

- [ ] M1 — Contracts and services: X2 additions, X1 additive fields, keymap entries, main-side usage reader, prompt history, file search, file picker, engine-host catalogue
- [ ] M2 — Request card (X4): five variants, four placements, answers, keyboard, delivery states, slot registration
- [ ] M3 — Editor: Tiptap document model, attachments, paste and drop, `@` menu, `/` palette shell, drafts, history, `!` and `#` modes
- [ ] M4 — Composer surface: context strip, submit control, queue list, docked card, edit-and-resubmit, slot registration
- [ ] M5 — Status line popovers, usage windows, direct-session fallback, near-limit banner
- [ ] M6 — Live acceptance with C3 and the mockup checklist

## Terms

- **Composer**: everything C7 renders in C5's `composer` slot: the context strip above the editor, the editor, the attachment strip, the queue list, the submit control and the mode chrome. **Status line**: C5's container under it (`src/renderer/src/session/StatusLine.tsx`), whose six buttons C7 gives popovers.
- **Editor**: the Tiptap instance. **Document** or **doc**: its ProseMirror document, serialised as Tiptap JSON (`editor.getJSON()`); the shape C4's `Draft.doc` stores. **Atom**: an inline node the cursor treats as one character (a mention chip, a pasted-text chip).
- **Chip**: a small labelled token. In the editor, a **mention chip** (`@file`, `@agent`) or a **pasted chip** (`[Pasted text #1 +40 lines]`); in the strip, a **context chip** (project, location, branch, model, mode, add-dir).
- **Attachment**: an image or PDF held beside the doc and sent as a content block. **Attachment strip**: the row of thumbnails under the editor.
- **Serialisation**: the pure function from doc plus attachments to what `session.send` carries (`string | ContentBlock[]`, C3's `session.send` input) and to the one-line `display` history keeps.
- **Submit control**: the button whose label is one of the five states of §5.4: Send, Queue, Steer, Stop, Resume.
- **Queue entry**: C3's `QueueEntry` (`src/shared/engine/session-state-store.ts`) with states `queued`, `submitting`, `released` and the flag `uncertain`; **paused** is the queue's flag. **Busy**: C3's predicate (a turn is open or an entry is `submitting` or `released`); the renderer approximates it from `EngineSessionStatus.turn` and the entries.
- **Request**: one of the five kinds the engine parks for a human (`permission`, `question`, `plan`, `dialog`, `elicitation`), reaching the renderer as an X1 `AttentionItem` (`src/shared/graph/attention.ts`) plus its originating `*.requested` event. **Card**: the X4 component that renders one request. **Placement**: where the card sits: `docked` (in the composer's place), `card` (inside a C5 Overview card), `hover` (inside C5's Needs-you hover card), `inline` (in C6's `request_slot` row). **Pointer**: the compact inline row shown in the transcript while the same request is docked in that pane.
- **Scope**: what a permission allow grants: `once`, `session`, `local_settings` (C3's `RequestAnswer`). **Downgraded**: a request whose engine flags forbid persistent scopes, so only `once` is offered.
- **Catalogue**: the engine's own list of slash commands, agents and skills for a session, from the `initialize` response and each `system/init`, kept fresh by `system/commands_changed`.
- **Mode** (of the editor): `send` (ordinary), `bash` (a leading `!`), `memory` (a leading `#`).
- **Window**: one rate-limit window of a Claude account: the 5-hour window (ClaudeUsage's `session` key), the 7-day window (`weekly_all`) or a per-model 7-day window (`weekly_scoped#<Model>`). **Drain target**: the account ClaudeUsage's relay routes new sessions to (`pins.json.drainTarget`). **Pin**: the relay's assignment of one engine session id to one account (`pins.json.pins[<sessionId>]`).
- **Provider seam**: a renderer registry through which a later child supplies behaviour C7 needs but does not own: `registerResubmitProvider` (C10's fork) and `registerSlashWidget` (C11's widgets).

## Constraints

Binding on every milestone, from the charter and the sibling contracts:

- §5.4 and §5.5 semantics: the strip's chips and the permission chip showing the *effective* mode with the refusal code in words; the five submit states; the queued list with edit, delete, steer and "queue paused because you interrupted"; `!` through the engine's bash frame with the output as a replayed row; `#` appending to memory; ArrowUp history on an empty editor; pasted text beyond a threshold becoming an attachment; drag-and-drop files attaching and images pasting inline; a pending permission or question replacing the composer with its card, Enter approving and Esc declining, the composer returning afterward; the slash palette listing engine commands, skills, custom commands and MAWS actions marked by origin, commands with a terminal menu opening a widget (C11's); the status line's six fields and their sources; the near-limit banner once per window. (binding semantics, advisory layout)
- §4.2 further engine semantics: the app-owned queue with Steer bypassing it (C3 implements; C7 renders and drives); plan approval's three outcomes; `!` and `#` as C3 implements them; edit-and-resubmit forks by default and rewind is an explicit action. (binding)
- §5.7 and C5's dispatcher contract: Enter and Esc reach a request only from the element that holds DOM focus, through `useKeyChord(id, handler, { within })` (`src/renderer/src/keymap/useKeyChord.ts`); the composer's root carries `data-key-sink="composer"`; `composer.send` and `composer.cycleMode` are C5's table entries C7 consumes; a keyboard shortcut never approves a request in an inactive pane. (binding)
- §5.1 hover rule: in the hover placement, Approve and Deny exist only for `permission` items whose tool is in `READ_ONLY_TOOLS` (`src/shared/attention/read-only-tools.ts`), by click only, with `scope: 'once'` or a plain deny. (binding)
- X4: one component for the five kinds, taking an `AttentionItem` and an answer callback, identical in look and behaviour in every placement. (binding, owned here)
- X2: C7 adds entries only in per-namespace modules as delimited blocks (`session.ts`, `settings.ts`, `layout.ts`, `git.ts`), strict objects, validation on both sides; the one touch outside a namespace module is the `MawsBridge` interface in `src/shared/ipc/schema.ts` (`pathForFile`, Interfaces). (binding)
- X1: C7 never renames and never widens an identifier; its one X1 change is additive and optional (`permission.requested` fields, Interfaces) and is recorded in the wave-2 ledger's section (b) at reconciliation. (binding)
- X3 and C6's public surface: C7 imports only from `src/renderer/src/transcript/index.ts` (`Transcript` props `renderRequest`, `actions.editAndResubmit`, `useTranscriptStore`, the row types) and adds one export there (`Markdown`, Interfaces). (binding)
- C3's `RequestAnswerSchema` is the answer contract: a permission `allow` carries `scope`, a `deny` carries none; question answers are keyed by question text with multi-select joined `', '`; plan outcomes are `implement`, `clear_and_implement`, `keep_planning`; dialog and elicitation answers are passed verbatim. (binding)
- C3's queue entry states and `uncertain` are rendered as C3 defines them: a `submitting` entry is in flight and not editable; a `released` entry is the running turn and leaves the list at its `turn.ended`; an `uncertain` entry sits at the head with the queue paused until the human resumes or removes it. (binding)
- D-19 and D-17: usage windows come from ClaudeUsage's local files for routed sessions, one shared read for every session; the engine's `get_usage` is read only for a session whose `EngineSessionStatus.gateway.mode === 'direct'`. (binding)
- §4.1 renderer sandbox: the renderer loads nothing by path; files reach it as bytes through main (`layout.pickFiles`) or as `File` objects from paste and drop; a dropped file's path comes only from Electron's `webUtils.getPathForFile` in the preload. (binding)
- D-12 and §4.3: C7 never writes under `~/.claude` (the terminal's `history.jsonl` is read, never appended); MAWS's own history lives under `userData`. (binding)
- C1's conventions: zod 4 (`import * as z from 'zod'`), validators never transform or default, `Schema` suffix, tokens only in components (the guard test), unit tests beside sources, `@shared/*` alias. (binding by inheritance)
- Shared files (wave-2 ledger, section c, extended to wave 3): every addition C7 makes to a file another child owns is a delimited block; C8 runs in parallel on its own branch and touches none of C7's files except `src/renderer/src/App.tsx` (each child one block) and `package.json` (separate keys). (binding)
- Commit rules from `CLAUDE.md` and the owner's global instructions: no attribution footers.

## Repository map

Files C7 creates or touches; everything else is another child's. Paths are repository-relative; unit tests sit beside their source as `*.test.ts(x)`.

```
src/renderer/src/composer/
  index.ts                         registerSlot('composer'), the exports C5/C6/C8/C10/C11 use (Composer, prefillComposer, renderInlineRequest, renderDockedPointer, registerResubmitProvider, registerSlashWidget)
  Composer.tsx                     the slot component: strip, editor, attachment strip, queue list, submit control, mode chrome, docked-card swap
  editor/extensions.ts             the Tiptap extension set (Interfaces, Document model)
  editor/Editor.tsx                useEditor wiring, key handling (Enter modes, ArrowUp/Down history, Shift+Enter), data-key-sink
  editor/serialize.ts              serializeDraft(doc, attachments, ctx) → { content, display, mode }  (pure)
  editor/paste.ts                  paste and drop classification: threshold, images, PDFs, files, text; pasted_content wrapping
  editor/attachments.ts            Attachment model, image downscale, size caps, draft persistence split
  editor/history.ts                ArrowUp/Down navigation state machine (pure) and the two sources
  editor/nodes/{Mention,Pasted}.tsx  atom node views (React node views)
  mentions/AtMenu.tsx, mentions/SlashPalette.tsx   the two suggestion popups
  mentions/items.ts, mentions/rank.ts             item sources and the deterministic ranking (pure)
  mentions/widgets.ts              registerSlashWidget registry (C11 fills)
  plus-menu/PlusMenu.tsx           "+" menu
  strip/ContextStrip.tsx, strip/{ProjectChip,LocationChip,BranchChip,ModelChip,ModeChip,AddDirChip}.tsx
  submit/submit-state.ts           submitState(...) (pure, the five-state table)
  submit/SubmitControl.tsx
  queue/QueueList.tsx              entries, edit, delete, steer, the paused and uncertain banners
  modes/bash.ts, modes/memory.ts   `!` and `#` detection, dispatch, the memory target picker
  resubmit-seam.ts                 registerResubmitProvider (C10 fills); the explicit-rewind alternative
src/renderer/src/request-card/
  index.ts                         registerSlot('requestCard'); RequestCard export
  RequestCard.tsx                  X4: placement switch, delivery states, focus, keyboard (useKeyChord within the card)
  variants/{Permission,Question,Plan,Dialog,Elicitation,Notice}.tsx
  answers.ts                       variant state → RequestAnswer (pure, validated against RequestAnswerSchema)
  scope.ts                         scopeOptions(event, project) (pure, the downgrade rule)
  preview/ToolPreview.tsx          the bounded input preview per tool class
  preview/SandboxedPreview.tsx     question option previews in an isolated frame
  InlinePointer.tsx                the compact inline row while the card is docked in the same pane
src/renderer/src/statusline/
  popovers.tsx                     the six popovers, wired into C5's StatusLine (Cwd, Context, FiveHour, SevenDay, Cost, Mode)
  UsagePopover.tsx, ContextPopover.tsx
  near-limit.ts                    the once-per-window banner rule (pure) and its notices-store adapter
src/renderer/src/stores/
  composer.ts                      per-session composer state (mode, editing, attachments, draft status, memory target)
  queue.ts                         session.queue events and session.queue.list snapshots per session
  catalog.ts                       session.catalog snapshots, session.commands and session.init events
  usage.ts                         [C5] extended: accounts, drainTarget, pinsFor, windowsFor(engineSessionId), directFallback
src/renderer/src/session/StatusLine.tsx   [C5] each field button gains aria-haspopup and its popover
src/renderer/src/ipc/events.ts            [C5] C7 block: session.queue → queue store; session.eventBatch (session.init, session.commands) → catalog store; settings.usageChanged → usage store
src/renderer/src/app/Diagnostics.tsx      [C5] a delimited block: the dev-only "Resume live" launcher (import.meta.env.DEV only)
src/renderer/src/App.tsx                  [C1/C5/C6] a C7 block: slot registrations, the Transcript adapter lines (editAndResubmit → prefillComposer, renderRequest → renderDockedPointer)
src/renderer/src/ipc/query.ts             [C1] QUERY_COMMANDS gains attention.request, session.catalog, session.listModels, session.getContextUsage, session.getUsage, session.getMemoryDialog, session.getSessionCost, settings.usage, git.lsFiles, session.history.list
src/renderer/src/transcript/index.ts      [C6] one export line: Markdown (view/markdown/Markdown.tsx, static mode)
src/renderer/src/harness/main.tsx         [C6] route #composer → harness/composer/ComposerHarness.tsx
src/renderer/src/harness/composer/ComposerHarness.tsx   the composer and card harness page for Playwright
src/shared/ipc/schema/session.ts          [C3/C4/C5] C7 block: session.catalog, session.history.list, session.history.append
src/shared/ipc/schema/settings.ts         [C1/C5] C7 block: settings.usage, event settings.usageChanged
src/shared/ipc/schema/layout.ts           [C5] C7 block: layout.pickFiles; layout key `usage.banners`
src/shared/ipc/schema/git.ts              [C4] C7 block: git.lsFiles
src/shared/ipc/schema.ts                  [C1] MawsBridge gains pathForFile(file): string (one line)
src/preload/index.ts                      [C1] pathForFile through webUtils.getPathForFile
src/shared/graph/events.ts                [C1] permission.requested gains six optional fields (additive)
src/shared/keymap/actions.ts              [C5] C7 block: composer.steer, composer.stop, composer.focus
src/shared/usage/types.ts                 UsageWindowSchema, AccountUsageSchema, UsageSnapshotSchema
src/shared/composer/history-entry.ts      HistoryEntrySchema (shared by main and renderer)
src/engine-host/ipc.ts                    [C3/C4] C7 block: session.catalog handler
src/engine-host/session.ts                [C3] retains the initialize response's commands and agents, and the latest system/init's terminal_slash_commands, if C3 did not
src/engine-host/normalizer.ts             [C3] fills the six new permission.requested fields and EventBase.agentId from can_use_tool.agent_id
src/main/usage/claude-usage-reader.ts     reads accounts.json, pins.json, history/<uuid>.jsonl; watches; answers settings.usage; emits settings.usageChanged
src/main/history/prompt-history.ts        <userData>/prompt-history.jsonl plus the read-only terminal history; answers session.history.*
src/main/git/ls-files.ts                  [C4 directory] git.lsFiles handler (git ls-files, fallback walk, fuzzy filter)
src/main/files/pick.ts                    layout.pickFiles handler (dialog.showOpenDialog, bounded reads)
src/main/index.ts                         [C1/C3/C4/C5] one delimited block: start the usage reader, register C7's main handlers
test/fixtures/claude-usage/{accounts.json,pins.json,gateway.json,history/*.jsonl}   redacted copies of the owner's files (emails replaced, four accounts, ~40 history rows each)
test/fixtures/composer/*.json             docs with their expected serialisations
test/fixtures/shell/nine-sessions.json    [C5] no change; the requests it carries are the card's fixture inputs
e2e/composer.spec.ts, e2e/requests.spec.ts, e2e/statusline.spec.ts
package.json                              Tiptap dependencies (exact), scripts e2e:composer
```

Not touched: `src/engine-host/**` beyond the two files above, `src/main/attention/**`, `src/main/sessions/**`, `src/main/layout/**`, `src/renderer/src/transcript/**` beyond the one export, `src/renderer/src/sidebar/**`, `src/renderer/src/overview/**`, `src/renderer/src/panel/**`, `src/renderer/src/terminal/**`, `docs/charter.md`.

## Interfaces and Dependencies

Code below is the code that is itself a decision. Zod schemas carry the type's name with a `Schema` suffix; types are `z.infer` of their schema unless marked.

### X2 additions (`src/shared/ipc/schema/{session,settings,layout,git}.ts`, `schema.ts`)

```ts
// session.ts — C7 block (owner engine-host for catalog, main for history)
export const SessionCatalogSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, revision: z.number().int(),               // revision increments on every commands_changed
  commands: z.array(z.strictObject({ name: z.string(), description: z.string(), argumentHint: z.string(), builtin: z.boolean() })),   // initialize.commands, replaced by commands_changed
  agents: z.array(z.strictObject({ name: z.string(), description: z.string() })),                                                    // initialize.agents
  skills: z.array(z.string()),                                                  // the latest system/init.skills
  terminalOnly: z.array(z.string()),                                            // the latest system/init.terminal_slash_commands
});
'session.catalog':        { input: z.strictObject({ appSessionId }), output: SessionCatalogSchema, owner: 'engine-host' }   // immediate: answered from retained handshake state
'session.history.list':   { input: z.strictObject({ appSessionId, limit: z.number().int().positive().max(500) }), output: z.strictObject({ entries: z.array(HistoryEntrySchema) }), owner: 'main' }
'session.history.append': { input: z.strictObject({ appSessionId, display: z.string().min(1).max(4096) }), output: z.void(), owner: 'main' }

// src/shared/composer/history-entry.ts
export const HistoryEntrySchema = z.strictObject({ display: z.string(), at: z.string(), source: z.enum(['maws', 'terminal']), sessionId: z.string().nullable() });

// settings.ts — C7 block (owner main)
'settings.usage':         { input: z.strictObject({ engineSessionIds: z.array(z.string()).max(64) }), output: UsageSnapshotSchema, owner: 'main' }
events: 'settings.usageChanged': UsageSnapshotSchema      // pinsFor filled for the ids the last settings.usage call named

// layout.ts — C7 block (owner main)
export const PickedFileSchema = z.strictObject({ path: z.string(), name: z.string(), bytes: z.number().int(), mediaType: z.string().nullable(),
  data: z.string().nullable() });   // base64 for image/* ≤ 20 MiB and application/pdf ≤ 32 MiB, else null (the renderer then mentions the path)
'layout.pickFiles':       { input: z.strictObject({ kind: z.enum(['files', 'photos', 'directory']), directory: z.string().nullable(), multiple: z.boolean() }), output: z.strictObject({ files: z.array(PickedFileSchema) }), owner: 'main' }   // 'directory' opens the dialog with openDirectory and answers the path with mediaType 'inode/directory' and data null
// layout key added to C5's value shapes: 'usage.banners' → z.array(z.string()).max(50)   (dismissed near-limit banner keys)

// git.ts — C7 block (owner main)
'git.lsFiles':            { input: z.strictObject({ directory: z.string(), query: z.string().max(256), limit: z.number().int().positive().max(200) }),
                            output: z.strictObject({ paths: z.array(z.string()), truncated: z.boolean(), source: z.enum(['git', 'walk']) }), owner: 'main' }

// schema.ts — MawsBridge, one additive line
pathForFile(file: File): string;   // preload: webUtils.getPathForFile; '' when Electron has no path for it (a file dragged from a browser)
```

`session.catalog` is answered from the engine host's retained handshake state: the `initialize` response's `commands` and `agents` (C3's `EngineSession` feeds those into the status; if it does not retain the arrays, the C7 block adds a `catalog` field beside them), the latest `system/init`'s `skills` and `terminal_slash_commands`, and every `system/commands_changed` replacing `commands` and bumping `revision`. It is immediate (C3's deadline shapes) and a session with no handshake yet answers empty arrays with `revision: 0`. The X1 event `session.commands` (C3's, from `commands_changed`) and `session.init` (names only) keep the renderer's catalogue store current between reads; the store applies whichever carries the higher revision, treating an event as `revision + 1` over the last snapshot.

`session.history.*` is answered by main from two sources: MAWS's own `<userData>/prompt-history.jsonl` (append-only, one JSON object per line in the terminal's own record shape `{ display, pastedContents: {}, timestamp, project, sessionId }`, so a future append into the terminal's file would be a one-line change) and, read-only, the terminal's `~/.claude/history.jsonl` (`CLAUDE_CONFIG_DIR` honoured; the last 512 KiB of the file, lines filtered to `project === <the session's directory>`), merged newest-last by `timestamp`, de-duplicated on exact `display`, capped at `limit`. `append` writes MAWS's file with `project` = the session record's `directory` and `sessionId` = the engine session id when known, and never touches the terminal's file (D-12).

`layout.pickFiles` opens `dialog.showOpenDialog` (`openFile`, `multiSelections` when asked, `defaultPath` = `directory`, filters `Images` for `photos`) and reads the bytes only for image and PDF types under the caps; every other file is answered by path alone. `git.lsFiles` runs `/usr/bin/git ls-files --cached --others --exclude-standard -z` (C4's git invocation conventions: `execFile`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, 10 s timeout) in `directory`, caches the list per directory for 10 s, filters by the fuzzy scorer below, and for a directory that is not a repository walks it (`readdir`, depth ≤ 6, ≤ 20,000 entries, `node_modules`, `.git`, `dist`, `.claude/worktrees` skipped) and answers `source: 'walk'`.

### X1 additive extension (`src/shared/graph/events.ts`) — flagged to the coordinator

`permission.requested` gains six optional fields, absent when the wire omitted them (C1's rule: validators never default): `decisionReason: z.string().nullable().optional()`, `suppressAlwaysAllow: z.boolean().optional()`, `defaultToNo: z.boolean().optional()`, `matchedAskRule: z.strictObject({ source: z.string(), toolName: z.string(), ruleContent: z.string().nullable() }).nullable().optional()`, `requiresUserInteraction: z.boolean().optional()`, `mcpServer: z.string().nullable().optional()`. C3's normaliser fills them from `can_use_tool`'s `decision_reason`, `suppress_always_allow_rule`, `default_to_no`, `matched_ask_rule`, `requires_user_interaction`, `mcp_server` (SPEC 45 §45.19 lists all six on the request; `pass2/grant-reapply-start` seq 30 and `grant-askrule-start` seq 27 show the shapes that appear), and sets `EventBase.agentId` from the request's `agent_id` when present, so the card can name the requesting agent (the attention item's `request.agentId` is the same value). Reason: the card must not offer a persistent scope the broker will downgrade (`decisionReasonType === 'rule'` is on the event already; `matched_ask_rule` and `suppress_always_allow_rule` are not) and must not let Enter approve a `default_to_no` request (SPEC 45 §45.19: "a terminal-style prompt opens on its decline option"). Every existing fixture, snapshot and C6 row stays valid because the fields are optional.

### Keymap additions (`src/shared/keymap/actions.ts`, C7 block)

```ts
'composer.steer':  { title: 'Steer the running turn',  chord: 'Alt+Enter', sink: 'renderer', menu: null, scope: 'composer' },   // the editor's text into the open turn with priority now
'composer.stop':   { title: 'Stop the running turn',   chord: 'Cmd+.',     sink: 'renderer', menu: null, scope: 'pane' },       // session.interrupt for the pane that holds focus
'composer.focus':  { title: 'Focus the composer',      chord: 'Cmd+L',     sink: 'renderer', menu: null, scope: 'app' },        // the focused pane's composer (layout.focusedPane is allowed for non-Enter/Esc actions)
```

Everything else the composer answers is editor-local, not a table entry, exactly as the terminal keeps ArrowUp outside its rebindable actions (SPEC 42 §42.19.3): Enter and Shift+Enter inside the editor, ArrowUp and ArrowDown history, Tab and digits inside a card's scope group, arrows and Enter inside the `@` and `/` popups, ⌘Enter inside a card's textarea. C5's `composer.send` (⌘Enter) and `composer.cycleMode` (⇧Tab) are consumed as written; both fire only inside `data-key-sink="composer"`.

### Composer public surface (`src/renderer/src/composer/index.ts`)

```ts
export const Composer: React.ComponentType<{ appSessionId: AppSessionId; paneIndex: 0 | 1 }>;    // C5's composer slot
export function prefillComposer(appSessionId: AppSessionId, prefill: { text: string; editing: { messageUuid: MessageUuid } | null }): void;   // C6's editAndResubmit adapter and C3's rewind prefillText
export function renderDockedPointer(appSessionId: AppSessionId): NonNullable<TranscriptProps['renderRequest']>;   // the session pane's Transcript: a Pointer for the docked request, the full inline card for any other pending request
export function renderInlineRequest(appSessionId: AppSessionId): NonNullable<TranscriptProps['renderRequest']>;   // C8's drill-in and any Transcript without a composer: always the full inline card
export interface ResubmitProvider { forkFrom(req: { appSessionId: AppSessionId; messageUuid: MessageUuid; content: string | ContentBlock[] }): Promise<{ appSessionId: AppSessionId }> }
export function registerResubmitProvider(p: ResubmitProvider): () => void;     // C10 registers; null until then
export interface SlashWidget { title: string; component: React.ComponentType<{ appSessionId: AppSessionId; args: string; close(): void }> }
export function registerSlashWidget(name: string, widget: SlashWidget): () => void;   // C11 registers model, effort, fast, permissions, usage, config, plugins, mcp, sandbox, hooks, memory, skills, agents, status, compact, context, rename, resume, export, diff
export const useComposerStore;   // stores/composer.ts: per-session { mode, editing, attachments, draftState: 'loading' | 'ready' | 'saving', memoryTarget, historyCursor }
```

### Document model and serialisation (`editor/extensions.ts`, `editor/serialize.ts`)

The editor is plain text with atoms: no marks, no headings, no lists (the model reads markdown from the text; formatting chrome would only fight it). Extensions, from `@tiptap/*` 3.31.3: `Document` extended with one attribute `attachments: Attachment[]` (default `[]`) so `getJSON()` carries the strip and `setContent` restores it; `Paragraph`; `Text`; `HardBreak`; `Placeholder` (from `@tiptap/extensions`, text `Do anything` for an empty session, `Ask a follow-up…` after the first turn, mockup 01 and 04); `UndoRedo` (`@tiptap/extensions`); `Mention` (`@tiptap/extension-mention`, with `suggestions: [{ char: '@', pluginKey: atKey, allowSpaces: false, allowedPrefixes: [' ', '\n', '。', '、', '？', '！'] }, { char: '/', pluginKey: slashKey, startOfLine: true }]`, the terminal's own trigger rules, SPEC 42 §42.16.2; the `/` trigger renders the palette and never inserts a mention node), the `Pasted` atom (`editor/nodes/Pasted.tsx`: attrs `id`, `name`, `lines`, `text`, rendered as a chip, `atom: true`, `selectable: true`, deleted whole by Backspace), `FileHandler` (`@tiptap/extension-file-handler`, `onPaste` and `onDrop` delegating to `paste.ts`, `allowedMimeTypes` unset so every file reaches the classifier), and a `ComposerKeymap` extension carrying Enter, Shift+Enter, ArrowUp, ArrowDown, `!`/`#` mode detection and Escape.

```ts
export type Attachment =
  | { id: string; kind: 'image'; name: string; mediaType: string; bytes: number; data: string; persisted: boolean }      // data: base64; persisted false when the draft cap excluded it
  | { id: string; kind: 'document'; name: string; mediaType: 'application/pdf'; bytes: number; data: string; persisted: boolean };
export interface MentionAttrs { id: string; label: string; kind: 'file' | 'agent' }        // file: id is the path as inserted (relative to cwd, or absolute); agent: id is the agent name
export interface SerializeContext { sessionId: SessionId | null; cwd: string }
export interface Serialized { mode: 'send' | 'bash' | 'memory'; text: string; content: string | ContentBlock[]; display: string; empty: boolean }
export function serializeDraft(doc: JSONContent, ctx: SerializeContext): Serialized;   // pure; no DOM
```

Rules, in order. **Text**: paragraphs joined with `\n`, `hardBreak` as `\n`, trailing whitespace of the whole trimmed; a `mention` of kind `file` renders `@<id>` (wrapped as `@"<id>"` when the path contains whitespace, the terminal's quoted form), kind `agent` renders `@agent-<id>` (the form the engine's `agent_mentions` producer recognises, SPEC 11 §11.8.2, SPEC 42 line 5393); a `pasted` atom renders `<pasted_content id="HHHH">\n<text, with a trailing newline added when absent></pasted_content>\n` where `HHHH` is the first four hex digits of SHA-256 of `ctx.sessionId` (a random four hex when null), and any `<pasted_content` or `</pasted_content` typed by the user outside a chip is neutralised to `<\pasted_content` (the terminal's own scheme, SPEC 42 §42.15, so the model treats pasted text as it does in the terminal). **Mode**: `bash` when the text starts with `!` and the doc is one paragraph with no atoms (the command is the text after `!`, trimmed); `memory` when it starts with `#` (the note is the text after `#`, trimmed); `send` otherwise. **Content**: with no attachments, `content` is the text (a string); with attachments, `content` is `[...images as { type: 'image', source: { type: 'base64', media_type, data } }, ...documents as { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }, { type: 'text', text }]`, the text block omitted when the text is empty (an image-only send), images before text as the Messages API recommends; SPEC 45 §45.15.1 states the stdin `user` message is a MessageParam whose content may hold text, image and document blocks, so nothing is re-encoded. **Display** (for history and the queue list): the text with each `pasted` atom as `[Pasted text #<n> +<lines> lines]` and each attachment as `[Image #<n>]` or `[PDF #<n>]`, mentions as their text form; bash mode keeps its leading `!`. **Empty**: no text after trimming and no attachments.

Sizes and caps (advisory): an image is downscaled on a canvas to at most 1568 px on its longest edge (the vision model's working size) and re-encoded as PNG for screenshots (source PNG or GIF) or JPEG at 0.85 otherwise, then refused with a toast when still over 5 MiB (the API's per-image limit); a PDF over 32 MiB is refused; a draft persists image and document bytes up to 4 MiB in total (`persisted: false` beyond that, and the strip labels those "not kept in draft"); a `user` frame's content is refused by C3's schema over 1 MiB of text, which the composer pre-checks and reports as "Message too large (N KB); attach the text as a file instead". Pasted text becomes a `pasted` atom when it exceeds 1024 characters or 10 lines (the terminal keeps inline paste content up to 1024 characters, SPEC 42 §42.19.1); shorter pastes insert as text. Dropped or picked non-image, non-PDF files insert a `file` mention chip with their path (absolute when outside `cwd`, relative otherwise); a dropped file without a path (`pathForFile` answers `''`) is read as text and becomes a `pasted` atom named after the file, or is refused over 1 MiB.

Drafts: the composer restores `session.drafts.get` on mount (C4's `Draft { doc, attachments, updatedAt }`), writes `session.drafts.set` 750 ms after the last change and on unmount with `doc = editor.getJSON()` (the strip rides in `doc.attrs.attachments`) and `attachments` = the path-backed chips as C4's `{ path, kind }` list; an empty doc with no attachments writes `null`. A draft is per app session and never cleared by a tab switch (Claude Desktop lesson, `research/claude-desktop-ux-and-engine.md` A5); it is cleared on a successful `session.send`, `session.bash` or `session.memoryAppend`.

History (`editor/history.ts`): ArrowUp with the cursor on the first line of an empty editor, or while navigating, moves to the previous entry; ArrowDown moves forward and past the newest restores the draft the navigation started from; any edit to a recalled entry ends navigation (the edited text is the new draft, never overwritten by the next arrow); the sources are this session's own human prompts from `useTranscriptStore.rows(key)` (rows of kind `user` with `messageUuid`, oldest first, consecutive duplicates collapsed), then `session.history.list { limit: 200 }` entries not already present. A recalled entry re-parses `@` and `/` tokens into chips (the terminal reruns its providers on recall, SPEC 42 line 9077). After every send, bash run or memory append the composer calls `session.history.append` with `display`.

### Mentions, palette and the "+" menu (`mentions/*`, `plus-menu/PlusMenu.tsx`)

`@` items, in groups: **Files** from `git.lsFiles { directory: cwd, query, limit: 30 }` (debounced 80 ms; paths shown relative, directories last) plus the session's additional directories when the query starts with `/`, `~` or `..` (path mode, like the terminal's `WZ`); **Agents** from the catalogue's `agents` (inserting an `agent` mention); **Skills** from the catalogue's `skills` (selecting one inserts the token `/<skill> ` at the start of the document, the skill's real invocation, because the engine has no `@skill` mention; the group's footer says so). `/` items, with an origin badge each: **Engine** (catalogue commands with `builtin: true` and no `:` in the name), **Skills** (names in `skills`), **Plugins** (names containing `:`), **Custom** (the rest: user and project command files), **MAWS** (C5's `ACTIONS` entries whose sink is `menu` or scope `app`, run through `runAction`, plus `split` for `pane.split`). A command whose name is in the catalogue's `terminalOnly` list, or that C11's widget list names, opens the registered widget when one exists and is otherwise disabled with the hint "Opens a widget · arrives with C11" (terminal-only commands cannot run headless, SPEC 28 §22). Selecting an engine, skill, plugin or custom command inserts `/<name> ` as text (the engine parses slash commands out of the `user` text; `pass1/init.jsonl` seq 5 lists them). Ranking (`rank.ts`, pure and deterministic, no cmdk): exact name match, then name prefix, then name substring, then a subsequence match on the name, then a word-prefix match in the description; ties by origin order Engine, Skills, Plugins, Custom, MAWS, then alphabetical; the twenty most recently chosen names in this app run get a fixed boost of one rank tier. The fuzzy file scorer is the same subsequence scorer with bonuses for a match at a path-segment boundary and for consecutive characters; ties by shorter path.

The "+" menu: **Files and folders…** (`layout.pickFiles { kind: 'files' }`), **Photos…** (`kind: 'photos'`), **Slash commands** (opens the palette at `/`), **Connectors** and **Plugins** (both open the `/mcp` and `/plugins` widgets when C11 registered them, else disabled with the same hint). The mic button is P1 and not rendered.

### Submit control and queue (`submit/submit-state.ts`, `queue/QueueList.tsx`)

```ts
export type SubmitState = 'send' | 'queue' | 'steer' | 'stop' | 'resume';
export interface SubmitInput { status: EngineSessionStatus | null; queue: { entries: QueueEntry[]; paused: boolean }; empty: boolean; mode: 'send' | 'bash' | 'memory'; steerHeld: boolean }
export interface SubmitDecision { primary: SubmitState; label: string; enabled: boolean; reason: string | null; secondaryStop: boolean }
export function submitState(i: SubmitInput): SubmitDecision;
```

| Condition (first match wins) | primary | label | enabled | secondary Stop |
|---|---|---|---|---|
| `status` null or `process` not `ready` | send | Send | no; reason `Session is starting…`, `Session ended` (resume is C10's) | no |
| `mode === 'bash'` | send | Run | `!empty` (bash writes any time the process is ready) | turn open |
| `mode === 'memory'` | send | Save to memory | `!empty` | turn open |
| turn open (`status.turn !== null`) or an entry `submitting`/`released`; `empty` | stop | Stop | yes | no |
| turn open; `!empty`; `steerHeld` | steer | Steer | yes | yes |
| turn open; `!empty` | queue | Queue | yes | yes |
| no turn; `queue.paused`; `empty` | resume | Resume | `entries.length > 0` | no |
| no turn; `queue.paused`; `!empty` | queue | Queue | yes | no |
| no turn; `entries.length > 0` | queue | Queue | `!empty` | no |
| otherwise | send | Send | `!empty` | no |

Dispatch: Send and Queue → `session.send { content }` (C3 decides `sent` or `queued`; the composer clears on `ok`); Steer → `session.steer`; Stop → `session.interrupt { cancelEngineQueued: false }` (the engine's own queue holds only steers); Resume → `session.queue.setPaused(false)`; Run → `session.bash { command }`; Save to memory → `session.memoryAppend { text, target }`. `steerHeld` is true while ⌥ is down over the control (the label changes live) and for `composer.steer`; the control's caret menu lists Queue and Steer with their chords so Steer is discoverable without the modifier. The primary chord is Enter in a single-line doc, ⌘Enter always (C5's `composer.send`), and, per §5.8, Enter inserts a newline once the doc has more than one line (`cmdIfMultiline`); the tooltip names the effective binding. A failed command (`ok: false`) keeps the draft and shows the error as a toast with Retry; nothing is cleared before main answered `ok`.

Queue list, one row per entry, from `session.queue` events and a `session.queue.list` snapshot on mount:

| entry | row | actions |
|---|---|---|
| `queued`, `uncertain: false` | `display`-style one line, "N queued" header | Edit (inline editor → `session.queue.edit`), Delete (`session.queue.remove`), Steer (`session.queue.promote`) |
| `queued`, `uncertain: true` (always the head, queue paused) | warning tone; text `May not have been delivered · check the transcript, then Resume or Delete` | Resume (`setPaused(false)`; C3 re-submits it once), Delete; Edit also clears `uncertain` |
| `submitting` (shown only after 300 ms in that state) | `Sending…` with a spinner | none (it is in flight; C3 acknowledges within milliseconds) |
| `released` | not listed: it is the running turn, visible as the user bubble; leaves the queue at its `turn.ended` | none |
| header when `paused` and no `uncertain` entry | `Queue paused because you interrupted` (the charter's copy) | Resume |

### Request card (`request-card/*`) — X4

```ts
export interface RequestCardProps {
  item: AttentionItem;                                   // any kind; the five request kinds render a card, the rest a Notice
  request: SessionEvent | null;                          // the originating *.requested event; fetched through attention.request when null
  placement: 'docked' | 'card' | 'hover' | 'inline';     // C5's slot passes the first three; C7's renderRequest adapters pass 'inline'
  paneIndex: 0 | 1 | null;                               // informational
  onAnswered?: (outcome: 'delivered' | 'not_pending' | 'write_failed') => void;
}
export const RequestCard: React.FC<RequestCardProps>;
export function scopeOptions(ev: Extract<SessionEvent, { kind: 'permission.requested' }>, project: { name: string } | null): ScopeOption[];
export interface ScopeOption { scope: 'once' | 'session' | 'local_settings'; label: string; detail: string; updatedPermissions: unknown[] | null }
export function toAnswer(state: VariantState): RequestAnswer;   // pure; every output validates against RequestAnswerSchema
```

Variants and answers, per `item.kind` (the event kind decides the variant; a `permission.requested` whose `toolName` is `AskUserQuestion` or `ExitPlanMode` never occurs, C3 emits `question.requested` and `plan.requested` for those):

| kind | body | primary (Enter) | secondary (Esc) | other controls | answer |
|---|---|---|---|---|---|
| permission | header `<Requester> wants to <verb> …` (requester: `Main session`, or the agent's name from the transcript store's subagent refs by `item.request.agentId`, else `A subagent`; verb by tool class: run a command, edit N files, read, search, fetch, use `<server>` tool); `ToolPreview` (Bash: the command in a mono block with Expand past 6 lines and the description as `Why:`; Edit/Write/MultiEdit/NotebookEdit: the file rows with a bounded before/after of `old_string`/`new_string`; Read/Glob/Grep: paths and patterns; WebFetch/WebSearch: the URL or query; MCP and unknown tools: server, tool and pretty JSON, 8 lines then scroll); `decisionReason` as a muted line when present; cwd; the scope group | Allow with the selected scope (the first option is pre-selected unless `defaultToNo`, then nothing is and Enter shows "Use the Allow button for this request") | Deny (plain) | scope radios (Tab and arrows cycle, digits 1–3 pick); `Deny… with a reason` disclosure (textarea; ⌘Enter sends); caret menu `Deny and stop the turn` | `{ kind: 'permission', decision: 'allow', scope }` / `{ kind: 'permission', decision: 'deny', message? }` / `{ decision: 'deny_and_stop', message? }` |
| question | one section per question: header, the question, options as radios (or checkboxes when `multiSelect`) with description, an `Other…` free-text row (the engine always adds one, SPEC 21), previews (single-select only) side by side in `SandboxedPreview`; Submit enabled once every question has an answer | Submit (all answers) | nothing answered: Esc blurs the card; a `Skip` control sends a permission deny with message `The user skipped these questions.` (the terminal's Esc) | — | `{ kind: 'question', answers }` (multi-select joined `', '`; Other's text verbatim) / `{ kind: 'permission', decision: 'deny', message }` for Skip |
| plan | the plan through C6's `Markdown` (static mode), bounded at 320 px with Show more | Implement | Keep planning: focuses the feedback textarea; Enter or ⌘Enter there sends | `Clear context and implement` (secondary button; confirms once: "This resets the conversation and starts a fresh turn seeded with the plan") | `{ kind: 'plan', outcome: 'implement' \| 'clear_and_implement', feedback: null }` / `{ outcome: 'keep_planning', feedback }` |
| dialog | title from `dialogKind` humanised; `payload.title` and `payload.message` when strings; buttons from `payload.options[]` when it is an array of `{ label, value }`, else `Continue` and `Stop` (the two declared kinds are a continue-or-stop and a refusal prompt, X6) | the first option | Cancel | — | `{ kind: 'dialog', behavior: 'completed', result: { choice: <value> } }` / `{ behavior: 'cancelled' }`; no producer was reachable in C2, so this shape is verified at the first live dialog and recorded (advisory) |
| elicitation | `message`; for `mode: 'form'` a form from `requested_schema` (string → input, number/integer → number input, boolean → checkbox, `enum` → select, `required` enforced, `title` and `description` as labels); for `mode: 'url'` the URL with Open (`layout.openExternal`) | Accept | Cancel | Decline | `{ kind: 'elicitation', action: 'accept', content }` / `'decline'` / `'cancel'` (`pass2/dialogs` seq 41 → 43) |
| error, interrupted, auto_mode_unavailable, held_peer_message | `Notice`: the item's summary, wait time; `auto_mode_unavailable` adds `Switch to default mode` (`session.setPermissionMode('default')`, the remedy X1 names) | — | — | Open session (card, hover) | none (these retire on the next human turn or by C3's expiry) |

Scope options (`scope.ts`): `once` always (`Allow once` · `Only this invocation`, or `These N files` for file tools); `session` unless downgraded (`Allow for this session` · `Matching <ruleContent> commands` from the engine's first `addRules` suggestion, or `Until this session ends`); `local_settings` only when a suggestion `addRules` with `destination: 'localSettings'` exists and the request is not downgraded (`Always allow <rule> in <project>` · `Project rule`). Downgraded is `decisionReasonType === 'rule' || matchedAskRule != null || suppressAlwaysAllow === true` (C3's broker downgrades exactly these; an ask rule outranks any allow rule, §4.6, pass-2 item 9). The engine's `addDirectories` and `setMode` suggestions are not offered in P0.

Placements: **docked** replaces the editor surface (the editor stays mounted and hidden so Tiptap state and the draft survive; the strip reads `Approval required · Composer paused · draft preserved`, mockup 04); when the pane contains DOM focus at the moment the card mounts, the card root (`tabIndex={-1}`) takes focus and returns it to the editor on unmount; several pending items in one session dock the oldest, with a `1 more waiting` pager. **card** is the same component inside C5's Overview article; it never takes focus on its own (the card's own focus rules are C5's) and its Enter and Esc fire only while the article has focus. **hover** renders the preview and, only for `permission` items with `isReadOnlyRequest(request)`, Approve (scope `once`) and Deny by click, plus Open session; no `useKeyChord` registration; every other kind shows the preview and Open session. **inline** is the full card at the `request_slot` row (C8's drill-in and any transcript without a composer); `renderDockedPointer` renders a `Pointer` (`Waiting for you · <tool or kind> · answer below ↓`, click focuses the docked card) for the request that pane docks and the full card for any other pending request (a child's request while the main's is docked). Keyboard: `useKeyChord('request.accept', …, { within: cardRef, enabled: placement === 'docked' || placement === 'card' })` and `request.decline` likewise; C5's dispatcher guarantees they fire only from the element holding focus, never from a textarea, button or another pane.

Delivery states: `pending` → `answering` (controls disabled, spinner) → the `session.answer` outcome: `delivered` collapses the card to one line `Answered · <what>` until `attention.changed` retires the item (then the composer returns and focus goes to the editor); `not_pending` shows `Already answered elsewhere` for two seconds and closes; `write_failed` returns to `pending` with the banner `Couldn't deliver the answer · Retry` (Claude Desktop's retryable delivery error, A5). An item in state `delivered` when the card mounts (answered from another placement) renders the collapsed line. The `request` prop is fetched through `attention.request` (memoised by `requestId` in TanStack Query) when the placement passed `null`.

`SandboxedPreview` renders an option's `preview` inside `<iframe sandbox srcdoc>` with no `allow-scripts` and no `allow-same-origin` (the isolation §5.3 requires; C1's CSP applies to the frame's content); a preview is shown as text in a `<pre>` when the frame cannot render under the CSP (the executor verifies both cases in M2 and records which applied).

### Context strip (`strip/*`)

Chips, left to right, each a Radix `Popover` or `DropdownMenu`: **Project** (name from the sessions store; click opens the project's Overview group); **Location** (the directory or worktree path, home-abbreviated, with the worktree's branch; the popover lists the directory and the additional directories with copy); **Branch** (from `git.watch { directory }` on mount, `git.changed` after, `git.unwatch` on unmount; the dirty marker from `status.dirty`; the popover lists `git.branches` with a search field, read-only in P0: switching or creating a branch under a live engine is C10's worktree concern and a write C4's read-only git service does not offer, so the chip informs and the create action is disabled with "Arrives with C10"); **Model · effort** (`EngineSessionStatus.model.resolved` and `effort`; the menu lists `session.listModels` with `displayName` and `description`, effort levels from the chosen model's `supportedEffortLevels`, and applies through `session.setModel` and `session.setEffort`; when C11 registered the `model` widget the chip opens it instead); **Mode** (the effective `permissionMode.effective`, a warning glyph and the refusal in words when `refusal` is set: `auto_mode_settings` → `Auto mode is disabled by settings`, `auto_mode_circuit_breaker` → `Auto mode paused by its circuit breaker`, `auto_mode_fast_mode` → `Auto mode is unavailable with fast mode`, `auto_mode_model` → `This model does not support auto mode`, `auto_mode_unavailable` → `Auto mode is unavailable`; the menu lists `default`, `acceptEdits`, `plan`, `auto` (disabled with the reason when `listModels` marks the current model `supportsAutoMode: false`) and `bypassPermissions` behind a confirm; ⇧Tab cycles `default → acceptEdits → plan → auto → default`, skipping `auto` when unavailable; every change is `session.setPermissionMode` and the chip shows the answer's `effective`, never the optimistic choice); **+ dir** (`layout.pickFiles { kind: 'directory' }`, then `session.applyFlagSettings { settings: { permissions: { additionalDirectories: [...current, dir] } } }` with `current` read from `session.listPermissionRules.workspaceDirectories`; the strip re-reads the rules afterwards and lists the directory; the `/add-dir` local command is unavailable to an SDK entrypoint (SPEC 28 §22 gates it to remote entrypoints), which is why flag settings carry it; if the live run shows flag settings do not add a directory, the chip becomes "Restart with directory" for C10 and the Decision Log says so).

### Status line popovers and usage (`statusline/*`, `stores/usage.ts`, `src/main/usage/claude-usage-reader.ts`, `src/shared/usage/types.ts`)

```ts
export const UsageWindowSchema = z.strictObject({ percent: z.number(), resetsAt: z.string(), recordedAt: z.string() });
export const AccountUsageSchema = z.strictObject({
  uuid: z.string(), email: z.string(), displayName: z.string(), planLabel: z.string().nullable(), rateLimitTier: z.string().nullable(),
  needsReauthentication: z.boolean(), lastSeenActive: z.string().nullable(),
  windows: z.strictObject({ fiveHour: UsageWindowSchema.nullable(), sevenDay: UsageWindowSchema.nullable(), scoped: z.array(z.strictObject({ model: z.string(), window: UsageWindowSchema })) }),
});
export const UsageSnapshotSchema = z.strictObject({
  available: z.boolean(), dataDir: z.string(), readAt: z.string(), error: z.string().nullable(),
  drainTarget: z.string().nullable(), accounts: z.array(AccountUsageSchema),
  pinsFor: z.record(z.string(), z.string()),   // engine session id → account uuid, for the ids the caller named
});
```

The reader lives in main (the renderer is sandboxed; the engine host is C3's and never reads outside the engine's store). Directory: `~/Library/Application Support/ClaudeUsage` (`MAWS_CLAUDE_USAGE_DIR` overrides it for tests and the acceptance fixture). Files, in the shapes read from the owner's machine on 2026-09-28 and copied redacted into `test/fixtures/claude-usage/`: `accounts.json`, an array of `{ uuid, email, displayName, planLabel, rateLimitTier, needsReauthentication, lastSeenActive, credentialOwnership }`; `pins.json`, `{ drainTarget, drainTargetIsManual, pins: { [engineSessionId]: { accountUUID, lastUsed } } }` (2,780 pins, 342 KB on the owner's Mac); `history/<accountUuid>.jsonl`, one `{ limitKey, percent, recordedAt, resetsAt }` per line where `limitKey` is `session` (the 5-hour window: `resetsAt` sits under five hours after `recordedAt`), `weekly_all` (the 7-day window) or `weekly_scoped#<Model>` (a per-model 7-day window); ClaudeUsage's own `HistoryStore` keeps the newest row per key, which is what the reader does over the last 64 KiB of each file. No usage endpoint exists on the relay (its `RequestPipeline` answers `/api/hello` and forwards `/v1/*`; verified in `claude-usage-menubar/Sources/ClaudeUsageGateway/RequestPipeline.swift`), so files are the only local source. The reader watches the directory and `history/` with `fs.watch` (non-recursive), coalesces changes with a 500 ms trailing debounce, re-reads on a 60 s floor, keeps the parsed pins map in memory and answers `pinsFor` by lookup, emits `settings.usageChanged` when the snapshot differs, and answers `available: false` with `error` when the directory is absent (the status line then shows `—` with the tooltip `ClaudeUsage is not installed or has no data`). The renderer's `usage` store (C5's file, extended) keeps `windows` (the drain target's, so C5's status-line container needs no change), `accounts`, `pinsFor`, `directFallback: Map<AppSessionId, Windows>`, and the selector `windowsFor(record, status)`: for a session whose `status.gateway.mode === 'direct'` the direct fallback (`session.getUsage` every 60 s while its tab is visible and after each turn end, `rate_limits` mapped to the same `Window` shape, D-19's engine fallback); otherwise the pinned account's windows by `record.engineSessionId`, else the drain target's. The store re-invokes `settings.usage` with the engine ids of open session tabs on every `settings.usageChanged` and every tab change (bounded at 64).

Popovers (each a Radix `Popover` anchored to C5's field button; C7 sets `aria-haspopup` and the handler in `StatusLine.tsx`): **cwd**: the full directory, the worktree and branch, the additional directories, Copy path; **context**: `session.getContextUsage { detail: 'full' }` on open, `<used> of <max> · autocompact at <threshold>`, the percentage and tokens until compaction, a segmented bar and the categories list (system prompt, tools, messages, attachments, memory: whatever `categories` names), and `Compact now` (sends `/compact` through `session.send` when the catalogue lists it and it is not terminal-only; otherwise absent); **5h** and **7d**: the same `UsagePopover` with the account (`email · planLabel`), the three window rows (5h, Weekly, and each scoped model window) as bars with percent and `resets in <d h m>`, a `no reading since the window reset` note when `resetsAt` is past (the value is then shown as `0%`), `Other accounts` collapsed (email and 7d percent each, the drain target marked `routing`), and `Updated <ago>`; the `Open ClaudeUsage` hand-off is C11's and appears when C11 registers it (a one-line seam `registerUsageAction`); **cost**: `session.getSessionCost` on open beside the digest's `totalUsd`, per-model usage from the latest `usage.sample.modelUsage`; **mode**: the same menu as the strip's Mode chip. The near-limit rule (`near-limit.ts`, pure): for every account window with `percent >= 90` and `resetsAt` in the future, a banner keyed `usage:<accountUuid>:<limitKey>:<resetsAt>` is posted once through C5's `notices` store `banner()` with the text `<5-hour | Weekly | Weekly <Model>> window at <percent>% for <email> · resets in <d h m>`, level `warning`, dismissible; a key already in the layout key `usage.banners` (dismissed) or already posted in this run is never posted again, so a window shows its banner once per window across every composer and across reloads (C5's banner host is the one place, §5.5).

### `!` and `#` (`modes/bash.ts`, `modes/memory.ts`)

`!` at offset 0 of an empty editor switches the mode chrome (mono text, a `Bash` chip, placeholder `Shell command · runs through the engine · output goes to the transcript`); Enter runs `session.bash { command }` and clears; the replayed rows and the echo arrive through C3's events and C6 renders them; `session.bash` answers at the write, so the control shows `Running…` until the `turn.ended { isEchoReceipt: true }` for that command or C3's `notice.posted { key: 'bash:no_output:<commandUuid>' }`. The SPEC states no restriction on a `bash_command` during a turn (§45.15.2), so the control stays enabled; if the live run refuses one mid-turn, the executor restricts it to idle and records the refusal. `#` at offset 0 switches to memory mode (a `Memory` chip naming the target); Enter calls `session.memoryAppend { text, target }` and shows a toast `Saved to <path>`; the target defaults to `{ kind: 'project' }` and the chip's menu lists `session.getMemoryDialog.files` (`label`, `path`, `exists`) as `project`, `user` or a listed `path`, remembered per session in the composer store. Backspace over the leading `!` or `#` leaves the mode.

### Edit-and-resubmit and the fork seam (`resubmit-seam.ts`)

C6's user bubble calls `actions.editAndResubmit(row)`, adapted in `App.tsx` to `prefillComposer(appSessionId, { text: row.text, editing: { messageUuid: row.messageUuid } })`. The composer enters edit mode: the strip reads `Editing an earlier message · sending forks this session from here`, Esc or the chip's × leaves it. Send in edit mode calls the registered `ResubmitProvider.forkFrom` (C10: a fork launch of this session, a rewind in the fork to that message, then the send, opening the new session's tab) and, when none is registered, offers the explicit alternative the charter names: a dialog `Forking arrives with C10. Rewind this session to that message and resend instead?` whose confirm calls `session.rewind { targetMessageUuid: editing.messageUuid, lastSeenMessageUuid: <the newest user row's messageUuid in the transcript store>, files: false }` and, on `rewound: true`, sends the edited content; a refused rewind shows the engine's `reason` and keeps the draft. Rewind is thereby always the explicit action (§4.2) and the fork the default once C10 lands.

### Dev-only resume launcher (`Diagnostics.tsx`, C7 block)

Until C10 ships the new-session sheet there is no product path that puts a live process behind a session record. The acceptance needs one, so the Diagnostics tab (`import.meta.env.DEV` only) gains a `Resume live` control per listed record with a `Direct` checkbox and an `extraSettings` JSON field: it calls `session.launch` with `{ appSessionId: record.appId, cwd: record.directory, additionalDirectories: record.additionalDirectories, resume: { sessionId: record.engineSessionId, fork: false }, gateway, model: null, effort: null, permissionMode: null, subagentModel: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: 0.5, replay: null }`. C4's `IndexSessionSource` already applies `session.status` for a known `appSessionId` (ledger d.14), so the record turns `holder: self` and the composer becomes live. The executor creates the sessions to resume in a terminal (`claude` in a scratch git repository, one exchange, exit), which C4 discovers. C10 replaces this control.

### Dependencies

| Package | Pin | Note |
|---|---|---|
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/extensions`, `@tiptap/extension-document`, `@tiptap/extension-paragraph`, `@tiptap/extension-text`, `@tiptap/extension-hard-break`, `@tiptap/extension-mention`, `@tiptap/suggestion`, `@tiptap/extension-file-handler` | 3.31.3 exact | the registry's `latest` on 2026-09-28 (published 2026-09-04); the family peers on one exact `@tiptap/core` version, so every member is pinned to the same string and upgraded together; `@tiptap/react` peers on React 17–19; `@tiptap/extension-file-handler` is MIT in v3 (it was a Pro extension in v2); `@tiptap/extensions` bundles `Placeholder`, `UndoRedo`, `TrailingNode` and kin (verified against the 3.31.3 tarballs). `@tiptap/starter-kit` is not used (it brings marks, headings and lists the editor must not offer) |
| `radix-ui` | C5's range | `Popover`, `DropdownMenu`, `RadioGroup`, `Checkbox`, `Dialog`, `Tooltip`, `VisuallyHidden` |
| `@tanstack/react-query` | C1's | `attention.request`, the reads behind the popovers and the catalogue |

No image or markdown library: images are drawn on a canvas; the plan body renders through C6's `Markdown`.

## Acceptance

C7 closes when all of the following are observed on the owner's Mac from the C7 worktree with C3 and C6 merged, in this order:

1. `pnpm test` passes and its output includes the suites `serializeDraft maps docs to user content`, `paste and drop classify by threshold, type and path`, `history navigation restores the draft and ends on edit`, `submitState covers the five states`, `queue list renders every entry state`, `scope options follow the downgrade rule`, `toAnswer validates against RequestAnswerSchema for every variant`, `request card placements and delivery states`, `slash and @ ranking is deterministic`, `claude-usage reader parses the fixture directory`, `near-limit banner posts once per window`, `prompt history merges MAWS and terminal sources`, `git lsFiles filters and falls back`, `catalog answers from handshake state`, `ipc schema validates both directions` (extended with every C7 entry).
2. `pnpm build && MAWS_ENGINE_REPLAY=1 pnpm e2e` passes with `e2e/requests.spec.ts`, `e2e/composer.spec.ts` and `e2e/statusline.spec.ts` (Concrete Steps show the expected transcript). `requests.spec.ts` launches C3's replay of `spikes/protocol-probe/fixtures/permission-roundtrip.jsonl` behind a stub record, sends the fixture's first prompt from the real composer, sees the editor give way to the permission card naming `Bash` with `git log --oneline`, offering only `Allow once` (the request is `decision_reason_type: 'rule'`), presses Enter with focus in the card, and observes the recorded `control_response` (`behavior: 'allow'`, no `updatedPermissions`) in the journal, the card collapsing, then the composer returning as `tool.result` confirms the item; a second pane with another session open keeps its Enter to itself (a counting `request.accept` handler in that pane never fires). It then replays `question-roundtrip.jsonl`, answers `Red` and both `Apple` and `Pear` in the form, submits, and reads the journal's `answers` equal to `{ "Which color do you prefer?": "Red", "Which fruits do you like?": "Apple, Pear" }` (seq 138); replays `pass2/dialogs.jsonl`, fills `color` with `teal` in the elicitation form, accepts, and reads seq 43's `{ action: 'accept', content: { color: 'teal' } }`; replays `pass2/grant-reapply-start.jsonl` (no ask rule), chooses `Allow for this session`, and reads seq 32's `updatedPermissions` with `destination: 'session'`; opens the same item from an Overview card and from the Needs-you hover (a synthetic read-only `Read` request in a scenario) and answers each by its own control. `composer.spec.ts` runs over the `#composer` harness and the replay: typing `hello` and Enter sends; Shift+Enter then Enter inserts lines and ⌘Enter sends; a paste of 40 lines becomes `[Pasted text #1 +40 lines]` and serialises inside `<pasted_content>` tags; a pasted PNG appears in the strip and serialises as an image block before the text; `@` lists files of the harness's scratch repository and inserts a chip that serialises to `@src/a.ts`; `/` lists the catalogue with origin badges and `/compact` inserts text while `/model` is disabled until a widget registers; ArrowUp recalls the last prompt and ArrowDown restores the draft; `!printf MAWS_BASH_8823` against `pass2/bash-context-echoed.jsonl` writes the fixture's `bash_command`, the replayed rows render, and the following prompt (seq 16) sends; against `pass1/queue-and-interrupt.jsonl` the control reads Send, then Queue during the turn (the second message shows `1 queued`), ⌘. interrupts and the list reads `Queue paused because you interrupted`, Resume releases it; a draft typed and left survives a tab switch and a page reload. `statusline.spec.ts` runs with `MAWS_CLAUDE_USAGE_DIR=test/fixtures/claude-usage` and asserts the status line reads the fixture's drain-target windows (`5h 51% ⏱…` and `7d 100%`), the 5h popover lists three accounts under Other accounts, one near-limit banner appears for the fixture's 100 % weekly window and does not reappear after a reload, and a fixture session pinned to a different account shows that account's windows.
3. Live, with ClaudeUsage's relay running (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8641/api/hello` prints `200`) and C3's live gate satisfied: in `pnpm dev`, resume a scratch-repository session through the Diagnostics launcher and observe, in order: sending, queueing (a second message during a slow turn shows `1 queued` and is released at the turn's end), steering (⌥Enter during a slow turn folds in with `priority: 'now'` in the journal), stopping (⌘. ends the turn, the queue pauses) and resuming (Resume releases the head) behave as labelled; with `extraSettings.permissions.ask` naming `Bash(git log:*)` (through the launcher's advanced field) a `git log` request replaces the composer, offers only `Allow once`, Enter answers it in the focused pane only (a second pane with another session does nothing on Enter), and the composer returns; in a session with no ask rule, `touch granted.txt` offers `Allow for this session`, choosing it makes `session.status.grants` read `['Bash(touch granted.txt)']` and a second `touch` prompts nothing; a two-question AskUserQuestion form submits both answers and the tool result names them; a plan-mode prompt reaches the plan card and `Keep planning` with feedback returns a second plan, `Implement` restores the pre-plan mode in the next init, and in a fresh session `Clear context and implement` yields a reset boundary and a turn beginning `Implement this plan:`; `!printf MAWS_BASH_LIVE` runs, its output row appears, and `What did my ! command print?` answers `MAWS_BASH_LIVE`; `#MAWS live test note` with target `project` appends `- MAWS live test note` to `<cwd>/CLAUDE.md`; ArrowUp recalls the prompts of this session and then of the terminal session that created the scratch repository; the status line shows cwd, `ctx N% of M` (from `context.sample`), the routing account's 5h and 7d windows matching ClaudeUsage's own panel, cost and `auto`; a session resumed with `Direct` shows windows from `session.getUsage` (or `—` when the engine reports none, the documented fallback of §5.5); the mode chip shows `default` with `This model does not support auto mode` after switching the model to Haiku and requesting `auto`.
4. Mockup 04 vignettes 2 to 5 render in the light theme and the dark theme: the docked approval with grant scopes (vignette 2), the edit-approval variant with file rows (vignette 3, from the `pass2/grant-reapply-start` request whose input is a Bash `touch`, and a synthetic Edit request in `nine-sessions.json`), the slash palette with origin badges beside a registered stub widget (vignette 4; the stub is the harness's), and the usage and context popovers (vignette 5).
5. `pnpm verify` exits 0.

## Plan of Work

Constraints for every milestone are in Constraints; the interfaces are defined once above. Each milestone says what exists at its end, what it touches, what it exposes and consumes, the decisions that are its alone, its edge, and what it proves.

### M1 — Contracts and services

At the end of M1 every X2 entry C7 needs exists in the schema modules and is answered: `session.catalog` from the engine host, `session.history.*`, `settings.usage`, `layout.pickFiles` and `git.lsFiles` from main, `pathForFile` on the bridge; `permission.requested` carries its six optional fields and the requesting agent's id from C3's normaliser; the keymap has the three composer actions; main reads the owner's ClaudeUsage files and emits `settings.usageChanged` when they change; and `window.maws.invoke('settings.usage', { engineSessionIds: [] })` in `pnpm dev` returns the owner's four accounts with their current windows.

Touches: `src/shared/ipc/schema/{session,settings,layout,git}.ts` and `schema.test.ts`, `src/shared/ipc/schema.ts` (`MawsBridge`), `src/preload/index.ts`, `src/shared/graph/events.ts` and `graph.test.ts`, `src/shared/keymap/actions.ts` and its test, `src/shared/usage/types.ts`, `src/shared/composer/history-entry.ts`, `src/engine-host/{ipc,session,normalizer}.ts` and the conformance suite (the six fields appear in the `permission.requested` assertions for `pass2/grant-reapply-start` and `grant-askrule-start`), `src/main/usage/claude-usage-reader.ts`, `src/main/history/prompt-history.ts`, `src/main/git/ls-files.ts`, `src/main/files/pick.ts`, `src/main/index.ts` (one block), `src/renderer/src/ipc/query.ts`, `test/fixtures/claude-usage/**`.

Exposes: everything under Interfaces, X2 additions and X1 extension. Consumes: C3's `EngineSession` handshake state, C4's git conventions and `Draft`, C5's `layout.*` value shapes and `ACTIONS`, C1's router and preload.

Decisions local to M1: the fixture directory is a redacted copy of the owner's ClaudeUsage data made by a script under `test/support/redact-claude-usage.ts` (emails → `<n>@example.test`, display names → `Account <n>`, history trimmed to the newest 40 rows per account, pins trimmed to 12 entries that include one per account) and checked in once; the reader treats a `pins.json` that fails to parse (a torn write) as "keep the previous pins" and retries on the next change, as C4 does for sidecars; `history.jsonl` reads never lock the file and tolerate a torn last line; `git.lsFiles` refuses a `directory` outside the session record's directories (main checks against `session.get`) so the command cannot list arbitrary paths; `layout.pickFiles` answers `data: null` for anything over the caps and never reads a directory's contents; the engine host's catalogue handler reads C3's retained `initialize` response and, if C3 kept only the projections, adds a `catalog` field to `EngineSession` in a delimited block rather than re-parsing the journal; the normaliser change is one block in the `control_request` (`can_use_tool`) case; `QUERY_COMMANDS` gains the read commands listed in the Repository map because `useCommand` refuses names outside it.

Does not touch: any React component, the composer, the card, C5's status line.

Proves: acceptance item 1's `claude-usage reader`, `prompt history`, `git lsFiles`, `catalog` and `ipc schema` suites. Pins: over the fixture directory the reader answers four accounts, the drain target `477e393c…`, `fiveHour` from the newest `session` row and `sevenDay` from the newest `weekly_all` row of each account, one `scoped` entry for `Fable`; `pinsFor` answers only the ids asked; a rewrite of one history file emits `settings.usageChanged` once within a second and an identical rewrite emits nothing; a missing directory answers `available: false`; `session.history.list` merges a MAWS file and a terminal file by timestamp, drops exact duplicates and filters the terminal's rows by `project`; `session.history.append` writes the terminal's record shape and never opens the terminal's file for writing (a spy on `fs.open` modes); `git.lsFiles` over a fixture repository ranks `src/main.ts` above `docs/main-notes.md` for `main`, answers `source: 'walk'` outside a repository and refuses a directory outside the session; `permission.requested` from `pass2/grant-askrule-start` seq 27 validates with `decisionReasonType: 'rule'` and no `matchedAskRule`, and a synthetic request carrying `matched_ask_rule` and `default_to_no` yields both fields; `session.catalog` after a replayed `pass2/auto-routed.jsonl` answers 52 commands with `deep-research` first and `terminalOnly` containing `doctor`; the keymap test still finds every chord unique and `composer.stop` absent from the menu.

### M2 — Request card (X4)

At the end of M2 the card exists with its five variants and its Notice, answers through `session.answer` with validated payloads, binds Enter and Esc through `useKeyChord` inside its own element, reports delivery states, renders in all four placements, and is registered into C5's `requestCard` slot so the sidebar hover, the Overview card and the session pane's docked slot show it; the transcript's `request_slot` shows the pointer or the full card through the two `renderRequest` adapters wired in `App.tsx`.

Touches: `src/renderer/src/request-card/**` and tests, `src/renderer/src/composer/index.ts` (the two adapters; the composer itself is M4), `src/renderer/src/App.tsx` (C7 block), `src/renderer/src/transcript/index.ts` (the `Markdown` export), `e2e/requests.spec.ts`, `src/renderer/src/harness/composer/ComposerHarness.tsx` (the card page, `?request=<fixture>#<seq>`), `harness/main.tsx` (route).

Exposes: `RequestCard`, `scopeOptions`, `toAnswer`, `renderDockedPointer`, `renderInlineRequest`. Consumes: M1's X1 fields, C3's `session.answer` and `attention.request`, C5's slot, `useKeyChord`, `READ_ONLY_TOOLS`, `notices`, C6's `Markdown` and `useTranscriptStore`.

Decisions local to M2 (the variants, scopes, placements and delivery states are Interfaces; what follows is their execution): the card is one component with a `variant` switch, not five components sharing a wrapper, so the frame, header, delivery chrome and keyboard registration exist once (X4's "identical wherever it appears"); the scope group is a Radix `RadioGroup` whose roving focus is what Tab and arrows drive, digits are a card-level key handler; `defaultToNo` makes `request.accept` a no-op that flashes the hint and leaves approval to the Allow button's own activation; the question form keeps every answer in local state and validates completeness before enabling Submit, with previews mounted lazily when a question with previews is visible; the elicitation form is a table-driven mapping from JSON-schema `type` to control and refuses schemas it cannot map (nested objects, arrays) with `Decline` as the only enabled action and a note naming the unsupported field; the dialog variant's option shape is a guess recorded as advisory (no producer exists in the fixtures) and the executor writes the first real payload into Surprises; the question variant's Skip sends a `permission` deny for a `question` item, which C3's broker turns into the wire deny the terminal's Esc produces (both ride `can_use_tool`); if the broker refuses a kind mismatch, Skip is removed and the Decision Log says so; `requests.spec.ts` runs under C5's stub scenario (`MAWS_SESSION_SOURCE=stub:test/fixtures/shell/nine-sessions.json`, `MAWS_E2E=1`) and launches each replay with the `appSessionId` of a scenario record that carries no `engine` entry, so the record exists for the session pane while C3's real statuses and events flow to it through main's read model; `attention.request` is queried with `staleTime: Infinity` (an event never changes) and the card renders a skeleton while it loads; in the hover placement the component renders C5's fallback's controls exactly (Approve once, Deny) so C5's smoke keeps passing; the Notice variant is what the docked slot shows when C5 hands it a non-request kind, and it never blocks the editor (the composer, M4, only swaps for the five request kinds).

Does not touch: the editor and composer (M4 wires the docked swap; M2 renders the docked placement inside the harness and the slot), the status line.

Proves: acceptance item 2's `requests.spec.ts` in replay and item 1's `scope options`, `toAnswer` and `request card placements` suites. Pins: `scopeOptions` over `pass2/grant-reapply-start` seq 30 yields `once`, `session` (detail `Matching touch granted.txt commands`) and `local_settings` (from the `localSettings` suggestion), over `grant-askrule-start` seq 27 yields `once` only, and over a synthetic request with `suppressAlwaysAllow: true` yields `once` only; `toAnswer` for every variant state validates against `RequestAnswerSchema`, a permission deny carries no `scope` (ledger d.17) and a `deny_and_stop` keeps `message`; the question variant's answers for `question-roundtrip` seq 137 with `Red`, `Apple` and `Pear` equal seq 138's; Enter with focus inside the card's `Deny… with a reason` textarea inserts a newline and ⌘Enter sends the deny; a card mounted with `defaultToNo` never answers on Enter; two mounted cards in two panes and Enter with focus in one answer that one only (the suite mounts real `useKeyChord` handlers from C5); the docked card takes focus on mount when the pane held it and returns focus on unmount; `delivered` collapses to `Answered · Allowed once`, `not_pending` shows the notice and closes, `write_failed` shows Retry; the hover placement renders Approve and Deny for a `Read` request and only Open session for a `Bash` request and for a question; `renderDockedPointer` renders the pointer for the docked request id and the full card for a different pending request in the same session; the plan variant's `Clear context and implement` confirms once and sends `clear_and_implement` with `feedback: null`; the elicitation form for `pass2/dialogs` seq 41's schema renders one required text input and accepts `{ color: 'teal' }`.

### M3 — Editor

At the end of M3 the Tiptap editor exists with its document model, chips and atoms, paste and drop handling, the `@` menu, the `/` palette shell with the widget registry, drafts, history and the `!` and `#` modes, all exercised in the `#composer` harness against a scratch repository and the catalogue of a replayed session; `serializeDraft` is pure and pinned by fixtures.

Touches: `src/renderer/src/composer/editor/**`, `mentions/**`, `plus-menu/PlusMenu.tsx`, `modes/**`, `stores/{composer,catalog}.ts` and tests, `test/fixtures/composer/*.json`, `e2e/composer.spec.ts` (the editor half), the harness page, `package.json` (Tiptap).

Exposes: the editor component, `serializeDraft`, `classifyPaste`, `historyNavigation`, `rankItems`, `registerSlashWidget`, `useComposerStore`, `useCatalogStore`. Consumes: M1's commands, C4's `session.drafts.*`, C6's `useTranscriptStore.rows`.

Decisions local to M3 (the model, serialisation, caps, drafts, history and menus are Interfaces; what follows is their execution): the `Pasted` and `Mention` node views are `ReactNodeViewRenderer` chips with `contentEditable={false}`; a mention chip's label is the path's last two segments and its title the whole path; the `@` and `/` popups are the suggestion plugin's `render` with `ReactRenderer`, positioned by the plugin's built-in Floating UI support, `role="listbox"` with `aria-activedescendant`, and they close on Escape without the key reaching C5's dispatcher (the editor root is `data-key-sink="composer"`); the palette's item list is memoised per (query, catalogue revision, registered widgets) and never exceeds 40 rows; the `/` trigger with `startOfLine: true` means a `/` typed mid-sentence is a character, matching the terminal; paste classification runs on `clipboardData.items` in order and takes the first image item over text so a screenshot with an HTML fallback attaches once; images are downscaled off the main thread's paint with `createImageBitmap` and an `OffscreenCanvas`; drop targets are the whole composer surface with a drop ring, and a drop of a directory inserts a mention of the directory; the draft write is a `session.drafts.set` per app session with the last write winning and never awaited on the render path; serialisation tests operate on Tiptap JSON constructed through a headless `Editor` from `@tiptap/core` (no `element`; v3 supports mounting later) and, if headless construction fails under happy-dom, through `getSchema(extensions)` and `Node.fromJSON` from `@tiptap/pm/model`, recorded in the Decision Log; key handling, popups and the IME path (`isComposing` never sends) run only in Playwright over the harness.

Does not touch: the strip, submit control, queue list, docked swap (M4), the status line.

Proves: acceptance item 2's `composer.spec.ts` editor cases and item 1's `serializeDraft`, `paste and drop`, `history navigation`, `slash and @ ranking` suites. Pins: a doc with two paragraphs and a hard break serialises to `a\nb\nc`; a `file` mention with a space in its path serialises to `@"docs/a b.md"`; an `agent` mention to `@agent-Explore`; a `pasted` atom of 40 lines to `<pasted_content id="HHHH">` with a trailing newline and the four-hex id derived from the session id (fixture: session `ae4e4257-…` → the executor records the id); typed `<pasted_content>` is neutralised; a doc whose text is `!ls -la` yields `mode: 'bash'` and the command `ls -la`, `# note` yields `memory`; one image and text yield an image block before a text block, an image alone yields no text block; `display` reads `[Pasted text #1 +40 lines]` and `[Image #1]`; a 1,024-character paste stays inline and a 1,025-character one becomes an atom, as does an 11-line paste; a PNG over 5 MiB after downscale is refused; history navigation over `[a, b, c]` with a draft `d` yields `c`, `b`, `a`, `a` (stop), then `b`, `c`, `d` (restored), and an edit at `b` ends navigation; `rankItems('mo', catalogue)` orders `model` before `memory` before `mcp` and the MAWS action `Open Overview` last; the palette disables `doctor` (terminal-only) and enables `/model` once `registerSlashWidget('model', …)` runs; `session.drafts.set` is called once 750 ms after the last of five quick edits and with `null` for an emptied editor.

### M4 — Composer surface

At the end of M4 the composer slot is real: the context strip with its six chips, the editor of M3, the attachment strip, the queue list, the submit control with its five states, the docked-card swap, edit-and-resubmit with the fork seam and the rewind alternative, `composer.stop` and `composer.focus`, and the dev-only resume launcher; a live-shaped replay session can be driven end to end from the UI.

Touches: `src/renderer/src/composer/{Composer.tsx,index.ts}`, `strip/**`, `submit/**`, `queue/**`, `resubmit-seam.ts`, `stores/queue.ts` and tests, `src/renderer/src/app/Diagnostics.tsx` (C7 block), `src/renderer/src/App.tsx` (`registerSlot('composer', Composer)`, the `editAndResubmit` adapter), `e2e/composer.spec.ts` (the surface half).

Exposes: `Composer`, `prefillComposer`, `submitState`, `registerResubmitProvider`. Consumes: M2's card, M3's editor, C3's `session.send/steer/interrupt/queue.*/setPermissionMode/setModel/setEffort/listModels/applyFlagSettings/listPermissionRules/launch`, C4's `git.watch/unwatch/branches`, C5's `sessions` store, `useKeyChord`, `runAction`, `openSession`.

Decisions local to M4 (the state table, the queue rows, the strip and the seam are Interfaces; what follows is their execution): the composer subscribes to `session.queue` and `session.status` for its session through C5's subscription module and keeps nothing the stores already hold; the docked swap keys on the oldest pending item of the five request kinds from the attention store, so C5's slot rendering and C7's swap agree on the item; the queue's inline edit reuses the same editor extensions in a one-line variant and writes `session.queue.edit` with the serialised content; Delete on an `uncertain` entry asks nothing (the banner already explains) and Resume on it is `setPaused(false)`; the mode chip's cycle order and the `bypassPermissions` confirm are advisory copy; the strip's git watch is per composer mount and the branch chip renders `—` until the first `git.watch` answer; the resume launcher is rendered only when `import.meta.env.DEV` is true (a renderer-side gate is enough for a dev affordance C10 removes; the production e2e builds never show it and drive `session.launch` through `window.maws` as C3's e2e does), and it carries an `extraSettings` JSON field and a `Direct` checkbox for the acceptance's ask-rule and direct cases; `composer.focus` focuses the focused pane's editor and, if a card is docked there, the card; a foreign-live session never mounts the composer (C5's holder notice replaces the slot) and a session whose `status` is null (exited before this launch) mounts the composer disabled with the reason.

Does not touch: the status line, usage.

Proves: acceptance item 2's remaining `composer.spec.ts` cases and item 1's `submitState` and `queue list` suites. Pins: every row of the `submitState` table; over `pass1/queue-and-interrupt` in replay the control reads Send, then Stop with an empty editor during the turn, then Queue with text, the list shows `1 queued`, ⌘. writes `interrupt`, the header reads `Queue paused because you interrupted`, Resume writes the queued `user` frame; a `session.queue` payload with an `uncertain` head renders the warning row with Resume and Delete and no Edit on a `submitting` sibling; ⌥Enter with text during a turn calls `session.steer` and the plain Enter calls `session.send`; a docked permission hides the editor without unmounting it (the draft text is intact after the answer); `prefillComposer` with `editing` shows the edit banner, Esc leaves it, and Send without a provider opens the rewind dialog whose confirm calls `session.rewind` with the transcript's newest user uuid as `lastSeenMessageUuid`; with a registered provider, Send calls `forkFrom` and opens the returned session; the mode chip shows the `effective` mode from `session.setPermissionMode`'s answer and the refusal words for `auto_mode_model`; `+ dir` calls `applyFlagSettings` with the existing directories plus the picked one; the Diagnostics launcher issues `session.launch` with `resume.fork: false` and no `sessionId`.

### M5 — Status line popovers, usage and the near-limit banner

At the end of M5 the six status-line buttons open their popovers, the 5h and 7d fields show the session's account windows from the shared ClaudeUsage read (the drain target's for an unpinned session, the pinned account's otherwise), a direct session reads the engine's `get_usage` instead, and a window at or over 90 % raises one banner in C5's banner host that stays away after dismissal across reloads.

Touches: `src/renderer/src/statusline/**` and tests, `src/renderer/src/stores/usage.ts` (C5's, extended), `src/renderer/src/session/StatusLine.tsx` (C5's, the popover wiring), `e2e/statusline.spec.ts`.

Exposes: the popovers, `nearLimitBanners`, `windowsFor`. Consumes: M1's `settings.usage` and `settings.usageChanged`, C3's `session.getContextUsage`, `session.getSessionCost`, `session.getUsage`, C5's `notices` and `layout` stores, the `usage.banners` layout key.

Decisions local to M5 (the reader, shapes, selector and banner rule are Interfaces; what follows is their execution): the context popover fetches on open with `staleTime` 10 s and shows the digest's percentage while loading; the cost popover's per-model table comes from the transcript store's last `usage.sample` when present and `session.getSessionCost` otherwise; the reset countdown re-renders every 30 s while a popover is open and every 5 minutes in the line; the direct fallback polls only while the session's tab is visible (C5's `session.setVisible` truth is the composer's own mount plus `document.visibilityState`); the banner rule runs in the renderer over the usage store on every change and posts through `banner()` with an `id` equal to the key, so a re-post is a no-op inside C5's store as well; dismissal writes the key into `usage.banners` through the layout store (debounced by C5).

Does not touch: the accounts view, the sign-in hand-off, settings screens (C11).

Proves: acceptance item 2's `statusline.spec.ts` and item 1's `near-limit banner` suite. Pins: `windowsFor` returns the pinned account's windows for a record whose engine id is in `pinsFor`, the drain target's otherwise, and the direct fallback's for `gateway.mode === 'direct'`; `nearLimitBanners` over a snapshot with one 92 % 5-hour window and one 100 % weekly window yields two keys, none for 89 %, none for a past `resetsAt`, and the same snapshot twice yields the second set empty; a dismissed key in `usage.banners` is never yielded; the 5h popover lists `Other accounts` with the drain target marked; the context popover's `Compact now` is absent when the catalogue lacks `compact`; the status line reads `—` for both windows when `available` is false and shows the tooltip.

### M6 — Live acceptance with C3 and the mockup checklist

At the end of M6 C7's acceptance has run as written: items 3 and 4 observed live on the owner's Mac through the relay in auto mode with C3's pinned binary, items 1, 2 and 5 green, the Surprises and Decision Log carrying what the real engine and the real ClaudeUsage files said, the residue bullets final, and the branch ready for its reviewer-medium review.

Touches: `e2e/*.spec.ts` only where the live run corrects an expectation, this document's Progress, Surprises and Decision Log, and any acceptance-driven fix in C7's own files.

Exposes: nothing new. Consumes: everything.

Decisions local to M6: the scratch sessions are created in the terminal in a fresh git repository under `/tmp` with one commit (`claude` interactive, one exchange, `/exit`), which C4 discovers within seconds; every live turn runs on Sonnet with `maxBudgetUsd: 0.5` through the launcher; the ask-rule session uses the launcher's `extraSettings` field; the plan-mode case sets `plan` through the mode chip; the `+ dir` case verifies through `session.listPermissionRules.workspaceDirectories` and, if flag settings do not add a directory, records the finding and the "Restart with directory" fallback; the dialog variant is exercised only if a producer appears (none is expected); the mockup checklist is walked in both themes with screenshots saved under `docs/doperpowers/plans/shots/c7-*.png` for the review; the executor records the observed cost sum.

Does not touch: `docs/charter.md`; anything under `src/engine-host/` or `src/main/` beyond a fix the acceptance forces, recorded.

Proves: acceptance items 3, 4 and 5, then the whole list 1 to 5 executed in order and ticked in Progress with timestamps.

## Concrete Steps

Working directory for everything: the C7 worktree, created from master after C3 and C6 have merged: `git worktree add ../MAWS-c7 -b c7-composer-requests master`, shown here as `/Users/new/Developer/GitHub/MAWS-c7`.

M1:

```
cd /Users/new/Developer/GitHub/MAWS-c7
pnpm install
pnpm test -- src/shared src/main/usage src/main/history src/main/git/ls-files src/main/files src/engine-host/ipc src/engine-host/normalizer
pnpm dev
```

In the dev window's console: `await window.maws.invoke('settings.usage', { engineSessionIds: [] })` → `{ ok: true, value: { available: true, accounts: [ …four… ], drainTarget: '…', … } }`; `await window.maws.invoke('git.lsFiles', { directory: '<a session directory>', query: 'main', limit: 10 })` → `{ ok: true, value: { paths: [...], source: 'git' } }`.

M2:

```
pnpm test -- src/renderer/src/request-card
pnpm build && MAWS_ENGINE_REPLAY=1 pnpm e2e -- e2e/requests.spec.ts
```

Expected:

```
Running 5 tests using 1 worker
  ✓  e2e/requests.spec.ts  a replayed permission docks, Enter answers it in the focused pane only, the composer returns
  ✓  e2e/requests.spec.ts  a question form submits every answer as the fixture recorded
  ✓  e2e/requests.spec.ts  an elicitation form accepts the fixture's content
  ✓  e2e/requests.spec.ts  a session-scoped allow carries the fixture's updatedPermissions
  ✓  e2e/requests.spec.ts  the Overview card and the hover card answer by their own controls
  5 passed
```

M3 and M4:

```
pnpm test -- src/renderer/src/composer
pnpm dev:harness      # then open #composer?repo=/tmp/maws-c7-scratch&fixture=pass2/auto-routed
pnpm build && MAWS_ENGINE_REPLAY=1 pnpm e2e -- e2e/composer.spec.ts
```

Expected: the harness page shows the composer over a scratch repository with the replayed catalogue; the spec's cases named in acceptance item 2 pass (`editor sends, queues, steers, stops and resumes as labelled`, `paste and drop attach`, `@ and / menus`, `history recalls`, `bash mode runs through the engine`, `drafts survive`).

M5:

```
pnpm test -- src/renderer/src/statusline src/renderer/src/stores/usage
pnpm build && MAWS_CLAUDE_USAGE_DIR=$PWD/test/fixtures/claude-usage pnpm e2e -- e2e/statusline.spec.ts
```

M6:

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8641/api/hello      # must print 200
mkdir -p /tmp/maws-c7-scratch && cd /tmp/maws-c7-scratch && git init -q && git commit -q --allow-empty -m init && claude   # one exchange, /exit
cd /Users/new/Developer/GitHub/MAWS-c7 && pnpm dev                              # Diagnostics → Resume live on the scratch session
pnpm verify
```

Then the numbered observations of acceptance item 3 in order, the mockup checklist of item 4, and `pnpm verify` exiting 0.

## Residue decisions (C7, 2026-09-28)

Ready to paste into the charter's C7 section under "**Residue decisions (C7, 2026-09-28):** what the design left to the child, settled here; the execution document `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md` carries the interfaces, milestones and gates. Grades: binding where a sibling codes against the outcome or the design binds it, advisory where a later child may overturn with a dated line here."

- *Editor and document model*: Tiptap 3.31.3 (exact, the whole family on one version) with a plain-text schema: `Document` carrying an `attachments` attribute, `Paragraph`, `Text`, `HardBreak`, `Placeholder`, `UndoRedo`, `Mention` with two triggers (`@` for context, `/` for the palette, the terminal's trigger rules), a `Pasted` atom for long pastes, `FileHandler` for paste and drop, and one keymap extension; no marks, headings or lists (the model reads markdown from the text). The doc is Tiptap JSON and is what C4's `Draft.doc` stores; images and PDFs ride in `doc.attrs.attachments` (up to 4 MiB persisted), so a draft restores whole. Alternative: a textarea with a chip overlay, rejected because atoms, undo and IME are what an editor library exists for. Advisory (§4.7).
- *Serialisation to the wire*: pure `serializeDraft(doc, { sessionId, cwd })`: text is paragraphs joined by newlines; a file mention is `@<path>` (quoted when it holds whitespace), an agent mention `@agent-<name>` (the forms the engine's `at_mentioned_files` and `agent_mentions` producers resolve, SPEC 11 §11.8, so the engine attaches the file or the agent hint itself and nothing is read app-side); a pasted atom is `<pasted_content id="HHHH">…</pasted_content>` with the terminal's id derivation and its neutralisation of typed tags (SPEC 42 §42.15); with no attachments `content` is the string, otherwise `[images…, documents…, { type: 'text' }]` as Messages API blocks (SPEC 45 §45.15.1 admits them on the stdin `user` frame); `!` and `#` at offset 0 select the bash and memory modes. Caps: images downscaled to 1568 px and refused over 5 MiB, PDFs over 32 MiB, a text paste becomes an atom over 1024 characters or 10 lines. C6 renders later `text` attachments and `<pasted_content>` segments as `text` attachments in the bubble (overlap, C6 adopts or adapts). Binding on the forms the engine resolves; advisory on the caps.
- *Slash palette sources and ranking*: the engine's own catalogue is the source, through a new engine-host command `session.catalog` (the `initialize` response's `commands` with descriptions and argument hints, `agents`, the latest `system/init`'s `skills` and `terminal_slash_commands`, refreshed by `commands_changed` and the X1 `session.commands` event), because `system/init` carries names only and the engine has already merged builtin, plugin, project and user commands as the terminal sees them; MAWS actions come from C5's action table through `runAction`. Origin badges: Engine (`builtin`, no `:`), Skill (in `skills`), Plugin (a `:` in the name), Custom (the rest), MAWS. Ranking is deterministic and ours (exact, prefix, substring, subsequence on the name, then description word prefix; origin order and a recent-use tier), never cmdk's. A terminal-only command (`terminal_slash_commands`) or one on C11's widget list opens the registered widget (`registerSlashWidget`) and is disabled with a hint until C11 registers it; every other command inserts `/<name> ` as text for the engine to parse. Alternative: reading command and skill files from disk through C4, rejected because the engine's merged view is the truth the terminal shows. Binding on `session.catalog` and the widget registry (C11 codes against them); advisory on ranking and badges.
- *Typed `@` context*: files from a new main command `git.lsFiles` (`git ls-files --cached --others --exclude-standard` cached 10 s, a bounded walk outside repositories, a subsequence scorer), agents from the catalogue, and skills listed under `@` but inserting `/<skill> ` at the start of the document because the engine has no skill mention. Advisory.
- *Attachments, paste and drop, "+" menu*: paste and drop reach the renderer as `File` objects; a dropped file's path comes from `webUtils.getPathForFile` exposed as `MawsBridge.pathForFile` (one additive line in `src/shared/ipc/schema.ts` and the preload), picked files through a new main command `layout.pickFiles` (native dialog; bytes returned only for images and PDFs under the caps); non-image files become `@path` mentions, pathless files become pasted atoms. Binding on the sandbox rule (nothing loaded by path in the renderer); advisory on the mechanism.
- *Submit control and queue list*: a pure `submitState` table over `EngineSessionStatus`, the queue and the editor decides Send, Queue, Steer (⌥Enter or the caret menu), Stop (an empty editor during a turn, and ⌘. always) and Resume (a paused queue); Enter sends in a single-line doc, ⌘Enter always, Enter inserts a newline once the doc is multi-line (§5.8). Queue rows map C3's states: `queued` with Edit, Delete, Steer (`session.queue.promote`); `uncertain` at the head with a warning, Resume and Delete; `submitting` as `Sending…` without actions; `released` unlisted (it is the running turn); the paused header reads `Queue paused because you interrupted`. Binding on the mapping of C3's states; advisory on chords and copy.
- *Request card (X4)*: one component with a variant switch and a placement switch; per kind: permission (bounded tool preview, requester named from the item's `agentId`, scope group, `Deny… with a reason`, `Deny and stop`), question (radios or checkboxes, `Other…` free text, previews in a sandboxed `srcdoc` frame, Submit only when complete, Skip as a permission deny), plan (C6's `Markdown`, Implement, Keep planning with feedback, Clear context and implement with one confirm), dialog (options from the payload or Continue and Stop; shape unverified, no producer in the fixtures), elicitation (a form from `requested_schema`, Accept, Decline, Cancel; `url` mode opens the link). Answers are `toAnswer(state)` and validate against C3's `RequestAnswerSchema`. Scope options: `once` always, `session` unless downgraded, `local_settings` only from an engine `localSettings` suggestion and never when downgraded; downgraded is `decisionReasonType === 'rule'`, `matchedAskRule` present or `suppressAlwaysAllow` (C3's broker downgrades exactly these). `defaultToNo` disables Enter-approval. Placements: docked (hides the editor without unmounting it, takes focus when the pane had it), card, hover (read-only tools, click only, C5's rule), inline (the full card; a pointer row when the same request is docked in that pane). Delivery: answering, delivered (collapsed line until the item retires), not_pending, write_failed with Retry. Binding (X4, §5.1, C3's answer contract); advisory on copy and bounds.
- *X1 additive extension*: `permission.requested` gains optional `decisionReason`, `suppressAlwaysAllow`, `defaultToNo`, `matchedAskRule`, `requiresUserInteraction`, `mcpServer`, filled by C3's normaliser from the `can_use_tool` request, which also sets `agentId` from the request's `agent_id`; the ledger's section (b) records it. Reason: the card must not offer scopes the broker will downgrade and must honour `default_to_no`. Binding (X1 additive, ruling 6).
- *Status line and usage*: main reads ClaudeUsage's files (`accounts.json`; `pins.json` for the drain target and the session-to-account pins; `history/<uuid>.jsonl`'s newest row per `limitKey`, where `session` is the 5-hour window, `weekly_all` the 7-day window and `weekly_scoped#<Model>` a per-model week; no relay endpoint exists for usage), watches them with `fs.watch` and a 60 s floor, and answers `settings.usage { engineSessionIds }` and emits `settings.usageChanged`; the renderer's `usage` store (C5's, extended) selects a session's windows by its pin, else the drain target; a direct session polls `session.getUsage` instead (D-19). Popovers: cwd, context (`get_context_usage`, Compact now when `/compact` is available headless), 5h and 7d (the account, three window rows, other accounts, C11's hand-off seam), cost (`get_session_cost` and per-model usage), mode. The near-limit banner posts once per (account, window, reset time) at 90 % through C5's banner host and stays dismissed through the layout key `usage.banners`. Binding on the sources (D-17, D-19, §5.5); advisory on the threshold and layout.
- *History storage*: ArrowUp walks this session's own prompts from the transcript store, then a merged global list answered by main (`session.history.list`): MAWS's `<userData>/prompt-history.jsonl` in the terminal's record shape plus, read-only, the terminal's `~/.claude/history.jsonl` filtered by project, so prompts typed in a terminal recall in MAWS; MAWS never appends to the terminal's file (D-12), a P1 candidate once the format proves stable. Advisory.
- *Edit-and-resubmit*: C6's `editAndResubmit` prefills the composer in an edit mode; Send calls the `ResubmitProvider` C10 registers (fork, rewind in the fork, send) and, until C10, offers the explicit alternative of rewinding this session to that message (`session.rewind` with the transcript's newest user uuid as `lastSeen`) and resending; forking stays the default and rewind the explicit action (§4.2). Binding on the seam's shape (C10 codes against it); advisory on copy.
- *Context strip*: project, location, a read-only branch chip over `git.watch` (creating or switching branches under a live engine is C10's), model and effort from `session.listModels` through `session.setModel` and `session.setEffort` (C11's widget replaces the menu when registered), the mode chip showing only the engine's effective mode with the five refusal codes in words and ⇧Tab cycling `default → acceptEdits → plan → auto`, and `+ dir` through `session.applyFlagSettings { permissions: { additionalDirectories } }` because `/add-dir` is gated to remote entrypoints headless (SPEC 28 §22), with "Restart with directory" as the recorded fallback. Advisory.
- *Keyboard map entries*: `composer.steer` (⌥Enter, composer scope), `composer.stop` (⌘., pane scope), `composer.focus` (⌘L, app scope), renderer sink, no menu placement; everything else the composer answers is editor-local. Advisory.
- *Dev-only resume launcher*: the Diagnostics tab gains a `Resume live` control (unpackaged only) that launches `session.launch` with `resume` for an existing record, the only product-shaped way to put a live process behind a record before C10; C10 removes it. Advisory.
- *Testing*: vitest happy-dom for the pure serialisation over Tiptap JSON (headless `Editor`, or `Node.fromJSON` if happy-dom refuses), paste classification, history navigation, `submitState`, queue rows, scope options, `toAnswer` against `RequestAnswerSchema`, card placements and delivery states (with C5's real `useKeyChord`), ranking, the banner rule; vitest node for the usage reader over a redacted fixture directory, prompt history, `git.lsFiles`, the catalogue handler; Playwright over the `#composer` harness and C3's replay launch (`MAWS_ENGINE_REPLAY=1`) for keys, popups, paste, drop, the request round trips against `permission-roundtrip`, `question-roundtrip`, `pass2/dialogs`, `pass2/grant-reapply-start`, `pass2/bash-context-echoed` and `pass1/queue-and-interrupt`, and the status line over the fixture directory; the live acceptance with C3 through the relay. Advisory.

## Surprises & Discoveries

- Observation: the engine's stdin `bash_command` is documented as "output is not appended to the conversation transcript" (SPEC 45 §45.15.2), which is why C3's echo frame exists; the SPEC states no restriction on issuing it during a turn, so the composer keeps `!` enabled mid-turn until a live run says otherwise.
  Evidence: `~/claude-code-bundle/2.1.283/SPEC/45-headless-and-sdk-protocol.md:3697`.
- Observation: `/add-dir`'s headless variant is enabled only for remote entrypoints (`isNonInteractive() && remoteClientEntrypoint()`, rejecting `claudecode`), so the strip's `+ dir` cannot send the command; flag settings carry the directory instead.
  Evidence: `SPEC/28-slash-commands.md:754`.
- Observation: ClaudeUsage exposes no usage endpoint on its relay; the only local sources are its files, whose shapes were read from the owner's machine (`accounts.json` array; `pins.json` with `drainTarget` and 2,780 pins; `history/<uuid>.jsonl` keys `session`, `weekly_all`, `weekly_scoped#Fable`).
  Evidence: `claude-usage-menubar/Sources/ClaudeUsageGateway/RequestPipeline.swift:188` (`/api/hello` only); `~/Library/Application Support/ClaudeUsage/history/fa95bd34-….jsonl` tail: `{"limitKey":"session","percent":51,"recordedAt":"2026-09-28T15:10:29Z","resetsAt":"2026-09-28T16:09:59Z"}`.
- Observation: the `can_use_tool` request carries `suppress_always_allow_rule`, `default_to_no`, `matched_ask_rule`, `decision_reason`, `requires_user_interaction` and `agent_id`, none of which X1's `permission.requested` carried; the card needs the first four, hence the additive extension.
  Evidence: `SPEC/45-headless-and-sdk-protocol.md:4657`.
- Observation: `system/init` lists slash commands by name only; the `initialize` response carries 52 commands with descriptions and argument hints and `agents` with descriptions; `system/commands_changed` re-sends the full list.
  Evidence: `spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl` seq 4 (`commands[0]` = `deep-research`, description present); `pass2/prewarm.jsonl` seq 3.
- Observation: Tiptap 3.31.3 is the registry's `latest` (2026-09-04); `@tiptap/extension-file-handler` is MIT and open in v3; `@tiptap/extension-mention` accepts several triggers through `suggestions[]`; `@tiptap/extensions` bundles `Placeholder` and `UndoRedo`.
  Evidence: `npm view @tiptap/core dist-tags` → `latest: 3.31.3`; the 3.31.3 tarballs' `dist/index.d.ts` (`suggestions: Array<…>`, `onPaste`, `onDrop`, `export { …, Placeholder, …, UndoRedo }`).

## Decision Log

- Decision: verification call for C7: per-milestone reviews at the astra rung (task reviews on `doperpowers:reviewer-medium`; M2's boundary before M4 starts, since M4 consumes the card, and M3's before M4 for the same reason), and a whole-branch `reviewer-medium` review at M6 (the charter's default for plan children; C3 and C4 were the `reviewer-high` cases).
  Rationale: the branch is renderer-heavy with two pure cores (serialisation, `submitState`) whose tests are the load-bearing checks; the wire-facing parts are thin adapters over C3's reviewed contract.
  Date/Author: 2026-09-28, C7 author.
- Decision: the composer, the card and the status-line popovers are three source directories under `src/renderer/src/` (`composer/`, `request-card/`, `statusline/`) rather than one, and the request card never imports from the composer.
  Rationale: the card is X4 and renders in C5's and C8's surfaces without the composer; a one-way dependency keeps the hover card and the Overview card from pulling Tiptap into their bundles.
  Date/Author: 2026-09-28, C7 author.
- Decision: no `[parent-impact]` is raised. Two contracts are extended additively under ruling 6 (X1's `permission.requested`; X2 entries in four namespaces) and one C1 interface gains a method (`MawsBridge.pathForFile`); nothing binding was found wrong.
  Rationale: the charter's queue, plan, `!`, `#`, X4 and status-line rules all held against the fixtures and the SPEC; the gaps were missing fields and missing commands, all additive.
  Date/Author: 2026-09-28, C7 author.

## Outcomes & Retrospective

Pending — written at finish.
