// E4a: the Browser tool's glyphs, drawn as the shell's 16 px stroke icons on `currentColor`: the globe (the tool's icon,
// also a tab's stand-in when its page has no favicon) and the chrome's controls.
import { Icon } from '../../app/IconButton';

type Glyph = { className?: string };

export function BrowserIcon({ className }: Glyph) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.6 1.5 2.4 3.4 2.4 5.5S9.6 12 8 13.5M8 2.5C6.4 4 5.6 5.9 5.6 8s.8 4 2.4 5.5" />
    </Icon>
  );
}

export const BackIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M13 8H3.5M7.5 4 3.5 8l4 4" />
  </Icon>
);

export const ForwardIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M3 8h9.5M8.5 4l4 4-4 4" />
  </Icon>
);

export const ReloadIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M12.8 6.5A5 5 0 1 0 13 9M13 3v3.5H9.5" />
  </Icon>
);

export const CloseIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Icon>
);

export const PlusIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const MoreIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M3.75 8h.01M8 8h.01M12.25 8h.01" className="[stroke-width:2.25]" />
  </Icon>
);

// https: a closed lock; http: the lock struck through (Design §4).
export const LockIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <rect x="4" y="7" width="8" height="6" rx="1.25" />
    <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />
  </Icon>
);

export const InsecureIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <rect x="4" y="7" width="8" height="6" rx="1.25" />
    <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7M2.5 13.5l11-11" />
  </Icon>
);

export const ChevronUpIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="m4 10 4-4 4 4" />
  </Icon>
);

export const ChevronDownIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);

export const SearchIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);

export const HistoryIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </Icon>
);
