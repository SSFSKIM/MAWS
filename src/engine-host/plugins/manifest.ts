// The manifest reader behind `plugins.manifest` (P2-B execution document §5.5): for one installation or available entry,
// what the plugin says about itself and what it contains, read from files only. Nothing is loaded, run, fetched or
// written. The plugin directories and marketplace clones are third-party content, so the reader is a trust boundary:
//
// - Anchors. It reads only under the directories the engine's own listings named (`ManifestAnchors`: the row's
//   `installPath` or `readFromFolder`, and the marketplace row's `installLocation`); every path is confined to its
//   anchor's realpath at a segment boundary, so neither `../` nor a link may leave it (`outside the plugin`).
// - Files. A file is read only when `lstat` of its realpath says it is a regular file, opened without following a link,
//   still confined and the same file (device and inode) when its path is resolved again after the open, and bounded: a
//   JSON file past 256 KiB (8 MiB for `marketplace.json`) is `too large`; a Markdown file is read only to its first
//   8 KiB, its front matter. Per plugin at most 1,000 filesystem entries and 200 items of a kind; per call a deadline;
//   past a bound the view is `partial` with what it read.
// - Redaction. The view carries names, descriptions, kinds and counts. Never a hook's, monitor's or server's command, an
//   argument, environment or header value, a URL, a `userConfig` value. A problem is `<relative path>: <one of six
//   words>`; never an exception's message (Node's JSON.parse message quotes the input it failed on) or a file's value.
//
// The manifest is composed as the engine composes it (2.1.292 `cli.pretty.js:806207-806240`, `tkn` :806284-806316,
// `SEe` :805177-805260): `.claude-plugin/plugin.json` when present, else the marketplace entry named after the plugin;
// with both, the entry's display name, description, author, license and keywords overlay the file's and its commands,
// agents, skills and hooks add to the file's (the engine reads the entry's MCP and LSP servers only when it is the
// manifest). Components per kind follow the engine's schema (`qp` and its siblings :673281-673299): commands and agents
// named by plugin.json replace their default folders, monitors named by the manifest replace theirs, everything else
// adds; each field is read at the top level and under `experimental` (`Ls` :149842; monitors: experimental first,
// `FLr` :805026). A field of a shape the reader does not know reads as no items and `unknown shape`.
import { constants } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { under } from './cli-result';
import { frontMatter } from './front-matter';

export interface ManifestAnchors {
  root: string | null; // the plugin's directory (an installation's `readFromFolder` or `installPath`); null for an available entry
  marketplaceRoot: string | null; // the marketplace row's `installLocation`
  entryName: string; // the plugin's name: its entry in the marketplace's `marketplace.json`
}

export interface ManifestReaderDeps {
  fs?: Pick<typeof import('node:fs/promises'), 'lstat' | 'realpath' | 'readFile' | 'readdir' | 'open'>;
  now?: () => number;
  deadline?: number; // on `now`'s clock; past it nothing more is read
}

export const MANIFEST_BOUNDS = { files: 1_000, itemsPerKind: 200, jsonBytes: 256 * 1024, marketplaceBytes: 8 * 1024 * 1024, frontMatterBytes: 8 * 1024 } as const;

type Problem = 'not valid JSON' | 'too large' | 'outside the plugin' | 'not a regular file' | 'could not be read' | 'unknown shape';
type Fs = NonNullable<ManifestReaderDeps['fs']>;
type Components = PluginManifestView['components'];
type Item = { name: string; description: string | null };
type Json = Record<string, unknown>;

const PLUGIN_JSON = '.claude-plugin/plugin.json';
const MARKETPLACE_JSON = '.claude-plugin/marketplace.json';
const TRANSPORTS = new Set(['stdio', 'http', 'sse', 'ws']);
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const codeOf = (error: unknown): string | null => (isRecord(error) && typeof error.code === 'string' ? error.code : null);

// The reading stopped at a bound; what it read stands.
class Stop extends Error {}
const passStop = (error: unknown): void => {
  if (error instanceof Stop) throw error;
};
const isUrl = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value);
const ignore = () => undefined;

