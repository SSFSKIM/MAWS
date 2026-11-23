import { describe, expect, it } from 'vitest';
import { record, status } from '../../../../../test/support/builders';
import { mawsToolsRows } from './model';

// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, A4 and §H): Session info's Engine section names the
// set of a session MAWS is running, from its record (absent: the full set); for a session with no engine status, which
// MAWS may never have launched, it guesses none.
describe("Session info's MAWS tools rows", () => {
  it('names every group and MAWS’s question for a running session at the full set', () => {
    expect(mawsToolsRows(record('s'), status('s'))).toEqual([
      { label: 'MAWS tools', value: 'Artifacts, Documents, Dashboards, Auxiliary' },
      { label: 'Question tool', value: 'MAWS' },
    ]);
  });

  it('names the groups that are on, and the engine’s question as Default', () => {
    const rec = record('s', { mawsTools: { artifacts: true, documents: false, dashboards: true, auxiliary: false, question: 'engine' } });
    expect(mawsToolsRows(rec, status('s'))).toEqual([
      { label: 'MAWS tools', value: 'Artifacts, Dashboards' },
      { label: 'Question tool', value: 'Default' },
    ]);
  });

  it('says None when every group is off', () => {
    const rec = record('s', { mawsTools: { artifacts: false, documents: false, dashboards: false, auxiliary: false, question: 'maws' } });
    expect(mawsToolsRows(rec, status('s'))[0]).toEqual({ label: 'MAWS tools', value: 'None' });
  });

  it('draws no rows for a session with no engine status', () => {
    expect(mawsToolsRows(record('s'), null)).toEqual([]);
  });
});
