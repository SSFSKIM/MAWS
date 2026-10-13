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

export const KIND_GUIDES: Record<ArtifactKind, { guide: string; format: string }> = {
  document: { guide: documentGuide, format: documentFormat },
  presentation: { guide: presentationGuide, format: presentationFormat },
  design: { guide: designGuide, format: designFormat },
  design_system: { guide: designSystemGuide, format: designSystemFormat },
  dashboard: { guide: dashboardGuide, format: dashboardFormat },
  html: { guide: htmlGuide, format: htmlFormat },
  file: { guide: fileGuide, format: fileFormat },
};
