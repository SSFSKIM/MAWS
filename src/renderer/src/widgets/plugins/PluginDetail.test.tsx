// The detail on its own (P2-B execution document §5.7): the two facts that never merge, Refresh only from its click
// (A's `useLoadedPlugins().refresh` in shape, acquiring through A's `loadForRead` over a fake bridge), What's inside's
// summary, tabs and states, and the views M2's reader answers for its own fixture trees (an LSP plugin with no
// plugin.json; one whose MCP servers, hooks and monitors carry secrets), rendered with none of their commands, values
// or URLs.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { InstalledPlugin, ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { digest, record } from '../../../../../test/support/builders';
import { readManifestView } from '../../../../engine-host/plugins/manifest';
import type { LoadedPlugins } from '../../sessions/observed';
import { useSessions } from '../../stores/sessions';
import { loadForRead, useReadLoads } from '../read';
import { identitiesOf, installationRef, manifestKeyOf } from './library';
import type { SessionPlugins } from './LoadedLine';
import { ManageProvider, type Manage } from './manage';
import { PluginDetail, type PluginDetailProps } from './PluginDetail';

const ID = 'frontend-design@claude-plugins-official';
const DAY = 86_400_000;
const inst = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/cfg/plugins/cache/${marketplace}/${name}/1.0.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};
const EMPTY: PluginManifestView['components'] = { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] };
const viewOf = (p: InstalledPlugin, over: Partial<PluginManifestView> = {}): PluginManifestView => ({
  key: installationRef(p),
  state: 'read',
  name: p.name,
  displayName: null,
  version: null,
  marketplaceVersion: null,
  description: null,
  author: null,
  license: null,
  keywords: [],
  components: EMPTY,
  partial: false,
  problems: [],
  ...over,
});
const identityOf = (p: InstalledPlugin, view: PluginManifestView | null) => identitiesOf([p], [], view ? new Map([[manifestKeyOf(installationRef(p)), view]]) : new Map(), null)[0];
const SESSION = 'app-detail' as AppSessionId;
const NO_RELOAD: SessionPlugins['reload'] = { line: null, failed: false };
const loadedWith = (sources: string[], freshness: LoadedPlugins['freshness'], refresh: SessionPlugins['refresh'] = () => loadForRead(SESSION)): SessionPlugins => ({
  plugins: sources.map((source) => ({ name: source.split('@')[0], path: `/cfg/${source}`, source, version: null })),
  errors: [],
  warnings: [],
  freshness,
  refresh,
  reload: NO_RELOAD,
});

const manage: Manage = { cwd: '/work/maws', ops: { entries: new Map(), run: async () => null, cancel: () => {} }, ask: vi.fn(), reloadMods: null };

function show(identity: PluginDetailProps['identity'], props: Partial<PluginDetailProps> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManageProvider value={manage}>
        <PluginDetail appSessionId={SESSION} availability="resumable" identity={identity} loaded={loadedWith([], { kind: 'unknown' })} loadedIds={null} reloads={null} listManifests={{ error: null, retry: () => {} }} onBack={() => {}} {...props} />
      </ManageProvider>
    </QueryClientProvider>,
  );
  return document.querySelector<HTMLElement>('[data-plugin-detail]')!;
}
const fact = (which: 'enabled' | 'loaded') => document.querySelector<HTMLElement>(`[data-plugin-fact="${which}"]`)!;

afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map(), digests: new Map() });
  useReadLoads.setState({ loads: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the detail: enabled for this project and loaded in this session', () => {
  it('two lines that never merge: not enabled, and loaded last time with its age', () => {
    const p = inst(ID, { enabled: false });
    const at = new Date(Date.now() - 2 * DAY).toISOString();
    show(identityOf(p, viewOf(p)), { loaded: loadedWith([ID], { kind: 'last', at }), loadedIds: new Set([ID]) });
    expect(fact('enabled').textContent).toBe('Not enabled for this project');
    expect(fact('loaded').textContent).toBe('Loaded in this session · Loaded last time, 2 days ago');
  });

  it('enabled and absent from a known list on a dormant session: Refresh, called once from its click and never on mount', async () => {
    const p = inst(ID);
    let settle: (outcome: AcquireOutcome) => void = () => {};
    const refresh = vi.fn(() => loadForRead(SESSION));
    const invoke = vi.fn((name: string) => (name === 'session.acquire' ? new Promise((resolve) => (settle = (value) => resolve({ ok: true, value }))) : Promise.resolve({ ok: true, value: null })));
    window.maws = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge;
    useSessions.setState({ records: new Map([[SESSION, record(SESSION)]]), digests: new Map([[SESSION, digest(SESSION, { availability: 'resumable' })]]) });
    show(identityOf(p, viewOf(p)), { loaded: loadedWith(['other@x'], { kind: 'last', at: new Date().toISOString() }, refresh), loadedIds: new Set(['other@x']) });
    expect(fact('enabled').textContent).toBe('Enabled for this project');
    expect(within(fact('loaded')).getByText('Not loaded in this session')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(within(fact('loaded')).getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(fact('loaded')).getByRole('status').textContent).toBe('Starting…');
    await act(async () => settle({ status: 'refused', appSessionId: SESSION, reason: 'busy', message: 'The session is busy elsewhere' } as AcquireOutcome));
    await waitFor(() => expect(fact('loaded').textContent).toContain('The session is busy elsewhere'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a Refresh whose reload failed after the start says so under the fact', () => {
    const p = inst(ID);
    useSessions.setState({ records: new Map([[SESSION, record(SESSION)]]), digests: new Map([[SESSION, digest(SESSION, { availability: 'resumable' })]]) });
    const loaded = { ...loadedWith(['other@x'], { kind: 'last', at: new Date().toISOString() }), reload: { line: 'reload_plugins unanswered after 60 s · timeout', failed: true } };
    show(identityOf(p, viewOf(p)), { loaded, loadedIds: new Set(['other@x']) });
    expect(screen.getByRole('alert').textContent).toBe('reload_plugins unanswered after 60 s · timeout');
  });

  it('a session a terminal holds offers the holder’s actions in place of Refresh', () => {
    const p = inst(ID);
    useSessions.setState({ records: new Map([[SESSION, record(SESSION, { holder: { kind: 'terminal', pid: 4711 } })]]), digests: new Map([[SESSION, digest(SESSION, { availability: 'foreign_held' })]]) });
    show(identityOf(p, viewOf(p)), { availability: 'foreign_held', loaded: loadedWith(['other@x'], { kind: 'last', at: new Date().toISOString() }), loadedIds: new Set(['other@x']) });
    expect(within(fact('loaded')).getByText('Held by terminal · 4711')).toBeTruthy();
    expect(within(fact('loaded')).getByRole('button', { name: 'Take over here' })).toBeTruthy();
    expect(within(fact('loaded')).queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('a ready session offers Reload plugins instead; a disabled plugin is offered neither; no list is Not observed yet', () => {
    const p = inst(ID);
    const reloadMods = vi.fn();
    show(identityOf(p, viewOf(p)), { availability: 'usable', loaded: loadedWith(['other@x'], { kind: 'now' }), loadedIds: new Set(['other@x']), reloads: { reloadMods, reloadSkills: () => {}, line: null, failed: false, busy: false } });
    fireEvent.click(within(fact('loaded')).getByRole('button', { name: 'Reload plugins' }));
    expect(reloadMods).toHaveBeenCalledTimes(1);
    cleanup();
    const off = inst(ID, { enabled: false });
    show(identityOf(off, viewOf(off)), { availability: 'usable', loaded: loadedWith(['other@x'], { kind: 'now' }), loadedIds: new Set(['other@x']) });
    expect(fact('loaded').textContent).toBe('Not loaded in this session');
    cleanup();
    show(identityOf(p, viewOf(p)));
    expect(fact('loaded').textContent).toBe('Not observed yet');
  });
});

describe('the detail: the head', () => {
  it('the byline names the author, the version (or that none is reported), the marketplace and the update', () => {
    const p = inst(ID, { version: 'unknown', lastUpdated: new Date(Date.now() - 3 * DAY).toISOString() });
    const detail = show(identityOf(p, viewOf(p, { author: 'Anthropic' })));
    expect(within(detail).getByRole('heading', { name: 'Frontend design' })).toBeTruthy();
    expect(detail.querySelector('h3 + p')!.textContent).toBe('by Anthropic · Version not reported · claude-plugins-official · updated 3 days ago');
    expect(detail.textContent).not.toContain('unknown');
  });

  it('Update names the marketplace’s newer version and is disabled as On latest version only on an equal pair', () => {
    const p = inst(ID, { version: '1.0.0' });
    show(identityOf(p, viewOf(p, { marketplaceVersion: '1.1.0' })));
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update.parentElement!.getAttribute('title')).toBe('Update to 1.1.0');
    expect(update).toHaveProperty('disabled', false);
    cleanup();
    show(identityOf(p, viewOf(p, { marketplaceVersion: '1.0.0' })));
    expect(screen.getByRole('button', { name: 'Update' }).parentElement!.getAttribute('title')).toBe('On latest version');
    expect(screen.getByRole('button', { name: 'Update' })).toHaveProperty('disabled', true);
    cleanup();
    show(identityOf(p, viewOf(p)));
    expect(screen.getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false); // nothing to compare
  });

  it('Back and ⌘[ return to the list; the detail takes the keyboard when it opens', () => {
    const onBack = vi.fn();
    const p = inst(ID);
    const detail = show(identityOf(p, viewOf(p)), { onBack });
    expect(document.activeElement).toBe(detail);
    fireEvent.keyDown(detail, { key: '[', metaKey: true });
    fireEvent.click(within(detail).getByRole('button', { name: 'Back to My items' }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('the detail: what’s inside', () => {
  const item = (name: string, description: string | null = null) => ({ name, description });

  it('summarises in Desktop’s order with three names and "and N more", hides empty kinds, and opens a kind’s tab', () => {
    const p = inst(ID);
    const components = { ...EMPTY, skills: ['a', 'b', 'c', 'd'].map((n) => item(n, `Skill ${n}`)), agents: [item('reviewer', 'Reviews')], commands: [item('deploy')] };
    const detail = show(identityOf(p, viewOf(p, { components })));
    const rows = [...detail.querySelectorAll('[data-inside]')].map((row) => row.getAttribute('data-inside'));
    expect(rows).toEqual(['agents', 'commands', 'skills']);
    expect(detail.querySelector('[data-inside="skills"]')!.textContent).toContain('Skills · 4· a, b, cand 1 more');
    expect(within(detail).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Skills4', 'Commands1', 'Agents1']);
    fireEvent.click(within(detail.querySelector<HTMLElement>('[data-inside="skills"]')!).getByRole('button', { name: 'Skills · 4' }));
    const list = within(detail).getByRole('list', { name: 'Skills' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['/aSkill a', '/bSkill b', '/cSkill c', '/dSkill d']);
  });

  it('says when the files were read in part, are not on disk, or could not be read', () => {
    const p = inst(ID);
    show(identityOf(p, viewOf(p, { partial: true, components: { ...EMPTY, skills: [item('a')] } })));
    expect(screen.getByText(/Some of this plugin’s files could not be read/)).toBeTruthy();
    cleanup();
    const detail = show(identityOf(p, viewOf(p, { state: 'missing', components: { ...EMPTY, skills: [item('a')] } })));
    expect(screen.getByText('This plugin’s files are not on disk.')).toBeTruthy();
    expect(detail.querySelector('[data-inside]')).toBeNull();
    expect(within(detail).getAllByRole('tab')).toHaveLength(1);
    cleanup();
    show(identityOf(p, viewOf(p, { state: 'unknown' })));
    expect(screen.getByText('What’s inside could not be read.')).toBeTruthy();
  });
});

// The views M2's reader answers for its own fixture trees (src/engine-host/plugins/manifest.test.ts), rendered.
describe('the detail over the reader’s answers', () => {
  let root = '';
  afterEach(() => rm(root, { recursive: true, force: true }));
  async function tree(base: string, files: Record<string, string | object>): Promise<string> {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(base, path)), { recursive: true });
      await writeFile(join(base, path), typeof content === 'string' ? content : JSON.stringify(content));
    }
    return base;
  }
  const read = (p: InstalledPlugin, root: string | null, marketplaceRoot: string | null = null): Promise<PluginManifestView> =>
    readManifestView(installationRef(p) as ManifestItemRef, { root, marketplaceRoot, entryName: p.name });

  it('an LSP plugin with no plugin.json shows its marketplace entry’s description, author and language servers', async () => {
    root = await mkdtemp(join(tmpdir(), 'maws-p2b-detail-'));
    const p = inst('typescript-lsp@claude-plugins-official');
    const plugin = await tree(join(root, 'cache/typescript-lsp/1.0.0'), { LICENSE: 'Apache', 'README.md': '# TypeScript' });
    const marketplace = await tree(join(root, 'official'), {
      '.claude-plugin/marketplace.json': { name: 'claude-plugins-official', plugins: [{ name: 'typescript-lsp', description: 'TypeScript/JavaScript language server', version: '1.0.0', author: { name: 'Anthropic' }, source: './plugins/typescript-lsp', strict: false, lspServers: { typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } } } }] },
    });
    const detail = show(identityOf(p, await read(p, plugin, marketplace)));
    expect(detail.textContent).toContain('TypeScript/JavaScript language server');
    expect(detail.querySelector('h3 + p')!.textContent).toContain('by Anthropic');
    expect(detail.querySelector('[data-inside="lspServers"]')!.textContent).toContain('Language servers · 1· typescript');
    fireEvent.click(within(detail).getByRole('tab', { name: /Language servers/ }));
    fireEvent.mouseDown(within(detail).getByRole('tab', { name: /Language servers/ }));
    expect(within(detail).getByRole('list', { name: 'Language servers' }).textContent).toBe('typescript');
    expect(document.body.innerHTML).not.toContain('typescript-language-server');
  });

  it('no hook or monitor command, MCP command, argument, environment, header or URL, or LSP command, in any tab', async () => {
    root = await mkdtemp(join(tmpdir(), 'maws-p2b-detail-'));
    const p = inst('p@m');
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', userConfig: { API: { type: 'string', title: 'API', description: 'Key', default: 'sk-secret-default', sensitive: true } } },
      '.mcp.json': {
        mcpServers: {
          stdio: { command: 'sk-secret-cmd', args: ['--token', 'sk-secret-arg'], env: { API_KEY: 'API_KEY_VALUE sk-secret-env' } },
          remote: { type: 'http', url: 'https://mcp.example.com/mcp?token=sk-secret-url', headers: { Authorization: 'Bearer sk-secret-header' } },
        },
      },
      'hooks/hooks.json': { hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'curl -H "Authorization: Bearer sk-secret-hook" https://hooks.example.com' }] }] } },
      'monitors/monitors.json': [{ name: 'tail', command: 'tail sk-secret-monitor', description: 'Tails the log' }],
      '.lsp.json': { ts: { command: 'sk-secret-lsp', env: { TOKEN: 'sk-secret-lsp-env' }, extensionToLanguage: { '.ts': 'typescript' } } },
    });
    const detail = show(identityOf(p, await read(p, plugin)));
    const seen: string[] = [];
    for (const tab of within(detail).getAllByRole('tab')) {
      fireEvent.mouseDown(tab);
      seen.push(document.body.innerHTML);
    }
    expect(seen).toHaveLength(5); // Overview, MCP servers, Hooks, Monitors, Language servers
    for (const html of seen) for (const secret of ['sk-secret', 'Bearer', 'hooks.example', 'mcp.example', 'API_KEY_VALUE', 'curl', 'tail sk']) expect(html, secret).not.toContain(secret);
    expect(seen.join('')).toContain('PostToolUse · Write');
    expect(seen.join('')).toContain('Tails the log');
  });
});