// A directory every read is confined to, by its realpath.
interface Anchor {
  real: string;
}
// A path inside an anchor: its realpath, its label (relative to the anchor, as declared) and the anchor's realpath.
interface Found {
  real: string;
  label: string;
  anchor: string;
}

class Reading {
  partial = false;
  readonly problems: string[] = [];
  private entries = 0;

  constructor(
    private readonly fs: Fs,
    private readonly now: () => number,
    private readonly deadline: number,
  ) {}

  problem(label: string, word: Problem): void {
    const line = `${label}: ${word}`;
    if (!this.problems.includes(line)) this.problems.push(line);
  }

  private stop(): never {
    this.partial = true;
    throw new Stop();
  }

  // One more filesystem entry, inside the plugin's bound and the call's time; past either, stop.
  private tick(): void {
    this.entries += 1;
    if (this.now() > this.deadline || this.entries > MANIFEST_BOUNDS.files) this.stop();
  }

  // An awaited filesystem operation, bounded by the call's deadline: past it the reading stops at once, and what the
  // operation answers late is released (a file handle closed) and otherwise dropped, its error included.
  private async bounded<T>(operation: Promise<T>, release: (late: T) => unknown = ignore): Promise<T> {
    if (!Number.isFinite(this.deadline)) return operation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Stop()), Math.max(0, this.deadline - this.now()));
    });
    try {
      return await Promise.race([operation, expired]);
    } catch (error) {
      if (error instanceof Stop) {
        operation.then(release, ignore);
        this.stop();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  add<T>(list: T[], item: T): void {
    if (list.length >= MANIFEST_BOUNDS.itemsPerKind) this.partial = true;
    else list.push(item);
  }

  // A count of things never read (MCP bundles, hook modules), under the same bound as a kind's items.
  count(components: Components, field: 'mcpBundles' | 'hookModules'): void {
    if (components[field] >= MANIFEST_BOUNDS.itemsPerKind) this.partial = true;
    else components[field] += 1;
  }

  // An anchor directory: `missing` when it is absent, `unknown` when it is not a directory or cannot be resolved.
  async anchor(path: string): Promise<Anchor | 'missing' | 'unknown'> {
    this.tick();
    try {
      const real = await this.bounded(this.fs.realpath(path));
      return (await this.bounded(this.fs.lstat(real))).isDirectory() ? { real } : 'unknown';
    } catch (error) {
      passStop(error);
      return ABSENT.has(codeOf(error) ?? '') ? 'missing' : 'unknown';
    }
  }

  // A path inside `anchor`, as declared (`./x`, `x/y`) or as listed; `declaredBy` labels a declaration that is a URL or
  // leaves the anchor before any file is touched, so the answer never repeats such a value. Null when it is absent (a
  // required declaration's absence says `could not be read`; a default folder's is silent) or was refused (refusals
  // say so).
  async find(anchor: Anchor, path: string, declaredBy: string, as: { declared?: boolean; required?: boolean } = {}): Promise<Found | null> {
    if (as.declared && isUrl(path)) {
      this.problem(declaredBy, 'unknown shape'); // a URL where a path belongs: never read, never echoed
      return null;
    }
    const lexical = resolve(anchor.real, path);
    if (path.includes('\0') || !under(anchor.real, lexical)) {
      this.problem(declaredBy, 'outside the plugin');
      return null;
    }
    const label = relative(anchor.real, lexical) || '.';
    this.tick();
    let real: string;
    try {
      real = await this.bounded(this.fs.realpath(lexical));
    } catch (error) {
      passStop(error);
      if (as.required || !ABSENT.has(codeOf(error) ?? '')) this.problem(label, 'could not be read');
      return null;
    }
    if (!under(anchor.real, real)) {
      this.problem(label, 'outside the plugin');
      return null;
    }
    return { real, label, anchor: anchor.real };
  }

  // P2-F L136: whether the opened descriptor is still the file the confined path names. Confinement is checked by
  // realpath before the open and Node offers no descriptor-relative open, so an ancestor directory swapped for a link in
  // between would be followed: after the open the path is resolved again and must still lie under the anchor, and its
  // file must be the descriptor's (device and inode). A failed check is the file's problem and nothing of it is read.
  private async sameFile(found: Found, handle: FileHandle): Promise<boolean> {
    const real = await this.bounded(this.fs.realpath(found.real));
    if (!under(found.anchor, real)) {
      this.problem(found.label, 'outside the plugin');
      return false;
    }
    const opened = await this.bounded(handle.stat());
    const named = await this.bounded(this.fs.lstat(real));
    if (opened.dev === named.dev && opened.ino === named.ino) return true;
    this.problem(found.label, 'could not be read');
    return false;
  }

  async kind(found: Found): Promise<'file' | 'directory' | 'other' | null> {
    try {
      const stat = await this.bounded(this.fs.lstat(found.real));
      return stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    } catch (error) {
      passStop(error);
      this.problem(found.label, 'could not be read');
      return null;
    }
  }

  // A directory's entry names, sorted; none when it cannot be listed. Node lists only by path (and macOS's `/dev/fd/N`
  // cannot be listed), so a listing is checked as a file read is (F-AB): the directory is opened first, and once listed
  // its path must still name the opened directory under the anchor (`sameFile`), else none of its names is used and no
  // outside name reaches a problem's label. Left open: a swap made after the open and undone before the check lists
  // outside names; each is then resolved under the restored folder by `find`, absent there unless swapped in again.
  async list(found: Found): Promise<string[]> {
    try {
      const handle = await this.bounded(this.fs.open(found.real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY), (late) => late.close().catch(ignore));
      try {
        const names = (await this.bounded(this.fs.readdir(found.real))).map(String).sort();
        return (await this.sameFile(found, handle)) ? names : [];
      } finally {
        handle.close().catch(ignore); // not awaited: a close that stalls never holds the answer
      }
    } catch (error) {
      passStop(error);
      this.problem(found.label, 'could not be read');
      return [];
    }
  }

  // A regular file's text: the whole of it within `limit` bytes (else `too large`, and the view partial: a bound left a
  // file out), or its head.
  async read(found: Found, limit: number, whole: boolean): Promise<string | null> {
    const kind = await this.kind(found);
    if (kind === null) return null;
    if (kind !== 'file') {
      this.problem(found.label, 'not a regular file');
      return null;
    }
    try {
      const handle = await this.bounded(this.fs.open(found.real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK), (late) => late.close().catch(ignore));
      try {
        if (!(await this.sameFile(found, handle))) return null;
        const buffer = Buffer.alloc(whole ? limit + 1 : limit);
        let filled = 0;
        while (filled < buffer.length) {
          const { bytesRead } = await this.bounded(handle.read(buffer, filled, buffer.length - filled, filled));
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        if (whole && filled > limit) {
          this.problem(found.label, 'too large');
          this.partial = true;
          return null;
        }
        return buffer.subarray(0, filled).toString('utf8');
      } finally {
        handle.close().catch(ignore); // not awaited: a close that stalls never holds the answer
      }
    } catch (error) {
      passStop(error);
      this.problem(found.label, 'could not be read');
      return null;
    }
  }

  async json(found: Found, limit: number = MANIFEST_BOUNDS.jsonBytes): Promise<{ value: unknown } | null> {
    const body = await this.read(found, limit, true);
    if (body === null) return null;
    try {
      return { value: JSON.parse(body) as unknown };
    } catch {
      this.problem(found.label, 'not valid JSON'); // never the parser's message: it quotes the input
      return null;
    }
  }

  async head(found: Found): Promise<string | null> {
    return this.read(found, MANIFEST_BOUNDS.frontMatterBytes, false);
  }
}

// -- the manifest's own words -------------------------------------------------------------------------------------------

interface Words {
  name: string | null;
  displayName: string | null;
  version: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  keywords: string[];
}

function wordsOf(manifest: Json): Words {
  const author = manifest.author;
  return {
    name: text(manifest.name),
    displayName: text(manifest.displayName),
    version: text(manifest.version),
    description: text(manifest.description),
    author: text(author) ?? (isRecord(author) ? text(author.name) : null),
    license: text(manifest.license),
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords.filter((k): k is string => typeof k === 'string') : [],
  };
}

// A component field's declarations: the top-level one and the one under `experimental`, each with the file that declared it.
interface Declaration {
  value: unknown;
  by: string; // the declaring file's label, for `unknown shape` and an escape
  inline: boolean; // a command's inline `content` counts (plugin.json's; the engine never registers an entry's)
}
function declarations(manifest: Json | null, field: string, by: string, inline: boolean): Declaration[] {
  if (manifest === null) return [];
  const experimental = isRecord(manifest.experimental) ? manifest.experimental : {};
  return [manifest[field], experimental[field]].filter((value) => value !== undefined).map((value) => ({ value, by, inline }));
}
const pathsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const emptyComponents = (): Components => ({ mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] });

// -- the reader --------------------------------------------------------------------------------------------------------

class Inventory {
  readonly components = emptyComponents();
  private readonly skillDirs = new Set<string>();

  constructor(
    private readonly r: Reading,
    private readonly plugin: Anchor,
  ) {}

  // a default or listed path (its absence is silent) and a declared one (its absence is a problem)
  private at(path: string, by: string) {
    return this.r.find(this.plugin, path, by);
  }
  private declared(path: string, by: string) {
    return this.r.find(this.plugin, path, by, { declared: true, required: true });
  }
  private child(dir: Found, name: string) {
    return this.at(join(dir.label, name), dir.label);
  }

  private async item(file: Found, fallback: string, nameFromFrontMatter: boolean): Promise<Item> {
    const head = await this.r.head(file);
    const words = head === null ? { name: null, description: null } : frontMatter(head);
    return { name: (nameFromFrontMatter ? words.name : null) ?? fallback, description: words.description };
  }

  // -- MCP servers: `.mcp.json` (`{mcpServers}` or the map itself) and the manifest's paths, maps and bundles
  private serversOf(map: unknown, by: string): void {
    if (!isRecord(map)) {
      this.r.problem(by, 'unknown shape');
      return;
    }
    for (const [name, config] of Object.entries(map)) {
      if (!isRecord(config)) {
        this.r.problem(by, 'unknown shape');
        continue;
      }
      const type = typeof config.type === 'string' ? config.type : config.type === undefined && typeof config.command === 'string' ? 'stdio' : 'unknown';
      const transport = (TRANSPORTS.has(type) ? type : 'unknown') as Components['mcpServers'][number]['transport'];
      if (!this.components.mcpServers.some((s) => s.name === name)) this.r.add(this.components.mcpServers, { name, transport });
    }
  }
  private async serversFile(path: string, by: string, optional: boolean): Promise<void> {
    const file = optional ? await this.at(path, by) : await this.declared(path, by);
    if (file === null) return;
    const json = await this.r.json(file);
    if (json !== null) this.serversOf(isRecord(json.value) && isRecord(json.value.mcpServers) ? json.value.mcpServers : json.value, file.label);
  }
  async mcpServers(declared: Declaration[]): Promise<void> {
    await this.serversFile('.mcp.json', '.mcp.json', true);
    for (const { value, by } of declared) {
      for (const spec of pathsOf(value)) {
        if (typeof spec === 'string' && /\.(mcpb|dxt)$/i.test(spec)) this.r.count(this.components, 'mcpBundles'); // counted, never read or fetched
        else if (typeof spec === 'string' && !isUrl(spec)) await this.serversFile(spec, by, false);
        else if (isRecord(spec)) this.serversOf(spec, by);
        else this.r.problem(by, 'unknown shape');
      }
    }
  }

  // -- agents: `agents/**/*.md` (recursive, any case of `.md`; a nested agent named through its folders as commands
  // are, 2.1.292 `HH` :729782-729814), replaced by plugin.json's files or folders; an entry's add. A declared file is
  // read only when it ends `.md` (:753347-753359).
  private async walkAgents(dir: Found, prefix: string[], seen: Set<string>): Promise<void> {
    if (seen.has(dir.real)) return;
    seen.add(dir.real);
    for (const name of await this.r.list(dir)) {
      const child = await this.child(dir, name);
      if (child === null) continue;
      const kind = await this.r.kind(child);
      if (kind === 'directory') await this.walkAgents(child, [...prefix, name], seen);
      else if (kind === 'file' && name.toLowerCase().endsWith('.md')) await this.agent(child, prefix, name.slice(0, -3));
    }
  }
  private async agent(file: Found, prefix: string[], fallback: string): Promise<void> {
    const item = await this.item(file, fallback, true);
    this.r.add(this.components.agents, { name: [...prefix, item.name].join(':'), description: item.description });
  }
  async agents(declared: Declaration[], readDefault: boolean): Promise<void> {
    if (readDefault) {
      const dir = await this.at('agents', 'agents');
      if (dir !== null && (await this.r.kind(dir)) === 'directory') await this.walkAgents(dir, [], new Set());
    }
    for (const { value, by } of declared) {
      if (typeof value !== 'string' && !Array.isArray(value)) {
        this.r.problem(by, 'unknown shape');
        continue;
      }
      for (const spec of pathsOf(value)) {
        if (typeof spec !== 'string') {
          this.r.problem(by, 'unknown shape');
          continue;
        }
        const found = await this.declared(spec, by);
        const kind = found === null ? null : await this.r.kind(found);
        if (found !== null && kind === 'directory') await this.walkAgents(found, [], new Set());
        else if (found !== null && kind === 'file' && found.label.endsWith('.md')) await this.agent(found, [], basename(found.label).replace(/\.md$/, ''));
      }
    }
  }

  // -- hooks: `hooks/hooks.json` and the manifest's paths and inline maps, one "<event> · <matcher>" per matcher group
  private eventsOf(map: unknown, by: string): void {
    if (!isRecord(map)) {
      this.r.problem(by, 'unknown shape');
      return;
    }
    for (const [event, groups] of Object.entries(map)) {
      if (!Array.isArray(groups)) {
        this.r.problem(by, 'unknown shape');
        continue;
      }
      for (const group of groups) {
        if (isRecord(group)) this.r.add(this.components.hooks, { event, matcher: typeof group.matcher === 'string' ? group.matcher : null });
        else this.r.problem(by, 'unknown shape');
      }
    }
  }
  private hooksFileOf(value: unknown, by: string): void {
    if (!isRecord(value) || (value.hooks === undefined && value.modules === undefined)) {
      this.r.problem(by, 'unknown shape');
      return;
    }
    if (Array.isArray(value.modules)) {
      for (const module of value.modules) {
        if (typeof module === 'string') this.r.count(this.components, 'hookModules'); // counted, never read
        else this.r.problem(by, 'unknown shape');
      }
    } else if (value.modules !== undefined) this.r.problem(by, 'unknown shape');
    if (value.hooks !== undefined) this.eventsOf(value.hooks, by);
  }
  async hooks(declared: Declaration[]): Promise<void> {
    const file = await this.at('hooks/hooks.json', 'hooks/hooks.json');
    if (file !== null) {
      const json = await this.r.json(file);
      if (json !== null) this.hooksFileOf(json.value, file.label);
    }
    for (const { value, by } of declared) {
      for (const spec of pathsOf(value)) {
        if (isRecord(spec)) this.eventsOf(spec, by);
        else if (typeof spec === 'string' && !isUrl(spec)) {
          const found = await this.declared(spec, by);
          const json = found === null ? null : await this.r.json(found);
          if (found === null || json === null) continue;
          if (isRecord(json.value) && ('hooks' in json.value || 'modules' in json.value)) this.hooksFileOf(json.value, found.label);
          else this.eventsOf(json.value, found.label);
        } else this.r.problem(by, 'unknown shape');
      }
    }
  }

  // -- monitors: the manifest's path or inline list, else `monitors/monitors.json`; names and descriptions only
  private monitorsOf(list: unknown, by: string): void {
    if (!Array.isArray(list)) {
      this.r.problem(by, 'unknown shape');
      return;
    }
    for (const monitor of list) {
      if (isRecord(monitor) && typeof monitor.name === 'string') this.r.add(this.components.monitors, { name: monitor.name, description: text(monitor.description) });
      else this.r.problem(by, 'unknown shape');
    }
  }
  async monitors(declared: Declaration | null): Promise<void> {
    if (declared !== null && typeof declared.value !== 'string') {
      this.monitorsOf(declared.value, declared.by);
      return;
    }
    const file = declared === null ? await this.at('monitors/monitors.json', 'monitors/monitors.json') : await this.declared(declared.value as string, declared.by);
    if (file === null) return;
    const json = await this.r.json(file);
    if (json !== null) this.monitorsOf(json.value, file.label);
  }

  // -- language servers: `.lsp.json` and the manifest's paths and maps; names only
  private lspOf(map: unknown, by: string): void {
    if (!isRecord(map)) {
      this.r.problem(by, 'unknown shape');
      return;
    }
    for (const name of Object.keys(map)) if (!this.components.lspServers.some((s) => s.name === name)) this.r.add(this.components.lspServers, { name });
  }
  private async lspFile(path: string, by: string, optional: boolean): Promise<void> {
    const file = optional ? await this.at(path, by) : await this.declared(path, by);
    if (file === null) return;
    const json = await this.r.json(file);
    if (json !== null) this.lspOf(json.value, file.label);
  }
  async lspServers(declared: Declaration[]): Promise<void> {
    await this.lspFile('.lsp.json', '.lsp.json', true);
    for (const { value, by } of declared) {
      for (const spec of pathsOf(value)) {
        if (isRecord(spec)) this.lspOf(spec, by);
        else if (typeof spec === 'string' && !isUrl(spec)) await this.lspFile(spec, by, false);
        else this.r.problem(by, 'unknown shape');
      }
    }
  }

  // -- commands: `commands/**/*.md` (a nested folder is `dir:name`; a folder holding SKILL.md is one command), replaced
  // by plugin.json's paths or map; an entry's add
  private async walkCommands(dir: Found, prefix: string[], seen: Set<string>): Promise<void> {
    if (seen.has(dir.real)) return;
    seen.add(dir.real);
    for (const name of await this.r.list(dir)) {
      const child = await this.child(dir, name);
      if (child === null) continue;
      const kind = await this.r.kind(child);
      if (kind === 'file' && name.endsWith('.md')) this.r.add(this.components.commands, await this.item(child, [...prefix, name.slice(0, -3)].join(':'), false));
      else if (kind === 'directory') {
        const skill = await this.skillFileIn(child);
        if (skill !== null) this.r.add(this.components.commands, { name: [...prefix, name].join(':'), description: (await this.item(skill, name, false)).description });
        else await this.walkCommands(child, [...prefix, name], seen);
      }
    }
  }
  private async commandAt(spec: string, by: string): Promise<void> {
    const found = await this.declared(spec, by);
    if (found === null) return;
    const kind = await this.r.kind(found);
    const name = basename(found.label);
    if (kind === 'file' && name.endsWith('.md')) this.r.add(this.components.commands, await this.item(found, name.slice(0, -3), false));
    else if (kind === 'directory') {
      const skill = await this.skillFileIn(found);
      if (skill !== null) this.r.add(this.components.commands, { name, description: (await this.item(skill, name, false)).description });
      else await this.walkCommands(found, [], new Set());
    }
  }
  async commands(declared: Declaration[], readDefault: boolean): Promise<void> {
    if (readDefault) {
      const dir = await this.at('commands', 'commands');
      if (dir !== null && (await this.r.kind(dir)) === 'directory') await this.walkCommands(dir, [], new Set());
    }
    for (const { value, by, inline } of declared) {
      const first = isRecord(value) ? Object.values(value)[0] : undefined;
      if (isRecord(value) && isRecord(first) && ('source' in first || 'content' in first)) {
        for (const [name, meta] of Object.entries(value)) {
          if (!isRecord(meta)) continue;
          const description = text(meta.description);
          if (typeof meta.source === 'string') {
            const file = await this.declared(meta.source, by);
            if (file !== null && (await this.r.kind(file)) === 'file') this.r.add(this.components.commands, { name, description: description ?? (await this.item(file, name, false)).description });
          } else if (typeof meta.content === 'string' && inline) {
            this.r.add(this.components.commands, { name, description: description ?? frontMatter(meta.content.slice(0, MANIFEST_BOUNDS.frontMatterBytes)).description });
          }
        }
        continue;
      }
      if (typeof value !== 'string' && !Array.isArray(value)) {
        this.r.problem(by, 'unknown shape');
        continue;
      }
      for (const spec of pathsOf(value)) {
        if (typeof spec === 'string' && !isUrl(spec)) await this.commandAt(spec, by);
        else this.r.problem(by, 'unknown shape');
      }
    }
  }

  // -- skills: `skills/*/SKILL.md` and every path the manifest or entry adds (a skill folder, or a folder of them)
  private async skillFileIn(dir: Found): Promise<Found | null> {
    const file = await this.child(dir, 'SKILL.md');
    return file !== null && (await this.r.kind(file)) === 'file' ? file : null;
  }
  private async skill(dir: Found, file: Found): Promise<void> {
    if (this.skillDirs.has(dir.real)) return;
    this.skillDirs.add(dir.real);
    const named = basename(dir.label);
    this.r.add(this.components.skills, await this.item(file, named === '.' ? basename(dir.real) : named, true)); // the folder as named; `.` is the plugin's own
  }
  private async skillsIn(dir: Found): Promise<void> {
    for (const name of await this.r.list(dir)) {
      const child = await this.child(dir, name);
      if (child === null || (await this.r.kind(child)) !== 'directory') continue;
      const file = await this.skillFileIn(child);
      if (file !== null) await this.skill(child, file);
    }
  }
  async skills(declared: Declaration[]): Promise<void> {
    const dir = await this.at('skills', 'skills');
    if (dir !== null && (await this.r.kind(dir)) === 'directory') await this.skillsIn(dir);
    for (const { value, by } of declared) {
      if (typeof value !== 'string' && !Array.isArray(value)) {
        this.r.problem(by, 'unknown shape');
        continue;
      }
      for (const spec of pathsOf(value)) {
        if (typeof spec !== 'string') {
          this.r.problem(by, 'unknown shape');
          continue;
        }
        const found = await this.declared(spec, by);
        if (found !== null && (await this.r.kind(found)) === 'directory') {
          const file = await this.skillFileIn(found);
          if (file !== null) await this.skill(found, file);
          else await this.skillsIn(found);
        }
      }
    }
  }
}

// The entry named after the plugin in its marketplace's `marketplace.json`; null when there is none.
async function entryOf(r: Reading, marketplace: Anchor, name: string): Promise<Json | null> {
  const file = await r.find(marketplace, MARKETPLACE_JSON, MARKETPLACE_JSON);
  if (file === null) return null;
  const json = await r.json(file, MANIFEST_BOUNDS.marketplaceBytes);
  if (json === null) return null;
  if (!isRecord(json.value) || !Array.isArray(json.value.plugins)) {
    r.problem(file.label, 'unknown shape');
    return null;
  }
  return json.value.plugins.find((entry): entry is Json => isRecord(entry) && entry.name === name) ?? null;
}

const blank = (key: ManifestItemRef): PluginManifestView => ({
  key, state: 'unknown', name: null, displayName: null, version: null, marketplaceVersion: null, description: null, author: null, license: null, keywords: [], components: emptyComponents(), partial: false, problems: [],
});

export async function readManifestView(key: ManifestItemRef, anchors: ManifestAnchors, deps: ManifestReaderDeps = {}): Promise<PluginManifestView> {
  const now = deps.now ?? Date.now;
  const deadline = deps.deadline ?? Infinity;
  const view = blank(key);
  if (now() > deadline) return { ...view, partial: true };
  const r = new Reading(deps.fs ?? nodeFs, now, deadline);
  let inventory: Inventory | null = null;
  try {
    // the anchors: the marketplace (for its entry), then the plugin's own directory
    const marketplace = anchors.marketplaceRoot === null ? null : await r.anchor(anchors.marketplaceRoot);
    let plugin: Anchor | null = null;
    if (key.kind === 'installation') {
      if (anchors.root === null) return view;
      const anchor = await r.anchor(anchors.root);
      if (anchor === 'missing' || anchor === 'unknown') return { ...view, state: anchor };
      plugin = anchor;
    } else if (marketplace === null || marketplace === 'unknown') return view;
    else if (marketplace === 'missing') return { ...view, state: 'missing' };
    const entry = typeof marketplace === 'object' && marketplace !== null ? await entryOf(r, marketplace, anchors.entryName) : null;
    if (key.kind === 'available') {
      if (entry === null || typeof marketplace !== 'object' || marketplace === null) return { ...view, partial: r.partial, problems: r.problems };
      // an entry whose plugin sits in the marketplace's own clone (`./plugins/x`); any other source is not on disk
      if (typeof entry.source === 'string') {
        const found = await r.find(marketplace, entry.source, MARKETPLACE_JSON, { declared: true });
        if (found !== null && (await r.kind(found)) === 'directory') plugin = { real: found.real };
      }
    }
    view.state = 'read';

    // what it says about itself: plugin.json, the entry overlaying it (or standing in for it)
    let file: Json | null = null;
    if (plugin !== null) {
      const found = await r.find(plugin, PLUGIN_JSON, PLUGIN_JSON);
      const json = found === null ? null : await r.json(found);
      if (json !== null && isRecord(json.value)) file = json.value;
      else if (json !== null) r.problem(PLUGIN_JSON, 'unknown shape');
    }
    const own = file === null ? null : wordsOf(file);
    const listed = entry === null ? null : wordsOf(entry);
    const words = own ?? listed;
    if (words !== null) {
      view.name = own?.name ?? listed?.name ?? anchors.entryName;
      view.displayName = listed?.displayName ?? words.displayName;
      view.version = words.version;
      view.description = listed?.description ?? words.description;
      view.author = listed?.author ?? words.author;
      view.license = listed?.license ?? words.license;
      view.keywords = listed !== null && listed.keywords.length > 0 ? listed.keywords : words.keywords;
    } else view.name = anchors.entryName;
    view.marketplaceVersion = listed?.version ?? null;

    // what it contains, in the order What's inside summarises it
    if (plugin !== null) {
      inventory = new Inventory(r, plugin);
      const manifest = file ?? entry; // whose MCP servers, language servers and monitors the engine reads
      const manifestBy = file !== null ? PLUGIN_JSON : MARKETPLACE_JSON;
      const fromFile = (field: string) => declarations(file, field, PLUGIN_JSON, true);
      const fromEntry = (field: string) => declarations(entry, field, MARKETPLACE_JSON, false);
      await inventory.mcpServers(declarations(manifest, 'mcpServers', manifestBy, false));
      await inventory.agents([...fromFile('agents'), ...fromEntry('agents')], fromFile('agents').length === 0);
      await inventory.hooks([...fromFile('hooks'), ...fromEntry('hooks')]);
      const experimental = manifest !== null && isRecord(manifest.experimental) ? manifest.experimental : {};
      const monitors = experimental.monitors ?? manifest?.monitors;
      await inventory.monitors(monitors === undefined ? null : { value: monitors, by: manifestBy, inline: false });
      await inventory.lspServers(declarations(manifest, 'lspServers', manifestBy, false));
      await inventory.commands([...fromFile('commands'), ...fromEntry('commands')], fromFile('commands').length === 0);
      await inventory.skills([...fromFile('skills'), ...fromEntry('skills')]);
    }
  } catch {
    // a bound (Stop), or anything unforeseen: what was read stands, and no exception's message ever reaches the answer
    r.partial = true;
  }
  return { ...view, components: inventory?.components ?? view.components, partial: r.partial, problems: r.problems };
}
