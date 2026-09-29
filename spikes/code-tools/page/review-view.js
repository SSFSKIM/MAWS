// The diff body R8 weighs and drives: one `DiffView` per patch file built from `splitPatch`'s hunks and the file names,
// no contents (C8c M3's decision: C4's patch is enough for a hunk view).
import { createElement as h } from 'react';
import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';

export { DiffModeEnum };

// DiffView parses each `hunks` entry as a whole unified diff: an entry with no `---`/`+++` header parses as an empty diff
// ("No hunks found"), so a bare `@@` section renders nothing. Each entry is therefore given a file header: `joined` feeds
// one entry per file (header + every hunk), `per-hunk` one entry per hunk, each with its own header; `bare` is the
// shape the library's type suggests and is kept to show that it fails.
export function toDiffViewHunks(file, feed = 'joined') {
  const header = `--- a/${file.oldPath ?? file.path}\n+++ b/${file.path}\n`;
  if (feed === 'bare') return file.hunks;
  if (feed === 'per-hunk') return file.hunks.map((hunk) => header + hunk + '\n');
  return [header + file.hunks.join('\n') + '\n'];
}

// `file`: a splitPatch entry. A binary or hunkless file never reaches DiffView: the shell draws its row.
export function ReviewView({ file, mode, wrap, theme, highlight, registerHighlighter, feed }) {
  if (file.kind === 'binary' || file.hunks.length === 0) {
    return h('div', { className: 'spike-placeholder', 'data-kind': file.kind }, `${file.path} · Binary`);
  }
  return h(DiffView, {
    data: {
      oldFile: { fileName: file.oldPath ?? file.path },
      newFile: { fileName: file.path },
      hunks: toDiffViewHunks(file, feed),
    },
    diffViewMode: mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified,
    diffViewWrap: wrap,
    diffViewTheme: theme,
    diffViewHighlight: highlight,
    registerHighlighter,
    diffViewFontSize: 12,
  });
}
