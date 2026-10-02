// R2: each element of the desktop surface's table as SurfaceTree draws it, and what each sends the engine, over a fake
// X2 bridge (the trees as 2.1.287 answered them in pass3/mods-surface-*).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import type { Site } from './actions';
import { SurfaceTree } from './SurfaceTree';
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

  it('a Client draws a muted note, and an engine node draws MAWS’s own', () => {
    setup({ type: 'Box', children: [{ type: 'Client', props: { key: 'board', module: 'hooks/board.tsx' }, client: { plugin: 'mods-probe' } }, { type: 'engine', ref: 0 }] });
    expect(screen.getByRole('note').textContent).toBe('mods-probe: this drawing needs a client module, which MAWS does not run yet');
    expect(screen.getByText('MAWS own')).toBeTruthy();
  });
});
