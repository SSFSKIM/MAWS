// The scratch page check.mjs drives through Playwright: `window.__spike` renders a patch file in DiffView and a text in
// CodeMirror, and reports what landed in the DOM and how long it took.
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { getDiffViewHighlighter } from '@git-diff-view/shiki';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { ReviewView } from './review-view.js';
import { createCodeView, jumpTo } from './code-view.js';

const diffHost = document.getElementById('diff');
const cmHost = document.getElementById('cm');
let root = null;
let cm = null;
let shiki = null;

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const longTasks = [];
new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true });

window.__spike = {
  async shikiInit() {
    const t0 = performance.now();
    shiki = await getDiffViewHighlighter();
    return performance.now() - t0;
  },
  // Renders one file and waits for the first frame that shows its rows; `ms` is render call to painted frame.
  async renderDiff({ file, mode, wrap, theme, highlight, feed }) {
    root?.unmount();
    diffHost.replaceChildren();
    diffHost.scrollTop = 0;
    root = createRoot(diffHost);
    const errors = [];
    const onError = (event) => errors.push(String(event.message ?? event.reason));
    window.addEventListener('error', onError);
    const t0 = performance.now();
    root.render(
      h(ReviewView, {
        file,
        feed,
        mode,
        wrap,
        theme,
        highlight: highlight !== 'none',
        registerHighlighter: highlight === 'shiki' ? shiki : undefined,
      }),
    );
    for (let i = 0; i < 200 && !diffHost.querySelector('tr, .spike-placeholder'); i++) await frame();
    await frame();
    const ms = performance.now() - t0;
    window.removeEventListener('error', onError);
    return { ms, errors, ...describe() };
  },
  // Scrolls the diff container top to bottom in steps, one frame each, and reports the long tasks seen meanwhile.
  async scrollDiff() {
    longTasks.length = 0;
    const steps = Math.ceil(diffHost.scrollHeight / 300);
    const t0 = performance.now();
    for (let i = 0; i <= steps; i++) {
      diffHost.scrollTop = i * 300;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await frame();
    return { steps, ms: performance.now() - t0, longTasks: [...longTasks] };
  },
  async renderCode({ text, name, line }) {
    cm?.destroy();
    const t0 = performance.now();
    cm = createCodeView(cmHost, text, null);
    await frame();
    const paintMs = performance.now() - t0;
    const description = LanguageDescription.matchFilename(languages, name);
    const tl = performance.now();
    const support = description ? await description.load() : null;
    const languageMs = performance.now() - tl;
    cm.destroy();
    cm = createCodeView(cmHost, text, support);
    const tj = performance.now();
    jumpTo(cm, line);
    await frame();
    await frame();
    const jumpMs = performance.now() - tj;
    // The parser works in the background with a time budget: wait for highlighted tokens to reach the jumped-to viewport.
    const tokens = () => cm.contentDOM.querySelectorAll('.cm-line span[class]').length;
    for (let i = 0; i < 200 && tokens() === 0; i++) await frame();
    const highlightMs = performance.now() - tj;
    const target = cm.state.doc.line(line);
    const block = cm.lineBlockAt(target.from);
    const scroller = cm.scrollDOM;
    const lineCentre = block.top + block.height / 2 - scroller.scrollTop;
    const viewportCentre = scroller.clientHeight / 2;
    const lineEl = [...cm.contentDOM.querySelectorAll('.cm-line')].find((el) => cm.posAtDOM(el) === target.from);
    return {
      paintMs,
      language: description?.name ?? null,
      languageMs,
      lines: cm.state.doc.lines,
      offsetFromCentre: Math.round(lineCentre - viewportCentre),
      lineText: lineEl?.textContent ?? null,
      highlightedSpans: tokens(),
      jumpMs,
      highlightMs,
      readOnly: cm.state.readOnly,
      editable: cm.contentDOM.getAttribute('contenteditable'),
    };
  },
};

function describe() {
  const q = (selector) => diffHost.querySelectorAll(selector).length;
  const contentOf = '.diff-line-content-raw span, .diff-line-syntax-raw span';
  return {
    rows: q('tr[data-line]'),
    hunkRows: q('tr[data-state="hunk"]'),
    lineRows: q('tr[data-state="diff"]'),
    addedCells: q('td[style*="--diff-add-content--"]'),
    deletedCells: q('td[style*="--diff-del-content--"]'),
    placeholder: diffHost.querySelector('.spike-placeholder')?.textContent ?? null,
    // Highlighted tokens: spans in a content cell carrying a class or a style (plain text is a bare data-template span).
    syntaxSpans: [...diffHost.querySelectorAll(contentOf)].filter((el) => /(^| )hljs/.test(el.className) || /--diff-view-/.test(el.getAttribute('style') ?? '')).length,
    horizontalOverflow: [...diffHost.querySelectorAll('.diff-table-scroll-container')].some((el) => el.scrollWidth > el.clientWidth + 1),
    firstContentHtml: diffHost.querySelector('tr[data-state="diff"] .diff-line-content-raw, tr[data-state="diff"] .diff-line-syntax-raw')?.outerHTML.slice(0, 500) ?? null,
    hunkHeaders: [...diffHost.querySelectorAll('tr[data-state="hunk"]')].map((el) => el.textContent.trim().slice(0, 30)),
  };
}
