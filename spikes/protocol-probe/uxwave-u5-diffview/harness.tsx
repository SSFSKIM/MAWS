// UX wave U5 P2: @git-diff-view/react 0.1.7 in a harness page, driven by run.mjs in Electron (the app's pinned Chromium).
// A widget row holding a card (a textarea), extendData rows, and the ways the app's diff can be refreshed.
import { DiffModeEnum, DiffView, DiffViewWithMultiSelect, SplitSide } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const header = '--- a/src/app.ts\n+++ b/src/app.ts\n';
const lines = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ` const line${from + i} = ${from + i};`);
// a file of 40 lines with one change at line 10 (two removed, three added)
function hunksOf(extraAbove: number, tail: string): string[] {
  const top = lines(9 + extraAbove);
  const body = [
    `@@ -1,${9 + 2 + 30} +1,${9 + extraAbove + 3 + 30} @@`,
    ...top,
    '-const old10 = 10;',
    '-const old11 = 11;',
    '+const new10 = 10;',
    '+const new11 = 11;',
    '+const new12 = 12;',
    ...lines(29, 12 + extraAbove),
    ` ${tail}`,
  ];
  return [`${header}${body.join('\n')}\n`];
}
const dataOf = (hunks: string[]) => ({ oldFile: { fileName: 'src/app.ts', fileLang: 'ts' }, newFile: { fileName: 'src/app.ts', fileLang: 'ts' }, hunks });

let cardMounts = 0;
let extendMounts = 0;
const log: string[] = [];
function Card({ side, lineNumber, onClose }: { side: SplitSide; lineNumber: number; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current as (HTMLTextAreaElement & { __mount?: number }) | null;
    if (el) el.__mount = ++cardMounts;
    log.push(`card mount ${cardMounts} ${side}:${lineNumber}`);
    return () => void log.push(`card unmount ${side}:${lineNumber}`);
  }, [side, lineNumber]);
  return (
    <div data-card style={{ padding: 8, border: '1px solid #999', background: '#fff' }}>
      <textarea data-card-input ref={ref} rows={3} style={{ width: '90%' }} onCompositionStart={() => log.push('compositionstart')} onCompositionEnd={(e) => log.push(`compositionend ${JSON.stringify(e.data)}`)} />
      <button onClick={onClose}>Close</button>
    </div>
  );
}
function ExtendRow({ data }: { data: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { __mount?: number }) | null;
    if (el) el.__mount = ++extendMounts;
  }, []);
  return <div data-extend ref={ref} style={{ padding: 4, background: '#eef' }}>{data}</div>;
}

type Variant = 'data' | 'memo' | 'reopen';
interface Config { mode: 'unified' | 'split'; variant: Variant; multi: boolean }
const EXTEND = { newFile: { '12': { data: 'unsent: new 12' }, '30': { data: 'unsent: new 30' } }, oldFile: { '11': { data: 'unsent: old 11' } } };
let api: { refresh(kind: string): void; widget: { getReadonlyState(): { setWidget(w: { side?: SplitSide; lineNumber?: number }): void; widgetLineNumber: number; widgetSide: SplitSide } } | null } = { refresh: () => {}, widget: null };
let lastWidget: { side: SplitSide; lineNumber: number } | null = null;

function App({ config }: { config: Config }) {
  const [state, setState] = useState(() => ({ n: 0, data: dataOf(hunksOf(0, 'const tail = 0;')) }));
  const memo = useRef(state.data);
  api.refresh = (kind: string) =>
    setState((s) => {
      const n = s.n + 1;
      if (kind === 'rerender') return { n, data: s.data }; // the parent re-renders, the same data object
      const hunks = kind === 'identical' ? hunksOf(0, 'const tail = 0;') : kind === 'elsewhere' ? hunksOf(0, `const tail = ${n};`) : hunksOf(n, 'const tail = 0;'); // 'shifted': lines inserted above
      let data = dataOf(hunks);
      if (config.variant === 'memo' && JSON.stringify(memo.current.hunks) === JSON.stringify(hunks)) data = memo.current; // the app keeps the object when the text is the same
      memo.current = data;
      return { n, data };
    });
  useEffect(() => {
    if (config.variant !== 'reopen' || !lastWidget || !api.widget) return;
    const { widgetLineNumber } = api.widget.getReadonlyState();
    if (widgetLineNumber === undefined) api.widget.getReadonlyState().setWidget(lastWidget); // the app re-opens its card after a refresh
  });
  const View = (config.multi ? DiffViewWithMultiSelect : DiffView) as typeof DiffView;
  return (
    <View
      data={state.data}
      extendData={EXTEND}
      diffViewMode={config.mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
      diffViewWrap={false}
      diffViewFontSize={12}
      diffViewHighlight={false}
      diffViewAddWidget
      onAddWidgetClick={(lineNumber: number, side: SplitSide) => void (lastWidget = { side, lineNumber })}
      onCreateUseWidgetHook={(hook: typeof api.widget) => void (api.widget = hook)}
      renderWidgetLine={({ side, lineNumber, onClose }) => <Card side={side} lineNumber={lineNumber} onClose={onClose} />}
      renderExtendLine={({ data }) => <ExtendRow data={data as string} />}
    />
  );
}

let root: ReturnType<typeof createRoot> | null = null;
const H = {
  mount(config: Config) {
    root?.unmount();
    api = { refresh: () => {}, widget: null };
    lastWidget = null;
    log.length = 0;
    const el = document.getElementById('root')!;
    root = createRoot(el);
    root.render(<App config={config} />);
  },
  open(side: 'old' | 'new', lineNumber: number) {
    const s = side === 'old' ? SplitSide.old : SplitSide.new;
    lastWidget = { side: s, lineNumber };
    api.widget!.getReadonlyState().setWidget({ side: s, lineNumber });
  },
  refresh(kind: string) {
    api.refresh(kind);
  },
  state() {
    const input = document.querySelector('[data-card-input]') as (HTMLTextAreaElement & { __mount?: number }) | null;
    const extend = [...document.querySelectorAll('[data-extend]')] as (HTMLElement & { __mount?: number })[];
    const w = api.widget?.getReadonlyState();
    return {
      card: input ? { mount: input.__mount, focused: document.activeElement === input, value: input.value, selection: [input.selectionStart, input.selectionEnd] } : null,
      cards: document.querySelectorAll('[data-card-input]').length,
      widget: w ? { side: w.widgetSide, line: w.widgetLineNumber } : null,
      extend: extend.map((e) => ({ text: e.textContent, mount: e.__mount })),
      addButtons: document.querySelectorAll('.diff-add-widget').length,
      log: [...log],
    };
  },
};
(window as unknown as { H: typeof H }).H = H;
