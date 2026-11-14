// A shell call's detail, after mockup 02: the command with Copy command, its cwd, the output bounded with a fade, and
// a footer with the exit status, Copy output and Copy all, plus Open full log (C8's) when the output was cut or spilled.
// A spilled result offers to load the whole output in place of the wire preview.
import { sameFile } from '../../../tools/code/files/tree';
import { truncationOf } from '../../model/cells';
import { DETAIL, shellFooter } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useActions, useDisclosure, useTranscriptContext } from '../context';
import { copyText } from '../rows/parts';
import { spilledOr, SpillLoader } from './Spill';
import { Truncated } from './Truncated';

type Shell = Extract<CellDetail, { kind: 'shell' }>;

const durationOf = (cell: Cell) => (cell.endedAt === null ? 0 : Date.parse(cell.endedAt) - Date.parse(cell.startedAt));

// The call's own cwd when its input names one (the engine's Bash input does not). Else the session's directory,
// labelled as such (a `cd` inside an earlier command may have moved the shell since), where one is handed down: the
// slot hands down the launch folder and the agent's folder only while the session is in its launch folder. UX wave
// U8c-2 (§K): a call read from rows carries the folder its row records, and names it unless it is one of those two,
// compared as Files compares a listed root with a record's folder; a call with no folder and nothing handed down names
// none, so a live row never names a folder its command may not have run in.
function folderLine(detail: Shell, directory: string | null, agentCwd: string | null): { label: string; path: string } | null {
  if (detail.cwd) return { label: DETAIL.cwd, path: detail.cwd };
  const session = directory ? { label: DETAIL.sessionDirectory, path: directory } : null;
  const row = detail.rowCwd;
  if (row === undefined) return session;
  const ranThere = session !== null && (sameFile(row, session.path) || (agentCwd !== null && sameFile(row, agentCwd)));
  return ranThere ? session : { label: DETAIL.cwd, path: row };
}

export function ShellDetail({ cell, detail }: { cell: Cell; detail: Shell }) {
  const actions = useActions();
  const [fullCommand, toggleCommand] = useDisclosure(`command:${cell.id}`);
  const longCommand = detail.command.split('\n').length > 8 || detail.command.length > 800;
  const { sessionDirectory, sessionCwd } = useTranscriptContext();
  const where = folderLine(detail, sessionDirectory ?? null, sessionCwd ?? null);
  const stdout = spilledOr(detail.spill, detail.stdout); // the whole result once the reader loaded the spill
  const output = [stdout, detail.stderr].filter((part) => part.length > 0).join('\n');
  const footer = cell.status === 'done' || cell.status === 'error' || cell.status === 'stopped' ? shellFooter(cell.status, detail.exitCode, durationOf(cell)) : null;
  const all = [`$ ${detail.command}`, where ? `${where.label} ${where.path}` : null, output, footer].filter((part) => part !== null && part.length > 0).join('\n');
  return (
    <div className="transcript-shell">
      <div className="transcript-shell-heading">
        <code className="transcript-shell-command" data-bounded={longCommand && !fullCommand ? '' : undefined}>$ {detail.command}</code>
        <button type="button" onClick={() => copyText(detail.command)}>
          {DETAIL.copyCommand}
        </button>
      </div>
      {longCommand && <button type="button" aria-expanded={fullCommand} onClick={toggleCommand}>{fullCommand ? 'Show less command' : 'Show more command'}</button>}
      {where && (
        <div className="transcript-shell-meta">
          {where.label} <span className="transcript-mono">{where.path}</span>
        </div>
      )}
      {output.length > 0 && (
        <pre className="transcript-output transcript-output-faded">
          <Truncated text={stdout} />
          {detail.stderr && (
            <span className="transcript-stderr">
              {stdout ? '\n' : ''}
              <Truncated text={detail.stderr} />
            </span>
          )}
        </pre>
      )}
      {detail.spill && <SpillLoader cell={cell} spill={detail.spill} />}
      <div className="transcript-shell-footer">
        <span>{footer}</span>
        <span>
          {(detail.truncated || truncationOf(detail.stderr) || detail.spill) && (
            <button type="button" onClick={() => actions.openFullLog(cell)}>
              {DETAIL.openFullLog}
            </button>
          )}
          <button type="button" onClick={() => copyText(output)}>
            {DETAIL.copyOutput}
          </button>
          <button type="button" onClick={() => copyText(all)}>
            {DETAIL.copyAll}
          </button>
        </span>
      </div>
    </div>
  );
}
