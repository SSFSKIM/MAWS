// E4a: the Browser tool's glyph (a globe), also a tab's stand-in when its page has no favicon. Strokes on
// `currentColor`, as every panel tool's.
import { Icon } from '../../app/IconButton';

export function BrowserIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.6 1.5 2.4 3.4 2.4 5.5S9.6 12 8 13.5M8 2.5C6.4 4 5.6 5.9 5.6 8s.8 4 2.4 5.5" />
    </Icon>
  );
}
