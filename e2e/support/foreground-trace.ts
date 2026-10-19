// A failure-only timeline for the cases the app's foreground state decides (P3-F's W-MINI: tracker rows 199, 200, 217,
// 264 and 277). The mini fails them and the MacBook does not, so a failing reading has to come from the gate's own run.
// `traceForeground` adds passive page listeners (focus and window focus, visibility, selection, the clipboard events,
// mouse and key input with the time each event was made and both selections a task later), passes every element
// `focus()` call through while logging its target and whether it took focus, and, given an editor, reads its selection
// and comment marks beside the page's and logs its paste path: each `transformPasted` and `handlePaste` prop with its
// plugin, each transaction a paste or another UI event dispatches with whether it changed the document, and every
// document change a plugin's `filterTransaction` refused. Each traced step prints one entry line, passing or not: the time and the window's
// native focus as the step begins, with the page's focus, visibility and focused element, so a run shows the foreground
// state each scene actually ran in. Native state is always read without any clipboard call (which broke the triage's
// first probe). Only when the step fails is the rest reported, to the run's output and the test's attachments: the same
// reading taken at the failure, the step's own snapshot, then the page's frames over the second after it (stamped with
// that second's start and end) and the timeline; the failure is then rethrown unchanged.
import { test, type ElectronApplication, type Page } from '@playwright/test';

export interface ForegroundTrace {
  /** Runs `run` after printing its entry reading; when it throws, reports the failure under `label` (with `snapshot()`'s value) and rethrows. */
  step<T>(label: string, run: () => Promise<T>, snapshot?: () => Promise<unknown>): Promise<T>;
}

