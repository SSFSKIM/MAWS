// The Check panel (P3-C M6's "Check against the design system") as the word cut leaves it (docs/doperpowers/specs/
// 2026-11-16-word-cut-design.md, M5 task 3): its title reads Check (G471), its summary counts issues and rules (G472),
// an issue row is its message and its rule's words (G473), the manual sections read in a person's words (G475), its
// wait is the quiet spinner (G476), and a system it cannot read or that has nothing to check settles in words.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(headings.filter((h) => /^(Check by hand|Unknown checks)$/.test(h ?? '') || /^Slide \d+$/.test(h ?? ''))).toEqual(headings);
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
});
