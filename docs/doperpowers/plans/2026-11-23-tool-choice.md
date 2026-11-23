# Tool choice: which of MAWS's tools a session gets, and which tool asks the questions

> **Tickets:** board ticket 421 (the choice of MAWS's tool groups and of the question tool) and board ticket 420 (the ask loaded up front, every artifact and document tool deferred; the UX wave's landing U1d, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, "O-19, and the first half of #420" and "The second half of #420"). Planned and built together, on one branch.
>
> **Root:** `docs/charter.md`. This document amends X9 (the `maws` tool server), X6 (the launch spec) and X1 (the session record), each additively and each by a dated line (M6). D-1 binds: the engine is driven, never patched.
>
> **Parent pin:** master `86c79d0a3`, the commit every statement about the code below was checked against, **plus board ticket 848** (branch `ux-wave/retire-send-file`, read at `ede21f271`), which retires `send_file`. This plan is written as if 848 has landed: the `maws` server has 18 tools, and Auxiliary is `show_pane` alone. The build starts from a master that holds 848 ("Shared with ticket 848" names the files both touch).
>
> **Revision 2 (2026-11-23).** The adversarial review of the first writing (`a84fa859b`) returned thirteen findings, seven of the first rank. Each was checked in the cited code; one more probe was run because of them (Decision Log 6). What moved: a session's promise about its ask is the session's for good, like its set, because the engine holds a resumed conversation to the tool descriptions it was first sent (P4); a session this build starts always records its set, and a record without one is a session from before; the set a launch gets is resolved once, before the record, the supplement and the launch line; a `/clear` keeps the set on both transcripts; a chat that will start on another machine offers no choice; the engine's own question reaches the project channel; the wire's new shapes are all declared in M1.
>
> **Branch:** `ux-wave/tool-choice`. **Not in this plan:** the sminos question tool in a session MAWS runs (board ticket 600; "What ticket 600 changes" says where it slots in); `session.spawn` carrying a set of its own; an environment variable that overrides the choice.
>
> **The owner's answers this plan stands on.** 2026-11-12 (ticket 420): the ask loads up front and does not block unless the call says so; the four edit tools go back behind tool search ("Seven seconds are fine. Cost of the context token is more important."). 2026-11-23 (ticket 421): work both tickets now; Question "Default" means the engine's built-in AskUserQuestion for now, and sminos's question where its mod runs once ticket 600 lands; MAWS's ask is non-blocking by default; Auxiliary holds only `show_pane`.

## Purpose

A session MAWS launches is given all 18 of MAWS's own tools whatever the work is, and MAWS's own ask in place of the engine's. A coding session that will never make a deliverable still carries the artifact tools' names and instructions, and a person who prefers the engine's question tool cannot have it. After this plan a person chooses, per session, which of MAWS's tool groups the session gets (Artifacts, Documents, Dashboards, Auxiliary) and which tool asks them questions (the engine's, or MAWS's), starting from a default they set once per machine.

Ticket 420 rides with it because it changes the same list: the ask is the session's line to its human and today sits behind tool search, while four artifact tools that serve one kind of work are loaded into every request. After this plan the ask is the one `maws` tool loaded up front, a question it puts does not hold the turn unless the call says so, and every artifact and document tool is found through tool search.

## Words used in this document

- **Set** (`MawsToolSet`): one session's choice: four switches and the question tool.
- **Full set**: every switch on and the question tool MAWS's.
- **Group**: the tools one switch governs ("The groups").
- **Question tool**: `maws` for `mcp__maws__ask`; `engine` for whatever the engine itself offers, today the built-in `AskUserQuestion`. The composer and Settings call the second "Default", the owner's word.
- **A session from before**: a session first launched by a build that predates this plan, or by a host that does. It has the full set and an ask that waits by default, and it keeps both. Its record holds no set; that is how it is told.
- **Spine**: the session service in `mawsd`. **Host**: the engine host. Either may be an older build than the window that talks to it.
- **Spawn row**: the journal's `spawn` meta row a host writes for each launch (`spawnMeta`, `src/engine-host/launch.ts`).

## Probes

