// X2 `plugins.*` (E8 execution document, Interfaces "X2: plugins.*, marketplaces.*, session.reloadSkills"; P1 interface
// ledger §5): plugin management through the engine's own CLI (`claude plugin …`) in a process the engine host owns (D-1,
// D-2). Reads answer the CLI's `--json` reduced to the fields the widget shows; every mutation is an operation: a receipt
// `{ opId }` at once, then `plugins.operation` events (started, the CLI's output lines, reloading, done) and, after it,
// `plugins.changed`. Owner `engine-host` for every command. The `marketplaces.*` mutations complete on the same event.
import * as z from 'zod';
import { OperationReceiptSchema } from '../../engine/operations';
import { isPluginsArgument, PLUGINS_ACTIONS, PLUGINS_SCOPES } from '../../plugins/cli';
import type { CommandSpec } from './common';

const host = <I extends z.ZodType, O extends z.ZodType>(i: I, o: O) => ({ input: i, output: o, owner: 'engine-host' as const });
// The CLI's cwd (the session's directory): project and local scope write there.
export const PluginsCwdSchema = z.string().refine((path) => path.startsWith('/'), 'an absolute directory');
// A plugin id, a marketplace source or name: never something the CLI would read as an option.
export const PluginsArgumentSchema = z.string().max(4096).refine(isPluginsArgument, 'a value, not an option');
export const PluginsScopeSchema = z.enum(PLUGINS_SCOPES);
// The engine binary a mutation's sheet named (`plugins.env`'s `binary`): the host runs nothing when its probe now
// resolves to another (Settings › Engine changed meanwhile).
export const PluginsBinarySchema = z.string().refine((path) => path.startsWith('/'), 'the absolute path plugins.env answered');
export const AcceptCommandSchema = z.string().regex(/^[0-9a-f]{64}$/, 'the sha256 the CLI reported as shownCommand.sha256');

export const InstalledPluginSchema = z.strictObject({
  id: z.string(), // `name@marketplace` as the CLI lists it
  name: z.string(),
  marketplace: z.string(), // '' when the id names none
  version: z.string().nullable(),
  scope: z.string(), // user, project, local, or a pseudo-marketplace's (session, synced)
  enabled: z.boolean(),
  projectPath: z.string().nullable(), // a project or local record's project
  installPath: z.string(),
  errors: z.array(z.string()),
  notes: z.array(z.string()),
});
export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>;

export const AvailablePluginSchema = z.strictObject({
  pluginId: z.string(),
  name: z.string(),
  marketplaceName: z.string(),
  description: z.string().nullable(),
  version: z.string().nullable(),
});
export type AvailablePlugin = z.infer<typeof AvailablePluginSchema>;

export const PluginsActionSchema = z.enum(PLUGINS_ACTIONS);

export const PLUGINS_ERROR_CODES = ['cli_failed', 'no_result', 'spawn_failed', 'timeout', 'cancelled', 'output_overflow'] as const; // output_overflow: the CLI's output passed the runner's bound
export const PluginsOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) }), // the CLI's --json object
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(PLUGINS_ERROR_CODES),
      message: z.string(), // the engine's own words (its `message`, or stderr's last line)
      failureCode: z.string().nullable(),
      shownCommand: z.record(z.string(), z.unknown()).nullable(), // verbatim, for the second sheet and `acceptCommand`
    }),
  }),
]);
export type PluginsOutcome = z.infer<typeof PluginsOutcomeSchema>;

export const SessionReloadSchema = z.strictObject({
  appSessionId: z.string(),
  outcome: z.enum(['reflected', 'not_reflected', 'no_expectation', 'failed']),
  error: z.string().nullable(),
});
export type SessionReload = z.infer<typeof SessionReloadSchema>;

export const PluginsOperationEventSchema = z.strictObject({
  opId: z.string(),
  action: PluginsActionSchema,
  target: z.string(), // the plugin id, the marketplace name or the source as typed
  phase: z.enum(['started', 'output', 'reloading', 'done']),
  line: z.string().optional(), // phase output: one line the CLI printed (stdout or stderr), trimmed
  outcome: PluginsOutcomeSchema.optional(), // phase done
  reload: z.strictObject({ sessions: z.array(SessionReloadSchema) }).optional(), // phase done, successful mutations that reload; empty when no session was ready
});
export type PluginsOperationEvent = z.infer<typeof PluginsOperationEventSchema>;

const cwd = { cwd: PluginsCwdSchema };
const plugin = { ...cwd, binary: PluginsBinarySchema, plugin: PluginsArgumentSchema, scope: PluginsScopeSchema.optional() };

export const commands = {
  // reads
  'plugins.env': host(z.strictObject({}), z.strictObject({ binary: z.string().nullable(), binaryError: z.string().nullable() /* the probe's refusal when binary is null */, configHome: z.string(), globalConfig: z.string() /* the engine's global config file: <CLAUDE_CONFIG_DIR>/.claude.json, else ~/.claude.json */ })),
  'plugins.list': host(z.strictObject(cwd), z.strictObject({ plugins: z.array(InstalledPluginSchema) })),
  'plugins.available': host(z.strictObject(cwd), z.strictObject({ plugins: z.array(AvailablePluginSchema) })),
  // operations, completing on plugins.operation
  'plugins.install': host(z.strictObject({ ...plugin, acceptCommand: AcceptCommandSchema.optional() }), OperationReceiptSchema),
  'plugins.update': host(z.strictObject({ ...plugin, acceptCommand: AcceptCommandSchema.optional() }), OperationReceiptSchema),
  'plugins.uninstall': host(z.strictObject({ ...plugin, keepData: z.boolean().optional() }), OperationReceiptSchema),
  'plugins.enable': host(z.strictObject(plugin), OperationReceiptSchema),
  'plugins.disable': host(z.strictObject(plugin), OperationReceiptSchema),
  'plugins.cancel': host(z.strictObject({ opId: z.string() }), z.strictObject({ cancelled: z.boolean() })),
} as const satisfies Record<`plugins.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'plugins.operation': PluginsOperationEventSchema,
  'plugins.changed': z.strictObject({}),
} as const satisfies Record<`plugins.${string}`, z.ZodType>;
