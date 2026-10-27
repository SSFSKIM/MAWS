# Image and PDF intake through a synthetic native Read (measured)

Ran on **Claude Code 2.1.310**, the build installed on this Mac (`/Users/new/.local/share/claude/versions/2.1.310`), on 2026-10-25. This is wave 2, item 1, of [desk-build-request-mod-surface.md](desk-build-request-mod-surface.md). It tests [mod-control-surface.md §3.1](mod-control-surface.md#L68) and §7 item 3. Engine line references are to the [2.1.310 reprint](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js).

**M** = measured (an observed result plus an independent check of the effect). **I** = inferred from source, or a recommendation, not run.

There were 19 isolated runs. 30 independent assertions over request bodies, transcripts, hooks and cleanup all passed. No inference was spent. The probe ran as an astra subagent of `remote-architecture`, which wrote this note from its hand-back. I spot-checked the media hashes in the kept request bodies.

## What it comes to

- **M** **The synthetic Read route works.** Use it. A `turn.step` generator that doesn't call `next`, and yields `text`, `tool`, `input` and then `stop` with `stopReason:'tool_use'`, makes the engine run a native Read. The next model request carries the media in that Read's result. There is no extra model request to talk the model into reading.
- **M** **PNG and PDF both work, and a PDF can arrive in two forms.** A PNG becomes an `image` block. Reading a one-page PDF without `pages` gives a `document` block holding the original PDF. Reading it with `pages:'1'` gives a JPEG `image` instead.
- **M** **Permission depends on where the file is saved.**
  - In default mode, a file in the cwd is read without asking.
  - A file outside the cwd raises the normal Read dialog.
  - The **same plugin's** `classic.PermissionRequest` hook can allow it, because the Read is engine-originated, not the plugin's own call. No second plugin is needed.
- **M** **Intake happens at the next step boundary,** never inside a request already in flight.
  - A tool that is already running finishes first.
  - If the model request in flight ends with `end_turn`, there is no next step, and the upload waits for the next turn.
- **M** **Esc cancels for real, but the engine latch doesn't block every bridge API.**
  - After Esc, `prompt.submit` is refused until the person types.
  - `tool.call`, `session.append` and `prompt.read` still work.
  - The bridge has to enforce its own cancellation rule.
- **M** **Put the disclosure in the streamed text.** The synthetic rows are shaped as assistant/model rows. In the JSONL they are marked `answeredWithoutRequest:true` and `isUnmetered:true`. A streamed text prelude shows in the TUI and reaches the model. A `session.append` note didn't show in the ordinary TUI, so it can't be the only marker.

## Results

### 1. The media reaches the request

**M**, run `formats1`. The plugin queued an upload, then submitted a prompt from its child's stdout handler.
- Step 0 yielded the synthetic Read, and step 1 passed through to the stub.
- The turn made one HTTP request, and that request already held the media.

Wire shapes, inside the user `tool_result.content`:
- **PNG:** an `image` with `source.type:'base64'` and `media_type:'image/png'` ([request-001](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/requests/formats1/request-001.json)).
- **Whole PDF:** text `PDF file read: … (599 bytes)`, then a `document` with `media_type:'application/pdf'` ([request-002](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/requests/formats1/request-002.json)).
- **PDF with `pages:'1'`:** text `PDF pages extracted: 1 page(s) …`, then an `image/jpeg` ([request-003](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/requests/formats1/request-003.json)).

**M** Decoding the request blocks gives back the fixture files byte for byte:
- the 80-byte PNG, SHA-256 `5503ff8f…57ef`;
- the 599-byte PDF, SHA-256 `06deff59…c93e`.

The native tool-result records name the kinds `image`, `pdf` and `parts`. The engine's mapping is at [L217464](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L217464). The whole-PDF versus page split is at [L217704](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L217704). The machine-readable audit is in [audit.json](media-spike/audit.json).

**I** These are small files. They are no evidence for large uploads, malformed PDFs, or every model. Read's own size limits and PDF/model checks still apply. Page rendering used the Poppler tools installed on this Mac (`pdfinfo` and `pdftoppm`). A machine without them may not render pages.

### 2. Permission and the bridge's call origin

- **M** **Inside the cwd.** The PNG and PDF reads in default mode asked nothing. There was no allow rule and no PermissionRequest event. The JSONL decision reads `accept`, `source:'config'`, `reasonType:'mode'`.
- **M** **Outside the cwd, no hook** (`outside-ask1`). The normal dialog appeared, including "Yes, allow reading from … during this session" ([permission-screen.txt](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/outside-ask1/permission-screen.txt)). Declining gave an error tool result and `[Request interrupted by user for tool use]`. No model request followed.
- **M** **Outside the cwd, with the same plugin's hook** (`outside-allow1`). The hook returned `{decision:{behavior:'allow'}}` for the upload dir. The Read succeeded, and the next request held the image ([request-001](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/requests/outside-allow1/request-001.json), [summary.json](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/outside-allow1/summary.json)). The JSONL decision reads `source:'hook'`, `reasonType:'hook'`.
- **M** **Contrast run** (`direct-origin2`). The child's stdout handler called `$.tool.call({tool:'Read', file_path})` directly, with the same hook installed. The hook was **skipped**, and the native dialog appeared. The debug log reads `classic.PermissionRequest skipped: re-entry (the plugin's own code raised it; origin media-probe)` ([debug.log](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/direct-origin2/debug.log)). The handler's `prompt.submit` likewise skipped the plugin's own prompt hook. This confirms the probe really ran from the detached plugin origin.
- **I**, corroborated by those runs. The probe mod copies the bridge's origin:
  1. `session.start` starts a detached async function.
  2. `$.process.spawn` makes a session-lifetime child.
  3. A `for await` loop over the child's stdout dispatches lines with the captured `$`, as in [bridge.tsx L1324](/Users/new/Developer/GitHub/doperpowers/sminos/hooks/mods/bridge.tsx#L1324).

  [Origin construction (L229934)](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L229934) tells a registration frame apart from a detached plugin call. [Re-entry selection (L670965)](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L670965) excludes the plugin's hooks on its own detached calls. The engine's later synthetic tool run is not such a call, so the plugin's permission hook stays eligible.
- **I** The directory-wide allow was only fixture policy. In production:
  - tie the allow to the accepted upload and the generated tool-use id;
  - leave higher-priority policy in force;
  - never allow a whole directory.

### 3. Re-entry, duplicates and timing

- **M** **Re-entry.** Every synthetic step was followed by another `turn.step`; each `formats1` turn logged step indexes `[0,1]`. The hook removed the queue entry before yielding, so the next step found the queue empty and called `next`.
- **M** **Duplicates.** A repeated upload id was acknowledged as a duplicate and produced exactly one tool-use row.
- **I** The probe's in-memory Set only shows deduplication within one process. Production needs upload state scoped to the session that survives a reload, so a module reload can't replay a claimed upload.

**M** Timing (sample runs, not performance guarantees):

| Situation | Observed |
|---|---|
| Idle | A child-origin `prompt.submit` started the turn. From the handler receiving the upload: the synthetic claim at 246 ms, the Read result at 435 ms, the first request with the PNG at 626 ms (`formats1`). |
| A Bash already running | Queued during `sleep 3`. Steps `[0,1,2]`: the model's tool call, the synthetic Read, then the next real request. The claim came 112 ms after the Bash result, and the media reached the request 3,538 ms after the upload was acknowledged ([mid-tool2](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/mid-tool2/summary.json)). |
| A model request in flight that returns `end_turn` | The turn ended with no Read and no new step. A later prompt's first step consumed the upload ([mid-model2](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/mid-model2/after-first.json)). |
| A model request in flight that returns `tool_use` | The model's Bash ran, step 1 injected the Read in the same turn, and step 2 sent the media ([mid-model-tool1](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/mid-model-tool1/summary.json)). |

**I** The bridge needs a pending-work check when a turn completes, because queuing during a turn doesn't guarantee another step. The opposite mistake is to always send a wake prompt while a turn might still consume the upload, which adds a turn that isn't needed.

### 4. Esc

- **M** **Esc mid-step.** Two runs pressed Esc during the synthetic step:
  - `esc-step1`: after the text chunk, before the tool chunk;
  - `esc-step-chunks1`: after the tool and input chunks, before the stop.

  Both had claimed the upload, but neither ran the Read or sent a model request. Their text and tool blocks are absent from the JSONL; an assistant row `user-cancel` stands in their place. The engine buffers the no-request answer until the generator finishes ([L720210](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L720210)).
- **M** **Esc after the Read** (`esc-model2`). Esc came while the stub held the following model request.
  - The synthetic text, the tool call and the image result stayed in the JSONL, followed by `[Request interrupted by user]`.
  - A later human turn's request still held the image.
  - Esc does not take back media already sent.
- **M** **After either kind of Esc:**
  - a child-origin `prompt.submit` returned `{drop:'the session was stopped and nobody has sent input since'}` ([late-submit.json](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/esc-model2/late-submit.json));
  - a user-role `session.append` succeeded;
  - a direct read-only `$.tool.call(Read)` succeeded and returned the bytes, with no tool call added to the conversation ([late-tool.json](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/esc-step-chunks1/late-tool.json));
  - `prompt.read` succeeded;
  - after real terminal input, a new upload ran again.

  The latch is set at [L147431](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L147431) and checked for prompts at [L153513](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L153513).
- **I** Mark a claimed-then-aborted intake cancelled, and don't retry it because a later turn starts. Never use the APIs that still work to get around the person's Esc.

### 5. Provenance

- **M** **A streamed prelude works.** One such as `[Bridge-requested upload …; native Read, not a model choice.]` showed above the normal "Read 1 file" line and reached the next request ([result-pane.txt](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/formats1/result-pane.txt)).
  - In the JSONL, the text and tool rows share `message.id:'msg_hook_…'`, with `apiBlockIndex`, `isUnmetered:true` and `answeredWithoutRequest:true`.
  - Their model field still names the configured model.
  - The `session.append` observer reported their origin as `{kind:'model', model:…}`.
  - The tool result is a normal user row, linked by `sourceToolAssistantUUID`.
- **M** **`session.append` notes.**
  - A user-role note was stored `isMeta:true`, with `origin:{kind:'plugin', name:'media-probe'}`, and it reached the model.
  - A system-role note was stored as an informational system row and did not reach the model.
  - Neither showed in the ordinary TUI ([system-note-pane.txt](/Users/new/claude-code-bundle/2.1.300/notes/media-spike/evidence/notes-only1/system-note-pane.txt)).
- **I** **Recommended disclosure.** Use the streamed prelude as the visible, model-readable attribution. Keep a bridge-side map from upload id to tool-use id as the structured provenance. A user note can add plugin-stamped audit context, but not as the only disclosure. Don't present the Read as the model's choice. Synthetic construction is at [L720263](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L720263), and the append origin is pinned by the [2.1.310 types L11149](/Users/new/claude-code-bundle/2.1.310/modules/claude-code.d.ts-bf9d954c.txt#L11149).

### 6. Negative controls and the M5/S9 fallback

- **M** **Result-only control** (`negative1`). The hook returned `toolUses:[{name:'Read', input:…}]` with `stopReason:'tool_use'` but streamed no chunks. No tool ran, no tool-use row appeared, no HTTP request went out, and the turn ended empty. The stream decides, not the returned result.
- **M** **`@path` control** (`literal1`). Plugin text naming `@<png>` and `@<pdf>` produced no media and no Read. This matches plugin prompts defaulting to `skipAttachments:'all'` ([L295238](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L295238)). Submit validation, which accepts text only, is at [L153605](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L153605).
- **M** **The fallback** (`fallback1`). The upload was saved in the cwd with an instruction to read it.
  - The first request was text only.
  - A canned model Read then ran without permission, and the second request held the PNG; the PDF behaved the same way.
  - Once the Read runs, the fallback and the synthetic route use the same native media and permission machinery. The fallback costs one extra model response, so the model can choose the tool.
- **I** A zero-spend test can't show whether a real model obeys the instruction. The fallback stays nondeterministic there; the synthetic route removes that dependency.

## What contradicts or narrows the inventory

**M** No inventory claim was falsified:
- the synthetic composition works;
- the result-only control does not;
- plugin `@path` doesn't expand;
- detached self-reentry is real.

That composition is now measured on 2.1.310. Three qualifications matter for the build:
1. A request in flight that ends with `end_turn` gives no next step.
2. The synthetic rows still look model-originated.
3. The Esc latch refuses `prompt.submit`, not every bridge API.

## Recommended bridge design

- **I** **Intercept on the main loop's `turn.step` only.**
  1. Save an immutable, validated upload.
  2. Assign a session-scoped upload id and a generated tool-use id.
  3. Claim the pending work atomically before yielding.
  4. Stream the bridge-requested text prelude, then the native Read's tool, input and stop chunks.
  5. On the following step, with nothing pending, return through `next`.
- **I** **Save inside the cwd first.** Prefer a session-specific upload dir within the cwd, which needs no new approval path. If outside storage is required, the same plugin can supply a narrowly bound PermissionRequest allow for that one accepted Read. Keep policy restrictions in force.
- **I** **Wake and acknowledge carefully.**
  - Wake an idle session with a disclosed plugin prompt.
  - During a turn, enqueue and wait for the next boundary. If the turn ends with work still pending, schedule one wake.
  - Tie cancellation and deduplication to session and upload state, and reconcile them on reload.
  - Report "saved", "Read completed" and "in the next request" as three separate states, not all at upload time.
  - Don't replay an interrupted claim or get around Esc.
- **I** **Keep M5/S9 as the simpler fallback.** It has the same cwd permission advantage and ends with the same payload. But its first request lacks the media, and it depends on the model choosing to Read.

## Method

- **M** **Isolation.** Every run used a fresh temporary HOME and CLAUDE_CONFIG_DIR under `/private/tmp/wave2-media`, with:
  - a dedicated `tmux -L wave2-media-<case>`;
  - an `env -i` launch;
  - `daemonColdStart:'transient'` and `DISABLE_AUTOUPDATER=1`.

  The real sminos plugin was not loaded. The minimal mod's child transport has the bridge's origin, without the hub or daemon. Nothing of the owner's was used.
- **M** **The stub.** `ANTHROPIC_BASE_URL` pointed at a Python stub on 127.0.0.1, and the engine had only a dummy key.
  - Telemetry, error reporting and nonessential traffic were off.
  - HTTP(S) proxies refused every destination except localhost.
  - The stub saved every POST body and answered with canned SSE.
- **M** **Verification.** The verifier read request bodies, JSONL rows, hook events, panes, fixture hashes and process/socket state. Three early runs failed on an onboarding offer in the isolated profile, not on the API under test. They are kept as friction evidence, not counted. Nothing was left running.
- **Scripts** are in [media-spike/](media-spike/):
  - `harness.py`;
  - `matrix.py` (run one case with `python3 -I …/matrix.py <case>`, using a fresh case suffix);
  - `plugin/hooks/register.ts` and `plugin/child.py`;
  - `verify.py` and `audit.json`.
- **Evidence.** All 30 recorded request bodies are in `media-spike/requests/<case>/`, with `manifest.json` giving each one's original path, SHA-256 and whether it was a main or auxiliary request. The cited panes, summaries and logs are in `media-spike/evidence/<case>/`.
- **Harness lessons** (logged in MAWS #92):
  - An isolated profile's first run can stop on the auto-mode offer; the fixture flags and API-started turns avoid it.
  - Title-generation requests come between main requests, so classify each request before handing it a canned answer.
