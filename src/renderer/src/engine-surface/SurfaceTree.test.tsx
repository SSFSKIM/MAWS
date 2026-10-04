// R2: each element of the desktop surface's table as SurfaceTree draws it, and what each sends the engine, over a fake
// X2 bridge (the trees as 2.1.287 answered them in pass3/mods-surface-*).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import type { Site } from './actions';
import { fenced, SurfaceTree } from './SurfaceTree';
import { parseTree, type SurfaceNode } from './tree';

afterEach(cleanup);

const ID = 'app-r2' as AppSessionId;
function setup(raw: unknown, engine: React.ReactNode = <span>MAWS own</span>) {
  const fake = fakeClient({ 'session.ui.press': { handled: true, element: null }, 'session.ui.input': { handled: true, element: null, value: null }, 'session.ui.select': { handled: true, element: null, value: null }, 'layout.openExternal': undefined });
  const site: Site = { appSessionId: ID, component: 'Pane', instanceId: 'mods-probe-pane', client: fake.client };
  render(<SurfaceTree tree={parseTree(raw) as SurfaceNode} site={site} engine={engine} />);
  return fake;
}
const press = { plugin: 'mods-probe', handle: 6 };

describe('SurfaceTree (R2)', () => {
  it('Box is a flex box in cells and Text a span with its styles, strings in a Box wrapped as Text', () => {
    setup({ type: 'Box', props: { flexDirection: 'column', gap: 1, paddingX: 2, borderStyle: 'round', borderColor: 'cyan' }, children: ['loose', { type: 'Text', props: { bold: true, color: 'red', dimColor: true }, children: ['styled'] }, { type: 'Text', props: { color: 'ansi256(201)', inverse: true }, children: ['inverse'] }] });
    const box = document.querySelector<HTMLElement>('[data-surface="box"]')!;
    expect(box.style.display).toBe('flex');
    expect(box.style.flexDirection).toBe('column');
    expect(box.style.rowGap).toBe('1lh');
    expect(box.style.columnGap).toBe('1ch');
    expect(box.style.paddingLeft).toBe('2ch');
    expect(box.style.borderColor).toBe('var(--term-ansi-cyan)');
    expect(box.style.borderRadius).toBe('var(--radius-sm)');
    expect(screen.getByText('loose').tagName).toBe('SPAN');
    const styled = screen.getByText('styled');
    expect(styled.style.fontWeight).toBe('600');
    expect(styled.style.color).toBe('var(--term-ansi-red)'); // a colour wins over dim
    const inverse = screen.getByText('inverse');
    expect(inverse.style.color).toBe('var(--bg)'); // a colour not spelled by name is not a token: the default, inverted
    expect(inverse.style.backgroundColor).toBe('var(--fg)');
  });

  it('a Button presses its plugin handle with its key; primary, dismiss and plain draw as such', async () => {
    const fake = setup({ type: 'Box', children: [
      { type: 'Button', props: { key: 'press', label: 'Press', variant: 'primary' }, press: { plugin: 'mods-probe', handle: 1 } },
      { type: 'Button', props: { key: 'close', label: 'Close', role: 'dismiss' }, press: { plugin: 'mods-probe', handle: 9 } },
      { type: 'Button', props: { key: 'yes', label: 'Yes', plain: true, hotkey: '1' }, press: { plugin: 'mods-probe', handle: 3 } },
    ] });
    await userEvent.click(screen.getByRole('button', { name: 'Press' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Close' }).textContent).toBe('×');
    expect(screen.getByRole('button', { name: /Yes/ }).textContent).toBe('1: Yes');
    expect(screen.getByRole('button', { name: 'Press' }).className).toContain('bg-accent');
    expect(fake.invoked('session.ui.press')).toEqual([
      { appSessionId: ID, plugin: 'mods-probe', handle: 1, key: 'press' },
      { appSessionId: ID, plugin: 'mods-probe', handle: 9, key: 'close' },
    ]);
  });

  it('an Input sends each change and Enter with its site, and shows what Enter does while focused', async () => {
    const fake = setup({ type: 'Input', props: { key: 'reply', label: 'Reply', placeholder: 'Type here', value: '', submitLabel: 'Send' }, press: { plugin: 'mods-probe', handle: 7 } });
    const field = screen.getByRole('textbox', { name: 'Reply' });
    expect(field.getAttribute('placeholder')).toBe('Type here');
    await userEvent.type(field, 'hi{Enter}');
    expect(screen.getByText('↵ Send')).toBeTruthy();
    const site = { component: 'Pane', instanceId: 'mods-probe-pane' };
    expect(fake.invoked('session.ui.input')).toEqual([
      { appSessionId: ID, plugin: 'mods-probe', handle: 7, kind: 'change', value: 'h', key: 'reply', ...site },
      { appSessionId: ID, plugin: 'mods-probe', handle: 7, kind: 'change', value: 'hi', key: 'reply', ...site },
      { appSessionId: ID, plugin: 'mods-probe', handle: 7, kind: 'submit', value: 'hi', key: 'reply', ...site },
    ]);
  });

  it('a Select sends the picked value', async () => {
    const fake = setup({ type: 'Select', props: { key: 'pick', label: 'Pick', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], value: 'one' }, press });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pick' }), 'two');
    expect(fake.invoked('session.ui.select')).toEqual([{ appSessionId: ID, plugin: 'mods-probe', handle: 6, value: 'two', key: 'pick', component: 'Pane', instanceId: 'mods-probe-pane' }]);
  });

  it('a Link opens through the app’s link handling, never navigating', async () => {
    const fake = setup({ type: 'Link', props: { href: 'https://example.com/mods-probe', label: 'Probe link' } });
    const link = screen.getByRole('link', { name: 'Probe link' });
    expect(fireEvent.click(link)).toBe(false); // default prevented
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://example.com/mods-probe' }]);
  });

  it('Code and Markdown draw through the transcript’s markdown; a Markdown link opens, or presses when its plugin answers it', async () => {
    const fake = setup({ type: 'Box', children: [
      { type: 'Code', props: { source: 'const probe = 1', language: 'ts' } },
      { type: 'Markdown', props: { text: '**MODS_PROBE_MD** with [a link](https://example.com/md)' } },
      { type: 'Markdown', props: { text: '[pressed](https://example.com/p)', key: 'md' }, press: { plugin: 'mods-probe', handle: 12 } },
    ] });
    expect(await screen.findByText('MODS_PROBE_MD')).toBeTruthy();
    expect((await screen.findByText(/const probe = 1|const/)).closest('[data-surface="code"]')).not.toBeNull();
    fireEvent.click(await screen.findByText('a link'));
    fireEvent.click(await screen.findByText('pressed'));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://example.com/md' }]);
    expect(fake.invoked('session.ui.press')).toEqual([{ appSessionId: ID, plugin: 'mods-probe', handle: 12, key: 'md', href: 'https://example.com/p' }]);
  });

  it('an Svg is a data: image, or a frame with an empty sandbox when interactive', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>';
    setup({ type: 'Box', children: [{ type: 'Svg', props: { source: svg, alt: 'Probe dot', width: 16, height: 16 } }, { type: 'Svg', props: { source: svg, alt: 'Live dot', isInteractive: true } }] });
    const image = screen.getByRole('img', { name: 'Probe dot' }) as HTMLImageElement;
    expect(image.src.startsWith('data:image/svg+xml')).toBe(true);
    const frame = screen.getByTitle('Live dot') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(svg);
  });

  it('a Client draws MAWS native rather than a deferred-feature note', () => {
    setup({ type: 'Client', props: { key: 'board', module: 'hooks/board.tsx' }, client: { plugin: 'mods-probe' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getAllByText('MAWS own')).toHaveLength(1);
  });

  it('a field keeps what was typed in it when the plugin draws another field before it', async () => {
    const fake = fakeClient({ 'session.ui.input': { handled: true, element: null, value: null } });
    const site: Site = { appSessionId: ID, component: 'AbovePrompt', instanceId: 'above-prompt', client: fake.client };
    const field = (key: string, handle: number) => ({ type: 'Input', props: { key, label: key, value: '' }, press: { plugin: 'mods-probe', handle } });
    const view = render(<SurfaceTree tree={parseTree({ type: 'Box', children: [field('first', 1)] }) as SurfaceNode} site={site} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'first' }), 'typed');
    view.rerender(<SurfaceTree tree={parseTree({ type: 'Box', children: [field('second', 2), field('first', 3)] }) as SurfaceNode} site={site} />);
    expect((screen.getByRole('textbox', { name: 'first' }) as HTMLInputElement).value).toBe('typed');
    expect((screen.getByRole('textbox', { name: 'second' }) as HTMLInputElement).value).toBe('');
  });

  it('a root field replaced by another field does not carry what was typed into it', async () => {
    const fake = fakeClient({ 'session.ui.input': { handled: true, element: null, value: null } });
    const site: Site = { appSessionId: ID, component: 'AbovePrompt', instanceId: 'above-prompt', client: fake.client };
    const field = (key: string) => parseTree({ type: 'Input', props: { key, label: key, value: '' }, press: { plugin: 'mods-probe', handle: 1 } }) as SurfaceNode;
    const view = render(<SurfaceTree tree={field('first')} site={site} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'first' }), 'typed');
    view.rerender(<SurfaceTree tree={field('second')} site={site} />);
    expect((screen.getByRole('textbox', { name: 'second' }) as HTMLInputElement).value).toBe('');
  });
});

