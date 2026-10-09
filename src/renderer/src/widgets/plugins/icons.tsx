// The plugin library's glyphs, in the app's 16 px stroke set (`Icon`, mockups/01-shell.html): a neutral plugin glyph for
// the icon tile (the engine's manifest has no icon field, U3 F2; Desktop falls back to a glyph too), Show's funnel and
// the row's overflow.
import { Icon } from '../../app/IconButton';

export const PluginGlyph = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 5.5h2.5a1.5 1.5 0 1 1 3 0H11v2.5a1.5 1.5 0 1 1 0 3V13.5H3z" />
  </Icon>
);

export const FilterIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11l-4.25 5v4l-2.5 1v-5z" />
  </Icon>
);

export const MoreIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="3.5" r="0.75" className="fill-current" />
    <circle cx="8" cy="8" r="0.75" className="fill-current" />
    <circle cx="8" cy="12.5" r="0.75" className="fill-current" />
  </Icon>
);
