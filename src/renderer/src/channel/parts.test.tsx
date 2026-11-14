// A Channel row's names (UX wave U11a, M3; board 505; the execution document's Interfaces §E, "Names, one order"): an alias is
// drawn whole where the row has room, with no 24-character cap; a party's tooltip holds its alias, title and machine in
// full; and the parts give way in one order across a whole row: the title first, then the recipients' and owners' labels,
// then the machine chip, then the alias. jsdom measures nothing, so the order is pinned here as the room each part is
// given (its grow weight, each a thousand times the one that gives way before it) and measured by e2e/channel.spec.ts in a
// 420 px column.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GIVES_WAY, Names, NAMES_ROW, Party, partyTooltip } from './parts';

const LONG = 'ci-optimization-coordinator-for-the-clinical-research-shards';
const party = (over: Partial<Parameters<typeof Party>[0]['party']> = {}) => ({ session: 's1', alias: LONG, title: 'Fix the relay', machine: 'studio-mini', ...over });

afterEach(cleanup);

describe('Party', () => {
  it('draws the alias whole, with no 24-character cap', () => {
    render(<Party party={party()} />);
    const alias = screen.getByText(LONG);
    expect(alias.textContent).toBe(LONG);
    expect(alias.className).not.toMatch(/max-w-\[24ch\]/);
  });

  it('holds its alias, title and machine in full in its tooltip, a missing one left out, also where the row draws no title', () => {
    const { rerender } = render(<Party party={party()} title={false} />);
    const tooltip = () => document.querySelector('[data-channel-party]')!.getAttribute('title');
    expect(tooltip()).toBe(`${LONG} · Fix the relay · studio-mini`);
    rerender(<Party party={party({ title: null })} />);
    expect(tooltip()).toBe(`${LONG} · studio-mini`);
    rerender(<Party party={party({ machine: null })} />);
    expect(tooltip()).toBe(`${LONG} · Fix the relay`);
    expect(partyTooltip('maws-45', '', '')).toBe('maws-45');
  });

  it("puts its names among the row's own items, so the one order runs across the whole row", () => {
    render(<Party party={party()} />);
    const names = document.querySelector('[data-channel-party]')!;
    expect(names.classList.contains('contents')).toBe(true); // display: contents (jsdom loads no stylesheet)
    expect([...names.querySelectorAll('[data-name-part]')].map((el) => el.getAttribute('data-name-part'))).toEqual(['alias', 'title', 'chip']);
  });
});

describe('the order names give way in', () => {
  const weight = (classes: string) => Number(/(?:^| )grow(?:-\[(\d+)\])?(?: |$)/.exec(classes)?.[1] ?? (/(?:^| )grow(?: |$)/.test(classes) ? 1 : NaN));
  it('gives the room to the alias first, then the chip, then the labels, then the title, each a thousand times the next', () => {
    const order = (['alias', 'chip', 'label', 'title'] as const).map((part) => weight(GIVES_WAY[part]));
    expect(order.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]! / order[i]!).toBeGreaterThanOrEqual(1000);
  });

  it('sizes each part at its minimum and stops it at its whole width: the alias at twelve characters, the others at nothing', () => {
    // A width, not a flex basis: a box's width is also its intrinsic contribution, so the names group (`Names`) enters its
    // row's line at the sum of the minimums whichever way the browser sizes a flex container.
    expect(GIVES_WAY.alias.split(' ')).toEqual(expect.arrayContaining(['w-[12ch]', 'max-w-max']));
    for (const part of ['chip', 'label', 'title'] as const) expect(GIVES_WAY[part].split(' ')).toEqual(expect.arrayContaining(['w-0', 'max-w-max']));
  });
});

describe('Names', () => {
  it("holds a row's names together as one item of the row, entering its line at their minimums, so only the fixed parts around it wrap", () => {
    render(
      <p data-row="">
        <span data-fixed="">3 messages between</span>
        <Names>
          <Party party={party()} title={false} />
          <span>and</span>
          <Party party={party({ session: 's2', alias: 'maws-45' })} title={false} />
        </Names>
        <span data-fixed="">10:42</span>
      </p>,
    );
    const names = document.querySelector<HTMLElement>('[data-names]')!;
    expect(names.querySelectorAll('[data-name-part="alias"]')).toHaveLength(2);
    expect(names.textContent).toContain('and');
    expect(names.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'basis-0', 'grow', 'min-w-min']));
    expect(names.className.split(' ')).not.toContain('flex-wrap');
    expect(NAMES_ROW.split(' ')).toContain('flex-wrap');
  });
});