it('only the first engine node receives the native row, including duplicate refs', () => {
  setup({ type: 'Box', children: [{ type: 'engine', ref: 3 }, 'middle', { type: 'engine', ref: 8 }, { type: 'engine', ref: 3 }] });
  expect(screen.getAllByText('MAWS own')).toHaveLength(1);
  expect(document.querySelector('[data-surface="box"]')?.textContent).toBe('MAWS ownmiddle');
});

it('native engine placement wins over Client fallbacks before or after it', () => {
  const client = { type: 'Client', props: { key: 'board', module: 'board.js' }, client: { plugin: 'probe' } };
  setup({ type: 'Box', children: [client, 'before slot', { type: 'engine', ref: 7 }, 'after slot', client] });
  expect(screen.getAllByText('MAWS own')).toHaveLength(1);
  expect(document.querySelector('[data-surface="box"]')?.textContent).toBe('before slotMAWS ownafter slot');
});

it('without an engine slot only the first Client draws native', () => {
  const client = { type: 'Client', props: { key: 'board', module: 'board.js' }, client: { plugin: 'probe' } };
  setup({ type: 'Box', children: [client, 'between clients', client] });
  expect(screen.getAllByText('MAWS own')).toHaveLength(1);
  expect(document.querySelector('[data-surface="box"]')?.textContent).toBe('MAWS ownbetween clients');
});


