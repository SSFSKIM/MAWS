// Sources (C8 spec *The summary*; C8a M2): the files, web pages and MCP tools the session used, newest first, ten at
// most, over C6's disclosure-independent turn activity for the session's transcript entry. The card never attaches a
// source of its own (a second hydration for ten rows); a session whose transcript this page never mounted says so. A
// file row opens a file tab (K4, C5's openTab), a web row its URL in the browser, an MCP row nothing, and says so.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { Icon } from '../../app/IconButton';
import { useLayout } from '../../stores/layout';
import { useTranscriptStore } from '../../stores/transcript';
import type { TurnActivity } from '../../transcript';
import { SUMMARY_COPY } from '../copy';
import { absolutePath, displayPath, sourcesOf, type Source } from './derive';
import { openExternal } from './PushState';
import { Section } from './Section';

// The session's activity as C6 derives it whatever the reader disclosed; null while this page holds no entry for it.
// Stable while no turn changed, so a disclosure change re-renders nothing that reads it.
export function useSessionActivity(appSessionId: AppSessionId): TurnActivity[] | null {
  return useTranscriptStore((s) => (s.entries[appSessionId] ? s.activity(appSessionId) : null));
}

export function Sources({ appSessionId, directory }: { appSessionId: AppSessionId; directory: string }) {
  const phase = useTranscriptStore((s) => s.entries[appSessionId]?.phase);
  const activity = useSessionActivity(appSessionId);
  const sources = useMemo(() => (activity ? sourcesOf(activity) : null), [activity]);
  const note = phase === undefined ? SUMMARY_COPY.openSession : phase === 'hydrating' ? SUMMARY_COPY.loading : sources?.length ? null : SUMMARY_COPY.noSources;
  return (
    <Section id="sources">
      {note ? (
        <p className="text-ui-sm text-fg-muted">{note}</p>
      ) : (
        <ul className="flex flex-col">
          {sources!.map((source) => (
            <li key={keyOf(source)} className="flex min-w-0">
              <SourceRow source={source} appSessionId={appSessionId} directory={directory} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const keyOf = (source: Source) => (source.kind === 'file' ? `file:${source.path}` : source.kind === 'web' ? `web:${source.url}` : `mcp:${source.server}/${source.tool}`);
const rowClass = 'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 -mx-1 text-left text-ui text-fg';
const buttonClass = `${rowClass} outline-accent hover:bg-bg-hover focus-visible:outline-2`;

function SourceRow({ source, appSessionId, directory }: { source: Source; appSessionId: AppSessionId; directory: string }) {
  if (source.kind === 'file') {
    const extension = /\.([A-Za-z0-9]+)$/.exec(source.path)?.[1]?.toUpperCase();
    return (
      <button
        type="button"
        title={source.path}
        className={buttonClass}
        onClick={() => useLayout.getState().openTab({ kind: 'file', path: absolutePath(source.path, directory), line: null, appSessionId })}
      >
        <FileIcon />
        <span className="min-w-0 flex-1 truncate">{displayPath(source.path, directory)}</span>
        {extension && <span className="shrink-0 text-ui-sm text-fg-faint">{extension}</span>}
      </button>
    );
  }
  if (source.kind === 'web') {
    return (
      <button type="button" title={source.url} className={buttonClass} onClick={() => openExternal(source.url)}>
        <GlobeIcon />
        <span className="min-w-0 flex-1 truncate">{source.url.replace(/^https?:\/\//, '')}</span>
      </button>
    );
  }
  return (
    <div className={rowClass}>
      <PlugIcon />
      <span className="min-w-0 flex-1 truncate text-fg-muted">{`${source.server} · ${source.tool}`}</span>
      <span className="shrink-0 text-ui-sm text-fg-faint">{SUMMARY_COPY.sourceOnly}</span>
    </div>
  );
}

const FileIcon = () => (
  <Icon className="size-3.5 text-fg-muted">
    <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
  </Icon>
);
const GlobeIcon = () => (
  <Icon className="size-3.5 text-fg-muted">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.7 5.9 5.7 8s.7 3.9 2.3 5.5" />
  </Icon>
);
const PlugIcon = () => (
  <Icon className="size-3.5 text-fg-faint">
    <path d="M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14" />
  </Icon>
);
