// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V2, V5, V7; X36): one pin's open
// threads in a popover, each the document's card (`ThreadCard`), compacted, oldest first, with its place among them and
// no quote; placed by the card's placement (below, above, docked), hidden until placed and while its pin is off the
// stage; the newest (or the asked) thread active, its reply field taking the keyboard once the popover shows; J and K
// move the active thread and the keyboard with it, and nothing else moves it (an agent's reply or new thread);
// Escape, U and Escape in the reply field exit, the draft the host's.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { dockCard, placeCard, type CardStyle } from './placement';
import type { ThreadCardThread } from './ThreadCard';
import { ThreadPopover, type ThreadPopoverProps } from './ThreadPopover';

afterEach(cleanup);

const HUMAN: Actor = { kind: 'human' };
const AGENT = { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor;
const thread = (id: string, at: number, bodies: string[] = [`About ${id}.`]): ThreadCardThread => ({
  id,
  quote: 'Plan',
  status: 'open',
  orphan: false,
  messages: bodies.map((body, i) => ({ id: `${id}:m${i}`, by: i % 2 ? AGENT : HUMAN, at: at + i, body })),
  createdBy: HUMAN,
  createdAt: at,
});
const BELOW: CardStyle = placeCard({ width: 800, height: 600 }, { x: 40, y: 60, top: 40 });

/** A host as the pin popover's binding is: the drafts map, the placement, the exit. */
function Host(props: Partial<ThreadPopoverProps> & { threads: readonly ThreadCardThread[]; onExitSeen?: () => void }) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [open, setOpen] = useState(true);
  if (!open) return <p>closed</p>;
  return (
    <ThreadPopover
      label="Comments on “Plan”"
      placement={BELOW}
      drafts={drafts}
      onDraftChange={(id, text) => setDrafts((was) => new Map(was).set(id, text))}
      onReply={() => {}}
      onResolve={() => {}}
      onReopen={() => {}}
      onExit={() => {
        props.onExitSeen?.();
        setOpen(false);
      }}
      {...props}
    />
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'Comments on “Plan”' });
const anyDialog = () => document.querySelector<HTMLElement>('[data-pin-popover]')!; // hidden ones too
const cards = () => within(dialog()).getAllByRole('group');
const card = (id: string) => dialog().querySelector<HTMLElement>(`[data-thread="${id}"]`)!;
const field = (id: string) => within(card(id)).getByRole('textbox', { name: 'Reply' });

