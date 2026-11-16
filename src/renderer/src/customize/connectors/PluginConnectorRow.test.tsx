// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M3, §E, §G; Acceptance H1 to H7):
// a connector that an installed plugin's files declare is listed in My items under Connectors and under All as
// "<server> · from <plugin>", with no session running; its state's place reads why nothing will load or match it where
// that holds, and Sign in is offered only through a session the rule admits, once the plugin list has answered; a retained
// sign-in gives words, never the action.
// What the page is answered comes from the real derivations (../../test-support/plugin-connectors.ts): the engine host's
// readers over a scratch config home of invented plugins, main's postures over its endpoints, and each session's status
// as the engine host's tracker derives it from a `system/init` shaped as 2.1.322 sends it. No engine runs, nothing signs in.
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { project } from '../../../../../test/support/builders';
import { at } from '../../../../../test/support/machine';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../../test/support/widget-backend';
import { resetCatalogStore } from '../../stores/catalog';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { mountCustomize } from '../../test-support/customize-page';
import { loaded, pluginScene, reportingStatus, served, type PluginScene, type ScenePlugin } from '../../test-support/plugin-connectors';
import { useLibraryStore } from '../../widgets/plugins/library-store';
import { forgetKeptOperations } from '../../widgets/plugins/operation';
import { useReadLoads } from '../../widgets/read';
import { useCustomizeProject } from '../open';
import { useCustomizePage, useOpenRequest } from '../page';
import { heard, resetSignIns, useSignIns } from './sign-in';

const P = at('project-tides' as ProjectId);
const KEY = 'tide-tables@harbour-market';
const MANIFEST = 'mani-tides';
const NAME = `plugin:${MANIFEST}:tides-http`;
const TIDES_URL = 'https://tides.example.com/mcp';
const TIDES: ScenePlugin = { key: KEY, manifest: MANIFEST, servers: { 'tides-http': { type: 'http', url: TIDES_URL } } };
const SIGN_IN = 'Sign in to tides-http';
const COLLISION = (names: string) => `More than one plugin supplies a connector with this name (${names}). Claude Code keeps only one. Turn the others off to sign in.`;

// A plugin as `plugins.list` answers it (the CLI's listing from the page's folder): its key is its id
const listed = (key: string, over: Record<string, unknown> = {}) => {
  const name = key.slice(0, key.lastIndexOf('@'));
  return { id: key, name, marketplace: key.slice(key.lastIndexOf('@') + 1), version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/config/plugins/cache/${name}`, errors: [], notes: [], installedAt: null, lastUpdated: null, here: false, coversHere: true, projectEnabled: false, ...over };
};

let backend: WidgetBackend;
let scenes: PluginScene[];
let answered: Pick<PluginScene, 'inventory' | 'postures'> | null;
let pluginList: () => unknown;
let live: Map<string, unknown[]>; // each session's mcp_status entries, by its bare id
let client: QueryClient;

beforeEach(() => {
  scenes = [];
  answered = null;
  live = new Map();
  pluginList = () => ({ plugins: [listed(KEY)] });
  backend = createWidgetBackend({ root: process.cwd(), statuses: [] });
  backend.script('customization.inventory', () => answered!.inventory);
  backend.script('catalog.postures', () => answered!.postures);
  backend.script('plugins.env', () => ({ binary: null, binaryError: 'Unavailable', configHome: '/config', globalConfig: '/config/.claude.json' }));
  backend.script('plugins.list', () => pluginList());
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('plugins.manifest', () => ({ manifests: [] }));
  backend.script('plugins.available', () => ({ plugins: [] }));
  backend.script('mods.list', () => []);
  backend.script('catalog.icon', () => ({ dataUrl: null }));
  backend.script('catalog.pluginIcons', (input) => ({ icons: (input as { plugins: { id: string }[] }).plugins.map(({ id }) => ({ id, iconUrl: null })) }));
  backend.script('session.mcpStatus', (input) => ({ mcpServers: live.get((input as { appSessionId: string }).appSessionId) ?? [] }));
  backend.script('connectors.signInDynamicServer', () => ({ opId: 'op-1' }));
  backend.script('connectors.signInCancel', () => ({ cancelled: true }));
  window.maws = backend.bridge();
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
});
afterEach(async () => {
  cleanup();
  forgetKeptOperations();
  resetSignIns();
  resetCatalogStore();
  useReadLoads.setState({ loads: new Map() });
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useCustomizeProject.setState({ projectId: undefined }, true);
  useCustomizePage.setState(useCustomizePage.getInitialState(), true);
  useOpenRequest.setState({ request: null });
  delete (window as { maws?: PreloadBridge }).maws;
  await Promise.all(scenes.map((scene) => scene.done()));
});

/** The page's folder holding these plugins, answered as the engine host and main would answer it. */
async function sceneOf(plugins: ScenePlugin[], opts: Parameters<typeof pluginScene>[1] = { posture: { 'tides-http': 'auth_required' } }): Promise<PluginScene> {
  const scene = await pluginScene(plugins, opts);
  scenes.push(scene);
  answered = { inventory: scene.inventory, postures: scene.postures };
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'Tides', directory: scene.cwd })]]), records: new Map(), engine: new Map() });
  useCustomizeProject.setState({ projectId: P }, true);
  return scene;
}
const sessions = (...statuses: EngineSessionStatus[]) => useSessions.setState({ engine: new Map(statuses.map((s) => [s.appSessionId, s])) });
const mount = (show: 'connectors' | 'all' = 'connectors') => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mountCustomize({ view: 'mine', show }, client);
};
/** The inventory and the plugin list read again, as after a change of what is installed (the postures follow the
 * inventory's answer). */
const readAgain = () => act(() => Promise.all([client.invalidateQueries({ queryKey: ['maws', 'customization.inventory'] }), client.invalidateQueries({ queryKey: ['maws', 'plugins.list'] })]).then(() => undefined));
const header = () => document.querySelector<HTMLElement>('[data-customize-header]')!;
const chooseShow = (name: 'All' | 'Connectors') => fireEvent.click(within(within(header()).getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name }));
const search = (text: string) => fireEvent.change(within(header()).getByRole('searchbox', { name: /^Search / }), { target: { value: text } });
const rowOf = (server: string, plugin = KEY) =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-connector="${server}"][data-connector-plugin="${plugin}"]`);
    expect(found).not.toBeNull();
    return found!;
  });
