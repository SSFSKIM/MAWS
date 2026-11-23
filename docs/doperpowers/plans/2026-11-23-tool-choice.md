# Tool choice: which of MAWS's tools a session gets, and which tool asks the questions

> **Tickets:** board ticket 421 (the choice of MAWS's tool groups and of the question tool) and board ticket 420 (the ask loaded up front, every artifact and document tool deferred; the UX wave's landing U1d, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, "O-19, and the first half of #420" and "The second half of #420"). Planned and built together, on one branch.
>
> **Root:** `docs/charter.md`. This document amends X9 (the `maws` tool server), X6 (the launch spec) and X1 (the session record), each additively and each by a dated line (M6). D-1 binds: the engine is driven, never patched.
>
> **Parent pin:** master `86c79d0a3`, the commit every statement about the code below was checked against, **plus board ticket 848** (branch `ux-wave/retire-send-file`, read at `9d6a3821a`), which retires `send_file`. This plan is written as if 848 has landed: the `maws` server has 18 tools, and Auxiliary is `show_pane` alone. The build starts from a master that holds 848 ("Shared with ticket 848" names the files both touch).
>
> **Branch:** `ux-wave/tool-choice`. **Not in this plan:** the sminos question tool in a session MAWS runs (board ticket 600; "What ticket 600 changes" says where it slots in); `session.spawn` carrying a set of its own; an environment variable that overrides the choice.
>
> **The owner's answers this plan stands on.** 2026-11-12 (ticket 420): the ask loads up front and does not block unless the call says so; the four edit tools go back behind tool search ("Seven seconds are fine. Cost of the context token is more important."). 2026-11-23 (ticket 421): work both tickets now; Question "Default" means the engine's built-in AskUserQuestion for now, and sminos's question where its mod runs once ticket 600 lands; MAWS's ask is non-blocking by default; Auxiliary holds only `show_pane`.

## Purpose

A session MAWS launches is given all 18 of MAWS's own tools whatever the work is, and MAWS's own ask in place of the engine's. A coding session that will never make a deliverable still carries the artifact tools' names and instructions, and a person who prefers the engine's question tool cannot have it. After this plan a person chooses, per session, which of MAWS's tool groups the session gets (Artifacts, Documents, Dashboards, Auxiliary) and which tool asks them questions (the engine's, or MAWS's), starting from a default they set once per machine.

Ticket 420 rides with it because it changes the same list: the ask is the session's line to its human and today sits behind tool search, while four artifact tools that serve one kind of work are loaded into every request. After this plan the ask is the one `maws` tool loaded up front, a question it puts does not hold the turn unless the call says so, and every artifact and document tool is found through tool search.

## Words used in this document

- **Set** (`MawsToolSet`): one session's choice: four switches and the question tool.
- **Full set**: every switch on and the question tool MAWS's. What every session has today.
- **Group**: the tools one switch governs ("The groups").
- **Question tool**: `maws` for `mcp__maws__ask`; `engine` for whatever the engine itself offers, today the built-in `AskUserQuestion`. The composer and Settings call the second "Default", the owner's word.
- **Spine**: the session service in `mawsd`. **Host**: the engine host. Either may be an older build than the window that talks to it.
- **Spawn row**: the journal's `spawn` meta row a host writes for each launch (`spawnMeta`, `src/engine-host/launch.ts`).

## Probes

