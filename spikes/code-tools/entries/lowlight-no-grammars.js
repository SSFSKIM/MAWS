// An alias for `lowlight` that keeps its engine and drops its grammars: @git-diff-view/core imports lowlight's `all`
// (every highlight.js language) at module scope, whether or not a view highlights. Aliasing `lowlight` to this module is
// how the product would ship DiffView without them (diffViewHighlight off, or highlighting through the shiki plugin).
export { createLowlight } from '../node_modules/.pnpm/lowlight@3.3.0/node_modules/lowlight/lib/index.js';
export const all = {};
export const common = {};
