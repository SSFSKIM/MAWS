// Where the keyboard went, for a focus assertion that fails on a hosted Mac and that no probe has reproduced
// (presentations-comments.spec.ts's pin after a press on the empty stage: four hosted reds from 2026-10-30, none in 120
// probe runs, plain, packaged, throttled or loaded). While installed, the page records each focusin and focusout with
// its target, each programmatic focus() or blur() with its caller's stack, each press with what it landed on, and,
// frame by frame, the active element and whether `watch` still names the same node. `stop()` uninstalls it and answers
// the record as text, for the failure to print.
import type { Page } from '@playwright/test';

interface Trace {
  log: string[];
  stop(): void;
}

export async function traceFocus(page: Page, watch: string): Promise<{ stop(): Promise<string> }> {
  await page.evaluate((selector) => {
    const w = window as unknown as { __mawsFocusTrace?: Trace };
    w.__mawsFocusTrace?.stop();
    const log: string[] = [];
    const t0 = performance.now();
    const describe = (n: unknown): string => {
      if (!(n instanceof Element)) return n === document ? 'document' : String(n ?? null);
      const attrs = [...n.attributes].filter((a) => /^(data-|class$|aria-label$|aria-expanded$|role$|tabindex$)/.test(a.name)).map((a) => `${a.name}=${a.value.slice(0, 32)}`);
      return `<${n.tagName.toLowerCase()}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${n.isConnected ? '' : ' (detached)'}`;
    };
    const note = (line: string) => log.push(`${(performance.now() - t0).toFixed(1)} ms ${line}`);
    const caller = () => (new Error().stack ?? '').split('\n').slice(3, 9).map((l) => l.trim()).join(' | ');
    const types = ['pointerdown', 'pointerup', 'click', 'focusin', 'focusout'] as const;
    const onEvent = (e: Event) => note(`${e.type} on ${describe(e.target)}${e instanceof FocusEvent ? `, related ${describe(e.relatedTarget)}` : ''}${e instanceof PointerEvent && e.type === 'pointerdown' ? `, at ${e.clientX},${e.clientY}` : ''}; active ${describe(document.activeElement)}`);
    for (const type of types) window.addEventListener(type, onEvent, true);
    const { focus, blur } = HTMLElement.prototype;
    HTMLElement.prototype.focus = function (this: HTMLElement, ...args: [FocusOptions?]) {
      note(`focus() on ${describe(this)} from ${caller()}`);
      return focus.apply(this, args);
    };
    HTMLElement.prototype.blur = function (this: HTMLElement) {
      note(`blur() on ${describe(this)} from ${caller()}`);
      return blur.apply(this);
    };
    const first = document.querySelector(selector);
    let last = '';
    let frame = 0;
    const each = () => {
      const node = document.querySelector(selector);
      const now = `active ${describe(document.activeElement)}; ${selector} ${node === null ? 'absent' : node === first ? 'the same node' : 'a new node'}`;
      if (now !== last) note(`frame: ${now}`);
      last = now;
      frame = requestAnimationFrame(each);
    };
    frame = requestAnimationFrame(each);
    w.__mawsFocusTrace = {
      log,
      stop: () => {
        for (const type of types) window.removeEventListener(type, onEvent, true);
        HTMLElement.prototype.focus = focus;
        HTMLElement.prototype.blur = blur;
        cancelAnimationFrame(frame);
        delete w.__mawsFocusTrace;
      },
    };
  }, watch);
  return {
    stop: () =>
      page.evaluate(() => {
        const w = window as unknown as { __mawsFocusTrace?: Trace };
        const log = w.__mawsFocusTrace?.log ?? ['(no trace installed)'];
        w.__mawsFocusTrace?.stop();
        return log.join('\n');
      }),
  };
}

/** What is drawn at a viewport point, for a press's record: the element there and whether it is inside `within`. */
export function elementAt(page: Page, point: { x: number; y: number }, within: string): Promise<string> {
  return page.evaluate(
    ([{ x, y }, selector]) => {
      const n = document.elementFromPoint(x, y);
      const attrs = n ? [...n.attributes].filter((a) => /^(data-|class$|aria-label$|role$)/.test(a.name)).map((a) => `${a.name}=${a.value.slice(0, 32)}`).join(' ') : '';
      return `at ${x.toFixed(0)},${y.toFixed(0)}: <${n?.tagName.toLowerCase() ?? 'nothing'} ${attrs}>, ${n?.closest(selector) ? 'inside' : 'outside'} ${selector}`;
    },
    [point, within] as const,
  );
}
