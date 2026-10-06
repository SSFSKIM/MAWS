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
import { prefillComposer, resetComposerStore, useComposerStore } from '../../stores/composer';
import { useNotices } from '../../stores/notices'; // E3
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

describe('no-op Enter retains pending draft work', () => {
  it('restores a stored draft after empty Enter during loading', async () => {
    let loaded!: (draft: Draft | null) => void;
    const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn() };
    const handle = createRef<EditorHandle>();
    const onSubmit = vi.fn(async () => true);
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />);
    fireEvent.keyDown(contentOf(container), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => loaded({ doc: docOf([paragraph(textNode('stored thought'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
    expect(handle.current!.serialize().display).toBe('stored thought');
  });

  it('keeps a PDF read that finishes after empty Enter', async () => {
    let read!: (bytes: ArrayBuffer) => void;
    const file = new File(['abc'], 'pending.pdf', { type: 'application/pdf' });
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => { read = resolve; }));
    const handle = createRef<EditorHandle>();
    const onSubmit = vi.fn(async () => true);
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts(null).port} client={client} handle={handle} onSubmit={onSubmit} />);
    fireEvent.drop(container.querySelector('[data-key-sink]')!, { dataTransfer: { files: [file] } });
    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    fireEvent.keyDown(contentOf(container), { key: 'Enter' });
    await act(async () => read(new Uint8Array([97, 98, 99]).buffer));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current!.doc().attrs?.attachments).toEqual([expect.objectContaining({ name: 'pending.pdf', data: 'YWJj' })]);
  });
});

it.each([
  [true, 'mounted'], [false, 'mounted'],
  [true, 'remounted'], [false, 'remounted'],
  [true, 'unmounted'], [false, 'unmounted'],
] as const)('defers a prefill through submission acceptance=%s while %s and persists it', async (accepted, lifecycle) => {
  let answer!: (accepted: boolean) => void;
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const onPrefill = vi.fn();
  let stored: Draft | null = null;
  const port: DraftPort = { load: async () => stored, save: (draft) => { stored = draft; } };
  const handle = createRef<EditorHandle>();
  const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} onPrefill={onPrefill} />;
  let mounted = render(view());
  await act(async () => handle.current!.insertText('original submission'));
  act(() => {
    handle.current!.submit();
    expect(onSubmit).toHaveBeenCalledOnce(); // C10 must acquire its start gate synchronously.
  });
  const prefill = { text: 'incoming edit' };
  act(() => prefillComposer(APP, prefill));
  const whilePending = handle.current!.serialize().display;
  const queued = useComposerStore.getState().prefills.get(APP);
  if (lifecycle !== 'mounted') mounted.unmount();
  if (lifecycle === 'remounted') mounted = render(view());
  const takenBeforeCompletion = onPrefill.mock.calls.length;
  await act(async () => answer(accepted));
  if (lifecycle === 'unmounted') mounted = render(view());
  await act(async () => {});
  const afterCompletion = handle.current!.serialize().display;
  mounted.unmount(); // Flush the replacement draft, then prove persistence on another mount.
  render(view());
  await act(async () => {});
  expect(whilePending).toBe('original submission');
  expect(queued).toEqual(prefill);
  expect(takenBeforeCompletion).toBe(0);
  expect(afterCompletion).toBe('incoming edit');
  expect(handle.current!.serialize().display).toBe('incoming edit');
  expect(onPrefill).toHaveBeenCalledExactlyOnceWith(prefill);
  expect(useComposerStore.getState().prefills.has(APP)).toBe(false);
});
// R2: the engine's prompt requests on a plugin's behalf read and fill the box through the handle, and a plugin's
// suggestion is the empty box's placeholder until Tab takes it
// R2/F11 seam: prompt access obeys the session-owned lock and edit revisions.
it.each(['replace', 'append', 'insert'] as const)('refuses a plugin %s during submission, including after remount', async (mode) => {
  let answer!: (accepted: boolean) => void;
  const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const handle = createRef<EditorHandle>();
  const { port } = drafts(null);
  const view = () => <Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} onSubmit={onSubmit} />;
  const first = render(view());
  await act(async () => handle.current!.insertText('locked submission'));
  act(() => handle.current!.submit());
  let filled: unknown;
  act(() => { filled = handle.current!.fill('plugin edit', mode); });
  const pendingText = handle.current!.promptBox().text;
  first.unmount();
  render(view());
  let remountedFill: unknown;
  act(() => { remountedFill = handle.current!.fill('plugin edit', mode); });
  const remountedText = handle.current!.promptBox().text;
  await act(async () => answer(false));
  expect(pendingText).toBe('locked submission');
  expect(remountedText).toBe('locked submission');
  expect(filled).toBe(false);
  expect(remountedFill).toBe(false);
  expect(handle.current!.promptBox().text).toBe('locked submission');
  act(() => { filled = handle.current!.fill('allowed edit', mode); });
  expect(filled).toBe(true);
  expect(handle.current!.promptBox().text).toContain('allowed edit');
});

