// A fake playwright-core Page and Locator for the browser tools' unit tests (E4c execution document, Acceptance "Also
// pinned"): every call is recorded in order with its selector and options, and what a selector matches, how its waits
// and checks answer and what an action does are set per selector. A locator's selector reads as Playwright's would be
// built: `css=#a`, `aria-ref=e5`, `role=button name="Save"`, joined by ` & ` for `and` and suffixed ` >> first`.
import type { Locator, Page } from 'playwright-core';

export interface FakeCall {
  method: string;
  selector: string | null;
  args: unknown[];
}

type Options = { timeout?: number; signal?: AbortSignal; state?: string; mode?: string; trial?: boolean } | undefined;

const abortError = (signal: AbortSignal) => Object.assign(new Error(`The operation was aborted: ${String(signal.reason)}`), { name: 'AbortError' });
const timeoutError = (method: string, ms: number) => Object.assign(new Error(`locator.${method}: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting`), { name: 'TimeoutError' });

// Settles after `ms` (fake timers advance it), or rejects at once when the signal aborts.
function after(ms: number, signal: AbortSignal | undefined, settle: () => void, fail: (error: Error) => void): void {
  if (signal?.aborted) return fail(abortError(signal));
  const timer = setTimeout(settle, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    fail(abortError(signal));
  }, { once: true });
}

export class FakePage {
  readonly calls: FakeCall[] = [];
  currentUrl = 'https://a.test/';
  // per selector: how many elements match (an Error: what `count` throws)
  readonly counts = new Map<string, number | Error>();
  // per selector: the element is attached but not visible (waitFor visible times out) until the selector is deleted
  readonly hidden = new Set<string>();
  // per selector: successive answers of isEnabled / isEditable (the last repeats; default true)
  readonly enabled = new Map<string, boolean[]>();
  readonly editable = new Map<string, boolean[]>();
  onCheck: (method: 'isEnabled' | 'isEditable', selector: string) => void = () => {}; // runs as a check answers
  // per selector, or 'page': the aria snapshot text and the default-mode JSON
  readonly snapshots = new Map<string, string>();
  readonly json = new Map<string, unknown>();
  // what an action does (by method), after it is recorded: navigate, throw, wait
  readonly onAction = new Map<string, (call: FakeCall) => void | Promise<void>>();
  onEvaluate: (expression: string) => Promise<unknown> = async () => undefined;
  onLoadState: (state: string, options: Options) => Promise<void> = async () => {};
  readonly mouse = { wheel: async (deltaX: number, deltaY: number) => void this.record('mouse.wheel', null, [deltaX, deltaY]) };

  record(method: string, selector: string | null, args: unknown[]): FakeCall {
    const call = { method, selector, args };
    this.calls.push(call);
    return call;
  }

  // The calls as `<method> <selector>` lines, for asserting an order.
  lines(): string[] {
    return this.calls.map(({ method, selector }) => (selector === null ? method : `${method} ${selector}`));
  }

  countOf(selector: string): number {
    const first = selector.endsWith(' >> first');
    const base = first ? selector.slice(0, -' >> first'.length) : selector;
    const count = this.counts.get(base) ?? 0;
    if (count instanceof Error) throw count;
    return first ? Math.min(count, 1) : count;
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this, selector);
  }

  getByRole(role: string, options: { name?: string; exact?: boolean } = {}): FakeLocator {
    return new FakeLocator(this, `role=${role}${options.name === undefined ? '' : ` name=${JSON.stringify(options.name)}`}${options.exact ? ' exact' : ''}`);
  }

  async ariaSnapshot(options?: Options): Promise<string> {
    this.record('ariaSnapshot', 'page', [options]);
    return this.snapshots.get('page') ?? '';
  }

  url(): string {
    return this.currentUrl;
  }

  evaluate(expression: string): Promise<unknown> {
    this.record('evaluate', null, [expression]);
    return this.onEvaluate(expression);
  }

  waitForLoadState(state: string, options: Options): Promise<void> {
    this.record('waitForLoadState', state, [options]);
    return this.onLoadState(state, options);
  }

  asPage(): Page {
    return this as unknown as Page;
  }
}

export class FakeLocator {
  constructor(
    private readonly page: FakePage,
    readonly selector: string,
  ) {}

  and(other: FakeLocator): FakeLocator {
    return new FakeLocator(this.page, `${this.selector} & ${other.selector}`);
  }

  first(): FakeLocator {
    return new FakeLocator(this.page, `${this.selector} >> first`);
  }

  async count(): Promise<number> {
    this.page.record('count', this.selector, []);
    return this.page.countOf(this.selector);
  }

  waitFor(options: Options = {}): Promise<void> {
    this.page.record(`waitFor ${options.state}`, this.selector, [options]);
    return new Promise<void>((resolve, reject) => {
      const ready = () => this.page.countOf(this.selector) > 0 && (options.state !== 'visible' || !this.page.hidden.has(this.selector));
      if (options.signal?.aborted) return reject(abortError(options.signal));
      if (ready()) return resolve();
      // poll the fake's state every 10 ms until the timeout, as Playwright's own retries do
      const timeout = options.timeout ?? 30_000;
      const started = Date.now();
      const poll = () =>
        after(10, options.signal, () => (ready() ? resolve() : Date.now() - started >= timeout ? reject(timeoutError('waitFor', timeout)) : poll()), reject);
      poll();
    });
  }

  async isEnabled(options?: Options): Promise<boolean> {
    this.page.record('isEnabled', this.selector, [options]);
    this.page.onCheck('isEnabled', this.selector);
    return next(this.page.enabled, this.selector);
  }

  async isEditable(options?: Options): Promise<boolean> {
    this.page.record('isEditable', this.selector, [options]);
    this.page.onCheck('isEditable', this.selector);
    return next(this.page.editable, this.selector);
  }

  async ariaSnapshot(options?: Options): Promise<string> {
    this.page.record('ariaSnapshot', this.selector, [options]);
    return this.page.snapshots.get(this.selector) ?? '';
  }

  async ariaSnapshotJSON(options?: Options): Promise<unknown> {
    this.page.record('ariaSnapshotJSON', this.selector, [options]);
    return this.page.json.get(this.selector) ?? [];
  }

  click = (options?: Options) => this.act('click', [options]);
  fill = (value: string, options?: Options) => this.act('fill', [value, options]);
  selectOption = (value: string, options?: Options) => this.act('selectOption', [value, options]);
  setChecked = (checked: boolean, options?: Options) => this.act('setChecked', [checked, options]);
  press = (key: string, options?: Options) => this.act('press', [key, options]);
  hover = (options?: Options) => this.act('hover', [options]);
  scrollIntoViewIfNeeded = (options?: Options) => this.act('scrollIntoViewIfNeeded', [options]);

  asLocator(): Locator {
    return this as unknown as Locator;
  }

  private async act(method: string, args: unknown[]): Promise<void> {
    const call = this.page.record(method, this.selector, args);
    await this.page.onAction.get(method)?.(call);
  }
}

function next(answers: Map<string, boolean[]>, selector: string): boolean {
  const queue = answers.get(selector);
  if (!queue || queue.length === 0) return true;
  return queue.length === 1 ? queue[0]! : queue.shift()!;
}
