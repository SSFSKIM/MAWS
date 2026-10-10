// The extensions action bar's list in main (cua board #90's spec, "The extensions action bar"): what each extension
// loaded in an imported profile's partition shows in the navigation row. Read from the loaded extension's manifest:
// `action` (MV3) or `browser_action` (MV2) for the title, the icon and the popup; `options_ui.page` or `options_page`
// for the options page; an extension with neither action entry is listed too, with its `icons` and no popup, as Chrome
// shows it. The icon is the largest at or under 32 px, read from the extension's own folder (the copy MAWS made, which
// holds no symlink) capped and not through a symlink, as a data URL; none, and the renderer draws a puzzle piece.
//
// The list is per partition, in the order Settings lists the profile's extensions, and is computed when asked, from what
// the partition's session has loaded now: nothing is persisted, and a list asked for after a load, an unload or an
// import is current. Each prepared partition's session is watched (`attach`, a partition preparer) for loads and unloads,
// which raise `browser.extensions.actions.changed`; an unload is also told to `onUnloaded`'s listeners (the popup and
// the options tabs of that extension close). Pages are addressed only as `<extension.url><page>`, resolved and kept
// within the extension's own origin.
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import type { Extension, Session } from 'electron';
import { EXTENSION_ICON_MAX_BYTES, EXTENSION_ICON_SIZE, extensionBackgroundFailure, type ExtensionAction } from '@shared/browser/extensions';
import { IMPORT_NAME_MAX } from '@shared/browser/import';
import { readCappedBytesNoFollow } from '../import/chrome/read-capped';
import type { BrowserEmit } from '../tabs';

// What the manifest says about the action, its pages relative to the extension's root.
export interface ManifestAction {
  title: string | null;
  icon: string | null;
  popup: string | null;
  options: string | null;
}

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
// A `__MSG_name__` placeholder Chromium left unlocalised is no title.
const shown = (value: unknown): string | null => {
  const found = text(value);
  return found === null || /^__MSG_\w+__$/.test(found) ? null : found;
};

export function readManifestAction(manifest: unknown): ManifestAction {
  const root = record(manifest) ?? {};
  const action = record(root.action) ?? record(root.browser_action);
  return {
    title: shown(action?.default_title),
    icon: pickIcon(action?.default_icon) ?? pickIcon(root.icons),
    popup: text(action?.default_popup),
    options: text(record(root.options_ui)?.page) ?? text(root.options_page),
  };
}

// An icon entry: one path, or a map of sizes to paths. The largest at or under `size`, else the smallest above it.
export function pickIcon(icons: unknown, size = EXTENSION_ICON_SIZE): string | null {
  const single = text(icons);
  if (single !== null) return single;
  const sized = Object.entries(record(icons) ?? {})
    .map(([key, path]) => ({ px: Number(key), path: text(path) }))
    .filter((entry): entry is { px: number; path: string } => Number.isInteger(entry.px) && entry.px > 0 && entry.path !== null)
    .sort((a, b) => a.px - b.px);
  const fits = sized.filter((entry) => entry.px <= size);
  return (fits.at(-1) ?? sized[0])?.path ?? null;
}

// The extension's page as a URL of its own origin; null for a page that resolves elsewhere (an absolute URL, another
// scheme) or names nothing.
export function extensionPageUrl(extensionUrl: string, page: string | null): string | null {
  if (page === null) return null;
  try {
    const base = new URL(extensionUrl.endsWith('/') ? extensionUrl : `${extensionUrl}/`);
    const url = new URL(page.replace(/^\/+/, ''), base);
    // compared by scheme and host: Node's URL gives a chrome-extension: URL an opaque origin ('null') whatever its host
    return url.protocol === base.protocol && url.host === base.host && url.pathname !== '/' ? url.href : null;
  } catch {
    return null;
  }
}

const ICON_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', // drawn by an <img>, where an SVG runs no script
};

// The icon at `path` under the extension's folder as a data URL; null when it leaves the folder, is not an image type,
// is missing, unreadable, a symlink or larger than the cap.
export async function readExtensionIcon(extensionPath: string, path: string): Promise<string | null> {
  const type = ICON_TYPES[extname(path).toLowerCase()];
  const within = path.replace(/^\/+/, ''); // a leading slash names the extension's root, as in Chrome
  if (!type || isAbsolute(within)) return null;
  const file = join(extensionPath, within);
  const inside = relative(extensionPath, file);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  const read = await readCappedBytesNoFollow(file, EXTENSION_ICON_MAX_BYTES);
  return typeof read === 'string' ? null : `data:${type};base64,${read.bytes.toString('base64')}`;
}

// A profile's record as the list reads it: its partition and its extensions in Settings' order (E4b's record, read
// loosely: `id` is Electron's loaded id, `chromeId` Chrome's directory id when Electron derived another).
export interface ActionRecord {
  partition: string;
  extensions?: readonly { id: string; name: string; chromeId?: string | null; background?: string; backgroundError?: string | null }[];
}

