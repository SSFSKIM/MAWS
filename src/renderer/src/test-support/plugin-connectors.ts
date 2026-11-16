// Renderer tests of a plugin's connectors in Customize (UX wave U11h, docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md,
// M3): what the page is answered, made by the real derivations rather than by hand, so that every join a row rests on (a
// session's status entry to a plugin's row by the engine name, a retained record to a row's revision, the collision's
// prefix test over the inventory's plugins) runs over the names those derivations build.
// - The inventory and the endpoints are the engine host's own readers over a scratch config home holding invented
//   plugins; `catalog.postures` is main's own derivation over those endpoints (no directory record matches, so a posture
//   is the test's to state).
// - A session's status is what the engine host's status tracker derives from a `system/init` shaped as 2.1.322 sends it
//   (spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn-names.jsonl seq 30: `plugins` with the manifest name, the
//   plugin's folder in its marketplace, the key as `source`, the version; `mcp_servers` with name, status and source),
//   checked by the `session.status` event's schema and lifted to the page's addresses.
// Every plugin, server and marketplace name is invented; every address is under example.com.
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EngineSessionStatus } from '@shared/engine/status';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { CommandOutput } from '@shared/ipc/schema';
import type { CustomizationInventory } from '@shared/ipc/schema/customization';
import { REGISTRY } from '@shared/ipc/registry';
import { validateEventPayload } from '@shared/ipc/validate';
import { addressingOf } from '@shared/machine/address';
import { readCustomizationInventory, readServerEndpoints } from '../../../engine-host/customization/inventory';
import { SessionStatusTracker } from '../../../engine-host/session-status';
import { configurationFingerprint, pluginPosturesOf, posturesOf } from '../../../main/catalog/postures';
import { status as fullStatus } from '../../../../test/support/builders';
import { TEST_MACHINE } from '../../../../test/support/machine';

export interface ScenePlugin {
  key: string; // `<name>@<marketplace>`
  manifest: string | null; // the manifest's `name`; null: a manifest with no name
  servers: Record<string, { type?: string; url?: string; command?: string }>;
  scope?: 'user' | 'project' | 'local';
  projectPath?: string;
  version?: string;
}

export interface PluginScene {
  cwd: string; // the page's folder
  inventory: CustomizationInventory;
  postures: CommandOutput<'catalog.postures'>;
  /** The same folder read again, after `change` rewrote what is installed (a revision moves with what it covers). */
  reread(change: { plugins?: ScenePlugin[] }): Promise<Pick<PluginScene, 'inventory' | 'postures'>>;
  done(): Promise<void>;
}

const json = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
};

/** A scratch config home with these plugins installed (and these servers configured at user scope), read for its folder
 * as the engine host reads it; `posture` states the directory's posture for a plugin's server by its server name. */
