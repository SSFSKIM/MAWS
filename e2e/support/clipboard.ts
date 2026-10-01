// The Mac's pasteboard as an end-to-end case drives it (⌘C, ⌘V, Electron's `clipboard`). There is one for the whole
// Mac, shared with the owner's copies, other apps, a GUI sitting and every MAWS run in any checkout. A case runs its
// clipboard steps inside `withNativeClipboard`, which serializes them across runs with a lock file in the OS temp
// directory (within a run, the one worker of playwright.config.ts already does) and afterwards writes back what the
// pasteboard held when the steps began (every kind Electron's `clipboard.read()` reports or, if writing those fails,
// the text alone), but only while the pasteboard still holds a text the steps put there: a copy made by anything else
// since is left alone. That is all it can promise. A copy made while the steps run fails the case, and one made after
// their last write is kept at the price of the owner's earlier copy, so a run that drives the clipboard needs the Mac's
// pasteboard to itself.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { acquireFileLock } from '../../test/support/file-lock';

const LOCK = join(tmpdir(), 'maws-e2e-clipboard.lock');

// What main keeps between the read and the write-back: each item's payload by MIME type, and the plain text.
type Saved = { items: Record<string, Blob | { title: string; url: string }>[]; text: string };

// `puts` is every text the steps may leave on the pasteboard.
export async function withNativeClipboard<T>(app: ElectronApplication, puts: readonly string[], steps: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(LOCK, { waitMs: 30_000 });
  try {
    await app.evaluate(async ({ clipboard }) => {
      const items: Saved['items'] = [];
      for (const item of await clipboard.read()) {
        const payloads: Saved['items'][number] = {};
        for (const type of item.types) {
          const payload = await Promise.resolve(item.getType(type)).catch(() => null); // a kind listed but not readable is skipped
          if (payload) payloads[type] = payload;
        }
        if (Object.keys(payloads).length > 0) items.push(payloads);
      }
      (globalThis as { __savedClipboard?: Saved }).__savedClipboard = { items, text: await clipboard.readText() };
    });
    let passed = false;
    try {
      const result = await steps();
      passed = true;
      return result;
    } finally {
      // Read and written back in one call into main, so nothing of the case's runs between the check and the write.
      const restored = app.evaluate(
        async ({ clipboard, ClipboardItem }, puts) => {
          const saved = (globalThis as { __savedClipboard?: Saved }).__savedClipboard!;
          const now = await clipboard.readText();
          if (!puts.includes(now)) return now === saved.text ? 'untouched' : 'taken';
          try {
            if (saved.items.length === 0) clipboard.clear();
            else await clipboard.write(saved.items.map((payloads) => new ClipboardItem(payloads)));
            return 'restored';
          } catch (error) {
            clipboard.clear();
            if (saved.text) await clipboard.writeText(saved.text);
            return `restored its text only (${String(error)})`;
          }
        },
        [...puts],
      );
      const report = (outcome: string) => {
        if (outcome === 'taken') console.warn('[e2e] the clipboard was changed by something else after the case wrote it; left as it is');
        else if (outcome !== 'restored' && outcome !== 'untouched') console.warn(`[e2e] the clipboard was not written back whole: ${outcome}`);
      };
      // A failed write-back fails the case, unless the steps failed first: theirs is the error to report.
      if (passed) report(await restored);
      else await restored.then(report, (error: unknown) => report(String(error)));
    }
  } finally {
    release();
  }
}