Run before this was written, against the scripted Messages API stand-in, so nothing was spent. Scenario `spikes/protocol-probe/scenarios/pass3/uxwave-421-tool-choice.mjs`, fixtures `spikes/protocol-probe/fixtures/uxwave/uxwave-421-*.jsonl`, findings `spikes/protocol-probe/findings-uxwave-421-tool-choice.txt`, four tests in `spikes/protocol-probe/fixtures.test.mjs` ("tickets 421/420"). Engine 2.1.330 (the one installed where it ran; the code was read at 2.1.312, MAWS's tested version, and 2.1.325).

| | Question | Answer | What it decides |
|---|---|---|---|
| P1 | Is an SDK server's tool listed with `_meta["anthropic/alwaysLoad"]` in the request whole under tool search? | Yes. `mcp__maws__ask` is the one `maws` tool in the request's tools; the others are names in the engine's "deferred tools" message. The same with `ENABLE_TOOL_SEARCH` absent: the engine's default is tool search on, for any base URL. | Ticket 420 works as written, on the gateway route and on a direct launch alike (its acceptance 4 is answered). |
| P2 | Does the engine honour `tools/list_changed` from MAWS's server mid-session? | In part. It lists again at once and its own registry follows; an added tool arrives and a deferred tool is withdrawn in words. But a tool that was in the request whole stays there after it left the list (a call of it fails with "No such tool available"), and the server's instructions are never read again. A resumed session shows the same residue, and keeps the paragraph it was first given. | A session's set is fixed when it starts. Neither a live switch nor a relaunch changes it cleanly. |
| P3 | With the built-in ask not disallowed and no `maws` ask listed, does MAWS's question path raise and answer it? | Yes. `AskUserQuestion` is in the request up front, a call raises `can_use_tool` with `requires_user_interaction: true`, and the host's allow with `updatedInput.answers` becomes the tool's result. It is the request `e2e/requests.spec.ts` already draws and answers (the `c7-question` recording). | Question "Default" needs no new card or broker work: only the launch line and the list change. |

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

**The check the ticket asked for.** The three comment tools answer more than documents: `dashboardThreadTools(designThreadTools(presentationThreadTools(documentTools(…))))` in `src/engine-host/tool-server/tools.ts` routes a deck's, a design's and a dashboard's threads through the same three names. With Documents off, a session can still create, read and publish those kinds, and cannot list, answer or resolve a comment on any kind. That is what the switch means, and its note says so ("Edit documents, answer comments"). Moving the three comment tools into Artifacts was weighed and lost: a comment on a document asks for an edit the session could not make, and the switch would then govern one tool.

## Design

Each call with its reason and the strongest alternative it beat.

**D1 · A set is fixed when its session starts.** The composer offers the choice only for a session not yet started; a resume keeps the session's set, and a fork keeps its source's. *Why:* P2. A set changed in a running session, or at a relaunch, leaves the ask (always loaded) offered and failing, and leaves the artifact paragraph in a session that no longer has the tools, or missing from one that gained them. A fork resumes its source's transcript, so it inherits the same residue. *Beaten:* the ticket's "changing it after the start applies at a relaunch". It reads as a small addition and would ship the residue to exactly the person who used it.

**D2 · A group is removed at the source.** The host builds each session's list and instructions from its set; `tools/list` and the paragraph both leave out what is off. *Why:* the ticket's point 6, and P2 shows the engine tells the model about tools by name. *Beaten:* `--disallowedTools` per tool, which leaves the instructions naming tools the session cannot call and puts 18 names on the launch line.

**D3 · Absent means the full set, everywhere it is stored or sent.** The set is an optional field on the setup intent, the session record and the launch spec, and it is written only when it differs from the full set. *Why:* acceptance 3 becomes structural: a default session's intent, record, launch spec and launch line are byte for byte what they are today, so an older spine, host or window reads them as before. It is the rule `launchFolder` and `launchedBy` already follow on the record. *Beaten:* always writing the set, which is simpler to read back and makes every new record unreadable to a build that predates the field.

**D4 · The default is per machine, in a file of its own.** `<profile>/machine-session-defaults.json`, beside `machine-settings.json`, read and written by the spine, served on `machineSettings.*` as the route's default is. *Why:* a session started with no composer (`session.spawn` from another machine) runs on the machine's spine with no window, so the default has to be the machine's. And `machine-settings.json` "stays at version 1 with no new property (an older build strict-parses it, and a changed `version` literal is a wire major)" (`src/shared/ipc/schema/settings.ts`, P5 O7 M9). *Beaten:* a new key under `engine` beside `launchProfile`, the ticket's own suggestion: one line of schema, and it breaks every older build that shares the profile. The file is read loosely (unknown keys kept on a rewrite), so the next per-machine default a later build adds needs no third file; M9's strict one-purpose file lost to that.

**D5 · The default is copied into the intent when the intent is made.** `SessionService.create` seeds a new intent's set from the machine's default, as it seeds the route. The composer then reads and patches the intent alone. *Why:* one path for the composer and for `session.spawn`, and the same rule the route chip follows. *Beaten:* resolving the default at the start, which follows a later change of the default but needs the window to read the machine's default beside every unstarted intent.

**D6 · The question tool is one field of the set, with two values.** `maws`: today's launch (`--disallowedTools AskUserQuestion --allowedTools mcp__maws__ask`, `ask` listed). `engine`: neither flag, no `ask` listed; MAWS does nothing to the engine's question tools. *Why:* "Default" then means "whatever the engine offers", which is the built-in today and sminos's tool where ticket 600 makes its mod run, with no change to what is stored. *Beaten:* three values naming each tool, which would have to be migrated when 600 lands. The factory default stays `maws`: acceptance 3.

**D7 · The ask's default follows the launch, and the launch says it.** `blocking` absent means "do not wait" for every launch this build makes, and "wait" for every launch made before. The host writes `askBlocksByDefault: false` in the spawn row; the normaliser, the host's own ask tool and the adopter read the default from the launch (the row absent or without the key: wait). *Why:* three readers default `blocking ?? true` today (`src/engine-host/tool-server/ask.ts`, `src/engine-host/normalizer-controls.ts`, `src/renderer/src/transcript/model/derive.ts`), and the journals written before hold blocking asks with no `blocking` key (`pass3/p1-maws-ask-blocking`); flipping the constant would re-read every one of them as a question that never waited. An engine process adopted from an older host also still holds the old description. *Beaten:* (a) flipping the constant; (b) making `blocking` required, which removes the ambiguity and is not what the owner asked for ("non-blocking by default, matching sminos's"); (c) reading the default out of the journaled `tools/list` answer, which is the truth the model saw and costs the normaliser a parse of every list for one boolean.

**D8 · The host serves what it is told and says what it served.** The spine sends the set only to a host that lists the capability `engine.mawsTools`; to an older host it sends none, and records the full set, since that is what the session gets. *Why:* a session with more tools than asked costs context; a refused start costs the work. The host is replaced with the spine at an update, so the window is short. *Beaten:* refusing the start, M9's rule for a route, which is right there because the wrong route spends on the wrong account.

**D9 · Descriptions do not vary by set.** A tool's description is the same in every session that lists it. `artifact_create` still says "then bind its data with artifact_dataset" with Dashboards off, and a document's guide still names `artifact_edit` with Documents off. *Why:* X9 holds each description exact; 18 descriptions by 2⁴ sets is not a text anyone can review. *Beaten:* cutting sentences by set. If a session is seen stumbling on a named tool it lacks, the answer is a refusal sentence on that call, not a second description.

**D10 · A linked artifact is still read with Artifacts off.** The read MAWS attaches to a human message that links an artifact (P4-A3, `SessionMaws.withLinkedReads`) uses the host's own `artifact_read` whether or not the session lists it. *Why:* the link is the person's own act, and without the tools the attached read is the only way the agent can see what they pointed at. Acceptance 1's "no artifact text" is about what MAWS gives every session unasked.

**D11 · The composer's control is a Tools submenu of "+".** After Connectors and Plugins, which are the other things a chat is given. *Why:* it adds no chip to a toolbar whose words the cut just counted, a menu item takes keyboard focus, and its note can carry the fact. *Beaten:* a Tools chip beside the mode chip, which shows the choice at rest; it wins if the owner wants a non-default set visible without opening anything.

**D12 · The supplement's ask line has one text per question tool.** Supplement 3 for `maws`, unchanged; supplement 4 for `engine`. A session's question tool never changes (D1), so what its prompt recorded always equals what the decision wants, and the decision table needs no new row. *Beaten:* one supplement naming both tools, which tells every session about a tool it lacks.

## What is stored and sent, and what each older build does with it

| stored or sent | this plan | an older build meeting it |
|---|---|---|
| `SetupIntent.mawsTools` (file per intent) | written when the machine's default or the person's choice is not the full set | parses the intent strictly, skips the file (logged, not deleted); the draft reappears under this build. Default intents carry no key. |
| `SessionRecord.mawsTools`; index column `maws_tools` | written once, at `createForLaunch`, when not the full set; the column through `ADDED_COLUMNS`, no `user_version` change | opens the index; a record with the key fails its strict wire schema on an older window, as `launchFolder` does. Default records carry no key. |
| `LaunchSpec.mawsTools` (`session.launch`) | sent when not the full set, and only to a host listing `engine.mawsTools` | never receives it (D8) |
| the host's stored spec (`saveLaunchSpec`) | the key left out, as `route` is; an adopter takes the set from the spawn row | nothing new |
| spawn row `mawsTools`, `askBlocksByDefault` | written for every launch | reads the row loosely and ignores both |
| `machine-session-defaults.json` | written at the first change of the default; absent until then | never reads it; its launches are the full set |
| `machineSettings.get` / `.set` / `.changed`: `mawsTools` | on every answer and change; `set`'s own `mawsTools` writes the default | an older spine answers without it, which the window reads as "this machine predates the choice" and draws no control; an older spine drops `set`'s key and its answer says so by carrying none |
| `WIRE_MINOR` | one bump for the three fields and the `machineSettings` key | |

## Acceptance

Ticket 421's four points and ticket 420's five, as the owner's answers leave them.

- **A1 (421·1).** Each switch, off, removes exactly its group from `tools/list`. Artifacts off also removes the artifact sentences from the server's instructions, and Documents and Dashboards with it. A session with Artifacts off is offered no `artifact_*` tool and is given no sentence about artifacts at launch.
- **A2 (421·2).** Question set to Default: the launch line has neither `--disallowedTools AskUserQuestion` nor `--allowedTools mcp__maws__ask`, `tools/list` has no `ask`, and the built-in raises MAWS's question in the call's row, whose answer reaches the agent. The built-in waits for its answer; a Default question that does not wait is ticket 600's.
- **A3 (421·3).** With the full set, a session's launch line, `tools/list` names, instructions, intent, record and launch spec are what they are on the parent pin, but for ticket 420's two changes (A6, A10).
- **A4 (421·4).** The composer of a session not yet started offers the four switches and the Question choice, starting from the machine's default; Documents and Dashboards cannot be on while Artifacts is off. A resumed or forked session keeps its own set whatever the default is now. Session info shows a session's set.
- **A5 (421, shape 4).** A session started by `session.spawn` takes the default of the machine it runs on.
- **A6 (420·1).** `tools/list` lists `ask` with `_meta["anthropic/alwaysLoad"]: true` and no other tool with it.
- **A7 (420·2, U1d).** Against the stand-in API under MAWS's gateway launch, with MAWS's own list, `mcp__maws__ask` is in the first request whole and no `artifact_*` tool is.
- **A8 (420·3).** With Artifacts on, the instructions name `mcp__maws__artifact_search` and `mcp__maws__artifact_read`.
- **A9 (420·4).** A direct launch defers as a gateway launch does. Met by P1; the finding is the record.
- **A10 (U1d).** A question put with no `blocking` argument returns at once, leaves the turn running and shows as waiting; its answer arrives as a user message naming the askId. `blocking: true` waits. A subagent's ask always waits. A journal written before this plan draws as it did.
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
    export const isFullSet = (set: MawsToolSet | undefined): boolean;   // absent is full
    export const storedSet = (set: MawsToolSet): MawsToolSet | undefined; // undefined for the full set: what a record, an intent or a spec holds (D3)
    export type MawsToolGroup = 'artifacts' | 'documents' | 'dashboards' | 'auxiliary' | 'question';
    export const MAWS_TOOL_GROUP = { … } as const satisfies Record<MawsToolName, MawsToolGroup>; // a tool added later does not compile until it has a group
    export const listedTools = (set: MawsToolSet): MawsToolName[];     // MAWS_TOOL_NAMES order
    export const withArtifacts = (set: MawsToolSet, on: boolean): MawsToolSet; // off turns documents and dashboards off; on turns both on

The canonical form has no "documents on, artifacts off": the schema refuses it, and the two controls use `withArtifacts`.

### §B · X9, as amended

- `MAWS_TOOLS.ask` gains `meta: ALWAYS_LOAD`. `artifact_describe_type`, `artifact_read`, `artifact_publish` (`src/shared/maws/tools.ts`) and `artifact_edit` (`src/shared/maws/document-tools.ts`) lose it.
- `ask`'s description, from "With blocking true (the default)" to its end, becomes: `With blocking false (the default) the call returns {status: "asked", askId} at once and the answers arrive later as a user message that names the askId, so you can keep working meanwhile; with blocking true it waits for the answers and returns them. In a subagent the call always waits and returns the answers, as with blocking true.` The listed schema's `blocking` carries `default: false`; the validator still defaults nothing.
- `mawsServerInstructions(session: { inAppBrowser: boolean; artifacts: boolean })`. The first paragraph is two constants: `MAWS_ARTIFACT_INSTRUCTIONS` (its first four sentences) and `MAWS_FILE_LINK_INSTRUCTIONS` (the fifth, which ticket 848 leaves as "To show the user a file, …"). `MAWS_SERVER_INSTRUCTIONS` stays their join with one space, byte for byte. With `artifacts` false the first paragraph is the file-link sentence alone. The browser paragraph is as before.
- `TOOL_ERRORS.unknownTool(name, listed)` names the session's tools, not `MAWS_TOOL_NAMES`.
- A session's `tools/list` is `listedTools(set)`, in that order.

### §C · X6, as amended (`src/shared/engine/launch-spec.ts`, `src/engine-host/launch.ts`)

    LaunchSpecSchema: mawsTools: MawsToolSetSchema.optional()   // absent: the full set
    LaunchPlan:       mawsTools: MawsToolSet; askBlocksByDefault: false   // what this launch serves
    spawnMeta(...):   { …, mawsTools: MawsToolSet, askBlocksByDefault: false }
    export const ENGINE_MAWS_TOOLS_CAPABILITY = 'engine.mawsTools';  // src/shared/host/socket-protocol.ts, in PEER_CAPABILITIES.engineHost

`buildLaunch` pushes `--disallowedTools AskUserQuestion --allowedTools mcp__maws__ask` when the launch declares `maws` and `(spec.mawsTools ?? FULL_MAWS_TOOL_SET).question === 'maws'`. The stored spec leaves `mawsTools` out (`saveLaunchSpec`, beside `route`); `SpawnRow` gains `mawsTools?: MawsToolSet` and `askBlocksByDefault?: false`, read by `spawnRowOf`.

### §D · The host (`src/engine-host/`)

    SessionMawsHost: toolSet: MawsToolSet; askBlocksByDefault: boolean
    mawsTools(deps): McpToolDefinition[]            // unchanged: every tool
    // SessionMaws lists `mawsTools(deps).filter((tool) => listed.has(tool.name))` and keeps `artifact_read` from the unfiltered list (D10)
    pendingAskOf(args, ctx: { toolUseId; requestId; fromSubagent; blocksByDefault: boolean }, openedAt)
    askTool(deps: { …; blocksByDefault: boolean })

A launch: `toolSet = spec.mawsTools ?? FULL_MAWS_TOOL_SET`, `askBlocksByDefault = false`. An adoption (`createAdopter`): both from the spawn row; a row without them is a launch by an older host, so the full set and `askBlocksByDefault = true`. The normaliser keeps one flag, set at each `spawn` meta row (`pushMeta`): `meta.askBlocksByDefault !== false`; it starts true, so a journal with no spawn row reads as before. `maws.ask.opened.blocking` is `(blocking ?? flag) || fromSubagent(…)`. `derive.ts`'s fallback for a call with no `opened` event becomes `input?.blocking ?? !ask.asked`.

### §E · The spine (`src/services/sessions/`, `src/services/index/`)

    SetupIntentSchema / SetupIntentPatchSchema: mawsTools: MawsToolSetSchema.optional()
    SessionRecordSchema:                         mawsTools: MawsToolSetSchema.optional()
    C10Settings:                                 mawsTools: MawsToolSet            // the machine's default
    LaunchInput:                                 mawsTools?: MawsToolSet
    LaunchInit:                                  mawsTools?: MawsToolSet           // index column maws_tools TEXT (JSON), ADDED_COLUMNS; written once

- `create`: `...(storedSet(settings().mawsTools) && { mawsTools })`.
- `patch`: a `mawsTools` on an intent of kind `fork` is refused and nothing changes; on a `create` intent it is kept as given (the full set given outright is kept, so a person can undo a default that is not full).
- `forkIntentOf`: the source record's `mawsTools`, absent when the source has none.
- `specForHost` (`machine-route.ts`), which every launch and resume passes through, is the one place the set is taken off a spec: for a host that does not list `ENGINE_MAWS_TOOLS_CAPABILITY`.
- `runIntentSetup`: `chosen = intent.mawsTools ?? FULL`; `served = (await s.hostLists(ENGINE_MAWS_TOOLS_CAPABILITY)) ? chosen : FULL`; `createForLaunch({ …, mawsTools: storedSet(served) })`, so the record says what the session got (D8).
- `resumeLaunchSpec`: `record.mawsTools`. Resumed on a host that does not list the capability, the session runs with the full set for that launch; its record is not rewritten.
- `bootstrapSpec`: none. It serves no turn.
- `toSessionRecordPatch` does not carry the set; nothing updates it after `createForLaunch`.

### §F · The supplement (`src/shared/owner/contract.ts`, `src/services/owner/launch.ts`; X18)

    SUPPLEMENT_4.text = `${SUPPLEMENT_HEADER(4)}\n\nThis session runs in MAWS. ${ASK_ENGINE}`
    ASK_ENGINE = 'Ask the human with the native AskUserQuestion; it waits for their answer. Neither `mcp__sminos__AskUserQuestion` nor `mcp__doperpowers__AskUserQuestion` is available here.'
    AppendedText = 'supplement' | 'supplement-engine'

`ownerChannelLaunch` reads `spec.mawsTools?.question`: for `engine` the desired state appends `supplement-engine` and records `supplement:4`; otherwise supplement 3, as today. `ASK_HERE` is not edited: it names `blocking: false` and `blocking: true` outright, so it reads true under the new default (A11).

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
    composer/frame/bindings.ts: FrameBindings.tools: ChipBinding<MawsToolSet> | null
    composer/plus-menu/PlusMenu.tsx: props gain `tools?: ChipBinding<MawsToolSet> | null`
    tools/session-info/model.ts: two rows in engineSection, from record.mawsTools ?? FULL

`FrameBindings.tools` is set by `intentBindings` alone, for an intent of kind `create` whose machine's spine honours the choice (`useMachineMawsTools(machineOf(appSessionId))` is a set); its value is `intent.mawsTools ?? FULL`, its `set` goes `through` `hook.patch({ mawsTools })`, and it shares the frame's one disabled reason. It is null for a fork, a started session, an ended one and an older spine, and the submenu is then not drawn.

**The text, under the word cut's rules** (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`, "What the cut builds": few words; a fact is a note in its row, shown on pointing and at once on keyboard focus, and the row's accessible description at all times; never a system `title`). All of it in `copy.ts` files.