export async function pluginScene(plugins: ScenePlugin[], opts: { configured?: Record<string, { type: string; url: string }>; posture?: Record<string, 'auth_required' | 'no_auth'> } = {}): Promise<PluginScene> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maws-plugin-rows-')));
  const home = join(root, 'home');
  const configHome = join(home, '.claude');
  const userData = join(root, 'app');
  const cwd = join(root, 'work');
  await Promise.all([mkdir(home), mkdir(userData), mkdir(cwd)]);
  if (opts.configured) await json(join(configHome, '.claude.json'), { mcpServers: opts.configured });
  const deps = { userData, captureEnv: () => Promise.resolve({ HOME: home, CLAUDE_CONFIG_DIR: configHome }) };
  const fingerprint = configurationFingerprint();
  const install = async (list: ScenePlugin[]) => {
    const installed: Record<string, unknown[]> = {};
    for (const plugin of list) {
      const at = join(root, 'plugins', plugin.key.replace(/[^a-z0-9-]/gi, '_'));
      await json(join(at, '.claude-plugin', 'plugin.json'), plugin.manifest === null ? { version: plugin.version ?? '1.0.0' } : { name: plugin.manifest, version: plugin.version ?? '1.0.0' });
      await json(join(at, '.mcp.json'), { mcpServers: plugin.servers });
      installed[plugin.key] = [{ scope: plugin.scope ?? 'user', installPath: at, version: plugin.version ?? '1.0.0', ...(plugin.projectPath !== undefined && { projectPath: plugin.projectPath === '<cwd>' ? cwd : plugin.projectPath }) }];
    }
    await json(join(configHome, 'plugins', 'installed_plugins.json'), { version: 2, plugins: installed });
  };
  const read = async () => {
    const [inventory, endpoints] = await Promise.all([readCustomizationInventory(cwd, deps), readServerEndpoints(cwd, deps)]);
    const stated = (server: string, found: 'auth_required' | 'no_auth' | null) => opts.posture?.[server] ?? found;
    const postures = {
      servers: posturesOf(endpoints.servers, [], fingerprint).map((row) => ({ ...row, authPosture: stated(row.name, row.authPosture) })),
      plugins: pluginPosturesOf(endpoints.pluginServers, [], fingerprint).map((row) => ({ ...row, authPosture: stated(row.server, row.authPosture) })),
    };
    return { inventory, postures };
  };
  await install(plugins);
  const first = await read();
  return {
    cwd,
    ...first,
    async reread(change) {
      if (change.plugins) await install(change.plugins);
      return read();
    },
    done: () => rm(root, { recursive: true, force: true }),
  };
}

/** A plugin as `system/init` lists it (seq 30): its manifest name, its folder in the marketplace, the key, the version. */
export const loaded = (key: string, manifest: string, version: string | null = '1.0.0') => ({ name: manifest, path: `/marketplaces/${key.slice(key.lastIndexOf('@') + 1)}/${key.slice(0, key.lastIndexOf('@'))}`, source: key, version });

/** A server as `mcp_status` reports a plugin's (the record [2], `status.servers`). */
export const served = (name: string, url: string, status = 'needs-auth') => ({ name, status, scope: 'dynamic', source: 'plugin', transport: 'http', config: { type: 'http', url }, serverInfo: { name: 'invented', version: '1.0.0' }, tools: [] });

const addressing = addressingOf(REGISTRY);
const spec = (appSessionId: string, cwd: string) =>
  LaunchSpecSchema.parse({ appSessionId, cwd, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null, resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null });

/**
 * A ready session MAWS runs in `cwd`, as the window holds its status: with `plugins`, after its main lane's `system/init`
 * listed them with these servers (each `[name, status]`); with `plugins: null`, before any (no message sent: no list
 * reported, and its status lists no server, P7 run 43386195217).
 */
export function reportingStatus(bare: string, cwd: string, { plugins, servers = [], at = '2026-11-14T22:39:19.282Z' }: { plugins: ReturnType<typeof loaded>[] | null; servers?: [string, string][]; at?: string }): EngineSessionStatus {
  const tracker = new SessionStatusTracker(spec(bare, cwd), () => {});
  if (plugins !== null) {
    tracker.observe({ type: 'system', subtype: 'init', cwd, session_id: '00000000-0000-4000-8000-000000000030', model: 'claude-test', claude_code_version: '2.1.322', permissionMode: 'default', plugins, mcp_servers: servers.map(([name, state]) => ({ name, status: state, source: 'plugin' })) }, at);
  }
  const snapshot = tracker.snapshot();
  const payload = { appSessionId: bare, status: { ...fullStatus(bare), cwd, process: 'ready', plugins: snapshot.plugins, pluginErrors: snapshot.pluginErrors, pluginWarnings: snapshot.pluginWarnings, pluginsObservedAt: snapshot.pluginsObservedAt, mcpServers: snapshot.mcpServers } };
  const checked = validateEventPayload('session.status', payload);
  if (!checked.ok) throw new Error(`invalid session.status: ${JSON.stringify(checked.issues)}`);
  return addressing.output('engine.sessions').lift([(checked.value as { status: EngineSessionStatus }).status], TEST_MACHINE)[0]!;
}
