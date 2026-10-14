// The viewers' header actions, in the shell's 16 px stroke style (`Icon`), drawn in currentColor.
import { FolderIcon, Icon } from '../../../app/IconButton';

export const CommentIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11v7.5H8L5 13.5V11H2.5z" />
  </Icon>
);
export const ReloadIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.5h-2.5" />
  </Icon>
);
export const OpenExternallyIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v4H2.5V4h4" />
  </Icon>
);
export const RevealIcon = FolderIcon;
export const OpenAsFileIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M6.5 8.5 5 10l1.5 1.5M9.5 8.5 11 10l-1.5 1.5" />
  </Icon>
);
