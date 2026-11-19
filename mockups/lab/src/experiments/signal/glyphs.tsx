// The state glyphs. One family on an 18 px box. A session that needs the person carries a solid bead with the kind
// knocked out of it; a running one a play mark (the pair of the approval's pause); an unread one a dot; a resting one nothing.
import type { SessionState } from '../../content/fixtures';

export function Bead({ state, size = 18 }: { state: SessionState; size?: number }) {
  if (state === 'idle') return null;
  if (state === 'unread')
    return (
      <svg className="bead" data-kind="unread" width={size} height={size} viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="3.1" fill="currentColor" />
      </svg>
    );
  if (state === 'running')
    return (
      <svg className="bead" data-kind="running" width={size} height={size} viewBox="0 0 18 18" aria-hidden>
        <path d="M6.4 5.3v7.4a1 1 0 0 0 1.52.85l6-3.7a1 1 0 0 0 0-1.7l-6-3.7a1 1 0 0 0-1.52.85Z" fill="currentColor" />
      </svg>
    );
  return (
    <svg className="bead" data-kind="need" width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="8.4" fill="currentColor" />
      <g className="bead-cut" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {state === 'approval' && <path d="M6.9 5.9v6.2M11.1 5.9v6.2" />}
        {state === 'question' && (
          <>
            <path d="M6.9 7.2a2.2 2.2 0 1 1 3.3 1.9c-.7.4-1.1.9-1.1 1.6" />
            <path d="M9.1 13.1v.05" />
          </>
        )}
        {state === 'plan' && <path d="M5.6 6.2h6.8M5.6 9h6.8M5.6 11.8h3.9" />}
      </g>
    </svg>
  );
}

/** What a screen reader hears where the eye sees a bead. */
export const stateWord: Record<SessionState, string> = {
  running: 'Running',
  approval: 'Waiting for your approval',
  question: 'Asked you a question',
  plan: 'Plan ready for review',
  unread: 'Finished, unread',
  idle: 'Idle',
};
