// P4-B5: the Notion target of the owner's Send to (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): what MAWS
// asks of Notion's hosted MCP server and how it reads the answer. The page is made by `notion-create-pages` with the
// artifact's title as its title and its content in Notion's enhanced Markdown (X31's `notion` dialect of the document's
// Markdown), so it arrives as a readable page, not an attached file. The tool's own contract is Notion's: the arguments
// below are the ones its published schema names, and a live tools/list must still show the tool at the send.

export const NOTION_TOOL = 'notion-create-pages';
// A server that needs a sign-in reports no tools until it has one, so the hosted server is also found by its address.
export const NOTION_HOSTS: readonly string[] = ['mcp.notion.com'];
// Past this the request is refused before anything is sent (route D bounds what it carries; a page this size is far
// beyond what a sheet should push in one call).
export const NOTION_CONTENT_MAX_BYTES = 4 * 1024 * 1024;
const TITLE_MAX = 2_000; // Notion's title property
const WORDS_MAX = 300;

export function notionTitle(title: string): string {
  const clean = [...[...title].map((char) => (char.charCodeAt(0) < 0x20 || char === '\u007f' ? ' ' : char)).join('').trim()].slice(0, TITLE_MAX).join(''); // control characters as spaces
  return clean.length > 0 ? clean : 'Untitled';
}

// The tool's arguments: one page, private at the workspace level unless a parent page is named; answered at once
// (`allow_async: false`), since the receipt needs the page that was made.
export function notionArguments({ title, content, parent }: { title: string; content: string; parent?: string }): Record<string, unknown> {
  return {
    pages: [{ properties: { title: notionTitle(title) }, content }],
    ...(parent !== undefined && { parent: { type: 'page_id', page_id: parent } }),
    allow_async: false,
  };
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export type NotionAnswer = { ok: true; url: string | null; name?: string } | { ok: false; message: string };

// What the tool's result says: the page made (its address, when the answer names one), or the tool's own error.
export function readNotionAnswer(result: unknown): NotionAnswer {
  const answer = record(result);
  const texts = Array.isArray(answer?.content) ? answer.content.flatMap((part) => (record(part)?.type === 'text' && typeof record(part)?.text === 'string' ? [record(part)!.text as string] : [])) : [];
  if (answer?.isError === true) return { ok: false, message: (texts.join(' ').trim() || 'Notion refused the page').slice(0, WORDS_MAX) };
  const parsed = [answer?.structuredContent, ...texts.map((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } })];
  for (const value of parsed) {
    const page = firstPage(value);
    if (page) return { ok: true, ...page };
  }
  for (const value of parsed) {
    const url = typeof value === 'string' ? notionUrlIn(value) : null;
    if (url) return { ok: true, url };
  }
  return { ok: true, url: null };
}

function firstPage(value: unknown): { url: string | null; name?: string } | null {
  const object = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  if (!object) return null;
  const pages = Array.isArray(object.pages) ? object.pages : Array.isArray(object.results) ? object.results : [object];
  for (const candidate of pages) {
    const page = typeof candidate === 'object' && candidate !== null ? (candidate as Record<string, unknown>) : null;
    if (!page) continue;
    const url = typeof page.url === 'string' ? notionUrlIn(page.url) : typeof page.id === 'string' && /^[0-9a-f-]{32,36}$/i.test(page.id) ? `https://www.notion.so/${page.id.replaceAll('-', '')}` : null;
    if (url) {
      const title = record(page.properties)?.title;
      return { url, ...(typeof title === 'string' && { name: title }) };
    }
  }
  return null;
}
// The first https notion.so (or notion.site) address in `text`.
function notionUrlIn(text: string): string | null {
  for (const match of text.matchAll(/https:\/\/[^\s"'<>)\]]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.hostname === 'notion.so' || url.hostname.endsWith('.notion.so') || url.hostname.endsWith('.notion.site')) return url.toString();
    } catch {
      // not an address
    }
  }
  return null;
}
