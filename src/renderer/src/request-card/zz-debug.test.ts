import { it } from 'vitest';
import { askSteerText, parseAskSteer } from '@shared/maws/ask';
import { turnActivity } from '../transcript/model/activity';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import { builder } from '../transcript/model/test-events';
import { initiatingPrompt, opensWithoutPrompt } from './initiating-prompt';
it('debug', () => {
  const t = askSteerText('toolu_answer_alone', [{ id: 'q1', question: 'Which layout?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] }], [{ id: 'q1', question: 'Which layout?', status: 'answered', value: ['Grid'] }]);
  console.log('PARSE', parseAskSteer(t) !== null);
  const b = builder(); b.turn('u-1', 'an earlier prompt'); b.end(['u-1']); b.turn('u-2', t);
  const s = applyEvents(createState(null, null), b.events);
  const rows = rowsOf(s);
  console.log('ROWS', JSON.stringify(rows.map((r) => [r.kind, r.turnId, (r as { editable?: boolean }).editable])), JSON.stringify(turnActivity(s).map((a) => [a.turnId, a.origin])), opensWithoutPrompt(rows, turnActivity(s)), initiatingPrompt(rows, turnActivity(s))?.messageUuid);
});
