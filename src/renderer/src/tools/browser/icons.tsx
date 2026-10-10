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

// cua #90 start: the bookmarks bar's glyphs: a folder, the » that lists the chips the bar cannot fit, a page with no
// favicon, and the star an address suggestion that is a bookmark carries (Chrome's omnibox mark)
export const FolderIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </Icon>
);

export const MoreBookmarksIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M4 4.5 7.5 8 4 11.5M8.5 4.5 12 8l-3.5 3.5" />
  </Icon>
);

export const PageIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />
  </Icon>
);

export const BookmarkIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="m8 2.5 1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" />
  </Icon>
);

// the profile popover's: the Default profile's person, Sync bookmarks now's two arrows, Re-import's arrow into a tray
export const PersonIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <circle cx="8" cy="5.75" r="2.75" />
    <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
  </Icon>
);

export const SyncIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M12.5 6.5A4.75 4.75 0 0 0 4 5M3.5 9.5A4.75 4.75 0 0 0 12 11M4 2.5V5h2.5M12 13.5V11H9.5" />
  </Icon>
);

// the extensions action bar's puzzle piece: the folded bar's button, and an extension's action that has no icon
export const PuzzleIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M6.5 3.5a1.5 1.5 0 0 1 3 0v1h3v3h-1a1.5 1.5 0 0 0 0 3h1v3h-3v-1a1.5 1.5 0 0 0-3 0v1h-3v-3h1a1.5 1.5 0 0 0 0-3h-1v-3h3z" />
  </Icon>
);

export const ImportIcon = ({ className }: Glyph) => (
  <Icon className={className}>
    <path d="M8 2.5v7M5 6.5l3 3 3-3M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
  </Icon>
);
// cua #90 end
