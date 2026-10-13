// The `claude` export of a design system (D12 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): Claude's
// files from the system's document as it stands (`toClaude`: `tokens.json` in Claude's list grammar, `README.md` from
// the law, the assets given). What A's export service runs for `artifact_export {format: 'claude'}` and the page's
// "Export for Claude" once its exporter registry exists (A's M7; reported to the architect). Portable (§4.10).
import type { Doc } from '../yjs';
import { toClaude } from './claude';
import { readSystem } from './model';

/** Claude's files for the system in `doc`; `assets` are the system's `assets/<name>` files. Throws `ClaudeShapeError`
 * when Claude's grammar cannot hold the system, and an error when the document holds no system. */
export function claudeExportFiles(doc: Doc, assets?: Readonly<Record<string, string>>): Record<string, string> {
  const { meta, law, tokens } = readSystem(doc);
  if (!meta) throw new Error('the document holds no design system yet');
  return toClaude({ name: meta.name, law, tokens, ...(assets ? { assets } : {}) });
}
