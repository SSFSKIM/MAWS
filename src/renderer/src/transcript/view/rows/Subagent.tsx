// A subagent row (residue *Subagent rows*): up to four glyphs, then `+N`, and the lifecycle sentence; while agents
// work, one detail line each (`{name} · {lastTool} · {t}`) updated from the child's own events, which are never
// rendered in the parent. With C8's `openSubagent` supplied, a one-agent row is a button and each glyph of a grouped
// row opens its agent (past four, through `+N`). Each child's status is its own: a failed child drops its detail line
// while the others keep ticking.
import { useTranscriptStore, workingDurationMs } from '../../../stores/transcript';
import { subagentActivity } from '../../model/activity';
import { subagentDetail } from '../../model/copy';
import type { Row, SubagentRef } from '../../model/rows';
import { NO_ACTIONS, useDisclosure, useTranscriptContext } from '../context';
import { useTicker } from './parts';

type SubagentRowData = Extract<Row, { kind: 'subagent' }>;

// Eight marks in the UI font, chosen by the model's hash of the task id (`SubagentRef.glyph`).
const GLYPHS = ['✻', '❋', '✿', '✦', '❖', '✺', '✹', '❉'];
const SHOWN = 4;
const DONE = new Set<SubagentRowData['status']>(['finished', 'finished_with_errors', 'stopped']);

function Glyph({ agent, open }: { agent: SubagentRef; open: ((ref: SubagentRef) => void) | null }) {
  const mark = GLYPHS[agent.glyph % GLYPHS.length];
  if (!open) return <span>{mark}</span>;
  return (
    <button type="button" className="transcript-glyph" aria-label={`Open ${agent.name}`} title={agent.name} onClick={() => open(agent)}>
      {mark}
    </button>
  );
}

// The first four glyphs, then `+N`: with `open`, every glyph opens its agent and `+N` reveals the rest as glyphs too,
// so each child of a large group has a route to the Subagents tool.
function Glyphs({ rowId, agents, overflow, open }: { rowId: string; agents: SubagentRef[]; overflow: number; open: ((ref: SubagentRef) => void) | null }) {
  const [more, toggleMore] = useDisclosure(`agents:${rowId}`);
  return (
    <span className="transcript-glyphs" data-glyphs="" aria-hidden={open ? undefined : true}>
      {agents.slice(0, SHOWN).map((ref) => (
        <Glyph key={ref.taskId} agent={ref} open={open} />
      ))}
      {overflow > 0 &&
        (open ? (
          <button type="button" className="transcript-glyph-overflow" aria-expanded={more} aria-label={`+${overflow} more agents`} onClick={toggleMore}>
            +{overflow}
          </button>
        ) : (
          <span className="transcript-glyph-overflow">+{overflow}</span>
        ))}
      {open && more && agents.slice(SHOWN).map((ref) => <Glyph key={ref.taskId} agent={ref} open={open} />)}
    </span>
  );
}

export function SubagentRow({ row }: { row: SubagentRowData }) {
  const { storeKey, actions } = useTranscriptContext();
  const turn = useTranscriptStore((state) => (row.turnId === null ? undefined : state.entries[storeKey]?.state.turns.get(row.turnId)));
  const working = !DONE.has(row.status);
  const now = useTicker(working);
  const open = actions.openSubagent === NO_ACTIONS.openSubagent ? null : actions.openSubagent;
  const details =
    working && turn
      ? row.agents.flatMap((ref) => {
          const activity = subagentActivity(turn, ref);
          if (activity.finished) return [];
          return [{ ref, text: subagentDetail(ref.name, activity.lastTool, workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.at, now)) }];
        })
      : [];
  const single = open && row.agents.length === 1 ? row.agents[0] : null;
  const line = (
    <>
      <Glyphs rowId={row.id} agents={row.agents} overflow={row.overflow} open={open && !single ? open : null} />
      <span className="transcript-subagent-sentence">{row.sentence}</span>
    </>
  );
  return (
    <div className="transcript-subagent" data-status={row.status}>
      {single ? (
        <button type="button" className="transcript-subagent-line" onClick={() => open!(single)}>
          {line}
        </button>
      ) : (
        <div className="transcript-subagent-line">{line}</div>
      )}
      {details.map(({ ref, text }) => (
        <div key={ref.taskId} className="transcript-subagent-detail" data-agent-detail="">
          {text}
        </div>
      ))}
    </div>
  );
}
