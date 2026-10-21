# P4 debt triage: what a fix wave can take beside P4's design

Read-only triage of `docs/tech-debt-tracker.md` at master c395ff0d9 (286 table rows, lines 26 to 311). Master has since moved one docs-only commit to 6db299a01, which opens P4 as "the smoothing phase" and says "the tech-debt wave runs beside P4's design on the rows no P4 design item will rewrite"; the tracker and code are unchanged, so every bin below holds at 6db299a01. Per-row data: `docs/doperpowers/evidence/p4/debt-triage.json` (line, item, owner column, current owner, bin, reason, evidence; WAVE rows add area, files, size, test, mac, batch, and a brief note where the code adds something the row does not say).

Method: the rows were extracted to JSON. 120 rows (every WAVE and CLOSE candidate) were checked against the code by five read-only opus verifiers, one per area (transcript and renderer; main and sessions; store, exports and library; document and deck editors; harness, build and the close candidates), each reading the cited code by symbol. The other 166 rows were binned from the row and a spot check where a claim was cheap to test (desk, cua, gate-lane, upstream-pin, contract and design rows). The verifiers also ran one `tsc -b` on a `git archive` copy (since deleted) and read GitHub Actions job logs with `gh`; nothing in the repo was touched.

## Counts

| Bin | Rows |
|---|---|
| WAVE | 92 |
| OTHER-LANE | 87 |
| P4-DESIGN | 64 |
| HOLD | 20 |
| CLOSE | 16 |
| OWNER | 7 |

**OTHER-LANE, by lane:**

| Lane | Rows |
|---|---|
| Desk (DC3, DC5, DC6, DC9, the desk hub, sminos-hub) | 33 |
| cua_repl session / in-app browser lane | 32 |
| Gate lane | 12 |
| Each Electron bump / native capability pass | 5 |
| Each engine bump | 2 |
| Voice lane | 2 |
| Next settings version | 1 |

**P4-DESIGN, by the P4 item it rides:**

| P4 item | Rows |
|---|---|
| 1, margin comments | L92, L93, L235 |
| 2 and 5, main-area float and tab drag (layout hydration) | L126 |
| 3, click-to-edit | L182 (weak), L231, L253, L256, L280, L293 |
| 5, cross-surface drag | L147, L290 |
| 6, edit-speed bench | L174, L187, L212, L296 |
| 7, launch profile | L270, L303 |
| 8, agent presence | L138, L244, L298 |

The other 43 P4-DESIGN rows are design items in their own right: contract changes (X1, X2, X10, X13, adapter provenance), features, product calls, or the document adapter's carry design.

**WAVE sizes:** 49 S and 43 M, no L. That is more than one wave. Past waves closed 7 to 16 rows per worker, so the queue is three waves: 53 rows now, 31 next and 8 after. Ordering: what the owner sees daily goes first, since P4's agent-run UX assessments through cua_repl will then start from a cleaner baseline; correctness and data paths come next; rare edges, harness and refactors last.

## The proposed wave (wave 1: four opus workers, about a day each)

