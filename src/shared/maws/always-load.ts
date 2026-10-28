// The key the engine reads off a listed tool to load it whatever tool search defers (P4-R7's probe: the pinned engine
// honours it for an SDK server's tool, P4-B4). Under tool search a deferred tool costs one ToolSearch request before its
// first use, so the tools an edit needs are listed with it (P4-A3). A leaf: the tool modules that list with it import
// it without importing each other.
export const ALWAYS_LOAD = { 'anthropic/alwaysLoad': true } as const;
