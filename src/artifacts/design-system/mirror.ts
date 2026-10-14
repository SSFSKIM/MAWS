// The design system's linked-directory mirror (Decision Log 18 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md;
// P3-L's `registerMirrorWriter`, the P3 interface ledger §7): a system in a Space linked to a project directory is
// mirrored as a folder named by its slug holding exactly the agent's file view (`readFiles`): the law, the token file,
// the canon, the kept Claude sources, and the generated `tokens.css` and `office-theme.json`, so the project holds the
// system its code is styled by, with `tokens.css` ready to import. Beside them, every asset the store lists for the
// system under `assets/` (its faces included, read through L's `readAsset`), so the canon's and `document.css`'s
// `assets/…` references resolve in the mirrored folder. Portable (§4.10); registered by the engine host's design-system
// module.
import type { MirrorWriter } from '../library/mirror';
import { mirrorSlug } from '../library/mirror';
import { readFiles, readOrigin } from './model';

export const designSystemMirrorWriter: MirrorWriter = ({ artifact, doc, assets = [], readAsset }) => {
  if (!doc || readOrigin(doc) === null) return { files: {} }; // nothing written into it yet
  const folder = mirrorSlug(artifact);
  const files: Record<string, string | Uint8Array> = Object.fromEntries(Object.entries(readFiles(doc)).map(([path, text]) => [`${folder}/${path}`, text]));
  if (readAsset) for (const { ref } of assets) files[`${folder}/${ref}`] = readAsset(ref);
  return { files };
};
