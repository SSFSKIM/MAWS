// The operations book (E8 M2; UX wave U11g, docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §D):
// a custom connector's add is sent as `connectors.addJson` with exactly its fields and the page's folder, to this
// machine, and the book keeps the request with `•••` in every value slot, so nothing it holds after the send holds one;
// every other request is sent and kept as today.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import { preloadOf } from '../../test-support/preload-of';
import { forgetKeptOperations, usePluginOperations } from './operation';
import { requestFor, type PluginsRequest } from './present';

let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient();
  window.maws = preloadOf(fake);
});
afterEach(() => {
  forgetKeptOperations();
  delete (window as { maws?: unknown }).maws;
});

const VALUES = ['value-one', 'value-two'];
const custom = (folder: string | null, scope: 'user' | 'project' = 'project'): PluginsRequest => ({
  ...requestFor('mcp-add', { name: 'files-probe', scope, entry: { type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Probe-Key', value: 'value-one' }, { name: 'X-Probe-Mode', value: 'value-two' }] } }, null),
  folder,
});

describe('a custom connector’s add', () => {
  it('is sent as connectors.addJson with exactly { cwd, binary, name, scope, entry, folder }, to this machine', async () => {
    const { result } = renderHook(() => usePluginOperations());
    act(() => void result.current.run('connector:add:project:files-probe', custom('/work/files-lab'), '/work/files-lab', '/engine/claude'));
    expect(fake.invoked('connectors.addJson')).toEqual([
      { cwd: '/work/files-lab', binary: '/engine/claude', name: 'files-probe', scope: 'project', entry: { type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Probe-Key', value: 'value-one' }, { name: 'X-Probe-Mode', value: 'value-two' }] }, folder: '/work/files-lab' },
    ]);
    expect(fake.machines('connectors.addJson')).toEqual([TEST_MACHINE]);
    expect(fake.invoked('connectors.add')).toEqual([]);
    act(() => void result.current.run('connector:add:user:files-probe', custom(null, 'user'), '/cfg', '/engine/claude'));
    expect((fake.invoked('connectors.addJson')[1] as { folder: unknown; cwd: string }).folder).toBeNull();
  });

  it('after the send, nothing the book holds contains a value: the request is kept with ••• in every slot', async () => {
    const { result } = renderHook(() => usePluginOperations());
    act(() => void result.current.run('connector:add:project:files-probe', custom('/work/files-lab'), '/work/files-lab', '/engine/claude'));
    const holds = () => VALUES.some((value) => JSON.stringify([...result.current.entries]).includes(value));
    expect(holds()).toBe(false); // while the receipt is out
    await act(() => fake.reply('connectors.addJson', { opId: 'op-1' }));
    expect(holds()).toBe(false);
    expect((result.current.entries.get('connector:add:project:files-probe')!.request as PluginsRequest).input).toEqual({ name: 'files-probe', scope: 'project', entry: { type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Probe-Key', value: '•••' }, { name: 'X-Probe-Mode', value: '•••' }] } });
    act(() => fake.event('plugins.operation', { opId: 'op-1', action: 'mcp-add', target: 'files-probe', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message: 'MCP server files-probe already exists in user config', failureCode: null, shownCommand: null } } }));
    expect(holds()).toBe(false);
    expect(result.current.entries.get('connector:add:project:files-probe')!.state.phase).toBe('done');
  });

  it('a refused send keeps the shown request too, and the transport’s words', async () => {
    const { result } = renderHook(() => usePluginOperations());
    act(() => void result.current.run('connector:add:project:files-probe', custom('/work/files-lab'), '/work/files-lab', '/engine/claude'));
    await act(() => fake.fail('connectors.addJson', 'unknown command: connectors.addJson', 'unknown_command'));
    const entry = result.current.entries.get('connector:add:project:files-probe')!;
    expect(entry.state.phase).toBe('unsent');
    expect(VALUES.some((value) => JSON.stringify(entry).includes(value))).toBe(false);
  });
});

describe('every other request', () => {
  it('is sent by COMMAND_OF and kept as it was asked: Discover’s add, a removal, an install', async () => {
    const { result } = renderHook(() => usePluginOperations());
    const remote = requestFor('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' }, null);
    const removal = requestFor('mcp-remove', { name: 'linear', scope: 'user' }, null);
    const install = requestFor('install', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null);
    act(() => {
      void result.current.run('a', remote, '/p', '/engine/claude');
      void result.current.run('b', removal, '/p', '/engine/claude');
      void result.current.run('c', install, '/p', '/engine/claude');
    });
    expect(fake.invoked('connectors.add')).toEqual([{ cwd: '/p', binary: '/engine/claude', name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' }]);
    expect(fake.invoked('connectors.remove')).toEqual([{ cwd: '/p', binary: '/engine/claude', name: 'linear', scope: 'user' }]);
    expect(fake.invoked('plugins.install')).toEqual([{ cwd: '/p', binary: '/engine/claude', plugin: 'e8-probe@e8-scratch', scope: 'user' }]);
    expect(fake.invoked('connectors.addJson')).toEqual([]);
    expect(result.current.entries.get('a')!.request).toBe(remote);
    expect(result.current.entries.get('b')!.request).toBe(removal);
    expect(result.current.entries.get('c')!.request).toBe(install);
  });
});

// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D "What the book keeps of an ended
// operation", C12): a kept book lives for the run of the app, so once an operation has ended (its `done`, or a refused
// send) the book holds its outcome and the five fields a line and its controls read, and no longer the request.
describe('an ended operation', () => {
  const done = (opId: string, outcome: unknown) => act(() => fake.event('plugins.operation', { opId, action: 'install', target: 'x', phase: 'done', outcome }));
  const FIVE = ['action', 'afterAdd', 'catalogName', 'scope', 'target'];

  it('holds the whole request while it runs, and at a success, a failure and a refused send only the five fields', async () => {
    const { result } = renderHook(() => usePluginOperations('customize:/work/quay'));
    const install = requestFor('install', { plugin: 'berth-notes@harbour-market', scope: 'project' }, null, {
      catalog: { name: 'Berth notes', marketplace: { name: 'harbour-market', source: 'harbour/market', present: true }, skills: null, contents: null, runsCode: null, alsoListedBy: [] },
      afterAdd: { marketplace: 'harbour-market', scope: 'project' },
    });
    const removal = requestFor('mcp-remove', { name: 'tides', scope: 'user' }, null);
    const update = requestFor('update', { plugin: 'quay-ledger@harbour-market', scope: 'user' }, null);
    act(() => {
      void result.current.run('catalog:berth', install, '/work/quay', '/engine/claude');
      void result.current.run('connector:user:tides:/cfg/.claude.json', removal, '/work/quay', '/engine/claude');
      void result.current.run('installed:quay-ledger', update, '/work/quay', '/engine/claude');
    });
    expect(result.current.entries.get('catalog:berth')!.request).toBe(install); // working: the request as asked
    await act(() => fake.reply('plugins.install', { opId: 'op-install' }));
    await act(() => fake.reply('connectors.remove', { opId: 'op-remove' }));
    await act(() => fake.fail('plugins.update', 'the engine host is not running', 'internal'));
    expect(result.current.entries.get('catalog:berth')!.request).toBe(install);
    done('op-install', { ok: true, result: { message: 'Installed berth-notes' } });
    done('op-remove', { ok: false, error: { code: 'cli_failed', message: 'No MCP server named tides', failureCode: null, shownCommand: null } });
    const entry = (key: string) => result.current.entries.get(key)!;
    expect(entry('catalog:berth').request).toEqual({ action: 'install', scope: 'project', target: 'berth-notes@harbour-market', afterAdd: { marketplace: 'harbour-market', scope: 'project' }, catalogName: 'Berth notes' });
    expect(entry('connector:user:tides:/cfg/.claude.json').request).toEqual({ action: 'mcp-remove', scope: 'user', target: 'tides' });
    expect(entry('installed:quay-ledger').state.phase).toBe('unsent');
    expect(entry('installed:quay-ledger').request).toEqual({ action: 'update', scope: 'user', target: 'quay-ledger@harbour-market' });
    for (const key of result.current.entries.keys()) for (const field of Object.keys(entry(key).request)) expect(FIVE).toContain(field);
  });

  it('a custom add typed with a marked URL, command and argument: once ended, nothing the book holds contains a mark', async () => {
    const { result } = renderHook(() => usePluginOperations('customize:/work/quay'));
    const remote = requestFor('mcp-add', { name: 'tide-feed', scope: 'user', entry: { type: 'http', url: 'https://mark-url.example.test/mcp', headers: [] } }, null);
    const local = requestFor('mcp-add', { name: 'tide-local', scope: 'user', entry: { type: 'stdio', command: '/opt/mark-command/bin/tides', args: ['--mark-argument'], env: [] } }, null);
    const marked = () => JSON.stringify([...result.current.entries]).includes('mark-');
    act(() => {
      void result.current.run('connector:add:user:tide-feed', { ...remote, folder: null }, '/cfg', '/engine/claude');
      void result.current.run('connector:add:user:tide-local', { ...local, folder: null }, '/cfg', '/engine/claude');
    });
    await act(() => fake.reply('connectors.addJson', { opId: 'op-feed' }));
    await act(() => fake.fail('connectors.addJson', 'connectors.addJson is not a command here', 'unknown_command'));
    expect(marked()).toBe(true); // while one runs, its request is the book's (as shown: only value slots masked)
    done('op-feed', { ok: false, error: { code: 'cli_failed', message: 'MCP server tide-feed already exists in user config', failureCode: null, shownCommand: null } });
    expect(marked()).toBe(false);
    expect(result.current.entries.get('connector:add:user:tide-feed')!.request).toEqual({ action: 'mcp-add', scope: 'user', target: 'tide-feed' });
    expect(result.current.entries.get('connector:add:user:tide-local')!.request).toEqual({ action: 'mcp-add', scope: 'user', target: 'tide-local' });
  });
});
