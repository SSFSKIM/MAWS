// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, M4, §H): Settings › Sessions, the machine's default
// set of MAWS's tools, read from and written to this machine's spine (`machineSettings.*`'s `mawsTools`). Artifacts off
// turns Documents and Dashboards off and greys them, their word saying why; on turns both on; the question tool is a
// segment. A spine that answers no set predates the choice, and the two rows are not drawn.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { SessionsSection } from './SessionsSection';

let b: SettingsBridge;
let held: MawsToolSet | undefined; // what this machine's spine holds; undefined: a spine that predates the choice

// `held` the spine's set; `gates`, a read answered with the set as it was when sent but released later, or a write
// that lands on the spine when released; `notify()` is main's settings.changed after a change of the machine half,
// which draws the section with a new settings object and so reads the set again
const gates: { read: Promise<void> | null; write: Promise<void> | null } = { read: null, write: null };
let written: unknown[] = []; // each machineSettings.set's input, in the order sent
function renderSection(start: MawsToolSet | 'predates' = FULL_MAWS_TOOL_SET) {
  held = start === 'predates' ? undefined : start;
  written = [];
  b = settingsBridge();
  b.answers['machineSettings.get'] = () => ({ settings: machineSettingsDefaults(), version: 1, ...(held !== undefined && { mawsTools: held }) });
  b.answers['machineSettings.set'] = (input) => {
    held = (input as { mawsTools: MawsToolSet }).mawsTools;
    return { settings: machineSettingsDefaults(), mawsTools: held };
  };
  type Invoke = (name: string, input: unknown, options?: unknown) => Promise<unknown>;
  const invoke = b.bridge.invoke as unknown as Mock<Invoke>;
  const answer = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name, input, options) => {
    if (name === 'machineSettings.get' && gates.read !== null) {
      const gate = gates.read;
      const result = await answer(name, input, options); // the set as it is when the read is sent
      await gate;
      return result;
    }
    if (name === 'machineSettings.set') {
      written.push(input); // as sent
      if (gates.write !== null) await gates.write;
    }
    return answer(name, input, options);
  });
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (settings: Settings) => (
    <QueryClientProvider client={client}>
      <SessionsSection settings={settings} />
    </QueryClientProvider>
  );
  const rendered = render(view(useSettings.getState().state!.settings));
  return { notify: () => rendered.rerender(view(structuredClone(useSettings.getState().state!.settings))) };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

