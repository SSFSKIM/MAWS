// The connector sheet (the Discover spec, Design "Adding", Failure handling's connector rows).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { item } from '../discover/test-items';
import { ConnectorSheet, type ConnectorSheetEnv } from './ConnectorSheet';
import { connectorAddOf } from './present';

afterEach(cleanup);

const connector = (install: Partial<Extract<CatalogItem['install'], { kind: 'connector' }>> = {}) =>
  item({ id: 'x', kind: 'connector', name: 'Linear', publisher: 'Linear', reviewTier: 'partner', install: { kind: 'connector', name: 'linear', url: 'https://mcp.linear.app/mcp', urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required', ...install } });
const env = (over: Partial<ConnectorSheetEnv> = {}): ConnectorSheetEnv => ({ cwd: '/p', runCwd: '/p', engine: { state: 'ready', env: { binary: '/engine/claude', configHome: '/cfg', globalConfig: '/cfg/.claude.json' } }, servers: [], ...over });
const open = (catalog: CatalogItem, e = env()) => {
  const onConfirm = vi.fn();
  render(<ConnectorSheet request={connectorAddOf(catalog)!} env={e} onConfirm={onConfirm} onClose={() => {}} />);
  return { sheet: screen.getByRole('dialog', { name: `Add ${catalog.name}?` }), onConfirm };
};
const argv = (sheet: HTMLElement) => JSON.parse(sheet.querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];
const add = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Add' }) as HTMLButtonElement;

describe('the connector sheet', () => {
  it('shows the name, publisher and tier, URL, transport, the exact command at user scope, and the file; Add runs it', () => {
    const { sheet, onConfirm } = open(connector());
    expect(within(sheet).getByText('by Linear · Partner')).toBeTruthy();
    expect(within(sheet).getByText('https://mcp.linear.app/mcp')).toBeTruthy();
    expect(within(sheet).getByText('HTTP (streamable)')).toBeTruthy();
    expect(within(sheet).getByText('claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user')).toBeTruthy();
    expect(within(sheet).getByText('/cfg/.claude.json')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Project' }));
    expect(argv(sheet)).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'project']);
    expect(within(sheet).getByText('/p/.mcp.json')).toBeTruthy();
    fireEvent.click(add(sheet));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ action: 'mcp-add', input: { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'project' } }), '/engine/claude');
  });

  it('lets the name be edited within the engine’s rule', () => {
    const { sheet } = open(connector());
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'linear work' } });
    expect(within(sheet).getByText('Use letters, digits, hyphens and underscores only.')).toBeTruthy();
    expect(add(sheet).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'linear-work' } });
    expect(argv(sheet)).toContain('linear-work');
    expect(add(sheet).disabled).toBe(false);
  });

  it('refuses a name already configured here and shows the existing entry', () => {
    const { sheet } = open(connector(), env({ servers: [{ name: 'linear', scope: 'local', path: '/cfg/.claude.json', transport: 'http' }] }));
    expect(within(sheet).getByRole('alert').textContent).toBe('This name is already configured here (local scope, /cfg/.claude.json).');
    expect(add(sheet).disabled).toBe(true);
  });

  it('asks an instance URL, held to the server’s pattern, which it shows', () => {
    const pattern = '^https://api\\.salesforce\\.com/platform/mcp/v1/platform/headless-360$';
    const { sheet } = open(connector({ url: null, urlPattern: pattern }));
    expect(within(sheet).getByText(`It must match ${pattern}`)).toBeTruthy();
    expect(add(sheet).disabled).toBe(true);
    const field = within(sheet).getByRole('textbox', { name: 'Your instance’s URL' });
    fireEvent.change(field, { target: { value: 'https://evil.example.com/headless-360' } });
    expect(within(sheet).getByRole('alert').textContent).toBe(`The URL must match ${pattern}`);
    expect(add(sheet).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'https://api.salesforce.com/platform/mcp/v1/platform/headless-360' } });
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(add(sheet).disabled).toBe(false);
  });

  it('offers the directory’s url_options as a choice', () => {
    const { sheet } = open(connector({ url: null, urlOptions: [{ url: 'https://eu.example.com/mcp', label: 'EU', description: 'Data in the EU' }, { url: 'https://us.example.com/mcp', label: 'US', description: null }] }));
    fireEvent.click(within(sheet).getByRole('radio', { name: /US/ }));
    expect(argv(sheet)).toContain('https://us.example.com/mcp');
  });

  it('says No sign-in needed for an authless server; an SSE server adds with --transport sse; the user configuration offers user scope alone', () => {
    const { sheet } = open(connector({ authPosture: 'no_auth', transport: 'sse' }), env({ cwd: null, runCwd: '/cfg' }));
    expect(within(sheet).getByText('No sign-in needed')).toBeTruthy();
    expect(argv(sheet).slice(0, 4)).toEqual(['mcp', 'add', '--transport', 'sse']);
    expect(within(sheet).queryByRole('radio', { name: 'Project' })).toBeNull();
  });

  it('names no command and confirms nothing until the engine is resolved', () => {
    const { sheet } = open(connector(), env({ engine: { state: 'loading' } }));
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(add(sheet).disabled).toBe(true);
  });
});
