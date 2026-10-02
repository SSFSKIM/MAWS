import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionId } from '@shared/keymap/actions';
import { useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import { connectKeys } from './dispatcher';
import { useKeyChord } from './useKeyChord';
import { currentSet } from '../stores/layout-model';

// The shell's own `useKeyChord`, bound the way C7's docked card and Overview cards will bind it: to the element that
// holds focus. No C7 code: each binding here is a focusable element with a spy.
function Bound({ id, label, spy, as = 'div', children }: { id: ActionId; label: string; spy: (arg: number | null) => void; as?: 'div' | 'section' | 'article'; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useKeyChord(id, spy, { within: ref });
  const Tag = as;
  return (
    <Tag ref={ref as never} tabIndex={0} aria-label={label}>
      {children}
    </Tag>
  );
}

const spies = {
  dock0: vi.fn(),
  dock1: vi.fn(),
  cardA: vi.fn(),
  cardB: vi.fn(),
  pane0: vi.fn(),
};

// Pane 0 holds a docked request and two Overview cards; pane 1 a docked request and a textarea; the sidebar a search.
function World() {
  return (
    <>
      <aside>
        <input type="search" aria-label="Search" />
        <button type="button">Needs-you row</button>
      </aside>
      <Bound id="request.accept" label="pane 0" spy={spies.pane0} as="section">
        <Bound id="request.accept" label="dock 0" spy={spies.dock0} />
        <Bound id="request.accept" label="card A" spy={spies.cardA} as="article" />
        <Bound id="request.accept" label="card B" spy={spies.cardB} as="article">
          <button type="button">Open session</button>
        </Bound>
      </Bound>
      <section aria-label="pane 1">
        <Bound id="request.accept" label="dock 1" spy={spies.dock1} />
        <textarea aria-label="scratch" />
        <div data-key-sink="composer" tabIndex={0} aria-label="composer" />
        <div data-key-sink="terminal">
          <textarea aria-label="terminal input" />
        </div>
      </section>
    </>
  );
}

const fired = () => Object.entries(spies).flatMap(([name, spy]) => (spy.mock.calls.length > 0 ? [`${name}×${spy.mock.calls.length}`] : []));
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  Object.values(spies).forEach((spy) => spy.mockClear());
  disconnect = connectKeys();
  render(<World />);
});
afterEach(() => {
  disconnect();
  cleanup();
});

async function enterOn(label: string) {
  const user = userEvent.setup();
  act(() => (screen.queryByLabelText(label) ?? screen.getByRole('button', { name: label })).focus());
  await user.keyboard('{Enter}');
}

