// Shared helpers for the three suites.
export interface Harness {
  versions: Record<string, string>;
  insertText(text: string): Promise<void>;
  key(keyCode: string, modifiers?: string[]): Promise<void>;
  focusContents(): Promise<void>;
  report(result: unknown): Promise<void>;
}
export const harness = (window as unknown as { harness: Harness }).harness;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let rafRan = 0;
let rafMissed = 0;
/** n animation frames (each bounded at 200 ms, counted, so a hidden window that stops painting cannot hang the run). */
export async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await new Promise<void>((resolve) => {
      let done = false;
      requestAnimationFrame(() => {
        if (!done) rafRan += 1;
        done = true;
        resolve();
      });
      setTimeout(() => {
        if (!done) rafMissed += 1;
        done = true;
        resolve();
      }, 200);
    });
  }
}
export const rafStats = () => ({ rafRan, rafMissed });

export async function until(check: () => boolean, ms = 2000): Promise<boolean> {
  const give = performance.now() + ms;
  while (!check()) {
    if (performance.now() > give) return false;
    await sleep(5);
  }
  return true;
}

type Mover = (parent: Element, node: Node) => void;
export const moveBefore: Mover = (parent, node) => (parent as Element & { moveBefore(n: Node, c: Node | null): void }).moveBefore(node, null);
export const insertBefore: Mover = (parent, node) => void parent.insertBefore(node, null);

export const el = (tag: string, props: Record<string, unknown> = {}, ...children: Node[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = String(v);
    else if (k === 'style') e.setAttribute('style', String(v));
    else if (k in e) (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  e.append(...children);
  return e;
};

export const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
