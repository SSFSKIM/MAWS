// The key the engine reads off a listed tool to load it whatever tool search defers (P4-R7's probe: the pinned engine
// honours it for an SDK server's tool, P4-B4). Under tool search a deferred tool costs one ToolSearch request before its
// first use. Board ticket 420: the ask alone is listed with it, the session's line to its human; the tools an edit needs,
// listed with it from P4-A3 until then, are found through tool search (about 7 s on a first edit, for the tokens of every
// session's first request). A leaf, so a tool module can list with it without importing another.
export const ALWAYS_LOAD = { 'anthropic/alwaysLoad': true } as const;
