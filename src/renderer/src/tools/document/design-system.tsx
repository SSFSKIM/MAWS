// The governing design system around a document's page (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D3;
// the ledger's X28 as built at D's M4: `governingSystem(a, d, live?)`, `<DesignSystemScope system medium overrides
// className>`, `TokenOverrides`). D's `src/artifacts/design-system/apply.ts` is not on this branch's base, so the shell
// reaches it through this seam, typed with the ledger's signatures, which D's landing fills with one call
// (`provideDocumentDesignSystem({Scope: DesignSystemScope, systemFor})`, `systemFor` binding `governingSystem` to the
// owner's defaults and the live systems). Until then the page draws no scope: it keeps `var(--ds-*, fallback)` for every
// token it reads, the app's look (a scope with no system has no style either, D's ruling). The page carries `.ds-doc`
// and the scope wraps it (Decision Log 22); the document's own `meta.dsOverrides` go to the scope as its overrides.
import { createContext, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { docPage, dsOverrides, type DocPage, type TokenOverrides } from '@artifacts/document/meta';
import type { DesignSystemExport } from '@artifacts/document/export/design-system';
import { onUpdate, type Doc } from '@artifacts/yjs';

export type DesignSystemRef = { id: string; versionSeq?: number };
export type GoverningSystem = DesignSystemRef | { builtin: 'maws' };

export interface DesignSystemScopeProps {
  system: GoverningSystem | null;
  medium: 'document' | 'deck';
  overrides?: TokenOverrides;
  className?: string;
  children: ReactNode;
}

export interface DocumentDesignSystem {
  /** D's `<DesignSystemScope>`. */
  Scope: ComponentType<DesignSystemScopeProps>;
  /**
   * The system governing an artifact: D's `governingSystem(a, defaults, live)`. P3-D: a hook, called in the page's render
   * (`useSystemFor`), since D's follows the owner's defaults, the house system and the live systems.
   */
  systemFor(artifact: { designSystemId?: string; spaceId?: string }): GoverningSystem;
  /**
   * UX wave U10b (§B.5 of docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md): D's export helpers bound to a
   * system, as main's export binds the system governing a document, so the Export menu reads the document's page as the
   * export does (./page.ts); null while they are not known (none given, still loading). A hook, as `systemFor` is;
   * without it the window never knows a system's page.
   */
  exportSystemOf?(system: GoverningSystem | null): DesignSystemExport | null;
}

let provided: DocumentDesignSystem | null = null;

/** D's apply API for the document's page; the returned function takes it back. */
export function provideDocumentDesignSystem(system: DocumentDesignSystem): () => void {
  provided = system;
  return () => {
    if (provided === system) provided = null;
  };
}

export const documentDesignSystem = (): DocumentDesignSystem | null => provided;

/**
 * P3-D (the P3 spec's Decision Log 61): the provided `systemFor`, called as a hook in the page's render rather than inside
 * a memo, so the page follows what D's reads; null while nothing is provided. The app provides once, at module load, so
 * the hook is fixed for the page's life (C7's rule for a registered hook).
 */
export function useSystemFor(artifact: { designSystemId?: string; spaceId?: string }): GoverningSystem | null {
  const system = provided;
  return system ? system.systemFor(artifact) : null;
}

/** UX wave U10b: the provided `exportSystemOf`, a hook called in the body's render; null while nothing provides it. */
export function useExportSystem(system: GoverningSystem | null): DesignSystemExport | null {
  const exportSystemOf = provided?.exportSystemOf;
  return exportSystemOf ? exportSystemOf(system) : null;
}

interface PageSystem {
  system: DocumentDesignSystem;
  governing: GoverningSystem;
  overrides: TokenOverrides;
}

const PageSystemContext = createContext<PageSystem | null>(null);
export const PageSystemProvider = PageSystemContext.Provider;

/**
 * The editor's `pageScope`: the page inside the governing system's scope, in the document medium. F (S-RESTYLE): a
 * version the history shows (`pinned`) is drawn in the system it pinned, with its own overrides, as C's deck preview is;
 * the editors inside stay mounted, only the scope changes.
 */
export function SystemPage({ children, pinned }: { children: ReactNode; pinned?: { system: GoverningSystem; overrides: TokenOverrides } }) {
  const page = useContext(PageSystemContext);
  if (!page) return children;
  const { Scope } = page.system;
  return (
    <Scope system={pinned?.system ?? page.governing} medium="document" overrides={pinned?.overrides ?? page.overrides} className="doc-page-system">
      {children}
    </Scope>
  );
}

// The document's `meta.dsOverrides`, followed as it changes (the same object while its content stays).
const cache = new WeakMap<Doc, { key: string; value: TokenOverrides }>();
function overridesOf(doc: Doc): TokenOverrides {
  const value = dsOverrides(doc);
  const key = JSON.stringify(value);
  const held = cache.get(doc);
  if (held?.key === key) return held.value;
  cache.set(doc, { key, value });
  return value;
}
export const useDocumentOverrides = (doc: Doc): TokenOverrides =>
  useSyncExternalStore(
    (listener) => onUpdate(doc, () => listener()),
    () => overridesOf(doc),
  );

// UX wave U10b (§B.5): the document's page and its overrides, followed as they change (the same object while they stay);
// before the replica opens, none.
const NO_SETTING: { page: DocPage; overrides: TokenOverrides } = { page: {}, overrides: {} };
const settings = new WeakMap<Doc, { key: string; value: { page: DocPage; overrides: TokenOverrides } }>();
function pageSettingOf(doc: Doc): { page: DocPage; overrides: TokenOverrides } {
  const value = { page: docPage(doc), overrides: dsOverrides(doc) };
  const key = JSON.stringify(value);
  const held = settings.get(doc);
  if (held?.key === key) return held.value;
  settings.set(doc, { key, value });
  return value;
}
export const useDocumentPageSetting = (doc: Doc | null): { page: DocPage; overrides: TokenOverrides } =>
  useSyncExternalStore(
    (listener) => (doc ? onUpdate(doc, () => listener()) : () => {}),
    () => (doc ? pageSettingOf(doc) : NO_SETTING),
  );
