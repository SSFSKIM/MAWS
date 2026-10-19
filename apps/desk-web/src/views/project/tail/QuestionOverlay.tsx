// The ask mod's async question in the session view (the composite's §9.1; the owner's 2B): it draws from its transcript
// row, MAWS's question receipt (S1 classifies the ask mod's tool, `mcp__sminos__AskUserQuestion` or `mcp__doperpowers__AskUserQuestion`, as a question), and the log's
// `question` and `answered` events, joined to it by their `src` (the call's tool-use id), overlay that row: while its
// card waits at the tail the receipt says "Waiting for your answer · below", and once answered it carries the log's
// answer, which the transcript never writes back into the call (the answer reaches the model later, as a prompt or a
// context the transcript holds apart, which answers the row too when the log has none: `conversation/asked.ts`). A
// question whose request was settled with no answer used (DX4's `withdrawn`: its turn aborted, its session ended) and
// that the log never answered says so, as its card would have, rather than waiting on an answer nothing will take.
//
// MAWS's list offers no seam to redraw one derived row and its `QuestionRow` is not edited here, so the overlay is drawn
// into the row the list mounted: a host element appended to the receipt, found again whenever the virtualized list
// mounts the row anew, its lines in MAWS's own classes standing in for the receipt's (the desk's stylesheet hides the
// receipt's lines while the overlay draws in it). Only the rows of the questions the log or a transcript answer names
// are touched.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { QUESTION } from '../../../../../../src/renderer/src/transcript/model/copy';
import type { AskedQuestion } from '../../../conversation/asked';
import { settledText } from '../../../conversation/words';
import type { RequestRecord } from '../../../project/conversation';

/**
 * One question row's overlay: its questions, the log's answers (or its answer's text when it reads no answers), whether
 * it waits on its card below or on an answer from anywhere, and, once its request was withdrawn unanswered, the words
 * of that settlement.
 */
export type QuestionOverlayFact = AskedQuestion & { waiting: 'below' | 'open' | null; withdrawn: string | null };

/**
 * Each asked question's overlay, given the session's requests as the conversation keeps them (pending or settled, each
 * settlement verified): the log's answer first; else waiting on its card below while its request is pending; else
 * withdrawn when its request was settled so; else open.
 */
export function questionOverlayFacts(asked: ReadonlyMap<string, AskedQuestion>, requests: readonly RequestRecord[]): Map<string, QuestionOverlayFact> {
  const callOf = (r: RequestRecord) => r.raised.toolUseId ?? r.request;
  const pending = new Set(requests.filter((r) => r.pending).map(callOf));
  const withdrawn = new Map(requests.flatMap((r) => (r.settled?.outcome === 'withdrawn' ? [[callOf(r), settledText(r.settled.winner, 'withdrawn', r.settled.by, '')] as const] : [])));
  const facts = new Map<string, QuestionOverlayFact>();
  for (const [src, question] of asked) {
    const open = question.answeredText === null;
    const below = open && pending.has(src);
    const ended = open && !below ? (withdrawn.get(src) ?? null) : null;
    facts.set(src, { ...question, waiting: !open ? null : below ? 'below' : ended === null ? 'open' : null, withdrawn: ended });
  }
  return facts;
}

export function QuestionOverlays({ root, facts }: { root: HTMLElement | null; facts: ReadonlyMap<string, QuestionOverlayFact> }) {
  const hosts = useHosts(root, [...facts.keys()]);
  return [...hosts].flatMap(([src, host]) => {
    const fact = facts.get(src);
    return fact ? [createPortal(<Overlay fact={fact} />, host, src)] : [];
  });
}

function Overlay({ fact }: { fact: QuestionOverlayFact }) {
  const { questions, answers, answeredText, waiting, withdrawn } = fact;
  return (
    <>
      <ul className="transcript-question-lines" data-testid="question-overlay">
        {questions.map(({ question, header }) => {
          const answer = answers?.[question];
          return (
            <li key={question} className="transcript-question-line" title={question}>
              <span className="transcript-question-label">{header || question}</span>
              <span className="transcript-question-arrow" aria-hidden="true">
                →
              </span>
              <span className="transcript-question-answer" data-answer={answer === undefined ? 'none' : ''}>
                {answer ?? (waiting ? 'waiting' : answeredText !== null || withdrawn !== null ? QUESTION.notAnswered : 'not answered yet')}
              </span>
            </li>
          );
        })}
      </ul>
      {waiting === 'below' && (
        <div className="desk-question-foot" data-waiting="">
          Waiting for your answer · below
        </div>
      )}
      {waiting === 'open' && (
        <div className="desk-question-foot" data-waiting="">
          Waiting for an answer
        </div>
      )}
      {withdrawn !== null && (
        <div className="desk-question-foot" data-testid="question-withdrawn">
          {withdrawn}
        </div>
      )}
      {answers === null && answeredText !== null && (
        <div className="desk-question-foot" data-testid="question-answered">
          Answered: {answeredText}
        </div>
      )}
    </>
  );
}

const ROW = (src: string) => `[data-row-id="${CSS.escape(`question:${src}`)}"] .transcript-question`;

/**
 * The host in each named question row the list has mounted, kept current as the list mounts and unmounts rows: one
 * scan per frame at most, and a new map only when a host changed. A host found before the names changed may stay in
 * the map until the next scan; the caller draws only what it still names.
 */
function useHosts(root: HTMLElement | null, srcs: string[]): Map<string, HTMLElement> {
  const [hosts, setHosts] = useState<Map<string, HTMLElement>>(() => new Map());
  const joined = srcs.join('\n');
  useEffect(() => {
    const names = joined === '' ? [] : joined.split('\n');
    if (!root || names.length === 0) return;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const next = new Map<string, HTMLElement>();
      for (const src of names) {
        const receipt = root.querySelector<HTMLElement>(ROW(src));
        if (!receipt) continue;
        let host = receipt.querySelector<HTMLElement>(':scope > [data-desk-question]');
        if (!host) {
          host = document.createElement('div');
          host.setAttribute('data-desk-question', '');
          receipt.appendChild(host);
        }
        next.set(src, host);
      }
      setHosts((prev) => (prev.size === next.size && [...next].every(([src, host]) => prev.get(src) === host) ? prev : next));
    };
    frame = requestAnimationFrame(scan);
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(scan);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, joined]);
  return hosts;
}
