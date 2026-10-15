// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10): the toolbar's Text style menu names the role the
// selected text is set in, and offers nothing while the selection is not text.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { applyTextStyle, TextStyleMenu } from './TextStyle';

function deck(): Doc {
  const doc = newDoc();
  const loaded = loadSlide(`<section id="s"><p id="p" style="font-size:40px">Words</p><div id="box" style="width:100px; height:100px; background:#eeeeee"></div></section>`, { fileId: 's' });
  if (!loaded.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, loaded.slide, 'a0');
  });
  return doc;
}

afterEach(cleanup);

describe('the Text style menu', () => {
  it('names the role of the selected text, follows a change, and is off for what is not text', () => {
    const session = new DeckSession(deck());
    render(<TextStyleMenu session={session} slideId="s" tokens={null} readOnly={false} onNotice={() => {}} />);
    const button = () => screen.getByRole('button', { name: 'Text style' });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    act(() => session.select(['p']));
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(button().textContent).toBe('Text style');
    act(() => session.edit((origin) => applyTextStyle(session.doc, 's', ['p'], 'quote', null, origin)));
    expect(button().textContent).toBe('Quote');
    act(() => session.select(['box']));
    expect((button() as HTMLButtonElement).disabled).toBe(true);
  });
});
