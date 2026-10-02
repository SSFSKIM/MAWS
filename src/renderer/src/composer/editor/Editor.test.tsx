import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { closeWidgetDialog, useWidgetDialog } from '../WidgetDialog'; // W3 (C6)
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { fakeClient } from '../../../../../test/support/fake-client';
import { connectKeys } from '../../keymap/dispatcher';
import { resetCatalogStore } from '../../stores/catalog';
import { prefillComposer, resetComposerStore } from '../../stores/composer';
import { registerSlashWidget } from '../mentions/widgets'; // C11
import { docOf, hardBreak, paragraph, pastedNode, textNode } from './doc';
import { Editor, type DraftPort, type EditorHandle } from './Editor';
import type { Serialized } from './serialize';

const APP = 'app-1' as AppSessionId;

const client = {
  invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: [] } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
  on: () => () => {},
  pathForFile: () => '',
} as unknown as MawsBridge;

function drafts(initial: Draft | null) {
  const saved: (Draft | null)[] = [];
  const port: DraftPort = { load: async () => initial, save: (d) => void saved.push(d) };
  return { port, saved };
}

let disconnect: () => void;
beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
});

const contentOf = (container: HTMLElement) => container.querySelector('[contenteditable]') as HTMLElement;

describe('the editor mounts over its draft, takes prefills and submits through the dispatcher', () => {
  it('marks only its root as the composer key sink and restores the stored draft', async () => {
    const { port } = drafts({ doc: docOf([paragraph(textNode('left over'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(contentOf(container).textContent).toBe('left over'));
    const sinks = container.querySelectorAll('[data-key-sink]');
    expect(sinks).toHaveLength(1);
    expect(sinks[0].getAttribute('data-key-sink')).toBe('composer');
    expect(sinks[0].contains(contentOf(container))).toBe(true);
    expect(handle.current?.serialize().display).toBe('left over');
  });

  it('replaces the document with a prefill and hands it to the caller', async () => {
    const onPrefill = vi.fn();
    const { port, saved } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onPrefill={onPrefill} />);
    act(() => prefillComposer(APP, { text: 'fix [Pasted text #1 +2 lines]', pasted: [{ name: 'Pasted text #1', text: 'a\nb' }] }));
    await waitFor(() => expect(onPrefill).toHaveBeenCalledTimes(1));
    expect(contentOf(container).textContent).toContain('fix');
    expect(handle.current?.serialize().pastedContents['1']?.content).toBe('a\nb');
    expect(saved).toEqual([]); // the write waits for the pause
  });

  it('sends on ⌘Enter from the editor through C5’s dispatcher, then clears and drops the draft', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => true);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('hello'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('hello'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ mode: 'send', content: 'hello', display: 'hello' });
    await waitFor(() => expect(content.textContent).toBe(''));
    expect(saved).toEqual([null]);
  });

  it('keeps the text when the submission is refused', async () => {
    const onSubmit = vi.fn(async () => false);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('keep me'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('keep me'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'keep me' })));
    expect(content.textContent).toBe('keep me');
    expect(saved).toEqual([]);
  });

  it('sends nothing on ⌥Enter: the hold chord is gone (W10)', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('not yet'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('not yet'));
    content.focus();
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(content.textContent).toBe('not yet');
  });

  it('sends on a plain Enter in a one-line document, and breaks the line with it once the document has more lines', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
    const multiline = docOf([paragraph(textNode('one'), hardBreak(), textNode('two'))]);
    const { port } = drafts({ doc: multiline, attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('one\ntwo'));
    content.focus();
    const enter = () => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await enter();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.doc().content).toHaveLength(2); // a new line, not a send
    act(() => handle.current?.clear());
    act(() => handle.current?.insertText('single'));
    await enter();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'single' })));
  });

  it('treats an open @ popup with no rows as no popup: Enter sends', async () => {
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    content.focus();
    act(() => handle.current?.insertText('see @zzz'));
    await waitFor(() => expect(document.querySelector('.react-renderer')).not.toBeNull()); // the @ popup is open, empty
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: 'see @zzz' })));
    expect(handle.current?.doc().content).toHaveLength(1);
  });

  it('the @ menu holds Enter while its file search lags the query: never the half-typed token, never a stale row', async () => {
    const fake = fakeClient();
    window.maws = fake.client;
    try {
      const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
      const { port } = drafts(null);
      const handle = createRef<EditorHandle>();
      const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
      const content = contentOf(container);
      content.focus();
      const enter = () => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
      const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => [o.textContent, o.getAttribute('aria-disabled')]);
      const answer = (paths: string[]) => act(() => fake.reply('git.lsFiles', { paths, truncated: false, source: 'git' }));

      act(() => handle.current?.insertText('see @sr'));
      await waitFor(() => expect(document.querySelector('.react-renderer')).not.toBeNull()); // the @ popup is open
      await enter(); // before the first answer
      expect(onSubmit).not.toHaveBeenCalled();
      expect(handle.current?.serialize().display).toBe('see @sr');
      expect(options()).toEqual([['Searching files…', 'true']]);
      await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
      await answer(['src/a.ts']);
      expect(options()).toEqual([['src/a.ts', null]]);

      act(() => handle.current?.insertText('c/b'));
      await enter(); // at once, before the menu has even rendered the new query
      expect(handle.current?.serialize().display).toBe('see @src/b'); // no stale row picked
      await waitFor(() => expect(options()).toEqual([['Searching files…', 'true']])); // the previous query's rows are gone
      await enter();
      expect(handle.current?.serialize().display).toBe('see @src/b');
      await waitFor(() => expect(fake.pending('git.lsFiles')).toBe(1));
      await answer(['src/b.ts']);
      await enter();
      expect(handle.current?.serialize().display).toBe('see @src/b.ts');
      expect(JSON.stringify(handle.current?.doc())).toContain('"id":"src/b.ts"'); // the chip, from the current query's row
      expect(onSubmit).not.toHaveBeenCalled();
      expect(fake.invoked('git.lsFiles')).toEqual([
        { directory: '/repo', query: 'sr', limit: 30 },
        { directory: '/repo', query: 'src/b', limit: 30 },
      ]);
    } finally {
      delete (window as { maws?: MawsBridge }).maws;
    }
  });

  it('a recalled bare slash command opens no palette: the arrows keep walking history and Enter sends', async () => {
    const entry = (display: string, at: string) => ({ display, at, source: 'maws', sessionId: null, pastedContents: {} });
    const history = [entry('/compact', '2026-09-29T09:01:00.000Z'), entry('hello', '2026-09-29T09:00:00.000Z')];
    const recalling = {
      ...client,
      invoke: vi.fn(async (name: string) => (name === 'session.history.list' ? { ok: true, value: { entries: history } } : { ok: false, error: { code: 'internal', message: 'no session' } })),
    } as unknown as MawsBridge;
    const onSubmit = vi.fn<(s: Serialized) => Promise<boolean>>(async () => false);
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={recalling} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(recalling.invoke).toHaveBeenCalledWith('session.history.list', expect.anything()));
    content.focus();
    const press = (key: string) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await press('ArrowUp');
    expect(handle.current?.serialize().display).toBe('/compact');
    await new Promise((resolve) => requestAnimationFrame(resolve)); // past Tiptap's deferred focus
    expect(document.querySelector('[role="listbox"]')).toBeNull(); // no palette over the recalled entry
    await press('ArrowUp');
    expect(handle.current?.serialize().display).toBe('hello');
    await press('ArrowDown');
    expect(handle.current?.serialize().display).toBe('/compact');
    await press('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/compact' })));
  });

  it('numbers pasted chips in document order, as display and pastedContents do', async () => {
    const atom = (name: string, text: string) => pastedNode({ id: name, kind: 'text', name, lines: 1, text });
    const { port } = drafts({ doc: docOf([paragraph(atom('Pasted text #2', 'first'), textNode(' and '), atom('notes.txt', 'second'), atom('Pasted text #1', 'third'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(container.querySelectorAll('[data-pasted]')).toHaveLength(3));
    await waitFor(() => expect([...container.querySelectorAll('[data-pasted]')].map((el) => el.textContent)).toEqual(['Pasted text #1 +1 lines', 'notes.txt +1 lines', 'Pasted text #3 +1 lines']));
    expect(handle.current?.serialize().display).toBe('[Pasted text #1 +1 lines] and [Pasted text #2 +1 lines][Pasted text #3 +1 lines]');
  });

  it('carries the attachments with the document it restores, and drops them with the document it clears', async () => {
    const shot = { id: 'a1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
    const { port } = drafts({ doc: docOf([paragraph(textNode('look'))], [shot]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('look [Image #1]'));
    act(() => handle.current?.clear());
    expect(handle.current?.serialize()).toMatchObject({ display: '', empty: true });
  });
});

// C11 start: the widget seam C11 added to the editor (C11 execution document, the Arguments rule; Decision (M2) item 11):
// a typed `/<name> <args>` for a registered widget opens it with its argument, and the handle opens one with an argument.
describe('a registered widget named at Enter opens with its argument', () => {
  // W3 (C6): a widget opens as the app's floating dialog, never in the box: what the dialog host was asked to show
  const opened = (container: HTMLElement) => {
    expect(container.querySelector('[data-test-widget]'), 'nothing in the box').toBeNull();
    const open = useWidgetDialog.getState().open;
    return open ? `${open.name}:${open.args}` : null;
  };
  let off: () => void;
  beforeEach(() => {
    closeWidgetDialog();
    const offs = (['model', 'compact'] as const).map((name) =>
      registerSlashWidget(name, { title: name, component: ({ args }: { args: string }) => <p data-test-widget>{`${name}:${args}`}</p> }),
    );
    off = () => offs.forEach((o) => o());
  });
  afterEach(() => off());

  const enter = (content: HTMLElement) => act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));

  it('opens the widget with the typed argument in place of sending, and clears the document and its draft', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port, saved } = drafts({ doc: docOf([paragraph(textNode('/model haiku'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/model haiku'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('model:haiku'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(saved).toEqual([null]);
  });

  it('keeps the whole rest of the line as the argument, and none when only the name is typed', async () => {
    const { port } = drafts({ doc: docOf([paragraph(textNode('/compact focus on tests'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={vi.fn(async () => true)} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/compact focus on tests'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('compact:focus on tests'));
    act(() => handle.current?.insertText('/model'));
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('model:'));
  });

  it('sends a command no widget is registered for, as before', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/review the diff'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/review the diff'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/review the diff' })));
    expect(opened(container)).toBeNull();
  });

  it('sends a multi-line draft that starts with a widget name as text: nothing after the first line is lost', async () => {
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/model haiku'), hardBreak(), textNode('and the rest of the note'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().display).toBe('/model haiku\nand the rest of the note'));
    act(() => handle.current?.submit()); // ⌘Enter's path: a multi-line document never sends on a plain Enter
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/model haiku\nand the rest of the note' })));
    expect(opened(container)).toBeNull();
  });

  // The architect's correction (2026-09-29): an argument the widget resolves applies with no widget shown.
  it('hands a typed argument to the widget’s apply first: applied, nothing opens; not applied, the widget opens with it', async () => {
    const apply = vi.fn(async (_id: string, args: string) => args === 'opus');
    const offApply = registerSlashWidget('effort', { title: 'effort', component: ({ args }: { args: string }) => <p data-test-widget>{`effort:${args}`}</p>, apply });
    const onSubmit = vi.fn(async () => true);
    const { port } = drafts({ doc: docOf([paragraph(textNode('/effort opus'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/effort opus'));
    content.focus();
    await enter(content);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'opus', expect.any(AbortSignal)));
    expect(opened(container), 'applied: no widget').toBeNull();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => handle.current?.insertText('/effort extreme'));
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('effort:extreme'));
    expect(apply).toHaveBeenLastCalledWith(APP, 'extreme', expect.any(AbortSignal));

    act(() => handle.current?.insertText('/effort'));
    apply.mockClear();
    await enter(content);
    await waitFor(() => expect(opened(container)).toBe('effort:'));
    expect(apply, 'no argument: the widget opens as built').not.toHaveBeenCalled();
    offApply();
  });

  // C11 start (M4 fix wave re-review, carried Minor): the draft is gone at Enter, so a decision that takes long (a catalogue
  // read, up to its 8 s bound) must not leave nothing on screen and then open the widget late over new typing: the editor
  // opens it after a short bound and tells `apply` it is too late to apply.
  it("opens the widget when apply has not decided within the bound, and signals apply that it is too late", async () => {
    let signal: AbortSignal | null = null;
    let decide: (applied: boolean) => void = () => {};
    const apply = vi.fn((_id: string, _args: string, given?: AbortSignal) => {
      signal = given ?? null;
      return new Promise<boolean>((resolve) => (decide = resolve));
    });
    const offApply = registerSlashWidget('effort', { title: 'effort', component: ({ args }: { args: string }) => <p data-test-widget>{`effort:${args}`}</p>, apply });
    const { port } = drafts({ doc: docOf([paragraph(textNode('/effort high'))]), attachments: [], updatedAt: '2026-09-29T00:00:00.000Z' });
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={vi.fn(async () => true)} />);
    const content = contentOf(container);
    await waitFor(() => expect(content.textContent).toBe('/effort high'));
    content.focus();
    await enter(content);
    expect(opened(container), 'undecided: nothing yet').toBeNull();
    await waitFor(() => expect(opened(container)).toBe('effort:high'), { timeout: 1_000 });
    expect(signal!.aborted, 'apply is told the editor stopped waiting').toBe(true);
    await act(async () => decide(false)); // a late answer opens nothing a second time
    expect(opened(container)).toBe('effort:high');
    offApply();
  });
  // C11 end

  it('opens a widget through the handle with an argument', async () => {
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={drafts(null).port} client={client} handle={handle} />);
    act(() => void handle.current?.openWidget('compact', 'keep the plan'));
    await waitFor(() => expect(opened(container)).toBe('compact:keep the plan'));
    expect(handle.current?.openWidget('status', '')).toBe(false); // none registered for it
  });
});
// C11 end


describe('draft and submission races', () => {
  it.each(['clear', 'send'])('does not restore an old draft after the user chose to %s while loading', async (action) => {
    let loaded!: (draft: Draft | null) => void;
    const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn() };
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={async () => true} />);
    act(() => handle.current!.insertText('new thought'));
    await act(async () => { if (action === 'clear') handle.current!.clear(); else handle.current!.submit(); });
    expect(handle.current!.serialize().empty).toBe(true);
    await act(async () => loaded({ doc: docOf([paragraph(textNode('old thought'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
    expect(handle.current!.serialize().empty).toBe(true);
  });

  it('refuses picked attachments while a submission is pending', async () => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
    await act(async () => handle.current!.insertText('send me'));
    await act(async () => handle.current!.submit());
    await act(async () => handle.current!.attachPicked([{ path: '/repo/late.pdf', name: 'late.pdf', mediaType: 'application/pdf', bytes: 3, data: 'YWJj' }]));
    expect(handle.current!.doc().attrs?.attachments).toEqual([]);
    await act(async () => answer(true));
    expect(handle.current!.serialize().empty).toBe(true);
  });

  it.each([true, false])('owns a pending submission across tab remounts (accepted=%s)', async (accepted) => {
    let answer!: (accepted: boolean) => void;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    let stored: Draft | null = { doc: docOf([paragraph(textNode('send once'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' };
    const port: DraftPort = { load: async () => stored, save: (draft) => { stored = draft; } };
    const handle = createRef<EditorHandle>();
    const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />;
    const first = render(view());
    await waitFor(() => expect(handle.current!.serialize().display).toBe('send once'));
    await act(async () => handle.current!.submit());
    first.unmount();
    const second = render(view());
    await waitFor(() => expect(handle.current!.serialize().display).toBe('send once'));
    await act(async () => handle.current!.submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(contentOf(second.container).getAttribute('contenteditable')).toBe('false');
    await act(async () => answer(accepted));
    expect(handle.current!.serialize().display).toBe(accepted ? '' : 'send once');
    expect(contentOf(second.container).getAttribute('contenteditable')).toBe('true');
    if (accepted) expect(stored).toBeNull();
  });
});


it.each([false, true])('ignores a PDF read started before submission that finishes after acceptance=%s', async (finishSendFirst) => {
  let answer!: (accepted: boolean) => void;
  let read!: (bytes: ArrayBuffer) => void;
  const file = new File(['abc'], 'late.pdf', { type: 'application/pdf' });
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { read = resolve; }));
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const { port } = drafts(null);
  const handle = createRef<EditorHandle>();
  const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
  await act(async () => handle.current!.insertText('send me'));
  fireEvent.drop(container.querySelector('[data-key-sink]')!, { dataTransfer: { files: [file] } });
  expect(file.arrayBuffer).toHaveBeenCalledOnce();
  await act(async () => handle.current!.submit());
  if (finishSendFirst) await act(async () => answer(true));
  await act(async () => read(new Uint8Array([97, 98, 99]).buffer));
  expect(handle.current!.doc().attrs?.attachments).toEqual([]);
  if (!finishSendFirst) await act(async () => answer(true));
  expect(handle.current!.serialize().empty).toBe(true);
});
