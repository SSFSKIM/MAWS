// UX wave U11c M3 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E "My items, All"; Acceptance C4, C5):
// My items with All chosen is one list of what this Mac has for the page's place: the plugins with an installation here or
// at user scope and then MAWS's built-in mods, the skills, the connectors, each part by name, each row its kind's own row
// ending in its kind word; one search narrows every part by its kind's rule; a part is drawn when its read has answered,
// and one failed read hides nothing else; the empty state is decided by plugins, skills and connectors alone. Every name
// here is invented.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName, EventName, PreloadBridge } from '@shared/ipc/schema';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import type { ModRow } from '@shared/mods/registry';
import { project, status } from '../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { mountCustomize } from '../test-support/customize-page';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { forgetKeptOperations } from '../widgets/plugins/operation';
import { resetCatalogStore } from '../stores/catalog';
import { CONNECTORS } from './connectors/copy';
import { heard, resetSignIns } from './connectors/sign-in';
import { useCustomizeProject } from './open';
import { useCustomizePage } from './page';

const A = at('project-quay' as ProjectId);
const QUAY = '/tmp/all/quay';
const HOME = '/tmp/all/config';
const BINARY = '/opt/claude/engine';

const plugin = (name: string, over: Record<string, unknown> = {}) => ({ id: `${name}@harbour-market`, name, marketplace: 'harbour-market', version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `${HOME}/plugins/cache/${name}`, errors: [], notes: [], installedAt: null, lastUpdated: null, here: false, coversHere: true, projectEnabled: false, ...over });
const BUOY = plugin('buoy-log');
const ANCHOR = plugin('anchor-chart');
// installed only for another project and not enabled here: no installation here or at user scope, so not All's
const KEEL = plugin('keel-notes', { scope: 'project', projectPath: '/tmp/all/elsewhere', enabled: false, coversHere: false });
const MOD: ModRow = { id: 'maws.to-human', name: 'To-human', description: 'Agents mark what is for you.', version: 1, enabled: true, source: 'maws-contract', perSession: 'inherit' };
const skill = (name: string, source: 'project' | 'user' | 'plugin', description: string, pluginName: string | null = null) => ({ name, description, source, path: `${QUAY}/.claude/skills/${name}/SKILL.md`, plugin: pluginName });
const SKILLS = [skill('tide-tables', 'project', 'Reads the tides'), skill('mooring-check', 'user', 'Checks the lines before the tide turns'), skill('chart-reader', 'plugin', 'Reads a chart', 'Anchor chart')];
const TIDES = { name: 'tides', scope: 'user', path: `${HOME}/.claude.json`, transport: 'http' };
const RADIO = { name: 'harbour-radio', scope: 'project', path: `${QUAY}/.mcp.json`, transport: 'stdio' };

let calls: { name: string; input: unknown }[];
let listeners: Map<string, Set<(payload: unknown) => void>>;
let held: Map<string, (outcome?: unknown, reload?: unknown) => void>;
let holdReceipt: Set<CommandName>;
let holdDone: Set<CommandName>;
let installed: ReturnType<typeof plugin>[];
let listAnswer: Promise<unknown> | null; // plugins.list's answer, when a test holds it
let inventoryAnswer: Promise<unknown> | null; // customization.inventory's, when a test holds it
let skills: ReturnType<typeof skill>[];
let servers: { name: string; scope: string; path: string; transport: string }[];
let mods: ModRow[];
let opSeq: number;

const deliver = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
const emit = (name: EventName, payload: unknown) => {
  act(() => {
    deliver(name, payload);
  });
};
const invoked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.input);
const ACTION_OF: Partial<Record<CommandName, string>> = { 'plugins.disable': 'disable', 'plugins.uninstall': 'uninstall', 'connectors.remove': 'mcp-remove' };

