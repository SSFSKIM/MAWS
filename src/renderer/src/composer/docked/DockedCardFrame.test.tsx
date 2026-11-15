import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { connectKeys } from '../../keymap/dispatcher';
import { registerFocusTarget, resetComposerStore } from '../../stores/composer';
import { resetShellStores } from '../../test-support/shell-stores';
import { DockedCardFrame } from './DockedCardFrame';
import { dockCard, resetDockedCards, useDockedCards } from './registry';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

// A card another child docks (C10's trust card, here a stub): its own content and outcome, the frame's rules.
function ForeignCard({ appSessionId, onAccept, onDecline }: { appSessionId: AppSessionId; onAccept: () => void; onDecline: (() => void) | null }) {
  return (
    <DockedCardFrame appSessionId={appSessionId} title="Trust this folder" onAccept={onAccept} onDecline={onDecline}>
      <p>Do you trust the files in this folder?</p>
      <textarea aria-label={`note ${appSessionId}`} />
      <button type="button">Trust</button>
    </DockedCardFrame>
  );
}

function Pane({ index, children }: { index: 0 | 1; children: React.ReactNode }) {
  return (
    <section data-pane={index} aria-label={`pane ${index}`}>
      <button type="button">tab {index}</button>
      {children}
    </section>
  );
}

let disconnect: () => void;
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetDockedCards();
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
});

