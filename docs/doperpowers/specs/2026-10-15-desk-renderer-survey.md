# The desk — which MAWS renderer pieces the web app can reuse (survey, 2026-10-15)

Input to DC5 and DC6 of `docs/doperpowers/specs/2026-10-15-desk-design.md`.
Method: an import graph built with the TypeScript compiler API over
`src/renderer/src`, `src/shared`, `src/artifacts` at 5bd3d66f + DC3's M1. A
module is *entangled* when its value imports (not type-only) reach
`src/renderer/src/ipc/client.ts`. Runtime claims come from reading code;
nothing was run in a browser. `rs/` = `src/renderer/src/`.

## Three facts that shape everything

1. **One file touches the bridge.** `rs/ipc/client.ts:55`
   (`export const ipc: MawsBridge = createClient(() => window.maws)`) is the
   only product renderer file reading `window.maws`; none imports
   `electron` or a Node built-in (in `src/shared`, only `shared/host/*` and
   `shared/ipc/wire-fingerprint.ts` use Node). 169 renderer files import
   the client directly.
2. **Importing an entangled module is safe in a browser; calling it is
   not.** `window.maws` is read per call and nothing calls `ipc` at import.
   Without a bridge `ipc.invoke` rejects and `ipc.on` throws a TypeError,
   crashing the effect that subscribed.
3. **The presentation model reads X1 `SessionEvent`
   (`src/shared/graph/events.ts`), not stream-json.** Mappers to X1:
   `src/engine-host/fs/backfill.ts` (`createBackfillContext`,
   `recordToEvents`; JSONL rows; closure 9 files, ~1,480 lines, zod only)
   and `src/engine-host/normalizer.ts` (stream-json; closure 44 files,
   ~7,100 lines, zod only). Neither is lint-guarded;
   `engine-host/fs/chain-follower.ts` uses the `Buffer` global.

**The DX4 adapter:** `snapshot.rows` (newest first) and `row` →
`recordToEvents` with a `SubagentLookup` from the `subagents` metas;
`chunk` and `streaming` → synthesized `assistant.block.delta` events.
**Risk:** the reducer pairs a streaming block with its completed row by
API message id (`rs/transcript/model/reduce.ts` ~544 delta, ~817
`completeBlock`); a DX4 chunk carries only `(turnId, agentId, step,
chunkIndex)`, so unless the deltas carry the real `message.id` the
arriving row will not settle the live block and the text shows twice.
(Raised with DC2 the same day: can the bridge carry the message id.)

## Piece by piece

