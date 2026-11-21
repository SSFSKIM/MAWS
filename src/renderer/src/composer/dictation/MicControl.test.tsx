// The toolbar's microphone (E9 execution document, Design §8): its session's capture state and notice only, the denial's
// System Settings button, the click that toggles a capture (the owner's ruling, 2026-10-06), and a bound chord in its tooltip.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useNotices } from '../../stores/notices';
import { useSettings } from '../../stores/settings';
import { VOICE } from '../../settings-tab/copy';
import { accessibleText } from '../../test-support/accessible-text';
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

const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;
// What is drawn: the text outside the words kept for screen readers alone (`sr-only`)
function drawn(root: Element): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof Element && !node.classList.contains('sr-only')) node.childNodes.forEach(walk);
  };
  walk(root);
  return text;
}

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
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V21, resolvedTheme: 'light' } });
});
afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
});

describe('the microphone control', () => {
  // The word cut (C33): listening is the pressed microphone and a pulsing dot, finishing a still, faint dot, with no word
  // drawn (the words stay for screen readers); asking for permission keeps its words.
  it('shows the capture’s state in its own session’s toolbar only', () => {
    const { a, b } = renderBoth();
    const status = () => a.getByRole('status', { name: 'Dictation' });
    expect(a.queryByRole('status')).toBeNull();
    act(() => capture(A, 'requesting'));
    expect(drawn(status())).toBe('Asking for permission…');
    act(() => capture(A, 'listening'));
    expect(drawn(status())).toBe('');
    expect(status().querySelector('[data-dictation-dot]')?.getAttribute('data-dictation-dot')).toBe('listening');
    expect(accessibleText(status())).toBe('Listening…');
    expect(b.queryByRole('status')).toBeNull();
    act(() => capture(A, 'finishing'));
    expect(drawn(status())).toBe('');
    expect(status().querySelector('[data-dictation-dot]')?.getAttribute('data-dictation-dot')).toBe('finishing');
    expect(accessibleText(status())).toBe('Finishing…');
  });

  it('shows a denial with the button that opens its pane, and × dismisses it', () => {
    const { a, b } = renderBoth();
    act(() => notice(A, errorNotice('microphone_denied', 'denied', null)));
    const note = a.getByRole('note', { name: 'Dictation notice' });
    expect(note.textContent).toContain('Microphone access is off for MAWS');
    // scale-review C scalpel-5#3: the reason is announced (an alert, which a screen reader speaks as it appears)
    expect(within(note).getByRole('alert').textContent).toContain('Microphone access is off for MAWS');
    expect(b.queryByRole('note')).toBeNull();
    fireEvent.click(within(note).getByRole('button', { name: 'Open System Settings' }));
    expect(invoke).toHaveBeenCalledWith('voice.openPrivacySettings', { pane: 'microphone' });
    act(() => notice(A, errorNotice('speech_denied', 'denied', null)));
    fireEvent.click(a.getByRole('button', { name: 'Open System Settings' }));
    expect(invoke).toHaveBeenLastCalledWith('voice.openPrivacySettings', { pane: 'speech' });
    fireEvent.click(a.getByRole('button', { name: 'Dismiss' }));
    expect(a.queryByRole('note')).toBeNull();
  });

  // P2-F (L89): a failed open says so as Settings › Voice does, with the pane to open by hand
  it('a failed open of the pane raises the same warning toast as Settings › Voice', async () => {
    useNotices.setState({ notices: [] });
    const { a } = renderBoth();
    act(() => notice(A, errorNotice('speech_denied', 'denied', null)));
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'failed', message: 'no settings app' } } as never);
    fireEvent.click(a.getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(useNotices.getState().notices.map((n) => [n.level, n.text])).toEqual([['warning', VOICE.openFailed('no settings app', VOICE.paneByHand.speech)]]));
  });

  it('points a language with no on-device model at the Dictation settings, with no pane button', () => {
    const { a } = renderBoth();
    act(() => notice(A, errorNotice('on_device_unavailable', 'no model', null)));
    const note = a.getByRole('note', { name: 'Dictation notice' });
    expect(note.textContent).toContain('System Settings › Keyboard › Dictation');
    expect(within(note).queryByRole('button', { name: 'Open System Settings' })).toBeNull();
  });

  // The word cut (C32): its tooltip is its word, "Dictate", with the hold a bound chord gives; focus reaches it
  it('reads Dictate as its tooltip, and names a bound chord’s hold in it, an override included', () => {
    const { a } = renderBoth();
    const mic = () => a.getByRole('button', { name: 'Dictate' });
    expect(mic().hasAttribute('title')).toBe(false);
    act(() => mic().focus());
    expect(tooltip()).toBe('Dictate'); // unbound by default
    act(() => mic().blur());
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Alt+Space' } }, resolvedTheme: 'light' } }));
    expect(a.getByRole('button', { name: 'Dictate', description: 'hold ⌥Space' })).toBe(mic());
    act(() => mic().focus());
    expect(tooltip()).toBe('Dictate · hold ⌥Space');
    act(() => mic().blur());
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Cmd+D' } }, resolvedTheme: 'light' } }));
    act(() => mic().focus());
    expect(tooltip()).toBe('Dictate · hold ⌘D');
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
