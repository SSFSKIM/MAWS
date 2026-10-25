// UX2-K: cold, read-only configured inventory for Customize. These rows are not engine observations or connection
// state. Only display metadata crosses IPC; a server's URL, command, arguments, headers and environment never do.
import * as z from 'zod';
import type { CommandSpec } from './common';

// A normal coverage boundary, not a configuration read failure. Shared by the cold reader and its presentation.
export const CUSTOMIZATION_INVENTORY_COVERAGE = 'Plugin MCP servers and marketplace-only skill declarations are not inventoried; see Plugins.';

const AbsolutePath = z.string().min(1).max(4096).refine((path) => path.startsWith('/') && !path.includes('\0'), 'expected an absolute path');
export const CustomizationSkillSchema = z.strictObject({
  name: z.string(), description: z.string(), source: z.enum(['user', 'project', 'plugin']), path: AbsolutePath, plugin: z.string().nullable(),
});
export const CustomizationServerSchema = z.strictObject({
  name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: z.enum(['stdio', 'http', 'sse', 'ws', 'unknown']),
});
// P4-AGG M4: a configured server's endpoint, main's alone (a configured URL may carry a token, so it never reaches the
// renderer): the catalog matches it against the directory's connectors for Connectors' sign-in posture.
export const CustomizationEndpointSchema = z.strictObject({ name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: CustomizationServerSchema.shape.transport, url: z.string().max(4096).nullable() });
export const CustomizationInventorySchema = z.strictObject({
  skills: z.array(CustomizationSkillSchema), servers: z.array(CustomizationServerSchema), warnings: z.array(z.string()),
  // P4-AGG M4: every MCP configuration file that applies (app, user, local, each project `.mcp.json`) read without a
  // warning, so `servers` is the whole set; Connectors' duplicate refusal needs it before it lets Add run
  serversRead: z.boolean(),
});
export type CustomizationInventory = z.infer<typeof CustomizationInventorySchema>;
export type CustomizationSkill = z.infer<typeof CustomizationSkillSchema>;
export type CustomizationServer = z.infer<typeof CustomizationServerSchema>;
export type CustomizationEndpoint = z.infer<typeof CustomizationEndpointSchema>;

export const commands = {
  'customization.inventory': { input: z.strictObject({ cwd: AbsolutePath.nullable() }), output: CustomizationInventorySchema, owner: 'engine-host' },
  'customization.serverEndpoints': { input: z.strictObject({ cwd: AbsolutePath.nullable() }), output: z.strictObject({ servers: z.array(CustomizationEndpointSchema) }), owner: 'engine-host' }, // P4-AGG M4, main-only
} as const satisfies Record<string, CommandSpec<z.ZodType, z.ZodType>>;
export const events = {} as const;
