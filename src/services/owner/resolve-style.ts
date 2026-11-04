// The style resolver (the P2-C document, Design §2, "The resolver"): which output style a launch's settings select, and
// the shape its declared to-human contract has (P2-C2, Decision Log 31), and (P4-R7z, the P4 spec's Decision Log 92)
// whether the to-human plugin registers its message tool under it, which alone carries the lane. Reads, never writes. Its
// config home is the engine's (the captured login-shell environment's, never main's own `process.env`). `outputStyle` is
// taken from the highest-precedence source that sets it: managed settings, then MAWS's own `--settings`, then local,
// project and user settings; a missing or malformed file sets nothing. Managed settings are the machine's, as the engine
// reads them (2.1.318): in the platform's directory (/Library/Application Support/ClaudeCode on macOS, /etc/claude-code
// on Linux), `managed-settings.json`, then each `managed-settings.d/*.json` (no dotfiles) in name order, a later file
// winning. The named style is then found:
// - `default`, `Explanatory` and `Learning` are built-ins and never compatible;
// - `<plugin>:<style>` among the installed plugins (`plugins/installed_plugins.json`, version 2) that are enabled in the
//   merged settings' `enabledPlugins` and whose installation applies to the cwd (user or managed scope, the engine
//   recording at `managed` a plugin its managed settings enable; or project or local scope for this project), in
//   `<installPath>/output-styles/*.md` by front-matter `name`, else file stem;
// - any other name in `<cwd>/.claude/output-styles/`, then `<configHome>/output-styles/`.
// A style that cannot be found has no shape, and the reason is said; the engine's own report at `system/init` corrects a
// misreading (the mismatch check, ./launch.ts).
//
// P4-R7z: the plugin registers `mcp__to-human__message` only under its own style, `doperpowers:to-human` (the to-human
// plugin's rule), and only where its hooks load; MAWS_NATIVE_TO_HUMAN at 8, which the lane sets, admits MAWS's headless
// launch. So a style carries the lane (`messageTool`) when it is that style, declares the tool (6 and up), the `to-human`
// plugin is installed, enabled and applicable here as a style's plugin must be, and no setting turns every hook off (the
// launch profile's hooks `none` does: its `disableAllHooks` keeps plugin hooks from loading), nor does a managed policy let
// only managed hooks run.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { carriesPluginMessageTool, PLUGIN_STYLE, STYLE_CONTRACT_KEY, styleShape, TO_HUMAN_PLUGIN, type StyleShape } from '@shared/owner/contract';
import { managedSettings, managedSettingsDir } from '../../engine-host/session-start-hooks';
import { realOrSelf } from '../sessions/context';

const BUILT_IN_STYLES = new Set(['default', 'Explanatory', 'Learning']);

export interface StyleContext {
  configHome: string; // the engine's config home
  cwd: string | null; // the launch's directory; null: what a launch in no project would do (user and managed only)
  flagSettings?: Record<string, unknown> | null; // MAWS's own --settings (the spec's extraSettings)
  platform?: NodeJS.Platform; // the tests' seam: whose managed settings directory is read (this machine's by default)
  systemRoot?: string; // the tests' seam: the file-system root that directory is read beneath (the machine's by default)
}

export interface ResolvedStyle {
  name: string; // the style name, as the engine reports it in system/init's output_style
  shape: StyleShape; // P2-C2: what the declared contract carries
  contract: number | null; // the declared contract version, when it has a shape
  unresolved: string | null; // why the style could not be found, when it could not
  messageTool: boolean; // P4-R7z: whether the to-human plugin registers its message tool under it in such a launch
}

type SettingsFile = Record<string, unknown>;
// The settings sources, highest precedence first, every one (`all`) and the managed ones alone.
interface Sources {
  all: SettingsFile[];
  managed: SettingsFile[];
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const asObject = (value: unknown): SettingsFile | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SettingsFile) : null);

const present = (files: (SettingsFile | null)[]): SettingsFile[] => files.filter((s): s is SettingsFile => s !== null);

// The settings sources: the managed files (the last fragment first, a later file's value replacing an earlier one's, and
// an object such as `enabledPlugins` merging key by key, which reading them in this order gives), MAWS's own --settings,
// then local, project and user settings.
async function sources(ctx: StyleContext): Promise<Sources> {
  const directory = ctx.systemRoot === undefined ? managedSettingsDir(ctx.platform) : join(ctx.systemRoot, managedSettingsDir(ctx.platform));
  const managed = present((await managedSettings(directory)).map(asObject)).reverse();
  const project = ctx.cwd === null ? [] : [join(ctx.cwd, '.claude', 'settings.local.json'), join(ctx.cwd, '.claude', 'settings.json')];
  const files = await Promise.all([...project, join(ctx.configHome, 'settings.json')].map(async (path) => asObject(await readJson(path))));
  return { all: present([...managed, asObject(ctx.flagSettings ?? null), ...files]), managed };
}

export async function resolveStyle(ctx: StyleContext): Promise<ResolvedStyle> {
  const settings = await sources(ctx);
  const selected = settings.all.map((s) => s.outputStyle).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return lookupIn(selected ?? 'default', ctx, settings);
}

