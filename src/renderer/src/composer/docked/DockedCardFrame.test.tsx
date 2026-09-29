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
    expect(frame.textContent).toContain('Trust this folder · Composer paused · draft preserved');
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

  it('takes focus on mount when its pane held focus, and returns it to the composer on unmount', () => {
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
    act(() => toggle.click());
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
