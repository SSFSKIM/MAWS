// Each kind's guide (`SKILL.md`) and format reference (`format.md`) as text (X25; §4.3 of
// docs/doperpowers/plans/2026-10-12-p3-co-work.md): what `artifact_describe_type` returns and `artifact_create` attaches
// to the creating turn. Bundled by Vite's `?raw` import into whichever build imports this module (the host's, the
// renderer's), never read from disk at run time. The kinds' owners (B, C, D, E) write their files in place.
import type { ArtifactKind } from '@shared/artifacts/entity';
import dashboardFormat from './dashboard/format.md?raw';
import dashboardGuide from './dashboard/SKILL.md?raw';
import designFormat from './design/format.md?raw';
import designGuide from './design/SKILL.md?raw';
import designSystemFormat from './design_system/format.md?raw';
import designSystemGuide from './design_system/SKILL.md?raw';
import documentFormat from './document/format.md?raw';
import documentGuide from './document/SKILL.md?raw';
import fileFormat from './file/format.md?raw';
import fileGuide from './file/SKILL.md?raw';
import htmlFormat from './html/format.md?raw';
import htmlGuide from './html/SKILL.md?raw';
import presentationFormat from './presentation/format.md?raw';
import presentationGuide from './presentation/SKILL.md?raw';

// P3-F wave S (F14, the owner's obs 2): every guide ends under its "Before you finish" with how to name the artifact to
// the user, a link MAWS's transcript draws as a chip that opens it, so nobody has to ask where it is.
const LINKED = (guide: string) =>
  `${guide.trimEnd()}\n\nWhen a message to the user names this artifact, write it as a Markdown link, [its title](maws-artifact:<artifactId>): the user opens it in MAWS with a click. Call show_pane only when the user should see it now.\n`;

export const KIND_GUIDES: Record<ArtifactKind, { guide: string; format: string }> = {
  document: { guide: LINKED(documentGuide), format: documentFormat },
  presentation: { guide: LINKED(presentationGuide), format: presentationFormat },
  design: { guide: LINKED(designGuide), format: designFormat },
  design_system: { guide: LINKED(designSystemGuide), format: designSystemFormat },
  dashboard: { guide: LINKED(dashboardGuide), format: dashboardFormat },
  html: { guide: LINKED(htmlGuide), format: htmlFormat },
  file: { guide: LINKED(fileGuide), format: fileFormat },
};
