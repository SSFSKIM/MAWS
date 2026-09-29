// C6's shiki entry points, the bare diff view and @git-diff-view/shiki together: minus shiki-base and diff-view-bare,
// the plugin's own increment.
import './shiki-base.js';
import './diff-view.js';
import { getDiffViewHighlighter } from '@git-diff-view/shiki';

window.__plugin = getDiffViewHighlighter;
