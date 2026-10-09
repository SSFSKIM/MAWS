// `/skills` over the fixture-backed widget backend: E8's Reload (`reload_skills` as an operation, `Reloaded · N
// skills`, the dialog read again on its completion), and P2-B's skills library (§5.10): the skills in My items' groups
// with their plugin's badge, Search and Sort, "Use in chat" putting `/<skill> ` at the composer's caret and sending
// nothing, a row's detail, the catalogue's skills when the engine answers the dialog empty, and Desktop's failed state.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { useLibraryStore } from './plugins/library-store';
import { SkillsWidget } from './SkillsWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;
let cwd: string;

// 2.1.295's answer (U3 F4), with a built-in skill and an MCP one beside it
const skill = (name: string, source: string, description: string) => ({ name, display_name: name, description, source, tokens: 20, state: 'on', advertised: true, handles: {} });
const DIALOG = {
  skills: [
    skill('frontend-design:frontend-design', 'plugin', 'Guidance for distinctive, intentional visual design. Long enough to be cut on the row and whole in the detail.'),
    skill('p2b-project', 'project', 'A project skill'),
    skill('p2b-user', 'user', 'A skill of your own'),
    skill('debug', 'built-in', 'Debug the session'),
    skill('lookup', 'mcp', 'Look a thing up'),
  ],
};
const installed = (): InstalledPlugin => ({
  id: 'frontend-design@claude-plugins-official',
  name: 'frontend-design',
  marketplace: 'claude-plugins-official',
  version: '1.0.0',
  scope: 'project',
  enabled: true,
  projectPath: cwd,
  installPath: '/cfg/plugins/cache/claude-plugins-official/frontend-design/1.0.0',
  errors: [],
  notes: [],
  installedAt: null,
  lastUpdated: null,
  projectEnabled: true,
  here: true,
  coversHere: true,
});

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  cwd = backend.status(ID).cwd;
  backend.script('plugins.list', () => ({ plugins: [installed()] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [{ name: 'claude-plugins-official', source: 'github', locator: 'anthropics/claude-plugins-official', installLocation: '/cfg/plugins/marketplaces/claude-plugins-official' }] }));
  backend.script('plugins.manifest', () => ({ manifests: [] }));
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  resetComposerStore();
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = (close: () => void = () => {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SkillsWidget appSessionId={ID} args="" close={close} />
    </QueryClientProvider>,
  );
const group = (name: string) => screen.getByRole('region', { name });
const rowsOf = (scope: HTMLElement) => within(scope).getAllByRole('listitem').map((li) => li.getAttribute('data-skill-row'));
const opened = async () => {
  mount();
  await waitFor(() => expect(screen.getByRole('region', { name: 'In this project' })).toBeTruthy());
};

describe('skills widget: Reload', () => {
  it('runs reload_skills, says how many skills the engine offers, and reads the dialog again', async () => {
    backend.script('session.reloadSkills', () => {
      setTimeout(() => backend.emitOperation({ appSessionId: ID, opId: 'op-skills', command: 'session.reloadSkills', late: false, outcome: { ok: true, value: { skills: [{ name: 'e8-probe:e8-hello', description: 'Say hello' }] } } }), 0);
      return { opId: 'op-skills' };
    });
    mount();
    await waitFor(() => expect(screen.getByRole('list', { name: 'Skills' })).toBeTruthy());
    const reads = () => backend.calls.filter((c) => c.subtype === 'get_skills_dialog').length;
    const before = reads();
    fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Reloaded · 1 skill'));
    expect(backend.calls.filter((c) => c.command === 'session.reloadSkills').map((c) => c.input)).toEqual([{ appSessionId: ID }]);
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it('shows a failed reload in red in the operation’s words', async () => {
    backend.script('session.reloadSkills', () => {
      setTimeout(() => backend.emitOperation({ appSessionId: ID, opId: 'op-skills', command: 'session.reloadSkills', late: false, outcome: { ok: false, error: { code: 'engine_error', message: 'reload_skills failed', engineCode: null } } }), 0);
      return { opId: 'op-skills' };
    });
    mount();
    await waitFor(() => expect(screen.getByRole('list', { name: 'Skills' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('reload_skills failed · engine_error'));
    expect(screen.getByRole('status').className).toContain('text-danger');
  });
});

describe('skills widget: the library', () => {
  beforeEach(() => backend.script('session.getSkillsDialog', () => DIALOG));

  it('opens library-sized with Search, Sort and Reload skills, and draws My items’ groups with the plugin’s badge', async () => {
    await opened();
    const frame = document.querySelector<HTMLElement>('[data-widget="skills"]')!;
    expect(frame.getAttribute('data-widget-size')).toBe('library');
    const head = frame.querySelector('header')!;
    expect(within(head).getByRole('searchbox', { name: 'Search skills' })).toBeTruthy();
    expect(within(head).getByRole('button', { name: 'Sort by' })).toBeTruthy();
    expect(within(head).getByRole('button', { name: 'Reload skills' })).toBeTruthy();
    const order = [...document.querySelectorAll('[data-skills-group]')].map((s) => s.getAttribute('data-skills-group'));
    expect(order).toEqual(['here', 'yours', 'anthropic', 'added']);
    expect(rowsOf(group('In this project'))).toEqual(['frontend-design:frontend-design', 'p2b-project']);
    expect(rowsOf(group('Created by you'))).toEqual(['p2b-user']);
    expect(rowsOf(group('From Anthropic & Partners'))).toEqual(['debug']);
    expect(rowsOf(group('From marketplaces you added'))).toEqual(['lookup']);
    const design = document.querySelector<HTMLElement>('[data-skill-row="frontend-design:frontend-design"]')!;
    expect(design.querySelector('[data-skill-name]')!.textContent).toBe('frontend-design');
    expect(design.querySelector('[data-skill-badge]')!.textContent).toBe('Frontend design');
    expect(document.querySelector('[data-skill-row="lookup"] [data-skill-badge]')!.textContent).toBe('mcp'); // the engine's word
    expect(document.querySelector('[data-skill-row="p2b-user"] [data-skill-badge]')).toBeNull();
  });

  it('Use in chat closes the dialog and puts /<skill> at the composer’s caret, sending nothing', async () => {
    const insertText = vi.fn();
    registerFocusTarget(ID, { focusEditor: () => {}, focusFrame: () => {}, insertText });
    const close = vi.fn();
    mount(close);
    await waitFor(() => expect(document.querySelector('[data-skill-row="frontend-design:frontend-design"]')).toBeTruthy());
    const before = backend.calls.length;
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-skill-row="frontend-design:frontend-design"]')!).getByRole('button', { name: 'Use in chat' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(insertText).toHaveBeenCalledWith('/frontend-design:frontend-design ');
    expect(backend.calls.slice(before)).toEqual([]); // no prompt, no control
  });

  it('a row’s click opens its detail (the whole description, the source, the plugin) with Use in chat; Back and ⌘[ return', async () => {
    const insertText = vi.fn();
    registerFocusTarget(ID, { focusEditor: () => {}, focusFrame: () => {}, insertText });
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'View frontend-design' }));
    const detail = document.querySelector<HTMLElement>('[data-skill-detail]')!;
    expect(detail.getAttribute('data-skill-detail')).toBe('frontend-design:frontend-design');
    expect(detail.textContent).toContain('Long enough to be cut on the row and whole in the detail.');
    expect(detail.textContent).toContain('/frontend-design:frontend-design');
    expect(detail.textContent).toContain('Frontend design');
    expect(detail.textContent).toContain('plugin');
    expect(document.querySelector('[data-skills-list]')!.className).toContain('hidden'); // the list kept beneath it
    expect(screen.queryByRole('searchbox', { name: 'Search skills' })).toBeNull(); // the list's controls leave with it
    fireEvent.click(screen.getByRole('button', { name: 'Back to Skills' }));
    expect(document.querySelector('[data-skill-detail]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View p2b-user' }));
    fireEvent.keyDown(document.querySelector('[data-skill-detail]')!, { key: '[', metaKey: true });
    expect(document.querySelector('[data-skill-detail]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View debug' }));
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-skill-detail]')!).getByRole('button', { name: 'Use in chat' }));
    expect(insertText).toHaveBeenCalledWith('/debug ');
  });

  it('searches, sorts by plugin name (one list), and says when nothing matches with Reset filters', async () => {
    await opened();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'own' } });
    expect([...document.querySelectorAll('[data-skill-row]')].map((r) => r.getAttribute('data-skill-row'))).toEqual(['p2b-user']);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search skills' }), { key: 'Escape' });
    expect(screen.getByRole('searchbox', { name: 'Search skills' })).toHaveProperty('value', '');
    useLibraryStore.setState((s) => ({ skills: { ...s.skills, sort: 'plugin' } }));
    await waitFor(() => expect(document.querySelectorAll('[data-skills-group]')).toHaveLength(1));
    expect(document.querySelector('[data-skills-group]')!.getAttribute('data-skills-group')).toBe('all');
    expect([...document.querySelectorAll('[data-skill-row]')].map((r) => r.getAttribute('data-skill-row'))).toEqual(['frontend-design:frontend-design', 'debug', 'lookup', 'p2b-project', 'p2b-user']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'nothing like it' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(useLibraryStore.getState().skills).toEqual({ search: '', sort: 'name' });
    expect(document.querySelectorAll('[data-skills-group]').length).toBe(4);
  });

  it('keeps the plugins’ groups waiting for the plugin list, so no row moves under the pointer', async () => {
    let listed: (value: unknown) => void = () => {};
    backend.script('plugins.list', () => new Promise((resolve) => (listed = resolve)));
    mount();
    await waitFor(() => expect(backend.calls.some((c) => c.subtype === 'get_skills_dialog')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('[data-skill-row]')).toBeNull();
    listed({ plugins: [installed()] });
    await waitFor(() => expect(rowsOf(group('In this project'))).toEqual(['frontend-design:frontend-design', 'p2b-project']));
  });

  it('a failed plugin list still draws the skills, the plugin’s skill then credited by its own name', async () => {
    backend.script('plugins.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'the CLI failed' });
    });
    mount();
    await waitFor(() => expect(document.querySelector('[data-skill-row="frontend-design:frontend-design"]')).toBeTruthy());
    expect(document.querySelector('[data-skill-row="frontend-design:frontend-design"]')!.closest('[data-skills-group]')!.getAttribute('data-skills-group')).toBe('added');
    expect(document.querySelector('[data-skill-row="frontend-design:frontend-design"] [data-skill-badge]')!.textContent).toBe('Frontend design');
  });
});

