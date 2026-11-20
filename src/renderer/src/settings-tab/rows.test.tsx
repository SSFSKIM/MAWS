// U11a M9 (l8-settings-06; the execution document's Interfaces §G): every row of Settings outside the Org page is drawn
// from one declaration in `SETTINGS_ROWS`, names the state it shows and tells the view both. With the page populated
// (imported Chrome profiles with extensions, Spaces, a chosen binary, the memory budget on, the supervisor waiting on an
// older version) and again empty, every drawn row is declared in the section it is drawn in, and every declared row is
// drawn or revealed by a drawn one. The word cut: the rows drawn only on trouble (the voice helper, recognition, the
// machine daemon) or once a binding changed (Reset to defaults) are drawn when the populated page has it; the config
// home is in the Binary row's note, and Update is drawn on the Binary row.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { resetLibrary } from '../library/store';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { importBridge, RECORD } from '../test-support/browser-import';
import { waitingStatus } from '../test-support/host-status';
import { connectBrowserImport, resetBrowserImport } from '../tools/browser/import/store';
import { DrawnRows, DrawnRowsContext } from './drawn';
import { Setting } from './parts';
import { fillPlaces, SETTINGS_ROWS } from './rows';
import { SETTINGS_SECTIONS, SettingsView } from './SettingsView';

const SYSTEM: LibraryRow = {
  id: '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71', kind: 'design_system', title: 'House', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null,
  pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
};
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, kind === 'design_system' ? 1 : 0]));

let disconnect = () => {};
async function renderPage(initial: Settings, populated: boolean) {
  const b = importBridge(initial);
  // the machine's own route on a daemon that knows it, or the two legacy routes on one before it
  b.answers['machineSettings.get'] = () => ({ settings: machineSettingsDefaults(), version: 1, ...(populated && { defaultRoute: 'machine' as const }) });
  if (populated) {
    b.answers['browser.import.list'] = () => ({ profiles: [RECORD], fileBroken: false, running: null });
    b.answers['library.list'] = () => ({ rows: [SYSTEM], counts });
    b.answers['library.spaces'] = () => ({ spaces: [{ id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'Teaching', createdAt: 1, count: 0 }] });
    b.answers['host.status'] = () => ({ ...waitingStatus(2), daemon: null });
    const probe = b.answers['voice.status']!;
    b.answers['voice.status'] = (input) => ({ ...(probe(input) as object), helper: { state: 'missing', path: '/repo/build/voice-helper/maws-voice-helper' }, supportsOnDevice: false });
  }
  window.maws = b.bridge;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectBrowserImport(undefined, queries);
  render(
    <QueryClientProvider client={queries}>
      <SettingsView section={null} />
    </QueryClientProvider>,
  );
  await act(async () => {});
}

type Drawn = { id: string; state: string; section: string };
function drawnRows(): Drawn[] {
  return [...document.querySelectorAll<HTMLElement>('[data-settings-row]')].map((el) => ({
    id: el.dataset.settingsRow!,
    state: el.dataset.settingsState!,
    section: el.closest('section[aria-labelledby^="settings-"]')!.getAttribute('aria-labelledby')!.replace('settings-', ''),
  }));
}

function expectEveryRowDeclaredAndEveryDeclarationDrawn(): Drawn[] {
  const drawn = drawnRows();
  for (const row of drawn) {
    const declared = SETTINGS_ROWS.find((r) => r.id === row.id);
    expect(declared, row.id).toBeDefined();
    expect(declared!.section, row.id).toBe(row.section);
    expect(Object.keys(declared!.states), row.id).toContain(row.state);
  }
  const ids = new Set(drawn.map((row) => row.id));
  for (const declared of SETTINGS_ROWS) expect(ids.has(declared.id) || [declared.revealedBy, declared.landsOn].some((at) => at !== undefined && ids.has(at)), declared.id).toBe(true); // a control drawn on another row (landsOn) is in the page as that row
  // nothing in the body outside the Org page is drawn outside the table
  const org = document.querySelector('section[aria-labelledby="settings-org"]')!;
  for (const group of document.querySelectorAll('[data-settings-body] [role="group"][aria-labelledby]')) if (!org.contains(group)) expect(group.hasAttribute('data-settings-row'), group.textContent ?? '').toBe(true);
  return drawn;
}

afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserImport();
  resetLibrary();
  useSettings.setState({ state: null });
  useHosts.setState({ supervisor: null, hosts: { engine: null, pty: null } });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the row table', () => {
  it('names each row <section>.<row> in a section of the view, once; what reveals a row is a declared row of its section', () => {
    const ids = SETTINGS_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of SETTINGS_ROWS) {
      expect(SETTINGS_SECTIONS).toContain(row.section);
      expect(row.id.startsWith(`${row.section}.`), row.id).toBe(true);
      expect(Object.keys(row.states).length, row.id).toBeGreaterThan(0);
      if (row.revealedBy !== undefined) expect(SETTINGS_ROWS.find((r) => r.id === row.revealedBy)?.section, row.id).toBe(row.section);
      if (row.landsOn !== undefined) expect(SETTINGS_ROWS.find((r) => r.id === row.landsOn)?.section, row.id).toBe(row.section);
      if (row.repeats) expect(row.revealedBy, row.id).toBeDefined();
    }
    expect(SETTINGS_ROWS.some((row) => row.section === 'org')).toBe(false); // the Org page's rows are not the table's
  });

  // the word cut: a condition the person must act on stands at rest, whole, and is never a note
  it('keeps a state line at rest: a state has its line and no note', () => {
    for (const row of SETTINGS_ROWS)
      for (const [name, state] of Object.entries(row.states))
        if (state.state) {
          expect(state.line, `${row.id} ${name}`).toBeDefined();
          expect(state.note, `${row.id} ${name}`).toBeUndefined();
        }
  });

  it('fills a marked place with its value, and keeps the words around it', () => {
    expect(fillPlaces('Default: 25% of physical memory ({size}).', { size: '8 GB' })).toBe('Default: 25% of physical memory (8 GB).');
    expect(fillPlaces('With MAWS closed, the supervisor exits {minutes} min after its last session ends.', { minutes: '10' })).toBe('With MAWS closed, the supervisor exits 10 min after its last session ends.');
  });
});

describe('every row drawn from the table', () => {
  it('with the page populated, every declared row is drawn, repeating rows once per thing made at run time', async () => {
    await renderPage({ ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Cmd+D' }, engine: { ...SETTINGS_DEFAULTS_V21.engine, binaryPath: '/opt/claude' } }, true);
    const shows = (id: string, state: string) => document.querySelector(`[data-settings-row="${id}"][data-settings-state="${state}"]`);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-settings-row="browser.extension"]')).toHaveLength(RECORD.extensions.length);
      expect(shows('supervisor.status', 'waiting')).not.toBeNull();
      expect(shows('artifacts.bySpace', 'spaces')).not.toBeNull();
      expect(shows('gateway.defaultRoute', 'machine')).not.toBeNull();
      expect(shows('voice.helper', 'build')).not.toBeNull();
      expect(shows('voice.recognition', 'default')).not.toBeNull();
      expect(shows('supervisor.daemon', 'default')).not.toBeNull();
    });
    const drawn = expectEveryRowDeclaredAndEveryDeclarationDrawn();
    for (const declared of SETTINGS_ROWS) if (declared.id !== 'engine.configHome') expect(drawn.map((row) => row.id), declared.id).toContain(declared.id);
    expect(drawn.map((row) => row.id)).not.toContain('engine.configHome'); // in the Binary row's note
    expect(drawn.filter((row) => row.id === 'browser.importedProfile')).toHaveLength(1);
    expect(drawn.filter((row) => row.id === 'browser.extension')).toHaveLength(RECORD.extensions.length);
    expect(drawn.find((row) => row.id === 'engine.binary')?.state).toBe('chosen');
    expect(drawn.find((row) => row.id === 'engine.update')?.state).toBe('chosen');
    expect(drawn.find((row) => row.id === 'supervisor.status')?.state).toBe('waiting');
    expect(drawn.find((row) => row.id === 'artifacts.bySpace')?.state).toBe('spaces');
    expect(drawn.find((row) => row.id === 'gateway.defaultRoute')?.state).toBe('machine');
  });

  it('with the page empty, every declared row not drawn is revealed by one that is', async () => {
    await renderPage({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, memoryBudget: { enabled: false } } }, false);
    const ids = expectEveryRowDeclaredAndEveryDeclarationDrawn().map((row) => row.id);
    for (const hidden of ['supervisor.limit', 'supervisor.stateful', 'browser.importedProfile', 'browser.extension', 'keyboard.reset', 'voice.helper', 'voice.recognition', 'supervisor.daemon', 'engine.configHome']) expect(ids, hidden).not.toContain(hidden);
  });
});

describe('a drawn row tells the view what it shows', () => {
  it('its declaration and its state, while it is drawn', () => {
    const rows = new DrawnRows();
    const page = (state: 'installed' | 'chosen') => (
      <DrawnRowsContext.Provider value={rows}>
        <Setting row="engine.update" state={state}>
          <span />
        </Setting>
      </DrawnRowsContext.Provider>
    );
    const view = render(page('installed'));
    expect([...rows.shown()]).toEqual([['engine.update', 'installed']]);
    view.rerender(page('chosen'));
    expect([...rows.shown()]).toEqual([['engine.update', 'chosen']]);
    view.unmount();
    expect([...rows.shown()]).toEqual([]);
  });
});
