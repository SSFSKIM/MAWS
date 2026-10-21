// P4-B5: where the owner's Send to puts a delivery (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7): Notion's
// default, a private page in the owner's workspace, or inside a page the owner names; Drive's, the root of My Drive, or
// a folder the owner names. The owner names one by pasting its link (or its id); these read the id out of what was
// pasted, and refuse anything else, so only an id of the service's own shape ever reaches a request.

export type DeliveryTarget = 'notion' | 'drive';
export const DELIVERY_TARGETS: readonly DeliveryTarget[] = ['notion', 'drive'];

// A Notion page id: 32 hex digits, dashed or not, at the end of a notion.so (or notion.site) link's path or alone.
const NOTION_ID = /([0-9a-f]{32})$/i;
const NOTION_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A Drive folder id: the letters, digits, `-` and `_` Drive mints, from a /folders/<id> link, an `?id=` link or alone.
const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

const isNotionHost = (host: string) => host === 'notion.so' || host.endsWith('.notion.so') || host.endsWith('.notion.site');

// The page id in a pasted Notion link or id (undashed, lower case), or null when it names none.
export function notionPageId(pasted: string): string | null {
  const text = pasted.trim();
  if (NOTION_DASHED.test(text)) return text.replaceAll('-', '').toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(text)) return text.toLowerCase();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !isNotionHost(url.hostname)) return null;
  const last = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  const found = NOTION_ID.exec(last.replaceAll('-', ''));
  return found ? found[1]!.toLowerCase() : null;
}

// The folder id in a pasted Drive folder link or id, or null when it names none.
export function driveFolderId(pasted: string): string | null {
  const text = pasted.trim();
  if (DRIVE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('folders');
  const id = at >= 0 ? parts[at + 1] : (url.searchParams.get('id') ?? undefined);
  return id !== undefined && DRIVE_ID.test(id) ? id : null;
}

// What a request carries: the service's default place, or the id the owner named.
export type DeliveryDestination = { kind: 'default' } | { kind: 'inside'; id: string };

export const destinationIdOf = (target: DeliveryTarget, pasted: string): string | null => (target === 'notion' ? notionPageId(pasted) : driveFolderId(pasted));
