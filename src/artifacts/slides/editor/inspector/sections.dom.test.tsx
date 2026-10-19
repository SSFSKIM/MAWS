// P3-F slide-editor scalpel-4#4 (X28's tokens): a fill switched on from none starts at the deck's design-system token for a
// raised surface, never a literal colour, so under a dark system (or after a Theme switch) the new fill follows it; a
// gradient starts from that surface to the accent. An element's own colour stays its fill's start.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { siteOf } from '../../writers-elements';
import { Inspector } from '../Inspector';
import { DeckSession } from '../session';

const SLIDE = `<section id="a">
<p id="bare" style="position:absolute; left:100px; top:200px; width:400px; font-size:32px">No fill</p>
<div id="tinted" style="position:absolute; left:600px; top:100px; width:300px; height:200px; background:#336699"></div>
</section>`;

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['a'] });
    const l = loadSlide(SLIDE);
    if (!l.ok) throw new Error(`fixture: ${l.held.reasons.join('; ')}`);
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

afterEach(cleanup);

function mount(id: string) {
  const doc = deck();
  const session = new DeckSession(doc);
  session.select([id]);
  render(<Inspector session={session} slideId="a" readOnly={false} faces={{}} />);
  return doc;
}
const fill = (doc: Doc, id: string) => siteOf(doc, 'a', id).style.background;
const choose = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Fill' }), { target: { value } });
const RAISED = 'var(--ds-color-bg-raised, #ffffff)';

describe('a new fill', () => {
  it('starts at the system’s raised surface token, a colour or a gradient’s first stop', () => {
    const doc = mount('bare');
    choose('colour');
    expect(fill(doc, 'bare')).toBe(RAISED);
    expect((screen.getByRole('textbox', { name: 'Fill colour' }) as HTMLInputElement).value).toBe('Raised');
    choose('none');
    choose('gradient');
    expect(fill(doc, 'bare')).toBe(`linear-gradient(180deg, ${RAISED} 0%, var(--ds-color-accent, #c9663f) 100%)`);
  });

  it('keeps an element’s own colour as the gradient’s start', () => {
    const doc = mount('tinted');
    choose('gradient');
    expect(fill(doc, 'tinted')).toMatch(/^linear-gradient\(180deg, #336699 0%, var\(--ds-color-accent, #[0-9a-f]{6}\) 100%\)$/);
  });
});
