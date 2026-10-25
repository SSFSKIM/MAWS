// The catalog's network records, read at the boundary (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md,
// Design "Parsing"). Every record passes a zod schema; one that fails is dropped and counted and never stops its source;
// unknown fields are ignored; a taxonomy value may be a string or an array. A source whose document is not the documented
// one at all (no `plugins` array, no `data`) fails whole, so its last copy stands. Each record is reduced here to the
// fields the catalog shows or joins on, so the cache in memory holds no more than that.
import * as z from 'zod';

const str = z.string();
const opt = <T extends z.ZodType>(schema: T) => schema.nullish().catch(undefined);
const text = opt(str);
const nonEmpty = (value: string | null | undefined): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const names = z.array(z.unknown()).catch([]);
const nameOf = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name : null);

// A taxonomy axis: a string or an array of strings; anything else reads as none.
const axisValues = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
export const TAXONOMY_AXES = ['object_acted_on', 'work_department', 'industry', 'life_area', 'subject'] as const;
export type Taxonomy = Partial<Record<(typeof TAXONOMY_AXES)[number], string[]>>;
const TaxonomySchema = z
  .record(z.string(), z.unknown())
  .nullish()
  .catch(undefined)
  .transform((raw): Taxonomy => Object.fromEntries(TAXONOMY_AXES.flatMap((axis) => (raw && axisValues(raw[axis]).length > 0 ? [[axis, axisValues(raw[axis])]] : []))));

export interface Parsed<T> {
  records: T[];
  dropped: number;
}
function each<T>(items: readonly unknown[], schema: z.ZodType<T>): Parsed<T> {
  const records: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) records.push(parsed.data);
    else dropped += 1;
  }
  return { records, dropped };
}

// -- a marketplace manifest (a seed's, fetched) ------------------------------------------------------------------------

// An entry's source: a path inside the marketplace's repository, or an object naming another repository and its pins.
const EntrySourceSchema = z.union([
  str,
  z.looseObject({ source: str, repo: text, url: text, path: text, ref: text, sha: text }).transform((s) => ({ kind: s.source, repo: s.repo ?? null, url: s.url ?? null, path: s.path ?? null, ref: s.ref ?? null, sha: s.sha ?? null })),
]);
export type EntrySource = z.infer<typeof EntrySourceSchema>;

const EntrySchema = z
  .looseObject({
    name: str.min(1),
    description: text,
    author: z.unknown().optional(),
    source: EntrySourceSchema,
    strict: opt(z.boolean()),
    skills: z.unknown().optional(),
    mcpServers: z.unknown().optional(),
    hooks: z.unknown().optional(),
    commands: z.unknown().optional(),
    agents: z.unknown().optional(),
    homepage: text,
  })
  .transform((e) => ({
    name: e.name,
    description: nonEmpty(e.description),
    author: nonEmpty(nameOf(e.author)),
    source: e.source,
    strict: e.strict ?? true,
    declared: { skills: e.skills, mcpServers: e.mcpServers, hooks: e.hooks, commands: e.commands, agents: e.agents },
    homepage: nonEmpty(e.homepage),
  }));
export type ManifestEntry = z.infer<typeof EntrySchema>;
export interface SeedManifest {
  name: string | null;
  owner: string | null;
  entries: Parsed<ManifestEntry>;
}

export function parseSeedManifest(pages: readonly unknown[]): SeedManifest {
  const doc = z.looseObject({ name: text, owner: z.unknown().optional(), plugins: z.array(z.unknown()) }).parse(pages[0]);
  return { name: nonEmpty(doc.name), owner: nonEmpty(nameOf(doc.owner)), entries: each(doc.plugins, EntrySchema) };
}

// -- the directory's plugins ---------------------------------------------------------------------------------------

export type ComponentAccess = 'stays_inside_claude' | 'runs_on_your_computer' | 'sends_data_to' | 'unknown';
const ComponentSchema = z
  .looseObject({ type: str, name: text, access: opt(z.looseObject({ type: text })) })
  .transform((c) => ({ type: c.type, name: nonEmpty(c.name), access: (['stays_inside_claude', 'runs_on_your_computer', 'sends_data_to'].includes(c.access?.type ?? '') ? c.access!.type : 'unknown') as ComponentAccess }));
export type DirectoryComponent = z.infer<typeof ComponentSchema>;

