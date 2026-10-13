// Run any experiment on the v13 seam: `node --import ./spikes/p3-store/s6/exp/use-v13.mjs spikes/p3-store/s6/exp/<x>.ts`.
// Redirects every import of src/ydoc.ts (v14) to src/ydoc-v13.ts; the reports then keep their v13 names (no -v14 suffix).
import { register } from 'node:module'
process.env.S6_YJS = '13'
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx)
  return r.url.endsWith('/src/ydoc.ts') ? { ...r, url: r.url.replace(/\\/src\\/ydoc\\.ts$/, '/src/ydoc-v13.ts') } : r
}`))
