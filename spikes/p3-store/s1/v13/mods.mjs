// S1 bridge: the v13 stack resolved from spikes/p3-store/node_modules, for scripts that load v13 and v14 side by side
// (yjs 13 and @y/y 14 register different import guards, so both can live in one process). Throwaway spike code.
export * as Y13 from 'yjs'
export { Editor as Editor13, getSchema as getSchema13 } from '@tiptap/core'
export { default as StarterKit13 } from '@tiptap/starter-kit'
export { Table as Table13, TableRow as TableRow13, TableCell as TableCell13, TableHeader as TableHeader13 } from '@tiptap/extension-table'
export { UniqueID as UniqueID13 } from '@tiptap/extension-unique-id'
export { default as Collaboration13 } from '@tiptap/extension-collaboration'
export { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
