// The transcript's public surface (C6 execution document, Public surface): what C5, C7 and C8 import. Nothing else
// under `transcript/` is a contract. Frozen at the end of C6's M5; a change here is a dated Decision Log entry.

// Sources: a session or a child agent over X2 (memoised per key; a child source owns its provenance), a replay of
// fixed events (the harness and tests), and the rewind interface over `session.rewindFiles` for the receipt's Undo.
export type { Player, TranscriptSource } from './source/types';
export { ipcRewind, ipcSource } from './source/ipc';
export { replaySource } from './source/replay';

// The component, its props and the callbacks its caller supplies. The heavy components (this one, TranscriptSlot and
// Markdown) load as a chunk of their own the first time one renders (lazy.tsx), so the app's entry carries none of them.
export type { RewindInterface, TranscriptActions } from './view/context';
export { Transcript } from './lazy';
export type { TranscriptProps } from './view/Transcript';

// The shell's transcript: the actions each child registers from its own block, merged over the defaults, and the slot
// component that mounts one Transcript over the session's IPC source with them (registered into C5's slot at rebase).
export { DEFAULT_ACTIONS } from './view/context';
export { registerBubbleEditor, registerRequestRenderer, registerTranscriptActions, type BubbleEditor } from './view/registry'; // W3: registerBubbleEditor
// The merged registry read (the one TranscriptSlot uses), so a Transcript mounted elsewhere (C8b's drill-in, C5's agent
// tab) passes `actions={useRegisteredActions()}` and gets every child's registered callbacks.
export { registeredActions, useRegisteredActions } from './view/registry';
export { TranscriptSlot } from './lazy';

// The store: rows, summaries and jumpTo(rowId) for C5's Overview line and C8's drill-in.
export { useTranscriptStore } from '../stores/transcript';

// The presentation model (X3) as pure functions.
export { classifyTool } from './model/classify';
// A consumer that applies events builds its own state with `createState` (never the store's: states form one
// lineage, and applying to the store's state would make its next batch throw).
export { applyEvents, createState, type TranscriptState } from './model/reduce';
export { rowsOf, turnSummary } from './model/derive';
export { dividerCopy, PLUGIN } from './model/copy'; // R1: PLUGIN, a plugin's words (the toast host's and the summary's)
export { pluginLines, type PluginLine } from './model/plugins'; // R1: the panel summary's Plugins block
export { serializeRows } from './model/serialize';

// C7: the request card and queued rows render markdown through the same sanitising pipeline (one renderer).
export { Markdown } from './lazy';

// C8: what each turn did whatever the reader disclosed (also `useTranscriptStore.activity(key)`), and the subagent
// glyphs as the rows show them.
export { turnActivity, type TurnActivity } from './model/activity';
export { glyphFor, SUBAGENT_GLYPHS } from './model/glyphs';
export { SubagentGlyph } from './view/rows/Subagent';

export type { Cell, CellDetail, CellId, Row, RowId, SubagentRef, ToolCategory, ToolClassification, TurnId, TurnSummary } from './model/rows';
export type { AskRowData } from './model/rows'; // E1: what a capsule hands the Question sheet (openAsk)
