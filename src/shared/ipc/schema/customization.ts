// UX2-K: cold, read-only configured inventory for Customize. These rows are not engine observations or connection
// state. Only display metadata crosses IPC; a server's URL, command, arguments, headers and environment never do.
import * as z from 'zod';
import type { CommandSpec } from './common';

// A normal coverage boundary, not a configuration read failure: a mark on the wire, which the window finds by equality
// and words itself (customize/InventoryState.tsx; UX wave U11h, §G). Its value is kept: build F's window folds it as its
// own constant, and this build's window words it as this text for an engine host that answers no `pluginServers`.
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
// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §A): a connector that an installed
// plugin's files declare. Three names kept apart: `plugin`, the key it is installed by (a session's `source` for it);
// `pluginName`, its manifest's `name`; `name`, the engine's `plugin:<pluginName>:<server>`, under which a session lists it.
// Its address never crosses to the window: `address` is the address's shape alone.
const InstallScope = z.enum(['user', 'project', 'local']);
export const CustomizationPluginServerSchema = z.strictObject({
  plugin: z.string().min(1).max(256), // the key, `<name>@<marketplace>`: installed_plugins.json's, the id of its row in My items
  pluginName: z.string().max(256).nullable(), // the manifest name; null: not readable
  server: z.string().min(1).max(256), // the name the plugin's file gives the server, as written
  name: z.string().min(1).max(1024).nullable(), // the engine's name, whole; null when pluginName is null or the key ends `@builtin`
  installScope: InstallScope,
  version: z.string().max(256).nullable(), // the installation record's version
  path: AbsolutePath, // the file that declares it
  transport: CustomizationServerSchema.shape.transport,
  address: z.enum(['literal', 'templated', 'templated-origin']).nullable(), // the shape of its address, never its text; null: it has none (a local command)
  sameAddressAs: z.string().max(256).nullable(), // a `user`, `project` or `local` entry of this read with the same address, by its name
});
// The same connector as main and the services read it: with its address and the engine host's revision of it (an HMAC
// over the key, the installation, the engine name, the transport and the address; null without an engine name or an address).
export const CustomizationPluginEndpointSchema = z.strictObject({
  plugin: z.string().min(1).max(256), pluginName: z.string().max(256).nullable(), server: z.string().min(1).max(256),
  name: z.string().min(1).max(1024).nullable(), version: z.string().max(256).nullable(),
  path: AbsolutePath, transport: CustomizationServerSchema.shape.transport,
  url: z.string().max(4096).nullable(), revision: z.string().max(64).nullable(),
});
export const CustomizationInventorySchema = z.strictObject({
  skills: z.array(CustomizationSkillSchema), servers: z.array(CustomizationServerSchema), warnings: z.array(z.string()),
  // P4-AGG M4: every MCP configuration file that applies (app, user, local, each project `.mcp.json`) read without a
  // warning, so `servers` is the whole set; Connectors' duplicate refusal needs it before it lets Add run
  serversRead: z.boolean(),
  // UX wave U11h (§A): each connector an installed plugin's files declare for the folder, and every plugin installation
  // kept for the folder, one per key (also one that declares no connector: its manifest name alone can make it a possible
  // owner of another's engine name). Absent from an engine host of an earlier build; this build always sends both, empty
  // where there is nothing.
  pluginServers: z.array(CustomizationPluginServerSchema).optional(),
  plugins: z.array(z.strictObject({ plugin: z.string().min(1).max(256), pluginName: z.string().max(256).nullable(), installScope: InstallScope })).optional(),
  // UX wave U11's skill actions (decision 12): every skill folder that applies was read without a warning (the coverage note
  // aside) and the read ran to its end, so a skill not listed is not there; absent from an engine host of an earlier build
  skillsRead: z.boolean().optional(),
});
export type CustomizationInventory = z.infer<typeof CustomizationInventorySchema>;
export type CustomizationSkill = z.infer<typeof CustomizationSkillSchema>;
export type CustomizationServer = z.infer<typeof CustomizationServerSchema>;
export type CustomizationEndpoint = z.infer<typeof CustomizationEndpointSchema>;
export type CustomizationPluginServer = z.infer<typeof CustomizationPluginServerSchema>;
export type CustomizationPluginEndpoint = z.infer<typeof CustomizationPluginEndpointSchema>;

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
  'customization.serverEndpoints': { input: z.strictObject({ cwd: AbsolutePath.nullable() }), output: z.strictObject({ servers: z.array(CustomizationEndpointSchema), pluginServers: z.array(CustomizationPluginEndpointSchema).optional() /* UX wave U11h (§A): absent from an earlier build */ }), owner: 'engine-host' }, // P4-AGG M4, main-only
  'customization.skillFile': { input: z.strictObject({ cwd: AbsolutePath.nullable(), path: AbsolutePath, app: z.enum(SKILL_FILE_APPS) }), output: SkillFileOutputSchema, owner: 'main' }, // UX wave U11
} as const satisfies Record<string, CommandSpec<z.ZodType, z.ZodType>>;
export const events = {} as const;