Run before this was written, against the scripted Messages API stand-in, so nothing was spent. Scenario `spikes/protocol-probe/scenarios/pass3/uxwave-421-tool-choice.mjs`, fixtures `spikes/protocol-probe/fixtures/uxwave/uxwave-421-*.jsonl`, findings `spikes/protocol-probe/findings-uxwave-421-tool-choice.txt`, five tests in `spikes/protocol-probe/fixtures.test.mjs` ("tickets 421/420"). Engine 2.1.330 (the one installed where it ran; the code was read at 2.1.312, MAWS's tested version, and 2.1.325).

| | Question | Answer | What it decides |
|---|---|---|---|
| P1 | Is an SDK server's tool listed with `_meta["anthropic/alwaysLoad"]` in the request whole under tool search? | Yes. `mcp__maws__ask` is the one `maws` tool in the request's tools; the others are names in the engine's "deferred tools" message. The same with `ENABLE_TOOL_SEARCH` absent: the engine's default is tool search on, for any base URL. | Ticket 420 works as written, on the gateway route and on a direct launch alike (its acceptance 4 is answered). |
| P2 | Does the engine honour `tools/list_changed` from MAWS's server mid-session? | In part. It lists again at once and its own registry follows; an added tool arrives and a deferred tool is withdrawn in words. But a tool that was in the request whole stays there after it left the list (the engine answers a call of it "No such tool available" and never sends it to the server), and the server's instructions are never read again. A resumed session shows the same residue, and keeps the paragraph it was first given. | A session's set is fixed when it starts (D1). |
| P3 | With the built-in ask not disallowed and no `maws` ask listed, does MAWS's question path raise and answer it? | Yes. `AskUserQuestion` is in the request up front, a call raises `can_use_tool` with `requires_user_interaction: true`, and the host's allow with `updatedInput.answers` becomes the tool's result. It is the request `e2e/requests.spec.ts` already draws and answers (the `c7-question` recording). | Question "Default" needs no new card or broker work. |
| P4 | A session started under the old list (the ask deferred, "waits by default"; `artifact_read` always loaded) and resumed under the new one: which description does it read? | The old one. Every request of the resumed session carries the ask as it was first sent, old description and all, and `artifact_read` whole; the new description reaches the model nowhere. | What a description promises is the session's for good. The host keeps the old promise for a session from before (D7). |

## The groups

From `MAWS_TOOL_NAMES` after ticket 848 (18 names):

| Group | Tools | Needs |
|---|---|---|
| Artifacts (11) | `artifact_create`, `artifact_list`, `artifact_screenshot`, `artifact_describe_type`, `artifact_read`, `artifact_publish`, `artifact_upload_asset`, `artifact_list_assets`, `artifact_export`, `artifact_search`, `artifact_delete` | |
| Documents (4) | `artifact_edit`, `artifact_comments`, `artifact_reply`, `artifact_resolve` | Artifacts |
| Dashboards (1) | `artifact_dataset` | Artifacts |
| Auxiliary (1) | `show_pane` | |
| Question (1) | `ask` | listed when the question tool is `maws` |

`artifact_delete` joined the server after ticket 421 was written (U10b); it removes what the core creates, so it is the core's.

**The check the ticket asked for.** The Documents group reaches further than documents, in two ways. (1) `artifact_edit` is the one way to change the blocks of a document and of a dashboard: `artifact_publish` refuses both kinds (`src/engine-host/tool-server/artifact-publish.ts`), and the document tools serve `'document' | 'dashboard'` (`DocumentLikeKind`, `src/engine-host/tool-server/documents.ts`). (2) The three comment tools answer every kind's threads: `dashboardThreadTools(designThreadTools(presentationThreadTools(documentTools(…))))` in `src/engine-host/tool-server/tools.ts`. So:

| | create and read | change | answer comments | bind data |
|---|---|---|---|---|
| html page, file kinds, deck, design | Artifacts | Artifacts (`artifact_publish`) | Documents | |
| document | Artifacts | Documents | Documents | |
| dashboard | Artifacts | Documents | Documents | Dashboards |

With Dashboards on and Documents off a session can bind a dashboard's data and cannot edit its blocks; the reverse edits its blocks and cannot bind. The groups stay the ticket's, named by their tools, and the notes say what each gives ("Edit documents and dashboards, answer comments"; "Bind a dashboard's data"). Moving the three comment tools into Artifacts was weighed and lost: a comment on a document asks for an edit the session could not make.

## Design

Each call with its reason and the strongest alternative it beat.

**D1 · A set is fixed when its session starts.** The composer offers the choice only for a session not yet started; a resume keeps the session's set, and a fork keeps its source's. *Why:* P2 and P4. The engine holds a conversation to the tools it was sent: a set changed in a running session, or at an ordinary resume, leaves the ask offered and failing, leaves the artifact paragraph in a session that lost the tools or missing from one that gained them, and never updates a description. A fork resumes its source's transcript, so it inherits all of it. *Beaten:* the ticket's "changing it after the start applies at a relaunch". A relaunch that renders the prompt anew was not tried; it is a design of its own if the owner wants the change, not a line of this one.

**D2 · A group is removed at the source.** The host builds each session's list and instructions from its set; `tools/list` and the paragraph both leave out what is off. *Why:* the ticket's point 6, and P2 shows the engine tells the model about tools by name. *Beaten:* `--disallowedTools` per tool, which leaves the instructions naming tools the session cannot call and puts 18 names on the launch line.

**D3 · A session this build starts records its set; a record without one is a session from before.** The set is an optional field on the session record and on the launch spec. The spine writes it for every session it starts on a host that knows it, the full set included. *Why:* P4 makes "started under this plan" a fact the session carries for life (D7), and it has to be told from "from before" at every later resume, fork and adoption. One field says both: what the session has, and that it has this plan's ask. *Beaten:* writing the set only when it is not full, the first writing's rule, which kept a default session's record byte for byte and could not tell a new full-set session from an old one. Older readers are not hurt: a window reads a command's output tolerantly (`readCommandOutput`), the index gains a nullable column, and a host is sent the field only if it lists the capability (D8).

**D4 · The default is per machine, in a file of its own.** `<profile>/machine-session-defaults.json`, beside `machine-settings.json`, read and written by the spine, served on `machineSettings.*` as the route's default is. *Why:* a session started with no composer (`session.spawn` from another machine) runs on the machine's spine with no window, so the default has to be the machine's. And `machine-settings.json` "stays at version 1 with no new property (an older build strict-parses it, and a changed `version` literal is a wire major)" (`src/shared/ipc/schema/settings.ts`, P5 O7 M9). *Beaten:* a new key under `engine` beside `launchProfile`, the ticket's own suggestion: one line of schema, and it breaks every older build that shares the profile. The file is read loosely (unknown keys kept on a rewrite), so the next per-machine default a later build adds needs no third file; M9's strict one-purpose file lost to that.

**D5 · The default is copied into the intent when the intent is made.** `SessionService.create` seeds a new intent's set from the machine's default, as it seeds the route; an intent with no set means the full set. The composer then reads and patches the intent alone. *Why:* one path for the composer and for `session.spawn`, and the same rule the route chip follows. *Beaten:* resolving the default at the start, which follows a later change of the default but needs the window to read the machine's default beside every unstarted intent. A fork's intent carries no set at all: its setup reads its source's record.

**D6 · The question tool is one field of the set, with two values.** `maws`: today's launch (`--disallowedTools AskUserQuestion --allowedTools mcp__maws__ask`, `ask` listed). `engine`: neither flag, no `ask` listed; MAWS does nothing to the engine's question tools. *Why:* "Default" then means "whatever the engine offers", which is the built-in today and sminos's tool where ticket 600 makes its mod run, with no change to what is stored. *Beaten:* three values naming each tool, which would have to be migrated when 600 lands. The factory default stays `maws`: acceptance 3.

**D7 · The ask's promise is the session's, like its set.** A session this build starts is listed the ask with the new description and does not wait when `blocking` is absent. A session from before is listed the ask with the description it has always had and waits, at every later launch. The host writes what it serves in the spawn row (`askBlocksByDefault`); its own ask tool, the normaliser and an adopter read the default from the launch (no row, or a row without the key: wait). *Why:* P4. A resumed session reads the description of its first launch whatever the server lists, so a host that stopped waiting for it would break a promise the model can still see. And three readers default `blocking ?? true` today (`src/engine-host/tool-server/ask.ts`, `src/engine-host/normalizer-controls.ts`, `src/renderer/src/transcript/model/derive.ts`) over journals that hold blocking asks with no `blocking` key (`pass3/p1-maws-ask-blocking`); flipping the constant would re-read each as a question that never waited. *Beaten:* (a) flipping the constant; (b) a default per launch, the first writing's rule, which P4 refutes; (c) reading the default out of the journaled `tools/list` answer, which costs the normaliser a parse of every list for one boolean and still needs the old description served. The strongest alternative is not beaten on engineering: making `blocking` required in the listed schema, with a description that says to pass `false` unless the next step needs the answer. Every call then says what it wants, an absent value keeps meaning "wait" in every record and every session, and none of the per-session machinery below is needed. It lost because the owner asked twice for a default ("Open for the owner", 1).

**D8 · One answer per attempt to "what does this launch get", and the record says it.** Before a launch's record, supplement or line is made, the spine resolves the set this attempt serves, once. A new session on a host that lists the capability `engine.mawsTools`: the intent's set. A new session on an older host: nothing is sent, the session is one from before, and its record holds no set, since that is what it gets. A resume or a fork of a session that has a set, on a host that does not list the capability: refused, with a sentence; a session never runs under another list than its own (D1). *Why:* the first writing took the set off the spec after the supplement had been chosen from it, so an older host could be told "use the native AskUserQuestion" with that tool disallowed. A host older than the spine exists only across an update or after a downgrade, so the refusal is rare and the new session's fallback is short-lived. *Beaten:* refusing the new session too, M9's rule for a route, which is right there because the wrong route spends on the wrong account.

**D9 · Descriptions do not vary by set.** A tool's description is the same in every session of this plan that lists it. `artifact_create` still says "then bind its data with artifact_dataset" with Dashboards off, and a document's guide still names `artifact_edit` with Documents off. *Why:* X9 holds each description exact; 18 descriptions by 2⁴ sets is not a text anyone can review. *Beaten:* cutting sentences by set. If a session is seen stumbling on a named tool it lacks, the answer is a refusal sentence on that call, not a second description. (The ask's two descriptions are by D7, not by set: one is the old text kept for sessions from before.)

**D10 · A linked artifact is still read with Artifacts off.** The read MAWS attaches to a human message that links an artifact (P4-A3, `SessionMaws.withLinkedReads`) uses the host's own `artifact_read` whether or not the session lists it. *Why:* the link is the person's own act, and without the tools the attached read is the only way the agent can see what they pointed at. Acceptance 1's "no artifact text" is about what MAWS gives every session unasked.

**D11 · The composer's control is a Tools submenu of "+".** After Connectors and Plugins, which are the other things a chat is given. It is drawn only where the choice will be honoured: an intent of kind `create`, on a spine that knows the choice, for a chat that will start on this intent's own machine. A chat whose Send goes to another machine (`session.spawn`, whose fields are an allowlist) takes that machine's default, and shows no choice it could not send. *Why:* it adds no chip to a toolbar whose words the cut just counted, a menu item takes keyboard focus, and its note can carry the fact. *Beaten:* a Tools chip beside the mode chip, which shows the choice at rest; it wins if the owner wants a non-default set visible without opening anything.

**D12 · The supplement's ask line has one text per question tool.** Supplement 3 for `maws`, unchanged; supplement 4 for `engine`. Both are chosen from the set the attempt serves (D8). A session's question tool never changes, so what its prompt recorded always equals what the decision wants, and the decision table needs no new row. *Beaten:* one supplement naming both tools, which tells every session about a tool it lacks.

**D13 · The engine's question reaches the project channel.** The channel's fold (`src/services/channel/lane-b.ts`) records a MAWS ask's questions and answers and knows nothing of `question.requested` and `question.answered`, because no session MAWS runs has raised them until now. A session with Question Default would answer its questions in MAWS and leave none in the project's conversation. The fold takes the pair as it takes the ask's.

## What is stored and sent, and what each older build does with it

| stored or sent | this plan | an older build meeting it |
|---|---|---|
| `SetupIntent.mawsTools` (file per intent) | on a `create` intent, when the machine's default or the person's choice is not the full set; a patch that brings it back to the full set removes the key | parses the intent strictly, skips the file (logged, not deleted); the draft reappears under this build. An intent at the full set carries no key. |
| `SessionRecord.mawsTools`; index column `maws_tools` | written once, at `createForLaunch`, for every session started on a host that knows the set; carried to the old transcript's record at a `/clear`; the column through `ADDED_COLUMNS`, no `user_version` change | opens the index and ignores the column; a window reads a record's unknown key away (`readCommandOutput`) |
| `LaunchSpec.mawsTools` (`session.launch`) | sent for every such session, and only to a host listing `engine.mawsTools` | never receives it (D8) |
| the host's stored spec (`saveLaunchSpec`) | the key left out, as `route` is; an adopter takes the set and the ask's default from the spawn row | nothing new |
| spawn row `mawsTools`, `askBlocksByDefault` | written for every launch | reads the row loosely and ignores both ("Known limits", 1) |
| `machine-session-defaults.json` | written at the first change of the default; absent until then | never reads it; its launches are the full set |
| `machineSettings.get` / `.set` / `.changed`: `mawsTools` | on every answer and change; `set`'s own `mawsTools` writes the default | an older spine answers without it, which the window reads as "this machine predates the choice" and draws no control; an older spine drops `set`'s key and its answer says so by carrying none |
| `WIRE_MINOR` | one bump, in M1, for every shape above | |

## Acceptance

Ticket 421's four points and ticket 420's five, as the owner's answers leave them.

- **A1 (421·1).** Each switch, off, removes exactly its group from `tools/list`. Artifacts off also removes the artifact sentences from the server's instructions, and Documents and Dashboards with it. A session with Artifacts off is offered no `artifact_*` tool and is given no sentence about artifacts at launch.
- **A2 (421·2).** Question set to Default: the launch line has neither `--disallowedTools AskUserQuestion` nor `--allowedTools mcp__maws__ask`, `tools/list` has no `ask`, and the built-in raises MAWS's question in the call's row, whose answer reaches the agent and whose question and answer reach the project channel. The built-in waits for its answer; a Default question that does not wait is ticket 600's.
- **A3 (421·3).** With the full set, a session's launch line, `tools/list` names and instructions are what they are on the parent pin, but for ticket 420's two changes (A6, A10). A session from before keeps its list, its paragraph and its ask's old description and default at every later launch.
- **A4 (421·4).** The composer of a session not yet started offers the four switches and the Question choice, starting from the machine's default; Documents and Dashboards cannot be on while Artifacts is off. A resumed or forked session keeps its own set whatever the default is now. Session info shows the set of a session MAWS is running.
- **A5 (421, shape 4).** A session started by `session.spawn` takes the default of the machine it runs on.
- **A6 (420·1).** `tools/list` lists `ask` with `_meta["anthropic/alwaysLoad"]: true` and no other tool with it.
- **A7 (420·2, U1d).** Against the stand-in API under MAWS's gateway launch, with MAWS's own list, `mcp__maws__ask` is in the first request whole and no `artifact_*` tool is.
- **A8 (420·3).** With Artifacts on, the instructions name `mcp__maws__artifact_search` and `mcp__maws__artifact_read`.
- **A9 (420·4).** A direct launch defers as a gateway launch does. Met by P1; the finding is the record.
- **A10 (U1d).** In a session this build starts, a question put with no `blocking` argument returns at once, leaves the turn running and shows as waiting; its answer arrives as a user message naming the askId. `blocking: true` waits. A subagent's ask always waits. In a session from before, and in every journal written before, a question with no `blocking` waits as it did.
- **A11 (420·5, 421 shape 7).** The to-human supplement's ask line names the tool the session has, for both question tools.
- **A12 (U1d).** A first edit of an artifact and of a document still succeeds through tool search, on a real engine. The pull request restates the trade: about 7 s on a session's first edit for about 2,900 tokens of every session's first request (P4-A3, results (a)).

## Interfaces

### §A · The set (`src/shared/maws/tool-set.ts`, new)

    export const MAWS_QUESTION_TOOLS = ['engine', 'maws'] as const;
    export const MawsToolSetSchema = z.strictObject({
      artifacts: z.boolean(), documents: z.boolean(), dashboards: z.boolean(), auxiliary: z.boolean(),
      question: z.enum(MAWS_QUESTION_TOOLS),
    }).refine((set) => set.artifacts || (!set.documents && !set.dashboards), { message: 'documents and dashboards need artifacts' });
    export type MawsToolSet = z.infer<typeof MawsToolSetSchema>;
    export const FULL_MAWS_TOOL_SET: MawsToolSet;                       // every switch on, question 'maws'
    export const isFullSet = (set: MawsToolSet): boolean;
    export type MawsToolGroup = 'artifacts' | 'documents' | 'dashboards' | 'auxiliary' | 'question';
    export const MAWS_TOOL_GROUP = { … } as const satisfies Record<MawsToolName, MawsToolGroup>; // a tool added later does not compile until it has a group
    export const listedTools = (set: MawsToolSet): MawsToolName[];     // MAWS_TOOL_NAMES order
    export const withArtifacts = (set: MawsToolSet, on: boolean): MawsToolSet; // off turns documents and dashboards off; on turns both on

The canonical form has no "documents on, artifacts off": the schema refuses it, and the two controls use `withArtifacts`.

### §B · X9, as amended

- `MAWS_TOOLS.ask` gains `meta: ALWAYS_LOAD`. `artifact_describe_type`, `artifact_read`, `artifact_publish` (`src/shared/maws/tools.ts`) and `artifact_edit` (`src/shared/maws/document-tools.ts`) lose it. This `_meta` is listed to every session, one from before included (P4: what such a session already holds does not move; an ask it never loaded arrives whole).
- `ask`'s description, from "With blocking true (the default)" to its end, becomes: `With blocking false (the default) the call returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile; with blocking true it waits for the answers and returns them. In a subagent the call always waits and returns the answers, as with blocking true.` The listed schema's `blocking` carries `default: false` (`z.boolean().optional().meta({ default: false })`: zod writes the key into `z.toJSONSchema`'s output and the validator still defaults nothing; checked on the repository's zod).
- `ASK_DESCRIPTION_BEFORE_420`: the description as it stands on the parent pin, kept word for word, and listed with a schema that has no default to a session from before (D7).
- `mawsServerInstructions(session: { inAppBrowser: boolean; artifacts: boolean })`. The first paragraph is two constants: `MAWS_ARTIFACT_INSTRUCTIONS` (its first four sentences, through "… call mcp__maws__artifact_search.") and `MAWS_FILE_INSTRUCTIONS` (everything after, which ticket 848 leaves as two sentences on linking a file and where to write one). `MAWS_SERVER_INSTRUCTIONS` stays their join with one space, byte for byte. With `artifacts` false the first paragraph is the file sentences alone. The browser paragraph is as before.
- `TOOL_ERRORS.unknownTool(name, listed)` names the session's tools, not `MAWS_TOOL_NAMES`.
- A session's `tools/list` is `listedTools(set)`, in that order.

### §C · X6, as amended (`src/shared/engine/launch-spec.ts`, `src/engine-host/launch.ts`)

    LaunchSpecSchema: mawsTools: MawsToolSetSchema.optional()   // absent: a session from before (the full set, the ask as it was)
    LaunchPlan:       mawsTools: MawsToolSet; askBlocksByDefault: boolean   // what this launch serves
    spawnMeta(...):   { …, mawsTools: MawsToolSet, askBlocksByDefault: boolean }   // askBlocksByDefault from M2 on
    export const ENGINE_MAWS_TOOLS_CAPABILITY = 'engine.mawsTools';  // src/shared/host/socket-protocol.ts, in PEER_CAPABILITIES.engineHost

`buildLaunch` pushes `--disallowedTools AskUserQuestion --allowedTools mcp__maws__ask` when the launch declares `maws` and `(spec.mawsTools ?? FULL_MAWS_TOOL_SET).question === 'maws'`; `askBlocksByDefault` is `spec.mawsTools === undefined`. The stored spec leaves `mawsTools` out (`saveLaunchSpec`, beside `route`); `SpawnRow` gains `mawsTools?: MawsToolSet` and `askBlocksByDefault?: boolean`, read by `spawnRowOf`.

### §D · The host (`src/engine-host/`)

    SessionMawsHost: toolSet: MawsToolSet; askBlocksByDefault: boolean
    mawsTools(deps): McpToolDefinition[]            // unchanged: every tool
    // SessionMaws lists `mawsTools(deps).filter((tool) => listed.has(tool.name))`, keeps `artifact_read` from the unfiltered list (D10),
    // and lists the ask by `askBlocksByDefault`: ASK_DESCRIPTION_BEFORE_420 and no schema default when true
    pendingAskOf(args, ctx: { toolUseId; requestId; fromSubagent; blocksByDefault: boolean }, openedAt)
    askTool(deps: { …; blocksByDefault: boolean })
    NormalizerState: askBlocksByDefault: boolean   // true at first; set at each `spawn` meta row to `meta.askBlocksByDefault !== false`

- A launch: `toolSet = spec.mawsTools ?? FULL_MAWS_TOOL_SET`, `askBlocksByDefault = spec.mawsTools === undefined`. An adoption (`createAdopter`): both from the spawn row; a row without them is a launch by an older host, so the full set and `askBlocksByDefault = true`.
- The normaliser's flag lives in `NormalizerState`, not on the instance: a page that starts from a checkpoint builds a new normaliser after the spawn row (`cursorAt`, `src/engine-host/session-stream.ts`), and it has to read the same default. `maws.ask.opened.blocking` is `(blocking ?? state.askBlocksByDefault) || fromSubagent(…)`. A journal with no spawn row reads as before.
- `derive.ts`'s fallback for a call with no `opened` event becomes `input?.blocking ?? !ask.asked`.
- The provisional emitter (`tool-server/provisional.ts`) previews a streamed call only for a tool the session lists.
- The engine never sends the host a call of a tool the launch did not list (P2: it answers "No such tool available" itself), so the normaliser's admission by name needs no set.

### §E · The spine (`src/services/sessions/`, `src/services/index/`, `src/services/channel/`)

    SetupIntentSchema / SetupIntentPatchSchema: mawsTools: MawsToolSetSchema.optional()   // a create intent's; absent: the full set
    SessionRecordSchema:                         mawsTools: MawsToolSetSchema.optional()   // absent: a session from before
    C10Settings:                                 mawsTools: MawsToolSet                    // the machine's default; C10_SETTING_DEFAULTS holds the full set
    LaunchInput:                                 mawsTools?: MawsToolSet
    LaunchInit:                                  mawsTools?: MawsToolSet                   // index column maws_tools TEXT (JSON), ADDED_COLUMNS; written once
    servedSet(s, wanted: { kind: 'new'; set: MawsToolSet } | { kind: 'kept'; set: MawsToolSet | undefined }): Promise<{ set: MawsToolSet | undefined } | { refused: string }>

- `create`: the machine's default when it is not the full set, else no key.
- `patch`: a `mawsTools` on an intent of kind `fork` is refused and nothing changes. On a `create` intent a set that is not full is kept; the full set removes the key (D5: an intent with no set is already the full set, and a draft with no key stays readable to an older build).
- `forkIntentOf`: no set. A fork's setup reads its source's record.
- `servedSet`, the one answer per attempt (D8), asked once in `runIntentSetup` and once in `runResume`, before anything is built from it. `new`: the set when the host lists `ENGINE_MAWS_TOOLS_CAPABILITY`, else undefined. `kept` (a resume's record, a fork's source's record): undefined stays undefined; a set on a host that lists the capability is the set; a set on a host that does not is refused: "This session's tools need a newer MAWS on this machine."
- What is built from that one answer: `createForLaunch({ …, mawsTools })`, the spec (`toLaunchSpec`), the owner channel's decision (§F) and, through the spec, the launch line. The automatic retry reuses the spec. `specForHost` no longer needs to take anything off; it asserts a spec with a set is going to a host that lists the capability.
- `bootstrapSpec`: none. It serves no turn.
- `toSessionRecordPatch` does not carry the set; nothing updates it after `createForLaunch`, with one exception: at a `/clear` (`bindRow`, `src/services/index/sessions.ts`) the record made for the old transcript takes the row's `maws_tools`, so the old conversation resumes and forks under the set it was held under.
- The channel's fold: `question.requested` adds one `question` entry per question (its text, its options' labels as choices), `question.answered` one `answered` entry per answer, keyed by the request and the question as the ask's are by the askId and the question's id.

### §F · The supplement (`src/shared/owner/contract.ts`, `src/services/owner/launch.ts`; X18)

    SUPPLEMENT_4.text = `${SUPPLEMENT_HEADER(4)}\n\nThis session runs in MAWS. ${ASK_ENGINE}`
    ASK_ENGINE = 'Ask the human with the native AskUserQuestion; it waits for their answer. Neither `mcp__sminos__AskUserQuestion` nor `mcp__doperpowers__AskUserQuestion` is available here.'
    AppendedText = 'supplement' | 'supplement-engine'

`ownerChannelLaunch` reads `spec.mawsTools?.question`, which is the set the attempt serves: for `engine` the desired state appends `supplement-engine` and records `supplement:4`; otherwise supplement 3, as today. `ASK_HERE` is not edited: it names `blocking: false` and `blocking: true` outright, so it reads true under either default (A11).

### §G · The machine's default (`src/shared/settings/`, `src/services/settings/machine.ts`, `src/shared/ipc/schema/machine-settings.ts`, `src/main/client/machine-settings-mirror.ts`)

    SETTINGS_FILES.sessionDefaults = 'machine-session-defaults.json'
    MachineSessionDefaultsSchema = z.looseObject({ version: z.literal(1), mawsTools: MawsToolSetSchema.optional() })
    resolveMawsTools(file: MachineSessionDefaults | null): MawsToolSet        // the file's, else the full set
    MachineSettingsService: mawsTools(): MawsToolSet; setMawsTools(set: MawsToolSet): Promise<MawsToolSet>
    'machineSettings.get'.output / '.set'.input / '.set'.output / 'machineSettings.changed': mawsTools: MawsToolSetSchema.optional()
    sessionSettingsOf(machine, route?, mawsTools?): C10Settings

Every piece has M9's route as its template, file for file: the rules (`machineRouteRules`), the store opened beside the machine file under the same writer and the same refusal, the key on each answer and change, `set`'s own key, the mirror's "an answer without the key means the daemon predates it". The differences: the file is loose, the write touches no legacy field, and a set equal to the full set is still written (the file then says the person chose it).

### §H · The window (`src/renderer/src/`)

    settings-tab/maws-tools-default.ts: readMawsTools(client, machine), useMachineMawsTools(machine): MawsToolSet | null | undefined, chooseMawsTools(set)
    settings-tab/MawsToolsSettings.tsx: rows 'sessions.tools' and 'sessions.question', after the launch profile's two
    composer/setup-intent.ts (the composer's own view of an intent): SetupIntent gains `kind: 'create' | 'fork'` and `mawsTools?: MawsToolSet`; SetupIntentPatch gains `mawsTools`
    composer/frame/bindings.ts: FrameBindings.tools: ChipBinding<MawsToolSet> | null; intentBindings(hook, state, defaults, tools: { honoured: boolean; elsewhere: boolean })
    composer/plus-menu/PlusMenu.tsx: props gain `tools?: ChipBinding<MawsToolSet> | null`
    tools/session-info/model.ts: two rows in engineSection

`FrameBindings.tools` is set by `intentBindings` alone, when all three hold: the intent's kind is `create`; the intent's machine's spine honours the choice (`useMachineMawsTools(machineOf(appSessionId))` is a set; the component reads it and passes `honoured`); and the chat will not start elsewhere (`spawnTargetOf(appSessionId, projectKey)` is null; passed as `elsewhere`). Its value is `intent.mawsTools ?? FULL`, its `set` goes `through` `hook.patch({ mawsTools })`, and it shares the frame's one disabled reason. Otherwise it is null and the submenu is not drawn: a fork, a started or ended session, an older spine, a chat that will start on another machine. Choosing another machine after making a choice keeps the intent's set for when the person comes back, and sends none.

Session info draws its two rows only for a session MAWS is running (an engine status is held), from `record.mawsTools ?? FULL`. A session MAWS never launched has no `maws` tools, and the pane does not guess for one that is not running.

**The text, under the word cut's rules** (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`, "What the cut builds": few words; a fact is a note in its row, shown on pointing and at once on keyboard focus, and the row's accessible description at all times; never a system `title`). All of it in `copy.ts` files.

| where | at rest | note (on pointing or focus) |
|---|---|---|
| "+" › **Tools** › checkbox items | Artifacts · Documents · Dashboards · Auxiliary | "Create, read and publish artifacts" · "Edit documents and dashboards, answer comments" · "Bind a dashboard's data" · "Open panes for you" |
| the same, Documents and Dashboards while Artifacts is off | greyed (`RefusedMenuItem`) | "Needs Artifacts" |
| "+" › Tools › **Question** (a label, then a radio group) | Default · MAWS | "Claude Code's own question" · "MAWS's question" |
| Settings › Sessions › **MAWS tools** | four switches, each beside its word | row: "What a new session starts with. A session keeps its own." Each word carries its fact as above (`TipWord`). |
| Settings › Sessions › **Question tool** | a `Segment`: Default · MAWS | "Default is Claude Code's own and waits for your answer. With MAWS's the session can go on working while you answer. A session keeps its own." |
| Session info › Engine | "MAWS tools" · the groups that are on, or "None" | |
| | "Question tool" · "Default" or "MAWS" | |

Components: `DropdownMenu.Sub`, `DropdownMenu.CheckboxItem` with the `data-menu-check` indicator (as `panel/PanelHeader.tsx`), `DropdownMenu.RadioGroup` and `RadioItem`, `RefusedMenuItem`, `useRowNote` and `RowNote` for an item's note; `Setting`, `Switch`, `Segment` and `TipWord` from `settings-tab/parts.tsx`; rows declared in `settings-tab/rows.ts`. A checkbox item's select keeps the menu open. Tokens only; no new colour, size or component.

## The settings migration

There is none to run, and that is the design (D3, D4).

- `settings.json` (version 21) and `machine-settings.json` (version 1) keep their schemas and versions. `migrateClientSettings`, `migrateMachineSettings` and the unified chain in `src/shared/settings/defaults.ts` are not touched.
- The default lives in `machine-session-defaults.json`. Absent, unreadable or of a version this build does not know, it resolves to the full set, in memory, with nothing written; an unreadable or unknown file also refuses its own writes, as `machine-route.json` does. `migrateMachineSessionDefaults(input)` validates version 1 and keeps unknown keys.
- The index gains the nullable column `maws_tools` through `ADDED_COLUMNS` (`src/services/index/migrations.ts`), with no `user_version` change, so an older build still opens the file.
- A session from before is not migrated, and must not be (P4): its record has no set, every later launch sends none, and the host serves it the full list, the paragraph, and the ask with its old description and its old default. What does reach it is this build's `_meta`: an ask it never loaded arrives whole, and the edit tools it already holds stay whole.

## Known limits

1. **A downgrade in the middle of a launch.** A host older than this plan that adopts a launch this build made (an older build installed while the session runs) reads none of the spawn row's new keys: it answers every tool of the server, and waits on an ask with no `blocking`. The engine still calls only what it was listed, so the set holds in effect; a question the model expected to return at once waits for its answer instead, and is answered. Nothing is lost. Not fixed: no build can change what an older one does, and the remedy (a holder protocol an older host refuses) ends the session it means to protect.
2. **A re-list on a launch adopted from an older host.** If the engine asks `tools/list` again on such a launch, this host answers with the old description (D7), so nothing moves. The case is here because it is the one place the host lists a description by something other than its own build.
3. **A streamed call of a tool the model was never offered** is refused by the engine; the provisional preview no longer draws it (§D).

## What ticket 600 changes

Nothing stored. A session whose question tool is `engine` already launches with the built-in present, which is the second of 600's three blockers. When 600 makes the sminos mod register its tool in a session MAWS runs and gives its asynchronous answer a way in, such a session has `mcp__sminos__AskUserQuestion` with no change here; MAWS already draws it (`ASK_MOD_TOOLS`, `src/renderer/src/transcript/model/classify.ts`). What 600 edits: `ASK_ENGINE` (a supplement 5 that names sminos's tool where it is registered), the two notes that say "Claude Code's own", A2's last sentence, and, if the owner then wants it, the factory default of `question`.

## Shared with ticket 848

Both branches edit: `src/shared/maws/tools.ts` and `tools.test.ts`; `src/shared/maws/instructions.ts` and `instructions.test.ts`; `src/shared/maws/search-tools.test.ts`; `src/engine-host/tool-server/tools.ts`; `src/engine-host/tool-server/server.ts` and `server.test.ts` (848 answers a call of `send_file` in the unknown-tool branch this plan re-words); `src/engine-host/session-maws.test.ts`; `src/engine-host/normalizer-controls.ts`; `src/renderer/src/transcript/model/derive.ts` (one line here, §D); `e2e/maws-tools.spec.ts` and `e2e/maws-tools-live.spec.ts`; `test/live/maws-tools.live.test.ts`; and the dated X9 lines in `docs/charter.md` and `docs/doperpowers/plans/2026-10-05-p1-extension.md`. 848 alone edits `classify.ts`, `Delivery.tsx`, `src/shared/graph/events.ts`, the File kind's guides, `artifact-publish.ts`, `e2e/deliverables.spec.ts`, `e2e/library-live.spec.ts` and `docs/tech-debt-tracker.md`. This branch is rebased on the master that holds 848 before M1 starts; nothing here is built on a tree that still lists `send_file`. At the rebase, the split of the paragraph (§B) is checked against 848's text as it landed.

## Constraints that bind every milestone

- D-1. Nothing is asked of the engine but its launch line, its control protocol and what `tools/list` answers.
- X9's texts are exact. Every changed description, paragraph and refusal is pinned by a test that holds it word for word, and gets its dated line in M6.
- A full-set session's launch line, list and paragraph are the parent pin's (A3). Each milestone keeps the tests that say so: the line in `src/engine-host/launch.test.ts`, the list in `src/shared/maws/tools.test.ts`, the paragraph in `search-tools.test.ts`.
- No test is deleted to pass. A test that relied on the old default of `blocking` in a session of this build states `blocking: true`.
- Copy lives in `copy.ts`; tests find elements by role and accessible name.
- Gates: class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes`; each e2e group named below through `scripts/ci-gate.sh <worktree> --gates e2e:<group>`; the live runs on a Mac under the load rule (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5). This plan adds cases to existing specs and no spec file, so `default`'s pin does not move.
- The repository is public: no path under a home directory, no address and no machine fact in a fixture, a test or a document.

## Plan of Work

### M0 · The probes (done, on this branch)

The scenario, nine fixtures, the findings and five tests. **Proves:** P1 to P4. `pnpm test:probes`.

### M1 · The wire's shapes, and the set at the host

**At its end.** Every shape this plan adds to the wire is declared, with the one `WIRE_MINOR` bump (the manifest's gate wants the shape and the increment together, capabilities included: `src/shared/ipc/wire.test.ts`). A launch spec may carry a set, and the host serves exactly it: the list, the instructions, the launch line, the spawn row's `mawsTools`. Nothing sends one yet.

**Touches.** New `src/shared/maws/tool-set.ts`. `src/shared/maws/instructions.ts`, `tools.ts` (`unknownTool`). `src/shared/engine/launch-spec.ts`, `src/shared/sessions/intent.ts`, `src/shared/graph/session.ts`, `src/shared/ipc/schema/machine-settings.ts` (the optional keys alone), `src/shared/host/socket-protocol.ts`, `src/shared/ipc/wire.ts`, `wire-manifest.json` and the fingerprint (`pnpm wire:manifest`), `src/shared/machine/address-paths.json`. `src/engine-host/launch.ts`, `launcher.ts` (the adopter), `holder/restore.ts` (`SpawnRow`), `session.ts` (the host's options), `session-maws.ts`, `tool-server/server.ts`, `tool-server/provisional.ts`, `store/file-session-state-store.ts`.

**Proves, unit first.** `tool-set.test.ts`: each group's names; every tool has a group; the refusal of documents without artifacts; `listedTools` for the full set equals `MAWS_TOOL_NAMES`. `instructions.test.ts`: the join equals the parent pin's paragraph; Artifacts off is the file sentences alone, with and without the browser paragraph. `launch.test.ts`: the full set's line unchanged; `engine` has neither flag; the spawn row's set. `session-maws.test.ts`: `tools/list` for each switch off alone, for Dashboards on with Documents off, and for all off; a call of a tool that is off answers `unknownTool` naming what the session has; a linked read attaches with Artifacts off (D10); no provisional preview for a tool that is off. `file-session-state-store.test.ts`: the stored spec has no `mawsTools`. `holder/adopter.test.ts`: an adoption from a row with the set, and from one without. `graph.test.ts`, `intents.test.ts`: a record and an intent without the key parse. `wire.test.ts`. A1 and A2's launch half, at the host.

**Gate.** Class 1a; `e2e:tools` and `e2e:supervisor-daemon` (the adoption path), unchanged and green.

### M2 · Ticket 420: the ask up front and not waiting, the edit tools deferred

**At its end.** A6, A7, A8, A10.

**Touches.** `src/shared/maws/tools.ts` (the `_meta`, the description, `ASK_DESCRIPTION_BEFORE_420`), `document-tools.ts`. `src/engine-host/launch.ts` (the spawn row's `askBlocksByDefault`, written from this milestone on, with the behaviour it certifies), `tool-server/ask.ts`, `session-maws.ts` (the ask listed by the launch's default; the adopter's restore of an acknowledged ask passes it), `normalizer.ts` (`NormalizerState`) and `normalizer-controls.ts`. `src/renderer/src/transcript/model/derive.ts`. `spikes/protocol-probe/`: P1 re-recorded with MAWS's own list (`mawsToolList()` dumped beside the scenario and pinned to `tools.ts` by a unit test, as `p4-maws-tools.json` is by `search-tools.test.ts`), by `node run-pass3.mjs uxwave-421-tool-choice` in `spikes/protocol-probe/` (through `vm-run.sh` on a probe VM, or on a Mac), the fixture naming the engine it ran on; the gate's probe job only runs the tests over the fixtures checked in.

**Proves, unit first.** `tools.test.ts`: `_meta` on `ask` alone; the new sentence and the old description, each word for word; the listed schema's `default: false`, and none in the old one. `ask.test.ts`: no `blocking` in a session of this build returns `asked`; in a session from before, and under a launch adopted from an older host, it waits; a subagent's waits either way. `session-maws.test.ts`: a spec with no set lists the ask with the old description; one with a set, the new. The normaliser's tests: a journal whose spawn row carries `askBlocksByDefault: false` opens an ask with no `blocking` as not blocking, and so does a page that starts from a checkpoint after that row; the recorded journals (no such row) keep their snapshots under `test/snapshots/transcript/` byte for byte. Probes: A7 from the re-recorded fixture.

**E2E.** `e2e:tools` (`e2e/maws-tools.spec.ts`): one new case, "an ask with no blocking argument leaves the turn running and reads as waiting; its answer arrives as a message"; the cases that replay `pass3/p1-maws-ask-blocking` through the real host give its calls `blocking: true` (through `askFixture`, as the async cases already rewrite arguments), since that recording was made under the old default and the replay's launch is this build's. `e2e:design-systems` (`e2e/design-systems.spec.ts`): the ask it builds for the design-system question states `blocking: true`, which it asserts. `e2e:requests` and `e2e:transcript` run unchanged.

**Gate.** Class 1a; `e2e:tools`, `e2e:design-systems`, `e2e:requests`, `e2e:transcript`.

### M3 · The set kept with the session

**At its end.** A set travels from an intent to its record and launch, a resume and a fork keep it, a session from before stays one, `session.spawn` takes the machine's default (still the full set until M4), the supplement follows the question tool, and the engine's question reaches the channel. A2 whole, A3's second sentence, A4's keeping, A5's path, A11.

**Touches.** `src/services/sessions/service.ts`, `record-actions.ts`, `setup.ts`, `resume.ts`, `launch-mapping.ts` (`C10_SETTING_DEFAULTS` gains the full set here), `machine-route.ts`. `src/services/index/sessions.ts`, `migrations.ts`. `src/shared/owner/contract.ts`, `src/services/owner/launch.ts`. `src/services/channel/lane-b.ts`.

**Proves, unit first.** `launch-mapping.test.ts`: a new session's spec carries its set, the full set included; a resume's carries its record's, and none for a record without one; the bootstrap none. `service.test.ts`: `create` seeds from the settings; a patch to the full set removes the key; a patch on a fork is refused. `setup` and `resume` tests for `servedSet`: a new session on a host without the capability gets no set, no supplement 4 and a record without one, with the owner's style on; a resume and a fork of a session with a set on such a host are refused with the sentence; the retry sends the same spec. `side-thread.test.ts` and the fork cases: the source record's set, and none for a source from before. `spawn.test.ts`: the machine's default. `sessions.test.ts`: the column written once; the `/clear` case extended, the old transcript's record carries the set and resumes under it. `migrations.test.ts`. `owner/launch.test.ts` and the contract's tests: supplement 4 word for word; `engine` appends it and records `supplement:4`; `maws` is unchanged. The channel's tests: a request of two questions adds two entries, their answers two more, and a replay adds none twice.

**E2E.** `e2e/sessions.spec.ts` (group `default`, replay; beside "unstarted first send" and "fork in place"): a new chat whose intent was patched to Artifacts off and Question Default writes a spawn row whose `args` hold no `--disallowedTools` and whose `mawsTools` is that set; resumed, and forked, each later launch's own spawn row (told apart by its launch id, not the first row found) says the same. The list itself is M1's unit proof: these recordings hold no `tools/list` request. `e2e:available` (`e2e/sessions-available.spec.ts`): a discovered session, which has no stored set, resumes with the full set's line, unchanged. `e2e:to-human` (`e2e/to-human.spec.ts`): beside the case that asserts the two ask flags, one for `engine`: neither flag, and supplement 4 appended. `e2e:requests` runs unchanged: its `c7-question` cases are the card half of A2, P3's fixture test is the wire half, and the two meet on a real engine in M6. `e2e:cross-build`: a host of the older build is sent no set, and the session it starts has none on its record.

**Gate.** Class 1a; `e2e:default`, `e2e:available`, `e2e:to-human`, `e2e:requests`, `e2e:side`, `e2e:cross-build`.

### M4 · The machine's default, and Settings › Sessions

**At its end.** A person sets the default once; a new intent starts from it. A4's "starting from", A5.

**Touches.** §G's files (the wire keys are M1's); `src/services/settings/session-settings.ts`, `src/services/spine-root.ts`; `src/renderer/src/settings-tab/` (`maws-tools-default.ts`, `MawsToolsSettings.tsx`, `SessionsSection.tsx`, `rows.ts`, `copy.ts`).

**Proves, unit first.** `defaults.test.ts`: `resolveMawsTools`; the two settings files' schemas and versions unchanged (the partition test holds). `machine.test.ts`: the file absent, present, unreadable, of an unknown version, with an unknown key kept across a write; a refused run writes nothing. The mirror's tests: an answer without the key reads as "predates". `session-settings.test.ts`. `reveals.test.tsx`: each new row's note is out of the resting text, open on focus and in the description; each switch's word carries its fact. A DOM test of `MawsToolsSettings`: Artifacts off turns the two off and greys them with "Needs Artifacts"; on turns them on.

**E2E.** `e2e:settings` (`e2e/settings.spec.ts`): the two rows are drawn and found by search ("tools", "question"); a switch and the segment write, and the value stands after a reload. `e2e/sessions.spec.ts`: with the default set to Artifacts off, a new chat's first launch writes that set in its spawn row, and the session M3's case started keeps its own.

**Gate.** Class 1a; `e2e:settings`, `e2e:default`.

### M5 · The composer's Tools submenu, and Session info

**At its end.** A4 whole.

**Touches.** `src/renderer/src/composer/setup-intent.ts`, `src/renderer/src/sessions/useSetupIntent.ts`, `composer/frame/bindings.ts`, `Composer.tsx`, `frame/Toolbar.tsx`, `plus-menu/PlusMenu.tsx`, `composer/copy.ts`; `src/renderer/src/tools/session-info/model.ts`, `copy.ts`; `src/renderer/src/harness/composer/intent-stub.ts`.

**Proves, unit first.** `bindings.test.ts`: the binding for a `create` intent; null for a fork, a started and an ended session, an older spine, and a chat that will start on another machine, including when the machine is chosen after a set was; a set goes through the patch. `PlusMenu.test.tsx`: the submenu by role and name; a checkbox item toggles and the menu stays open; Documents and Dashboards refused with their reason while Artifacts is off; the radio group; every note reached by keyboard focus and present as the item's description; no submenu when the binding is null. The session-info model's test: the two rows for a running session at the full set, at a partial one and at none; no rows for a session with no engine status.

**E2E.** `e2e:composer` (`e2e/composer.spec.ts`, beside "an unstarted session binds the frame to the intent"): the submenu patches the intent, by keyboard alone, and is absent on a started tab. `e2e/sessions.spec.ts`: Session info reads the set of the session M3's case started.

**Gate.** Class 1a; `e2e:composer`, `e2e:default`.

### M6 · Records, and the real engine

**At its end.** A12; the contracts say what the code does.

**Touches.** `docs/charter.md`: a dated line in §19 and at the end of §13's X9 paragraph (the set; the ask's `_meta`, its two descriptions and whose is which; the instructions by set), X6 (`mawsTools`, the capability, the spawn row's keys) and X1 (`mawsTools`). The P1 spec's Decision Log (A-1). `docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md`: a dated line where lever 1 stands, saying the owner reversed it and why. The headers of the files M1 to M5 changed.

**Live, on a Mac under the load rule.** `e2e:tools-live` (`e2e/maws-tools-live.spec.ts`), two cases added, each in the permission mode a new intent has (`auto`; P3 ran in `default`): a session with Question Default asks through the built-in and takes the answer given in MAWS; a session with MAWS's ask asks with no `blocking`, goes on working, and takes the answer as a message. `e2e:document-live`: a first edit of a document succeeds with `artifact_edit` deferred. `e2e:presentations-live`, its publish case: a first edit of a file kind succeeds with `artifact_read` and `artifact_publish` deferred. Spend is bounded by each group's own cap.

**Gate.** Class 1a on the head's tree, and the whole class-1b set, as a landing needs.

## Open for the owner

Each has a call made above, so the build does not wait; the owner can overturn any of them.

1. **"Non-blocking by default", or `blocking` required.** The plan builds the default the owner asked for, and P4 makes that cost a second description of the ask, a default carried per session, a marker in every launch's journal, and a limit on downgrade. Making `blocking` required, with the description telling the agent to pass `false` unless its next step needs the answer, gives the same behaviour from an agent that follows its tools, makes every call say what it wants, and needs none of that: an absent value keeps meaning "wait" everywhere. Recommended: required. It is one decision before M2 starts; M1 does not depend on it.
2. **A set cannot be changed after the session starts** (D1). The ticket allowed a change at a relaunch. Recommended: keep it fixed; P2 and P4 show what an ordinary resume leaves behind.
3. **Documents also governs a dashboard's blocks and every kind's comments** ("The groups"). Recommended: keep the ticket's cut and say so in the note.
4. **The control is a submenu of "+", not a chip** (D11). Recommended: the submenu; a chip if a non-default set should be visible at rest.
5. **The default is the machine's, not the person's** (D4), and a chat sent to another machine takes that machine's default with no choice offered (D11). Recommended: as designed, until `session.spawn` carries a set.

## Decision Log

1. **2026-11-23 · Verification.** This plan gets one independent adversarial review before it is built (`doperpowers:adversarial-reviewer`; focus: the stored and sent shapes against older builds, the ask's default against old journals and adopted sessions, and whether D1 follows from P2). Findings are checked in the cited code, and those accepted are fixed here in one revision; there is no second round unless the first overturns a design call. The branch gets `doperpowers:review-code` at the **high** rung at its end: it changes the launch line, three binding contracts and what is stored about every session, across the host, the spine and the window, which is more than the default rung is for and less than a panel's. The live runs of M6 are the acceptance no review replaces.
2. **2026-11-23 · The probes ran on 2.1.330, not on the tested 2.1.312.** No 2.1.312 binary is installed where they ran; the engine's code for both answers that matter (the `mcp_message` hand-off, the tool-search default) was read at 2.1.312 and 2.1.325. M2 re-records P1 with MAWS's own list, and the fixture names its engine.
3. **2026-11-23 · Settings › Sessions, not Engine.** The ticket places the default "in Settings › Engine, beside the launch profile". The launch profile moved to Sessions in U11a; the default goes where the profile is.
4. **2026-11-23 · Two launches the ticket lists do not exist as MAWS launches.** An agent's `sminos.spawn` is handed to sminos over lane A and never reaches MAWS's session service, launch spec or host; MAWS starts no session on a schedule (a cron fires inside a running engine). `session.spawn` is the one launch without a composer (A5).
5. **2026-11-23 · No environment override.** The ticket calls it optional. A scripted launch that needs a set sets the machine's default or patches its intent.
6. **2026-11-23 · The review, and what became of each finding.** Thirteen findings on `a84fa859b`; each checked in the code it cited. The review overturned one design call (the ask's default per launch), and the probe it asked for confirmed it (P4), so D3, D7 and D8 were rewritten. Decision 1 allows a second round for that; none is run, because what moved now stands on a fixture and a test, and what is left is found while building.
   - *Accepted and fixed here:* (2) a `/clear` lost the old transcript's set (§E, M3); (3) a chat sent to another machine offered a choice it could not send (D11, §H, M5); (4) the supplement was chosen from a set later taken off the spec, and the capability was read twice (D8, §E `servedSet`, M3); (5) the normaliser's default has to live in its checkpointed state, and the provisional preview drew a call of a tool that is off (§D); (6) the milestones could not pass the wire's gate in order, and M1 wrote a marker for a behaviour M2 brings (M1, M2); (7) the engine's question never reached the project channel (D13, §E, M3); (8) the upgrade was unprobed (P4, run; D1's wording; M6's live cases in `auto`); (9) Session info guessed a set for sessions MAWS never launched, and the table mis-stated what an older window does with an unknown key (§H, the table); (10) Documents governs a dashboard's blocks, and 848's paragraph had gained a sentence (The groups, §B); (11) a patch back to the full set made a draft unreadable to an older build for nothing (§E); (12) four proofs named the wrong path (M2's `e2e:design-systems`, M3's spawn rows by launch id, M6's `e2e:presentations-live`, M2's recording command); (13) the composer's own intent type lacked the fields (§H, M5).
   - *Accepted as a limit:* (1) a downgrade in the middle of a launch ("Known limits", 1 and 2). The part of it that bit every session, an ask's default changing under a model that still reads the old description, is what D7 now prevents.
   - *Not taken:* (5)'s filter on the normaliser's admission of a call, because the engine never sends the host a call of a tool the launch did not list (P2's ad hoc run: the server saw none); (2)'s change to which record yields at a rebinding (`bare`), because the record that takes an engine id carries the set its own launch was served.
