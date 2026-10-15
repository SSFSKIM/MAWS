// @vitest-environment happy-dom
// The composers on a phone (mockups/desk/05-phone.html, 4–5): Return makes a new line and posting is the button, while
// a desk keeps Return to post; the group composer completes an @-tag from the project's live members.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConnection } from '../../project/connection';
import type { DeskSession } from '../../shell/sessions';
import { DeskContext } from '../conversation/desk-context';
import { GroupComposer, SessionComposer } from './Composer';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const session = (id: string, alias: string, group: DeskSession['group'] = 'idle'): DeskSession => ({
  project: 'p1',
  session: id,
  alias,
  machine: 'mini',
  cwd: '/w',
  worktree: null,
  seat: '',
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  group,
  presence: { record: { status: 'idle' }, bridge: true },
  machineOnline: true,
});

let say: ReturnType<typeof vi.fn>;
function mount(ui: React.ReactNode) {
  say = vi.fn(async () => 'nonce');
  const connection = { project: 'p1', say, rpc: vi.fn(async () => 'nonce'), conversation: { store: { getState: () => ({ compactions: {} }), subscribe: () => () => {} } } } as unknown as ProjectConnection;
  const sessions = new Map([
    [S1, session(S1, 'maws-45')],
    [S2, session(S2, 'maws-fe', 'working')],
  ]);
  return render(<DeskContext.Provider value={{ connection, member: 'm1', sessions }}>{ui}</DeskContext.Provider>);
}

const phone = (narrow: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));

beforeEach(() => phone(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Return', () => {
  it('posts on a desk', () => {
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' });
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('makes a new line on a phone, in the group composer and in a session’s, and the button posts', () => {
    phone(true);
    mount(
      <>
        <GroupComposer name="MAWS" />
        <SessionComposer session={session(S1, 'maws-45')} />
      </>,
    );
    for (const name of ['Message #MAWS', 'Message maws-45']) {
      const box = screen.getByRole('textbox', { name });
      fireEvent.change(box, { target: { value: 'hello' } });
      const event = fireEvent.keyDown(box, { key: 'Enter' });
      expect(event).toBe(true); // not prevented: the browser inserts the newline
    }
    expect(say).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(say).toHaveBeenCalledTimes(1);
  });
});

describe('@ completion in the group composer', () => {
  it("lists the live members matching what follows @, and a pick inserts the tag say's grammar resolves", () => {
    phone(true);
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@maws-4', selectionStart: 7, selectionEnd: 7 } });
    const list = screen.getByRole('listbox', { name: 'Deliver to' });
    expect(list.textContent).toContain('maws-45');
    expect(list.textContent).not.toContain('maws-fe');
    fireEvent.mouseDown(screen.getByRole('option', { name: /maws-45/ }));
    expect(box.value).toBe('@maws-45 ');
    expect(screen.queryByRole('listbox', { name: 'Deliver to' })).toBeNull();
  });

  it('offers @all, and nothing once the text has moved past its opening tags', () => {
    mount(<GroupComposer name="MAWS" />);
    const box = screen.getByRole('textbox', { name: 'Message #MAWS' });
    fireEvent.change(box, { target: { value: '@a', selectionStart: 2, selectionEnd: 2 } });
    expect(screen.getByRole('option', { name: /@all/ })).toBeTruthy();
    fireEvent.change(box, { target: { value: 'thanks @ma', selectionStart: 10, selectionEnd: 10 } });
    expect(screen.queryByRole('listbox', { name: 'Deliver to' })).toBeNull();
  });
});

describe('the session composer’s hint', () => {
  it('names Enter as the steer only where Enter steers: on a desk, not on a phone', () => {
    const working = { ...session(S2, 'maws-fe', 'working'), presence: { record: { status: 'working' }, bridge: true } };
    mount(<SessionComposer session={working} />);
    expect(screen.getByRole('textbox', { name: 'Message maws-fe' }).getAttribute('placeholder')).toBe('Steer maws-fe (Enter), or Send to queue it');
    cleanup();
    phone(true);
    mount(<SessionComposer session={working} />);
    expect(screen.getByRole('textbox', { name: 'Message maws-fe' }).getAttribute('placeholder')).toBe('Steer maws-fe, or Send to queue it');
  });
});
