// X2 `marketplaces.*` (E8 execution document, Interfaces "X2: plugins.*, marketplaces.*, session.reloadSkills"; P1
// interface ledger §5): the marketplaces the engine knows, through its CLI in a process the engine host owns. The list is
// `claude plugin marketplace list --json` reduced; the three mutations are operations completing on `plugins.operation`
// (`./plugins.ts`), so one event carries every plugin-management operation. Owner `engine-host`; no event of its own.
import * as z from 'zod';
import { OperationReceiptSchema } from '../../engine/operations';
import type { CommandSpec } from './common';
import { PluginsArgumentSchema, PluginsBinarySchema, PluginsCwdSchema, PluginsScopeSchema } from './plugins';

const host = <I extends z.ZodType, O extends z.ZodType>(i: I, o: O) => ({ input: i, output: o, owner: 'engine-host' as const });

export const MarketplaceSchema = z.strictObject({
  name: z.string(),
  source: z.string(), // the source kind: directory, github, git, url, file, claudeai, …
  locator: z.string().nullable(), // the repository, URL or path, whichever the row carries
  // P2-B start (2026-10-09): the branch or tag a repository marketplace is pinned to (P2-B execution document §5.3,
  // §5.4): its relative entries have no fold key; optional, so a producer that omits it names none
  ref: z.string().nullable().optional(),
  // P2-B end
  installLocation: z.string().nullable(),
});
export type Marketplace = z.infer<typeof MarketplaceSchema>;

export const commands = {
  'marketplaces.list': host(z.strictObject({ cwd: PluginsCwdSchema }), z.strictObject({ marketplaces: z.array(MarketplaceSchema) })),
  'marketplaces.add': host(z.strictObject({ cwd: PluginsCwdSchema, binary: PluginsBinarySchema, source: PluginsArgumentSchema, scope: PluginsScopeSchema.optional() }), OperationReceiptSchema),
  'marketplaces.update': host(z.strictObject({ cwd: PluginsCwdSchema, binary: PluginsBinarySchema, name: PluginsArgumentSchema }), OperationReceiptSchema),
  'marketplaces.remove': host(z.strictObject({ cwd: PluginsCwdSchema, binary: PluginsBinarySchema, name: PluginsArgumentSchema, scope: PluginsScopeSchema.optional() }), OperationReceiptSchema),
} as const satisfies Record<`marketplaces.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`marketplaces.${string}`, z.ZodType>;
