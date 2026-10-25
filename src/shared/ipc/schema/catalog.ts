// X2 `catalog.*` (P4-AGG; docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Interfaces): Discover's
// catalog, owned by main. One normalised, joined list of what can be added (plugins from the seed marketplaces, the
// engine's marketplaces and Anthropic's directory; connectors from the directory's servers), per Customize page `cwd`
// (null: the user configuration), cached on disk and refreshed every 24 h. Only display metadata and install routes
// cross; nothing of it reaches an agent.
import * as z from 'zod';
import type { CommandSpec } from './common';
import { PluginsCwdSchema } from './plugins';

const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

export const CatalogKindSchema = z.enum(['plugin', 'connector']);
export const OwnershipSchema = z.enum(['anthropic', 'partner', 'community', 'added']);
export const ReviewTierSchema = z.enum(['anthropic', 'partner', 'community']).nullable(); // the directory's verified_tier only
export const McpTransportSchema = z.enum(['stdio', 'http', 'sse', 'unknown']);
export const PluginRouteSchema = z.strictObject({
  kind: z.literal('plugin'),
  marketplaceSource: z.string(), // owner/repo, a URL or a path: what `plugin marketplace add` takes
  marketplaceName: z.string(), // what `plugin install <name>@<marketplace>` takes
  pluginName: z.string(),
  ref: z.string().nullable(), // this route's pin, if any; not part of identity
  present: z.boolean(), // the engine already has this marketplace: no add step
});
export const ConnectorRouteSchema = z.strictObject({
  kind: z.literal('connector'),
  name: z.string(), // the engine-legal name the sheet proposes
  url: z.string().nullable(), // null when the server takes an instance URL
  urlPattern: z.string().nullable(), // the directory's url_regex
  transport: z.enum(['http', 'sse']),
  authPosture: z.enum(['auth_required', 'no_auth']),
});
export const ManualRouteSchema = z.strictObject({ kind: z.literal('manual'), docsUrl: z.string().nullable(), reason: z.string() });
export const CatalogItemSchema = z.strictObject({
  id: z.string(), // stable: normalised repo url + path for a plugin; the directory's server id for a connector
  kind: CatalogKindSchema,
  name: z.string(), // the display name
  installName: z.string().nullable(), // what the command uses, when it differs
  description: z.string().nullable(),
  publisher: z.string().nullable(), // the publisher chain's answer
  ownership: OwnershipSchema, // the chosen route's
  reviewTier: ReviewTierSchema,
  scanBlocked: z.string().nullable(), // the directory's reason when a failed scan disables Add
  categories: z.array(z.string()), // the chosen axis's values
  iconUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
  installs: z.number().int().nullable(), // plugin-details unique_installs
  rank: z.number().int().nullable(), // the servers endpoint's popularity_rank
  components: z
    .strictObject({
      skills: z.array(z.string()),
      mcpServers: z.array(z.strictObject({ name: z.string(), transport: McpTransportSchema })),
      hooks: z.boolean(),
      commands: z.number().int(),
      agents: z.number().int(),
      cli: z.boolean(),
    })
    .nullable(), // null: not known before install
  runsOnYourComputer: z.union([z.boolean(), z.literal('unknown')]),
  install: z.union([PluginRouteSchema, ConnectorRouteSchema, ManualRouteSchema]), // the chosen route
  alsoListedBy: z.array(z.string()), // the other routes' marketplace names
  sources: z.array(z.string()), // source keys that listed it
  installed: z.enum(['here', 'elsewhere', 'no']), // for the request's cwd
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type CatalogComponents = NonNullable<CatalogItem['components']>;
export type PluginRoute = z.infer<typeof PluginRouteSchema>;
export type ConnectorRoute = z.infer<typeof ConnectorRouteSchema>;
export type Ownership = z.infer<typeof OwnershipSchema>;
export type ReviewTier = z.infer<typeof ReviewTierSchema>;

export const CatalogSourceStatusSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  fetchedAt: z.string().nullable(),
  state: z.enum(['fresh', 'stale', 'offline', 'unavailable']),
  dropped: z.number().int(),
});
export type CatalogSourceStatus = z.infer<typeof CatalogSourceStatusSchema>;
export const CatalogSortSchema = z.enum(['installs', 'updated', 'name']); // 'installs' is rank for connectors
export type CatalogSort = z.infer<typeof CatalogSortSchema>;

export const CatalogTabSchema = z.enum(['plugins', 'skills', 'connectors']);
export type CatalogTab = z.infer<typeof CatalogTabSchema>;
// The filter chips: ownership class and review tier together (the trust label's class: the tier where the directory has
// one, else the ownership)
export const CatalogChipSchema = z.enum(['anthropic', 'partner', 'community', 'added']);
export type CatalogChip = z.infer<typeof CatalogChipSchema>;
const CwdSchema = PluginsCwdSchema.nullable(); // the Customize page's directory; null for the user configuration
export const CATALOG_PAGE_SIZE = 60;
export const CATALOG_PAGE_MAX = 200;

export const CatalogShelfSchema = z.strictObject({
  key: z.string(), // 'added', a seed's source key, or `category:<value>`: the query's `source` or `category` filter
  kind: z.enum(['added', 'source', 'category']),
  title: z.string(),
  items: z.array(CatalogItemSchema), // the shelf's first items in shelf order
  total: z.number().int(),
});
export type CatalogShelf = z.infer<typeof CatalogShelfSchema>;
export const CatalogHomeSchema = z.strictObject({ featured: CatalogItemSchema.nullable(), shelves: z.array(CatalogShelfSchema), total: z.number().int() });
export type CatalogHome = z.infer<typeof CatalogHomeSchema>;

export const CatalogQueryInputSchema = z.strictObject({
  tab: CatalogTabSchema,
  cwd: CwdSchema,
  text: z.string().max(200).optional(),
  chips: z.array(CatalogChipSchema).max(4).optional(),
  category: z.string().max(100).nullable().optional(),
  source: z.string().max(200).nullable().optional(), // a source key or 'added'
  notInstalled: z.boolean().optional(),
  sort: CatalogSortSchema.optional(), // installs by default
  reverse: z.boolean().optional(), // the sort's other direction, ties reversed too
  cursor: z.string().max(2048).nullable().optional(),
  limit: z.number().int().min(1).max(CATALOG_PAGE_MAX).optional(), // CATALOG_PAGE_SIZE by default
});
export type CatalogQueryInput = z.infer<typeof CatalogQueryInputSchema>;
export const CatalogPageSchema = z.strictObject({ items: z.array(CatalogItemSchema), nextCursor: z.string().nullable(), total: z.number().int(), restarted: z.boolean() });
export type CatalogPage = z.infer<typeof CatalogPageSchema>;

export const commands = {
  'catalog.home': main(z.strictObject({ tab: CatalogTabSchema, cwd: CwdSchema }), CatalogHomeSchema),
  'catalog.query': main(CatalogQueryInputSchema, CatalogPageSchema),
  'catalog.item': main(z.strictObject({ id: z.string().max(4096), cwd: CwdSchema }), CatalogItemSchema),
  'catalog.refresh': main(z.strictObject({}), z.array(CatalogSourceStatusSchema)),
  'catalog.sources': main(z.strictObject({}), z.array(CatalogSourceStatusSchema)),
} as const satisfies Record<`catalog.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'catalog.changed': z.strictObject({}), // once per refresh that changed anything and once per engine-read invalidation
} as const satisfies Record<`catalog.${string}`, z.ZodType>;
