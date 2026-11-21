// A shell call's detail, after mockup 02: the command, its cwd, the output bounded with a fade, and a footer with the
// exit status, plus Open full log (C8's) when the output was cut or spilled. A spilled result offers to load the whole
// output in place of the wire preview. The word cut (T18): the copy controls are glyphs named by their words: Copy all
// in the footer, and Copy command and Copy output beside what they copy, shown on pointing or with focus inside (T20: the
// session's own folder is not named; T22: a successful exit reads its time alone).
import { sameFile } from '../../../tools/code/files/tree';
import { truncationOf } from '../../model/cells';
import { DETAIL, shellFooter } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useActions, useDisclosure, useTranscriptContext } from '../context';
import { CopyGlyph } from '../rows/parts';
import { spilledOr, SpillLoader } from './Spill';
import { Truncated } from './Truncated';

type Shell = Extract<CellDetail, { kind: 'shell' }>;

const durationOf = (cell: Cell) => (cell.endedAt === null ? 0 : Date.parse(cell.endedAt) - Date.parse(cell.startedAt));

// The call's folder: its input's when that names one (the engine's Bash input does not), else, UX wave U8c-2 (§K), the
// folder a call read from rows carries from its row; a live call with neither names none, never a folder its command
// may not have run in. The word cut (T20): the session's own folder is where a command runs by default, so it is not
// named: the folder the slot hands down (the launch folder, handed down only while the session is in it) or the agent's
// folder, compared as Files compares a listed root with a record's folder.
function folderLine(detail: Shell, directory: string | null, agentCwd: string | null): { label: string; path: string } | null {
  const folder = detail.cwd || detail.rowCwd;
  if (!folder) return null;
  const ranThere = directory !== null && (sameFile(folder, directory) || (agentCwd !== null && sameFile(folder, agentCwd)));
  return ranThere ? null : { label: DETAIL.cwd, path: folder };
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
        <CopyGlyph label={DETAIL.copyCommand} text={detail.command} onHover />
      </div>
      {longCommand && <button type="button" aria-expanded={fullCommand} onClick={toggleCommand}>{fullCommand ? DETAIL.showLess : DETAIL.showMore}</button>}
      {where && (
        <div className="transcript-shell-meta">
          {where.label} <span className="transcript-mono">{where.path}</span>
        </div>
      )}
      {output.length > 0 && (
        <div className="transcript-shell-output">
          <pre className="transcript-output transcript-output-faded">
            <Truncated text={stdout} />
            {detail.stderr && (
              <span className="transcript-stderr">
                {stdout ? '\n' : ''}
                <Truncated text={detail.stderr} />
              </span>
            )}
          </pre>
          <CopyGlyph label={DETAIL.copyOutput} text={output} onHover />
        </div>
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
          <CopyGlyph label={DETAIL.copyAll} text={all} />
        </span>
      </div>
    </div>
  );
}