/** `editor` selects the ProseMirror root (Tiptap's element, carrying its `editor`) whose paste path is logged. */
export async function traceForeground(app: ElectronApplication, page: Page, options: { editor?: string } = {}): Promise<ForegroundTrace> {
  await page.evaluate((editorSelector) => {
    type Entry = Record<string, unknown>;
    type EditorElement = Element & { editor?: { state: { doc: { descendants(f: (node: { isText: boolean; text?: string; marks: Array<{ type: { name: string }; attrs: { threadId?: unknown } }> }) => void): void }; selection: { from: number; to: number } } } };
    type TraceState = { log: Entry[]; t0: number; editors: WeakSet<object>; editorSelector: string | null; selections(): Entry; editorReading(): Entry | null };
    const w = window as unknown as { __mawsTrace?: TraceState };
    const trace: TraceState = (w.__mawsTrace ??= {
      log: [],
      t0: performance.now(),
      editors: new WeakSet(),
      editorSelector: null,
      selections: () => ({}),
      editorReading: () => null,
    });
    if (editorSelector) trace.editorSelector = editorSelector;
    const push = (entry: Entry) => {
      trace.log.push({ t: Math.round(performance.now() - trace.t0), ...entry });
      if (trace.log.length > 600) trace.log.splice(0, trace.log.length - 600);
    };
    const describe = (node: unknown): string | null => {
      const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
      if (!el) return node === window ? 'window' : node === document ? 'document' : node ? String(node) : null;
      const attrs = ['id', 'role', 'aria-label', 'data-owner-card', 'data-overview-panel', 'data-pane', 'data-tab-id', 'data-thread', 'data-slide-thumb', 'contenteditable', 'tabindex']
        .filter((a) => el.hasAttribute(a))
        .map((a) => `${a}=${(el.getAttribute(a) ?? '').slice(0, 40)}`);
      return `${el.tagName.toLowerCase()}[${attrs.join(',')}]`;
    };
    // The page's selection and the traced editor's own, read without layout (nodes and offsets only, never the selected
    // text, whose serialisation lays the page out).
    const editorOf = () => (trace.editorSelector ? (document.querySelector(trace.editorSelector) as EditorElement | null) : null);
    trace.selections = () => {
      const s = getSelection();
      const editor = editorOf()?.editor;
      return {
        page: s ? { anchor: describe(s.anchorNode), anchorOffset: s.anchorOffset, focus: describe(s.focusNode), focusOffset: s.focusOffset, collapsed: s.isCollapsed } : null,
        ...(editor ? { editor: [editor.state.selection.from, editor.state.selection.to] } : {}),
      };
    };
    // The selections, and each comment thread's marked text as the page draws it and as the editor's document holds it.
    trace.editorReading = () => {
      const root = editorOf();
      const editor = root?.editor;
      if (!root || !editor) return null;
      const drawn: Record<string, string> = {};
      root.querySelectorAll<HTMLElement>('[data-thread]').forEach((el) => {
        const id = el.dataset.thread!;
        drawn[id] = (drawn[id] ?? '') + (el.textContent ?? '');
      });
      const held: Record<string, string> = {};
      editor.state.doc.descendants((node) => {
        if (!node.isText) return;
        for (const mark of node.marks) {
          if (mark.type.name !== 'comment' || typeof mark.attrs.threadId !== 'string') continue;
          held[mark.attrs.threadId] = (held[mark.attrs.threadId] ?? '') + (node.text ?? '');
        }
      });
      return { ...trace.selections(), marks: { drawn, held } };
    };
    if (!(w as { __mawsTraceListening?: boolean }).__mawsTraceListening) {
      (w as { __mawsTraceListening?: boolean }).__mawsTraceListening = true;
      // Every element focus() call, passed through unchanged: what was asked, whether it is in the page, and whether it
      // holds focus afterwards (an unfocusable or detached target leaves focus where it was).
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
        const from = document.activeElement;
        focus.call(this, options);
        push({ type: 'focus-call', target: describe(this), connected: this.isConnected, took: document.activeElement === this, from: describe(from) });
      };
      for (const type of ['focusin', 'focusout'])
        document.addEventListener(type, (e) => push({ type, target: describe(e.target), related: describe((e as FocusEvent).relatedTarget) }), true);
      for (const type of ['focus', 'blur']) window.addEventListener(type, (e) => e.target === window && push({ type: `window-${type}`, hasFocus: document.hasFocus() }), true);
      document.addEventListener('visibilitychange', () => push({ type: 'visibility', state: document.visibilityState }));
      document.addEventListener('selectionchange', () => {
        const s = getSelection();
        push({ type: 'selectionchange', text: s?.toString().slice(0, 40), collapsed: s?.isCollapsed, focus: describe(s?.focusNode), offset: s?.focusOffset, active: describe(document.activeElement) });
      });
      // Input and clipboard events, each with the time the event was made (`at`, on the timeline's clock) and, a task
      // later, whether it was prevented and where both selections then stood.
      for (const type of ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'beforeinput', 'input', 'paste', 'copy', 'cut'])
        document.addEventListener(
          type,
          (e) => {
            const data = (e as ClipboardEvent).clipboardData;
            const entry: Entry = { type, at: Math.round(e.timeStamp - trace.t0), target: describe(e.target), active: describe(document.activeElement) };
            if (e instanceof KeyboardEvent) entry.key = e.key;
            if (e instanceof MouseEvent) entry.button = e.button;
            if (e instanceof InputEvent) entry.inputType = e.inputType;
            if (data) Object.assign(entry, { types: [...data.types], plain: data.getData('text/plain').slice(0, 60), htmlLength: data.getData('text/html').length });
            push(entry);
            setTimeout(() => push({ type: `${type}-after`, defaultPrevented: e.defaultPrevented, ...trace.selections() }), 0);
          },
          true,
        );
    }
    push({ type: 'installed', hasFocus: document.hasFocus(), visibility: document.visibilityState, active: describe(document.activeElement) });

    if (!editorSelector) return;
    type PMPlugin = { key: string; props: Record<string, unknown>; spec: { filterTransaction?: (tr: unknown, state: unknown) => boolean } };
    type PMDoc = { content: { size: number }; descendants(f: (node: { type: { name: string }; textContent: string }) => boolean | void): void };
    type PMState = { plugins: PMPlugin[]; doc: PMDoc; selection: { from: number; to: number; toJSON(): unknown } };
    type PMTransaction = { docChanged: boolean; getMeta(key: string): unknown; steps: Array<{ toJSON(): { stepType?: string; from?: number; to?: number } }> };
    type PMView = { state: PMState; composing: boolean; hasFocus(): boolean; dispatch(tr: PMTransaction): void; someProp(name: string, f?: (prop: unknown) => unknown): unknown };
    const root = document.querySelector(editorSelector) as (Element & { editor?: { view: PMView } }) | null;
    const view = root?.editor?.view;
    if (!view || trace.editors.has(view)) return;
    trace.editors.add(view);
    const pluginOf = (prop: unknown, name: string) => view.state.plugins.find((p) => p.props[name] === prop)?.key ?? 'view prop';
    const someProp = view.someProp.bind(view);
    view.someProp = (name, f) => {
      if (!f || (name !== 'handlePaste' && name !== 'transformPasted')) return someProp(name, f);
      const handled = someProp(name, (prop) =>
        f((...args: unknown[]) => {
          const out = (prop as (...a: unknown[]) => unknown)(...args);
          const size = (slice: unknown) => (slice as { content?: { size?: number } } | null)?.content?.size;
          push({ type: name, by: pluginOf(prop, name), ...(name === 'transformPasted' ? { in: size(args[0]), out: size(out) } : { handled: !!out }) });
          return out;
        }),
      );
      return handled;
    };
    const paragraphs = (doc: PMDoc) => {
      const out: string[] = [];
      doc.descendants((node) => {
        if (node.type.name === 'paragraph') out.push(node.textContent.slice(0, 80));
      });
      return out;
    };
    // At the paste event itself, before any handler of the editor runs (a capture listener on the document): the page's
    // anchor and focus, the editor's selection, whether it is composing and whether it holds focus.
    document.addEventListener(
      'paste',
      (e) => {
        if (!root || !root.contains(e.target as Node)) return;
        const s = getSelection();
        push({
          type: 'paste-capture',
          page: s ? { anchor: describe(s.anchorNode), anchorOffset: s.anchorOffset, focus: describe(s.focusNode), focusOffset: s.focusOffset } : null,
          editor: view.state.selection.toJSON(),
          composing: view.composing,
          hasFocus: view.hasFocus(),
        });
      },
      true,
    );
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      const before = view.state;
      const ui = tr.getMeta('uiEvent') ?? (tr.getMeta('paste') ? 'paste' : null);
      // a paste's transaction before it applies: the selection it replaces and its steps, with the paragraphs either side
      if (ui === 'paste')
        push({
          type: 'paste-dispatch',
          selection: before.selection.toJSON(),
          steps: tr.steps.map((step) => {
            const { stepType, from, to } = step.toJSON();
            return { stepType, from, to };
          }),
          paragraphsBefore: paragraphs(before.doc),
        });
      dispatch(tr);
      if (ui === 'paste') push({ type: 'paste-applied', paragraphsAfter: paragraphs(view.state.doc), selection: view.state.selection.toJSON() });
      if (ui !== null) push({ type: 'dispatch', ui, docChanged: tr.docChanged, applied: view.state.doc !== before.doc, selection: [view.state.selection.from, view.state.selection.to] });
    };
    const proto = Object.getPrototypeOf(view.state) as { filterTransaction(this: PMState, tr: PMTransaction, ignore?: number): boolean; __mawsTraced?: boolean };
    if (proto.__mawsTraced) return;
    proto.__mawsTraced = true;
    // EditorState.filterTransaction as prosemirror-state writes it, naming the plugin that refused a document change
    proto.filterTransaction = function (tr, ignore = -1) {
      for (let i = 0; i < this.plugins.length; i++) {
        if (i === ignore) continue;
        const plugin = this.plugins[i]!;
        if (plugin.spec.filterTransaction && !plugin.spec.filterTransaction.call(plugin, tr, this)) {
          if (tr.docChanged) push({ type: 'filtered', by: plugin.key, ui: tr.getMeta('uiEvent') ?? null });
          return false;
        }
      }
      return true;
    };
  }, options.editor ?? null);

  return {
    async step<T>(label: string, run: () => Promise<T>, snapshot?: () => Promise<unknown>): Promise<T> {
      const entry = await reading(app, page);
      console.log(`[trace ${label}] entry ${JSON.stringify({ foreground: process.env.MAWS_E2E_FOREGROUND === '1', ...entry })}`);
      try {
        return await run();
      } catch (error) {
        await report(app, page, label, entry, snapshot).catch((reason: unknown) => console.log(`[trace ${label}] no report: ${String(reason)}`));
        throw error;
      }
    },
  };
}

