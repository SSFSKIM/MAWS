// The page's documents seam (src/renderer/src/artifacts/e2e-seam.ts), as the store's e2e cases drive it: replicas opened
// through the window's real ArtifactHost (P3-A M4; M5 moved it here for the detached case of e2e/supervisor.spec.ts).
import type { Page } from '@playwright/test';

export interface Json {
  attrs: Record<string, unknown>;
  text: string;
}

type Seam = Record<string, (...args: unknown[]) => unknown>;
export function documents(page: Page) {
  const call = <T>(method: string, ...args: unknown[]) =>
    page.evaluate(([m, a]) => ((window as unknown as { __maws_documents: Seam }).__maws_documents[m as string] as (...x: unknown[]) => unknown)(...(a as unknown[])), [method, args] as const) as Promise<T>;
  return {
    open: (artifactId: string) => call<number>('open', artifactId),
    json: (id: number) => call<Json>('json', id),
    insertText: (id: number, index: number, text: string) => call<void>('insertText', id, index, text),
    setAttr: (id: number, key: string, value: unknown) => call<void>('setAttr', id, key, value),
    state: (id: number) => call<{ phase: string; synced: boolean; unsaved: number; revision: number; readOnly: boolean }>('state', id),
    restores: (id: number) => call<number[]>('restores', id),
    startTyping: (id: number, prefix: string, everyMs: number) => call<void>('startTyping', id, prefix, everyMs),
    stopTyping: (id: number) => call<{ typed: number; acked: number }>('stopTyping', id),
    close: (id: number) => call<void>('close', id),
  };
}

export async function seamReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __maws_documents?: unknown }).__maws_documents !== undefined, undefined, { timeout: 15_000 });
}
