// The request card, copied from MAWS's `RequestCard.tsx` and cut to the desk (the renderer survey's copy-and-adapt): a
// frame naming who asks and on which machine, around MAWS's own variant pieces imported as they stand — the question
// stepper (`variants/Question`), the tool preview (`preview/ToolPreview`), and the card's controls. It answers through
// DX6 (`answer`, `decide`) with the digest of exactly the request it drew, and draws every state `cardState` names:
// open, in flight, uncertain with Retry, failed, settled by its winner, waiting in the terminal, offline, closed.
// A permission prompt offers Allow and Deny (with an optional reason); MAWS's scope group and "deny and stop the turn"
// are not drawn, because DX6's `decide` carries allow or deny and a message only. An async question is answer-only.
import { useState } from 'react';
import { useStore } from 'zustand';
import type { Raised } from 'desk-hub/protocol';
import type { AttentionItem } from '@shared/graph/attention';
import type { Question, SessionEvent } from '@shared/graph/events';
import type { RequestAnswer } from '@shared/engine/answers';
import { CardButton, CardTextarea, Controls, Muted } from '../../../../../src/renderer/src/request-card/controls';
import { ToolPreview } from '../../../../../src/renderer/src/request-card/preview/ToolPreview';
import { toolVerb } from '../../../../../src/renderer/src/request-card/tools';
import { QuestionBody } from '../../../../../src/renderer/src/request-card/variants/Question';
import { capabilities } from '../../conversation/capabilities';
import { cardState, isAsyncQuestion, isQuestion, type CardState } from '../../conversation/card-state';
import { settledText } from '../../conversation/words';
import { raisedAgent, raisedTruncated } from '../../hub/protocol-ahead';
import type { RequestRecord, RpcEntry } from '../../project/conversation';
import { useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;

/** The raised request as MAWS's permission pieces read it: the tool's name and input, and nothing MAWS-only. */
const asPermission = (raised: Raised) => ({ kind: 'permission.requested', toolName: raised.tool, input: raised.input, displayName: null, mcpServer: null, description: null }) as unknown as PermissionEvent;

/** The native AskUserQuestion input as MAWS's question stepper reads it. */
function questionsOf(raised: Raised): Question[] {
  const questions = Array.isArray(raised.input.questions) ? raised.input.questions : [];
  return questions.flatMap((q) => {
    if (typeof q !== 'object' || q === null || Array.isArray(q) || typeof q.question !== 'string') return [];
    const options = Array.isArray(q.options) ? q.options : [];
    return [
      {
        question: q.question,
        header: typeof q.header === 'string' ? q.header : '',
        multiSelect: q.multiSelect === true,
        options: options.flatMap((o) =>
          typeof o === 'object' && o !== null && !Array.isArray(o) && typeof o.label === 'string'
            ? [{ label: o.label, description: typeof o.description === 'string' ? o.description : null, preview: typeof o.preview === 'string' ? o.preview : null }]
            : [],
        ),
      },
    ];
  });
}

function latestRpc(rpcs: Record<string, RpcEntry>, request: string): RpcEntry | null {
  let latest: RpcEntry | null = null;
  for (const entry of Object.values(rpcs)) if (entry.request === request) latest = entry;
  return latest;
}

/** `embedded`: the card is the body of the session's own message, which already names it and its machine. */
export function RequestCard({ request, embedded = false }: { request: string; embedded?: boolean }) {
  const { connection, member, sessions } = useDesk();
  const record = useStore(connection.conversation.store, (s) => s.requests[request]);
  const rpcs = useStore(connection.conversation.store, (s) => s.rpcs);
  if (!record) return null; // never seen, or its code failed: not drawn (the view reports the failure)
  const session = sessions.get(record.raised.session) ?? null;
  const question = isQuestion(record.raised.tool);
  const capability = session ? capabilities(session)[question ? 'answer' : 'decide'] : { can: false, reason: 'the session is not in this project’s log yet' };
  const rpc = latestRpc(rpcs, request);
  const state = cardState(record, rpc, capability, session?.machineOnline ?? null);
  const who = session?.alias ?? record.raised.session.slice(0, 8);
  const agent = raisedAgent(record.raised);
  const verb = question ? 'asks' : `wants to ${toolVerb(asPermission(record.raised))}`;
  // A subagent's request names the subagent asking, as the session's.
  const what = agent ? (embedded ? `its subagent ${agent} ${verb}` : `${verb}, through its subagent ${agent}`) : verb;
  return (
    <article
      className={['my-2 flex max-w-[640px] flex-col gap-3 rounded-md border px-3.5 py-3 text-ui', state.kind === 'open' || state.kind === 'failed' || state.kind === 'uncertain' ? 'border-border-strong bg-bg-raised' : 'border-border bg-bg'].join(' ')}
      data-request={request}
      data-card-state={state.kind}
      aria-label={`${who} ${what}`}
    >
      <header className="flex flex-wrap items-baseline gap-x-1.5 text-ui-sm">
        {!embedded && (
          <>
            <span className="font-semibold text-fg">{who}</span>
            <span className="text-fg-muted">@{record.machine}</span>
          </>
        )}
        <span className="text-fg-muted">{embedded ? what.charAt(0).toUpperCase() + what.slice(1) : what}</span>
        {isAsyncQuestion(record.raised) && <span className="text-fg-faint">· it keeps working while it waits</span>}
        {state.kind === 'open' && state.window && (
          <span className="ml-auto rounded-sm border border-border px-1.5 text-fg-muted" data-testid="window">
            a background agent's prompt: answerable here for a few seconds
          </span>
        )}
      </header>
      {question ? (
        <QuestionCard record={record} state={state} member={member} />
      ) : (
        <PermissionCard record={record} state={state} member={member} />
      )}
      {raisedTruncated(record.raised) && (
        <p className="m-0 text-ui-sm text-warning" data-testid="truncated">
          The input shown was capped: the full input was too large to send. A decision binds to what is shown here.
        </p>
      )}
      <StateLine state={state} machine={record.machine} rpc={rpc?.nonce ?? null} me={member} />
    </article>
  );
}

const answerable = (state: CardState) => state.kind === 'open' || state.kind === 'failed';

function PermissionCard({ record, state, member }: { record: RequestRecord; state: CardState; member: string }) {
  const { connection } = useDesk();
  const [reasoning, setReasoning] = useState(false);
  const [message, setMessage] = useState('');
  const decide = (decision: 'allow' | 'deny', text?: string) => void connection.decide(member, record, decision, text?.trim() || undefined);
  return (
    <>
      <ToolPreview request={asPermission(record.raised)} />
      {answerable(state) && (
        <>
          {reasoning && <CardTextarea label="Reason for denying" value={message} onChange={setMessage} onSubmit={() => decide('deny', message)} autoFocus />}
          <Controls>
            {!reasoning && (
              <CardButton onClick={() => setReasoning(true)} className="mr-auto border-transparent text-fg-muted">
                Deny… with a reason
              </CardButton>
            )}
            <CardButton onClick={() => decide('deny', message)}>Deny</CardButton>
            <CardButton tone="primary" onClick={() => decide('allow')}>
              Allow
            </CardButton>
          </Controls>
          <Muted>The decision carries a digest of exactly this request: if it changed, nothing is decided.</Muted>
        </>
      )}
    </>
  );
}

function QuestionCard({ record, state, member }: { record: RequestRecord; state: CardState; member: string }) {
  const { connection } = useDesk();
  const questions = questionsOf(record.raised);
  const asyncQuestion = isAsyncQuestion(record.raised);
  const submit = (answer: RequestAnswer) => {
    if (answer.kind === 'question') void connection.answer(member, record, answer.answers);
    else if (answer.kind === 'permission' && answer.decision !== 'allow' && !asyncQuestion) void connection.decide(member, record, 'deny');
  };
  if (!answerable(state) || questions.length === 0) {
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="question-shown">
        {questions.map((q) => (
          <li key={q.question}>
            <span className="text-fg">{q.question}</span>
            <span className="block text-ui-sm text-fg-muted">{q.options.map((o) => o.label).join(' · ')}</span>
          </li>
        ))}
      </ul>
    );
  }
  const item = { id: `desk:${connection.project}:${record.request}` } as unknown as AttentionItem;
  const request = { kind: 'question.requested', questions } as unknown as Extract<SessionEvent, { kind: 'question.requested' }>;
  return (
    <>
      <QuestionBody item={item} request={request} placement="card" busy={false} submit={submit} bindKeys={() => {}} />
      {!asyncQuestion && (
        <Controls>
          <CardButton className="mr-auto border-transparent text-fg-muted" onClick={() => void connection.decide(member, record, 'deny')}>
            Deny the question
          </CardButton>
        </Controls>
      )}
    </>
  );
}