// Under MAWS_E2E_FOREGROUND=1 only: activates this app and its first window once, right before a scene whose foreground
// state is the question (another app can take the front during a job), as the launch does (`win.show()`), then taking
// the front (`app.focus({ steal: true })`, `win.focus()`). It then reads the window's native focus once, after its own
// `focus` event or one second, and records the answer as the test's `foreground` annotation: `obtained`, or `not
// obtained` with the reading, which gives the scene no foreground credit. Nothing is retried and the scene runs as before
// either way. Without the flag it does nothing.
export async function activateForScene(app: ElectronApplication, scene: string): Promise<void> {
  if (process.env.MAWS_E2E_FOREGROUND !== '1') return;
  const native = await app
    .evaluate(async ({ app: electron, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!win) return { window: false };
      const focused = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        win.once('focus', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      win.show();
      electron.focus({ steal: true });
      win.focus();
      if (!win.isFocused()) await focused;
      return { window: true, focused: win.isFocused(), contentsFocused: win.webContents.isFocused(), visible: win.isVisible(), opacity: win.getOpacity() };
    })
    .catch((reason: unknown) => ({ window: false, error: String(reason) }));
  const obtained = 'focused' in native && native.focused === true && native.contentsFocused === true;
  console.log(`[trace ${scene}] activation ${JSON.stringify({ at: new Date().toISOString(), obtained, native })}`);
  test.info().annotations.push({ type: 'foreground', description: obtained ? `${scene}: obtained` : `${scene}: not obtained (${JSON.stringify(native)}); no foreground credit` });
}

// One reading, taken at once with no sampling: the wall-clock time, each window's native focus and visibility, the
// page's focus, visibility and focused element, and with a traced editor both selections and each comment's marked text
// (drawn and held). A reading that cannot be taken says why rather than throwing.
async function reading(app: ElectronApplication, page: Page): Promise<{ at: string; native: unknown; page: unknown; editor: unknown }> {
  const at = new Date().toISOString();
  const native = await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((win) => !win.isDestroyed())
        .map((win) => ({ focused: win.isFocused(), contentsFocused: win.webContents.isFocused(), visible: win.isVisible(), minimized: win.isMinimized(), opacity: win.getOpacity() })),
    )
    .catch((reason: unknown) => ({ error: String(reason) }));
  const pageState = await page
    .evaluate(() => {
      const el = document.activeElement;
      const label = el?.getAttribute('aria-label') ?? el?.getAttribute('role') ?? '';
      const editor = (window as unknown as { __mawsTrace?: { editorReading(): unknown } }).__mawsTrace?.editorReading() ?? null;
      return { hasFocus: document.hasFocus(), visibility: document.visibilityState, active: el ? `${el.tagName.toLowerCase()}${label ? ` ${label.slice(0, 40)}` : ''}` : null, editor };
    })
    .catch((reason: unknown) => ({ error: String(reason), editor: null }));
  const { editor, ...pageRest } = pageState;
  return { at, native, page: pageRest, editor };
}