function answer(name: CommandName, input: unknown): unknown {
  switch (name) {
    case 'plugins.env':
      return { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: `${HOME}/.claude.json` };
    case 'plugins.list':
      return listAnswer ?? { plugins: installed };
    case 'marketplaces.list':
      return { marketplaces: [] };
    case 'plugins.manifest':
      return { manifests: [] };
    case 'mods.list':
      return mods;
    case 'customization.inventory':
      return inventoryAnswer ?? { skills, servers, warnings: [CUSTOMIZATION_INVENTORY_COVERAGE], serversRead: true };
    case 'catalog.icon':
      return { dataUrl: null };
    case 'catalog.pluginIcons':
      return { icons: (input as { plugins: { id: string }[] }).plugins.map(({ id }) => ({ id, iconUrl: null })) };
    case 'catalog.postures':
      return { servers: servers.map((s) => ({ name: s.name, scope: s.scope, path: s.path, authPosture: 'auth_required', fingerprint: 'print-1', revision: null, iconUrl: null })) };
    case 'session.mcpStatus':
      return { mcpServers: [] };
    case 'connectors.signInCancel':
      return { cancelled: true };
    case 'plugins.disable':
    case 'plugins.uninstall':
    case 'connectors.remove':
    case 'connectors.signIn': {
      const opId = `op-${++opSeq}`;
      if (name === 'connectors.signIn') {
        if (holdReceipt.has(name)) return new Promise((resolve) => held.set(name, () => resolve({ opId })));
        return { opId };
      }
      const event = (outcome: unknown = { ok: true, result: { message: `${ACTION_OF[name]} done` } }, reload?: unknown) => ({ opId, action: ACTION_OF[name], target: 'x', phase: 'done', outcome, ...(reload !== undefined && { reload }) });
      if (holdDone.has(name)) held.set(name, (outcome, reload) => emit('plugins.operation', event(outcome ?? undefined, reload)));
      else queueMicrotask(() => deliver('plugins.operation', event()));
      return { opId };
    }
    default:
      throw new Error(`unscripted ${name}`);
  }
}

beforeEach(() => {
  calls = [];
  listeners = new Map();
  held = new Map();
  holdReceipt = new Set();
  holdDone = new Set();
  installed = [BUOY, KEEL, ANCHOR];
  listAnswer = null;
  inventoryAnswer = null;
  skills = SKILLS;
  servers = [TIDES, RADIO];
  mods = [MOD];
  opSeq = 0;
  const bridge: PreloadBridge = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      try {
        return { ok: true, value: await answer(name, input) };
      } catch (error) {
        return { ok: false, error: { code: 'invalid_input', message: (error as Error).message } };
      }
    }) as PreloadBridge['invoke'],
    on: ((name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => void set.delete(listener);
    }) as PreloadBridge['on'],
    pathForFile: () => '',
  };
  window.maws = bridge;
  useSessions.setState({ projects: new Map([[A, project(A, 0, { name: 'Quay', directory: QUAY })]]), records: new Map(), engine: new Map() });
  useCustomizeProject.setState({ projectId: A }, true);
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
});
afterEach(() => {
  cleanup();
  forgetKeptOperations();
  resetSignIns();
  resetCatalogStore();
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useCustomizeProject.setState({ projectId: undefined }, true);
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useCustomizePage.setState(useCustomizePage.getInitialState(), true);
  delete (window as { maws?: PreloadBridge }).maws;
});

const header = () => document.querySelector<HTMLElement>('[data-customize-header]')!;
const tools = () => header().querySelector<HTMLElement>('[data-customize-tools]');
const chooseShow = (name: 'All' | 'Plugins' | 'Skills' | 'Connectors') => fireEvent.click(within(within(header()).getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name }));
const search = (text: string) => fireEvent.change(within(tools()!).getByRole('searchbox', { name: /^Search / }), { target: { value: text } });
const where = () => useLayout.getState().destination;
const list = () => document.querySelector<HTMLElement>('[data-customize-all]')!;
const part = (kind: 'plugins' | 'skills' | 'connectors') => list().querySelector<HTMLElement>(`[data-all-part="${kind}"]`)!;
const sheet = () => document.querySelector<HTMLElement>('[data-plugins-sheet]')!;
const resolved = () => waitFor(() => expect(sheet().querySelector('[data-plugins-details]')).toBeTruthy());
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
// Each row of the list by what it is, in the order drawn.
const rows = () =>
  [...list().querySelectorAll<HTMLElement>('li')].map((li) => {
    const kind = li.querySelector('[data-kind-word]')?.textContent;
    const name = li.getAttribute('data-plugin-row') ?? li.getAttribute('data-mod-row') ?? li.getAttribute('data-skill-row') ?? li.getAttribute('data-connector');
    return `${kind} ${name}`;
  });
