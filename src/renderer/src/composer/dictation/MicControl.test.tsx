// The toolbar's microphone (E9 execution document, Design §8): its session's capture state and notice only, the denial's
// System Settings button, the click that toggles a capture (the owner's ruling, 2026-10-06), and a bound chord in its title.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V10 } from '@shared/settings/defaults';
import { useSettings } from '../../stores/settings';
import { provideDictation, type DictationController } from './controller';
import { errorNotice, type NoticeCopy } from './copy';
import { MicControl } from './MicControl';
import { resetDictationStore, useDictationStore } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const invoke = vi.fn(async () => ({ ok: true, value: undefined }));
const client = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge;

const capture = (appSessionId: AppSessionId, phase: 'requesting' | 'listening' | 'finishing', captureId = 'c-1') =>
  useDictationStore.setState({ capture: { appSessionId, captureId, phase, locale: null, interim: '' } });
const notice = (appSessionId: AppSessionId, copy: NoticeCopy) =>
  useDictationStore.setState({ notice: { appSessionId, ...copy } });

function renderBoth() {
  render(
    <>
      <div role="toolbar" aria-label="A">
        <MicControl appSessionId={A} client={client} />
      </div>
      <div role="toolbar" aria-label="B">
        <MicControl appSessionId={B} client={client} />
      </div>
    </>,
  );
  return { a: within(screen.getByRole('toolbar', { name: 'A' })), b: within(screen.getByRole('toolbar', { name: 'B' })) };
}

beforeEach(() => {
  resetDictationStore();
  invoke.mockClear();
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V10, resolvedTheme: 'light' } });
});
afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
});

