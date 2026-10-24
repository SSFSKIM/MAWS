// P4-R8 (settings version 16): Settings › Engine › MCP servers adds an HTTP server by name and URL and removes one, each
// a write of the whole list through `settings.set`; an entry the schema refuses is said beside the fields and nothing is
// written.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import type { AppMcpServer } from '@shared/engine/app-mcp-servers';
import { SETTINGS_DEFAULTS_V18 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { MCP_SERVERS } from './copy';
import { McpServers } from './McpServersSettings';

const NOTION: AppMcpServer = { name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' };
let b: SettingsBridge;
let unsubscribe = () => {};
const current = () => useSettings.getState().state!.settings;

function renderRow(initial: Settings = SETTINGS_DEFAULTS_V18) {
  b = settingsBridge(initial);
  window.maws = b.bridge;
  const rendered = render(<McpServers settings={current()} />);
  unsubscribe = useSettings.subscribe((state) => {
    if (state.state) rendered.rerender(<McpServers settings={current()} />);
  });
  return rendered;
}
const row = () => screen.getByRole('group', { name: MCP_SERVERS.label });
const type = (label: string, value: string) => fireEvent.change(within(row()).getByRole('textbox', { name: label }), { target: { value } });
const withServers = (servers: AppMcpServer[]): Settings => ({ ...SETTINGS_DEFAULTS_V18, engine: { ...SETTINGS_DEFAULTS_V18.engine, mcpServers: servers } });

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  vi.restoreAllMocks();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('Settings › Engine › MCP servers', () => {
  it('starts empty, says where the servers load, and adds the owner\'s Notion entry by name and URL, trimmed', async () => {
    renderRow();
    expect(within(row()).getByText(MCP_SERVERS.note)).toBeTruthy();
    const add = within(row()).getByRole('button', { name: MCP_SERVERS.add }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type(MCP_SERVERS.name, ' notion ');
    type(MCP_SERVERS.url, 'https://mcp.notion.com/mcp ');
    fireEvent.click(add);
    expect(await within(row()).findByText('https://mcp.notion.com/mcp')).toBeTruthy();
    expect(b.sets).toEqual([{ engine: { mcpServers: [NOTION] } }]);
    expect(current().engine.mcpServers).toEqual([NOTION]);
    expect((within(row()).getByRole('textbox', { name: MCP_SERVERS.name }) as HTMLInputElement).value).toBe('');
  });

  it('adds with Enter after the entries already there, and removes one by its ×, writing the whole list each time', async () => {
    const docs: AppMcpServer = { name: 'local-docs', type: 'http', url: 'http://127.0.0.1:7777/mcp' };
    renderRow(withServers([NOTION]));
    type(MCP_SERVERS.name, docs.name);
    type(MCP_SERVERS.url, docs.url);
    fireEvent.keyDown(within(row()).getByRole('textbox', { name: MCP_SERVERS.url }), { key: 'Enter' });
    expect(await within(row()).findByText(docs.url)).toBeTruthy();
    fireEvent.click(within(row()).getByRole('button', { name: MCP_SERVERS.remove('notion') }));
    await expect.poll(() => current().engine.mcpServers).toEqual([docs]);
    expect(b.sets).toEqual([{ engine: { mcpServers: [NOTION, docs] } }, { engine: { mcpServers: [docs] } }]);
  });

  it('disables every list action until the written list returns through props, so quick removals cannot restore an entry', async () => {
    const docs: AppMcpServer = { name: 'local-docs', type: 'http', url: 'http://127.0.0.1:7777/mcp' };
    const rendered = renderRow(withServers([NOTION, docs]));
    unsubscribe(); // delay main's settings.changed separately from the write's answer
    let answer!: () => void;
    let writes = 0;
    const invoke = b.bridge.invoke;
    b.bridge.invoke = (async (name: string, input: unknown) => {
      if (name === 'settings.set') {
        writes++;
        await new Promise<void>((resolve) => (answer = resolve));
      }
      return invoke(name as never, input as never);
    }) as MawsBridge['invoke'];
    type(MCP_SERVERS.name, 'next');
    type(MCP_SERVERS.url, 'https://example.com/mcp');
    const add = within(row()).getByRole('button', { name: MCP_SERVERS.add }) as HTMLButtonElement;
    const removeNotion = within(row()).getByRole('button', { name: MCP_SERVERS.remove('notion') }) as HTMLButtonElement;
    const removeDocs = within(row()).getByRole('button', { name: MCP_SERVERS.remove(docs.name) }) as HTMLButtonElement;
    fireEvent.click(removeNotion);
    expect([add.disabled, removeNotion.disabled, removeDocs.disabled]).toEqual([true, true, true]);
    fireEvent.click(removeDocs);
    fireEvent.keyDown(within(row()).getByRole('textbox', { name: MCP_SERVERS.url }), { key: 'Enter' });
    expect(writes).toBe(1);
    await act(async () => answer());
    expect(b.sets).toEqual([{ engine: { mcpServers: [docs] } }]);
    expect([add.disabled, removeNotion.disabled, removeDocs.disabled]).toEqual([true, true, true]);

    rendered.rerender(<McpServers settings={structuredClone(current())} />);
    expect(add.disabled).toBe(false);
    expect(removeDocs.disabled).toBe(false);
    fireEvent.click(removeDocs);
    await act(async () => answer());
    rendered.rerender(<McpServers settings={structuredClone(current())} />);
    expect(current().engine.mcpServers).toEqual([]);
    expect(within(row()).queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(b.sets).toEqual([{ engine: { mcpServers: [docs] } }, { engine: { mcpServers: [] } }]);
  });

  it('enables list actions again when a write fails without changing the saved list', async () => {
    renderRow(withServers([NOTION]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    b.bridge.invoke = (async () => ({ ok: false, error: { code: 'internal', message: 'disk full' } })) as MawsBridge['invoke'];
    const remove = within(row()).getByRole('button', { name: MCP_SERVERS.remove('notion') }) as HTMLButtonElement;
    fireEvent.click(remove);
    expect(remove.disabled).toBe(true);
    await expect.poll(() => remove.disabled).toBe(false);
    expect(current().engine.mcpServers).toEqual([NOTION]);
  });

  it.each([
    ['maws, MAWS\'s own server', 'maws', 'https://example.com/mcp', MCP_SERVERS.reservedName],
    ['a name Claude Code reserves', 'webagent', 'https://example.com/mcp', MCP_SERVERS.reservedName],
    ['a name with a dot', 'my.server', 'https://example.com/mcp', MCP_SERVERS.badName],
    ['a URL that is not http or https', 'files', 'file:///tmp/mcp', MCP_SERVERS.badUrl],
    ['a URL that is not one', 'docs', 'mcp.notion.com', MCP_SERVERS.badUrl],
    ['a name already in the list', 'notion', 'https://other.example/mcp', MCP_SERVERS.duplicate('notion')],
  ])('refuses %s beside the fields and writes nothing', (_, name, url, words) => {
    renderRow(withServers([NOTION]));
    type(MCP_SERVERS.name, name);
    type(MCP_SERVERS.url, url);
    fireEvent.click(within(row()).getByRole('button', { name: MCP_SERVERS.add }));
    expect(within(row()).getByRole('alert').textContent).toBe(words);
    expect(b.sets).toEqual([]);
  });
});
