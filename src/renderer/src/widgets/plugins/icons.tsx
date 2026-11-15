// The plugin library's glyphs, in the app's 16 px stroke set (`Icon`, mockups/01-shell.html): Filter's funnel and the
// row's overflow. (UX wave U11c: an item's tile is the shared image component's, so the neutral plugin glyph is gone.)
import { Icon } from '../../app/IconButton';

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
