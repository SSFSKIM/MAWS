// `lowlight` without its grammars (C8c execution document, Decision Log, M1 fold (2), ruled 2026-09-29): the renderer's
// build aliases `lowlight` here. `@git-diff-view/core` imports `@git-diff-view/lowlight`, whose module scope runs
// `createLowlight(all)` with every highlight.js grammar (about 900 KB) although Review highlights through shiki; this
// keeps lowlight's engine and hands it no grammar. `lowlight-engine` is the second alias of the same config block,
// lowlight's own `lib/index.js`, which its package `exports` do not name.
export { createLowlight } from 'lowlight-engine';
export const all = {};
export const common = {};
