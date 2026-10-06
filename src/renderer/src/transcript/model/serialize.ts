// rows → markdown, for "Copy turn as markdown" and the copy actions (C6 execution document, residue *Copy and export*).
// One part per row (a group is one part with its cells as a nested list), joined by blank lines; user text is emitted
// untagged (pasted bodies in place of their placeholders); answer markdown is emitted verbatim.
import { bashFooter, bashHeader, dividerCopy, LOCAL_COMMAND_HEADER, NOT_SENT, planBadge, plural, QUESTION, requestSlotPlaceholder } from './copy';
import { ASK, askAnswerCopy, DELIVERY } from './copy'; // E1
import { artifactHeading } from './copy'; // E2
import type { Cell, Row } from './rows';
import { untaggedUserText } from './user-text';
import { SIDE_COPY, sideRowStatus } from '../../side/copy'; // E3

const indent = (text: string, by: string) => text.split('\n').map((line) => `${by}${line}`).join('\n');

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
    case 'user': return `**You**\n\n${untaggedUserText(row.text, row.attachments, row.placeholders)}${row.dropped ? `\n\n*${NOT_SENT}*` : ''}`;
    case 'assistant_text': return row.markdown;
    case 'divider': return `*${dividerCopy({ ...row, durationMs: row.summary.durationMs ?? Date.parse(row.endedAt ?? row.startedAt) - Date.parse(row.startedAt) })}*`;
    case 'group': return [`- ${row.summary}`, ...row.cells.flatMap((cell) => cellLines(cell, '  '))].join('\n');
    case 'cell': return cellLines(row, '').join('\n');
    case 'receipt': return [`**${plural(row.files.length, 'file')} changed · +${row.added} −${row.removed}**`, ...row.files.map((file) => `- ${file.path} (+${file.added} −${file.removed})`)].join('\n');
    case 'subagent': return `- ${row.sentence}`;
    case 'agent_message': return `- ${row.text}`;
    case 'thinking': return row.text.length > 0 ? `*${row.live ? 'Thinking' : 'Thought'}*\n${indent(row.text, '> ')}` : null;
    case 'plan': return `**Plan · ${planBadge(row.outcome, row.feedback)}**\n\n${row.plan}`;
    case 'question': return row.questions.map((q) => `**${q.header}** ${q.question}: ${row.answers?.[q.question] ?? (row.answers !== null && Object.keys(row.answers).length === 0 ? QUESTION.skipped : '—')}`).join('\n'); // an empty answer map: skipped (a plain deny)
    case 'request_slot': return `*${requestSlotPlaceholder(row.toolName ?? row.requestKind)}*`;
    case 'error': return `*${row.text}*`;
    case 'boundary': return `---\n*${row.text}*`;
    case 'bash': return `\`\`\`\n${[bashHeader(row.command), row.stdout, row.stderr, bashFooter(row.exitCode)].filter((part) => part.length > 0).join('\n')}\n\`\`\``;
    case 'local_command': return `*${LOCAL_COMMAND_HEADER}*\n${row.text}`;
    // E1 start
    case 'ask': return [`**${row.title ?? ASK.title}** · ${ASK.count(row.questions.length)} · ${row.state === 'error' ? (row.error ?? '') : ASK.state[row.state]}`, ...(row.answers === null ? [] : row.questions.map((q) => `- ${q.header ?? q.question}: ${askAnswerCopy(row.answers?.find((a) => a.id === q.id))}`))].join('\n');
    case 'delivery': return [`**${(row.error === null ? DELIVERY.delivered : DELIVERY.failed)(row.files)}**${row.caption ? ` · ${row.caption}` : ''}`, ...row.files.map((file) => `- ${file.path}`), ...(row.error === null ? [] : [`*${row.error}*`])].join('\n');
    // E1 end
    case 'side_thread': return `*${SIDE_COPY.row.lead} \`${SIDE_COPY.label(row.label, row.openedBy)}\` ${sideRowStatus(row)}*`; // E3
    case 'artifact': return `**${artifactHeading(row)}**`; // E2
  }
}

export function serializeRows(rows: Row[]): string {
  return rows.map(partOf).filter((part): part is string => part !== null).join('\n\n');
}
