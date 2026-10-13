// P3-B's type shim for `@y/prosemirror` 2.0.0-15 (the ledger's X24 row allows one beside P3-A's y-globals.d.ts): the
// package's published declarations name types that only its own global.d.ts declares, which no declaration references,
// so under tsconfig.web.json's `skipLibCheck: false` they do not compile without these. This is that file's set, but
// for `Transaction`, which y-globals.d.ts already declares as Yjs's (the package's own declarations spell the
// ProseMirror one out in full, so only `CommandDispatch` below needed it qualified). A re-pin regenerates it from the
// new version's global.d.ts, or deletes it once the package's declarations stand alone (H3's tracker row).
// A script, not a module: every line declares a global type.
declare type YType = import('@y/y').Node; // the package's global.d.ts names `Type`, which rc.28 exports as `Node`
declare type Renderer = import('@y/y').AbstractRenderer;
declare type EditorState = import('prosemirror-state').EditorState;
declare type EditorView = import('prosemirror-view').EditorView;
declare type CommandDispatch = (tr: import('prosemirror-state').Transaction) => void;
declare type AttributionMapper = (format: Record<string, unknown> | null, attribution: import('lib0/delta').Attribution) => Record<string, unknown> | null;
declare type AttributedNodesPredicate = (nodeName: string, kinds: { insert?: boolean; delete?: boolean; format?: boolean }) => boolean;
declare type NodeCompare = (a: import('lib0/delta').DeltaAny, b: import('lib0/delta').DeltaAny) => boolean;
declare type IsInitialContent = (doc: import('prosemirror-model').Node) => boolean;
declare type SyncPluginState = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$syncPluginState>;
declare type SyncPluginStateUpdate = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$syncPluginStateUpdate>;
declare type ProsemirrorDelta = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$prosemirrorDelta>;
