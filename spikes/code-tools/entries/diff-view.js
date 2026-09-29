// Weighs @git-diff-view/react as Review would use it: one DiffView over a patch file, highlighting off.
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewView } from '../page/review-view.js';

createRoot(document.body).render(h(ReviewView, { file: { path: 'a.ts', oldPath: null, kind: 'modified', hunks: ['@@ -1 +1 @@\n-a\n+b'] }, mode: 'split', wrap: false, theme: 'light', highlight: false }));
