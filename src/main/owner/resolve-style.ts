// The style resolver (the P2-C document, Design §2, "The resolver"): which output style a launch's settings select, and
// the shape its declared to-human contract has (P2-C2, Decision Log 31: `marks`, then MAWS appends nothing; `message-tool`,
// then MAWS appends its supplement; `none`, then the full contract). Reads, never writes. Its
// config home is the engine's (the captured login-shell environment's, never main's own `process.env`). `outputStyle` is
// taken from the highest-precedence source that sets it: managed settings, then MAWS's own `--settings`, then local,
// project and user settings; a missing or malformed file sets nothing. The named style is then found:
// - `default`, `Explanatory` and `Learning` are built-ins and never compatible;
// - `<plugin>:<style>` among the installed plugins (`plugins/installed_plugins.json`, version 2) that are enabled in the
//   merged settings' `enabledPlugins` and whose installation applies to the cwd (user scope, or project or local scope
//   for this project), in `<installPath>/output-styles/*.md` by front-matter `name`, else file stem;
// - any other name in `<cwd>/.claude/output-styles/`, then `<configHome>/output-styles/`.
// A style that cannot be found has no shape (MAWS then appends: doubled instructions over a silent lane), and the
// reason is said; the engine's own report at `system/init` corrects a misreading (the mismatch check, ./launch.ts).
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { STYLE_CONTRACT_KEY, styleShape, type StyleShape } from '@shared/owner/contract';
import { realOrSelf } from '../sessions/context';

export const MANAGED_SETTINGS_PATH = '/Library/Application Support/ClaudeCode/managed-settings.json';
const BUILT_IN_STYLES = new Set(['default', 'Explanatory', 'Learning']);

export interface StyleContext {
  configHome: string; // the engine's config home
  cwd: string | null; // the launch's directory; null: what a launch in no project would do (user and managed only)
  flagSettings?: Record<string, unknown> | null; // MAWS's own --settings (the spec's extraSettings)
  managedSettingsPath?: string; // the tests' seam
}

export interface ResolvedStyle {
  name: string; // the style name, as the engine reports it in system/init's output_style
  shape: StyleShape; // P2-C2: what the declared contract carries
  contract: number | null; // the declared contract version, when it has a shape
  unresolved: string | null; // why the style could not be found, when it could not
}

type SettingsFile = Record<string, unknown>;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const asObject = (value: unknown): SettingsFile | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SettingsFile) : null);

// The settings sources, highest precedence first.
async function sources(ctx: StyleContext): Promise<SettingsFile[]> {
  const files = [ctx.managedSettingsPath ?? MANAGED_SETTINGS_PATH];
  const project = ctx.cwd === null ? [] : [join(ctx.cwd, '.claude', 'settings.local.json'), join(ctx.cwd, '.claude', 'settings.json')];
  const read = await Promise.all([...files, ...project, join(ctx.configHome, 'settings.json')].map(async (path) => asObject(await readJson(path))));
  const [managed, ...rest] = read;
  return [managed, asObject(ctx.flagSettings ?? null), ...rest].filter((s): s is SettingsFile => s !== null);
}

export async function resolveStyle(ctx: StyleContext): Promise<ResolvedStyle> {
  const settings = await sources(ctx);
  const selected = settings.map((s) => s.outputStyle).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return lookupIn(selected ?? 'default', ctx, settings);
}

// The named style looked up directly, the settings consulted only for plugin enablement (the mismatch check decides by
// the name the engine reported).
export async function lookupStyle(name: string, ctx: StyleContext): Promise<ResolvedStyle> {
  return lookupIn(name, ctx, await sources(ctx));
}

async function lookupIn(name: string, ctx: StyleContext, settings: SettingsFile[]): Promise<ResolvedStyle> {
  const none = (unresolved: string | null): ResolvedStyle => ({ name, shape: 'none', contract: null, unresolved });
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
    return shape === 'none' ? none(null) : { name, shape, contract, unresolved: null };
  }
  return none(colon > 0 ? `the plugin ${name.slice(0, colon)} has no output style ${wanted}` : `no output style named ${name} in the project or the config home`);
}

// The output-style directories of the enabled installations of a plugin that apply to the cwd, or why there are none.
async function pluginStyleDirectories(plugin: string, ctx: StyleContext, settings: SettingsFile[]): Promise<string[] | string> {
  const registry = asObject(await readJson(join(ctx.configHome, 'plugins', 'installed_plugins.json')));
  const plugins = registry?.version === 2 ? asObject(registry.plugins) : null;
  if (plugins === null) return `no readable plugin registry (version 2) for ${plugin}`;
  // enabledPlugins merged across the sources, the higher precedence winning per plugin id
  const enabled: Record<string, unknown> = {};
  for (const source of [...settings].reverse()) Object.assign(enabled, asObject(source.enabledPlugins) ?? {});
  const cwd = ctx.cwd === null ? null : await realOrSelf(ctx.cwd);
  const directories: string[] = [];
  for (const [id, records] of Object.entries(plugins)) {
    if (id.split('@')[0] !== plugin || enabled[id] !== true || !Array.isArray(records)) continue;
    for (const record of records.map(asObject)) {
      if (record === null || typeof record.installPath !== 'string') continue;
      const applies = record.scope === 'user' || ((record.scope === 'project' || record.scope === 'local') && cwd !== null && typeof record.projectPath === 'string' && (await realOrSelf(record.projectPath)) === cwd);
      if (applies) directories.push(join(record.installPath, 'output-styles'));
    }
  }
  return directories.length > 0 ? directories : `the plugin ${plugin} is not installed, enabled and applicable here`;
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
