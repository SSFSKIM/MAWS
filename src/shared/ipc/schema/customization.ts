// UX2-K: cold, read-only configured inventory for Customize. These rows are not engine observations or connection
// state. Only display metadata crosses IPC; a server's URL, command, arguments, headers and environment never do.
import * as z from 'zod';
import type { CommandSpec } from './common';

// A normal coverage boundary, not a configuration read failure. Shared by the cold reader and its presentation.
export const CUSTOMIZATION_INVENTORY_COVERAGE = 'Plugin MCP servers and marketplace-only skill declarations are not inventoried; see Plugins.';

const AbsolutePath = z.string().min(1).max(4096).refine((path) => path.startsWith('/') && !path.includes('\0'), 'expected an absolute path');
export const CustomizationSkillSchema = z.strictObject({
  name: z.string(), description: z.string(), source: z.enum(['user', 'project', 'plugin']), path: AbsolutePath, plugin: z.string().nullable(),
  // UX wave U11a (§D "Skills", P3): a plugin skill's plugin as the engine names it, the `name` of the plugin's
  // .claude-plugin/plugin.json, which `/<pluginName>:<name> ` runs; null when that name could not be read; absent on a
  // person's or a project's skill, and from an engine host of an earlier build
  pluginName: z.string().max(256).nullable().optional(),
  // UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decision 12): the file
  // the inventory read, by its real path and its identity (`<device>:<inode>`), which main holds a skill's Open in to;
  // absent from an engine host of an earlier build, whose skills main opens nothing for
  realPath: AbsolutePath.optional(),
  fileId: z.string().max(64).optional(),
});
export const CustomizationServerSchema = z.strictObject({
  name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: z.enum(['stdio', 'http', 'sse', 'ws', 'unknown']),
});
// P4-AGG M4: a configured server's endpoint, main's alone (a configured URL may carry a token, so it never reaches the
// renderer): the catalog matches it against the directory's connectors for Connectors' sign-in posture.
// UX wave U11a M8 (§A): `revision`, an opaque stand-in for the configuration (its name, transport and address) that the
// engine host keys per run, so a press from Customize can name the configuration its row showed; null: no address;
// absent from an engine host of an earlier build.
export const CustomizationEndpointSchema = z.strictObject({ name: z.string(), scope: z.enum(['app', 'user', 'project', 'local']), path: AbsolutePath, transport: CustomizationServerSchema.shape.transport, url: z.string().max(4096).nullable(), revision: z.string().max(64).nullable().optional() });
export const CustomizationInventorySchema = z.strictObject({
  skills: z.array(CustomizationSkillSchema), servers: z.array(CustomizationServerSchema), warnings: z.array(z.string()),
  // P4-AGG M4: every MCP configuration file that applies (app, user, local, each project `.mcp.json`) read without a
  // warning, so `servers` is the whole set; Connectors' duplicate refusal needs it before it lets Add run
  serversRead: z.boolean(),
  // UX wave U11's skill actions (decision 12): every skill folder that applies was read without a warning (the coverage note
  // aside) and the read ran to its end, so a skill not listed is not there; absent from an engine host of an earlier build
  skillsRead: z.boolean().optional(),
});
export type CustomizationInventory = z.infer<typeof CustomizationInventorySchema>;
export type CustomizationSkill = z.infer<typeof CustomizationSkillSchema>;
export type CustomizationServer = z.infer<typeof CustomizationServerSchema>;
export type CustomizationEndpoint = z.infer<typeof CustomizationEndpointSchema>;

// UX wave U11, a skill's actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decisions 2, 6 and
// 11): a skill's SKILL.md handed to a row of "Open in" (an editor, or Finder, which reveals it) only when the inventory
// main reads itself for `cwd` lists exactly `path`; the window's string is a request, never the path opened. `missing`:
// not listed, or no regular file there now; `unreadable`: the inventory could not be read (`message`, its reason);
// `launch`: the row is not installed or did not open (`message`, the launcher's sentence).
export const SKILL_FILE_APPS = ['vscode', 'vscodeInsiders', 'cursor', 'windsurf', 'zed', 'xcode', 'finder'] as const; // no terminal: a skill is a file
export const SkillFileOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('opened') }),
  z.strictObject({ status: z.literal('refused'), reason: z.enum(['missing', 'unreadable', 'launch']), message: z.string().max(4096).nullable() }),
]);
export type SkillFileOutput = z.infer<typeof SkillFileOutputSchema>;

export const commands = {
  'customization.inventory': { input: z.strictObject({ cwd: AbsolutePath.nullable() }), output: CustomizationInventorySchema, owner: 'engine-host' },
  'customization.serverEndpoints': { input: z.strictObject({ cwd: AbsolutePath.nullable() }), output: z.strictObject({ servers: z.array(CustomizationEndpointSchema) }), owner: 'engine-host' }, // P4-AGG M4, main-only
  'customization.skillFile': { input: z.strictObject({ cwd: AbsolutePath.nullable(), path: AbsolutePath, app: z.enum(SKILL_FILE_APPS) }), output: SkillFileOutputSchema, owner: 'main' }, // UX wave U11
} as const satisfies Record<string, CommandSpec<z.ZodType, z.ZodType>>;
export const events = {} as const;
