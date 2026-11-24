// Invented questions for the sheet's suites and the harness's card states (frame 2's q4, frame 1's q5 to q7).
import type { SheetModel, SheetQuestion } from '@shared/sheet/model';
import { TEXT_REFERENCE } from './references';

const base = { asker: 'main' as const, askedAt: '2026-11-23T09:30:00.000Z', callId: 'toolu_01Harbour0001', references: [], multiSelect: false };

export const CLASH: SheetQuestion = {
  ...base, id: 'q4', handle: 'q4', revision: 1, header: 'Clash rule',
  question: 'Two sailings share a berth within ten minutes. Which one should the import keep?',
  options: [
    { label: 'Keep the earlier sailing', description: 'How the harbour office settles it by hand', recommended: true, preview: 'The earlier sailing keeps the berth.' },
    { label: 'Keep the longer route', description: 'An island route outranks the harbour shuttle', preview: 'The shuttle gives way, whichever sailed first.' },
    { label: 'Keep both and flag the pair', description: 'Nothing is dropped; the pair goes to the review list' },
  ],
};
export const CLASH_REVISED: SheetQuestion = {
  ...CLASH, revision: 2, handle: 'q4@2',
  question: 'Two sailings share a berth within ten minutes. Which one should the import keep, now that the shuttle has its own berth on Sundays?',
};
export const NOTICES: SheetQuestion = {
  ...base, id: 'q5', handle: 'q5', revision: 1, header: 'Notices', question: 'Which notices should the printed sheet carry?', multiSelect: true,
  options: [{ label: 'Tidal restrictions' }, { label: 'Bank holiday service' }, { label: 'Vehicle deck limits', description: 'The limits change in March' }, { label: 'Accessibility contacts' }],
};
export const SEASON: SheetQuestion = {
  ...base, id: 'q6', handle: 'q6', revision: 1, header: 'Season dates', question: 'What are the first and last days of the winter season?', options: [],
  context: 'The two files disagree about the last day:\n\n- [the auth notes](src/auth.ts) say the season ends on **28 March**.\n- The fare table’s last winter row is **21 March**.',
  references: [TEXT_REFERENCE],
};
export const FIXTURE: SheetQuestion = {
  ...base, id: 'q7', handle: 'q7', revision: 1, header: 'Fixture', asker: { agentId: 'a1b2c3', name: 'reviewer' },
  question: 'The 2019 fixture is out of date. May I replace it with this season’s sailings?',
  options: [{ label: 'Replace it', description: 'The 2019 sailings no longer run' }, { label: 'Keep both', description: 'Two fixtures, the old one frozen' }],
};

export const sheetOf = (open: SheetQuestion[], rest: Partial<SheetModel> = {}): SheetModel => ({
  v: 1, session: '5eed0000-0000-4000-8000-0000000000aa', seq: 1, open, hidden: [], sent: [], pending: [], closed: {}, ...rest,
});