describe('key dispatch follows DOM focus', () => {
  it('Enter in the sidebar search fires no request handler', async () => {
    await enterOn('Search');
    expect(fired()).toEqual([]);
  });

  it('Enter in a textarea inside pane 1 fires none, empty as it is', async () => {
    await enterOn('scratch');
    expect(fired()).toEqual([]);
  });

  it('Enter on card B fires card B’s handler only: the innermost owner, not the pane’s, not card A’s', async () => {
    await enterOn('card B');
    expect(fired()).toEqual(['cardB×1']);
  });

  it('Enter on pane 1’s docked element fires pane 1’s only, even while the remembered focused pane is 0', async () => {
    act(() => useLayout.getState().focusPane(0));
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    await enterOn('dock 1');
    expect(fired()).toEqual(['dock1×1']);
  });

  it('Enter on a card in pane 0 while a request is docked in pane 1 fires the card’s, never the docked one', async () => {
    await enterOn('card A');
    expect(fired()).toEqual(['cardA×1']);
  });

  it('Enter from a button inside a card fires nothing', async () => {
    await enterOn('Open session');
    expect(fired()).toEqual([]);
  });

  it('Enter from a Needs-you row (a button) fires nothing', async () => {
    await enterOn('Needs-you row');
    expect(fired()).toEqual([]);
  });

  it('Enter from inside a [data-key-sink] element fires nothing', async () => {
    await enterOn('composer');
    await enterOn('terminal input');
    expect(fired()).toEqual([]);
  });

  it('Enter while a menu is open fires nothing', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.dataset.state = 'open';
    document.body.append(menu);
    try {
      await enterOn('card A');
      expect(fired()).toEqual([]);
    } finally {
      menu.remove();
    }
  });

  // W5: every sidebar row has a hover card; one open under the pointer takes no key from the pane.
  it('Enter on a card while a sidebar row’s hover card is open still answers', async () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.dataset.state = 'open';
    card.dataset.hoverCard = '';
    document.body.append(card);
    try {
      await enterOn('card A');
      expect(fired()).toEqual(['cardA×1']);
    } finally {
      card.remove();
    }
  });

  it('Enter during IME composition fires nothing', () => {
    const card = screen.getByLabelText('card A');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(fired()).toEqual([]);
  });

  it('Escape reaches only request.decline handlers, and a handled key is not default any more', () => {
    const card = screen.getByLabelText('card A');
    act(() => card.focus());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    card.dispatchEvent(escape);
    expect(fired()).toEqual([]);
    expect(escape.defaultPrevented).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    card.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('a key it does not handle keeps its default', () => {
    const search = screen.getByLabelText('Search');
    act(() => search.focus());
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    search.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  // Debt wave 5 (C7's keyboard e2e cases): a chord is bound in the commit that mounts its element, so a key pressed as
  // soon as the element can be seen (here, from a later sibling's layout effect, before any passive effect of that
  // commit has run) reaches it; under load the page can paint well before its passive effects run.
  it('a key pressed in the commit that mounts the bound element reaches it', () => {
    const late = vi.fn();
    function PressAtMount() {
      useLayoutEffect(() => {
        const card = screen.getByLabelText('late card');
        card.focus();
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      }, []);
      return null;
    }
    render(
      <>
        <Bound id="request.accept" label="late card" spy={late} />
        <PressAtMount />
      </>,
    );
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('a binding whose element does not hold focus is no candidate, though the key’s target is inside it', () => {
    // A key dispatched at card A while focus sits in the sidebar search: the target is inside card A, focus is not.
    act(() => screen.getByLabelText('Search').focus());
    screen.getByLabelText('card A').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    expect(fired()).toEqual([]);
  });
});

describe('composer chords', () => {
  function Composer({ spy }: { spy: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useKeyChord('composer.send', spy, { within: ref });
    return (
      <div ref={ref} data-key-sink="composer">
        <textarea aria-label="draft" />
      </div>
    );
  }

  it('are delivered inside data-key-sink="composer", text entry included, and nowhere else', async () => {
    cleanup();
    const send = vi.fn();
    render(
      <>
        <Composer spy={send} />
        <textarea aria-label="elsewhere" />
      </>,
    );
    const user = userEvent.setup();
    act(() => screen.getByLabelText('elsewhere').focus());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(send).not.toHaveBeenCalled();
    act(() => screen.getByLabelText('draft').focus());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(send).toHaveBeenCalledOnce();
  });
});

// C11 start: the Settings tab's chord capture takes every key while it records (C11 M5 fix wave, item 1): an app-scoped
// chord pressed there is what is being recorded, not a command to run.
describe('the chord capture', () => {
  function AppChord({ spy }: { spy: () => void }) {
    useKeyChord('composer.stop', spy);
    return null;
  }

  it('an app-scoped chord pressed while recording runs nothing; elsewhere it runs', async () => {
    cleanup();
    const stop = vi.fn();
    render(
      <>
        <AppChord spy={stop} />
        <kbd data-chord-capture tabIndex={0} aria-label="recording" />
        <textarea aria-label="elsewhere" />
      </>,
    );
    const press = (label: string) => fireEvent.keyDown(screen.getByLabelText(label), { key: '.', code: 'Period', metaKey: true });
    press('recording');
    expect(stop).not.toHaveBeenCalled();
    press('elsewhere');
    expect(stop).toHaveBeenCalledOnce();
  });
});
// C11 end

it('does not let a persisted bare app-wide shortcut swallow text or stop work', async () => {
  disconnect();
  disconnect = connectKeys(window, () => ({ 'composer.stop': 'S' }));
  const stop = vi.fn();
  render(<Bound id="composer.stop" label="busy session" spy={stop} />);
  const input = screen.getByRole('searchbox', { name: 'Search' });
  const user = userEvent.setup();
  await user.type(input, 'sessions');
  expect(stop).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe('sessions');
});
