// Ruling O2's lazy boundary: a thin static shell (what registerCodeTools() keeps in the main chunk) that loads CodeView and
// ReviewView on first use. The entry chunk must hold neither library.
import { createElement as h, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const ReviewView = lazy(() => import('../page/review-view.js').then((m) => ({ default: m.ReviewView })));
const loadCodeView = () => import('../page/code-view.js');

export const tools = { review: { id: 'review', title: 'Review' }, files: { id: 'files', title: 'Files' } };
createRoot(document.body).render(
  h(Suspense, { fallback: 'Loading' }, h(ReviewView, { file: { path: 'a.ts', oldPath: null, kind: 'modified', hunks: ['@@ -1 +1 @@\n-a\n+b'] }, mode: 'split', wrap: false, theme: 'light', highlight: false })),
);
window.__openCode = () => loadCodeView().then((m) => m.createCodeView(document.body, 'a', null));