const stateOf = (row: HTMLElement) => row.querySelector('[data-sign-in-state]')?.textContent ?? null;
const reads = (row: HTMLElement, text: string | null) => waitFor(() => expect(stateOf(row)).toBe(text));
const signIn = (row: HTMLElement) => within(row).queryByRole('button', { name: SIGN_IN });
const asked = (command: string) => backend.calls.filter((call) => call.command === command).map((call) => call.input);
const revisionOf = (scene: Pick<PluginScene, 'postures'>, server = 'tides-http') => scene.postures.plugins.find((row) => row.server === server)!.revision!;
const changed = (state: ConnectorSignInChanged['state'], over: Partial<ConnectorSignInChanged> = {}) => act(() => heard({ opId: 'op-1', name: NAME, state, reason: null, message: null, where: null, ...over }));
/** A ready session in `cwd` whose system/init listed these plugins and the tides server needing a sign-in. */
const holding = (bare: string, cwd: string, plugins: ReturnType<typeof loaded>[] | null = [loaded(KEY, MANIFEST)], state = 'needs-auth') => {
  if (plugins !== null) live.set(bare, [served(NAME, TIDES_URL, state)]);
  return reportingStatus(bare, cwd, { plugins, servers: plugins === null ? [] : [[NAME, state]] });
};

