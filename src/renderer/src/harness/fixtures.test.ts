// The harness's report fixture (`synthetic/<turns>/report`), which the e2e scenes of the to-human view load (UX wave
// U2b, M3): the lane on, each turn's final answer a message, so the turn's commentary folds into a stretch. Pinned here
// because the scenes that stand on it run only on a Mac: the fifth turn's first text, the commentary `reach(5)` jumps
// to, is inside a closed stretch, and every final answer stays in sight.
import { describe, expect, it } from 'vitest';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState, withUi } from '../transcript/model/reduce';
import type { Row } from '../transcript/model/rows';
import { liveMarkedRowIds, mirrorRows, stretchHolding } from '../owner/view/mirror';
import { loadFixture } from './fixtures';
import { textOfTurn } from './paged';

describe('synthetic/<turns>/report', () => {
  it('turns the lane on and makes each final answer a message, its commentary folded', async () => {
    const loaded = await loadFixture('synthetic/20/report');
    expect(loaded.ownerLane).toBe(true);
    expect((await loadFixture('synthetic/20')).ownerLane).toBeUndefined();
    const history = loaded.events.filter((event) => loaded.streamFrom === null || (event.seq ?? 0) < loaded.streamFrom);
    let state = applyEvents(createState(null, null), history);
    state = withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
    const rows = rowsOf(state);
    const live = liveMarkedRowIds(state);
    const drawn = mirrorRows(rows, {}, live);
    const texts = rows.filter((row): row is Extract<Row, { kind: 'assistant_text' }> => row.kind === 'assistant_text');
    const marked = texts.filter((row) => row.markdown.startsWith('<message>'));
    expect(marked.length).toBe(19); // the twentieth turn's answer streams after the history
    for (const row of marked) expect(drawn.some((shown) => shown.id === row.id)).toBe(true);
    const commentary = textOfTurn(loaded.events, 5);
    const target = texts.find((row) => row.messageUuid === commentary.messageUuid)!;
    expect(target.markdown).not.toContain('<message>');
    expect(stretchHolding(rows, target.id, live)).not.toBeNull();
    expect(drawn.some((shown) => shown.id === target.id)).toBe(false);
    expect(drawn.filter((shown) => shown.kind === 'record_fold').length).toBeGreaterThan(0);
  });
});
