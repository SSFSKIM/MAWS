// The public surface is frozen at the end of M5 (C6 execution document, Public surface): what C5, C7 and C8 import,
// and nothing else. A change here is a dated Decision Log entry.
import { describe, expect, it } from 'vitest';
import * as surface from './index';
import type { TranscriptState } from './index';

describe('public surface', () => {
  it('exports exactly the frozen runtime names', () => {
    expect(Object.keys(surface).sort()).toEqual(
      ['DEFAULT_ACTIONS', 'Markdown', 'registerBubbleEditor' /* W3 */, 'registerRequestRenderer', 'SUBAGENT_GLYPHS', 'SubagentGlyph', 'Transcript', 'TranscriptSlot', 'registerTranscriptActions', 'registeredActions', 'useRegisteredActions', 'applyEvents', 'createState', 'classifyTool', 'dividerCopy', 'glyphFor', 'ipcRewind', 'ipcSource', 'replaySource', 'rowsOf', 'serializeRows', 'turnActivity', 'turnSummary', 'useTranscriptStore'].sort(),
    );
  });

  it('lets a consumer build and apply to a state of its own (createState and the TranscriptState type)', () => {
    const state: TranscriptState = surface.createState(null, null);
    expect(surface.rowsOf(surface.applyEvents(state, []))).toEqual([]);
  });
});
