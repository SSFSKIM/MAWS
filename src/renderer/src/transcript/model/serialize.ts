// rows → markdown, for "Copy turn as markdown" and the copy actions (C6 execution document, residue *Copy and export*).
// One part per row (a group is one part with its cells as a nested list), joined by blank lines; user text is emitted
// untagged (pasted bodies in place of their placeholders); answer markdown is emitted verbatim.
import { bashFooter, bashHeader, COMMAND_LINE, commandLead, dividerCopy, NOT_SENT, planBadge, plural, QUESTION, requestSlotPlaceholder } from './copy';
import { ASK, askAnswerCopy, askQuestionTitle, askStateCopy, askStateWhy, deliveryHeading } from './copy'; // E1
import { agentListCopy, messageArrow } from './copy'; // E7
import { messageMore } from './rows'; // E7; UX wave U3
import { artifactHeading } from './copy'; // E2
import { BROWSER_ACTION, browserActionError, browserActionHeading, took } from './copy'; // E4c
import { browserActivityLine } from './copy'; // E13
import { CONSENT, noticeLine } from './copy'; // UX wave U3
import { SHEET_ROW, sheetHead } from './copy'; // the question sheet's C3 M5
import type { Cell, Row, SheetRowLine } from './rows';
import { copiedUserText } from './user-text';
import { SIDE_COPY, sideRowStatus } from '../../side/copy'; // E3

