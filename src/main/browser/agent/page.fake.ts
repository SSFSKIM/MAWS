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

type Box = { x: number; y: number; width: number; height: number };
type Options = { timeout?: number; signal?: AbortSignal; state?: string; mode?: string; trial?: boolean } | undefined;
export type ScreenshotOptions = { type?: 'png' | 'jpeg'; quality?: number; scale?: string; style?: string; fullPage?: boolean; timeout?: number; signal?: AbortSignal };

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
  // per selector: the element's bounding box (or what reads it); none set: null, as for an element not rendered
  readonly boxes = new Map<string, Box | (() => Box | null)>();
  // the page went (a crash: the bridge's detach closes Playwright's page): pending and later waits reject with this
  closedWith: Error | null = null;
  // what a screenshot answers: `selector` is 'page' for the page's own (viewport or fullPage), else the locator's
  onScreenshot: (selector: string, options: ScreenshotOptions) => Buffer | Promise<Buffer> = () => Buffer.alloc(0);
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

  getByRole(role: string, options: { name?: string; exact?: boolean; includeHidden?: boolean } = {}): FakeLocator {
    const name = options.name === undefined ? '' : ` name=${JSON.stringify(options.name)}`;
    return new FakeLocator(this, `role=${role}${name}${options.exact ? ' exact' : ''}${options.includeHidden ? ' hidden' : ''}`);
  }

  async ariaSnapshot(options?: Options): Promise<string> {
    this.record('ariaSnapshot', 'page', [options]);
    return this.snapshots.get('page') ?? '';
  }

  url(): string {
    return this.currentUrl;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.record('screenshot', 'page', [options]);
    return this.onScreenshot('page', options);
  }

  evaluate(expression: string): Promise<unknown> {
    this.record('evaluate', null, [expression]);
    return this.onEvaluate(expression);
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
        after(
          10,
          options.signal,
          () => (this.page.closedWith ? reject(this.page.closedWith) : ready() ? resolve() : Date.now() - started >= timeout ? reject(timeoutError('waitFor', timeout)) : poll()),
          reject,
        );
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

  async boundingBox(options?: Options): Promise<Box | null> {
    this.page.record('boundingBox', this.selector, [options]);
    const box = this.page.boxes.get(this.selector) ?? null;
    return typeof box === 'function' ? box() : box;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.page.record('screenshot', this.selector, [options]);
    return this.page.onScreenshot(this.selector, options);
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

// Encoded pictures for the screenshot tests: headers only, padded with zeros to `size` bytes (what a capture answers).
// A PNG: its signature and IHDR (the dimension reader reads no further).
export function pngBytes(width: number, height: number, size = 0): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8; // bit depth
  head[25] = 6; // RGBA
  return size > head.length ? Buffer.concat([head, Buffer.alloc(size - head.length)]) : head;
}

// A JPEG: SOI, an APP0 and a DHT segment (neither a frame header), the SOF of `sof` with the size, then EOI.
export function jpegBytes(width: number, height: number, { sof = 0xc0, size = 0 } = {}): Buffer {
  const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const bytes = Buffer.from([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xc4, [0x00, ...new Array<number>(16).fill(0)]),
    ...segment(sof, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    0xff, 0xd9,
  ]);
  return size > bytes.length ? Buffer.concat([bytes, Buffer.alloc(size - bytes.length)]) : bytes;
}
