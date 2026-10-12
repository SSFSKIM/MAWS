# P3 document store on Yjs: research findings

2026-10-12. Input to the P3 co-work layer (`docs/charter.md`, the P2-cut paragraph). Under test: the architect's candidate. Every artifact is a Y.Doc: a document is a Y.XmlFragment bound through y-prosemirror, a slide deck a Y.XmlFragment of constrained HTML. Agent tools write transactions whose origin names the session. History uses snapshots with Y.PermanentUserData (PUD) and gc off.

Method: web research and seven Node spikes in `/tmp/p3-yjs-spike` (outside the repo) on yjs 13.6.33, y-prosemirror 1.3.7, @tiptap/y-tiptap 3.0.9 and Tiptap 3.31.3, with happy-dom for the editor. **Verified** means a spike ran it; **source** means code read, not run.

## 0. What is installed, what is free

- `node_modules` has @tiptap/* 3.31.3 and @tiptap/pm. It has no yjs, y-prosemirror, y-protocols, lib0 or prosemirror-markdown.
- Tiptap 3's Collaboration extension binds through **`@tiptap/y-tiptap`**, Tiptap's fork of y-prosemirror 1.x on yjs ^13. Import plugin keys from it: a `ySyncPluginKey` taken from y-prosemirror is a different key, and its metas are silently ignored.
- **MIT:** Collaboration, CollaborationCaret, **UniqueID** (MIT in 3.x) and **@tiptap/markdown**.
- **Paid:** Snapshot, Snapshot Compare and Comments. All three need Tiptap's document server and `TiptapCollabProvider`, and on-premises is Enterprise only ([snapshot](https://tiptap.dev/docs/collaboration/documents/snapshot), [compare](https://tiptap.dev/docs/collaboration/documents/snapshot-compare), [comments](https://tiptap.dev/docs/comments/getting-started/install), [pricing](https://tiptap.dev/pricing)). None fits a local-first app.
- The open route is y-prosemirror's own snapshot rendering.

## 1. Version history

**Snapshot rendering works through Tiptap 3's Collaboration extension today; the raw ySyncPlugin is not needed.**
- [tiptap#3583](https://github.com/ueberdosis/tiptap/issues/3583) was the missing `permanentUserData`. It was fixed by the `ySyncOptions` option in 2.5.0 and closed 2026-08-28.

Spike 2 (verified):
- Setup: `Collaboration.configure({ document, ySyncOptions: { permanentUserData, colors } })`, plus a `ychange` mark and block attribute.
- The diff rendered the agent's deletion and insertion as `agent:session-A` marks, and the view was read-only.
- `{ restore: true }` wrote the old version forward as a new change, and it synced to the other replica.

Pitfalls (1 to 4 verified):
1. **No `ychange` mark deletes live text.**
   - When the binding cannot build a node, its catch block deletes the Y.XmlText or element in the live doc, and the deletion syncs to every peer.
   - Schema parity between every writer and editor is therefore a hard invariant. This matches [tiptap#2774](https://github.com/ueberdosis/tiptap/issues/2774).
2. **Leaving history by dispatching `{snapshot: null, prevSnapshot: null}` corrupts the document.** It wrote the diff view into the doc: the live text became "Hello worldthere". Exit only through `binding.unrenderSnapshot()`.
3. **The transaction origin is never persisted, so it attributes nothing.**
   - PUD maps a **clientID** to a user, and it records only *local* deletions, asynchronously, in a separate transaction ([source](https://github.com/yjs/yjs/blob/v13/src/utils/PermanentUserData.js)).
   - Agents writing straight into the host doc all share the host's clientID.
   - Concurrent `setUserMapping` for a new user overwrites ([yjs#250](https://github.com/yjs/yjs/issues/250)). Never set clientIDs yourself ([yjs#508](https://github.com/yjs/yjs/issues/508)).
4. **Ad-hoc update forwarding leaves updates pending.** When my harness missed one replica update, the next update's deletion applied but its insertion stayed silently held. Sync must use y-protocols step 1 and step 2.
5. **Undo (source).**
   - [y-prosemirror#91](https://github.com/yjs/y-prosemirror/issues/91), merged in 2022, made sync transactions `addToHistory: false`: use Yjs's UndoManager.
   - It tracks only the local binding, so the human's ⌘Z never undoes the agent.
   - The Collaboration `undo` command ignores snapshot state, so block ⌘Z in the history view.
6. **Restore credits the restorer.** Restored text gets new IDs.
7. **The 1.x snapshot path is frozen.**
   - Five bugs were closed "not planned" on 2026-03-19: [#72](https://github.com/yjs/y-prosemirror/issues/72), [#82](https://github.com/yjs/y-prosemirror/issues/82), [#128](https://github.com/yjs/y-prosemirror/issues/128), [#177](https://github.com/yjs/y-prosemirror/issues/177) and [#189](https://github.com/yjs/y-prosemirror/issues/189).
   - Most visible to users: attribute changes are not shown in diffs, and code blocks have problems.

**Storage (spike 3, verified).** The simulated history is keystroke typing with 4 % backspaces, agent paragraph rewrites, then word edits. Sizes are V2 state:

| History | Visible chars | gc on | gc off | gc off, gzip | Snapshot, each |
|---|---|---|---|---|---|
| 9k transactions | 3k | 17.8 KB | 27.2 KB | 11.3 KB | 0.15–0.8 KB |
| 40k transactions | 12k | 121 KB | 171 KB | 59 KB | 0.15–4.4 KB |

- gc off costs about 1.4×; most of the size is fragmentation metadata. Snapshots grow with the delete set ([INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md)). Loads took under 100 ms.

**Two ways to store versions:**
- **(a) Demo pattern: gc off with `Y.Snapshot` values.** Each version costs bytes, but history can never be pruned. Any loader that forgets `gc:false` discards deleted content, and then `createDocFromSnapshot` throws (verified).
- **(b) Each version a full V2 state, rendered in y-prosemirror's Uint8Array mode** ([dd6e4960](https://github.com/yjs/y-prosemirror/commit/dd6e4960)).
  - It renders inside a throwaway gc-off doc, so the live doc keeps gc on. Verified, with correct per-author marks.
  - Each version costs a full state, but versions can be thinned the way Google Docs thins old revisions.
  - This is the shape of v14's `DiffRenderer(prevDoc, nextDoc)`.

**Yjs v14.**
- `@y/y` 14.0.0-rc.28 (2026-09-29) and `@y/prosemirror` 2.0.0-15 (2026-10-11) are pre-releases. The binding's README says most users should stay on v13 ([README](https://github.com/yjs/y-prosemirror)).
- I confirmed in the installed packages that v14 exports `DiffRenderer`, `AttributionsRenderer`, `SnapshotRenderer` and IdSet/IdMap. It adds suggestion mode and drops PUD.
- **Attribution becomes an IdMap built per update by whoever receives the update, independent of clientID** ([y-simple-attribution-server](https://github.com/yjs/y-simple-attribution-server)).
- Tiptap's Collaboration cannot use v14; Yjs's Tiptap demo avoids it ([extensions.js](https://github.com/yjs/y-prosemirror/blob/master/yhub-tiptap-demo/src/extensions.js)), and Tiptap's [2026 roadmap](https://tiptap.dev/blog/release-notes/our-roadmap-for-2026) does not mention it.
- **Migration is one-way:** v14 reads v13, but the 1.x binding cannot read what v2 writes ([CAVEATS.md](https://github.com/yjs/y-prosemirror/blob/master/CAVEATS.md)).

## 2. Hosting the Y.Doc across processes

**Where: the engine host.**
- The MCP tool server runs there (`src/engine-host/tool-server/`).
- It already serves sessions that have no renderer (X13).
- In E10 detached mode it outlives the app, so an agent can keep editing with every window closed.

**Transport.**
- No Electron or MessagePort Yjs provider exists on npm, so build a thin one. Templates: y-websocket's BroadcastChannel path (step 1, step 2 and awareness on connect, echoes skipped by origin) and y-websocket-server's `WSSharedDoc` (a `conns` map, `removeAwarenessStates` on close) ([y-websocket](https://github.com/yjs/y-websocket/blob/master/src/y-websocket.js), [server utils](https://github.com/yjs/y-websocket-server/blob/main/src/utils.js), [PROTOCOL.md](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)).
- Use one `MessageChannelMain` per open document, one end to the utility process and one to the renderer by `webContents.postMessage` ([message ports](https://www.electronjs.org/docs/latest/tutorial/message-ports)). It carries raw y-protocols frames: type `0` for sync, `1` for awareness.
- Send exact-size `Uint8Array`s (structured clone ships a view's whole buffer), and treat renderer bytes as untrusted ([yjs#479](https://github.com/yjs/yjs/issues/479)).
- The detached transport is JSON lines over a Unix socket (`src/main/hosts/detached-transport.ts`). It needs a binary, length-prefixed channel for documents.

**Spike 7 (verified):** a host doc and two clients over `worker_threads` ports converged, with awareness crossing. A client that had missed updates healed through step 1 and step 2. Every update went into a `node:sqlite` log tagged with its port's author, and replaying the log reproduced the host state.

**Persistence.**
- **Follow AFFiNE desktop's layout** ([doc.rs](https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/nbstore/src/doc.rs)): an `updates` table and a `snapshots` table. Compaction swaps in a new snapshot and deletes the merged rows in one SQL transaction, guarded by a compare-and-swap.
- **Write path:** append each update before acknowledging or broadcasting it, under WAL with `synchronous=FULL` (NORMAL can lose recent commits, [WAL](https://www.sqlite.org/wal.html)).
- **Store the author on each row.** Compaction erases update boundaries, so first fold authorship into a durable clientID→author table plus per-author delete sets.
- **`Y.mergeUpdates` never garbage-collects.** To shed tombstones with gc on, re-encode through a Y.Doc ([forum](https://discuss.yjs.dev/t/throttling-yjs-updates-with-garbage-collection/1423)).
- `node:sqlite` is a release candidate in Node 24, but main already ships it (`src/main/browser/import/staging.ts`).

**P4.**
- The same handler goes behind a WebSocket: Hocuspocus, `@y/websocket-server` or y-partyserver.
- Hocuspocus's `openDirectConnection` fits server-side agent edits ([examples](https://tiptap.dev/docs/hocuspocus/server/examples)).
- Connection auth then names the author, so per-update authorship carries over.
- AFFiNE's `DocStorage` interface has local and cloud backends ([doc.ts](https://github.com/toeverything/AFFiNE/blob/canary/packages/common/nbstore/src/storage/doc.ts)).

## 3. Agent-side editing from Node

**No DOM needed (spike 1, verified).** These ran with `typeof window === 'undefined'`: `getSchema(extensions)`, `@tiptap/markdown`'s `MarkdownManager`, `generateUniqueIds`, and y-tiptap's `prosemirrorToYXmlFragment` and `yXmlFragmentToProseMirrorRootNode`.
- A sample with a heading, marks, a link, both list kinds, a quote, fenced code and a rule round-tripped markdown→PM→Y→PM→markdown **byte-identical**.
- prosemirror-markdown also works, given a token map. @tiptap/markdown is better: each extension declares its own markdown, so there is one schema source. Without a DOM it keeps inline HTML as literal text.

**Block replace by id: both obvious ways have traps.**
- **Delete the element and insert a new one** (126 bytes). The whole block becomes new, so it shows as the agent's rewrite and every anchor inside it dies.
- **Rebuild the PM doc and call y-prosemirror's exported `updateYFragment`** (37 bytes for an appended sentence). Two traps, both verified:
  - (i) The text diff is one prefix/suffix region. Edits near both ends re-insert everything between them, over-attributing and collapsing anchors (spike 5).
  - (ii) Formatting is re-applied from the new node, so marks absent from the agent's markdown, comments included, are stripped from unchanged text (spike 6).

**Recommendation: a host-side patch writer.**
- Locate the block by id.
- For the same block type, apply a multi-hunk word diff (`fast-diff`) as Y.XmlText operations with explicit attributes. In spike 5 this kept the anchor that `updateYFragment` destroyed.
- For structural changes, use `updateYFragment` per child.
- Write from the agent's own replica.
- Validate with **the renderer's exact extension list**: one schema module, importable in Node, with no React node views.

## 4. Stable block ids

- Tiptap's UniqueID (MIT) does the following (source):
  - It strips ids on paste and on drops from other editors.
  - It regenerates duplicates on new nodes.
  - It keeps a split block's id on the half that has content.
  - It fills missing and duplicate ids after the first Yjs sync. **From then on it skips every y-sync transaction.**
  - It ships `generateUniqueIds(json, extensions)` for server use.
- So **the writer must id every block it writes**, and **the host repairs after each applied update** (missing ids, duplicates from concurrent splits).
- A short `generateID` (an 8-character nanoid) keeps ids cheap in agent tokens.

## 5. Comments with persistent pins

**Relative positions collapse (spike 5, verified).**
- A `createRelativePositionFromTypeIndex` anchor survived typing before it and inside it.
- It collapsed to empty in three cases:
  - **Enter earlier in the same paragraph:** a split re-creates the tail with new ids.
  - **An agent rewrite through `updateYFragment`.**
  - **Deleting the anchored text.**
- Upstream confirms the split case. [y-prosemirror#44](https://github.com/yjs/y-prosemirror/issues/44) was closed "not planned" with the advice to re-render. I found no shipped product that uses relative positions as durable thread anchors.

**Prior art uses marks:**
- [BlockNote](https://github.com/TypeCellOS/BlockNote/blob/main/packages/core/src/comments/mark.ts) (MPL-2.0): a `comment` mark with `threadId` and `orphan` attributes, `excludes:""` so comments can overlap, and `inclusive:false`. Threads live in `yDoc.getMap("threads")`.
- Tiptap's paid Comments: an `inlineThread` mark.
- [Outline](https://github.com/outline/outline/blob/main/shared/editor/marks/Comment.ts): a mark, with a paste plugin that drops duplicate ids, so cut moves a comment and copy does not duplicate it.

**An open implementation:** BlockNote's mark and threads map inside the artifact's Y.Doc (threads sync and version with the text), Outline's paste dedupe, a stored quote plus relative-position pair per thread for showing orphans, and the patch writer preserving marks.

## 6. Slides as constrained HTML

**Spike 4 (verified).**
- Parsing the dialect (parse5 in Node, `DOMParser` in the renderer) into Y.XmlElement with `style` exploded into per-property attributes (`css:left`) works.
- A canonical serialiser (sorted attributes, sorted style, escaping) gives a **byte-identical** round trip, and messy input reaches a fixed point after one pass.
- `Y.XmlElement.toString()` is unusable: it does no escaping and prints `[object Object]`. Attributes accept any JSON in v13.6.33, despite the docs.
- Concurrent edits to different properties merge.
- **A concurrent re-order done as delete plus insert duplicated an element** (`e3,e1,e3,e2`). v13 has no move operation.

**Recommendation: bind the canvas to a Y.Map element model.**
- Elements live in an id-keyed Y.Map, with one key per property and a fractional-index string for order. This is BlockSuite edgeless's model ([data structure](https://blocksuite.io/components/editors/edgeless-data-structure.html)), and tldraw's indices.
- Each text box is a nested Y.XmlFragment bound to Tiptap.
- The HTML dialect stays the agent's input, its output and the export format, through the canonical parser and serialiser and a diff-apply that writes only changed properties.

Reasons: canvas operations are property sets and re-orders on ids, which XML child order cannot carry, and y-prosemirror's diff rendering does not apply to a canvas anyway. Per-property keys matter too: y-excalidraw syncs whole items, and concurrent edits to one element's properties do not merge ([repo](https://github.com/RahulBadenkal/y-excalidraw)).

## 7. Recommendation

Keep from the candidate: a Y.Doc per artifact, Tiptap Collaboration over Y.XmlFragment for documents, and agent edits as Yjs transactions. Change:

1. **Attribution comes from a per-update author log in the host, not from the transaction origin.**
   - On v13, each writing agent session edits through its own replica Y.Doc, synced in-process by y-protocols.
   - The renderer gets a PUD-shaped adapter built from the log (`getUserByClientId`, `getUserByDeletedId`, `dss`), avoiding PUD's races.
   - The same log feeds v14's IdMap.
2. **History: gc on, versions as V2 states in SQLite.**
   - Named versions, plus automatic ones at each agent turn's end and at human idle, thinned with age.
   - Render in Uint8Array mode, exit through `unrenderSnapshot()`, and restore through the `restore` meta.
   - Keep `ychange` in the schema, and block undo while history is shown.
3. **Agent writes go through the patch writer**, with host-assigned ids and schema validation.
4. **Comments:** a mark plus a threads map.
5. **Slides:** a Y.Map element model, with HTML as the interface format.
6. **v13 with y-tiptap by default**: it is stable, Tiptap supports it, and the spikes verified it. Decide at S1, **before any persistent document exists**, because migration is one-way. v14's suggestion mode is the natural shape for an agent proposing edits, so choose v14 if S1 passes.

## 8. Spikes before committing

| # | Spike | Proves |
|---|---|---|
| S1 | `@y/y` rc + `@y/prosemirror` 2 inside a Tiptap 3.31 editor through a custom extension: UniqueID, `DiffRenderer` over two stored states with log-built attributions, suggestion mode for an agent edit, a Node writer | Whether P3 starts on v14, while switching is free |
| S2 | Real Electron: a doc service in the engine host, a `MessageChannelMain` port to the renderer, the detached relay; a 1 MB first sync, keystroke latency, the host killed mid-typing | The topology, and that nothing acknowledged is lost |
| S3 | History in the real editor: V2-state versions with gc on, the PUD adapter, unrender, restore, undo blocked; headings, tables, code blocks, attribute changes (#177, #189) | Google-Docs-style history on the frozen 1.x path, or its gaps |
| S4 | The patch writer against a human typing in the same block, including **Korean IME composition** while remote updates arrive | Element-level attribution, mark preservation, safe concurrent edits |
| S5 | Comment marks through split, join, cut, copy, agent rewrite, undo and restore; orphan display | Pins persist through every ordinary edit |
| S6 | The Y.Map slide model with a minimal canvas, the HTML round trip, agent diff-apply, concurrent move, z-order and slide re-order | The slide model before an editor is built on it |
| S7 | A storage soak: a 10k-word doc, months of simulated edits, compaction, version thinning, load time | Bounded growth under the chosen policy |
