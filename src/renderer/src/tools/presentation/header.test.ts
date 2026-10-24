// The deck's X32 header (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D8 "Shell", D10, D13): the
// actions it offers, each reading and driving the tab's own state.
import { describe, expect, it } from 'vitest';
import { deckHeader, type DeckHeaderState } from './header';

const live = { phase: 'live', synced: true, unsaved: 0, readOnly: false } as unknown as DeckHeaderState['document'];
const state = (patch: Partial<DeckHeaderState> = {}): DeckHeaderState => ({ title: 'Deck', document: live, saving: false, closeGuard: async () => true, rail: null, canPresent: true, ...patch });

describe('the deck header’s actions (M6)', () => {
  it('offers Present, Theme and Check against the design system, in that order', () => {
    const calls: string[] = [];
    const header = deckHeader(state(), { present: () => calls.push('present'), toggleRail: (rail) => calls.push(rail) });
    expect(header.actions?.map((a) => [a.id, a.label])).toEqual([
      ['present', 'Present'],
      ['theme', 'Theme'],
      ['check', 'Check against the design system'],
    ]);
    for (const action of header.actions ?? []) action.onSelect();
    expect(calls).toEqual(['present', 'theme', 'check']);
  });

  it('shows the open panel pressed and Present disabled with no slide to show', () => {
    const header = deckHeader(state({ rail: 'check', canPresent: false }), { present: () => {}, toggleRail: () => {} });
    const by = Object.fromEntries((header.actions ?? []).map((a) => [a.id, a]));
    expect([by.present?.disabled, by.theme?.pressed, by.check?.pressed]).toEqual([true, false, true]);
  });

  it('offers no actions before the deck has opened', () => {
    expect(deckHeader(state()).actions).toBeUndefined();
  });

  it.each(['comments', 'history'] as const)('keeps the %s card toggle in the document toolbar, with only a comment-count badge in the title header', (rail) => {
    const calls: string[] = [];
    const header = deckHeader(state({ rail, history: true, unresolved: 3 }), { present: () => calls.push('present'), toggleRail: (value) => calls.push(value) });
    for (const action of header.actions ?? []) action.onSelect();
    expect(calls).toEqual(['present', 'theme', 'check']);
    expect(header.unresolved).toBe(3);
    expect(deckHeader(state({ unresolved: 0 })).unresolved).toBeUndefined();
  });
});