describe('a plugin’s connector in My items (UX wave U11h)', () => {
  it('is listed under Connectors with no session as its server · from its plugin, with its image, no scope word, no file line and no Remove; from opens the plugin’s detail', async () => {
    const scene = await sceneOf([TIDES]);
    mount();
    const row = await rowOf('tides-http');
    expect(row.getAttribute('data-connector-scope')).toBe('plugin');
    const main = row.querySelector<HTMLElement>('[data-connector-main]')!;
    await waitFor(() => expect(within(main).getByRole('button', { name: 'from Tide tables' })).toBeTruthy());
    expect(main.textContent).toContain('tides-http');
    expect(main.textContent).toContain('· http');
    expect(row.textContent).not.toMatch(/scope/);
    expect(row.textContent).not.toContain(scene.cwd); // no file line: the declaring file is the plugin's
    expect(row.textContent).not.toContain('.mcp.json');
    expect(within(row).queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect([row.querySelector('[data-item-image]')?.getAttribute('data-item-kind'), row.querySelector('[data-item-image]')?.textContent]).toEqual(['connector', 'T']);
    expect(await within(row).findByText('Open a session, then sign in')).toBeTruthy();
    expect(signIn(row)).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: 'from Tide tables' }));
    expect(useLayout.getState().destination).toMatchObject({ kind: 'customize', view: 'mine', show: 'plugins' });
    await waitFor(() => expect(document.querySelector(`[data-plugin-detail="${KEY}"]`)).not.toBeNull()); // its detail, once My items lists it
  });

  it('under All carries the word Connector and stands among the configured rows by the name it shows', async () => {
    await sceneOf([{ key: KEY, manifest: MANIFEST, servers: { 'harbour-radio': { type: 'sse', url: 'https://radio.example.com/sse' } } }], { configured: { anchor: { type: 'http', url: 'https://anchor.example.com/mcp' }, zephyr: { type: 'http', url: 'https://zephyr.example.com/mcp' } } });
    mount('all');
    const row = await rowOf('harbour-radio');
    expect(row.querySelector('[data-kind-word]')?.textContent).toBe('Connector');
    const part = document.querySelector<HTMLElement>('[data-all-part="connectors"]')!;
    expect([...part.querySelectorAll('li[data-connector]')].map((li) => li.getAttribute('data-connector'))).toEqual(['anchor', 'harbour-radio', 'zephyr']);
  });

  it('says in its state’s place why nothing will load it or match it, with no Sign in: its plugin’s name unread, a configured server’s address, its plugin turned off, a name past 128 characters, an address set when a chat starts; the first that holds where two do', async () => {
    const LONG = `mani-${'p'.repeat(90)}`;
    await sceneOf(
      [
        { key: 'nameless@harbour-market', manifest: null, servers: { 'tides-http': { type: 'http', url: 'https://anchor.example.com/mcp' } } }, // unread name and a configured address: the first holds
        { key: 'echo@harbour-market', manifest: 'mani-echo', servers: { echo: { type: 'http', url: 'https://anchor.example.com/mcp' } } },
        { key: 'dim@harbour-market', manifest: 'mani-dim', servers: { dim: { type: 'http', url: 'https://dim.example.com/mcp' } } },
        { key: 'long@harbour-market', manifest: LONG, servers: { [`srv-${'s'.repeat(40)}`]: { type: 'http', url: 'https://long.example.com/mcp' } } },
        { key: 'later@harbour-market', manifest: 'mani-later', servers: { later: { type: 'http', url: 'https://${HOST}/mcp' } } },
      ],
      { configured: { anchor: { type: 'http', url: 'https://anchor.example.com/mcp' } }, posture: {} },
    );
    pluginList = () => ({ plugins: ['nameless@harbour-market', 'echo@harbour-market', 'long@harbour-market', 'later@harbour-market'].map((key) => listed(key)).concat([listed('dim@harbour-market', { enabled: false })]) });
    mount();
    const lines: [string, string, string][] = [
      ['tides-http', 'nameless@harbour-market', 'Its plugin’s name can’t be read, so it can’t be matched to a session.'],
      ['echo', 'echo@harbour-market', 'Not loaded: same address as anchor'],
      ['dim', 'dim@harbour-market', 'Plugin turned off'],
      [`srv-${'s'.repeat(40)}`, 'long@harbour-market', 'Its name is too long to sign in from MAWS.'],
      ['later', 'later@harbour-market', 'Its address is set when a chat starts. Sign in from that chat’s Connectors dialog.'],
    ];
    for (const [server, plugin, text] of lines) {
      const row = await rowOf(server, plugin);
      await reads(row, text);
      expect(within(row).queryByRole('button', { name: `Sign in to ${server}` })).toBeNull();
      expect(row.querySelector('[data-sign-in-needs-session]')).toBeNull();
    }
  });

  it('two plugins of one manifest name: before any session both rows read the collision’s line naming both, with no Sign in', async () => {
    const CHART = 'tide-chart@far-harbour';
    await sceneOf([TIDES, { key: CHART, manifest: MANIFEST, servers: { 'tides-http': { type: 'http', url: 'https://far-tides.example.com/mcp' } } }]);
    pluginList = () => ({ plugins: [listed(KEY), listed(CHART)] });
    mount();
    for (const plugin of [KEY, CHART]) {
      const row = await rowOf('tides-http', plugin);
      await reads(row, COLLISION('Tide chart, Tide tables')); // in the inventory's order of its plugins
      expect(signIn(row)).toBeNull();
    }
  });

  it('the colon pair: a plugin whose manifest name holds a colon owns the prefix of another’s connector though it declares none, and makes the collision', async () => {
    const ALPHA = 'alpha-tides@harbour-market';
    const ALPHA_BETA = 'alpha-beta@harbour-market';
    await sceneOf([{ key: ALPHA, manifest: 'alpha', servers: { 'beta:gamma': { type: 'http', url: 'https://gamma.example.com/mcp' } } }, { key: ALPHA_BETA, manifest: 'alpha:beta', servers: {} }]);
    pluginList = () => ({ plugins: [listed(ALPHA), listed(ALPHA_BETA)] });
    mount();
    const row = await rowOf('beta:gamma', ALPHA);
    await reads(row, COLLISION('Alpha beta, Alpha tides'));
    expect(within(row).queryByRole('button', { name: 'Sign in to beta:gamma' })).toBeNull();
    // the second plugin turned off here: one possible owner is left, and the line goes
    pluginList = () => ({ plugins: [listed(ALPHA), listed(ALPHA_BETA, { enabled: false })] });
    await readAgain();
    await waitFor(() => expect(row.querySelector('[data-sign-in-needs-session]')?.textContent).toBe('Open a session, then sign in'));
    expect(stateOf(row)).toBeNull();
  });

  it('a session whose own list holds two possible owners: the row reads the collision’s line naming that session’s owners, with no Sign in', async () => {
    await sceneOf([TIDES]);
    sessions(holding('two-owners', '/elsewhere', [loaded(KEY, MANIFEST), loaded('tide-chart@far-harbour', MANIFEST)]));
    mount();
    const row = await rowOf('tides-http');
    await reads(row, COLLISION('Tide tables, tide-chart'));
    expect(signIn(row)).toBeNull();
  });

  it('a session that loaded the name from another plugin, or another version, or has reported no plugins reads its line; a session admitted offers Sign in and sends the engine name and the revision the row was drawn with', async () => {
    const scene = await sceneOf([TIDES]);
    const other = holding('other-plugin', '/elsewhere', [loaded('tide-chart@far-harbour', MANIFEST)]);
    sessions(other);
    mount();
    const row = await rowOf('tides-http');
    await reads(row, 'That session loaded this connector’s name from another plugin.');
    act(() => sessions(holding('other-version', '/elsewhere', [loaded(KEY, MANIFEST, '0.9.0')])));
    await reads(row, 'That session loaded another version of this plugin. Start a new session, then sign in.');
    expect(signIn(row)).toBeNull();
    act(() => sessions(holding('admitted', '/elsewhere'), holding('other-plugin', '/elsewhere', [loaded('tide-chart@far-harbour', MANIFEST)])));
    const button = await within(row).findByRole('button', { name: SIGN_IN });
    expect(stateOf(row)).toBe('Sign in needed');
    fireEvent.click(button);
    await waitFor(() => expect(asked('connectors.signInDynamicServer')).toEqual([{ name: NAME, appSessionId: 'admitted', entry: { revision: revisionOf(scene) } }]));
  });

  it('a session that lists the name but loaded no plugin that owns it reads that line, with no Sign in; among sessions it comes after another version and before no plugins reported', async () => {
    const scene = await sceneOf([TIDES]);
    const absent = holding('absent', '/elsewhere', [loaded('tide-chart@far-harbour', 'mani-other')]);
    const ABSENT = 'That session loaded no plugin that supplies this connector.';
    sessions(absent);
    mount();
    let row = await rowOf('tides-http');
    await reads(row, ABSENT);
    expect(signIn(row)).toBeNull();
    cleanup();
    // with the attached session, which lists the server in its mcp_status and has reported no plugins: absent's line
    live.set('attached', [served(NAME, TIDES_URL)]);
    sessions(reportingStatus('attached', scene.cwd, { plugins: null }), absent);
    mount();
    row = await rowOf('tides-http');
    await waitFor(() => expect(asked('session.mcpStatus')).toContainEqual({ appSessionId: 'attached' }));
    await reads(row, ABSENT);
    cleanup();
    // with a session that loaded another version of the plugin: that line first
    sessions(holding('older', '/elsewhere', [loaded(KEY, MANIFEST, '0.9.0')]), absent);
    mount();
    row = await rowOf('tides-http');
    await reads(row, 'That session loaded another version of this plugin. Start a new session, then sign in.');
    expect(signIn(row)).toBeNull();
  });

  it('held open: while the plugin list is out no Sign in is offered, the admitted session’s state in the dialog’s words and the key’s own name after from; when it answers enabled, Sign in appears with the plugin’s own name', async () => {
    await sceneOf([TIDES]);
    let answer!: (value: unknown) => void;
    pluginList = () => new Promise((resolve) => (answer = resolve));
    sessions(holding('admitted', '/elsewhere'));
    mount();
    const row = await rowOf('tides-http');
    await waitFor(() => expect(asked('catalog.postures')).toHaveLength(1));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'from tide-tables' })).toBeTruthy());
    await reads(row, 'Sign in needed');
    expect(signIn(row)).toBeNull();
    await act(async () => answer({ plugins: [listed(KEY)] }));
    expect(await within(row).findByRole('button', { name: SIGN_IN })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'from Tide tables' })).toBeTruthy();
  });

  it('held open: the plugin list answers the plugin not enabled: Plugin turned off; when it fails: no Sign in, and nothing is thrown', async () => {
    await sceneOf([TIDES]);
    let answer!: (value: unknown) => void;
    pluginList = () => new Promise((resolve) => (answer = resolve));
    sessions(holding('admitted', '/elsewhere'));
    mount();
    const row = await rowOf('tides-http');
    await act(async () => answer({ plugins: [listed(KEY, { enabled: false })] }));
    await reads(row, 'Plugin turned off');
    expect(signIn(row)).toBeNull();
    cleanup();
    pluginList = () => {
      throw new WidgetBackendError({ code: 'internal', message: 'the plugin CLI could not be run' });
    };
    mount();
    const again = await rowOf('tides-http');
    await waitFor(() => expect(asked('plugins.list').length).toBeGreaterThan(1));
    await reads(again, 'Sign in needed');
    expect(signIn(again)).toBeNull();
  });

  it('under Show: Connectors the plugin list is read only when the inventory holds a plugin’s connector', async () => {
    await sceneOf([{ key: KEY, manifest: MANIFEST, servers: {} }], { configured: { anchor: { type: 'http', url: 'https://anchor.example.com/mcp' } } });
    mount();
    await screen.findByText('anchor');
    await waitFor(() => expect(asked('catalog.postures')).toHaveLength(1));
    expect(asked('plugins.list')).toEqual([]);
    cleanup();
    answered = { ...answered!, inventory: { skills: [], servers: answered!.inventory.servers, warnings: [], serversRead: true } }; // an engine host of an earlier build: no pluginServers
    mount();
    await screen.findByText('anchor');
    expect(asked('plugins.list')).toEqual([]);
    cleanup();
    await sceneOf([TIDES]);
    mount();
    await rowOf('tides-http');
    await waitFor(() => expect(asked('plugins.list').length).toBeGreaterThan(0));
  });

  it('the search under Show: Connectors keeps a plugin’s rows by its plugin’s name and by its server’s, and no configured row the text misses', async () => {
    await sceneOf([TIDES], { configured: { anchor: { type: 'http', url: 'https://anchor.example.com/mcp' } }, posture: {} });
    mount();
    await rowOf('tides-http');
    await screen.findByText('anchor');
    const drawn = () => [...document.querySelectorAll('li[data-connector]')].map((li) => li.getAttribute('data-connector'));
    await waitFor(() => expect(within(document.querySelector<HTMLElement>(`[data-connector-plugin="${KEY}"]`)!).getByRole('button', { name: 'from Tide tables' })).toBeTruthy());
    search('tables');
    await waitFor(() => expect(drawn()).toEqual(['tides-http']));
    search('http');
    await waitFor(() => expect(drawn()).toEqual(['tides-http']));
    search('anch');
    await waitFor(() => expect(drawn()).toEqual(['anchor']));
  });

  it('the search under All keeps a plugin’s rows by its plugin’s name and by its server’s, and no configured row the text misses', async () => {
    await sceneOf([TIDES], { configured: { anchor: { type: 'http', url: 'https://anchor.example.com/mcp' } }, posture: {} });
    mount('all');
    await rowOf('tides-http');
    const part = () => document.querySelector<HTMLElement>('[data-all-part="connectors"]')!;
    const drawn = () => [...part().querySelectorAll('li[data-connector]')].map((li) => li.getAttribute('data-connector'));
    await waitFor(() => expect(drawn()).toEqual(['anchor', 'tides-http']));
    search('tables');
    await waitFor(() => expect(drawn()).toEqual(['tides-http']));
    search('tides-h');
    await waitFor(() => expect(drawn()).toEqual(['tides-http']));
  });

  it('held open (H4): the attached session lacks the server and a second session is admitted: Not in the attached session with Sign in, which runs through the second; its steps and Cancel stay across Show; the result reads on the row', async () => {
    const scene = await sceneOf([TIDES]);
    const attached = reportingStatus('attached', scene.cwd, { plugins: [loaded(KEY, MANIFEST)], servers: [] });
    live.set('attached', []);
    sessions(attached, holding('second', '/elsewhere'));
    let receipt!: () => void;
    backend.script('connectors.signInDynamicServer', () => new Promise((resolve) => (receipt = () => resolve({ opId: 'op-1' }))));
    mount();
    const row = await rowOf('tides-http');
    await waitFor(() => expect(asked('session.mcpStatus')).toContainEqual({ appSessionId: 'attached' }));
    await waitFor(() => expect(row.querySelector('[data-not-in-attached]')?.textContent).toBe('Not in the attached session'));
    fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
    await waitFor(() => expect(asked('connectors.signInDynamicServer')).toEqual([{ name: NAME, appSessionId: 'second', entry: { revision: revisionOf(scene) } }]));
    changed('starting'); // main says it before the receipt
    await act(async () => receipt());
    await reads(row, 'Starting sign-in…'); // replayed once the receipt binds it
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    changed('waiting_callback');
    chooseShow('All');
    let shown = await rowOf('tides-http');
    expect(within(shown).getByText('Finish signing in in your browser…')).toBeTruthy();
    chooseShow('Connectors');
    shown = await rowOf('tides-http');
    expect(within(shown).getByText('Finish signing in in your browser…')).toBeTruthy();
    fireEvent.click(within(shown).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(asked('connectors.signInCancel')).toEqual([{ opId: 'op-1' }]));
    changed('done', { where: 'here' });
    await reads(shown, 'Signed in · connected here');
  });

  it('held open: the attached session has reported no plugins and lists the server: its line and no Sign in; when it reports them, Sign in appears with no reload of the page', async () => {
    const scene = await sceneOf([TIDES]);
    sessions(reportingStatus('attached', scene.cwd, { plugins: null }));
    live.set('attached', [served(NAME, TIDES_URL)]); // its mcp_status answers before any system/init
    mount();
    const row = await rowOf('tides-http');
    await reads(row, 'Send a message in that session, then sign in.');
    expect(signIn(row)).toBeNull();
    const inventoryReads = asked('customization.inventory').length;
    act(() => sessions(holding('attached', scene.cwd)));
    expect(await within(row).findByRole('button', { name: SIGN_IN })).toBeTruthy();
    expect(asked('customization.inventory')).toHaveLength(inventoryReads);
  });

  describe('a retained result never gives Sign in back (ruling E)', () => {
    async function signedInFrom(): Promise<{ row: HTMLElement; scene: PluginScene }> {
      const scene = await sceneOf([TIDES]);
      sessions(holding('admitted', '/elsewhere'));
      mount();
      const row = await rowOf('tides-http');
      const before = asked('connectors.signInDynamicServer').length;
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toHaveLength(before + 1));
      return { row, scene };
    }
    const collisionArrives = () => act(() => sessions(holding('admitted', '/elsewhere', [loaded(KEY, MANIFEST), loaded('tide-chart@far-harbour', MANIFEST)])));

    it('a collision arriving while the sign-in runs keeps its step and Cancel; when it ends its result is not shown, the collision’s line is, with no Sign in', async () => {
      const { row } = await signedInFrom();
      changed('waiting_callback');
      collisionArrives();
      await reads(row, 'Finish signing in in your browser…');
      expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(signIn(row)).toBeNull();
      changed('done', { where: 'here' });
      await reads(row, COLLISION('Tide tables, tide-chart'));
      expect(signIn(row)).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('a postures read that fails after an unchanged re-read keeps the retained result, in the row and in the sign-in book; the same revision answered again still shows it', async () => {
      await signedInFrom();
      const row = await rowOf('tides-http');
      changed('done', { where: 'here' });
      await reads(row, 'Signed in · connected here');
      const kept = () => [...useSignIns.getState().byServer.values()].filter((record) => record.event.name === NAME && record.event.state === 'done');
      expect(kept()).toHaveLength(1);
      const answer = answered!.postures;
      backend.script('catalog.postures', () => {
        throw new WidgetBackendError({ code: 'internal', message: 'the directory copy could not be read' });
      });
      await readAgain();
      await waitFor(() => expect(client.getQueryCache().getAll().some((query) => query.queryKey.includes('postures') && query.state.status === 'error')).toBe(true));
      await reads(row, 'Signed in · connected here');
      expect(kept()).toHaveLength(1);
      backend.script('catalog.postures', () => answer); // the same revision again
      const postureReads = asked('catalog.postures').length;
      await readAgain();
      await waitFor(() => expect(asked('catalog.postures').length).toBeGreaterThan(postureReads));
      await waitFor(() => expect(within(row).getByRole('button', { name: SIGN_IN })).toBeTruthy());
      await reads(row, 'Signed in · connected here');
      expect(kept()).toHaveLength(1);
    });

    it('after a failure, and after a cancel, a collision’s line replaces Sign-in didn’t finish, with no Sign in', async () => {
      const { row } = await signedInFrom();
      changed('failed', { reason: 'timeout' });
      await reads(row, 'Sign-in didn’t finish: the browser didn’t return within 5 minutes');
      collisionArrives();
      await reads(row, COLLISION('Tide tables, tide-chart'));
      expect(signIn(row)).toBeNull();
      cleanup();
      resetSignIns();
      const again = await signedInFrom();
      changed('cancelled');
      await reads(again.row, 'Sign-in didn’t finish: cancelled');
      collisionArrives();
      await reads(again.row, COLLISION('Tide tables, tide-chart'));
      expect(signIn(again.row)).toBeNull();
    });

    it('a success yields to Plugin turned off; with nothing blocking a failed record shows its words and Sign in is offered by the table; a changed revision drops the record', async () => {
      const { row } = await signedInFrom();
      changed('done', { where: 'here' });
      await reads(row, 'Signed in · connected here');
      // read again with nothing changed: the revision is the same, and the result stays
      const postureReads = asked('catalog.postures').length;
      await readAgain();
      await waitFor(() => expect(asked('catalog.postures').length).toBeGreaterThan(postureReads));
      await reads(row, 'Signed in · connected here');
      pluginList = () => ({ plugins: [listed(KEY, { enabled: false })] });
      await readAgain();
      await reads(row, 'Plugin turned off');
      expect(signIn(row)).toBeNull();
      cleanup();
      resetSignIns();
      pluginList = () => ({ plugins: [listed(KEY)] });
      const failed = await signedInFrom();
      changed('failed', { reason: 'denied' });
      await reads(failed.row, 'Sign-in didn’t finish: the sign-in was declined');
      expect(signIn(failed.row)).not.toBeNull(); // the table's row 9, not the record
      // the plugin's address moved: the engine host's revision moves with it, and the record is dropped
      answered = await failed.scene.reread({ plugins: [{ ...TIDES, servers: { 'tides-http': { type: 'http', url: 'https://tides.example.com/mcp/v2' } } }] });
      expect(revisionOf(answered)).not.toBe(revisionOf(failed.scene));
      await readAgain();
      await reads(failed.row, 'Sign in needed');
    });
  });

  // The branch panel's rulings (2026-11-16, UTC), finding 1: a session's servers are its latest report, whole. The attached
  // session's own status read, once answered, replaces the list its init frame seeded; the seed counts only while no
  // answer exists. A seed is read again when it moves (an init, or a reload once a plugin changed).
  describe('a session’s servers are its latest report, whole', () => {
    it('a connector the attached session’s answer omits is not read from its init’s list: the session that holds it is admitted', async () => {
      const scene = await sceneOf([TIDES]);
      const attached = reportingStatus('attached', scene.cwd, { plugins: [loaded(KEY, MANIFEST)], servers: [[NAME, 'needs-auth']] });
      live.set('attached', []); // its answer no longer lists the server
      sessions(attached, holding('second', '/elsewhere'));
      mount();
      const row = await rowOf('tides-http');
      await waitFor(() => expect(asked('session.mcpStatus')).toContainEqual({ appSessionId: 'attached' }));
      await waitFor(() => expect(row.querySelector('[data-not-in-attached]')?.textContent).toBe('Not in the attached session'));
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toEqual([{ name: NAME, appSessionId: 'second', entry: { revision: revisionOf(scene) } }]));
    });

    it('a reload after a plugin changed moves the attached session’s list: its status read is asked again, and its answer is the list', async () => {
      const scene = await sceneOf([TIDES]);
      sessions(reportingStatus('attached', scene.cwd, { plugins: [], servers: [] })); // started before the plugin was installed
      live.set('attached', []);
      mount();
      const row = await rowOf('tides-http');
      await reads(row, 'Sign in needed');
      expect(row.querySelector('[data-sign-in-needs-session]')?.textContent).toBe('Open a session, then sign in');
      const statusReads = asked('session.mcpStatus').length;
      // the plugin's install reloads the session: the engine answers its plugins and its servers, the plugin's among them
      live.set('attached', [served(NAME, TIDES_URL)]);
      act(() => sessions(reportingStatus('attached', scene.cwd, { plugins: [], servers: [], reloaded: { plugins: [loaded(KEY, MANIFEST)], servers: [[NAME, 'needs-auth']] } })));
      await waitFor(() => expect(asked('session.mcpStatus').length).toBeGreaterThan(statusReads));
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toEqual([{ name: NAME, appSessionId: 'attached', entry: { revision: revisionOf(scene) } }]));
    });
  });

  // Finding 2: a success is overtaken by a later report, from the session it came through, that the server needs a sign-in
  // or failed; the time is when that session's servers were observed (`pluginsObservedAt`, an init's or a reload's). A
  // report from before the success never overtakes it, and a session the row does not read from is not heard.
  describe('a success through a session that is not the attached one', () => {
    const SUCCESS = Date.parse('2026-11-14T22:40:00.000Z');
    const report = (bare: string, at: string, state = 'needs-auth') => reportingStatus(bare, '/elsewhere', { plugins: [loaded(KEY, MANIFEST)], servers: [[NAME, state]], at });
    async function signedInThrough(where: 'here' | 'new_sessions'): Promise<HTMLElement> {
      await sceneOf([TIDES]);
      sessions(report('admitted', '2026-11-14T22:39:00.000Z'));
      mount();
      const row = await rowOf('tides-http');
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toEqual([expect.objectContaining({ appSessionId: 'admitted' })]));
      act(() => heard({ opId: 'op-1', name: NAME, state: 'done', reason: null, message: null, where }, SUCCESS));
      return row;
    }

    it('a report from that session older than the success leaves it standing; a later one that the server needs a sign-in overtakes it', async () => {
      const row = await signedInThrough('here');
      await reads(row, 'Signed in · connected here');
      act(() => sessions(report('admitted', '2026-11-14T22:39:59.000Z')));
      await reads(row, 'Signed in · connected here');
      act(() => sessions(report('admitted', '2026-11-14T22:41:00.000Z')));
      await reads(row, 'Sign in needed');
      expect(signIn(row)).not.toBeNull();
    });

    it('a later report of a failure overtakes it too; a later report that it is connected keeps it', async () => {
      const row = await signedInThrough('here');
      act(() => sessions(report('admitted', '2026-11-14T22:41:00.000Z', 'connected')));
      await reads(row, 'Signed in · connected here');
      act(() => sessions(report('admitted', '2026-11-14T22:42:00.000Z', 'failed')));
      await reads(row, 'Failed');
    });

    it('a later report from a different session, which the row does not read from, leaves it standing', async () => {
      const row = await signedInThrough('here');
      act(() => sessions(report('admitted', '2026-11-14T22:39:00.000Z'), report('other', '2026-11-14T22:41:00.000Z')));
      await reads(row, 'Signed in · connected here');
      expect(asked('connectors.signInDynamicServer')).toHaveLength(1);
    });

    it('a success for new sessions is not overtaken by its own session’s later report that it needs a sign-in', async () => {
      const row = await signedInThrough('new_sessions');
      const said = stateOf(row);
      expect(said).not.toBeNull();
      act(() => sessions(report('admitted', '2026-11-14T22:41:00.000Z')));
      await reads(row, said);
    });
  });

  // Finding 3: an operation under way is bound to the row it was started on; its step and Cancel stay there until it ends,
  // whatever the row's engine name reads now (§E: "An operation under way shows its step and Cancel, whatever the table
  // says now"). A finished result keeps today's rule: shown only for the revision it was made for.
  describe('a sign-in under way stays on the row it was started on', () => {
    async function waitingOn(change: Partial<ScenePlugin>): Promise<HTMLElement> {
      const scene = await sceneOf([TIDES]);
      sessions(holding('admitted', '/elsewhere'));
      mount();
      const row = await rowOf('tides-http');
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toHaveLength(1));
      changed('waiting_callback');
      await reads(row, 'Finish signing in in your browser…');
      const postureReads = asked('catalog.postures').length;
      answered = await scene.reread({ plugins: [{ ...TIDES, ...change }] });
      expect(revisionOf(answered)).not.toBe(revisionOf(scene));
      await readAgain();
      await waitFor(() => expect(asked('catalog.postures').length).toBeGreaterThan(postureReads));
      return rowOf('tides-http');
    }

    it('its plugin’s manifest becomes unreadable: the step and Cancel stay, Cancel reaches the operation; when it ends the line for the unread name stands', async () => {
      const row = await waitingOn({ manifest: null });
      await reads(row, 'Finish signing in in your browser…');
      fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(asked('connectors.signInCancel')).toEqual([{ opId: 'op-1' }]));
      changed('cancelled');
      await reads(row, 'Its plugin’s name can’t be read, so it can’t be matched to a session.');
      expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
      expect(signIn(row)).toBeNull();
    });

    it('its plugin’s manifest is renamed: the step and Cancel stay; its success is not shown on the row it no longer matches', async () => {
      const row = await waitingOn({ manifest: 'mani-tides-renamed' });
      await reads(row, 'Finish signing in in your browser…');
      expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
      changed('done', { where: 'here' });
      await reads(row, 'Sign in needed');
      expect(row.querySelector('[data-sign-in-needs-session]')?.textContent).toBe('Open a session, then sign in');
      expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
    });
  });

  it('a retained success, and a retained failure, are dropped when the connector becomes a local command: no sign-in words, the local command’s state', async () => {
    for (const ending of ['done', 'failed'] as const) {
      const scene = await sceneOf([TIDES]);
      sessions(holding('admitted', '/elsewhere'));
      mount();
      const row = await rowOf('tides-http');
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
      await waitFor(() => expect(asked('connectors.signInDynamicServer').length).toBeGreaterThan(0));
      if (ending === 'done') changed('done', { where: 'here' });
      else changed('failed', { reason: 'denied' });
      await reads(row, ending === 'done' ? 'Signed in · connected here' : 'Sign-in didn’t finish: the sign-in was declined');
      // the same plugin's server of that name is now a local command: no address, so the engine host answers no revision
      answered = await scene.reread({ plugins: [{ ...TIDES, servers: { 'tides-http': { command: 'tides-local' } } }] });
      expect(answered.postures.plugins.find((p) => p.server === 'tides-http')!.revision).toBeNull();
      act(() => sessions(reportingStatus('admitted', '/elsewhere', { plugins: [loaded(KEY, MANIFEST)], servers: [[NAME, 'connected']] })));
      await readAgain();
      await waitFor(() => expect(row.textContent).toContain('· stdio'));
      await reads(row, 'Connected'); // row 5: the admitted session's status in the dialog's words
      expect(row.textContent).not.toMatch(/Sign/);
      cleanup();
      resetSignIns();
    }
  });

  it('the services’ refusals read after Sign-in didn’t finish; a refused invoke reads the transport’s words', async () => {
    await sceneOf([TIDES]);
    sessions(holding('admitted', '/elsewhere'));
    mount();
    const row = await rowOf('tides-http');
    let op = 0;
    backend.script('connectors.signInDynamicServer', () => ({ opId: `op-${++op}` }));
    for (const message of [
      `that session loaded no plugin that supplies ${NAME}`,
      `more than one plugin in that session supplies ${NAME}; turn the others off, start a new session, then sign in`,
      'Plugins changed while this sign-in started. Try again.',
      `${NAME} changed since this page read it; refresh the page, then sign in`,
    ]) {
      fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN })); // the table offers it again: nothing blocks
      await waitFor(() => expect(asked('connectors.signInDynamicServer')).toHaveLength(op));
      act(() => heard({ opId: `op-${op}`, name: NAME, state: 'failed', reason: 'other_entry', message, where: null }));
      await reads(row, `Sign-in didn’t finish: ${message}`);
    }
    const refused = 'No handler for connectors.signInDynamicServer in this build';
    backend.script('connectors.signInDynamicServer', () => {
      op += 1;
      throw new WidgetBackendError({ code: 'unknown_command', message: refused });
    });
    fireEvent.click(await within(row).findByRole('button', { name: SIGN_IN }));
    await waitFor(() => expect(asked('connectors.signInDynamicServer')).toHaveLength(op));
    expect(op).toBe(5); // a fifth invocation, refused
    await reads(row, `Sign-in didn’t finish: ${refused} · showing the last value it reported`);
  });

  it('a local command’s row reads an admitted session’s status in the dialog’s words, never a sign-in word, and nothing with no admitted session', async () => {
    const CLOCK = `plugin:${MANIFEST}:tide clock`;
    await sceneOf([{ key: KEY, manifest: MANIFEST, servers: { 'tide clock': { command: 'tide-clock' } } }]);
    mount();
    const row = await rowOf('tide clock');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'from Tide tables' })).toBeTruthy());
    expect(stateOf(row)).toBeNull();
    expect(row.querySelector('[data-sign-in-needs-session]')).toBeNull();
    for (const [state, words] of [['connected', 'Connected'], ['failed', 'Failed'], ['pending', 'Connecting…']]) {
      act(() => sessions(reportingStatus('admitted', '/elsewhere', { plugins: [loaded(KEY, MANIFEST)], servers: [[CLOCK, state!]] })));
      await reads(row, words!);
      expect(within(row).queryByRole('button', { name: 'Sign in to tide clock' })).toBeNull();
    }
  });

  it('the coverage note reads the item’s words with pluginServers and today’s without, and neither is listed as a failure', async () => {
    await sceneOf([TIDES]);
    mount();
    fireEvent.click(await screen.findByText('Inventory coverage'));
    expect(screen.getByText('Skills that a marketplace declares but no folder holds, and connectors that a plugin ships as a bundle or in another form MAWS does not read, are not listed; see Plugins.')).toBeTruthy();
    expect(screen.queryByText(CUSTOMIZATION_INVENTORY_COVERAGE)).toBeNull();
    expect(screen.queryByText('Some configuration could not be read')).toBeNull();
    cleanup();
    answered = { ...answered!, inventory: { skills: [], servers: [], warnings: [CUSTOMIZATION_INVENTORY_COVERAGE], serversRead: true } }; // an engine host of an earlier build
    mount();
    fireEvent.click(await screen.findByText('Inventory coverage'));
    expect(screen.getByText(CUSTOMIZATION_INVENTORY_COVERAGE)).toBeTruthy();
    expect(screen.queryByText('Some configuration could not be read')).toBeNull();
  });
});
