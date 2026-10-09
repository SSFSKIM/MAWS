import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerFocusTarget } from '../stores/composer';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Availability } from '@shared/ipc/schema/session';
import { digest, record } from '../../../../test/support/builders';
import { NOT_RUNNING } from '../statusline';
import { useSessions } from '../stores/sessions';
import { useReadLoads } from './read';
import { WidgetFrame } from './WidgetFrame';

afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
  useReadLoads.setState({ loads: new Map() });
});
const ID = 'app-1' as AppSessionId;

describe('WidgetFrame', () => {
  // E11's sitting (owner-notes 00-consolidated-plan §2.2): no provenance foot; what a change writes is said in its sheet.
  it('shows the head and the body when ready, and no foot', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(frame.querySelector('h3')?.textContent).toBe('Hooks');
    expect(screen.getByText('/hooks')).toBeTruthy();
    expect(screen.getByText('the body')).toBeTruthy();
    expect(frame.querySelector('footer')).toBeNull();
    expect(frame.textContent).not.toContain('Read with');
  });

  it('shows the loading line and the error in place of the body', () => {
    const { rerender } = render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="loading" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText('Reading…')).toBeTruthy();
    rerender(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="error" error="get_hooks_listing refused" close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('alert').textContent).toBe('get_hooks_listing refused');
  });

  it('keeps the body of a ready read and says, in one line above it, that a later read failed', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error="The engine did not answer · showing the last value it reported" close={() => {}}>
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
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error={null} close={close}>
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

  // P2-A (2026-10-09; the execution document §5.6): the frame owns the dormant states for every widget from its id.
  describe('a session with a record and no ready process', () => {
    const invoke = vi.fn(async (name: string, input: unknown) => (name === 'session.acquire' ? { ok: true, value: { status: 'ready', appSessionId: (input as { appSessionId: string }).appSessionId, launched: true, joined: false } } : { ok: true, value: null }));
    const frame = (props: { state: 'dormant' | 'starting' | 'unavailable'; error?: string | null; readAt?: number | null }) => (
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state={props.state} error={props.error ?? null} readAt={props.readAt} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>
    );
    const acquires = () => invoke.mock.calls.filter(([name]) => name === 'session.acquire');
    const setRecord = (over: Parameters<typeof record>[1] = {}, availability: Availability = 'resumable') =>
      useSessions.setState({ records: new Map([[ID, record(ID, over)]]), digests: new Map([[ID, digest(ID, { availability })]]) });

    it('dormant with nothing read: "Not read yet." and Load now, which acquires for a read; mounting acquires nothing', async () => {
      invoke.mockClear();
      window.maws = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge;
      setRecord();
      render(frame({ state: 'dormant', readAt: null }));
      expect(screen.getByText('Not read yet.')).toBeTruthy();
      expect(screen.queryByText('the body')).toBeNull();
      expect(screen.queryByText(NOT_RUNNING)).toBeNull();
      expect(acquires()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Load now' }));
      await vi.waitFor(() => expect(acquires()).toEqual([['session.acquire', { appSessionId: ID, reason: 'read' }]]));
    });

    it('dormant with a cached answer: the body under "Read <when>" and Refresh; without a date, Load now and no body', () => {
      setRecord();
      const { rerender } = render(frame({ state: 'dormant', readAt: Date.now() - 5 * 60_000 }));
      expect(screen.getByText('the body')).toBeTruthy();
      expect(screen.getByText('Read 5 minutes ago')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
      rerender(frame({ state: 'dormant' }));
      expect(screen.queryByText('the body')).toBeNull();
      expect(screen.getByRole('button', { name: 'Load now' })).toBeTruthy();
    });

    it('starting: "Starting…" above whatever body there is, and no button', () => {
      setRecord();
      const { rerender } = render(frame({ state: 'starting', readAt: Date.now() }));
      expect(screen.getByText('Starting…')).toBeTruthy();
      expect(screen.getByText('the body')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Load now|Refresh/ })).toBeNull();
      rerender(frame({ state: 'starting' }));
      expect(screen.queryByText('the body')).toBeNull();
    });

    it('unavailable: a terminal holding it offers the holder’s actions in place of Load now; an archive offers nothing; a refusal offers Load now again', () => {
      setRecord({ holder: { kind: 'terminal', pid: 4711 } }, 'foreign_held');
      const { rerender } = render(frame({ state: 'unavailable', error: 'Held by terminal · 4711', readAt: Date.now() }));
      expect(screen.getByText('Held by terminal · 4711')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Take over here' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Load now|Refresh/ })).toBeNull();
      expect(screen.getByText('the body')).toBeTruthy(); // its facts, read-only
      act(() => setRecord({ archived: true }, 'archived'));
      rerender(frame({ state: 'unavailable', error: 'Archived · unarchive it to continue' }));
      expect(screen.queryByRole('button', { name: /Load now|Take over/ })).toBeNull();
      act(() => setRecord());
      rerender(frame({ state: 'unavailable', error: 'Directory not found: /gone' }));
      expect(screen.getByText('Directory not found: /gone')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Load now' })).toBeTruthy();
    });
  });
});
