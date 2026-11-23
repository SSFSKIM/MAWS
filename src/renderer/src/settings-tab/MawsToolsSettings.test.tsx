// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, M4, §H): Settings › Sessions, the machine's default
// set of MAWS's tools, read from and written to this machine's spine (`machineSettings.*`'s `mawsTools`). Artifacts off
// turns Documents and Dashboards off and greys them, their word saying why; on turns both on; the question tool is a
// segment. A spine that answers no set predates the choice, and the two rows are not drawn.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { SessionsSection } from './SessionsSection';

let b: SettingsBridge;
let held: MawsToolSet | undefined; // what this machine's spine holds; undefined: a spine that predates the choice

function renderSection(start: MawsToolSet | 'predates' = FULL_MAWS_TOOL_SET) {
  held = start === 'predates' ? undefined : start;
  b = settingsBridge();
  b.answers['machineSettings.get'] = () => ({ settings: machineSettingsDefaults(), version: 1, ...(held !== undefined && { mawsTools: held }) });
  b.answers['machineSettings.set'] = (input) => {
    held = (input as { mawsTools: MawsToolSet }).mawsTools;
    return { settings: machineSettingsDefaults(), mawsTools: held };
  };
  window.maws = b.bridge;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionsSection settings={useSettings.getState().state!.settings} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

const tools = () => screen.getByRole('group', { name: 'MAWS tools' });
const toggle = (word: string) => within(tools()).getByRole('switch', { name: word });
const word = (text: string) => within(tools()).getByText(text, { exact: true });
const writes = () => b.calls.filter((call) => call.name === 'machineSettings.set').map((call) => call.input);
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
