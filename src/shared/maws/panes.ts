// The panes `show_pane` can name (X9; E1 execution document, Interfaces "X9", residue 10) and where each one opens: a
// panel tool by its X5 id, or the `file` pane as a main tab. Siblings supply the tools behind `tasks` (E7),
// `deliverable` (E2), `browser` (E4) and `source-control` (E6); until a build registers one, the renderer answers the
// bridge with `paneUnavailableText`, so the model reads that the pane is absent, never a crash.
import * as z from 'zod';

export const PANE_NAMES = ['diff', 'file', 'terminal', 'tasks', 'deliverable', 'browser', 'source-control'] as const;
export const PaneSchema = z.enum(PANE_NAMES);
export type Pane = z.infer<typeof PaneSchema>;

export const PANES: Record<Pane, { toolId: string } | { mainTab: 'file' }> = {
  diff: { toolId: 'review' },
  file: { mainTab: 'file' },
  terminal: { toolId: 'terminal' },
  tasks: { toolId: 'tasks' },
  deliverable: { toolId: 'deliverables' },
  browser: { toolId: 'browser' },
  'source-control': { toolId: 'source-control' },
};

// The Question sheet's X5 tool id (M4 registers it).
export const ASK_SHEET_TOOL_ID = 'ask-sheet';

// How long the host waits for a window to answer a `show_pane` before the call answers an error (residue 3).
export const PANE_ANSWER_MS = 8_000;

// E2 (Design §7): how long the host waits for main to answer an `artifact_screenshot` capture before the call answers
// an error; main's own guard (20 s, two captures at once) keeps its answer inside it.
export const CAPTURE_ANSWER_MS = 45_000;
