// The governing design system around a document's page (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D3;
// the ledger's X28 as built at D's M4: `governingSystem(a, d, live?)`, `<DesignSystemScope system medium overrides
// className>`, `TokenOverrides`). D's `src/artifacts/design-system/apply.ts` is not on this branch's base, so the shell
// reaches it through this seam, typed with the ledger's signatures, which D's landing fills with one call
// (`provideDocumentDesignSystem({Scope: DesignSystemScope, systemFor})`, `systemFor` binding `governingSystem` to the
// owner's defaults and the live systems). Until then the page draws no scope: it keeps `var(--ds-*, fallback)` for every
// token it reads, the app's look (a scope with no system has no style either, D's ruling). The page carries `.ds-doc`
// and the scope wraps it (Decision Log 22); the document's own `meta.dsOverrides` go to the scope as its overrides.
import { createContext, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { dsOverrides, type TokenOverrides } from '@artifacts/document/meta';
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
  /** The system governing an artifact: D's `governingSystem(a, defaults, live)`. */
  systemFor(artifact: { designSystemId?: string; spaceId?: string }): GoverningSystem;
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

interface PageSystem {
  system: DocumentDesignSystem;
  governing: GoverningSystem;
  overrides: TokenOverrides;
}

const PageSystemContext = createContext<PageSystem | null>(null);
export const PageSystemProvider = PageSystemContext.Provider;

/** The editor's `pageScope`: the page inside the governing system's scope, in the document medium. */
export function SystemPage({ children }: { children: ReactNode }) {
  const page = useContext(PageSystemContext);
  if (!page) return children;
  const { Scope } = page.system;
  return (
    <Scope system={page.governing} medium="document" overrides={page.overrides} className="doc-page-system">
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