// An action and where its pages are, for the popup and the options tab.
export interface LoadedAction extends Omit<ExtensionAction, 'icon'> {
  popupUrl: string | null;
  optionsUrl: string | null;
  iconPath: string | null;
  path: string; // the extension's folder
}

type ExtensionsOf = Pick<Session['extensions'], 'getExtension' | 'on' | 'off'>;

export interface ExtensionActionsDeps {
  records(): readonly ActionRecord[];
  emit: BrowserEmit;
  readIcon?(extensionPath: string, path: string): Promise<string | null>;
}

export class ExtensionActions {
  private readonly sessions = new Map<string, ExtensionsOf>();
  private readonly unloaded = new Set<(partition: string, extensionId: string) => void>();
  private readonly detach: (() => void)[] = [];
  private readonly readIcon: (extensionPath: string, path: string) => Promise<string | null>;

  constructor(private readonly deps: ExtensionActionsDeps) {
    this.readIcon = deps.readIcon ?? readExtensionIcon;
  }

  // A partition prepared (a preparer step: never throws): its session's loads and unloads watched from now on.
  attach(ses: Pick<Session, 'extensions'>, partition: string): void {
    try {
      const extensions = ses.extensions;
      if (this.sessions.has(partition)) return;
      this.sessions.set(partition, extensions);
      const loaded = () => this.changed(partition);
      const unloaded = (_event: unknown, extension: Extension) => {
        for (const listener of [...this.unloaded]) listener(partition, extension.id);
        this.changed(partition);
      };
      extensions.on('extension-loaded', loaded);
      extensions.on('extension-unloaded', unloaded);
      this.detach.push(() => {
        extensions.off('extension-loaded', loaded);
        extensions.off('extension-unloaded', unloaded);
      });
    } catch (error) {
      console.warn('[browser] the extensions of a partition could not be watched:', error instanceof Error ? error.message : error);
    }
  }

  // `browser.extensions.actions`: the partition's loaded extensions as actions, in Settings' order.
  async list(partition: string): Promise<ExtensionAction[]> {
    return Promise.all(
      this.loaded(partition).map(async ({ extensionId, name, title, hasPopup, hasOptions, inert, iconPath, path }) => ({
        extensionId,
        name,
        title,
        icon: iconPath === null ? null : await this.readIcon(path, iconPath).catch(() => null),
        hasPopup,
        hasOptions,
        inert,
      })),
    );
  }

  // The partition's loaded actions with where their pages are, without their icons (the puzzle menu's list).
  entries(partition: string): LoadedAction[] {
    return this.loaded(partition);
  }

  // One loaded extension's action in the partition; null when it is not loaded there (or not the profile's).
  find(partition: string, extensionId: string): LoadedAction | null {
    return this.loaded(partition).find((action) => action.extensionId === extensionId) ?? null;
  }

  // Its icon as a data URL (an options tab's favicon); null without one.
  async icon(partition: string, extensionId: string): Promise<string | null> {
    const action = this.find(partition, extensionId);
    return action?.iconPath ? this.readIcon(action.path, action.iconPath).catch(() => null) : null;
  }

  onUnloaded(listener: (partition: string, extensionId: string) => void): () => void {
    this.unloaded.add(listener);
    return () => void this.unloaded.delete(listener);
  }

  dispose(): void {
    for (const detach of this.detach.splice(0)) detach();
    this.sessions.clear();
  }

  private changed(partition: string): void {
    this.deps.emit('browser.extensions.actions.changed', { partition });
  }

  private loaded(partition: string): LoadedAction[] {
    const extensions = this.sessions.get(partition);
    const profile = this.deps.records().find((candidate) => candidate.partition === partition);
    if (!extensions || !profile) return [];
    return (profile.extensions ?? []).flatMap((entry) => {
      const extension = extensions.getExtension(entry.id) ?? (entry.chromeId ? extensions.getExtension(entry.chromeId) : null);
      if (!extension) return [];
      const manifest = readManifestAction(extension.manifest);
      const popupUrl = extensionPageUrl(extension.url, manifest.popup);
      const optionsUrl = extensionPageUrl(extension.url, manifest.options);
      const inert = entry.background === 'failed' ? extensionBackgroundFailure(entry.backgroundError ?? null) : null;
      const name = entry.name.slice(0, IMPORT_NAME_MAX);
      return [{ extensionId: extension.id, name, title: (manifest.title ?? name).slice(0, IMPORT_NAME_MAX), hasPopup: popupUrl !== null, hasOptions: optionsUrl !== null, inert, popupUrl, optionsUrl, iconPath: manifest.icon, path: extension.path }];
    });
  }
}
