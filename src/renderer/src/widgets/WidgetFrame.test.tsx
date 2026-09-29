import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerFocusTarget } from '../stores/composer';
import { NOT_RUNNING } from '../statusline';
import { WidgetFrame } from './WidgetFrame';

afterEach(cleanup);
const ID = 'app-1' as AppSessionId;
const foot = { readWith: 'get_hooks_listing', editedWhere: 'Hooks are edited in `settings` and plugins' };

describe('WidgetFrame', () => {
  it('shows the head, the body when ready, and the foot naming the read and what is edited elsewhere', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="ready" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(frame.querySelector('h3')?.textContent).toBe('Hooks');
    expect(screen.getByText('/hooks')).toBeTruthy();
    expect(screen.getByText('the body')).toBeTruthy();
    const footer = frame.querySelector('footer')!;
    expect(footer.textContent).toBe('Read with get_hooks_listing · Hooks are edited in settings and plugins');
    expect(footer.querySelectorAll('code')).toHaveLength(2);
  });

  it('shows the loading line, the error, and C7’s not-running sentence in place of the body', () => {
    const { rerender } = render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="loading" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText('Reading…')).toBeTruthy();
    rerender(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="error" error="get_hooks_listing refused" close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('alert').textContent).toBe('get_hooks_listing refused');
    rerender(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="not_running" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText(NOT_RUNNING)).toBeTruthy();
    expect(screen.queryByText('the body')).toBeNull();
  });

  it('keeps the body of a ready read and says, in one line above it, that a later read failed', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="ready" error="The engine did not answer · showing the last value it reported" close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText('the body')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('The engine did not answer · showing the last value it reported');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes focus when it opens; Esc closes it and hands the keyboard back to the composer', () => {
    const close = vi.fn();
    const focusEditor = vi.fn();
    const off = registerFocusTarget(ID, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" foot={foot} state="ready" error={null} close={close}>
        <button type="button">inside</button>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(document.activeElement).toBe(frame);
    fireEvent.keyDown(screen.getByText('inside'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close Hooks' }));
    expect(close).toHaveBeenCalledTimes(2);
    off();
  });
});
