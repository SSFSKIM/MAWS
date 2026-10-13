// COPY of spikes/p3-store/s1/lib/tiptap.mjs at 4ab6b9b7 for S7a (unchanged below this line).
// S1 helper: import Tiptap's per-node extension packages (StarterKit's own dependencies) without adding them to
// either spike package. pnpm keeps them beside starter-kit in its virtual store; every copy resolves to the same
// real @tiptap/core file, so Node's module cache yields one instance. Throwaway spike code (P3-0, S1).
import { realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @param {string} nodeModules the node_modules directory that holds @tiptap/starter-kit */
export const tiptapSub = (nodeModules) => {
  const kitDir = realpathSync(join(nodeModules, '@tiptap/starter-kit'))
  const scope = dirname(kitDir) // .../.pnpm/@tiptap+starter-kit@x/node_modules/@tiptap
  return name => import(pathToFileURL(join(realpathSync(join(scope, name)), 'dist/index.js')).href)
}
