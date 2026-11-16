// Builds the two invented ask envelopes with the repository's own askSteerText (src/shared/maws/ask.ts), as
// src/engine-host/session-maws.ts answerAsk passes them to steer (priority next). Writes them as JSON to argv[2].
import { writeFileSync } from 'node:fs';
import { askSteerText, parseAskSteer } from '../../../../../src/shared/maws/ask';
const single = askSteerText('uxw-ask-single-1',
  [{ id: 'q1', question: 'Which fruit should the demo use?', header: 'Fruit', modality: 'choice', options: [{ label: 'Apple' }, { label: 'Mango' }] }] as never,
  [{ id: 'q1', question: 'Which fruit should the demo use?', status: 'answered', value: ['Mango'] }] as never);
const multi = askSteerText('uxw-ask-multi-1',
  [{ id: 'q1', question: 'What should the banner say?', header: 'Banner', modality: 'text' }] as never,
  [{ id: 'q1', question: 'What should the banner say?', status: 'answered', value: 'Line one of the banner\nLine two of the banner', note: 'Keep both lines short.' }] as never);
writeFileSync(process.argv[2], JSON.stringify({ single, multi, parsesSingle: parseAskSteer(single) !== null, parsesMulti: parseAskSteer(multi) !== null }, null, 1));
