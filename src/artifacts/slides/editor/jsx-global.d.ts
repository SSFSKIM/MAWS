// P3-C M4: @dnd-kit 6.3.1 and its sortable 10.0.0 name the global `JSX` namespace in their declarations, which React 19's
// types no longer declare globally; tsconfig.web.json checks library declarations (`skipLibCheck: false`), so the two
// members they use are given here as React's own.
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}
