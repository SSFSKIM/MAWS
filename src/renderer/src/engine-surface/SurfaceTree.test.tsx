// R2: each element of the desktop surface's table as SurfaceTree draws it, and what each sends the engine, over a fake
// X2 bridge (the trees as 2.1.287 answered them in pass3/mods-surface-*).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { DEFAULT_ACTIONS, registerTranscriptActions } from '../transcript';
import { Disclosures, NO_ACTIONS, setHostActions, TranscriptProvider, type TranscriptContextValue } from '../transcript/view/context';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout'; // UX wave U6b-4b
import { FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import type { PreloadBridge } from '@shared/ipc/schema';
import { bareOf } from '@shared/machine/address';
import { at } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { codeTranscriptActions } from '../tools/code/open-file';
import { FileViewer } from '../tools/code/viewer/FileViewer';
import { useViewer } from '../tools/code/viewer/viewer-store';
import type { Site } from './actions';
import { fenced, SurfaceTree } from './SurfaceTree';
import { parseTree, type SurfaceNode } from './tree';

const offs: (() => void)[] = [];
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

const ID = 'app-r2' as AppSessionId;
const ARTIFACT = '0b4f3c1e-6a2d-4c8e-9f1a-2b3c4d5e6f70';
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

  // P3-F wave S (F14, the owner's obs 2): a plugin's Markdown names an artifact as the transcript does, and the chip
  // opens it for the surface's session
  it('a Markdown artifact link opens the artifact in the site session’s panel, and in its main tab on ⌘-click', () => {
    const openArtifact = vi.fn();
    const openArtifactTab = vi.fn();
    offs.push(registerTranscriptActions({ openArtifact, openArtifactTab }));
    // App.tsx's host actions, which a surface's Markdown reads outside any Transcript: the chip is drawn where they can
    // open a main tab (F14 review 2)
    setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab });
    offs.push(() => setHostActions(DEFAULT_ACTIONS));
    const fake = setup({ type: 'Markdown', props: { text: `[the plan](maws-artifact:${ARTIFACT})`, key: 'md' }, press: { plugin: 'mods-probe', handle: 12 } });
    const chip = screen.getByRole('button', { name: 'the plan' });
    fireEvent.click(chip);
    expect(openArtifact).toHaveBeenCalledWith(ID, ARTIFACT);
    fireEvent.click(chip, { metaKey: true });
    expect(openArtifactTab).toHaveBeenCalledWith(ARTIFACT);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(fake.invoked('session.ui.press')).toEqual([]); // MAWS's own chip: nothing is pressed in the plugin
  });

  // P4-B4: the link's fragment opens it at its place there too
  it('a Markdown artifact link with a fragment opens the artifact at its place', () => {
    const openArtifact = vi.fn();
    const openArtifactTab = vi.fn();
    offs.push(registerTranscriptActions({ openArtifact, openArtifactTab }));
    setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab });
    offs.push(() => setHostActions(DEFAULT_ACTIONS));
    setup({ type: 'Markdown', props: { text: `[the block](maws-artifact:${ARTIFACT}#tab=t2&block=b7)`, key: 'md' } });
    const chip = screen.getByRole('button', { name: 'the block' });
    fireEvent.click(chip);
    expect(openArtifact).toHaveBeenCalledWith(ID, ARTIFACT, undefined, { tab: 't2', block: 'b7' });
    fireEvent.click(chip, { metaKey: true });
    expect(openArtifactTab).toHaveBeenCalledWith(ARTIFACT, { tab: 't2', block: 'b7' });
  });

  // UX wave U6d (decision 8): a key on the link is a click on it, so under a surface the key opens through the
  // surface's capture, for the surface's session, and never through the link's own handler (the host actions here
  // would open a main tab)
  it('a Markdown artifact link opens on Enter for the site session, and in its main tab on ⌘Enter, through the surface', () => {
    const openArtifact = vi.fn();
    const openArtifactTab = vi.fn();
    const hostTab = vi.fn();
    offs.push(registerTranscriptActions({ openArtifact, openArtifactTab }));
    setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab: hostTab });
    offs.push(() => setHostActions(DEFAULT_ACTIONS));
    const fake = setup({ type: 'Markdown', props: { text: `[the plan](maws-artifact:${ARTIFACT})`, key: 'md' }, press: { plugin: 'mods-probe', handle: 12 } });
    const link = screen.getByRole('button', { name: 'the plan' });
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(link, { key: ' ' })).toBe(false);
    expect(openArtifact.mock.calls).toEqual([[ID, ARTIFACT], [ID, ARTIFACT]]);
    fireEvent.keyDown(link, { key: 'Enter', metaKey: true });
    expect(openArtifactTab.mock.calls).toEqual([[ARTIFACT]]);
    expect(hostTab).not.toHaveBeenCalled();
    expect(fake.invoked('session.ui.press')).toEqual([]);
  });

  // card C5 ("Show that tab"): the surface's click follows the same rule as the transcript's (Link.tsx's
  // openArtifactMention), so a main tab that already shows the artifact comes forward, at the link's place
  it('a Markdown artifact link shows the main tab that already holds the artifact, and opens nothing beside the chat', () => {
    const openArtifact = vi.fn();
    const showOpenArtifactTab = vi.fn(() => true);
    offs.push(registerTranscriptActions({ openArtifact, openArtifactTab: vi.fn(), showOpenArtifactTab }));
    setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab: vi.fn() });
    offs.push(() => setHostActions(DEFAULT_ACTIONS));
    setup({ type: 'Markdown', props: { text: `[the plan](maws-artifact:${ARTIFACT}) and [the block](maws-artifact:${ARTIFACT}#block=b7)`, key: 'md' } });
    fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'the block' }));
    expect(showOpenArtifactTab.mock.calls).toEqual([[ID, ARTIFACT], [ID, ARTIFACT, { block: 'b7' }]]);
    expect(openArtifact).not.toHaveBeenCalled();
  });

  // decision 12: a click that ends a selection in the link's text opens nothing under a surface either
  it('a Markdown artifact link opens nothing on a click that ends a selection in its text', () => {
    const openArtifact = vi.fn();
    offs.push(registerTranscriptActions({ openArtifact, openArtifactTab: vi.fn() }));
    setHostActions({ ...DEFAULT_ACTIONS, openArtifactTab: vi.fn() });
    offs.push(() => setHostActions(DEFAULT_ACTIONS));
    const fake = setup({ type: 'Markdown', props: { text: `[the long plan](maws-artifact:${ARTIFACT})`, key: 'md' }, press: { plugin: 'mods-probe', handle: 12 } });
    const link = screen.getByRole('button', { name: 'the long plan' });
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(link.firstChild!, 2);
    range.setEnd(link.firstChild!, 6);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      fireEvent.click(link, { detail: 1 });
      expect(openArtifact).not.toHaveBeenCalled();
      expect(fake.invoked('session.ui.press')).toEqual([]);
    } finally {
      selection.removeAllRanges();
    }
    fireEvent.click(link, { detail: 1 });
    expect(openArtifact).toHaveBeenCalledWith(ID, ARTIFACT);
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

// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R4, L6): a path chip in a plugin's Markdown
// opens the file through the registered opener for the surface's own session, outside a transcript and inside a row of
// another session's; the surface's capture handler is not given the chip, and nothing is pressed in the plugin.
describe('a path in a surface’s Markdown (U6b-4b)', () => {
  const ROW = 'app-row' as AppSessionId;
  const transcriptOf = (rowOpenFile: () => void): TranscriptContextValue => ({
    storeKey: ROW, variant: 'session', actions: { ...NO_ACTIONS, openFile: rowOpenFile }, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'row',
  });
  const draw = (text: string, inRow: TranscriptContextValue | null = null, appSessionId: AppSessionId = ID) => {
    const fake = fakeClient({ 'session.ui.press': { handled: true, element: null }, 'layout.openExternal': undefined, 'files.watch': undefined, 'files.unwatch': undefined });
    const site: Site = { appSessionId, component: 'Pane', instanceId: 'mods-probe-pane', client: fake.client };
    const tree = <SurfaceTree tree={parseTree({ type: 'Box', children: [{ type: 'Markdown', props: { text, key: 'md' }, press }, { type: 'Code', props: { source: 'const probe = 1', language: 'ts' } }] }) as SurfaceNode} site={site} />;
    render(inRow ? <TranscriptProvider value={inRow}>{tree}</TranscriptProvider> : tree);
    return fake;
  };

  it('a click opens the file at its line for the site’s session, ⌘ in the main area; nothing pressed, nothing opened externally', async () => {
    const openFile = vi.fn();
    offs.push(registerTranscriptActions({ openFile }));
    const fake = draw('See [a](/work/a.ts#L12).');
    const chip = await screen.findByTitle('/work/a.ts');
    fireEvent.click(chip);
    fireEvent.click(chip, { metaKey: true });
    expect(openFile.mock.calls).toEqual([
      ['/work/a.ts', 12, ID, { main: false }],
      ['/work/a.ts', 12, ID, { main: true }],
    ]);
    expect(fake.invoked('session.ui.press')).toEqual([]);
    expect(fake.invoked('layout.openExternal')).toEqual([]);
  });

  it('inside a transcript row of another session, the chip still opens for the site’s session, and the row’s opener is not asked', async () => {
    const openFile = vi.fn();
    const rowOpenFile = vi.fn();
    offs.push(registerTranscriptActions({ openFile }));
    draw('See [a](/work/a.ts#L12).', transcriptOf(rowOpenFile));
    fireEvent.click(await screen.findByTitle('/work/a.ts'), { metaKey: true });
    expect(openFile.mock.calls).toEqual([['/work/a.ts', 12, ID, { main: true }]]);
    expect(rowOpenFile).not.toHaveBeenCalled();
  });

  it('a path outside the folders makes one read, by name, for the site’s session, refused as today', async () => {
    const SESSION = at('app-r2' as AppSessionId);
    offs.push(registerTranscriptActions(codeTranscriptActions));
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    useViewer.getState().reset();
    const fake = draw('See [o](/elsewhere/o.md).', null, SESSION);
    window.maws = fake.client as unknown as PreloadBridge;
    offs.push(() => delete (window as { maws?: unknown }).maws);
    fireEvent.click(await screen.findByTitle('/elsewhere/o.md'), { metaKey: true });
    const tab = allTabs(useLayout.getState().main).find((t): t is Extract<typeof t, { kind: 'file' }> => t.kind === 'file');
    expect(tab).toMatchObject({ path: '/elsewhere/o.md', appSessionId: SESSION });
    render(<FileViewer tab={tab!} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(fake.invoked('files.read')).toEqual([{ appSessionId: bareOf(SESSION), path: '/elsewhere/o.md', offset: 0, length: FILES_READ_DEFAULT_LENGTH, hash: true, named: true }]);
    await act(() => fake.fail('files.read', "path outside the session's directories"));
    // UX wave U6b-4b (M3): the first notice, as this Mac says it: its sentences and the path
    expect([...document.querySelectorAll('[data-refusal] p')].map((p) => p.textContent)).toEqual([
      'This file is outside the folders this session works in.',
      'Choose it with File ▸ Open File…', // the word cut (N7)
      'Ask the agent to send the file to see it here.',
      '/elsewhere/o.md', // the word cut (N11): no command's words under a notice that names its cause
    ]);
  });
});