afterEach(() => {
  gates.read = null;
  gates.write = null;
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

const tools = () => screen.getByRole('group', { name: 'MAWS tools' });
const toggle = (word: string) => within(tools()).getByRole('switch', { name: word });
const word = (text: string) => within(tools()).getByText(text, { exact: true });
const writes = () => written;
const descriptionOf = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
const question = (label: string) => within(screen.getByRole('radiogroup', { name: 'Question tool' })).getByRole('radio', { name: label }) as HTMLInputElement;

describe('Settings › Sessions, the machine’s default set of MAWS’s tools (board ticket 421)', () => {
  it('draws the machine’s set: four switches each beside its word, and the question tool', async () => {
    renderSection({ artifacts: true, documents: false, dashboards: true, auxiliary: false, question: 'engine' });
    await screen.findByRole('group', { name: 'MAWS tools' });
    expect(['Artifacts', 'Documents', 'Dashboards', 'Auxiliary'].map((name) => toggle(name).getAttribute('aria-checked'))).toEqual(['true', 'false', 'true', 'false']);
    expect(question('Default').checked).toBe(true);
    expect(question('MAWS').checked).toBe(false);
  });

  it('Artifacts off turns Documents and Dashboards off and greys them, their word saying they need Artifacts; on turns both on', async () => {
    renderSection();
    await screen.findByRole('group', { name: 'MAWS tools' });
    fireEvent.click(toggle('Artifacts'));
    await vi.waitFor(() => expect(toggle('Artifacts').getAttribute('aria-checked')).toBe('false'));
    expect(writes()).toEqual([{ patch: {}, mawsTools: { ...FULL_MAWS_TOOL_SET, artifacts: false, documents: false, dashboards: false } }]);
    for (const name of ['Documents', 'Dashboards']) {
      expect(toggle(name).getAttribute('aria-checked'), name).toBe('false');
      expect((toggle(name) as HTMLButtonElement).disabled, name).toBe(true);
      expect(word(name).tabIndex, `${name}: its word takes the keyboard`).toBe(0);
      expect(descriptionOf(word(name)), name).toBe('Needs Artifacts');
    }
    expect((toggle('Auxiliary') as HTMLButtonElement).disabled).toBe(false);
    expect(descriptionOf(word('Auxiliary'))).toBe('Open panes for you');

    fireEvent.click(toggle('Artifacts'));
    await vi.waitFor(() => expect(toggle('Documents').getAttribute('aria-checked')).toBe('true'));
    expect(toggle('Dashboards').getAttribute('aria-checked')).toBe('true');
    expect(writes().at(-1)).toEqual({ patch: {}, mawsTools: FULL_MAWS_TOOL_SET });
  });

  it('a switch writes its group alone, and the segment the question tool', async () => {
    renderSection();
    await screen.findByRole('group', { name: 'MAWS tools' });
    fireEvent.click(toggle('Auxiliary'));
    await vi.waitFor(() => expect(toggle('Auxiliary').getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(question('Default'));
    await vi.waitFor(() => expect(question('Default').checked).toBe(true));
    expect(writes()).toEqual([
      { patch: {}, mawsTools: { ...FULL_MAWS_TOOL_SET, auxiliary: false } },
      { patch: {}, mawsTools: { ...FULL_MAWS_TOOL_SET, auxiliary: false, question: 'engine' } },
    ]);
  });

  // The review of M4: a read sent before a newer choice was written answers the set as it was; it never takes that
  // choice back, and the next edit is made over it, so the last write carries every edit
  it('a read sent before a choice is written leaves the choice standing, and the next edit carries it', async () => {
    const { notify } = renderSection();
    await screen.findByRole('group', { name: 'MAWS tools' });
    fireEvent.click(toggle('Auxiliary')); // written at once
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    const read = gate();
    gates.read = read.promise;
    act(() => notify()); // the change of the first write is heard: the set is read again, its answer held back
    const write = gate();
    gates.write = write.promise;
    fireEvent.click(question('Default')); // the second write is out
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    await act(async () => read.release()); // the stale read lands: Auxiliary off, Question MAWS
    expect(question('Default').checked, 'the newer choice stands').toBe(true);
    fireEvent.click(toggle('Dashboards')); // a third edit, over the newer choice
    await act(async () => write.release());
    await vi.waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes().at(-1)).toEqual({ patch: {}, mawsTools: { ...FULL_MAWS_TOOL_SET, auxiliary: false, question: 'engine', dashboards: false } });
    // a stale read landing after the writes settled takes nothing back either; a read sent after them shows the spine's
    gates.read = null;
    gates.write = null;
    await vi.waitFor(() => expect(toggle('Dashboards').getAttribute('aria-checked')).toBe('false'));
    act(() => notify());
    await act(async () => {});
    expect(question('Default').checked).toBe(true);
    expect(toggle('Auxiliary').getAttribute('aria-checked')).toBe('false');
  });

  it('a read sent after the writes settled shows the spine’s set, a change made elsewhere included', async () => {
    const { notify } = renderSection();
    await screen.findByRole('group', { name: 'MAWS tools' });
    fireEvent.click(toggle('Auxiliary'));
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    await act(async () => {});
    held = { ...FULL_MAWS_TOOL_SET, question: 'engine' }; // another window chose this since
    act(() => notify());
    await vi.waitFor(() => expect(question('Default').checked).toBe(true));
    expect(toggle('Auxiliary').getAttribute('aria-checked')).toBe('true');
  });

  it('a refused write is a toast, and the rows show what the spine holds', async () => {
    renderSection();
    await screen.findByRole('group', { name: 'MAWS tools' });
    b.answers['machineSettings.set'] = () => {
      throw new Error('spine.lock is held by pid 4242');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.click(toggle('Artifacts'));
    await vi.waitFor(() => expect(useNotices.getState().notices.map((notice) => notice.text)).toEqual(['spine.lock is held by pid 4242']));
    expect(toggle('Artifacts').getAttribute('aria-checked')).toBe('true');
    expect(toggle('Documents').getAttribute('aria-checked')).toBe('true');
  });

  it('draws neither row on a machine whose spine predates the choice', async () => {
    renderSection('predates');
    await act(async () => {});
    await vi.waitFor(() => expect(b.calls.some((call) => call.name === 'machineSettings.get')).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('group', { name: 'MAWS tools' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Question tool' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Hooks in sessions' })).toBeTruthy(); // the section stands
  });
});
