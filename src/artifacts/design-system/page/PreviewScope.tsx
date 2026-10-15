// A preview on the page in the system it shows: D8's scope, held over the page's own view of its replica, so a
// preview restyles in the same frame as the edit that changed it.
import { useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import type { Medium } from '../css';
import { holdScopeStyle, scopeIdOf } from '../scope-style';
import type { DesignSystemView } from '../view';

export function PreviewScope(props: { view: DesignSystemView; artifactId: string; medium: Medium; className?: string; style?: CSSProperties; children: ReactNode }) {
  const { view, artifactId, medium, className, style, children } = props;
  const scopeId = scopeIdOf(`page:${artifactId}`, medium, undefined);
  useLayoutEffect(() => holdScopeStyle(scopeId, medium, undefined, () => ({ view, release: () => {} })), [scopeId, medium, view]);
  return (
    <div data-ds-scope={scopeId} className={className} style={style}>
      {children}
    </div>
  );
}
