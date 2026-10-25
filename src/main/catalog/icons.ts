// Discover's icons (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Decision Log 7(b)): main fetches an
// icon the directory names, only from the catalog egress rule's two icon routes (the directory's plugin icons on
// api.anthropic.com and its server icons in its own storage bucket), caches it beside the catalog
// (`catalog/icons/<sha256 of the URL>.json`) and answers the renderer a data URL; the renderer fetches nothing. Any other
// URL (Google's favicon service, a vendor's site, the 132 desktop extensions' claude.ai icons) answers null at once,
// with no request, and the card draws a monogram.
// - A plugin icon's URL names its content's sha256, so its copy is kept; a server icon's copy is refetched after 24 h,
//   and kept when that fails.
// - A failure (none answered, refused by the rule, bytes that are not the image their type names) is remembered for
//   RETRY_MS, so a shelf scrolled back and forth does not ask again; icons asked together are asked once, four at a time.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIconUrl, type IconAnswer, type IconGet } from './fetch';
import { REFRESH_AGE_MS, RETRY_MS } from './store';

const PARALLEL = 4;
const CONTENT_ADDRESSED = /^https:\/\/api\.anthropic\.com\/api\/directory\/plugin-icons\//;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Saved {
  url: string;
  contentType: string;
  fetchedAt: number;
  data: string; // base64
}

// The bytes are the image their type names: a PNG's signature, or an SVG document's root element.
function isImage({ contentType, bytes }: IconAnswer): boolean {
  if (contentType === 'image/png') return PNG_MAGIC.every((byte, at) => bytes[at] === byte);
  if (contentType === 'image/svg+xml') return /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 4096)));
  return false;
}

export class CatalogIcons {
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly failedAt = new Map<string, number>();
  private readonly queue: (() => void)[] = [];
  private running = 0;
  private readonly now: () => number;

  constructor(private readonly deps: { dir: string; get: IconGet; now?: () => number; log?: (line: string) => void }) {
    this.now = deps.now ?? Date.now;
  }

  /** The icon at `url` as a data URL, or null (not an icon route, or none could be had). */
  dataUrl(url: string): Promise<string | null> {
    if (!isIconUrl(url)) return Promise.resolve(null);
    let answer = this.pending.get(url);
    if (!answer) {
      answer = this.resolve(url).finally(() => this.pending.delete(url));
      this.pending.set(url, answer);
    }
    return answer;
  }

  private async resolve(url: string): Promise<string | null> {
    const saved = await this.read(url);
    if (saved && (CONTENT_ADDRESSED.test(url) || this.now() - saved.fetchedAt < REFRESH_AGE_MS)) return dataOf(saved);
    const failed = this.failedAt.get(url);
    if (failed !== undefined && this.now() - failed < RETRY_MS) return saved ? dataOf(saved) : null;
    const fetched = await this.limited(() => this.download(url));
    if (fetched === null) {
      this.failedAt.set(url, this.now());
      return saved ? dataOf(saved) : null;
    }
    this.failedAt.delete(url);
    const copy: Saved = { url, contentType: fetched.contentType, fetchedAt: this.now(), data: Buffer.from(fetched.bytes).toString('base64') };
    await this.write(copy).catch((error: unknown) => this.deps.log?.(`icon ${url}: not cached: ${error instanceof Error ? error.message : String(error)}`));
    return dataOf(copy);
  }

  private async download(url: string): Promise<IconAnswer | null> {
    try {
      const answer = await this.deps.get(url);
      if (answer !== null && isImage(answer)) return answer;
      if (answer !== null) this.deps.log?.(`icon ${url}: its bytes are not ${answer.contentType}`);
      return null;
    } catch (error) {
      this.deps.log?.(`icon ${url}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= PARALLEL) await new Promise<void>((go) => this.queue.push(go));
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.queue.shift()?.();
    }
  }

  private pathOf(url: string): string {
    return join(this.deps.dir, `${createHash('sha256').update(url).digest('hex')}.json`);
  }

  private async read(url: string): Promise<Saved | null> {
    try {
      const saved = JSON.parse(await readFile(this.pathOf(url), 'utf8')) as Partial<Saved>;
      if (saved.url !== url || typeof saved.contentType !== 'string' || typeof saved.fetchedAt !== 'number' || typeof saved.data !== 'string') return null;
      return saved as Saved;
    } catch {
      return null;
    }
  }

  private async write(copy: Saved): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    const path = this.pathOf(copy.url);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(copy));
    await rename(temporary, path);
  }
}

const dataOf = (saved: Saved): string => `data:${saved.contentType};base64,${saved.data}`;
