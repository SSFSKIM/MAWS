// Line icons of the work area, drawn in the current colour (tokens only): one per tool category for group headers,
// the receipt's file and the agent message's bubble.
import type { ToolCategory } from '../../model/rows';
import type { AnchorKind } from '@shared/anchor/anchor'; // E3

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
export const QuestionIcon = () => <Icon path="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.3h.01" />; // E1: the ask capsule
// E3 start: an anchored prompt's chip, by what it is about, and the side-thread row's branching thread
const ANCHOR_PATHS: Record<AnchorKind, string> = {
  'file-line': 'M3 2h7l3 3v9H3zM10 2v4h3M5 9h6M5 11h4', // the file glyph
  'pr-line': 'M4.5 4.5v7M4.5 4.5a1.5 1.5 0 1 0 0-.01M4.5 11.5a1.5 1.5 0 1 0 0 .01M11.5 11.5V6.5a2 2 0 0 0-2-2H7M8.5 3 7 4.5 8.5 6M11.5 11.5a1.5 1.5 0 1 0 0 .01', // a pull request
  'browser-element': 'M2 3h12v10H2zM2 6h12M4 4.5h.01M6 4.5h.01', // a browser window
  'artifact-element': 'M3 3h10v10H3zM6 6h4v4H6z', // an element inside a frame
  none: 'M13 3H3v8h3l3 3v-3h4z', // a message
};
export const AnchorIcon = ({ kind }: { kind: AnchorKind }) => <Icon path={ANCHOR_PATHS[kind]} data-icon={kind} />;
export const ThreadIcon = () => <Icon path="M4 2v12M4 9c0-2.2 1.8-4 4-4h4M10 3l2 2-2 2" />;
// E3 end
export const ArtifactIcon = () => <Icon path="M2 2.5h12v11H2zM2 5.5h12M6.5 8 5 9.5 6.5 11M9.5 8l1.5 1.5L9.5 11" />; // E2: the artifact row (a page of code)
// E4c: the browser action row, the Browser tool's globe
export const BrowserIcon = () => <Icon path="M13.5 8A5.5 5.5 0 1 1 2.5 8a5.5 5.5 0 0 1 11 0zM2.5 8h11M8 2.5c1.6 1.5 2.4 3.4 2.4 5.5S9.6 12 8 13.5M8 2.5C6.4 4 5.6 5.9 5.6 8s.8 4 2.4 5.5" />;