| where | at rest | note (on pointing or focus) |
|---|---|---|
| "+" › **Tools** › checkbox items | Artifacts · Documents · Dashboards · Auxiliary | "Create, read and publish artifacts" · "Edit documents, answer comments" · "Bind a dashboard's data" · "Open panes for you" |
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
- A session started before this plan has no stored set: it resumes and forks as the full set, with this build's list (the ask loaded up front, the four edit tools deferred, the ask not waiting by default). Its engine tells it the deferred names that changed; a tool it was sent whole before stays in its requests (P2) and still works, since the host still serves it.

## What ticket 600 changes

Nothing stored. A session whose question tool is `engine` already launches with the built-in present, which is the second of 600's three blockers. When 600 makes the sminos mod register its tool in a session MAWS runs and gives its asynchronous answer a way in, such a session has `mcp__sminos__AskUserQuestion` with no change here; MAWS already draws it (`ASK_MOD_TOOLS`, `src/renderer/src/transcript/model/classify.ts`). What 600 edits: `ASK_ENGINE` (a supplement 5 that names sminos's tool where it is registered), the two notes that say "Claude Code's own", A2's last sentence, and, if the owner then wants it, the factory default of `question`.

## Shared with ticket 848

Both branches edit: `src/shared/maws/tools.ts` and `tools.test.ts`; `src/shared/maws/instructions.ts` and `instructions.test.ts`; `src/shared/maws/search-tools.test.ts`; `src/engine-host/tool-server/tools.ts`; `src/engine-host/tool-server/server.ts` and `server.test.ts` (848 answers a call of `send_file` in the unknown-tool branch this plan re-words); `src/engine-host/session-maws.test.ts`; `src/engine-host/normalizer-controls.ts`; and the dated X9 lines in `docs/charter.md` and the P1 spec's Decision Log. 848 alone edits `src/renderer/src/transcript/model/classify.ts`, `derive.ts` and the File kind's guides; this plan edits `derive.ts` too (one line, §D). This branch is rebased on the master that holds 848 before M1 starts; nothing here is built on a tree that still lists `send_file`.

