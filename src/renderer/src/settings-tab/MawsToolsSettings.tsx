// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, D4, D11 and §H): Settings › Sessions, the machine's
// default set of MAWS's tools for a new session, after the launch profile's two rows. A new session's intent starts from
// it (on this machine, the composer's and `session.spawn`'s alike); a session keeps its own. Two rows: the four groups,
// each a switch beside its word, whose fact is its tooltip and description (the word cut's rule 5); and the question tool,
// Default (the engine's own) or MAWS's. Documents and Dashboards need Artifacts: turning Artifacts off turns them off and
// greys them, their word saying so, and turning it on turns both on (`withArtifacts`). The set is this machine's spine's
// (`machineSettings.*`, read again whenever the settings change); a spine whose answer carries none predates the choice,
// and neither row is drawn. An edit is made over the newest choice, which a read sent before its write settled never
// takes back (the review of M4).
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@shared/ipc/schema';
import { withArtifacts, type MawsToolSet } from '@shared/maws/tool-set';
import { toast } from '../stores/notices';
import { MAWS_TOOLS } from './copy';
import { chooseMawsTools, readMawsTools } from './maws-tools-default';
import { Segment, Setting, Switch, TipWord, WORD_OWNER } from './parts';

type Group = keyof typeof MAWS_TOOLS.groups;
const GROUPS = Object.keys(MAWS_TOOLS.groups) as Group[];
const QUESTION_TOOLS = (['engine', 'maws'] as const).map((value) => ({ value, label: MAWS_TOOLS.questionTools[value] }));
const NEEDS_ARTIFACTS: readonly Group[] = ['documents', 'dashboards'];

export function MawsToolsSettings({ settings }: { settings: Settings }) {
  // The spine's set, read again whenever the settings change (main publishes a change of the machine half, a set-only one
  // included); each read numbered when it is sent, a superseded one's answer dropped.
  const sent = useRef(0);
  const [held, setHeld] = useState<{ set: MawsToolSet | null; read: number } | null>(null);
  useEffect(() => {
    let live = true;
    const read = ++sent.current;
    void readMawsTools().then((set) => live && setHeld({ set, read }));
    return () => {
      live = false;
    };
  }, [settings]);
  // The newest choice, the base of the next edit: while its write is out (`settled` null) no read takes it back, and once
  // it settled (the set its answer holds) only a read sent after that does, since one sent before may answer the set as
  // it was before the write. Writes go out in the order made and the spine takes them in that order.
  const [local, setLocal] = useState<{ set: MawsToolSet; settled: number | null } | null>(null);
  if (local !== null && local.settled !== null && held !== null && held.read > local.settled) setLocal(null);
  const latest = useRef(0);
  if (held === null || held.set === null) return null;
  const shown = local?.set ?? held.set;
  const write = async (next: MawsToolSet) => {
    const mine = ++latest.current;
    setLocal({ set: next, settled: null });
    const answer = await chooseMawsTools(next);
    if (!answer.ok) toast({ level: 'warning', text: answer.error, actions: [], dismissible: true });
    if (mine === latest.current) setLocal(answer.ok ? { set: answer.set, settled: sent.current } : null);
  };
  const toggle = (group: Group, on: boolean) => void write(group === 'artifacts' ? withArtifacts(shown, on) : { ...shown, [group]: on });
  return (
    <>
      <Setting row="sessions.tools">
        {GROUPS.map((group) => {
          const greyed = NEEDS_ARTIFACTS.includes(group) && !shown.artifacts;
          const { word, fact } = MAWS_TOOLS.groups[group];
          return (
            <span key={group} className="inline-flex items-center gap-1.5">
              <Switch checked={shown[group]} label={word} disabled={greyed} onChange={(on) => toggle(group, on)} />
              <TipWord tip={greyed ? MAWS_TOOLS.needsArtifacts : fact}>
                <span tabIndex={0} className={`${greyed ? 'text-fg-muted' : 'text-fg'} ${WORD_OWNER}`}>
                  {word}
                </span>
              </TipWord>
            </span>
          );
        })}
      </Setting>
      <Setting row="sessions.question">
        <Segment label={MAWS_TOOLS.question} value={shown.question} options={QUESTION_TOOLS} onChange={(question) => write({ ...shown, question })} />
      </Setting>
    </>
  );
}
