// X36, the shared comment card (P4-B1, docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D6; the P4 spec's
// §4.3, binding on the card): the compacted inactive form and the active form with the reply field, the draft held by
// the host, the keys R, E, J, K, U and Escape on a focused card (the prior art's K1 to K3), the author chip, the orphan
// note, read-only, and the group's accessible name with its position.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { DeckThreadState } from '../slides/threads';
import commentsCss from './comments.css?raw';
import tokensCss from '../../renderer/src/styles/tokens.css?raw';
import { ThreadCard, type ThreadCardProps, type ThreadCardThread } from './ThreadCard';

afterEach(cleanup);

// The deck's thread state is a card's thread as it is (B2's popover passes it unconverted): a type-level check.
const deckThread = (thread: DeckThreadState): ThreadCardThread => thread;
void deckThread;

const HUMAN: Actor = { kind: 'human' };
const SESSION = { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor;

const message = (n: number, by: Actor = n % 2 ? SESSION : HUMAN) => ({ id: `m${n}`, by, at: n, body: `Message ${n} about the plan.` });
const thread = (over: Partial<ThreadCardThread> = {}): ThreadCardThread => ({
  id: 'th1',
  quote: 'ships quarterly',
  status: 'open',
  orphan: false,
  messages: [message(0, HUMAN)],
  createdBy: HUMAN,
  createdAt: 1,
  ...over,
});

function handlers() {
  const callback = () => vi.fn<() => void>();
  const text = () => vi.fn<(text: string) => void>();
  return { onActivate: callback(), onReply: text(), onResolve: callback(), onReopen: callback(), onDraftChange: text(), onNext: callback(), onPrevious: callback(), onExit: callback() };
}

function show(props: Partial<ThreadCardProps> = {}) {
  const on = handlers();
  const view = render(<ThreadCard thread={thread()} active={false} compact draft="" {...on} {...props} />);
  return { on, view, card: () => screen.getByRole('group') };
}

// A host that holds the draft and the active thread, as the margin and the panel do.
function Host() {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <>
      <button type="button" onClick={() => setActive(true)}>
        Activate by the caret
      </button>
      <ThreadCard
        thread={thread()}
        active={active}
        compact
        draft={draft}
        onDraftChange={setDraft}
        onActivate={() => setActive(true)}
        onReply={() => {}}
        onResolve={() => {}}
        onReopen={() => {}}
        onExit={() => setActive(false)}
      />
    </>
  );
}

const bodies = (card: HTMLElement) => within(card).queryAllByRole('listitem').map((item) => item.querySelector('.thread-card-body')?.textContent);