it('treats a plugin fill to empty as an edit that invalidates pending restoration', async () => {
  let loaded!: (draft: Draft | null) => void;
  const port: DraftPort = { load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn() };
  const handle = createRef<EditorHandle>();
  render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={port} client={client} handle={handle} />);
  act(() => handle.current!.fill('', 'replace'));
  await act(async () => loaded({ doc: docOf([paragraph(textNode('old draft'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' }));
  expect(handle.current!.serialize().empty).toBe(true);
});

it('clears a plugin suggestion when a send is accepted', async () => {
  const handle = createRef<EditorHandle>();
  const taken = vi.fn();
  render(<Editor appSessionId={APP} cwd="/repo" sessionId="s" drafts={drafts(null).port} client={client} handle={handle} suggestion="try this next" onSuggestionTaken={taken} onSubmit={async () => true} />);
  await act(async () => handle.current!.insertText('actual message'));
  await act(async () => handle.current!.submit());
  expect(handle.current!.serialize().empty).toBe(true);
  expect(taken).toHaveBeenCalledOnce();
});

describe('the editor answers a plugin’s prompt read, fill and suggestion (R2)', () => {
  it('reads the box as sent, the caret at its end; replace, append and insert place the text', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    expect(handle.current!.promptBox()).toEqual({ text: '', cursor: 0 });
    act(() => handle.current!.fill('MODS_PROBE_FILL', 'replace'));
    expect(contentOf(container).textContent).toBe('MODS_PROBE_FILL');
    expect(handle.current!.promptBox()).toEqual({ text: 'MODS_PROBE_FILL', cursor: 15 });
    act(() => handle.current!.fill(' and more', 'append'));
    expect(handle.current!.promptBox().text).toBe('MODS_PROBE_FILL and more');
    act(() => handle.current!.fill('two\nlines', 'replace'));
    expect(handle.current!.serialize().display).toBe('two\nlines');
  });

  it('shows a suggestion as the empty box’s placeholder and Tab takes it', async () => {
    const { port } = drafts(null);
    const handle = createRef<EditorHandle>();
    const taken = vi.fn();
    const view = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} />);
    await waitFor(() => expect(handle.current).not.toBeNull());
    view.rerender(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} handle={handle} suggestion="MODS_PROBE_SUGGEST" onSuggestionTaken={taken} />);
    act(() => handle.current!.refreshPlaceholder());
    const content = contentOf(view.container);
    await waitFor(() => expect(content.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe('MODS_PROBE_SUGGEST'));
    await act(async () => void content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(content.textContent).toBe('MODS_PROBE_SUGGEST');
    expect(taken).toHaveBeenCalledTimes(1);
  });
});

// E3 start: `/btw` is a side question, never a prompt (E3 execution document, Design §7, M4's proofs): a draft the typed
// seam would not take (several lines, pasted text) is asked through the registered `btw` widget with its whole text,
// pasted text unframed; one with an attachment, or with no `btw` widget registered, is refused with a toast and kept.
// Nothing of any of them reaches the session's submit (`session.send` or `session.steer`).
describe('a `/btw` draft never reaches the conversation', () => {
  const opened = () => useWidgetDialog.getState().open;
  const offs: (() => void)[] = [];
  const registerBtw = (apply: (id: AppSessionId, args: string, tooLate: AbortSignal) => Promise<boolean>) =>
    offs.push(registerSlashWidget('btw', { title: 'Side question', component: () => <p data-test-widget>btw</p>, apply }));
  const notices = () => useNotices.getState().notices.map((n) => n.text);
  beforeEach(() => {
    closeWidgetDialog();
    useNotices.setState({ notices: [] });
  });
  afterEach(() => offs.splice(0).forEach((off) => off()));

  async function mounted(doc: ReturnType<typeof docOf>) {
    const onSubmit = vi.fn(async () => true);
    const { port, saved } = drafts({ doc, attachments: [], updatedAt: '2026-10-06T00:00:00.000Z' });
    const handle = createRef<EditorHandle>();
    render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} drafts={port} client={client} onSubmit={onSubmit} handle={handle} />);
    await waitFor(() => expect(handle.current?.serialize().empty).toBe(false));
    return { onSubmit, handle, saved };
  }

  it('asks a two-line question through the widget’s apply, and sends nothing', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const { onSubmit, handle, saved } = await mounted(docOf([paragraph(textNode('/btw why is this')), paragraph(textNode('null-checked twice?'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'why is this\nnull-checked twice?', expect.any(AbortSignal)));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(opened()).toBeNull();
    expect(handle.current?.serialize().empty).toBe(true);
    expect(saved).toEqual([null]);
  });

  it('asks a question holding pasted text with the text itself, not its placeholder or framing', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const pasted = pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text', lines: 2, text: 'const a = 1;\nconst b = 2;' });
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btw what does '), pasted, textNode(' do?'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(apply).toHaveBeenCalledWith(APP, 'what does const a = 1;\nconst b = 2; do?', expect.any(AbortSignal)));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a question with an attachment: a toast, the draft kept, nothing asked or sent', async () => {
    const apply = vi.fn(async () => true);
    registerBtw(apply);
    const shot = { id: 'a1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
    const { onSubmit, handle, saved } = await mounted(docOf([paragraph(textNode('/btw what is this?'))], [shot]));
    await act(async () => handle.current!.submit());
    expect(notices()).toEqual(['Side questions take text only; remove the attachment']);
    expect(apply).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().display).toBe('/btw what is this? [Image #1]');
    expect(saved).toEqual([]);
  });

  it('refuses even a one-line `/btw` when no `btw` widget is registered, rather than sending it as text', async () => {
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btw anything'))]));
    await act(async () => handle.current!.submit());
    expect(notices()).toEqual(['Side questions are not available here']);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handle.current?.serialize().display).toBe('/btw anything');
  });

  it('a message that merely starts with "/btwx" is not a side question', async () => {
    registerBtw(vi.fn(async () => true));
    const { onSubmit, handle } = await mounted(docOf([paragraph(textNode('/btwx run it'))]));
    await act(async () => handle.current!.submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ display: '/btwx run it' })));
  });
});
// E3 end
