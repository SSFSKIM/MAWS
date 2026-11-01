// The engine's view of one cwd as it crosses the wire (P5 O4 M3, docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// Interfaces §C; D16, D25): Discover's catalog splits by the fact's owner, so the engine's reads per cwd are the machine's
// (`catalog.engine`, src/services/catalog/) and the join is the person's (src/main/catalog/). The join's `EngineView`
// holds two `ReadonlyMap`s, which the socket's JSON codec would send as `{}`; on the wire they are arrays of `[key,
// value]` entries, validated by the registry, and main's join converts them back once per read (`engineViewFromWire`,
// src/main/catalog/normalize.ts). Neutral ground: the machine's reads and the person's join both import it. Zod and the
// schemas it composes alone, since the registry imports it on every process's run path.
import * as z from 'zod';
import { MarketplaceSchema } from '../ipc/schema/marketplaces';
import { AvailablePluginSchema, InstalledPluginSchema, MarketplaceManifestViewSchema } from '../ipc/schema/plugins';

// The engine's built-in marketplace over Anthropic's directory (the Discover spec's fact 2): always the engine's, never
// a listed row. The machine's reads ask the engine's provenance of its installed entries by it; the join routes by it.
export const DIRECTORY_MARKETPLACE = 'anthropic-plugin-directory';

// The engine's reads for one cwd (the user configuration's directory for a cwd of null); a read that failed is null.
export const EngineViewWireSchema = z.strictObject({
  cwd: z.string(),
  installed: z.array(InstalledPluginSchema).nullable(),
  available: z.array(AvailablePluginSchema).nullable(),
  marketplaces: z.array(MarketplaceSchema).nullable(),
  manifests: z.array(z.tuple([z.string(), MarketplaceManifestViewSchema])), // [marketplace name, its manifest]
  servers: z.array(z.string()).nullable(), // the MCP server names configured in a scope that applies here
  // [entry name, the place of its code as the engine recorded it at install (its fold key)]: each installed Anthropic
  // Directory plugin, which the available listing omits once installed (fact 2a)
  directoryInstalled: z.array(z.tuple([z.string(), z.string()])),
});
export type EngineViewWire = z.infer<typeof EngineViewWireSchema>;