async function report(app: ElectronApplication, page: Page, label: string, entry: Awaited<ReturnType<typeof reading>>, snapshot?: () => Promise<unknown>): Promise<void> {
  const atFailure = await reading(app, page);
  const own = snapshot ? await snapshot().catch((reason: unknown) => ({ error: String(reason) })) : null;
  const afterFailure = await page.evaluate(async () => {
    const from = new Date().toISOString();
    let frames = 0;
    let counting = true;
    const tick = () => {
      frames += 1;
      if (counting) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    counting = false;
    const el = document.activeElement;
    return {
      frameSample: { from, to: new Date().toISOString(), frames },
      activeAfterSample: el ? `${el.tagName.toLowerCase()} ${(el.outerHTML ?? '').slice(0, 160)}` : null,
      log: (window as unknown as { __mawsTrace?: { log: unknown[] } }).__mawsTrace?.log ?? [],
    };
  });
  const { log, ...sampled } = afterFailure;
  const body = { label, foreground: process.env.MAWS_E2E_FOREGROUND === '1', entry, atFailure, snapshot: own, afterFailure: sampled, log };
  console.log(`[trace ${label}] at failure ${JSON.stringify(atFailure)}`);
  if (own !== null) console.log(`[trace ${label}] snapshot ${JSON.stringify(own)}`);
  console.log(`[trace ${label}] after failure ${JSON.stringify(sampled)}`);
  for (const line of log) console.log(`[trace ${label}] ${JSON.stringify(line)}`);
  await test.info().attach(`foreground-trace-${label}.json`, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
}