const indent = (text: string, by: string) => text.split('\n').map((line) => `${by}${line}`).join('\n');
// Inline code that holds any text: a fence one backtick longer than the text's longest run, padded where the text meets it
// with a backtick.
function inlineCode(text: string): string {
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function cellLines(cell: Cell, by: string): string[] {
  const lines = [`${by}- ${cell.label}`];
  const inner = `${by}  `;
  const detail = cell.detail;
  if (detail.kind === 'shell' && cell.status !== 'denied' && cell.status !== 'stopped') {
    const body = [`$ ${detail.command}`, detail.stdout, detail.stderr].filter((part) => part.length > 0).join('\n');
    lines.push(indent(`\`\`\`\n${body}\n\`\`\``, inner));
  } else if (detail.kind === 'thinking' && detail.text.length > 0) lines.push(indent(detail.text, `${inner}> `));
  return lines;
}

function partOf(row: Row): string | null {
  switch (row.kind) {
    case 'time': return `### ${row.label}`;
    case 'user': return row.consent ? `*${CONSENT.approved} ${inlineCode(row.consent.subject)}*` /* UX wave U3: the person's act, one line */ : `**You**\n\n${copiedUserText(row)}${row.dropped ? `\n\n*${NOT_SENT}*` : ''}`;
    case 'assistant_text': return row.markdown;
    case 'divider': return `*${dividerCopy({ ...row, durationMs: row.summary.durationMs ?? Date.parse(row.endedAt ?? row.startedAt) - Date.parse(row.startedAt) })}*`;
    case 'group': return [`- ${row.summary}`, ...row.cells.flatMap((cell) => cellLines(cell, '  '))].join('\n');
    case 'cell': return cellLines(row, '').join('\n');
    case 'receipt': return [`**${plural(row.files.length, 'file')} changed · +${row.added} −${row.removed}**`, ...row.files.map((file) => `- ${file.path} (+${file.added} −${file.removed})`)].join('\n');
    case 'subagent': return subagentPart(row); // the word cut (T87): a working workflow's phase, which nothing points at here
    case 'agent_message': return messagePart(row); // E7: the body or report under the line when it shows more
    case 'thinking': return row.text.length > 0 ? `*${row.live ? 'Thinking' : 'Thought'}*\n${indent(row.text, '> ')}` : null;
    case 'plan': return `**Plan · ${planBadge(row.outcome, row.feedback)}**\n\n${row.plan}`;
    case 'question': return row.questions.map((q) => `**${q.header}** ${q.question}: ${row.answers?.[q.question] ?? (row.dismissed === true || (row.answers !== null && Object.keys(row.answers).length === 0) ? QUESTION.dismissed : '—')}`).join('\n'); // UX wave U1b (decision 10): dismissed, or declined whole (a plain deny's empty map)
    case 'sheet': return sheetPart(row); // the question sheet's C3 M5: its head line, then a line per entry as the row reads it from the transcript
    case 'request_slot': return `*${requestSlotPlaceholder(row.toolName ?? row.requestKind)}*`;
    case 'error': return `*${row.text}*`;
    case 'boundary': return `---\n*${row.text}*`;
    case 'gap': return `---\n*${row.text}*`; // P5 O7 M2
    case 'bash': return `\`\`\`\n${[bashHeader(row.command), row.stdout, row.stderr, bashFooter(row.exitCode)].filter((part) => part.length > 0).join('\n')}\n\`\`\``;
    case 'notice': return row.detail === null ? `*${noticeLine(row)}*` : `*${noticeLine(row)}*\n${indent(row.detail, '> ')}`; // UX wave U3: its line, then what opens under it
    case 'local_command': return `${COMMAND_LINE.mark} ${row.lone && row.run ? commandLead(row.run) : ''}${row.text}`; // UX wave U3b: its line
    // E1 start
    case 'ask': return [askLine(row), ...(row.answers === null ? [] : row.questions.map((q) => `- ${askQuestionTitle(q)}: ${askAnswerCopy(row.answers?.find((a) => a.id === q.id))}`))].join('\n');
    case 'delivery': return [`**${deliveryHeading(row)}**${row.caption ? ` · ${row.caption}` : ''}`, ...row.files.map((file) => `- ${file.path}`), ...(row.error === null ? [] : [`*${row.error}*`])].join('\n');
    // E1 end
    case 'side_thread': return `*${SIDE_COPY.row.lead} \`${SIDE_COPY.label(row.label, row.openedBy)}\` ${sideRowStatus(row)}*`; // E3
    case 'agent_list': return listPart(row); // E7
    case 'artifact': return `**${artifactHeading(row)}**`; // E2
    case 'browser_action': return browserActionPart(row); // E4c
    case 'browser_activity': return `- ${browserActivityLine(row.activity)}`; // E13
    case 'record_fold': return null; // UX wave U2b: the to-human view's own line; the copy is the transcript's
    case 'to_human': return `<message>${row.text}</message>`; // P4-R7: as the span it stands in for copies, verbatim
    case 'activity': return null; // UX wave U3b (decision 17): what the session does now, no part of what it said
  }
}

// The question sheet's C3 M5: a sheet call's head line and its lines, each its id (a refused entry's number), its
// header, and its question's sentence or, after the outcome, its receipt; then why an entry was not done.
function sheetPart(row: Extract<Row, { kind: 'sheet' }>): string {
  const line = (line: SheetRowLine): string => {
    const id = line.id ?? (line.place === 'refused' ? String(line.entry) : null);
    const lead = [id, line.header === null ? null : `**${line.header}**`].filter((part) => part !== null).join(' ');
    const after = line.place === 'revised_below' ? SHEET_ROW.revisedBelow
      : line.place === 'refused' ? `${line.sentence} — ${SHEET_ROW.notAsked}`
      : line.outcome === null ? line.sentence
      : `${SHEET_ROW.arrow} ${line.outcome.how === 'answered' ? line.outcome.receipt : line.outcome.how === 'dismissed' ? SHEET_ROW.dismissed : SHEET_ROW.withdrawn}`;
    return `- ${lead === '' ? '' : `${lead} `}${after}`;
  };
  return [sheetHead(row), ...row.lines.map(line), ...(row.notDone === null ? [] : [`*${row.notDone}*`]), ...(row.error === null ? [] : [`*${row.error}*`])].join('\n');
}

// A subagent row's line, with each working workflow's phase written out where the view keeps it for pointing (fix wave,
// scalpel-1#2): beside the sentence for a row of one call, else one nested line per workflow, named.
function subagentPart(row: Extract<Row, { kind: 'subagent' }>): string {
  const phases = row.agents.flatMap((ref) => {
    const phase = row.phases?.[ref.taskId];
    return phase === undefined ? [] : [{ name: ref.name, phase }];
  });
  if (phases.length === 0) return `- ${row.sentence}`;
  if (row.agents.length === 1) return `- ${row.sentence} · ${phases[0]!.phase}`;
  return [`- ${row.sentence}`, ...phases.map(({ name, phase }) => `  - ${name} · ${phase}`)].join('\n');
}

// E1 (the word cut, T93, T94, T97): an ask's line as its capsule reads it, its title (else its count) first; the why
// its chip keeps for the pointer is written out, where nothing points
function askLine(row: Extract<Row, { kind: 'ask' }>): string {
  const count = ASK.count(row.questions.length);
  const why = askStateWhy(row);
  const state = why === null ? askStateCopy(row) : `${askStateCopy(row)}, ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
  return [row.title === null ? `**${count}**` : `**${row.title}** · ${count}`, state].join(' · ');
}

// E7 start: a message's line, then its whole body (a message whose line shows only its first line) or a hand-back's
// report, quoted; a listing as its counts, a pending one as such, one the parser did not read as its notes. The word cut
// (T73): a message leads with the arrow of its direction, as its line does.
function messagePart(row: Extract<Row, { kind: 'agent_message' }>): string {
  const more = messageMore(row);
  const arrow = messageArrow(row);
  const line = arrow === null ? row.text : `${arrow} ${row.text}`;
  return more === null ? `- ${line}` : `- ${line}\n${indent(more, '  > ')}`;
}

function listPart(row: Extract<Row, { kind: 'agent_list' }>): string {
  if (row.pending) return `- ${agentListCopy.pending}`;
  if (row.neverAnswered) return `- ${agentListCopy.neverAnswered}`; // E11
  if (row.sections.length === 0) return `- Agents: ${row.notes.join(' ')}`;
  const count = (title: string) => row.sections.find((section) => section.title === title)?.count ?? 0;
  return `- ${agentListCopy.serialized(count('Subagents'), count('Teammates'), count('Peer sessions'))}`;
}
// E7 end

// E4c start: a browser action as its line, its time once done (or that it was cancelled), and a refusal's reason under it
function browserActionPart(row: Extract<Row, { kind: 'browser_action' }>): string {
  const tail = row.state === 'done' && row.ms !== null ? ` · ${took(row.ms)}` : row.state === 'cancelled' ? ` · ${BROWSER_ACTION.cancelled}` : '';
  const line = `- ${browserActionHeading(row)}${tail}`;
  return row.state === 'error' && row.error !== null ? `${line}\n  *${browserActionError(row.error)}*` : line;
}
// E4c end

export function serializeRows(rows: Row[]): string {
  return rows.map(partOf).filter((part): part is string => part !== null).join('\n\n');
}
