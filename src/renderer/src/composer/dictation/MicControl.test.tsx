// The toolbar's microphone (E9 execution document, Design §8): its session's capture state and notice only, the denial's
// System Settings button, the chord in its title, and the pointer's press and hold.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V9 } from '@shared/settings/defaults';
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
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V9, resolvedTheme: 'light' } });
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

  it('names the effective chord in its title, an override included', () => {
    const { a } = renderBoth();
    expect(a.getByRole('button', { name: 'Dictate' }).title).toBe('Hold ⌥Space to dictate · on this Mac');
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V9, keymap: { 'composer.dictate': 'Cmd+D' } }, resolvedTheme: 'light' } }));
    expect(a.getByRole('button', { name: 'Dictate' }).title).toBe('Hold ⌘D to dictate · on this Mac');
  });

  it('presses for its session under the pointer and releases on up or on leaving; never a capture it did not start', () => {
    const press = vi.fn((appSessionId: AppSessionId) => capture(appSessionId, 'requesting', `c-${press.mock.calls.length}`));
    const release = vi.fn();
    const withdraw = provideDictation({ press, release } as unknown as DictationController);
    try {
      const { a, b } = renderBoth();
      const mic = a.getByRole('button', { name: 'Dictate' });
      fireEvent.pointerDown(mic, { button: 0 });
      expect(press).toHaveBeenCalledWith(A);
      fireEvent.pointerUp(mic, { button: 0 });
      expect(release.mock.calls).toEqual([['keyup']]);
      fireEvent.pointerLeave(mic);
      expect(release).toHaveBeenCalledOnce(); // released once

      fireEvent.pointerDown(mic, { button: 0 });
      fireEvent.pointerLeave(mic); // dragged off the button
      expect(release).toHaveBeenCalledTimes(2);

      // a capture the key started (B's) is not this button's to end
      release.mockClear();
      act(() => capture(B, 'listening', 'from-key'));
      const other = b.getByRole('button', { name: 'Dictate' });
      fireEvent.pointerLeave(other);
      fireEvent.pointerDown(other, { button: 2 }); // not the primary button
      fireEvent.pointerUp(other, { button: 2 });
      expect(release).not.toHaveBeenCalled();
    } finally {
      withdraw();
    }
  });
});
