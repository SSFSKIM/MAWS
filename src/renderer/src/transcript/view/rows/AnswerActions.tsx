// UX wave U3b (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, decisions 12 to 15, Interfaces §C
// and §D; ruled R15, R16 and R22): under the answer its mount placed it on, Copy, "Fork from here" and the answer's time,
// always laid out and shown on hover or focus within. Copy reads the store's whole turn at the press. Fork is the mount's
// act (`forkFrom`), drawn only where the entry allows it and the mount gives one, for a session's own transcript: while
// it is out the button is disabled and busy, and the act opens the fork's tab or shows its refusal itself. The word cut
// (N119, N120): Fork carries no sentence about how a fork works; greyed, it is `aria-disabled` and keeps the keyboard,
// its reason its tooltip and its description.
import { useRef, useState, useSyncExternalStore } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../../stores/transcript';
import { answerMarkdownOf, type AnswerAction } from '../../model/answer-actions';
import { UnavailableButton } from '../../../ui/tip';
import { ANSWER_ACTIONS } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useRowSession, useTranscriptContext, type TranscriptActions } from '../context';
import { copyText } from './parts';

const NOTHING = () => () => {};

export function AnswerActions({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { answerActions, storeKey, variant, actions } = useTranscriptContext();
  const entry = useSyncExternalStore(answerActions?.subscribe ?? NOTHING, () => answerActions?.get(row.id));
  const session = useRowSession();
  if (entry === undefined) return null;
  const copy = () => {
    const state = useTranscriptStore.getState().entries[storeKey]?.state;
    copyText(state === undefined ? '' : answerMarkdownOf(state, entry.turnId));
  };
  // a subagent's rows are not the session's prompts: a child's transcript forks nothing
  const forkFrom = entry.fork && variant === 'session' && session !== null ? actions.forkFrom : undefined;
  return (
    <div className="transcript-answer-actions">
      <button type="button" onClick={copy}>
        {ANSWER_ACTIONS.copy}
      </button>
      {forkFrom && <ForkButton forkFrom={forkFrom} appSessionId={session!} entry={entry} />}
      <span>{formatClock(Date.parse(row.at))}</span>
    </div>
  );
}

// Press, then disabled and busy until the act settles; a press meanwhile does nothing. The act runs on if the row leaves
// the list; if it never settles, this mount of the row stays disabled until the act's own budget ends it.
function ForkButton({ forkFrom, appSessionId, entry }: { forkFrom: NonNullable<TranscriptActions['forkFrom']>; appSessionId: AppSessionId; entry: AnswerAction }) {
  const unavailable = forkFrom.useUnavailable(appSessionId);
  const [busy, setBusy] = useState(false);
  const out = useRef(false);
  const fork = async () => {
    if (out.current || unavailable !== null) return;
    out.current = true;
    setBusy(true);
    try {
      await forkFrom.run(appSessionId, entry.rewindTo);
    } finally {
      out.current = false;
      setBusy(false);
    }
  };
  return (
    <UnavailableButton reason={unavailable}>
      <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void fork()}>
        {ANSWER_ACTIONS.fork}
      </button>
    </UnavailableButton>
  );
}
