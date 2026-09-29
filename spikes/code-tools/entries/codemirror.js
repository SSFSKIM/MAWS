// Weighs CodeMirror 6 read-only with the theme, the highlight style and search; no language.
import { createCodeView, jumpTo } from '../page/code-view.js';

jumpTo(createCodeView(document.body, 'a\nb\n', null), 1);