// The named style looked up directly, the settings consulted only for plugin enablement (the mismatch check decides by
// the name the engine reported).
export async function lookupStyle(name: string, ctx: StyleContext): Promise<ResolvedStyle> {
  return lookupIn(name, ctx, await sources(ctx));
}

async function lookupIn(name: string, ctx: StyleContext, settings: Sources): Promise<ResolvedStyle> {
  const none = (unresolved: string | null): ResolvedStyle => ({ name, shape: 'none', contract: null, unresolved, messageTool: false });
  if (BUILT_IN_STYLES.has(name)) return none(null);
  const colon = name.indexOf(':');
  const directories =
    colon > 0
      ? await pluginStyleDirectories(name.slice(0, colon), ctx, settings)
      : [...(ctx.cwd === null ? [] : [join(ctx.cwd, '.claude', 'output-styles')]), join(ctx.configHome, 'output-styles')];
  if (typeof directories === 'string') return none(directories);
  const wanted = colon > 0 ? name.slice(colon + 1) : name;
  for (const directory of directories) {
    const style = await findStyle(directory, wanted);
    if (style === null) continue;
    const contract = contractOf(style);
    const shape = styleShape(contract);
    if (shape === 'none') return none(null);
    const messageTool = name === PLUGIN_STYLE && carriesPluginMessageTool(contract) && !hooksDisabled(settings.all) && !managedHooksOnly(settings.managed) && typeof (await pluginInstallPaths(TO_HUMAN_PLUGIN, ctx, settings)) !== 'string';
    return { name, shape, contract, unresolved: null, messageTool };
  }
  return none(colon > 0 ? `the plugin ${name.slice(0, colon)} has no output style ${wanted}` : `no output style named ${name} in the project or the config home`);
}

// The output-style directories of the enabled installations of a plugin that apply to the cwd, or why there are none.
async function pluginStyleDirectories(plugin: string, ctx: StyleContext, settings: Sources): Promise<string[] | string> {
  const paths = await pluginInstallPaths(plugin, ctx, settings);
  return typeof paths === 'string' ? paths : paths.map((path) => join(path, 'output-styles'));
}

// P4-R7z: whether every hook is off, as the highest-precedence source that says so has it (`disableAllHooks`).
// P4-R7z: whether managed settings let only managed hooks run (`allowManagedHooksOnly`, honoured there alone, the last
// managed file that sets it deciding), which keeps a user-installed plugin's hooks and mods from loading. The engine still
// loads an organization's own mod (its plugin enabled by managed settings and loaded in place from a marketplace they
// name as a directory), the plugin's tool among them; the resolver does not read that far and has the tool off.
const managedHooksOnly = (managed: SettingsFile[]): boolean => managed.map((s) => s.allowManagedHooksOnly).find((value) => typeof value === 'boolean') === true;
const hooksDisabled = (settings: SettingsFile[]): boolean => settings.map((s) => s.disableAllHooks).find((value) => typeof value === 'boolean') === true;

// The install paths of the enabled installations of a plugin that apply to the cwd, or why there are none.
async function pluginInstallPaths(plugin: string, ctx: StyleContext, settings: Sources): Promise<string[] | string> {
  const registry = asObject(await readJson(join(ctx.configHome, 'plugins', 'installed_plugins.json')));
  const plugins = registry?.version === 2 ? asObject(registry.plugins) : null;
  if (plugins === null) return `no readable plugin registry (version 2) for ${plugin}`;
  // enabledPlugins merged across the sources, the higher precedence winning per plugin id
  const enabled: Record<string, unknown> = {};
  for (const source of [...settings.all].reverse()) Object.assign(enabled, asObject(source.enabledPlugins) ?? {});
  const cwd = ctx.cwd === null ? null : await realOrSelf(ctx.cwd);
  const paths: string[] = [];
  for (const [id, records] of Object.entries(plugins)) {
    if (id.split('@')[0] !== plugin || enabled[id] !== true || !Array.isArray(records)) continue;
    for (const record of records.map(asObject)) {
      if (record === null || typeof record.installPath !== 'string') continue;
      const applies = record.scope === 'user' || record.scope === 'managed' || ((record.scope === 'project' || record.scope === 'local') && cwd !== null && typeof record.projectPath === 'string' && (await realOrSelf(record.projectPath)) === cwd);
      if (applies) paths.push(record.installPath);
    }
  }
  return paths.length > 0 ? paths : `the plugin ${plugin} is not installed, enabled and applicable here`;
}

// A style file's front matter: the lines between an opening `---` and the next `---`, as `key: value`.
type FrontMatter = Record<string, string>;

function frontMatterOf(text: string): FrontMatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const fields: FrontMatter = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') return fields;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}

// The style named `wanted` in a directory: by front-matter name, else by file stem.
async function findStyle(directory: string, wanted: string): Promise<FrontMatter | null> {
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((entry) => entry.endsWith('.md')).sort();
  } catch {
    return null;
  }
  for (const entry of entries) {
    let text: string;
    try {
      text = await readFile(join(directory, entry), 'utf8');
    } catch {
      continue;
    }
    const fields = frontMatterOf(text) ?? {};
    if ((fields.name ?? basename(entry, '.md')) === wanted) return fields;
  }
  return null;
}

function contractOf(fields: FrontMatter): number | null {
  const value = fields[STYLE_CONTRACT_KEY];
  return value === undefined || !/^\d+$/.test(value) ? null : Number(value);
}
