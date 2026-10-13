// The artifact kinds' glyphs (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4), in the shell's 16 px stroke style
// (`Icon`), drawn in currentColor: the library's rows and its "Make something new" cards, and the panel's Artifacts tool
// after them.
import type { ArtifactKind } from '@shared/artifacts/entity';
import { Icon } from '../app/IconButton';

const GLYPHS: Record<ArtifactKind, () => React.JSX.Element> = {
  document: () => (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M6 7.5h4M6 10h4M6 12.5h2.5" />
    </>
  ),
  presentation: () => (
    <>
      <rect x="2" y="2.5" width="12" height="8.5" rx="1" />
      <path d="M8 11v2.5M5.5 13.5h5" />
    </>
  ),
  design: () => (
    <>
      <rect x="4" y="4" width="8" height="8" />
      <path d="M4 1.5V4M1.5 4H4M12 14.5V12M14.5 12H12" />
    </>
  ),
  design_system: () => (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <circle cx="11.25" cy="11.25" r="2.25" />
    </>
  ),
  dashboard: () => (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M5 11V8.5M8 11V6M11 11V7.5" />
    </>
  ),
  html: () => (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 5.5h12M6.5 8l-1.5 1.5L6.5 11M9.5 8l1.5 1.5L9.5 11" />
    </>
  ),
  file: () => (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </>
  ),
};

export function KindIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const Glyph = GLYPHS[kind];
  return (
    <Icon className={className}>
      <Glyph />
    </Icon>
  );
}

export const MoreIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" className="[stroke-width:2.25]" />
  </Icon>
);

export const ChevronRightIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Icon>
);