function StateLine({ state, machine, rpc, me }: { state: CardState; machine: string; rpc: string | null; me: string }) {
  switch (state.kind) {
    case 'open':
      return null;
    case 'uncertain':
      return (
        <>
          {rpc && <RpcStatus nonce={rpc} />}
          {state.offline && (
            <p className="m-0 text-ui-sm text-warning" data-testid="offline">
              {machine} is offline: no new decision until it reconnects
            </p>
          )}
        </>
      );
    case 'sending':
    case 'failed':
    case 'sent':
      return rpc ? <RpcStatus nonce={rpc} /> : null;
    case 'settled':
      return (
        <p className="m-0 text-ui-sm text-fg-muted" data-testid="settled">
          {settledText(state.winner, state.outcome, state.by, me)}
        </p>
      );
    case 'terminal':
      return (
        <p className="m-0 text-ui-sm text-warning" data-testid="terminal-only">
          Waiting in the terminal on {machine}
          {state.why === 'window' ? ': its window for an answer from the web has closed' : ` (${state.why})`}
        </p>
      );
    case 'offline':
      return (
        <p className="m-0 text-ui-sm text-warning" data-testid="offline">
          {machine} is offline: shown, not answerable until it reconnects
        </p>
      );
    case 'closed':
      return <p className="m-0 text-ui-sm text-fg-muted">No longer waiting</p>;
  }
}