describe('accepted tree safety (FX1)', () => {
  it('fences a bounded source with many separate backtick runs without exhausting call arguments', () => {
    const source = '` '.repeat(125_000) + '````';
    expect(parseTree({ type: 'Code', props: { source } })).not.toBeNull();
    expect(fenced(source, 'text')).toBe('`````text\n' + source + '\n`````');
  });

  it('normalizes lone SVG surrogates before forming the image URI', () => {
    setup({ type: 'Svg', props: { source: '<svg>\ud800</svg>', alt: 'Malformed source' } });
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%3E%EF%BF%BD%3C%2Fsvg%3E');
  });

  it('refuses an oversized input change locally and explains it, then accepts a valid edit', () => {
    const fake = setup({ type: 'Input', props: { key: 'field', value: 'kept' }, press });
    const field = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'x'.repeat(16_385) } });
    expect(field.value).toBe('kept');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/16,384/);
    expect(fake.invoked('session.ui.input')).toHaveLength(0);
    fireEvent.change(field, { target: { value: 'x'.repeat(16_384) } });
    expect(field.value).toHaveLength(16_384);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fake.invoked('session.ui.input')).toHaveLength(1);
  });

  it('refuses oversized select values without changing the selected value or crossing IPC', () => {
    const huge = 'x'.repeat(16_385);
    const fake = setup({ type: 'Select', props: { key: 'pick', value: 'ok', options: [{ value: 'ok' }, { value: huge, label: 'Too long' }] }, press });
    const field = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(field, { target: { value: huge } });
    expect(field.value).toBe('ok');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/16,384/);
    expect(fake.invoked('session.ui.select')).toHaveLength(0);
  });

  it('an oversized drawn input cannot submit until corrected', () => {
    const fake = setup({ type: 'Input', props: { key: 'field', value: 'x'.repeat(16_385) }, press });
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(fake.invoked('session.ui.input')).toHaveLength(0);
  });
});
