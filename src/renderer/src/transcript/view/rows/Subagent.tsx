// A subagent row (residue *Subagent rows*): up to four glyphs, then `+N`, and the agents' descriptions. With C8's
// `openSubagent` supplied, a one-agent row is a button and each glyph of a grouped row opens its agent (past four,
// through `+N`). Each child's status is its own. The word cut (T86, T87; the owner's ruling): a spinner before the glyphs
// while any agent works, then the descriptions the parent gave at spawn and nothing else at rest; what each working
// agent is doing and for how long (`{name} · {lastTool} · {t}`, updated from the child's own events, which are never
// rendered in the parent; a workflow's phase in its tool's place) is the tooltip and the description of what stands for
// it: its glyph in a grouped row, the line of a one-agent row, and the line's words where nothing opens an agent. A
// failed child's goes while the others keep ticking. The touch rule (ticket 830): where nothing points, the details
// whose owners are drawn stand under the line, one a line: in a grouped row the drawn glyphs' (past four, the rest once
// `+N` opens them), else every working agent's, which the line or its words carry.
import { ticks, useTranscriptStore, workingDurationMs } from '../../../stores/transcript';
import { useDisclosureMotion } from '../../../ui/disclosure';
import { Tip } from '../../../ui/tip';
import { TouchFact } from '../../../ui/touch-fact';
import { subagentActivity } from '../../model/activity';
import { SUBAGENT_WORKING, subagentDetail } from '../../model/copy';
import { SUBAGENT_GLYPHS } from '../../model/glyphs';
import type { Row, SubagentRef } from '../../model/rows';
import { NO_ACTIONS, useDisclosure, useTranscriptContext } from '../context';
import { useTicker } from './parts';

type SubagentRowData = Extract<Row, { kind: 'subagent' }>;

// A child's glyph as its row shows it (one of the eight marks, by the model's hash of the task id), exported so C8's
// summary shows the same mark.
export function SubagentGlyph({ agent, className }: { agent: SubagentRef; className?: string }) {
  return <span className={className}>{SUBAGENT_GLYPHS[agent.glyph % SUBAGENT_GLYPHS.length]}</span>;
}
const SHOWN = 4;
const DONE = new Set<SubagentRowData['status']>(['finished', 'finished_with_errors', 'stopped']);

// What each working agent is doing, by task id; an agent that has ended has none.
type Details = ReadonlyMap<string, string>;

// A glyph that opens its agent: what the agent is doing its tooltip while it works, else its name.
function Glyph({ agent, detail, open }: { agent: SubagentRef; detail: string | undefined; open: ((ref: SubagentRef) => void) | null }) {
  const mark = SUBAGENT_GLYPHS[agent.glyph % SUBAGENT_GLYPHS.length];
  if (!open) return <SubagentGlyph agent={agent} />;
  return (
    <Tip content={detail ?? agent.name} description={detail}>
      <button type="button" className="transcript-glyph" aria-label={`Open ${agent.name}`} onClick={() => open(agent)}>
        {mark}
      </button>
    </Tip>
  );
}

// The first four glyphs, then `+N`: with `open`, every glyph opens its agent and `+N` reveals the rest as glyphs too,
// so each child of a large group has a route to the Subagents tool.
function Glyphs({ rowId, agents, overflow, details, open }: { rowId: string; agents: SubagentRef[]; overflow: number; details: Details; open: ((ref: SubagentRef) => void) | null }) {
  const [more, toggleMore] = useDisclosure(`agents:${rowId}`);
  return (
    <span className="transcript-glyphs" data-glyphs="" aria-hidden={open ? undefined : true}>
      {agents.slice(0, SHOWN).map((ref) => (
        <Glyph key={ref.taskId} agent={ref} detail={details.get(ref.taskId)} open={open} />
      ))}
      {overflow > 0 &&
        (open ? (
          <button type="button" className="transcript-glyph-overflow" aria-expanded={more} aria-label={`+${overflow} more agents`} onClick={toggleMore}>
            +{overflow}
          </button>
        ) : (
          <span className="transcript-glyph-overflow">+{overflow}</span>
        ))}
      {open && <MoreGlyphs more={more} agents={agents.slice(SHOWN)} details={details} open={open} />}
    </span>
  );
}

// Board ticket 850: the glyphs `+N` reveals come and go through the shared disclosure motion. They stand on the line, so
// its height does not move; they fade in lifted and fade out, and are drawn until their close has run.
function MoreGlyphs({ more, agents, details, open }: { more: boolean; agents: SubagentRef[]; details: Details; open: (ref: SubagentRef) => void }) {
  const { ref, mounted } = useDisclosureMotion<HTMLSpanElement>(more);
  if (!mounted || agents.length === 0) return null;
  return (
    <span ref={ref} className="transcript-glyphs-more" data-glyphs-more="">
      {agents.map((agent) => (
        <Glyph key={agent.taskId} agent={agent} detail={details.get(agent.taskId)} open={open} />
      ))}
    </span>
  );
}

export function SubagentRow({ row }: { row: SubagentRowData }) {
  const { storeKey, actions } = useTranscriptContext();
  const turn = useTranscriptStore((state) => (row.turnId === null ? undefined : state.entries[storeKey]?.state.turns.get(row.turnId)));
  const working = !DONE.has(row.status);
  const live = useTranscriptStore((state) => ticks(state, storeKey));
  const now = useTicker(working && live);
  const open = actions.openSubagent === NO_ACTIONS.openSubagent ? null : actions.openSubagent;
  const details = new Map<string, string>();
  if (working && turn) {
    const elapsed = workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.at, now, live);
    for (const ref of row.agents) {
      const activity = subagentActivity(turn, ref);
      if (!activity.finished) details.set(ref.taskId, subagentDetail(ref.name, row.phases?.[ref.taskId] ?? activity.lastTool, elapsed));
    }
  }
  const single = open && row.agents.length === 1 ? row.agents[0] : null;
  const all = details.size === 0 ? null : [...details.values()].join('\n');
  const [more] = useDisclosure(`agents:${row.id}`); // the glyphs' `+N`, whose agents' glyphs are drawn only while it is open
  const drawnGlyphs = open && !single ? (more ? row.agents : row.agents.slice(0, SHOWN)) : null;
  const owned = drawnGlyphs === null ? all : drawnGlyphs.flatMap((ref) => details.get(ref.taskId) ?? []).join('\n');
  const line = (
    <>
      {working && <span role="img" aria-label={SUBAGENT_WORKING} className="transcript-subagent-ring" />}
      <Glyphs rowId={row.id} agents={row.agents} overflow={row.overflow} details={details} open={open && !single ? open : null} />
      {open === null && all !== null ? (
        // nothing here opens an agent: the words take the keyboard for what waits on them
        <Tip content={<span className="whitespace-pre-line">{all}</span>} description={all}>
          <span className="transcript-subagent-sentence" tabIndex={0}>
            {row.sentence}
          </span>
        </Tip>
      ) : (
        <span className="transcript-subagent-sentence">{row.sentence}</span>
      )}
    </>
  );
  const detail = single ? details.get(single.taskId) : undefined;
  return (
    <div className="transcript-subagent" data-status={row.status}>
      {single ? (
        <Tip content={detail} description={detail}>
          <button type="button" className="transcript-subagent-line" onClick={() => open!(single)}>
            {line}
          </button>
        </Tip>
      ) : (
        <div className="transcript-subagent-line">{line}</div>
      )}
      <TouchFact block className="text-ui-sm">
        {owned}
      </TouchFact>
    </div>
  );
}