## Constraints that bind every milestone

- D-1. Nothing is asked of the engine but its launch line, its control protocol and what `tools/list` answers.
- X9's texts are exact. Every changed description, paragraph and refusal is pinned by a test that holds it word for word, and gets its dated line in M6.
- A default session is unchanged (A3). Each milestone keeps one test that builds the full set's launch and compares it with the parent pin's: the line in `src/engine-host/launch.test.ts`, the list in `src/shared/maws/tools.test.ts`, the paragraph in `search-tools.test.ts`.
- No test is deleted to pass. A test that relied on the old default of `blocking` states `blocking: true`.
- Copy lives in `copy.ts`; tests find elements by role and accessible name.
- Gates: class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes`; each e2e group named below through `scripts/ci-gate.sh <worktree> --gates e2e:<group>`; the live runs on a Mac under the load rule (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5). This plan adds cases to existing specs and no spec file, so `default`'s pin does not move.
- The repository is public: no path under a home directory, no address and no machine fact in a fixture, a test or a document.

## Plan of Work

### M0 · The probes (done, on this branch)

The scenario, seven fixtures, the findings and four tests. **Proves:** P1 to P3. `pnpm test:probes`.

### M1 · The set at the host

**At its end.** A launch spec may carry a set, and the host serves exactly it: the list, the instructions, the launch line, the spawn row. Nothing sends one yet.

**Touches.** New `src/shared/maws/tool-set.ts`. `src/shared/maws/instructions.ts`, `tools.ts` (`unknownTool`). `src/shared/engine/launch-spec.ts`. `src/shared/host/socket-protocol.ts`. `src/engine-host/launch.ts`, `launcher.ts` (the adopter), `holder/restore.ts` (`SpawnRow`), `session.ts` (the host's options), `session-maws.ts`, `tool-server/server.ts`, `store/file-session-state-store.ts`.

**Proves, unit first.** `tool-set.test.ts`: each group's names; every tool has a group; the refusal of documents without artifacts; `listedTools` for the full set equals `MAWS_TOOL_NAMES`. `instructions.test.ts`: the join equals the parent pin's paragraph; Artifacts off is the file-link sentence alone, with and without the browser paragraph. `launch.test.ts`: the full set's line unchanged; `engine` has neither flag; the spawn row's two keys. `session-maws.test.ts`: `tools/list` for each switch off alone and for all off; a call of a tool that is off answers `unknownTool` naming what the session has; a linked read attaches with Artifacts off (D10). `file-session-state-store.test.ts`: the stored spec has no `mawsTools`. `holder/adopter.test.ts`: an adoption from a row with the keys, and from one without. A1 and A2's launch half, at the host.

**Gate.** Class 1a; `e2e:tools` and `e2e:supervisor-daemon` (the adoption path), unchanged and green.

### M2 · Ticket 420: the ask up front and not waiting, the edit tools deferred

**At its end.** A6, A7, A8, A10.

**Touches.** `src/shared/maws/tools.ts`, `document-tools.ts`. `src/engine-host/tool-server/ask.ts`, `session-maws.ts` (the adopter's restore of an acknowledged ask passes the launch's default), `normalizer.ts` and `normalizer-controls.ts`. `src/renderer/src/transcript/model/derive.ts`. `spikes/protocol-probe/`: the probe re-recorded with MAWS's own list (`mawsToolList()` dumped beside the scenario and pinned to `tools.ts` by a unit test, as `p4-maws-tools.json` is by `search-tools.test.ts`), and its test tightened to the real names.

**Proves, unit first.** `tools.test.ts`: `_meta` on `ask` alone; the description's new sentence, word for word; the listed schema's `default: false`. `ask.test.ts`: no `blocking` under a launch of this build returns `asked`; under an adopted older launch it waits; a subagent's waits either way. The normaliser's tests: a journal whose spawn row carries `askBlocksByDefault: false` opens an ask with no `blocking` as not blocking; the recorded journals (no such row) keep their snapshots under `test/snapshots/transcript/` byte for byte. Probes: A7 from the re-recorded fixture.

**E2E.** `e2e:tools` (`e2e/maws-tools.spec.ts`): one new case, "an ask with no blocking argument leaves the turn running and reads as waiting; its answer arrives as a message"; the cases that replay `pass3/p1-maws-ask-blocking` through the real host give its calls `blocking: true` (through `askFixture`, as the async cases already rewrite arguments), since that recording was made under the old default. `e2e:requests` and `e2e:transcript` run unchanged.

**Gate.** Class 1a; `e2e:tools`, `e2e:requests`, `e2e:transcript`.

### M3 · The set kept with the session

**At its end.** A set travels from an intent to its record and launch, a resume and a fork keep it, `session.spawn` takes the machine's default (still the full set until M4), and the supplement follows the question tool. A2 whole, A4's keeping, A5's path, A11.

**Touches.** `src/shared/sessions/intent.ts`, `src/shared/graph/session.ts`, `src/shared/ipc/wire.ts` (`WIRE_MINOR`), `wire-manifest.json`, `src/shared/machine/address-paths.json`. `src/services/sessions/service.ts`, `record-actions.ts`, `setup.ts`, `resume.ts`, `launch-mapping.ts`, `machine-route.ts` (the set stripped for an older host, beside the route). `src/services/index/sessions.ts`, `migrations.ts`. `src/shared/owner/contract.ts`, `src/services/owner/launch.ts`.

**Proves, unit first.** `launch-mapping.test.ts`: an intent's, a fork's and a resume's spec carry the set; the full set carries none; the bootstrap none. `service.test.ts`: `create` seeds from the settings; a patch on a fork is refused. `side-thread.test.ts` and the fork cases: the source's set. `spawn.test.ts`: the machine's default. `sessions.test.ts`, `migrations.test.ts`: the column, written once. `graph.test.ts`, `intents.test.ts`: a record and an intent without the key parse. `owner/launch.test.ts` and the contract's tests: supplement 4 word for word; `engine` appends it and records `supplement:4`; `maws` is unchanged. `wire.test.ts`.

**E2E.** `e2e/sessions.spec.ts` (group `default`, replay; beside "unstarted first send" and "fork in place"): a new chat whose intent was patched to Artifacts off and Question Default launches with no `--disallowedTools` on its line (the spawn row's `args`), a spawn row naming that set and a journaled `tools/list` answer of `show_pane` alone; resumed, it launches the same; a fork of it launches the same. `e2e:available` (`e2e/sessions-available.spec.ts`): a discovered session, which has no stored set, resumes with the full set's line, unchanged. `e2e:to-human` (`e2e/to-human.spec.ts`): beside the case that asserts the two ask flags, one for `engine`: neither flag, and supplement 4 appended. `e2e:requests` runs unchanged: its `c7-question` cases are the card half of A2, P3's fixture test is the wire half, and the two meet on a real engine in M6. `e2e:cross-build`: a host of the older build is sent no set.

**Gate.** Class 1a; `e2e:default`, `e2e:available`, `e2e:to-human`, `e2e:requests`, `e2e:side`, `e2e:cross-build`.

### M4 · The machine's default, and Settings › Sessions

**At its end.** A person sets the default once; a new intent starts from it. A4's "starting from", A5.

**Touches.** §G's files; `src/services/settings/session-settings.ts`, `src/services/spine-root.ts`; `src/renderer/src/settings-tab/` (`maws-tools-default.ts`, `MawsToolsSettings.tsx`, `SessionsSection.tsx`, `rows.ts`, `copy.ts`).

**Proves, unit first.** `defaults.test.ts`: `resolveMawsTools`; the two settings files' schemas and versions unchanged (the partition test holds). `machine.test.ts`: the file absent, present, unreadable, of an unknown version, with an unknown key kept across a write; a refused run writes nothing. The mirror's tests: an answer without the key reads as "predates". `session-settings.test.ts`. `reveals.test.tsx`: each new row's note is out of the resting text, open on focus and in the description; each switch's word carries its fact. A DOM test of `MawsToolsSettings`: Artifacts off turns the two off and greys them with "Needs Artifacts"; on turns them on.

**E2E.** `e2e:settings` (`e2e/settings.spec.ts`): the two rows are drawn and found by search ("tools", "question"); a switch and the segment write, and the value stands after a reload. `e2e/sessions.spec.ts`: with the default set to Artifacts off, a new chat's first launch lists no `artifact_*`, and the session M3's case started keeps its own set.

**Gate.** Class 1a; `e2e:settings`, `e2e:default`.

### M5 · The composer's Tools submenu, and Session info

**At its end.** A4 whole.

**Touches.** `src/renderer/src/composer/frame/bindings.ts`, `Composer.tsx`, `frame/Toolbar.tsx`, `plus-menu/PlusMenu.tsx`, `composer/copy.ts`; `src/renderer/src/tools/session-info/model.ts`, `copy.ts`; `src/renderer/src/harness/composer/intent-stub.ts`.

**Proves, unit first.** `bindings.test.ts`: the binding for a `create` intent, null for a fork, a started and an ended session and an older spine; a set goes through the patch. `PlusMenu.test.tsx`: the submenu by role and name; a checkbox item toggles and the menu stays open; Documents and Dashboards refused with their reason while Artifacts is off; the radio group; every note reached by keyboard focus and present as the item's description; no submenu when the binding is null. The session-info model's test: the two rows for the full set, for a partial one and for none.

**E2E.** `e2e:composer` (`e2e/composer.spec.ts`, beside "an unstarted session binds the frame to the intent"): the submenu patches the intent, by keyboard alone, and is absent on a started tab. `e2e/sessions.spec.ts`: Session info reads the set of the session M3's case started.

**Gate.** Class 1a; `e2e:composer`, `e2e:default`.

### M6 · Records, and the real engine

**At its end.** A12; the contracts say what the code does.

**Touches.** `docs/charter.md`: a dated line in §19 and at the end of §13's X9 paragraph (the set; the ask's `_meta`, description and default; the instructions by set), X6 (`mawsTools`, the capability) and X1 (`mawsTools`). The P1 spec's Decision Log (A-1). `docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md`: a dated line where lever 1 stands, saying the owner reversed it and why. The headers of the files M1 to M5 changed.

**Live, on a Mac under the load rule.** `e2e:tools-live` (`e2e/maws-tools-live.spec.ts`), two cases added: a session with Question Default asks through the built-in and takes the answer given in MAWS; a session with MAWS's ask asks with no `blocking`, goes on working, and takes the answer as a message. `e2e:document-live`: a first edit of a document succeeds with `artifact_edit` deferred. Spend is bounded by each group's own cap.

**Gate.** Class 1a on the head's tree, and the whole class-1b set, as a landing needs.

## Open for the owner

Each has a call made above, so the build does not wait; the owner can overturn any of them.

1. **A set cannot be changed after the session starts** (D1). The ticket allowed a change at a relaunch. Recommended: keep it fixed; P2 shows what a change leaves behind.
2. **Documents also governs comments on decks, designs and dashboards** ("The groups"). Recommended: keep the ticket's cut and say so in the note.
3. **The control is a submenu of "+", not a chip** (D11). Recommended: the submenu; a chip if a non-default set should be visible at rest.
4. **The default is the machine's, not the person's** (D4): another machine has its own. Recommended: as designed; it is the only place a session started with no window can read it.

## Decision Log

1. **2026-11-23 · Verification.** This plan gets one independent adversarial review before it is built (`doperpowers:adversarial-reviewer`; focus: the stored and sent shapes against older builds, the ask's default against old journals and adopted sessions, and whether D1 follows from P2). Findings are checked in the cited code, and those accepted are fixed here in one revision; there is no second round unless the first overturns a design call. The branch gets `doperpowers:review-code` at the **high** rung at its end: it changes the launch line, three binding contracts and what is stored about every session, across the host, the spine and the window, which is more than the default rung is for and less than a panel's. The live runs of M6 are the acceptance no review replaces.
2. **2026-11-23 · The probes ran on 2.1.330, not on the tested 2.1.312.** No 2.1.312 binary is installed where they ran; the engine's code for both answers that matter (the `mcp_message` hand-off, the tool-search default) was read at 2.1.312 and 2.1.325. M2 re-records P1 on whatever engine the gate's probe job runs, and the fixture names it.
3. **2026-11-23 · Settings › Sessions, not Engine.** The ticket places the default "in Settings › Engine, beside the launch profile". The launch profile moved to Sessions in U11a; the default goes where the profile is.
4. **2026-11-23 · Two launches the ticket lists do not exist as MAWS launches.** An agent's `sminos.spawn` is handed to sminos over lane A and never reaches MAWS's session service, launch spec or host; MAWS starts no session on a schedule (a cron fires inside a running engine). `session.spawn` is the one launch without a composer (A5).
5. **2026-11-23 · No environment override.** The ticket calls it optional. A scripted launch that needs a set sets the machine's default or patches its intent.
