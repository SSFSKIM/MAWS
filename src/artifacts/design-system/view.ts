// One open design system as its consumers read it (D8's `DesignSystemView`): over a live replica, over a retained
// version's state, or over the bundled house system (the built-in floor). `apply.ts` opens them through `ArtifactHost`;
// the page builds one over the replica it already holds. Portable (§4.10); Yjs only through the binding module.
import { HOUSE_KEY, defaultSystem } from '../types/design_system/defaults';
import { onUpdate, type Doc } from '../yjs';
import { fontFaces, type AssetUrl } from './assets';
import { DOCUMENT_CSS_PATH } from './canon';
import { generateTokensCss, type Medium } from './css';
import { readSystem } from './model';
import { parseTokens, type TokenSet } from './tokens';

/** Per-consumer values of `--ds-*` names, set after the system's (the chain's first link, D8). */
export type TokenOverrides = Record<string, string>;

export interface DesignSystemView {
  readonly tokens: TokenSet;
  readonly law: string;
  readonly name: string;
  /** The system's stylesheet for a scope: its faces, `tokens.css` at the medium's scale, then the overrides. */
  css(scope: string, medium: Medium, overrides?: TokenOverrides): string;
  /** Fires on every change of a live system; a version's or the floor's never fires. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

/** What a view shows: the parts of a system a renderer reads. */
export interface SystemSnapshot {
  tokens: TokenSet;
  law: string;
  name: string;
  files: Readonly<Record<string, string>>;
}

const OVERRIDE_NAME = /^--ds-[A-Za-z0-9_-]+$/;
// A value that could end the declaration, the rule or the element, or fetch anything, is not an override.
const UNSAFE_VALUE = /[;{}<>\\\n\r]|\/\*|\b(?:url|image|image-set|cross-fade|element|src)\s*\(|@import/i;
const balancedQuotes = (value: string) => (value.match(/"/g)?.length ?? 0) % 2 === 0 && (value.match(/'/g)?.length ?? 0) % 2 === 0;

/** The overrides a scope may set: `--ds-*` names with plain values, in name order (byte-stable). */
export function safeOverrides(overrides: TokenOverrides | undefined): [string, string][] {
  return Object.entries(overrides ?? {})
    .filter(([name, value]) => OVERRIDE_NAME.test(name) && typeof value === 'string' && value.trim() !== '' && !UNSAFE_VALUE.test(value) && balancedQuotes(value))
    .map(([name, value]): [string, string] => [name, value.trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The stylesheet of a snapshot for a scope (D3, D8): the system's faces under their private names, `tokens.css` with
 * each bundled family's private name before its authored one, then the overrides.
 */
export function snapshotCss(snapshot: SystemSnapshot, toUrl: AssetUrl | null, scope: string, medium: Medium, overrides?: TokenOverrides): string {
  const faces = fontFaces(snapshot.files[DOCUMENT_CSS_PATH], snapshot.tokens, toUrl, { aliased: true });
  const own = safeOverrides(overrides);
  const after = own.length ? `\n${scope} {\n${own.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n` : '';
  return `${faces.css}${generateTokensCss(snapshot.tokens, { scope, medium, fontAliases: faces.aliases })}${after}`;
}

class View implements DesignSystemView {
  private readonly listeners = new Set<() => void>();
  private closed = false;
  constructor(
    private readonly current: () => SystemSnapshot,
    private readonly toUrl: AssetUrl | null,
    private readonly release: () => void,
  ) {}

  get tokens() {
    return this.current().tokens;
  }
  get law() {
    return this.current().law;
  }
  get name() {
    return this.current().name;
  }
  css(scope: string, medium: Medium, overrides?: TokenOverrides): string {
    return snapshotCss(this.current(), this.toUrl, scope, medium, overrides);
  }
  subscribe(listener: () => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Tells the listeners the system changed. */
  emit(): void {
    for (const each of [...this.listeners]) each();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.release();
  }
}

/** The snapshot of a system doc, or null while it holds none (not yet synced, or not a system). */
export function snapshotOfDoc(doc: Doc): SystemSnapshot | null {
  const state = readSystem(doc);
  return state.meta ? { tokens: state.tokens, law: state.law, name: state.meta.name, files: state.files } : null;
}

const EMPTY: SystemSnapshot = { tokens: { tokens: new Map(), groups: new Map() }, law: '', name: '', files: {} };

/**
 * A live view over a replica: read once per change, its listeners fired after every update. It observes the doc for
 * its whole life, listened to or not, so the snapshot it caches is dropped by every update and a read after a quiet
 * spell is current. `release` runs on close (the handle's close, for a view `openDesignSystem` opened).
 */
export function liveView(doc: Doc, toUrl: AssetUrl | null, release: () => void = () => {}): DesignSystemView {
  let cached: SystemSnapshot | null = null;
  const current = () => (cached ??= snapshotOfDoc(doc) ?? EMPTY);
  const view: View = new View(current, toUrl, () => {
    stop();
    release();
  });
  const stop = onUpdate(doc, () => {
    cached = null;
    view.emit();
  });
  return view;
}

/** A view of a fixed state: a retained version, read once, never subscribed (D8's version ref). */
export const staticView = (snapshot: SystemSnapshot, toUrl: AssetUrl | null): DesignSystemView => new View(() => snapshot, toUrl, () => {});

let floor: DesignSystemView | null = null;
/** The built-in floor (D8): the bundled house system, no store, no assets. One view, never closed. */
export function builtinView(): DesignSystemView {
  if (floor) return floor;
  const source = defaultSystem(HOUSE_KEY);
  const tokens = source && parseTokens(source.files['tokens.tokens.json'] ?? '').tokens;
  if (!source || !tokens) throw new Error(`the bundled house system (${HOUSE_KEY}) is missing or unreadable`);
  const snapshot: SystemSnapshot = { tokens, law: source.files['DESIGN.md'] ?? '', name: source.name, files: source.files };
  floor = new View(() => snapshot, null, () => {});
  return floor;
}
