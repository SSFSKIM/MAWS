// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The link grammar"; ledger X33, the X9 and X25
// amendments): the link an agent writes to name an artifact, `maws-artifact:<uuid>[#v<n>][#tab=<tabId>][#block=<blockId>]
// [#slide=<id>]`, and the place it opens the artifact at. A document's block names its tab (block ids are unique in a
// document), so `#block=` alone is enough. Main's content form (`maws-artifact://<uuid>/<revision>/<path>`, ./scheme.ts)
// names the artifact too; a fragment after its path is the page's own, not a place.
import * as z from 'zod';

const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/; // a tab's, a block's and a slide's ids
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PlaceIdSchema = z.string().regex(PLACE_ID);
export const ArtifactLocationSchema = z.strictObject({
  version: z.number().int().min(1).optional(), // a retained version
  tab: PlaceIdSchema.optional(), // a document's tab
  block: PlaceIdSchema.optional(), // a document's top-level block
  slide: PlaceIdSchema.optional(), // a presentation's slide (a design's board where its editor can)
});
export type ArtifactLocation = z.infer<typeof ArtifactLocationSchema>;

export interface ArtifactLinkTarget {
  artifactId: string;
  at?: ArtifactLocation;
}

// The scheme, `//` in the content form, the id, then the rest: parts after `#` or `&`, or the content form's path
const LINK = /^maws-artifact:(?:\/\/)?([^/?#&]+)(.*)$/is;
const VERSION_PART = /^v([1-9][0-9]{0,8})$/;
const NAMED_PART = /^(tab|block|slide)=(.*)$/s;

// What a link names, or null when it names no artifact by its store id. A part it cannot read is dropped (the link still
// opens the artifact); a part written twice keeps the first.
export function parseArtifactLink(href: string): ArtifactLinkTarget | null {
  const match = LINK.exec(href);
  if (!match) return null;
  const artifactId = match[1]!.toLowerCase();
  if (!UUID.test(artifactId)) return null;
  const rest = match[2]!;
  if (rest[0] !== '#' && rest[0] !== '&') return { artifactId };
  const at: ArtifactLocation = {};
  for (const part of rest.slice(1).split(/[#&]/)) {
    const version = VERSION_PART.exec(part);
    if (version) {
      at.version ??= Number(version[1]);
      continue;
    }
    const named = NAMED_PART.exec(part);
    if (named && PLACE_ID.test(named[2]!)) at[named[1] as 'tab' | 'block' | 'slide'] ??= named[2]!;
  }
  return Object.keys(at).length > 0 ? { artifactId, at } : { artifactId };
}

// The link to an artifact, at a place when given: the parts in the grammar's order, joined by `#`.
export function artifactLink(artifactId: string, at: ArtifactLocation = {}): string {
  const parts = [`maws-artifact:${artifactId}`];
  if (at.version !== undefined) parts.push(`v${at.version}`);
  if (at.tab !== undefined) parts.push(`tab=${at.tab}`);
  if (at.block !== undefined) parts.push(`block=${at.block}`);
  if (at.slide !== undefined) parts.push(`slide=${at.slide}`);
  return parts.join('#');
}