| Piece | Size | Clean (import) | Entangled, and the edge | Stores / data |
| --- | --- | --- | --- | --- |
| Transcript (`rs/transcript/`) | 91 files, ~10,800 lines | `model/*` (closure 68 files, zod only, compiled under Node by `tsconfig.node.json`), `source/hydrate.ts`, `replay.ts`, `types.ts`, `rs/stores/transcript.ts` | `source/ipc.ts` (direct); `index.ts`, `shell.tsx` through it. `view/Transcript.tsx` closes over 304 files / 33k lines (xterm included); about 10 cuts free it to 154 files / 18,700 lines: `view/context.tsx → source/ipc.ts` (`DEFAULT_ACTIONS`: `ipcLoadSpill`, `ipcOpenExternal` — the edge that entangles Markdown, every row, the to-human presenter), `cells/Spill.tsx` (constants), `Transcript.tsx`/`rows/BrowserActivity.tsx → tools/browser/agent/activity.ts`, `rows/Row.tsx → owner/report/OwnerRecordRow → copy.ts → sessions/acquire.ts` (constants), `rows/Artifact.tsx → ConsoleChip`, `surface/Rows.tsx`/`Tools.tsx → engine-surface/*` (inert without `uiSurface`), `surface/Rows.tsx → OwnerReport`, `rows/Divider.tsx → engine-surface/spinner.ts`, `rows/Error.tsx → gateway/actions.ts` (a constant), `rows/PeerComposer.tsx → sessions/acquire.ts`. `TranscriptSlot.tsx` adds `composer/effective-effort`, `stores/owner-channel`, `stores/queue`, `source/ipc` | `useTranscriptStore` core; `useSessions`, `useLayout`, `useQueueStore`, `useOwnerChannel`, `useAssistantDrawings`. In: X1 events via `TranscriptSource {subscribe, snapshot, key?, agentId?, onReset?}`, subscribe-before-snapshot, dedup by event id (backfill ids deterministic: `<uuid>`, `<uuid>#<n>`). npm after the cuts: streamdown (+math, mermaid), @tanstack/react-virtual, katex, shiki, radix-ui, rehype-harden, unist-util-visit, zod, zustand |
| Request card (`rs/request-card/`) | 26 files, 2,055 | `variants/Permission.tsx`, `variants/Question.tsx`, `controls.tsx`, `answers.ts` (`toAnswer`), `scope`, `quick-approval`, `question-steps`, `tools`, `requester`, `variants/dialog-kinds`, `elicitation-form`, `preview/*` | `RequestCard.tsx` calls `session.answer`, `attention.acknowledge`, `session.setPermissionMode`, `layout.openExternal` directly and has no `client` prop; `variants/Dialog`, `Elicitation`, `Notice` call the client; `Plan`, `Ask` import the transcript index; `index.ts` imports `app/slots` | `useAttention` (items, request cache via `attention.request`, question drafts), `useComposerStore`, `useSessions`, `useLayout`, `useTranscriptStore`. In: an `AttentionItem` + the `*.requested` event; out: `RequestAnswer` (answers keyed by question text, as native AskUserQuestion's `updatedInput.answers`) |
| Composer (`rs/composer/`) | 67 files, 6,934 | `editor/` (`doc`, `schema`, `serialize`, `recall`, `history`, `drafts`, `paste`, `attachments`, `clipboard`, `env`, `nodes/*`), `mentions/` (`items`, `rank`, `popup`, `SlashPalette`, `widgets`), `submit/` state and control, `docked/*`, `queue/QueueEdit`, `frame/` chips, `stores/composer.ts` | 29 of 67; `editor/Editor.tsx` (client, `stores/catalog`), `mentions/AtMenu.tsx` (`git.lsFiles`), `editor/submit.ts → send-human-prompt`, `Composer.tsx` (`ipc/query`, `RequestCard`, statusline, `widgets/model`, `stores/queue`). Injection: `client?: MawsBridge` threaded through most; `Editor` takes `drafts?: DraftPort` and `onSubmit` | ~31 X2 commands; query keys `['maws', name, input]` via `rs/ipc/query.ts` (`session.listModels`, `engine.models`, `session.listPermissionRules`, `settings.userEngineDefaults`, `session.getContextUsage`, `session.observedFacts`) |
| Attention (`rs/attention/`) | 5 files, 372 (+ store 182) | `derive.ts`, `glyph.ts`, `GlyphMark.tsx`, `anchor.ts` (`open` injectable), `stores/attention.ts` (client passed in) | `navigation.ts` (shell wiring: `attention.navigate`, `notified`, `pendingNavigate`, side/panel/floating) | Items are derived in main (`src/main/attention/service.ts`, 379): the desk derives them from DX4 `raised`/`settled` and presence |
| Subagents (`rs/tools/agents/`) | 35 files, 5,188 | `model/*` (`task-graph.ts` 679), `copy.ts` | `client.ts` (`createAgentWorkClient(ipc)`), `store.ts`, `relay-store.ts`; UI via `app/IconButton → stores/settings`, transcript index, `composer/index`, `panel/summary/Section → stores/summary` | Seams: `AgentWorkClient` + `setAgentWorkClient` (`rs/harness/agents/fakeClient.ts` implements it over fixtures), `setChildSourceFor` (`subagents/DrillIn.tsx`), `PanelTool` types. **Wrinkle:** the live path drops events with null `seq` and parses a launch id from `<app>:<launch>:<seq>:<n>` (`store.ts:153`); backfill events have null `seq`, so the adapter must stamp them |
| Diff review (`rs/tools/code/review/`) | 8 files, 1,498 | `ReviewView.tsx`, `review-model.ts` (`splitPatch`), `view-state.ts`; needs @git-diff-view/react, @git-diff-view/shiki, and the `lowlight`/`lowlight-engine` aliases from `electron.vite.config.ts` | `review-store.ts` (`git.diff`, `git.worktree.branch`, `stores/git`), `ReviewShell` (`open-file`, viewer store), `ReviewSummary` | DX4 `diff {base, text}` → `splitPatch(text)` directly; MAWS's four scopes have no desk equivalent |
| `rs/app/slots.ts` | 44 | the zustand registry | `FALLBACKS` (`slot-fallbacks.tsx → sidebar/RequestPreview`) | DX8 copies it and `transcript/shell.tsx` |
| Owner report / to-human | ~1,500 total | `owner/report/project.ts`, `transcript/model/owner-marks.ts`, `src/shared/owner/*` (`to-human-parser.ts`) | `owner/to-human/Presenter.tsx` only through `view/context.tsx` (clean once `DEFAULT_ACTIONS` is cut); `OwnerReport` (owner channel in main), cards via `copy.ts` and Markdown | `transcript/surface/Rows.tsx` picks the Presenter when the owner lane is off and no engine surface |
| Question sheet (`rs/tools/maws/ask`) | 12 files, 1,342 | `store.ts`, `draft.ts`, `copy.ts`, `modalities/Text.tsx` | `AskSheetTool`, `connect.ts`, `modalities/Paths.tsx` (native picker) | MAWS's own `maws` MCP ask tool, not native AskUserQuestion: **do not bring**; desk questions go through the request card's question variant |
| Tokens and theme | `rs/styles/tokens.css` 111, `app.css` 125 | CSS only: token-named Tailwind v4 utilities (`@theme inline`), `var(--…)` in `transcript.css`, `report.css`, `presenter.css`, `code.css` | — | The app sets `data-theme` itself (MAWS sets it from main's settings at `rs/App.tsx:308`); JS reads it (MutationObserver) in `ReviewView`, `CodeView`, mermaid plugins, terminal theme; system font stacks; shiki github-light/dark. Likely needs `@source` lines for imported MAWS directories (unverified) |
| `src/artifacts/` | 140 files, ~23,500 | lint-enforced portable (no electron, Node, `window.maws`, Node globals); typechecked under web and node configs; tested under Node and happy-dom | none | Usable: `host.ts` (`ArtifactHost`, `DocumentHandle`), `provider/port.ts` (`PortProvider` over a `PortLike`, comments name a P4 WebSocket adapter), the Yjs binding, `DocumentEditor`, `memory-host.ts`, document import/export, design-system core. Phase 4's ground |

## Seams for a non-Electron source

- `MawsBridge` (`src/shared/ipc/schema.ts:235-239`; `createClient(() =>
  MawsBridge)`): setting `window.maws` to a web bridge before the first
  call makes the renderer work, outputs still zod-validated; ~311 commands,
  71 events. Happy-dom tests already do it (`rs/App.test.tsx:145`).
- `client: MawsBridge = ipc` default parameters (composer, `attachQueue`,
  `attachCatalog`, `create*Store(client)`, `connectShell`).
- **`TranscriptSource` + `attachSource` + `replaySource`** — the cleanest
  seam; `rs/harness/player.ts` wraps one. The `MAWS_HARNESS` `#transcript`
  page (driving the real `Transcript` from a `replaySource` over normalized
  fixtures, `rs/transcript/dev/journal.ts`) is the closest template for
  desk-web's transcript.
- `TranscriptActions` and registries (`NO_ACTIONS`,
  `registerTranscriptActions`, `registerRequestRenderer`).
- `AgentWorkClient`/`setAgentWorkClient`, `setChildSourceFor`; `DraftPort`
  and `onSubmit`; `ArtifactHost`; `registerSlot`/`useSlot`.
- `scripts/dev-stub.js` does **not** run the renderer without Electron (it
  runs `electron-vite dev` with a stub session source in main). The only
  Electron-free runs today are the vitest renderer projects under
  happy-dom with a fake `window.maws`.

## Ranked

**Import as is:** `src/artifacts/`; `transcript/model/*`, `source/hydrate`,
`replay`, `types`, `stores/transcript`; `src/shared/` (minus `host/*`,
`ipc/wire-fingerprint.ts`); `engine-host/fs/backfill.ts` and
`normalizer.ts` (not lint-guarded); `attention/derive`, `glyph`,
`GlyphMark`, `stores/attention`; `tools/agents/model/*`, `copy`;
`ReviewView`, `review-model`, `view-state`; the request card's leaves
(`variants/Permission`, `Question`, `controls`, `answers`, `scope`,
`question-steps`, `quick-approval`, `preview/*`); the composer editor's
leaves; `styles/tokens.css`, `app.css`, `transcript.css`; `owner-marks.ts`,
`owner/report/project.ts`, `shared/owner/to-human-parser.ts`.

**Behind a thin adapter:** the transcript view (cut `DEFAULT_ACTIONS` and
the ~10 edges; mount with a DX4 `TranscriptSource` and own
`TranscriptActions`); Markdown and the to-human Presenter; the composer's
`Editor`; the subagents UI via `setAgentWorkClient`/`setChildSourceFor`
(stamp `seq` and launch-style ids); `attention/anchor`, `stores/layout`.

**Copy and adapt:** `transcript/source/ipc.ts` → the DX4 source (reverse
the snapshot, `recordToEvents`, chunks → deltas with the real message id,
`onReset` on a gap in `n`); `transcript/shell.tsx`, `TranscriptSlot.tsx`,
`app/slots.ts` (DX8); `RequestCard.tsx`, `inline.tsx`, `index.ts` (DX6
RPCs with nonce and digest; keep the variants); the `Composer.tsx` frame
(three verbs plus model, effort, compact); `ReviewShell`, `review-store`,
`ReviewTool`, `ReviewSummary`, `DiffTab` (one diff against base); attention
item derivation (from `raised`, `settled`, presence).

**Do not bring:** `ipc/client.ts`, `ipc/events.ts`, `ipc/query.ts`;
`attention/navigation.ts`; `engine-surface/`; the question sheet;
`harness/*`, `test-support/*` (but `harness/player.ts` and
`harness/agents/fakeClient.ts` are good templates); dictation, resume
launcher, bash and memory modes, `PluginSites`, `panel/host.ts`,
`tools/browser`, `terminal`.
