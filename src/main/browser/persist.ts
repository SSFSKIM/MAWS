// `<userData>/browser/tabs.json` (E4a execution document, Design §2 and §15; G4): the browser tabs that survive a
// relaunch, as `{url, title}` entries that load only when asked. Read once at boot; a file that cannot be read is moved
// aside as `tabs.json.broken-<epoch>` and the store starts empty. Written whole, at most once per 300 ms while dirty and
// at once at `will-quit`. Every write is synchronous, as the layout store's are (`../layout/store.ts`): the file is a few
// kilobytes, and a synchronous write leaves no asynchronous write in flight that could land after the quit's flush and
// put an older list back.
import { readFileSync, renameSync } from 'node:fs';
import * as z from 'zod';
import { AppSessionIdSchema } from '@shared/graph/ids';
import { BrowserTabIdSchema, BrowserTabSchema } from '@shared/browser/tab';
import { atomicWriteFileSync } from '../files/atomic-write';

const WRITE_INTERVAL_MS = 300;

export const PersistedTabSchema = BrowserTabSchema.pick({
  tabId: true,
  appSessionId: true,
  partition: true,
  url: true,
  title: true,
  favicon: true,
  zoom: true,
  createdAt: true,
  lastShownAt: true,
});
export type PersistedTab = z.infer<typeof PersistedTabSchema>;

export const TabsFileSchema = z.strictObject({
  version: z.literal(1),
  tabs: z.array(PersistedTabSchema),
  selected: z.record(AppSessionIdSchema, BrowserTabIdSchema.nullable()),
});
export type TabsFile = z.infer<typeof TabsFileSchema>;

const EMPTY: TabsFile = { version: 1, tabs: [], selected: {} };

export function readTabsFile(file: string, { now = Date.now }: { now?: () => number } = {}): { file: TabsFile; broken: boolean } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file: EMPTY, broken: false };
    return moveAside(file, now(), error);
  }
  try {
    const parsed = TabsFileSchema.safeParse(JSON.parse(text));
    if (parsed.success) return { file: parsed.data, broken: false };
    return moveAside(file, now(), parsed.error);
  } catch (error) {
    return moveAside(file, now(), error);
  }
}

function moveAside(file: string, epoch: number, reason: unknown): { file: TabsFile; broken: true } {
  const aside = `${file}.broken-${epoch}`;
  try {
    renameSync(file, aside);
    console.warn(`[browser] ${file} could not be read; moved aside as ${aside} and started empty:`, reason instanceof Error ? reason.message : reason);
  } catch (error) {
    console.warn(`[browser] ${file} could not be read nor moved aside; started empty:`, error instanceof Error ? error.message : error);
  }
  return { file: EMPTY, broken: true };
}

// Writes `contents()` to the file at most once per interval while dirty; `flushSync` writes now if anything is pending.
// Text identical to the last write is not written again (most tab changes, a memory sample or a loading flag, touch no
// field the file keeps).
export class TabsFileWriter {
  private dirty = false;
  private written: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly file: string,
    private readonly contents: () => TabsFile,
  ) {}

  markDirty(): void {
    this.dirty = true;
    this.timer ??= setTimeout(() => this.flushSync(), WRITE_INTERVAL_MS);
  }

  flushSync(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const text = `${JSON.stringify(this.contents(), null, 2)}\n`;
    if (text === this.written) return;
    try {
      atomicWriteFileSync(this.file, text);
      this.written = text;
    } catch (error) {
      console.warn(`[browser] could not write ${this.file}:`, error instanceof Error ? error.message : error);
    }
  }
}
