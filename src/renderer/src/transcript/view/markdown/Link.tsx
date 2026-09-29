// The `a` of every markdown surface (residue *Streamdown configuration*): the gates in sanitize.ts leave only
// `https:`, `http:`, `mailto:` and the two chip schemes. A web link opens through C5's open-external command and never
// navigates the renderer; `maws-path:` is a path chip opening the file (whether it exists is not known here);
// `maws-image:` is an image chip naming its source, loading nothing (§4.1); a link whose href the gates removed is
// its text.
import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';
import { useActions } from '../context';

const LINE = /(?:#L(\d+)|:(\d+))$/;

// `src/x.ts#L42` and `src/x.ts:42` name a line.
function pathOf(href: string): { path: string; line: number | undefined } {
  let path = href;
  try {
    path = decodeURI(href);
  } catch {
    // an undecodable href is used as written
  }
  const line = LINE.exec(path);
  return line ? { path: path.slice(0, line.index), line: Number(line[1] ?? line[2]) } : { path, line: undefined };
}

export function TranscriptLink({ href, children }: ComponentProps<'a'> & ExtraProps) {
  const actions = useActions();
  if (!href) return <span>{children}</span>;
  if (href.startsWith('maws-path:')) {
    const { path, line } = pathOf(href.slice('maws-path:'.length));
    return (
      <button type="button" className="transcript-chip" data-chip="path" title={path} onClick={() => actions.openFile(path, line)}>
        {children}
      </button>
    );
  }
  if (href.startsWith('maws-image:')) {
    const source = href.slice('maws-image:'.length);
    return (
      <span className="transcript-chip" data-chip="image" title={source}>
        {children}
        <span className="transcript-chip-detail"> · {source}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        actions.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
