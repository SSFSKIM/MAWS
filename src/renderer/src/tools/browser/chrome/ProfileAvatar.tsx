// cua #90: a profile's avatar as the pill, its popover and Switch profile draw it (the spec's "The avatar and the
// profile popover"): the Google picture Chrome kept, round; else the initial on a disc of the theme's accent palette,
// coloured by the profile directory; and for the Default partition a neutral person glyph.
import type { BrowserProfileListItem } from '@shared/browser/profiles';
import { PersonIcon } from '../icons';
import { avatarTone } from './profile';

const SIZES = {
  18: { box: 'size-[18px]', letter: 'text-ui-sm', glyph: 'size-3' },
  20: { box: 'size-5', letter: 'text-ui-sm', glyph: 'size-3.5' },
  40: { box: 'size-10', letter: 'text-prose font-semibold', glyph: 'size-6' },
} as const;

// `profile`: the listed profile, or null for the Default partition.
export function ProfileAvatar({ profile, size }: { profile: BrowserProfileListItem | null; size: keyof typeof SIZES }) {
  const { box, letter, glyph } = SIZES[size];
  const round = `${box} shrink-0 rounded-full`;
  if (profile === null) {
    return (
      <span aria-hidden data-profile-avatar="default" className={`${round} inline-flex items-center justify-center bg-bg-active text-fg-muted`}>
        <PersonIcon className={glyph} />
      </span>
    );
  }
  if (profile.avatar.kind === 'picture') return <img alt="" data-profile-avatar="picture" src={profile.avatar.dataUrl} className={`${round} object-cover`} />;
  return (
    <span aria-hidden data-profile-avatar="initials" className={`${round} inline-flex items-center justify-center leading-none font-medium text-bg ${avatarTone(profile.profileDir)} ${letter}`}>
      {profile.avatar.letter}
    </span>
  );
}