describe('the popover’s threads', () => {
  it('lists the threads oldest first as compacted cards named with their place, no quote; the newest active, its reply field focused', () => {
    const three = [thread('t1', 1, ['First', 'r1', 'r2', 'r3']), thread('t2', 10), thread('t3', 20)];
    render(<Host threads={three} />);
    expect(cards().map((c) => c.dataset.thread)).toEqual(['t1', 't2', 't3']);
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['You: First (1 of 3)', 'You: About t2. (2 of 3)', 'You: About t3. (3 of 3)']);
    expect(dialog().querySelector('.thread-card-quote')).toBeNull();
    expect(card('t1').querySelector('.thread-card-more')?.textContent).toBe('1 more reply'); // compacted
    expect(card('t3').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(field('t3'));
  });

  it('activates the asked thread instead when it is the pin’s', () => {
    render(<Host threads={[thread('t1', 1), thread('t2', 10)]} initial="t1" />);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(field('t1'));
    cleanup();
    render(<Host threads={[thread('t1', 1), thread('t2', 10)]} initial="gone" />);
    expect(card('t2').getAttribute('aria-current')).toBe('true');
  });

  it('J and K move the active thread and the keyboard to its card; at the ends they stay', () => {
    const active = vi.fn<(id: string) => void>();
    render(<Host threads={[thread('t1', 1), thread('t2', 10), thread('t3', 20)]} onActiveChange={active} />);
    expect(active).toHaveBeenLastCalledWith('t3');
    fireEvent.keyDown(card('t3'), { key: 'j' });
    expect(card('t3').getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(card('t3'), { key: 'k' });
    expect(card('t2').getAttribute('aria-current')).toBe('true');
    expect(card('t3').hasAttribute('aria-current')).toBe(false);
    expect(document.activeElement).toBe(card('t2'));
    expect(active).toHaveBeenLastCalledWith('t2');
    fireEvent.keyDown(card('t2'), { key: 'k' });
    fireEvent.keyDown(card('t1'), { key: 'k' });
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(card('t1'));
  });

  it('an agent’s reply or new thread never moves the active thread; a resolved active thread gives way to the newest', () => {
    const view = render(<Host threads={[thread('t1', 1), thread('t2', 10)]} initial="t1" />);
    view.rerender(<Host threads={[thread('t1', 1, ['About t1.', 'An agent’s answer']), thread('t2', 10), thread('t3', 30)]} initial="t1" />);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(field('t1'));
    view.rerender(<Host threads={[thread('t2', 10), thread('t3', 30)]} initial="t1" />);
    expect(card('t3').getAttribute('aria-current')).toBe('true');
  });

  it('the thread that took a resolved one’s place stays active when an agent then adds a thread, its reply draft kept', () => {
    const view = render(<Host threads={[thread('t1', 1), thread('t2', 10)]} initial="t2" />);
    view.rerender(<Host threads={[thread('t1', 1)]} initial="t2" />);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    fireEvent.change(field('t1'), { target: { value: 'Half a reply' } });
    view.rerender(<Host threads={[thread('t1', 1), thread('t3', 30)]} initial="t2" />);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(card('t3').hasAttribute('aria-current')).toBe(false);
    expect((field('t1') as HTMLTextAreaElement).value).toBe('Half a reply');
  });

  it('E on the active card resolves it; the keyboard goes to the thread that takes its place', () => {
    function Resolving() {
      const [threads, setThreads] = useState([thread('t1', 1), thread('t2', 10)]);
      return <Host threads={threads} onResolve={(id) => setThreads((was) => was.filter((t) => t.id !== id))} />;
    }
    render(<Resolving />);
    act(() => card('t2').focus());
    fireEvent.keyDown(card('t2'), { key: 'e' });
    expect(cards().map((c) => c.dataset.thread)).toEqual(['t1']);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(card('t1'));
  });

  it('a click on another card activates it with its reply field', () => {
    render(<Host threads={[thread('t1', 1), thread('t2', 10)]} />);
    fireEvent.click(card('t1').querySelector('.thread-card-body')!);
    expect(card('t1').getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(field('t1'));
  });

  it('read-only: no reply field; the active card itself takes the keyboard', () => {
    render(<Host threads={[thread('t1', 1)]} readOnly />);
    expect(within(dialog()).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(card('t1'));
  });
});

describe('exiting keeps the draft', () => {
  it('Escape in the reply field exits; the typed draft is the host’s and comes back with the popover', () => {
    let drafts: ReadonlyMap<string, string> = new Map();
    const exit = vi.fn();
    const props = (extra: Partial<ThreadPopoverProps> = {}): ThreadPopoverProps => ({
      label: 'Comments on “Plan”',
      threads: [thread('t1', 1)],
      placement: BELOW,
      drafts,
      onDraftChange: (id, text) => (drafts = new Map(drafts).set(id, text)),
      onReply: () => {},
      onResolve: () => {},
      onReopen: () => {},
      onExit: exit,
      ...extra,
    });
    const view = render(<ThreadPopover {...props()} />);
    fireEvent.change(field('t1'), { target: { value: 'Shorter?' } });
    view.rerender(<ThreadPopover {...props()} />);
    fireEvent.keyDown(field('t1'), { key: 'Escape' });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(drafts.get('t1')).toBe('Shorter?');
    view.unmount();
    render(<ThreadPopover {...props()} />);
    expect((field('t1') as HTMLTextAreaElement).value).toBe('Shorter?');
    // an input method's Escape is the input method's
    fireEvent.keyDown(field('t1'), { key: 'Escape', isComposing: true });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('U and Escape on a card exit', () => {
    const exit = vi.fn();
    render(<Host threads={[thread('t1', 1), thread('t2', 10)]} onExitSeen={exit} />);
    fireEvent.keyDown(card('t1'), { key: 'u' });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('closed')).toBeTruthy();
  });
});

// the review's P2: the popover's height is capped and its content scrolls; the keyboard's place must be in view there
describe('the keyboard’s place in view', () => {
  it('scrolls the popover itself (only it) to the newest reply field on opening, and to a card J or K moves to', () => {
    // a 200 px tall popover at the window's top; each card 150 px tall down its content, its reply field at its bottom
    const scroll = { top: 0 };
    const at = (top: number, height: number) => ({ top: top - scroll.top, bottom: top - scroll.top + height, left: 0, right: 300, width: 300, height, x: 0, y: top - scroll.top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof HTMLElement && this.dataset.pinPopover !== undefined) return { ...at(0, 200), top: 0, bottom: 200, y: 0 };
      const card = this.closest<HTMLElement>('[data-thread]');
      const i = card ? ['t1', 't2', 't3'].indexOf(card.dataset.thread!) : -1;
      if (i < 0) return at(0, 0);
      return this instanceof HTMLTextAreaElement ? at(i * 150 + 110, 30) : at(i * 150, 150);
    });
    // the popover's scroll offset, observable (happy-dom keeps none); nothing else here scrolls
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get: () => scroll.top, set: (v: number) => (scroll.top = v) });
    try {
      try {
        render(<Host threads={[thread('t1', 1), thread('t2', 10), thread('t3', 20)]} />);
        expect(document.activeElement).toBe(field('t3'));
        expect(scroll.top).toBe(300 + 110 + 30 - 200); // the field's bottom at the box's bottom
        fireEvent.keyDown(card('t3'), { key: 'k' });
        expect(document.activeElement).toBe(card('t2'));
        expect(scroll.top).toBe(150); // the card's top at the box's top (it was above)
        fireEvent.keyDown(card('t2'), { key: 'j' });
        expect(document.activeElement).toBe(card('t3'));
        expect(scroll.top).toBe(300 + 150 - 200); // the card's bottom at the box's bottom (it was below)
      } finally {
        if (original) Object.defineProperty(HTMLElement.prototype, 'scrollTop', original);
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the placement', () => {
  it('stands where the card’s placement says: below the pin, above it, or docked in the host', () => {
    const view = render(<Host threads={[thread('t1', 1)]} placement={BELOW} />);
    expect(dialog().dataset.placement).toBe('below');
    expect([dialog().style.left, dialog().style.top, dialog().style.width, dialog().style.maxHeight]).toEqual(['40px', '64px', '300px', '360px']);
    view.rerender(<Host threads={[thread('t1', 1)]} placement={placeCard({ width: 800, height: 600 }, { x: 40, y: 560, top: 540 })} />);
    expect(dialog().dataset.placement).toBe('above');
    expect([dialog().style.bottom, dialog().style.top]).toEqual(['64px', '']);
    view.rerender(<Host threads={[thread('t1', 1)]} placement={dockCard({ width: 180, height: 400 })} />);
    expect(dialog().dataset.placement).toBe('docked');
    expect([dialog().style.left, dialog().style.bottom, dialog().style.width]).toEqual(['8px', '8px', '164px']);
  });

  it('is hidden until placed and while its pin is off the stage, and takes the keyboard only once it shows', () => {
    const view = render(<Host threads={[thread('t1', 1)]} placement={null} />);
    expect(anyDialog().style.visibility).toBe('hidden');
    expect(screen.queryByRole('dialog')).toBeNull(); // out of the accessibility tree too
    expect(document.activeElement).toBe(document.body);
    view.rerender(<Host threads={[thread('t1', 1)]} placement={BELOW} />);
    expect(dialog().style.visibility).toBe('');
    expect(document.activeElement).toBe(field('t1'));
    act(() => field('t1').blur());
    view.rerender(<Host threads={[thread('t1', 1)]} placement={BELOW} hidden />);
    expect(anyDialog().style.visibility).toBe('hidden');
    view.rerender(<Host threads={[thread('t1', 1)]} placement={BELOW} />);
    expect(document.activeElement).toBe(document.body); // shown again after a pan: the keyboard stays where it went
  });
});
