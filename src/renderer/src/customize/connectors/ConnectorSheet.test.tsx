// The connector sheet (the Discover spec, Design "Adding", Failure handling's connector rows). The owner's ruling of
// 2026-10-25: the exact command and the file it changes sit behind Details, closed at every opening.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { item } from '../discover/test-items';
import { ConnectorSheet, type ConnectorSheetEnv } from './ConnectorSheet';
import { requestFor } from '../../widgets/plugins/present';
import { connectorAddOf } from './present';

afterEach(cleanup);

const connector = (install: Partial<Extract<CatalogItem['install'], { kind: 'connector' }>> = {}) =>
  item({ id: 'x', kind: 'connector', name: 'Linear', publisher: 'Linear', reviewTier: 'partner', install: { kind: 'connector', name: 'linear', url: 'https://mcp.linear.app/mcp', urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required', ...install } });
const env = (over: Partial<ConnectorSheetEnv> = {}): ConnectorSheetEnv => ({ cwd: '/p', runCwd: '/p', engine: { state: 'ready', env: { binary: '/engine/claude', configHome: '/cfg', globalConfig: '/cfg/.claude.json' } }, configured: { state: 'read', servers: [] }, retryServers: () => {}, ...over });
const open = (catalog: CatalogItem, e = env()) => {
  const onConfirm = vi.fn();
  render(<ConnectorSheet request={connectorAddOf(catalog)!} env={e} onConfirm={onConfirm} onClose={() => {}} />);
  return { sheet: screen.getByRole('dialog', { name: `Add ${catalog.name}?` }), onConfirm };
};
const detailsButton = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Details' });
// Opens Details when it is closed: the command and the file are inside it.
const openDetails = (sheet: HTMLElement) => {
  if (detailsButton(sheet).getAttribute('aria-expanded') === 'false') fireEvent.click(detailsButton(sheet));
};
const argv = (sheet: HTMLElement) => {
  openDetails(sheet);
  return JSON.parse(sheet.querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];
};
const add = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Add' }) as HTMLButtonElement;

describe('the connector sheet', () => {
  it('shows the name, publisher and tier, URL, transport, the exact command at user scope, and the file; Add runs it', () => {
    const { sheet, onConfirm } = open(connector());
    expect(within(sheet).getByText('by Linear · Partner')).toBeTruthy();
    expect(within(sheet).getByText('https://mcp.linear.app/mcp')).toBeTruthy();
    expect(within(sheet).getByText('HTTP (streamable)')).toBeTruthy();
    openDetails(sheet);
    expect(within(sheet).getByText('claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user')).toBeTruthy();
    expect(within(sheet).getByText('/cfg/.claude.json')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Project' }));
    expect(argv(sheet)).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'project']);
    expect(within(sheet).getByText('/p/.mcp.json')).toBeTruthy();
    fireEvent.click(add(sheet));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ action: 'mcp-add', input: { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'project' } }), '/engine/claude');
  });

  it('opens with the command and the file behind a closed Details, the name, URL, transport and scope in view; Details shows them', () => {
    const { sheet } = open(connector());
    expect(detailsButton(sheet).getAttribute('aria-expanded')).toBe('false');
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(sheet.querySelector('[data-connector-writes]')).toBeNull();
    expect(sheet.textContent).not.toContain('mcp add');
    expect(sheet.textContent).not.toContain('/cfg/.claude.json');
    expect((within(sheet).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('linear');
    expect(sheet.querySelector('[data-connector-url]')!.textContent).toBe('https://mcp.linear.app/mcp');
    expect(within(sheet).getByText('HTTP (streamable)')).toBeTruthy();
    expect((within(sheet).getByRole('radio', { name: 'User' }) as HTMLInputElement).checked).toBe(true);
    detailsButton(sheet).focus();
    expect(document.activeElement).toBe(detailsButton(sheet));
    fireEvent.click(detailsButton(sheet));
    expect(detailsButton(sheet).getAttribute('aria-expanded')).toBe('true');
    const region = within(sheet).getByRole('region', { name: 'Details' });
    expect(detailsButton(sheet).getAttribute('aria-controls')).toBe(region.id);
    expect(region.querySelector('[data-plugins-argv]')!.textContent).toBe('claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user');
    expect(region.querySelector('[data-connector-writes]')!.textContent).toBe('/cfg/.claude.json');
  });

  it('Remove: the command and the file behind a closed Details too, the scope and the acknowledgement in view', () => {
    render(<ConnectorSheet request={requestFor('mcp-remove', { name: 'linear', scope: 'user' }, null)} env={env()} onConfirm={() => {}} onClose={() => {}} />);
    const sheet = screen.getByRole('dialog', { name: 'Remove linear?' });
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(sheet.querySelector('[data-connector-writes]')).toBeNull();
    expect(within(sheet).getByRole('checkbox', { name: 'I understand' })).toBeTruthy();
    expect(sheet.querySelector('[data-plugins-scope]')!.textContent).toBe('Scope: User'); // which configuration it changes, in view
    expect(argv(sheet)).toEqual(['mcp', 'remove', 'linear', '--scope', 'user']);
    expect(sheet.querySelector('[data-connector-writes]')!.textContent).toBe('/cfg/.claude.json');
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
    const { sheet } = open(connector(), env({ configured: { state: 'read', servers: [{ name: 'linear', scope: 'local', path: '/cfg/.claude.json', transport: 'http' }] } }));
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

  it('refuses every URL against a pattern JavaScript cannot read, saying so before anything is typed', () => {
    const { sheet } = open(connector({ url: null, urlPattern: '^https://(?<a>x' }));
    expect(within(sheet).getByRole('alert').textContent).toBe('This server’s URL pattern can’t be checked.');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Your instance’s URL' }), { target: { value: 'https://x.example.com/mcp' } });
    expect(within(sheet).getByRole('alert').textContent).toBe('This server’s URL pattern can’t be checked.');
    expect(add(sheet).disabled).toBe(true);
  });

  it('adds nothing until what is configured here is read: reading, a failure with Retry, or a partial read with Retry', () => {
    const reading = open(connector(), env({ configured: { state: 'reading' } }));
    expect(within(reading.sheet).getByText('Reading what is configured here…').getAttribute('role')).toBe('status');
    expect(add(reading.sheet).disabled).toBe(true);
    cleanup();
    const retryServers = vi.fn();
    const failed = open(connector(), env({ configured: { state: 'failed', message: 'the engine host is not running' }, retryServers }));
    const alert = within(failed.sheet).getByRole('alert');
    expect(alert.textContent).toContain('What is configured here couldn’t be read: the engine host is not running');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(retryServers).toHaveBeenCalledTimes(1);
    expect(add(failed.sheet).disabled).toBe(true);
    cleanup();
    const partial = open(connector(), env({ configured: { state: 'partial' }, retryServers }));
    expect(within(partial.sheet).getByRole('alert').textContent).toContain('Not every configuration here could be read');
    expect(add(partial.sheet).disabled).toBe(true);
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

  it('with no scope to choose, the one scope stays in view outside Details, in the selector’s words', () => {
    const { sheet } = open(connector(), env({ cwd: null, runCwd: '/cfg' }));
    expect(within(sheet).queryByRole('radio')).toBeNull();
    expect(detailsButton(sheet).getAttribute('aria-expanded')).toBe('false');
    expect(sheet.querySelector('[data-plugins-scope]')!.textContent).toBe('Scope: User');
    cleanup();
    const project = open(connector()); // a project's page: the selector, no fixed line
    expect(within(project.sheet).getByRole('radio', { name: 'User' })).toBeTruthy();
    expect(project.sheet.querySelector('[data-plugins-scope]')).toBeNull();
  });

  it('names no command and confirms nothing until the engine is resolved', () => {
    const { sheet } = open(connector(), env({ engine: { state: 'loading' } }));
    expect(within(sheet).queryByRole('button', { name: 'Details' })).toBeNull(); // nothing to detail yet
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(add(sheet).disabled).toBe(true);
  });
});
