// UX wave U13a, the rehearsal (section, "The rehearsal"; root UC-14; the U13a plan's M1 and Concrete Steps 4): run by the
// architect over copies of the owner's `layout.json` files, in a directory outside any repository named by
// MAWS_LAYOUT_REHEARSAL, and skipped otherwise. It prints the rehearsal's lines, which hold generated labels, counts and
// fixed words only (`./rehearsal.ts`), and asserts on the number of files that did not pass.
import { describe, it } from 'vitest';
import { runRehearsal } from './rehearsal';

const directory = process.env.MAWS_LAYOUT_REHEARSAL;

describe.skipIf(!directory)('the rehearsal over copies of layout files', () => {
  it('reads every file into one strip and stores it with no tab and no open session lost', () => {
    runRehearsal(directory!);
  });
});
