// Line icons of the work area, drawn in the current colour (tokens only): one per tool category for group headers,
// the receipt's file and the agent message's bubble.
import type { ToolCategory } from '../../model/rows';

const CATEGORY_PATHS: Record<ToolCategory, string> = {
  mcp: 'M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0zM8 12v2', // a plug
  skills: 'M3 3h4a2 2 0 0 1 2 2v8a2 2 0 0 0-2-2H3zM13 3H9a2 2 0 0 0-2 2v8a2 2 0 0 1 2-2h4z', // an open book
  files: 'm3 10 8-8 3 3-8 8-4 1zM9 4l3 3', // a pencil
  exploration: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3', // a magnifier
  commands: 'M2 3h12v10H2zM4.5 6.5 6.5 8l-2 1.5M8 10h3', // a terminal
  web: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12', // a globe
  other: 'M4 8h.01M8 8h.01M12 8h.01', // three dots
};

function Icon({ path, ...rest }: { path: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg className="transcript-icon" viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const CategoryIcon = ({ category }: { category: ToolCategory }) => <Icon path={CATEGORY_PATHS[category]} data-icon={category} />;
export const FileIcon = () => <Icon path="M3 2h7l3 3v9H3zM10 2v4h3M5 9h6M5 11h4" />;
export const MessageIcon = () => <Icon path="M13 3H3v8h3l3 3v-3h4z" />;