describe('docked frame hosts a foreign card', () => {
  it('titles the frame, and a foreign card answers Enter and Esc through the frame only from the frame itself', async () => {
    const accept = vi.fn();
    const decline = vi.fn();
    render(
      <Pane index={0}>
        <ForeignCard appSessionId={A} onAccept={accept} onDecline={decline} />
      </Pane>,
    );
    const frame = screen.getByRole('group', { name: 'Trust this folder' });
    // UX wave U1a §J: a card another child docks reads its title alone; a request's frame keeps the composer's words
    expect(frame.querySelector(':scope > p')?.textContent).toBe('Trust this folder');
    expect(frame.textContent).not.toContain('Composer paused');
    const user = userEvent.setup();

    act(() => screen.getByLabelText(`note ${A}`).focus());
    await user.keyboard('{Enter}'); // a textarea keeps its Enter
    act(() => screen.getByRole('button', { name: 'Trust' }).focus());
    await user.keyboard('{Escape}'); // a button is refused by the dispatcher
    expect(accept).not.toHaveBeenCalled();
    expect(decline).not.toHaveBeenCalled();

    act(() => frame.focus());
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('a null handler leaves its key unbound', async () => {
    const accept = vi.fn();
    render(
      <Pane index={0}>
        <ForeignCard appSessionId={A} onAccept={accept} onDecline={null} />
      </Pane>,
    );
    const frame = screen.getByRole('group', { name: 'Trust this folder' });
    act(() => frame.focus());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    frame.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false); // nobody owned it
  });

  it('two frames in two panes: Enter answers only the frame that holds focus', async () => {
    const acceptA = vi.fn();
    const acceptB = vi.fn();
    render(
      <>
        <Pane index={0}>
          <ForeignCard appSessionId={A} onAccept={acceptA} onDecline={null} />
        </Pane>
        <Pane index={1}>
          <ForeignCard appSessionId={B} onAccept={acceptB} onDecline={null} />
        </Pane>
      </>,
    );
    const [frameA, frameB] = screen.getAllByRole('group', { name: 'Trust this folder' });
    act(() => frameB.focus());
    await userEvent.setup().keyboard('{Enter}');
    expect(acceptB).toHaveBeenCalledTimes(1);
    expect(acceptA).not.toHaveBeenCalled();
    expect(frameA).not.toBe(document.activeElement);
  });

  it('takes focus on mount when its pane held focus, and returns it to the composer on unmount', async () => {
    const focusEditor = vi.fn();
    registerFocusTarget(A, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    function Host() {
      const [docked, setDocked] = useState(false);
      return (
        <Pane index={0}>
          <button type="button" onClick={() => setDocked((d) => !d)}>
            toggle
          </button>
          {docked && <ForeignCard appSessionId={A} onAccept={() => {}} onDecline={null} />}
        </Pane>
      );
    }
    render(<Host />);
    const toggle = screen.getByRole('button', { name: 'toggle' });
    act(() => toggle.focus());
    act(() => toggle.click());
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Trust this folder' }));
    await act(async () => toggle.click()); // the return waits out the commit, in case the next docked frame takes it
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it('does not take focus when another pane held it, and gives nothing back on unmount', () => {
    const focusEditor = vi.fn();
    registerFocusTarget(A, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    const { rerender } = render(
      <>
        <Pane index={0}>{null}</Pane>
        <Pane index={1}>{null}</Pane>
      </>,
    );
    const other = screen.getByRole('button', { name: 'tab 1' });
    act(() => other.focus());
    rerender(
      <>
        <Pane index={0}>
          <ForeignCard appSessionId={A} onAccept={() => {}} onDecline={null} />
        </Pane>
        <Pane index={1}>{null}</Pane>
      </>,
    );
    expect(document.activeElement).toBe(other);
    rerender(
      <>
        <Pane index={0}>{null}</Pane>
        <Pane index={1}>{null}</Pane>
      </>,
    );
    expect(document.activeElement).toBe(other);
    expect(focusEditor).not.toHaveBeenCalled();
  });
});

// UX wave U1a (§D): the frame binds the permission prompt's two allow keys beside Enter and Esc, within itself, and every
// key it binds acts on a fresh press only, a card another child docks included.
describe('the frame’s request keys', () => {
  const key = (target: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true };
  const SHIFT_CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true };

  it('runs Allow once on ⌘↩ and the lasting allow on ⇧⌘↩ from the frame itself, and neither from a button inside it', () => {
    const once = vi.fn();
    const lasting = vi.fn();
    render(
      <Pane index={0}>
        <DockedCardFrame appSessionId={A} title="Approval needed" onAccept={null} onDecline={null} onAllowOnce={once} onAllowLasting={lasting}>
          <button type="button">Allow once</button>
        </DockedCardFrame>
      </Pane>,
    );
    act(() => screen.getByRole('button', { name: 'Allow once' }).focus());
    key(document.activeElement as HTMLElement, CMD_ENTER);
    key(document.activeElement as HTMLElement, SHIFT_CMD_ENTER);
    expect(once).not.toHaveBeenCalled();
    expect(lasting).not.toHaveBeenCalled();
    const frame = screen.getByRole('group', { name: 'Approval needed' });
    act(() => frame.focus());
    expect(key(frame, CMD_ENTER).defaultPrevented).toBe(true);
    expect(key(frame, SHIFT_CMD_ENTER).defaultPrevented).toBe(true);
    expect(once).toHaveBeenCalledTimes(1);
    expect(lasting).toHaveBeenCalledTimes(1);
  });

  it('leaves the allow keys unbound for a card that passes none', () => {
    render(
      <Pane index={0}>
        <ForeignCard appSessionId={A} onAccept={() => {}} onDecline={null} />
      </Pane>,
    );
    const frame = screen.getByRole('group', { name: 'Trust this folder' });
    act(() => frame.focus());
    expect(key(frame, CMD_ENTER).defaultPrevented).toBe(false);
  });

  it('acts on a fresh press only, for a card another child docks too: a repeat is taken and runs nothing', () => {
    const accept = vi.fn();
    const decline = vi.fn();
    render(
      <Pane index={0}>
        <ForeignCard appSessionId={A} onAccept={accept} onDecline={decline} />
      </Pane>,
    );
    const frame = screen.getByRole('group', { name: 'Trust this folder' });
    act(() => frame.focus());
    expect(key(frame, { key: 'Enter', code: 'Enter', repeat: true }).defaultPrevented).toBe(true);
    expect(key(frame, { key: 'Escape', code: 'Escape', repeat: true }).defaultPrevented).toBe(true);
    expect(accept).not.toHaveBeenCalled();
    expect(decline).not.toHaveBeenCalled();
    key(frame, { key: 'Enter', code: 'Enter' });
    key(frame, { key: 'Escape', code: 'Escape' });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
  });
});

// UX wave U1a (decision 17, the ruling of 2026-11-13 on the held-chord scene): the next prompt can dock a commit after
// the answered one left (a replayed or real engine asks about its next call once the first is answered). The hand-over
// mark then lives until the animation frame in which the editor's deferred focus has had its turn, and a frame of the
// session mounting meanwhile takes the focus when it is on the body or inside its own pane.
// UX wave U1b (decision 11): the frame's later-commit hand-over went with the dock (no request mounts a frame now); the
// cards another child docks keep the same-commit hand-over C7 built, and a frame mounting later takes the focus only by its
// pane holding it.
describe('the hand-over to the next frame', () => {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const microtasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  function View({ shown }: { shown: string | null }) {
    return (
      <>
        <button type="button">outside</button>
        <Pane index={0}>
          <input aria-label="editor" />
          {shown !== null && (
            <DockedCardFrame key={shown} appSessionId={A} title={`prompt ${shown}`} onAccept={() => {}} onDecline={null}>
              <p>{shown}</p>
            </DockedCardFrame>
          )}
        </Pane>
      </>
    );
  }
  const frameOf = (shown: string) => screen.getByRole('group', { name: `prompt ${shown}` });
  const editorFocus = (focusEditor: () => void) => registerFocusTarget(A, { focusEditor, focusFrame: () => {}, insertText: () => {} });
  // the first prompt docked and focused, then answered: it leaves, and its microtask has run
  async function answered(focusEditor: () => void) {
    editorFocus(focusEditor);
    const view = render(<View shown="one" />);
    act(() => frameOf('one').focus());
    view.rerender(<View shown={null} />);
    await microtasks();
    return view;
  }

  it('(a) gives the focus to a frame mounting in the same commit the focused one left, and the editor is not asked for it', async () => {
    const focusEditor = vi.fn();
    editorFocus(focusEditor);
    const view = render(<View shown="one" />);
    act(() => frameOf('one').focus());
    view.rerender(<View shown="two" />);
    expect(document.activeElement).toBe(frameOf('two'));
    await microtasks();
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it('(b) gives nothing to a frame mounting a commit later, while the editor’s deferred focus is outstanding', async () => {
    const view = await answered(() => {}); // the editor's focus is still outstanding (Tiptap defers it a frame)
    view.rerender(<View shown="two" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('(c) gives it to a frame mounting after the editor took the focus, by its pane holding it', async () => {
    // the editor as Tiptap focuses it, a frame later; held by reference, so a later test's editor is never this one
    const view = await answered(() => {
      const editor = document.querySelector<HTMLElement>('[aria-label="editor"]');
      requestAnimationFrame(() => void (editor?.isConnected && editor.focus()));
    });
    await nextFrame();
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByLabelText('editor'));
    view.rerender(<View shown="two" />);
    expect(document.activeElement).toBe(frameOf('two'));
  });

  it('(d) takes nothing when the focus was moved outside the pane before the frame mounted', async () => {
    const view = await answered(() => {});
    act(() => screen.getByRole('button', { name: 'outside' }).focus());
    view.rerender(<View shown="two" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'outside' }));
  });
});

describe('dockCard', () => {
  function Docked({ appSessionId }: { appSessionId: AppSessionId }) {
    const cards = useDockedCards(appSessionId);
    return <ul aria-label={`docked ${appSessionId}`}>{cards.map((card) => <li key={card.id}>{card.render()}</li>)}</ul>;
  }

  it('keeps docked cards per session in docking order, and each disposer undocks its own card', () => {
    render(
      <>
        <Docked appSessionId={A} />
        <Docked appSessionId={B} />
      </>,
    );
    let undockTrust = () => {};
    let undockRelay = () => {};
    act(() => {
      undockTrust = dockCard(A, { id: 'trust', render: () => 'trust card' });
      undockRelay = dockCard(A, { id: 'relay', render: () => 'relay card' });
    });
    expect(screen.getByRole('list', { name: `docked ${A}` }).textContent).toBe('trust cardrelay card');
    expect(screen.getByRole('list', { name: `docked ${B}` }).textContent).toBe('');
    act(() => undockTrust());
    expect(screen.getByRole('list', { name: `docked ${A}` }).textContent).toBe('relay card');
    act(() => undockTrust()); // twice is harmless
    act(() => undockRelay());
    expect(screen.getByRole('list', { name: `docked ${A}` }).textContent).toBe('');
  });
});

// UX wave U1a §J said the composer was paused for a request; UX wave U1b: no request docks, and every frame reads its
// title alone.
describe('the frame’s title line', () => {
  it('reads the title and nothing after it', () => {
    render(
      <Pane index={0}>
        <DockedCardFrame appSessionId={A} title="Relay is down" onAccept={null} onDecline={null}>
          <p>a card</p>
        </DockedCardFrame>
        <DockedCardFrame appSessionId={B} title="Trust this folder?" onAccept={null} onDecline={null}>
          <p>a setup card</p>
        </DockedCardFrame>
      </Pane>,
    );
    expect(screen.getByRole('group', { name: 'Relay is down' }).querySelector(':scope > p')?.textContent).toBe('Relay is down');
    expect(screen.getByRole('group', { name: 'Trust this folder?' }).querySelector(':scope > p')?.textContent).toBe('Trust this folder?');
  });
});
