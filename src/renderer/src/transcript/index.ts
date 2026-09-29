// The transcript's public surface (C6 execution document, Public surface): what C5, C7 and C8 import. Nothing else
// under `transcript/` is a contract. Frozen at the end of C6's M5; a change here is a dated Decision Log entry.

// Sources: a session or a child agent over X2 (memoised per key; a child source owns its provenance), a replay of
// fixed events (the harness and tests), and the rewind interface over `session.rewindFiles` for the receipt's Undo.
export type { Player, TranscriptSource } from './source/types';
export { ipcRewind, ipcSource } from './source/ipc';
export { replaySource } from './source/replay';

// The component, its props and the callbacks its caller supplies.
export type { RewindInterface, TranscriptActions } from './view/context';
export { Transcript, type TranscriptProps } from './view/Transcript';

// The shell's transcript: the actions each child registers from its own block, merged over the defaults, and the slot
// component that mounts one Transcript over the session's IPC source with them (registered into C5's slot at rebase).
export { DEFAULT_ACTIONS } from './view/context';
export { registerRequestRenderer, registerTranscriptActions } from './view/registry';
export { TranscriptSlot } from './view/TranscriptSlot';

// The store: rows, summaries and jumpTo(rowId) for C5's Overview line and C8's drill-in.
export { useTranscriptStore } from '../stores/transcript';

// The presentation model (X3) as pure functions.
export { classifyTool } from './model/classify';
export { applyEvents } from './model/reduce';
export { rowsOf, turnSummary } from './model/derive';
export { dividerCopy } from './model/copy';
export { serializeRows } from './model/serialize';

// C7: the request card and queued rows render markdown through the same sanitising pipeline (one renderer).
export { Markdown } from './view/markdown/Markdown';

// C8: what each turn did whatever the reader disclosed (also `useTranscriptStore.activity(key)`), and the subagent
// glyphs as the rows show them.
export { turnActivity, type TurnActivity } from './model/activity';
export { glyphFor, SUBAGENT_GLYPHS } from './model/glyphs';
export { SubagentGlyph } from './view/rows/Subagent';

export type { Cell, CellDetail, CellId, Row, RowId, SubagentRef, ToolCategory, ToolClassification, TurnId, TurnSummary } from './model/rows';