const DirectoryPluginSchema = z
  .looseObject({
    id: str.min(1),
    name: str.min(1),
    summary: text,
    description: text,
    verified_tier: opt(z.enum(['anthropic', 'partner', 'community'])),
    checks: opt(z.looseObject({ scan: opt(z.looseObject({ state: text, assessment: text, reason: text })) })),
    surfaces: z.array(z.unknown()).catch([]),
    components: z.array(z.unknown()).catch([]),
    source: z.looseObject({ repository: z.looseObject({ url: str.min(1), path: text, reviewed_commit: text }) }),
    taxonomy: TaxonomySchema,
    updated_time: text,
    publisher: opt(z.looseObject({ name: text })),
    media: opt(z.looseObject({ icons: names })),
    links: opt(z.looseObject({ homepage: text })),
  })
  .transform((r) => {
    const scan = r.checks?.scan;
    const icon = (r.media?.icons ?? []).map((i) => (typeof i === 'object' && i !== null && typeof (i as { url?: unknown }).url === 'string' ? (i as { url: string }).url : null)).find((u) => u !== null) ?? null;
    return {
      id: r.id,
      name: r.name,
      description: nonEmpty(r.summary) ?? nonEmpty(r.description),
      tier: r.verified_tier ?? null,
      // a failed scan disables Add (Desktop's shape: a `ready` scan whose assessment is `fail`); none fails today
      scanBlocked: scan?.state === 'ready' && scan.assessment === 'fail' ? (nonEmpty(scan.reason) ?? 'It failed Anthropic’s security scan.') : null,
      claudeCode: r.surfaces.includes('claude_code'),
      components: each(r.components, ComponentSchema).records,
      repository: r.source.repository.url,
      path: nonEmpty(r.source.repository.path),
      reviewedCommit: /^[0-9a-f]{40}$/.test(r.source.repository.reviewed_commit ?? '') ? r.source.repository.reviewed_commit! : null,
      taxonomy: r.taxonomy,
      updatedAt: nonEmpty(r.updated_time),
      publisher: nonEmpty(r.publisher?.name),
      iconUrl: icon,
      homepage: nonEmpty(r.links?.homepage),
    };
  });
export type DirectoryPlugin = z.infer<typeof DirectoryPluginSchema>;

// A record without `source.repository` fails here: it is a connector or a desktop extension, not a plugin (fact 3).
export function parseDirectoryPlugins(pages: readonly unknown[]): Parsed<DirectoryPlugin> {
  const data = pages.flatMap((page) => z.looseObject({ data: z.array(z.unknown()) }).parse(page).data);
  return each(data, DirectoryPluginSchema);
}

// -- the directory's servers ---------------------------------------------------------------------------------------

// A server's fixed choice of URLs (`remote.url_options`, as Desktop reads it: `{url, label, description?}` each); an
// option without a URL or a label says nothing and is left out.
const UrlOptionSchema = z.looseObject({ url: str, label: str, description: text });
function urlOptionsOf(options: unknown[] | null | undefined): { url: string; label: string; description: string | null }[] {
  return (options ?? []).flatMap((option) => {
    const parsed = UrlOptionSchema.safeParse(option);
    if (!parsed.success || nonEmpty(parsed.data.url) === null || nonEmpty(parsed.data.label) === null) return [];
    return [{ url: parsed.data.url, label: parsed.data.label, description: nonEmpty(parsed.data.description) }];
  });
}

const ServerSchema = z
  .looseObject({
    id: str.min(1),
    type: str,
    name: text,
    display_name: text,
    slug: text,
    one_liner: text,
    description: text,
    icon_url: text,
    author: opt(z.looseObject({ name: text })),
    categories: z.array(z.unknown()).catch([]),
    works_with: z.array(z.unknown()).catch([]),
    remote: opt(z.looseObject({ url: text, url_regex: text, url_options: z.array(z.unknown()).nullish().catch(null), transport: text, auth_posture: text, is_authless: opt(z.boolean()) })),
    claude_code_copy_text: text,
    verified_tier: opt(z.enum(['anthropic', 'partner', 'community'])),
    taxonomy: TaxonomySchema,
    popularity_rank: opt(z.number().int()),
    documentation: text,
  })
  .refine((s) => nonEmpty(s.display_name) !== null || nonEmpty(s.name) !== null, 'a server with no name')
  .transform((s) => ({
    id: s.id,
    type: s.type,
    name: (nonEmpty(s.display_name) ?? nonEmpty(s.name))!,
    slug: nonEmpty(s.slug),
    description: nonEmpty(s.one_liner) ?? nonEmpty(s.description),
    iconUrl: nonEmpty(s.icon_url),
    publisher: nonEmpty(s.author?.name),
    categories: s.categories.filter((c): c is string => typeof c === 'string'),
    worksWithClaudeCode: s.works_with.includes('claude-code'),
    remote: s.remote ? { url: nonEmpty(s.remote.url), urlPattern: nonEmpty(s.remote.url_regex), urlOptions: urlOptionsOf(s.remote.url_options), transport: s.remote.transport ?? null, authPosture: s.remote.auth_posture === 'no_auth' || (s.remote.auth_posture == null && s.remote.is_authless === true) ? ('no_auth' as const) : ('auth_required' as const) } : null,
    copyText: nonEmpty(s.claude_code_copy_text),
    tier: s.verified_tier ?? null,
    taxonomy: s.taxonomy,
    rank: s.popularity_rank ?? null,
    docsUrl: nonEmpty(s.documentation),
  }));
