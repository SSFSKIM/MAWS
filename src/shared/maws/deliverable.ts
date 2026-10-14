// X12, the deliverable record (P1 spec §10 X12; E1 execution document, Interfaces "X9", residue 7): one record per
// delivered file, written by the engine host under `<userData>/deliverables/<appSessionId>/<id>.json`, the file itself
// referenced in place (A-3). E1 writes `kind: 'file'` with the basename as the title and one version, the file as
// delivered. E2 (E2 execution document, Design §2) extends it additively, every new field optional so E1's files parse
// unchanged: an artifact's `artifactId` (the agent's short name) and `updatedAt` (its last version's time), and per
// version the call that added it and the path the agent named (the version's `path` is MAWS's copy). `path` is the
// latest version's path. P3-L (M6b): the store is retired; these schemas remain for the import's reader and the legacy page URL.
// E4c (E4c execution document, Design §7) writes `kind: 'screenshot'` for `browser_screenshot`, with the page's URL in
// the additive `sourceUrl` and the picture under `screenshots/`.
import * as z from 'zod';
import { AppSessionIdSchema, ToolUseIdSchema, type AppSessionId } from '../graph/ids';
import { ARTIFACT_ID } from './tools';

export const DeliverableRecordSchema = z.strictObject({
  id: z.uuid(),
  appSessionId: AppSessionIdSchema,
  kind: z.enum(['file', 'artifact', 'screenshot']),
  artifactId: z.string().regex(ARTIFACT_ID).optional(), // E2: present on `kind: 'artifact'`
  path: z.string(),
  title: z.string().optional(),
  caption: z.string().optional(),
  versions: z.array(
    z.strictObject({
      path: z.string(),
      at: z.string(),
      toolUseId: ToolUseIdSchema.optional(), // E2: the call that added this version
      sourcePath: z.string().optional(), // E2: the path the agent named; `path` is the copy
      // P3-A (M6): the session whose call added this version, when another than the record's (a side thread's publish
      // of its parent's page): with `toolUseId` it names the call, since a raw tool-use id may recur across sessions
      appSessionId: AppSessionIdSchema.optional(),
    }),
  ),
  toolUseId: ToolUseIdSchema.optional(), // the call that delivered it (`_meta["claudecode/toolUseId"]`)
  createdAt: z.string(),
  updatedAt: z.string().optional(), // E2: the last version's time
  // E4c start: the page a screenshot was taken of: any URL the tab had, as Chromium serialises it (no whitespace), checked
  // without zod's url(), which trims
  sourceUrl: z.string().refine((url) => !/\s/.test(url) && URL.canParse(url), { message: 'not a URL' }).optional(),
  // E4c end
});
export type DeliverableRecord = z.infer<typeof DeliverableRecordSchema>;

// P2-F L117 (P2-0 G3's pattern): what a reader of the files parses. A later build's key in a record or a version is
// stripped, so this build reads the record rather than passing it over; `DeliverableRecordSchema` stays the strict write
// and IPC schema, so a record this build writes back carries only its own shape and nothing writes a new key.
export const StoredDeliverableRecordSchema = DeliverableRecordSchema.extend({
  versions: z.array(DeliverableRecordSchema.shape.versions.element.strip()),
}).strip();

// E2 (Design §3, Decision Log 6): the privileged scheme main serves the store's files through, one file per URL:
// `maws-deliverable://<recordId>/<appSessionId>/<n>`. The record's uuid is the host (lowercase, so a standard scheme's
// host case-folding changes nothing, and each record is its own origin); the app session id, which may carry uppercase,
// is the first path segment; `n` the 1-based version. Pure strings: the renderer builds the URL, main parses a frame's
// or a console message's URL to attribute it.
export const DELIVERABLE_SCHEME = 'maws-deliverable';

export const deliverableUrl = (appSessionId: AppSessionId, id: string, version: number) => `${DELIVERABLE_SCHEME}://${id}/${appSessionId}/${version}`;

const DELIVERABLE_URL = /^maws-deliverable:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9._-]+)\/([1-9][0-9]*)(?:[?#].*)?$/;

// The deliverable a URL names, or null for anything that is not exactly that shape. A fragment or a query (a page that
// moved within itself) still names its deliverable; whether the app session id is safe on disk is the reader's check.
export function parseDeliverableUrl(url: string): { appSessionId: AppSessionId; id: string; version: number } | null {
  const match = DELIVERABLE_URL.exec(url);
  if (!match) return null;
  const version = Number(match[3]);
  if (!Number.isSafeInteger(version)) return null;
  return { appSessionId: match[2] as AppSessionId, id: match[1]!, version };
}
