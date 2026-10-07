// E4d: the Comment toggle's glyph, a speech bubble drawn as the shell's 16 px stroke icons on `currentColor`.
import { Icon } from '../../../app/IconButton';

export const CommentIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11v7.5H8L5 13.5V11H2.5z" />
  </Icon>
);