export type DirectoryServer = z.infer<typeof ServerSchema>;

export function parseDirectoryServers(pages: readonly unknown[]): Parsed<DirectoryServer> {
  const servers = pages.flatMap((page) => z.looseObject({ servers: z.array(z.unknown()) }).parse(page).servers);
  return each(servers, ServerSchema);
}

// -- plugin-details.json (the official marketplace's counts and contents) -----------------------------------------------

const DetailSchema = z
  .looseObject({
    unique_installs: opt(z.number().int().nonnegative()),
    last_updated: text,
    components: opt(z.looseObject({ commands: names, agents: names, skills: names, hooks: names, mcpServers: names })),
  })
  .transform((d) => ({
    installs: d.unique_installs ?? null,
    updatedAt: nonEmpty(d.last_updated),
    components: d.components
      ? {
          skills: d.components.skills.map(nameOf).filter((n): n is string => n !== null),
          mcpServers: d.components.mcpServers.map(nameOf).filter((n): n is string => n !== null),
          hooks: d.components.hooks.length > 0,
          commands: d.components.commands.length,
          agents: d.components.agents.length,
        }
      : null,
  }));
export type PluginDetail = z.infer<typeof DetailSchema>;

// Keyed `<name>@claude-plugins-official`, as the engine keys them.
export function parsePluginDetails(pages: readonly unknown[]): { details: Map<string, PluginDetail>; dropped: number } {
  const doc = z.looseObject({ plugins: z.record(z.string(), z.unknown()) }).parse(pages[0]);
  const details = new Map<string, PluginDetail>();
  let dropped = 0;
  for (const [id, raw] of Object.entries(doc.plugins)) {
    const parsed = DetailSchema.safeParse(raw);
    if (parsed.success) details.set(id, parsed.data);
    else dropped += 1;
  }
  return { details, dropped };
}

// -- the network data together ---------------------------------------------------------------------------------------

/** One source's pages as the catalog keeps them, with how many of its records were dropped. */
export type ParsedSource =
  | { kind: 'seed'; manifest: SeedManifest; dropped: number }
  | { kind: 'plugins'; records: DirectoryPlugin[]; dropped: number }
  | { kind: 'servers'; records: DirectoryServer[]; dropped: number }
  | { kind: 'details'; details: Map<string, PluginDetail>; dropped: number };

/** A source's pages parsed; throws when the document is not its documented shape at all. */
export function parseSource(key: string, pages: readonly unknown[]): ParsedSource {
  if (key === 'directory:plugins') {
    const { records, dropped } = parseDirectoryPlugins(pages);
    return { kind: 'plugins', records, dropped };
  }
  if (key === 'directory:servers') {
    const { records, dropped } = parseDirectoryServers(pages);
    return { kind: 'servers', records, dropped };
  }
  if (key === 'plugin-details') return { kind: 'details', ...parsePluginDetails(pages) };
  const manifest = parseSeedManifest(pages);
  return { kind: 'seed', manifest, dropped: manifest.entries.dropped };
}

/** What the network sources hold now; a source with no copy is absent (null, or no seed entry). */
export interface NetworkData {
  seeds: Map<string, SeedManifest>; // by source key, `seed:<marketplace name>`
  plugins: DirectoryPlugin[] | null;
  servers: DirectoryServer[] | null;
  details: Map<string, PluginDetail> | null;
}

export function networkData(parsed: ReadonlyMap<string, ParsedSource>): NetworkData {
  const data: NetworkData = { seeds: new Map(), plugins: null, servers: null, details: null };
  for (const [key, source] of parsed) {
    if (source.kind === 'seed') data.seeds.set(key, source.manifest);
    else if (source.kind === 'plugins') data.plugins = source.records;
    else if (source.kind === 'servers') data.servers = source.records;
    else data.details = source.details;
  }
  return data;
}
