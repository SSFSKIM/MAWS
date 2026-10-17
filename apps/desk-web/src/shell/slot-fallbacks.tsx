// What a slot shows until DC6 registers its component: a quiet note of what will be there, never an empty hole.
import { sessionName } from '../log/projection';
import type { Slots } from './slots';

const Depth: Slots['depth'] = ({ session }) => (
  <div className="flex h-full flex-col gap-2 p-4 text-ui-sm text-fg-muted" data-slot="depth">
    <div className="text-ui font-medium text-fg">{session ? sessionName(session) : 'Session depth'}</div>
    <p className="m-0 leading-5">
      {session
        ? 'The subagents, the background jobs, the diff of the working tree, and session info will be here.'
        : 'Open a session to see its subagents, diff and details here.'}
    </p>
  </div>
);

export const FALLBACKS: Slots = { depth: Depth };