describe('the card’s forms', () => {
  it('draws an article group with the thread’s id, status and orphan flag, current when active', () => {
    const { card, view } = show();
    expect(card().tagName).toBe('ARTICLE');
    expect(card().className).toContain('thread-card');
    expect(card().dataset.thread).toBe('th1');
    expect(card().dataset.status).toBe('open');
    expect(card().hasAttribute('data-orphan')).toBe(false);
    expect(card().getAttribute('aria-current')).toBeNull();
    expect(card().tabIndex).toBe(0);
    view.rerender(<ThreadCard thread={thread({ status: 'resolved', orphan: true })} active compact draft="" {...handlers()} />);
    expect(card().dataset.status).toBe('resolved');
    expect(card().dataset.orphan).toBe('');
    expect(card().getAttribute('aria-current')).toBe('true');
  });

  it('compacts an inactive thread to its first message and the two latest replies, the rest counted between', () => {
    const messages = [0, 1, 2, 3, 4, 5].map((n) => message(n));
    const { card, view } = show({ thread: thread({ messages }) });
    expect(bodies(card())).toEqual(['Message 0 about the plan.', 'Message 4 about the plan.', 'Message 5 about the plan.']);
    expect(card().querySelector('.thread-card-more')?.textContent).toBe('3 more replies');
    expect(within(card()).queryByRole('textbox', { name: 'Reply' })).toBeNull();

    view.rerender(<ThreadCard thread={thread({ messages: messages.slice(0, 4) })} active={false} compact draft="" {...handlers()} />);
    expect(card().querySelector('.thread-card-more')?.textContent).toBe('1 more reply');
    view.rerender(<ThreadCard thread={thread({ messages: messages.slice(0, 3) })} active={false} compact draft="" {...handlers()} />);
    expect(bodies(card())).toHaveLength(3);
    expect(card().querySelector('.thread-card-more')).toBeNull();
  });

  it('shows every message and the reply field when active, or when the host does not compact', () => {
    const messages = [0, 1, 2, 3, 4, 5].map((n) => message(n));
    const { card, view } = show({ thread: thread({ messages }), active: true });
    expect(bodies(card())).toHaveLength(6);
    expect(card().querySelector('.thread-card-more')).toBeNull();
    expect(within(card()).getByRole('textbox', { name: 'Reply' })).toBeTruthy();
    view.rerender(<ThreadCard thread={thread({ messages })} active={false} compact={false} draft="" {...handlers()} />);
    expect(bodies(card())).toHaveLength(6);
    expect(within(card()).getByRole('textbox', { name: 'Reply' })).toBeTruthy();
  });

  it('notes an orphan', () => {
    const { card } = show({ thread: thread({ orphan: true }) });
    expect(within(card()).getByText('The commented passage was removed.')).toBeTruthy();
  });

  it('chips each message with its author’s name and colour', () => {
    const { card } = show({ thread: thread({ messages: [message(0, HUMAN), message(1, SESSION)] }), active: true });
    const authors = [...card().querySelectorAll('.thread-card-author')];
    expect(authors.map((a) => a.textContent)).toEqual([actorDisplay(HUMAN).name, actorDisplay(SESSION).name]);
    expect(authors.map((a) => (a.querySelector('.thread-card-chip') as HTMLElement).style.background)).toEqual([`var(${actorDisplay(HUMAN).color})`, `var(${actorDisplay(SESSION).color})`]);
  });

  it('offers Resolve on an open thread, Reopen and no reply field on a resolved one', () => {
    const { card, on, view } = show({ active: true });
    act(() => fireEvent.click(within(card()).getByRole('button', { name: 'Resolve' })));
    expect(on.onResolve).toHaveBeenCalledOnce();
    view.rerender(<ThreadCard thread={thread({ status: 'resolved' })} active compact draft="" {...on} />);
    expect(within(card()).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    act(() => fireEvent.click(within(card()).getByRole('button', { name: 'Reopen' })));
    expect(on.onReopen).toHaveBeenCalledOnce();
  });

  it('read-only: no reply field, Resolve and Reopen disabled', () => {
    const { card, view } = show({ active: true, readOnly: true });
    expect(within(card()).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect((within(card()).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ThreadCard thread={thread({ status: 'resolved' })} active compact readOnly draft="" {...handlers()} />);
    expect((within(card()).getByRole('button', { name: 'Reopen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the quoted passage and its tab only when asked; the quote activates', () => {
    const { card, on, view } = show();
    expect(card().querySelector('.doc-thread-quote')).toBeNull();
    view.rerender(<ThreadCard thread={thread()} active={false} compact draft="" showQuote tabTitle="Appendix" {...on} />);
    expect(card().querySelector('.doc-thread-quote-text')?.textContent).toBe('ships quarterly');
    expect(card().querySelector('.doc-thread-tab')?.textContent).toBe('Appendix');
    act(() => fireEvent.click(within(card()).getByRole('button', { name: 'Show passage: ships quarterly' })));
    expect(on.onActivate).toHaveBeenCalledOnce();
    view.rerender(<ThreadCard thread={thread()} active={false} compact draft="" showQuote tabTitle={null} {...on} />);
    expect(card().querySelector('.doc-thread-tab')).toBeNull();
  });

  it('is named by its author, its first words and its position', () => {
    const long = { ...message(0, SESSION), body: 'Should   this ship monthly rather than quarterly, given the new budget cycle?' };
    const { card, view } = show({ thread: thread({ messages: [long] }), position: { index: 2, count: 6 } });
    expect(card().getAttribute('aria-label')).toBe('Claude: Should this ship monthly rather than quarterly, given… (2 of 6)');
    view.rerender(<ThreadCard thread={thread({ messages: [message(0, HUMAN)] })} active={false} compact draft="" {...handlers()} />);
    expect(card().getAttribute('aria-label')).toBe('You: Message 0 about the plan.');
    // a thread with no message yet (its comment not sent) is named by its quote
    view.rerender(<ThreadCard thread={thread({ messages: [] })} active={false} compact draft="" {...handlers()} />);
    expect(card().getAttribute('aria-label')).toBe('You: “ships quarterly”');
  });
});

describe('a click on the card', () => {
  it('activates it, outside its controls only', () => {
    const { card, on } = show({ thread: thread({ status: 'resolved' }) });
    act(() => fireEvent.click(card().querySelector('.thread-card-body')!));
    expect(on.onActivate).toHaveBeenCalledOnce();
    act(() => fireEvent.click(within(card()).getByRole('button', { name: 'Reopen' })));
    expect(on.onActivate).toHaveBeenCalledOnce();
  });

  it('focuses the reply field when the click activates it, not when the host activates it otherwise', () => {
    render(<Host />);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Activate by the caret' })));
    const field = within(screen.getByRole('group')).getByRole('textbox', { name: 'Reply' });
    expect(document.activeElement).not.toBe(field);
    cleanup();

    render(<Host />);
    act(() => fireEvent.click(screen.getByRole('group').querySelector('.thread-card-body')!));
    expect(document.activeElement).toBe(within(screen.getByRole('group')).getByRole('textbox', { name: 'Reply' }));
  });
});

describe('the draft', () => {
  it('is the host’s: shown from `draft`, typed through `onDraftChange`', () => {
    const { card, on } = show({ active: true, draft: 'Half a thought' });
    const field = within(card()).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Half a thought');
    act(() => fireEvent.change(field, { target: { value: 'Half a thought, more' } }));
    expect(on.onDraftChange).toHaveBeenCalledWith('Half a thought, more');
  });

  it('posts on Enter, trimmed, and clears; Shift+Enter and a composition’s Enter do not post; nor does a blank draft', () => {
    const { card, on, view } = show({ active: true, draft: '  Monthly works.  ' });
    const field = () => within(card()).getByRole('textbox', { name: 'Reply' });
    act(() => fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true }));
    act(() => fireEvent.keyDown(field(), { key: 'Enter', isComposing: true }));
    expect(on.onReply).not.toHaveBeenCalled();
    act(() => fireEvent.keyDown(field(), { key: 'Enter' }));
    expect(on.onReply).toHaveBeenCalledWith('Monthly works.');
    expect(on.onDraftChange).toHaveBeenCalledWith('');
    view.rerender(<ThreadCard thread={thread()} active compact draft="   " {...on} />);
    expect((within(card()).getByRole('button', { name: 'Reply' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.keyDown(field(), { key: 'Enter' }));
    expect(on.onReply).toHaveBeenCalledOnce();
  });

  it('survives the card going away and coming back (the host keeps it)', () => {
    function Toggle() {
      const [shown, setShown] = useState(true);
      const [draft, setDraft] = useState('');
      return (
        <>
          <button type="button" onClick={() => setShown(!shown)}>
            Toggle
          </button>
          {shown && <ThreadCard thread={thread()} active compact draft={draft} onDraftChange={setDraft} onActivate={() => {}} onReply={() => {}} onResolve={() => {}} onReopen={() => {}} />}
        </>
      );
    }
    render(<Toggle />);
    act(() => fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Kept' } }));
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Toggle' })));
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Toggle' })));
    expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('Kept');
  });

  it('Escape in the reply field exits and keeps a written draft; an empty one exits too; a composition’s Escape is the input method’s', () => {
    const { card, on, view } = show({ active: true, draft: 'Not yet sent' });
    const field = () => within(card()).getByRole('textbox', { name: 'Reply' });
    act(() => fireEvent.keyDown(field(), { key: 'Escape', isComposing: true }));
    expect(on.onExit).not.toHaveBeenCalled();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void field().dispatchEvent(escape));
    expect(on.onExit).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
    expect(on.onDraftChange).not.toHaveBeenCalled();
    view.rerender(<ThreadCard thread={thread()} active compact draft="" {...on} />);
    act(() => fireEvent.keyDown(field(), { key: 'Escape' }));
    expect(on.onExit).toHaveBeenCalledTimes(2);
  });

  it('without an exit, Escape in the reply field is left to the host’s ancestors', () => {
    const { card } = show({ active: true, draft: 'x', onExit: undefined });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => void within(card()).getByRole('textbox', { name: 'Reply' }).dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
  });
});

describe('the keys on a focused card', () => {
  const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    act(() => void target.dispatchEvent(event));
    return event.defaultPrevented;
  };

  it('R focuses the reply field', () => {
    const { card } = show({ active: true });
    card().focus();
    expect(press(card(), 'r')).toBe(true);
    expect(document.activeElement).toBe(within(card()).getByRole('textbox', { name: 'Reply' }));
  });

  it('R on an inactive compacted card activates it, as a click does, and focuses the reply field once it is active', () => {
    render(<Host />);
    const card = screen.getByRole('group');
    card.focus();
    expect(within(card).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect(press(card, 'r')).toBe(true);
    expect(card.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(within(card).getByRole('textbox', { name: 'Reply' }));
  });

  it('R activates nothing on a resolved or read-only card', () => {
    const { card, on, view } = show({ thread: thread({ status: 'resolved' }) });
    expect(press(card(), 'r')).toBe(false);
    view.rerender(<ThreadCard thread={thread()} active={false} compact readOnly draft="" {...on} />);
    expect(press(card(), 'r')).toBe(false);
    expect(on.onActivate).not.toHaveBeenCalled();
  });

  it('E resolves an open thread and reopens a resolved one; not read-only', () => {
    const { card, on, view } = show();
    expect(press(card(), 'e')).toBe(true);
    expect(on.onResolve).toHaveBeenCalledOnce();
    view.rerender(<ThreadCard thread={thread({ status: 'resolved' })} active={false} compact draft="" {...on} />);
    press(card(), 'e');
    expect(on.onReopen).toHaveBeenCalledOnce();
    view.rerender(<ThreadCard thread={thread()} active={false} compact readOnly draft="" {...on} />);
    expect(press(card(), 'e')).toBe(false);
    expect(on.onResolve).toHaveBeenCalledOnce();
  });

  it('J and K move to the next and previous thread; U and Escape exit', () => {
    const { card, on } = show();
    press(card(), 'j');
    expect(on.onNext).toHaveBeenCalledOnce();
    press(card(), 'k');
    expect(on.onPrevious).toHaveBeenCalledOnce();
    press(card(), 'u');
    press(card(), 'Escape');
    expect(on.onExit).toHaveBeenCalledTimes(2);
  });

  it('work from the card’s buttons, not from a text field, not with a modifier, not when the host gave no handler', () => {
    const { card, on } = show({ active: true, onNext: undefined });
    press(within(card()).getByRole('button', { name: 'Resolve' }), 'j');
    expect(press(card(), 'j')).toBe(false);
    press(within(card()).getByRole('button', { name: 'Resolve' }), 'k');
    expect(on.onPrevious).toHaveBeenCalledOnce();
    const field = within(card()).getByRole('textbox', { name: 'Reply' });
    for (const key of ['r', 'e', 'k', 'u']) press(field, key);
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) press(card(), 'e', { [modifier]: true });
    expect(on.onResolve).not.toHaveBeenCalled();
    expect(on.onPrevious).toHaveBeenCalledOnce();
    expect(on.onExit).not.toHaveBeenCalled();
  });

  it('come in the order of K2: the message actions, Reply, then Resolve', () => {
    const { card } = show({ active: true, draft: 'x' });
    const order = [...card().querySelectorAll<HTMLElement>('button, textarea')].map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(order).toEqual(['Reply', 'Reply', 'Resolve']);
  });
});

// the literal-colour check is theme.dom.test.tsx's, over this sheet too
describe('comments.css', () => {
  it('reads only app tokens', () => {
    const tokens = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name));
    const css = commentsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const reads = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name]) => name);
    expect(reads.length).toBeGreaterThan(0);
    for (const name of reads) expect(tokens, name).toContain(name);
  });
});