const ALL_ROWS = ['Plugin anchor-chart@harbour-market', 'Plugin buoy-log@harbour-market', 'Mod maws.to-human', 'Skill chart-reader', 'Skill mooring-check', 'Skill tide-tables', 'Connector harbour-radio', 'Connector tides'];
const drawn = () => waitFor(() => expect(rows()).toEqual(ALL_ROWS));
const menu = (id: string, item: string) => {
  fireEvent.keyDown(within(document.querySelector<HTMLElement>(`[data-plugin-row="${CSS.escape(id)}"]`)!).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};
const NOT_REFLECTED = { sessions: [{ appSessionId: 'quay-live', outcome: 'not_reflected', error: null }] };
// A ready session MAWS runs in the page's folder: the page's attachment, whose reloads a plugin's line offers.
const attachLive = () => {
  const live = { ...status('quay-live'), appSessionId: at('quay-live' as AppSessionId), cwd: QUAY };
  useSessions.setState({ engine: new Map([[live.appSessionId, live]]) });
};

describe('My items, All', () => {
  it('lists the plugins, then the mods, the skills and the connectors, each part by name, each row ending in its kind word in one column; no heading, loaded line, live list or kind’s menu', async () => {
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    // the kind word is the cell before each row's last control: a plugin's menu, the mod's switch, else an empty cell
    // of that control's width, so the words stand in one column
    const words = [...list().querySelectorAll<HTMLElement>('[data-kind-word]')];
    expect(words).toHaveLength(8);
    for (const word of words) {
      const row = word.closest('li')!;
      expect(word.parentElement).toBe(row);
      expect(word.nextElementSibling).toBe(row.lastElementChild);
      expect(word.className).toBe(words[0]!.className);
    }
    expect(words[2]!.nextElementSibling!.getAttribute('role')).toBe('switch');
    expect(words[3]!.nextElementSibling!.getAttribute('aria-hidden')).toBe('true');
    expect(words[7]!.nextElementSibling!.getAttribute('aria-hidden')).toBe('true');
    expect(list().querySelector('h2, h3, h4, [data-plugins-group], [data-skills-group]')).toBeNull();
    expect(document.querySelector('[data-plugins-loaded], [data-plugins-session-unavailable]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Live connectors' })).toBeNull();
    expect(screen.queryByText(CONNECTORS.noLive)).toBeNull();
    for (const name of ['Filter', 'Sort by', 'Add']) expect(screen.queryByRole('button', { name })).toBeNull();
    // the inventory's folded notes stand under the list
    const coverage = screen.getByText('Inventory coverage');
    expect(part('connectors').compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a plugin’s menu opens its sheet from All and its line reads on the row, with Reload again; a connector’s line offers none', async () => {
    attachLive();
    holdDone.add('plugins.disable');
    holdDone.add('connectors.remove');
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    menu('buoy-log@harbour-market', 'Turn off');
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(invoked('plugins.disable')).toEqual([{ cwd: QUAY, binary: BINARY, plugin: 'buoy-log@harbour-market', scope: 'user' }]));
    act(() => held.get('plugins.disable')!(undefined, NOT_REFLECTED));
    const buoy = () => document.querySelector<HTMLElement>('[data-plugin-row="buoy-log@harbour-market"]')!;
    await waitFor(() => expect(within(buoy()).getByRole('status').textContent).toContain('not reflected'));
    expect(within(buoy()).getByRole('button', { name: 'Reload again' })).toBeTruthy();

    fireEvent.click(within(part('connectors')).getByRole('button', { name: 'Remove tides' }));
    const removal = await screen.findByRole('dialog', { name: 'Remove tides?' });
    await within(removal).findByRole('button', { name: 'Details' });
    fireEvent.click(within(removal).getByRole('checkbox'));
    fireEvent.click(within(removal).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoked('connectors.remove')).toEqual([{ cwd: QUAY, binary: BINARY, name: 'tides', scope: 'user' }]));
    act(() => held.get('connectors.remove')!(undefined, NOT_REFLECTED));
    const tides = () => part('connectors').querySelector<HTMLElement>('[data-connector="tides"]')!;
    await waitFor(() => expect(tides().textContent).toContain('not reflected'));
    expect(within(part('connectors')).queryByRole('button', { name: 'Reload again' })).toBeNull();
  });

  it('a result whose row has left stands at the head of its kind’s part: an uninstall’s, a removal’s', async () => {
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    menu('buoy-log@harbour-market', 'Uninstall…');
    await resolved();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(invoked('plugins.uninstall')).toHaveLength(1));
    fireEvent.click(within(part('connectors')).getByRole('button', { name: 'Remove harbour-radio' }));
    const removal = await screen.findByRole('dialog', { name: 'Remove harbour-radio?' });
    await within(removal).findByRole('button', { name: 'Details' });
    fireEvent.click(within(removal).getByRole('checkbox'));
    fireEvent.click(within(removal).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoked('connectors.remove')).toHaveLength(1));
    installed = [ANCHOR, KEEL];
    servers = [TIDES];
    emit('plugins.changed', {});
    await waitFor(() => expect(rows()).toEqual(['Plugin anchor-chart@harbour-market', 'Mod maws.to-human', 'Skill chart-reader', 'Skill mooring-check', 'Skill tide-tables', 'Connector tides']));
    const uninstalled = part('plugins').firstElementChild!;
    expect(uninstalled.getAttribute('data-plugin-result')).toBe('buoy-log@harbour-market');
    await waitFor(() => expect(within(uninstalled as HTMLElement).getByRole('status').textContent).toBe('uninstall done'));
    const removed = part('connectors').firstElementChild!;
    expect(removed.hasAttribute('data-connector-gone')).toBe(true);
    expect(removed.firstElementChild!.textContent).toBe('harbour-radio');
  });

  it('a skill’s row and a plugin’s open their detail in the list’s place, with no tools; Back returns to All with its scroll and the keyboard on the row', async () => {
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    let top = 0;
    Object.defineProperty(list(), 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = value) });
    top = 140;
    fireEvent.click(within(list()).getByRole('button', { name: 'View mooring-check' }));
    const detail = await found('[data-skill-detail="mooring-check"]');
    expect(tools()).toBeNull();
    expect(list().closest('.hidden')).not.toBeNull(); // the list is kept beneath the detail
    top = 0; // a hidden element loses its scroll
    fireEvent.click(within(detail).getByRole('button', { name: /^Back to / }));
    await waitFor(() => expect(document.querySelector('[data-skill-detail]')).toBeNull());
    expect(top).toBe(140);
    expect(document.activeElement?.closest('[data-skill-row="mooring-check"]')).not.toBeNull();
    expect(tools()).not.toBeNull();

    fireEvent.click(within(list()).getByRole('button', { name: 'View Anchor chart' }));
    expect((await found('[data-plugin-detail]')).getAttribute('data-plugin-detail')).toBe('anchor-chart@harbour-market');
    expect(tools()).toBeNull();
    chooseShow('All'); // the Show value shown: the list again
    await waitFor(() => expect(document.querySelector('[data-plugin-detail]')).toBeNull());
    expect(document.activeElement?.closest('[data-plugin-row="anchor-chart@harbour-market"]')).not.toBeNull();
  });

  it('the search narrows each part by its kind’s own rule and keeps its text across Show; a text that matches nothing reads so, with Reset', async () => {
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    search('anchor'); // a plugin by its name, a skill by its plugin's badge
    expect(rows()).toEqual(['Plugin anchor-chart@harbour-market', 'Skill chart-reader']);
    search('tide'); // skills by name and description, a connector by its name
    expect(rows()).toEqual(['Skill mooring-check', 'Skill tide-tables', 'Connector tides']);
    search('mark what'); // a mod by its description
    expect(rows()).toEqual(['Mod maws.to-human']);
    search('radio');
    chooseShow('Connectors');
    expect(within(tools()!).getByRole('searchbox', { name: 'Search connectors' })).toHaveProperty('value', 'radio');
    chooseShow('All');
    expect(within(tools()!).getByRole('searchbox', { name: 'Search my items' })).toHaveProperty('value', 'radio');
    await waitFor(() => expect(rows()).toEqual(['Connector harbour-radio']));
    search('nothing like this');
    expect(rows()).toEqual([]);
    const none = within(list()).getByRole('status');
    expect(none.textContent).toContain('Nothing matches these filters.');
    fireEvent.click(within(none).getByRole('button', { name: 'Reset filters' }));
    expect(useCustomizePage.getState().search).toBe('');
    expect(rows()).toEqual(ALL_ROWS);
  });

  it('held open: the plugin list out draws the skills and connectors with the plugins’ place empty; its failure then stands there with Retry, the other parts unmoved', async () => {
    let fail!: (error: Error) => void;
    listAnswer = new Promise((_, reject) => (fail = reject));
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(rows()).toEqual(['Skill chart-reader', 'Skill mooring-check', 'Skill tide-tables', 'Connector harbour-radio', 'Connector tides']));
    expect(part('plugins').childElementCount).toBe(0);
    expect(document.querySelector('[data-mod-row]')).toBeNull();
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
    const skillRow = list().querySelector('[data-skill-row="tide-tables"]');
    const connectorRow = list().querySelector('[data-connector="tides"]');
    await act(async () => fail(new Error('The plugin list could not be read')));
    const failure = await waitFor(() => within(part('plugins')).getByRole('alert'));
    expect(failure.textContent).toContain("Couldn't load your plugins.");
    expect(failure.textContent).toContain('The plugin list could not be read');
    expect(rows()).toEqual(['Mod maws.to-human', 'Skill chart-reader', 'Skill mooring-check', 'Skill tide-tables', 'Connector harbour-radio', 'Connector tides']); // the mods under it
    expect(list().querySelector('[data-skill-row="tide-tables"]')).toBe(skillRow);
    expect(list().querySelector('[data-connector="tides"]')).toBe(connectorRow);
    listAnswer = null;
    const asked = invoked('plugins.list').length;
    fireEvent.click(within(failure).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(invoked('plugins.list').length).toBe(asked + 1));
    await drawn();
  });

  it('held open: the inventory failing shows its line once, in the skills’ place, with the plugins above it', async () => {
    let fail!: (error: Error) => void;
    inventoryAnswer = new Promise((_, reject) => (fail = reject));
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(rows()).toEqual(['Plugin anchor-chart@harbour-market', 'Plugin buoy-log@harbour-market', 'Mod maws.to-human']));
    expect(within(part('skills')).getByRole('status').textContent).toBe('Reading configuration…');
    await act(async () => fail(new Error('The configuration could not be read')));
    const alerts = await waitFor(() => {
      const shown = screen.getAllByRole('alert');
      expect(shown).toHaveLength(1);
      return shown;
    });
    expect(part('skills').contains(alerts[0]!)).toBe(true);
    expect(alerts[0]!.textContent).toContain('The configuration could not be read');
    expect(part('plugins').compareDocumentPosition(alerts[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows()).toEqual(['Plugin anchor-chart@harbour-market', 'Plugin buoy-log@harbour-market', 'Mod maws.to-human']);
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
  });

  it('with nothing installed or configured, and only once every read has answered, reads “Nothing here yet.” with no mod beside it; its button opens Discover with All kept', async () => {
    installed = [KEEL];
    skills = [];
    servers = [];
    let release!: () => void;
    listAnswer = new Promise((resolve) => (release = () => resolve({ plugins: installed })));
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(invoked('customization.inventory')).toHaveLength(1));
    await waitFor(() => expect(invoked('mods.list').length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByText('Nothing here yet.')).toBeNull(); // the plugin list is out
    await act(async () => release());
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('Find plugins, skills and connectors in Discover.')).toBeTruthy();
    expect(document.querySelector('[data-mod-row], [data-plugin-row]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Discover' }));
    expect(where()).toEqual({ kind: 'customize', view: 'discover', show: 'all' });
  });

  it('on an empty place a search, even one that names a mod, draws no mod and reads “Nothing matches these filters.” with Reset; on a place with items it finds the mod', async () => {
    installed = [KEEL];
    skills = [];
    servers = [];
    mountCustomize({ view: 'mine', show: 'all' });
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
    for (const text of ['To-human', 'nothing like this']) {
      search(text);
      await act(async () => {});
      expect(document.querySelector('[data-mod-row]'), text).toBeNull();
      expect(screen.queryByText('Nothing here yet.'), text).toBeNull();
      expect(within(list()).getByRole('status').textContent, text).toContain('Nothing matches these filters.');
    }
    fireEvent.click(within(within(list()).getByRole('status')).getByRole('button', { name: 'Reset filters' }));
    expect(useCustomizePage.getState().search).toBe('');
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(document.querySelector('[data-mod-row]')).toBeNull();
    cleanup();
    useCustomizePage.setState({ search: '' });
    skills = [SKILLS[0]!];
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(rows()).toEqual(['Mod maws.to-human', 'Skill tide-tables']));
    search('To-human');
    expect(rows()).toEqual(['Mod maws.to-human']);
  });

  // An empty answer, then a Refresh whose read fails: a read in error has not answered with nothing, so its part's state
  // stands in place of the empty state.
  for (const failing of ['plugins', 'inventory'] as const)
    it(`held open: after an empty answer, a Refresh whose ${failing === 'plugins' ? 'plugin list' : 'inventory'} read fails shows that read’s failure, not the empty state`, async () => {
      installed = [KEEL];
      skills = [];
      servers = [];
      mountCustomize({ view: 'mine', show: 'all' });
      expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
      const rejected = Promise.reject(new Error(`The ${failing} read failed`));
      rejected.catch(() => {});
      if (failing === 'plugins') listAnswer = rejected;
      else inventoryAnswer = rejected;
      fireEvent.click(within(tools()!).getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(screen.queryByText('Nothing here yet.')).toBeNull());
      const at = part(failing === 'plugins' ? 'plugins' : 'skills');
      await waitFor(() => expect(at.textContent).toContain(`The ${failing} read failed`));
      expect(document.querySelector('[data-mod-row]') !== null).toBe(failing === 'plugins'); // the mods stand under the plugins' failure, never beside nothing
      if (failing === 'inventory') {
        const retry = within(within(at).getByRole('alert')).getByRole('button', { name: 'Retry' });
        inventoryAnswer = null;
        fireEvent.click(retry);
        expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
      }
    });

  it('Back from the second of two skills of one name returns the keyboard to that row', async () => {
    skills = [skill('tide-tables', 'project', 'Reads the tides'), { ...skill('tide-tables', 'user', 'Reads the tides at home'), path: `${HOME}/skills/tide-tables/SKILL.md` }];
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(within(list()).getAllByRole('button', { name: 'View tide-tables' })).toHaveLength(2));
    const second = within(list()).getAllByRole('button', { name: 'View tide-tables' })[1]!;
    const secondRow = second.closest('li')!;
    fireEvent.click(second);
    const detail = await found('[data-skill-detail="tide-tables"]');
    expect(detail.textContent).toContain('Reads the tides at home');
    fireEvent.click(within(detail).getByRole('button', { name: /^Back to / }));
    await waitFor(() => expect(document.querySelector('[data-skill-detail]')).toBeNull());
    expect(document.activeElement?.closest('li')).toBe(secondRow);
  });

  it('beside one skill alone the mods are drawn', async () => {
    installed = [];
    skills = [SKILLS[0]!];
    servers = [];
    mountCustomize({ view: 'mine', show: 'all' });
    await waitFor(() => expect(rows()).toEqual(['Mod maws.to-human', 'Skill tide-tables']));
  });

  it('held open: a sign-in started under Connectors reads its steps on the row under All, and Cancel there reaches it', async () => {
    const signer = { ...status('quay-signer'), appSessionId: at('quay-signer' as AppSessionId), cwd: QUAY };
    useSessions.setState({ engine: new Map([[signer.appSessionId, signer]]) });
    holdReceipt.add('connectors.signIn');
    mountCustomize({ view: 'mine', show: 'connectors' });
    fireEvent.click(await within(await found('[data-connector="tides"]')).findByRole('button', { name: 'Sign in to tides' }));
    await waitFor(() => expect(held.has('connectors.signIn')).toBe(true));
    const changed = (state: ConnectorSignInChanged['state']) => act(() => heard({ opId: 'op-1', name: 'tides', state, reason: null, message: null, where: null }));
    changed('starting'); // before the receipt
    chooseShow('All');
    await drawn();
    await act(async () => held.get('connectors.signIn')!());
    changed('waiting_callback');
    const row = () => part('connectors').querySelector<HTMLElement>('[data-connector="tides"]')!;
    await waitFor(() => expect(within(row()).getByText('Finish signing in in your browser…')).toBeTruthy());
    fireEvent.click(within(row()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(invoked('connectors.signInCancel')).toEqual([{ opId: 'op-1' }]));
    chooseShow('Connectors');
    expect(await screen.findByText('Finish signing in in your browser…')).toBeTruthy();
  });

  it('a connector’s Sign in works from All', async () => {
    attachLive();
    mountCustomize({ view: 'mine', show: 'all' });
    await drawn();
    fireEvent.click(await within(part('connectors')).findByRole('button', { name: 'Sign in to tides' }));
    await waitFor(() => expect(invoked('connectors.signIn')).toHaveLength(1));
    expect(invoked('connectors.signIn')).toEqual([{ name: 'tides', scope: 'user', cwd: QUAY, path: TIDES.path, appSessionId: 'quay-live' }]); // the session's local id: the command is this Mac's
  });
});
