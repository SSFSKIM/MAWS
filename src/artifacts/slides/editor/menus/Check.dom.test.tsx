// The Check panel (P3-C M6's "Check against the design system") as the word cut leaves it (docs/doperpowers/specs/
// 2026-11-16-word-cut-design.md, M5 task 3): its title reads Check (G471), its summary counts issues and rules (G472),
// an issue row is its message and its rule's words (G473), the manual sections read in a person's words (G475), its
// wait is the quiet spinner (G476), and a system it cannot read or that has nothing to check settles in words.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignSystemHostContext } from '../../../design-system/apply';
import { writeSystem } from '../../../design-system/model';
import type { ArtifactHost, DocumentHandle } from '../../../host';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { CheckPanel } from './Check';

const PLANTED = `<section id="planted" style="background:var(--ds-color-bg); padding:128px"><div id="card" style="display:flex; flex-direction:column"><p id="loud" style="font-size:var(--ds-type-body-size); color:#ff0044">Red alert</p></div></section>`;
const CLEAN = `<section id="clean" style="background:var(--ds-color-bg); padding:128px"><h1 id="title" style="font-family:var(--ds-font-display); font-size:var(--ds-type-h1-size); color:var(--ds-color-text)">Air has mass</h1></section>`;

function deckOf(html: string): Doc {
  const doc = newDoc();
  transact(doc, () => {
    const loaded = loadSlide(html);
    if (!loaded.ok) throw new Error(loaded.held.reasons.join('; '));
    writeDeckKeys(doc, { v: 4, title: 'T', order: [loaded.slide.id] });
    importSlide(doc, loaded.slide, 'a0');
  });
  return doc;
}
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

afterEach(cleanup);

describe('the Check panel', () => {
  it('is titled Check; a deck that keeps every rule reads No issues with the count of rules', async () => {
    render(<CheckPanel session={new DeckSession(deckOf(CLEAN))} system={{ builtin: 'maws' }} />);
    await settle();
    const panel = screen.getByRole('complementary', { name: 'Check design' });
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Check');
    expect(within(panel).getByRole('status').textContent).toMatch(/^No issues · \d+ rules?$/);
  });

  it('counts the issues; each row is its message and its rule’s words, its name still naming the element', async () => {
    render(<CheckPanel session={new DeckSession(deckOf(PLANTED))} system={{ builtin: 'maws' }} />);
    await settle();
    const panel = screen.getByRole('complementary', { name: 'Check design' });
    expect(within(panel).getByRole('status').textContent).toMatch(/^\d+ issues?$/);
    const row = panel.querySelector<HTMLButtonElement>('[data-violation]')!;
    expect(row.getAttribute('aria-label')).toMatch(/^Select section#planted > /);
    expect(row.textContent).not.toMatch(/\[check:/);
    expect(row.querySelector('.deck-check-where')).toBeNull();
    expect(panel.textContent).not.toMatch(/To judge by hand|Tags MAWS cannot run/);
    const headings = within(panel).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.filter((h) => /^(By hand|Unknown checks)$/.test(h ?? '') || /^Slide \d+$/.test(h ?? ''))).toEqual(headings);
  });

  it('a system it cannot read settles in words, with no spinner left standing; none at all is nothing to check', async () => {
    render(<CheckPanel session={new DeckSession(deckOf(CLEAN))} system={{ id: 'gone' }} />);
    await settle();
    expect(screen.getByRole('complementary', { name: 'Check design' }).textContent).toContain('Couldn’t read the design system');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(screen.queryByRole('progressbar')).toBeNull();
    cleanup();
    render(<CheckPanel session={new DeckSession(deckOf(CLEAN))} system={null} />);
    expect(screen.getByRole('complementary', { name: 'Check design' }).textContent).toContain('Nothing to check');
  });

  // the whole-branch review's fix wave: a deck whose placement is not read yet has no system to check with, which is not
  // "no system": the panel waits with the quiet spinner, and a read that failed settles in words, never a false empty
  it('waits while the deck’s placement is read and settles in words when that read fails; neither reads Nothing to check', async () => {
    render(<CheckPanel session={new DeckSession(deckOf(CLEAN))} system={null} systemUnread="reading" />);
    const panel = () => screen.getByRole('complementary', { name: 'Check design' });
    expect(panel().textContent).not.toContain('Nothing to check');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(screen.getByRole('progressbar', { name: 'Checking…' })).toBeTruthy();
    cleanup();
    render(<CheckPanel session={new DeckSession(deckOf(CLEAN))} system={null} systemUnread={{ failed: 'the library could not be read' }} />);
    expect(panel().textContent).toContain('Couldn’t read the design system');
    expect(panel().textContent).not.toContain('Nothing to check');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // the whole-branch review's fix wave (G472): a law whose don'ts no check runs (untagged, or tagged with checks MAWS does
  // not have) has nothing to check, so it says so, never "No issues · 0 rules"; its don'ts are still listed to judge
  it('a law with no check to run reads Nothing to check, its don’ts still listed', async () => {
    const house = defaultSystem(HOUSE_KEY)!.files;
    const law = house['DESIGN.md']!;
    for (const [name, donts] of [['Untagged', law.replace(/ \[check: [^\]]+\]/g, '')], ['Unknown', law.replace(/\[check: [^\]]+\]/g, '[check: wobble]')]] as const) {
      const doc = newDoc();
      writeSystem(doc, { ...house, 'DESIGN.md': donts }, { route: 'derived', at: Date.UTC(2026, 10, 24) }, { name });
      const handle = { doc, state: () => ({ phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false }), subscribe: () => () => {}, close: () => {} } as unknown as DocumentHandle;
      const host = { open: async () => handle, assetUrl: () => null } as unknown as ArtifactHost;
      render(
        <DesignSystemHostContext.Provider value={host}>
          <CheckPanel session={new DeckSession(deckOf(PLANTED))} system={{ id: name }} />
        </DesignSystemHostContext.Provider>,
      );
      await settle();
      const panel = screen.getByRole('complementary', { name: 'Check design' });
      expect(within(panel).getByRole('status').textContent, name).toBe('Nothing to check');
      expect(panel.querySelector('[data-violation]'), name).toBeNull();
      expect(within(panel).getAllByRole('heading', { level: 3 }).length, name).toBeGreaterThan(0); // By hand, or Unknown checks
      cleanup();
    }
  });
});