describe('the microphone control', () => {
  it('shows the capture’s state in its own session’s toolbar only', () => {
    const { a, b } = renderBoth();
    expect(a.queryByRole('status')).toBeNull();
    act(() => capture(A, 'requesting'));
    expect(a.getByRole('status', { name: 'Dictation' }).textContent).toBe('Asking for permission…');
    act(() => capture(A, 'listening'));
    expect(a.getByRole('status', { name: 'Dictation' }).textContent).toBe('Listening…');
    expect(b.queryByRole('status')).toBeNull();
    act(() => capture(A, 'finishing'));
    expect(a.getByRole('status', { name: 'Dictation' }).textContent).toBe('Finishing…');
  });

  it('shows a denial with the button that opens its pane, and × dismisses it', () => {
    const { a, b } = renderBoth();
    act(() => notice(A, errorNotice('microphone_denied', 'denied', null)));
    const note = a.getByRole('note', { name: 'Dictation notice' });
    expect(note.textContent).toContain('Microphone access is off for MAWS');
    expect(b.queryByRole('note')).toBeNull();
    fireEvent.click(within(note).getByRole('button', { name: 'Open System Settings' }));
    expect(invoke).toHaveBeenCalledWith('voice.openPrivacySettings', { pane: 'microphone' });
    act(() => notice(A, errorNotice('speech_denied', 'denied', null)));
    fireEvent.click(a.getByRole('button', { name: 'Open System Settings' }));
    expect(invoke).toHaveBeenLastCalledWith('voice.openPrivacySettings', { pane: 'speech' });
    fireEvent.click(a.getByRole('button', { name: 'Dismiss' }));
    expect(a.queryByRole('note')).toBeNull();
  });

  it('points a language with no on-device model at the Dictation settings, with no pane button', () => {
    const { a } = renderBoth();
    act(() => notice(A, errorNotice('on_device_unavailable', 'no model', null)));
    const note = a.getByRole('note', { name: 'Dictation notice' });
    expect(note.textContent).toContain('System Settings › Keyboard › Dictation');
    expect(within(note).queryByRole('button', { name: 'Open System Settings' })).toBeNull();
  });

  it('says a click dictates, and names a bound chord in its title, an override included', () => {
    const { a } = renderBoth();
    expect(a.getByRole('button', { name: 'Dictate' }).title).toBe('Click to dictate · on this Mac'); // unbound by default
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V10, keymap: { 'composer.dictate': 'Alt+Space' } }, resolvedTheme: 'light' } }));
    expect(a.getByRole('button', { name: 'Dictate' }).title).toBe('Click to dictate · on this Mac · or hold ⌥Space');
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V10, keymap: { 'composer.dictate': 'Cmd+D' } }, resolvedTheme: 'light' } }));
    expect(a.getByRole('button', { name: 'Dictate' }).title).toBe('Click to dictate · on this Mac · or hold ⌘D');
  });

  it('reads pressed only while its own session’s capture runs', () => {
    const { a, b } = renderBoth();
    const micA = a.getByRole('button', { name: 'Dictate' });
    const micB = b.getByRole('button', { name: 'Dictate' });
    expect(micA.getAttribute('aria-pressed')).toBe('false');
    for (const phase of ['requesting', 'listening', 'finishing'] as const) {
      act(() => capture(A, phase));
      expect(micA.getAttribute('aria-pressed'), phase).toBe('true');
      expect(micB.getAttribute('aria-pressed'), phase).toBe('false');
    }
    act(() => useDictationStore.setState({ capture: null }));
    expect(micA.getAttribute('aria-pressed')).toBe('false');
  });

  // The owner's ruling (2026-10-06): a click starts recording for the button's own session and a second click stops it.
  it('toggles by its session’s phase: idle presses for its own session, requesting and listening release, finishing does nothing', () => {
    const press = vi.fn((appSessionId: AppSessionId) => capture(appSessionId, 'requesting'));
    const release = vi.fn();
    const withdraw = provideDictation({ press, release } as unknown as DictationController);
    try {
      const { a } = renderBoth();
      const mic = a.getByRole('button', { name: 'Dictate' });
      fireEvent.click(mic);
      expect(press.mock.calls).toEqual([[A]]);
      expect(release).not.toHaveBeenCalled();

      fireEvent.click(mic); // still asking for permission: the second click cancels
      expect(release.mock.calls).toEqual([['keyup']]);

      act(() => capture(A, 'listening'));
      fireEvent.click(mic); // listening: the second click stops, and the final lands
      expect(release.mock.calls).toEqual([['keyup'], ['keyup']]);

      act(() => capture(A, 'finishing'));
      fireEvent.click(mic); // the stop is on its way
      expect(release).toHaveBeenCalledTimes(2);
      expect(press).toHaveBeenCalledOnce();
    } finally {
      withdraw();
    }
  });

  it('presses for its own session while another session’s capture runs, and never ends that capture', () => {
    const press = vi.fn();
    const release = vi.fn();
    const withdraw = provideDictation({ press, release } as unknown as DictationController);
    try {
      const { b } = renderBoth();
      act(() => capture(A, 'listening', 'from-key'));
      fireEvent.click(b.getByRole('button', { name: 'Dictate' }));
      expect(press.mock.calls).toEqual([[B]]); // the controller ignores it while A's capture runs
      expect(release).not.toHaveBeenCalled();
    } finally {
      withdraw();
    }
  });

  it('has no press-and-hold: the pointer’s down, up and leaving do nothing, and the mouse never takes focus', () => {
    const press = vi.fn();
    const release = vi.fn();
    const withdraw = provideDictation({ press, release } as unknown as DictationController);
    try {
      const { a } = renderBoth();
      const mic = a.getByRole('button', { name: 'Dictate' });
      fireEvent.pointerDown(mic, { button: 0 });
      act(() => capture(A, 'listening'));
      fireEvent.pointerUp(mic, { button: 0 });
      fireEvent.pointerLeave(mic);
      expect(press).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(fireEvent.mouseDown(mic)).toBe(false); // default prevented: focus stays in the editor
    } finally {
      withdraw();
    }
  });
});