describe('skills widget: states', () => {
  it('an empty dialog (an older engine): the catalogue’s skills in one list, with Use in chat', async () => {
    mount(); // reads.jsonl seq 72 answers the dialog empty; the scenario's catalogue lists the skills
    await waitFor(() => expect(screen.getByRole('list', { name: 'Skills' })).toBeTruthy());
    expect(document.querySelectorAll('[data-skills-group]')).toHaveLength(1);
    expect(document.querySelector('[data-skill-row="deep-research"]')).toBeTruthy();
    expect(within(document.querySelector<HTMLElement>('[data-skill-row="deep-research"]')!).getByRole('button', { name: 'Use in chat' })).toBeTruthy();
  });

  it('a failed read says it could not load the skills, in the read’s words, with Retry', async () => {
    let fail = true;
    backend.script('session.getSkillsDialog', () => {
      if (fail) throw new WidgetBackendError({ code: 'internal', message: 'get_skills_dialog failed' });
      return DIALOG;
    });
    mount();
    await waitFor(() => expect(screen.getByText("Couldn't load your skills.")).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('get_skills_dialog failed');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'In this project' })).toBeTruthy());
  });

  it('a session with no ready process reads nothing and says so (today’s frame; P2-A’s dormant state replaces it)', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]) });
    mount();
    await waitFor(() => expect(document.querySelector('[data-widget="skills"] [data-widget-body]')!.textContent).not.toBe(''));
    expect(backend.calls.filter((c) => c.subtype === 'get_skills_dialog')).toEqual([]);
    expect(backend.calls.filter((c) => c.command === 'session.reloadSkills' || c.command === 'session.start')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Reload skills' })).toHaveProperty('disabled', true);
  });
});