Each worker takes its batch in an isolated worktree, one commit per row, with class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes` and the named e2e groups on the mini.

### W1-A: Renderer shell, transcript and cards

15 rows, 4 M and 11 S. Linux tests: `renderer`, plus `node` for L123 and L289.

| Row | What | Files | Size |
|---|---|---|---|
| L291 | "No open tabs" flash before hydration | main/Pane.tsx | S |
| L292 | red "unknown app session" while starting | tools/agents/background/BackgroundSummary.tsx | S |
| L276 | an ask answer drawn as "Your message" with raw JSON | transcript/model/derive.ts | M |
| L197 | SendMessage to an agent not among the loaded turns | derive.ts plus a task-graph lookup | M |
| L306 | App-level case for the artifact chip outside a Transcript | App.test.tsx | S |
| L228 | disclosure motion stuck under StrictMode | ui/disclosure.tsx | S |
| L117 | Copy reply swallows the clipboard rejection | side/card/CardThread.tsx | S |
| L111 | delivered replies restart every observer on any change | side/card/delivered.ts | S |
| L118 | question card's one-answer guard is per instance | owner/report/answering.ts | M |
| L123, L124 | `modelAsk` ignores the starting phase; Session info's Model row uses its own rule | shared/sessions/model-label.ts, widgets/model.ts | S, S |
| L257 | mark-up overlay leaves the covered surface focusable | markup/MarkupLayer.tsx, surface.ts | S |
| L301 | Ask Claude before the Spaces list loads | library/MakeSomethingNew.tsx | S |
| L134 | panel Artifacts list not virtualised | tools/artifacts/List.tsx | M |
| L289 | the quit sheet's sentence contradicts its default button | main/lifecycle/quit-guard.ts | S |

Mac groups: `default` (shell.spec), `transcript`, `tools`, `agents`, `to-human`, `document-app`, `library`, `c12`.

Brief notes:
- L197's lookup must enter derive's memo key, the condition L49 closes on.
- L276 carries a small call: hide the envelope row (S), or draw an "Answered" chip (M; it adds a row kind to the desk-facing schema).
- L257 sets `inert` from the markup session, so the new card layer P4 item 2 adds must carry `data-markup-occluder` to be covered.

### W1-B: Documents (dialect, history, tabs, paste, export)

11 rows, 5 M and 6 S. Linux tests: `artifacts`, `artifacts-dom`, `renderer`.

| Row | What | Files | Size |
|---|---|---|---|
| L225, L226 | literal `-`/`+` paragraphs and comment-mark boundaries break the dialect | document/markdown.ts (`escapeText`) | S, M |
| L286 | an agent-made note starts with an empty paragraph | trace first: create path, binding | M |
| L274 | "See N new changes" missed after the first away-edit | tools/document/tab-state.ts, history/controller.ts | M |
| L272 | history lines show tool text with ids | history/model.ts and the summarisers | M |
| L238 | carry labels after compaction | editor/history/paint.ts | S |
| L275 | comment card label repeats the title | tools/document/comments.tsx | S |
| L300 | document tabs have no keyboard path to rename, move or delete | editor/Tabs.tsx | S |
| L305 | document-to-document image paste may not copy the asset | paste plugin, host-types.ts, host wiring | M |
| L308 | HTML export's checklist boxes light on a dark system | export/html.ts | S |
| L309 | a comment's resume can undock a composer trust card | renderer/src/artifacts/session-context.ts | S |

Mac groups: `document`, `document-app`.

Brief notes:
- L272 stays on the display side and leaves the message-through-publish piece in artifact-publish.ts to item 6.
- L275 does the title-equality half only; the one-tab half is at DocumentEditor.tsx:249, item 1's file.
- L274 amends P3-L Decision Log 15's "once per showing" and should define "a return to the tab" before item 5 lands.
- L286 starts with a trace: the create path adds no leading block in source.

### W1-C: Decks, designs, dashboards, design-system page, DOCX

13 rows, 5 M and 8 S. Linux tests: `artifacts`, `artifacts-dom`, `renderer-compiled`, `node`.

| Row | What | Files | Size |
|---|---|---|---|
| L281 | deck inspector's element and token names | slides/editor/Inspector.tsx | S |
| L282 | a new shape filled with Accent | slides/writers-elements.ts:460,476 | S |
| L283 | filmstrip announcements read internal ids | Filmstrip.tsx, and the design's BoardList.tsx | S |
| L284 | Fit does not refit; re-choosing it blanks the stage | DeckEditor.tsx | M |
| L180 | an uploaded family in an unresolved font-token fallback is not aliased | slides/canvas/faces.ts | S |
| L255, L259 | React Compiler bailouts; a presenter bar click leaves focus in an embed | present/Presentation.tsx, DeckBody.tsx | S, S |
| L240 | design history notes stops disagree with the pill | design/history.ts | S |
| L251 | forced board-order settle over-reverts the owner's re-orders | design/order.ts | M |
| L191 | repeated bar categories side by side, the owner's E2 change | dashboard/render/render.ts | M |
| L279 | design-system page crops canon previews; aliases shown raw | design-system/page/Canon.tsx, page.css, Palette.tsx | M |
| L287 | dashboard export credits "Claude" | main/dashboard/export.ts | S |
| L288 | DOCX drops orphaned threads (resolved-with-passage already exports as done) | document/export/docx.ts | M |

Mac groups: `presentations`, `design`, `dashboard`, `design-systems`.

Brief notes:
- L281 lands before item 3's implementation (Inspector.tsx is L280's file).
- L284's likely cause: the stage viewport remounts after a history preview and the ResizeObserver stays on the detached node.
- L191 keeps candidate 68's near-black ink out: the house law has no categorical palette.

### W1-D: Engine-host store, library mirror, tool-server paths, exports

14 rows (13 changes, since L160 and L245 are one), 5 M and 8 S. Linux tests: `node`; `unit:darwin` on the mini for mirror.test.ts.

| Row | What | Files | Size |
|---|---|---|---|
| L130 | an import retry keeps the failed attempt's files | engine-host/documents/store.ts | S |
| L241 and L149 | the storage fallback of suggestion attributions misses the main doc's overlay: one defect, two rows | store.ts:1137-1140 | S |
| L248 | the staged-file listing is unguarded | documents/bytes.ts, store.ts | S |
| L277 | a duplicated design system reads "Built in"; raw subtitle | ask/copy.ts, store.ts `copyOf` and a kind hook | M |
| L136, L249, L254 | mirror: name folding vs APFS, removal under a relinked folder, `readNow` following links, no reconcile when a Space's link returns | engine-host/library/mirror.ts, ByteViewer.tsx comment | S, S, M |
| L243 | the tool server reads the named path after checking the real one; export follows a final-component link | tool-server/artifact-context.ts, artifact-assets.ts, artifact-export.ts | M |
| L160 and L245 | a version's exports carry later assets | `artifacts.assets` input gains optional `versionId` (shared/ipc/schema/artifacts.ts:212-215), register.ts, main/artifacts/export.ts | M |
| L131 | an export rename can answer success after the 55 s budget | main/artifacts/export.ts | S |
| L302 | header exports found by a shared cache name | main/library/files.ts and three renderer callers | M |
| L246 | dashboard refresh's catch logs nothing | engine-host/dashboards/refresh.ts | S |

Mac: `unit:darwin`, plus groups `artifacts`, `library`, `design-systems`, `document-app`, `presentations`.

Brief notes:
- **Sequencing:** this batch lands before P4 item 4's implementation. store.ts is item 4's file, and `copyOf` is a write path its FTS mirror will hook.
- L160 and L245: the `versionId` member is a P3 ledger X23 row, not a charter contract, so a dated ledger note suffices.
- L243: `O_NOFOLLOW_ANY` fails with ELOOP under /tmp and /var on macOS; follow `datasets.ts`'s safe read.
- L302: the save must delete its own export file afterwards, since nothing cleans the exports directory.

## The queue after wave 1

| Batch | Rows | Size | Mac |
|---|---|---|---|
| W2-A Sessions and the engine-host disk path | L31, L73, L94, L120, L107, L90, L79 | 5 M, 2 S | `available`, `to-human`, `supervisor` |
| W2-B Main services: git, scm, index, lifecycle | L33, L47, L48, L72, L76 | 5 M | `scm`, `code`, `supervisor`, `c12`; L76's class-2 measurement on an APFS copy of the owner's store |
| W2-C Renderer remainder and browser-shared | L46, L52, L62, L63, L74, L28, L68 | 3 M, 4 S | `code`, `browser-comment`, `deliverables`, `artifacts`; L28 is a manual `pnpm dev:harness` check |
| W2-D Harness, build, live and compiled coverage | L45, L78, L109, L110, L112, L121, L155, L158, L190, L213, L233, L299 | 4 M, 8 S | `widgets` (L45), `library` (L299); L121 needs only a no-spend `--list` |
| W3-A Editors and exporters remainder | L157, L239, L250, L307 | 4 M | `presentations` with an offscreen Electron probe (L250), `design-systems`, `document` |
| W3-B Measurement harness | L189, L230, L242, L252 | 2 M, 2 S | class 2: `design-scale`, `document-scale`, `presentations-scale`, `artifacts-perf`, `dashboard-scale` |

Notes on the queue:
- **W2-A:** L94 lands before item 7, which feeds the launch options into inflight.ts's join rule. L107 is an additive optional X18 member: record it in the interface ledger. L73 checks what `rewind_conversation` answers for an already-rewound target first.
- **W2-B:** L72 is a drain-first phase in shutdown, medium risk on a rare harm.
- **W2-C:** L28 and L68 are the two WAVE rows without an automated test: L28 has only a manual dev check, L68 only lint.
- **W2-D:** L213 should run before items 1 and 3 are implemented. A compiled-only red in their editors is recorded for them, not fixed in their files.
- **W3-A:** L157 refuses an agent's publish of malformed canon on the host, where the page only flags it today. Accept that knowingly.
- **W3-B:** L242 is recalibrated on the mini after item 3 lands (it rewrites the measured World.tsx); do it with L252. L230's in-spec quiet wait is the helper item 6 should reuse.

## CLOSE (16), with evidence

| Row | Why it closes |
|---|---|
| L49 (E7, derive memo key) | Cannot matter: every fact a later message row reads about an agent is written by the launching turn (derive.ts:440-441, 475, 529-533, 739); `peer.message` routes to the current turn; the whole history loads at once. Holds only while L197's lookup enters the memo key. |
| L67 (E4c spike watchdog) | Obsolete: the e4c spike is historical (findings in spikes/browser-probe/findings-e4c-unplaced.txt); the Electron-bump procedure (L66) re-runs spikes/cua-backend/s1-dialogs.mjs, not this file. The PID watchdog at unplaced.mjs:375 is untestable spike code. |
| L91 (P2-A, sendHumanPrompt and the card's lifetime) | 9b1dd0533 (F-C1) put the card's claim `current()` through acquisition and before every dispatch (send-human-prompt.ts:27-30, 52-53, 87-92; setup-actions.ts:156; pinned at cards.test.tsx:808). Only a Cancel inside the `session.send` invoke remains, a few-millisecond window a renderer cannot withdraw. |
| L129 (P3-A, eight tests' timing headroom) | Premise obsolete: the unit suite runs on CI's Linux pool since the gate offload. resource.test.tsx is in renderer-timing; the pty flood and zsh cases are macOS-guarded; the rest show no CI red since 2026-10-14. |
| L144 (P3-B, Side thread replies) | Its own text: narrowed and closed 2026-10-18 for the card's Reply (CardThread.tsx:83-86, 205, c7547b91f); the residue is L220. |
| L145 (P3-B, pause-take-over.pty.test.ts) | READY_MS 10 s polls (pause-take-over.pty.test.ts:11-16), in node-timing; its only CI red preceded zsh's install on the runner. |
| L146 (P3-B, one preview editor per preview) | Already reused: PreviewEditor's `useEditor` deps exclude the view and it calls `showVersion(view)` (DocumentEditor.tsx:671-698). |
| L159 (P3-D, own zip writer vs jszip) | Against design intent: 75 lines over native zlib keep main's thread free for font megabytes (main/design-systems/zip.ts:1-75), checked against /usr/bin/unzip, shared by the deck's export. |
| L183 (P3-C, filmstrip keyboard reorder) | 287b45bb1 in master (presentations.spec.ts:273-276). Green in 39130559347, 39133832247, 39202806940 and 39297005763; the one red since was at another line. The row's own reopen rule stands. |
| L201 (shell.spec default) | The remaining clause is met: 39202806940 ran all 34 e2e groups green, `default` included; later reds are other signatures. |
| L205 (gate lane desktop watcher) | Its own text and gate-offload Decision Log 72; the drain gaps are ci-kit#46. |
| L214, L215, L216, L217 (DC9) | Their own text ("Closed 2026-10-18"); the cited code is on master (desk-web bridge-rows.ts:44-65, appended-turn.ts, bridge-wake.ts, off-chain.ts). The desk lane removes them. |
| L273 (P4 history list not live) | The row's premise is false: history-api.ts:51-65 listens on `artifacts.changed`, controller.ts:133 subscribes, refresh keeps the selection and preview (pinned at history-api.test.ts:112). What the owner saw is most likely by design: an agent's edits become a version only at its turn's end. |

## OWNER (7), each with the decision it needs

- **L32, catalogue key:** rule the residue final (managed settings unread, network-path refusals unmirrored, the cache stale across account or policy changes), or keep it open for a real automount or managed-settings case.
- **L133, one locale per surface:** which language a surface takes.
  - English copy with English-formatted ages and times reverses D2's system-locale ages.
  - System-locale formatting needs Korean copy, or copy that never mixes.
  - The verifier recommends English throughout: an M sweep (6 en-US pins, 5 stray system-locale sites, `relativeAge`) plus about 24 suites' expectations.
- **L156, HWP/HWPX export:** offer it (a maintained HWPX writer or LibreOffice's filter), or drop the row.
- **L176, Google Fonts:** whether a deck should download a named Google Fonts face into its assets once.
- **L177, PPTX charts and Morph:** whether to ask for native PPTX charts and the Morph mapping.
- **L181, the owner's hands:** present full screen and on two displays; open the three PPTX font variants in PowerPoint and Keynote.
- **L204, the owner's hands:** take ClaudeUsage.app off the mini (or set it to poll at minutes) while the mini serves as a runner.

Owner calls inside rows binned elsewhere:
- **L95:** if the one-line chooser preview is enough, the row closes.
- **L220:** only the card's Reply is recorded, or a host-side thread write.
- **L224:** accept a specified hardBreak loss.
- **L285:** the document toolbar keeps the app's accent by D13, or follows the document's system.
- **L294:** the Send to sheet's interim copy (states the session's permission mode) is S and could ride any renderer batch now.

## HOLD (20), by condition

| Waits on | Rows |
|---|---|
| Upstream releases or re-pins: xterm serialize addon (OSC 8) | L27 |
| … @git-diff-view and lowlight on one highlight.js | L30 |
| … @y/y | L127, L128, L132, L148, L150 |
| … @y/prosemirror | L140 |
| … parse5 | L175 |
| The engine reporting a hook timeout on `hook_started` | L35 |
| Recorded journals or cases | L29, L36 |
| A live probe on the pinned engine (the owner's login) | L50 (EnterWorktree), L195 (Monitor), L237 (show_pane) |
| A sitting or reproduction | L70, L106, L227, L232 |
| A recurrence traced with `MAWS_IME_TRACE` | L80 (the owner ruled "keep") |

## What looks wrong in the tracker

**Closed rows still in the table:**
- L144, L205, L214, L215, L216 and L217 record their own closure.
- L183 and L201 meet their remaining clause.
- L146 and L273 describe code that is already otherwise.

**Duplicates:**
- L149 and L241 are the same defect: the storage path of suggestion attributions.
- L160 and L245 are one change: `artifacts.assets` gains `versionId`.

**Stale owners,** naming children that have landed:
- L32 (P3).
- L80 ("P2-F, until the declaration"; also lacks the sitting's T.1 trace and the owner's "keep" ruling).
- L89 (P2-F's gate runs, then P3).
- L156, L183, L186, L202 and L227 (P3-F).
- L172 (P3-F's fix wave).
- L181 (P3-F (owner)).
- L228 and L230 (P3).

**Wrong or outdated row text:**
- **Paths and pointers:**
  - L130 cites `src/artifacts/store.ts`; the code is `src/engine-host/documents/store.ts`.
  - L238's file is `editor/history/paint.ts`.
  - L282's accent is in `writers-elements.ts`, not Insert.tsx.
  - L276's envelope is built in `shared/maws/ask.ts` and sent at `engine-host/session-maws.ts:182`, not connect.ts.
  - L91 cites a nonexistent `main/sessions/acquire.ts` and misses 9b1dd0533.
- **Causes:**
  - L78: the steer is already covered; the trailing `/btw` keeps the reservation.
  - L96: Manage marketplaces never shows pinned or unpinned; the effect is MAWS's fold key.
  - L27 is routed to the Electron bump, but it is an xterm addon limit.
- **Scope:**
  - L157 says DESIGN.md; the check is on the canon HTML.
  - L288: resolved threads with a passage already export as done.
  - L241 is wider than stated: a partial range on a loaded doc too.
  - L180 also hits the live canvas.
- **Counts:**
  - L109: 108 TS6307, not 69.
  - L112: rotation files double-count too.
  - L155: the vitest banner is gone; Transcript.tsx now warns too.

**L186** is owned on paper by P3-F, but e2e:browser-cua is the cua lane's. Its one-line `expect.poll` fix should go there.
