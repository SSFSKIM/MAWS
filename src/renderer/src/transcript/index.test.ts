// The public surface is frozen at the end of M5 (C6 execution document, Public surface): what C5, C7 and C8 import,
// and nothing else. A change here is a dated Decision Log entry.
import { describe, expect, it } from 'vitest';
import * as surface from './index';

describe('public surface', () => {
  it('exports exactly the frozen runtime names', () => {
    expect(Object.keys(surface).sort()).toEqual(
      ['DEFAULT_ACTIONS', 'Markdown', 'registerRequestRenderer', 'SUBAGENT_GLYPHS', 'SubagentGlyph', 'Transcript', 'TranscriptSlot', 'registerTranscriptActions', 'applyEvents', 'classifyTool', 'dividerCopy', 'glyphFor', 'ipcRewind', 'ipcSource', 'replaySource', 'rowsOf', 'serializeRows', 'turnActivity', 'turnSummary', 'useTranscriptStore'].sort(),
    );
  });
});
