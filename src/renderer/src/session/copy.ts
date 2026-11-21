// The held session's line (docs/doperpowers/specs/2026-11-16-word-cut-design.md, C128), kept here as the spec's build
// constraint asks.
export const HOLDER_NOTICE = {
  terminal: 'Live in Terminal · read-only',
  backgroundJob: 'Live as background job · read-only',
  pid: (pid: number) => `pid ${pid}`, // not drawn at rest: the line's tooltip and description
};
