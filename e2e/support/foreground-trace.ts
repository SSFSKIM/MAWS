// A failure-only timeline for the cases the app's foreground state decides (P3-F's W-MINI: tracker rows 199, 200, 217,
// 264 and 277). The mini fails them and the MacBook does not, so a failing reading has to come from the gate's own run.
// `traceForeground` adds passive page listeners (focus and window focus, visibility, selection, the clipboard events,
// keys) and, given an editor, logs its paste path: each `transformPasted` and `handlePaste` prop with its plugin, each
// transaction a paste or another UI event dispatches with whether it changed the document, and every document change a
// plugin's `filterTransaction` refused. Nothing is printed unless a traced step fails; then the timeline, the window's
// native state (read without any clipboard call, which broke the triage's first probe), the page's frame rate over one
// second and the step's own snapshot go to the run's output and to the test's attachments, and the failure is rethrown.
import { test, type ElectronApplication, type Page } from '@playwright/test';

export interface ForegroundTrace {
  /** Runs `run`; when it throws, reports the timeline under `label` (with `snapshot()`'s value) and rethrows. */
  step<T>(label: string, run: () => Promise<T>, snapshot?: () => Promise<unknown>): Promise<T>;
}

/** `editor` selects the ProseMirror root (Tiptap's element, carrying its `editor`) whose paste path is logged. */
export async function traceForeground(app: ElectronApplication, page: Page, options: { editor?: string } = {}): Promise<ForegroundTrace> {
  await page.evaluate((editorSelector) => {
    type Entry = Record<string, unknown>;
    const w = window as unknown as { __mawsTrace?: { log: Entry[]; t0: number; editors: WeakSet<object> } };
    const trace = (w.__mawsTrace ??= { log: [], t0: performance.now(), editors: new WeakSet() });
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
    if (!(w as { __mawsTraceListening?: boolean }).__mawsTraceListening) {
      (w as { __mawsTraceListening?: boolean }).__mawsTraceListening = true;
      for (const type of ['focusin', 'focusout'])
        document.addEventListener(type, (e) => push({ type, target: describe(e.target), related: describe((e as FocusEvent).relatedTarget) }), true);
      for (const type of ['focus', 'blur']) window.addEventListener(type, (e) => e.target === window && push({ type: `window-${type}`, hasFocus: document.hasFocus() }), true);
      document.addEventListener('visibilitychange', () => push({ type: 'visibility', state: document.visibilityState }));
      document.addEventListener('selectionchange', () => {
        const s = getSelection();
        push({ type: 'selectionchange', text: s?.toString().slice(0, 40), collapsed: s?.isCollapsed, focus: describe(s?.focusNode), offset: s?.focusOffset, active: describe(document.activeElement) });
      });
      for (const type of ['paste', 'copy', 'cut', 'beforeinput', 'keydown'])
        document.addEventListener(
          type,
          (e) => {
            const data = (e as ClipboardEvent).clipboardData;
            const entry: Entry = { type, target: describe(e.target), active: describe(document.activeElement) };
            if (e instanceof KeyboardEvent) entry.key = e.key;
            if (e instanceof InputEvent) entry.inputType = e.inputType;
            if (data) Object.assign(entry, { types: [...data.types], plain: data.getData('text/plain').slice(0, 60), htmlLength: data.getData('text/html').length });
            push(entry);
            setTimeout(() => push({ type: `${type}-after`, defaultPrevented: e.defaultPrevented }), 0);
          },
          true,
        );
    }
    push({ type: 'installed', hasFocus: document.hasFocus(), visibility: document.visibilityState, active: describe(document.activeElement) });

    if (!editorSelector) return;
    type PMPlugin = { key: string; props: Record<string, unknown>; spec: { filterTransaction?: (tr: unknown, state: unknown) => boolean } };
    type PMState = { plugins: PMPlugin[]; doc: { content: { size: number } }; selection: { from: number; to: number } };
    type PMTransaction = { docChanged: boolean; getMeta(key: string): unknown };
    type PMView = { state: PMState; dispatch(tr: PMTransaction): void; someProp(name: string, f?: (prop: unknown) => unknown): unknown };
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
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      const before = view.state.doc;
      dispatch(tr);
      const ui = tr.getMeta('uiEvent') ?? (tr.getMeta('paste') ? 'paste' : null);
      if (ui !== null) push({ type: 'dispatch', ui, docChanged: tr.docChanged, applied: view.state.doc !== before, selection: [view.state.selection.from, view.state.selection.to] });
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
      try {
        return await run();
      } catch (error) {
        await report(app, page, label, snapshot).catch((reason: unknown) => console.log(`[trace ${label}] no report: ${String(reason)}`));
        throw error;
      }
    },
  };
}

async function report(app: ElectronApplication, page: Page, label: string, snapshot?: () => Promise<unknown>): Promise<void> {
  const own = snapshot ? await snapshot().catch((reason: unknown) => ({ error: String(reason) })) : null;
  const pageState = await page.evaluate(async () => {
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
      framesInOneSecond: frames,
      hasFocus: document.hasFocus(),
      visibility: document.visibilityState,
      active: el ? `${el.tagName.toLowerCase()} ${(el.outerHTML ?? '').slice(0, 160)}` : null,
      log: (window as unknown as { __mawsTrace?: { log: unknown[] } }).__mawsTrace?.log ?? [],
    };
  });
  const native = await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((win) => !win.isDestroyed())
        .map((win) => ({ focused: win.isFocused(), contentsFocused: win.webContents.isFocused(), visible: win.isVisible(), minimized: win.isMinimized(), opacity: win.getOpacity(), bounds: win.getBounds() })),
    )
    .catch((reason: unknown) => ({ error: String(reason) }));
  const { log, ...state } = pageState;
  const body = { label, foreground: process.env.MAWS_E2E_FOREGROUND === '1', state, native, snapshot: own, log };
  console.log(`[trace ${label}] state ${JSON.stringify({ foreground: body.foreground, ...state, native })}`);
  if (own !== null) console.log(`[trace ${label}] snapshot ${JSON.stringify(own)}`);
  for (const entry of log) console.log(`[trace ${label}] ${JSON.stringify(entry)}`);
  await test.info().attach(`foreground-trace-${label}.json`, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
}
