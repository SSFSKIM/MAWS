import { describe, expect, it } from 'vitest';
import { digest, item, record } from '../../../../test/support/builders';
import { glyphFor } from './glyph';
import { REL } from '../test-support/relative-time';

const at = '2026-09-28T10:00:00Z';

describe('session glyphs', () => {
  it('follows the precedence table', () => {
    const r = record('s');
    const cases: [Parameters<typeof glyphFor>, { char: string; tone: string; label: string; pulse: boolean }][] = [
      [[record('s', { holder: { kind: 'terminal', pid: 7 } }), digest('s', { phase: 'foreign' }), []], { char: '⌁', tone: 'info', label: 'Live in terminal', pulse: false }],
      [[record('s', { holder: { kind: 'background_job', pid: null, jobId: 'j' } }), null, []], { char: '⌁', tone: 'info', label: 'Live as background job', pulse: false }],
      // W7: contested (MAWS runs it, a foreign process resumed it too), above any pending item
      [[record('s', { holder: { kind: 'self', contestedBy: { kind: 'terminal', pid: 7 } } }), digest('s', { phase: 'working' }), [item('s', 'question', at)]], { char: '⇄', tone: 'warning', label: 'Contested: also live in terminal', pulse: false }],
      [[record('s', { holder: { kind: 'self', contestedBy: { kind: 'background_job', pid: 8, jobId: 'abcd1234' } } }), digest('s'), []], { char: '⇄', tone: 'warning', label: 'Contested: also live as background job', pulse: false }],
      [[r, digest('s'), [item('s', 'question', at), item('s', 'permission', at)]], { char: '?', tone: 'warning', label: 'Question', pulse: false }],
      // P2-C (M6): the owner channel's question and must-read, after the blocking question and before the plan review
      [[r, digest('s'), [item('s', 'async_input', at), item('s', 'question', at)]], { char: '?', tone: 'warning', label: 'Question', pulse: false }],
      [[r, digest('s', { phase: 'working' }), [item('s', 'plan', at), item('s', 'essential_unread', at), item('s', 'async_input', at)]], { char: '?', tone: 'info', label: 'Question waiting', pulse: false }],
      [[r, digest('s', { phase: 'working' }), [item('s', 'plan', at), item('s', 'essential_unread', at)]], { char: '◆', tone: 'accent', label: 'Must read', pulse: false }],
      [[r, digest('s'), [item('s', 'plan', at), item('s', 'permission', at)]], { char: '◇', tone: 'info', label: 'Plan review', pulse: false }],
      [[r, digest('s'), [item('s', 'error', at)]], { char: '!', tone: 'danger', label: 'Needs you: error', pulse: false }],
      [[r, digest('s'), [item('s', 'interrupted', at)]], { char: '!', tone: 'danger', label: 'Needs you: interrupted', pulse: false }],
      [[r, digest('s'), [item('s', 'auto_mode_unavailable', at)]], { char: '!', tone: 'danger', label: 'Needs you: auto mode unavailable', pulse: false }],
      [[r, digest('s', { phase: 'waiting' }), [item('s', 'permission', at)]], { char: '◐', tone: 'warning', label: 'Needs approval', pulse: false }],
      [[r, digest('s'), [item('s', 'elicitation', at)]], { char: '◐', tone: 'warning', label: 'Needs approval', pulse: false }],
      [[r, digest('s', { phase: 'working' }), []], { char: '●', tone: 'accent', label: 'Working', pulse: true }],
      [[r, digest('s', { phase: 'starting' }), []], { char: '●', tone: 'accent', label: 'Working', pulse: true }],
      [[r, digest('s', { phase: 'failed' }), []], { char: '✕', tone: 'danger', label: 'Failed', pulse: false }],
      [[r, digest('s', { phase: 'exited' }), []], { char: '✓', tone: 'faint', label: 'Done', pulse: false }],
      [[record('s', { unread: true }), digest('s'), []], { char: '●', tone: 'faint', label: 'Idle, unread', pulse: false }],
      [[r, digest('s'), []], { char: '○', tone: 'faint', label: 'Idle', pulse: false }],
      [[r, null, []], { char: '○', tone: 'faint', label: 'Idle', pulse: false }],
    ];
    for (const [args, glyph] of cases) expect(glyphFor(...args), glyph.label).toEqual(glyph);
  });

  // P5 O9 M6 (the owner's Q1): a terminal session MAWS drives through its bridge reads like any MAWS session; its open
  // items win over the holder glyph, which stays for one with no live bridge (its digest `foreign`)
  it('reads a bridged terminal session’s open items and live phase, and the holder glyph only without a live bridge', () => {
    const foreign = record('s', { holder: { kind: 'terminal', pid: 7135 } });
    expect(glyphFor(foreign, digest('s', { phase: 'waiting' }), [item('s', 'permission', at)]).label).toBe('Needs approval');
    expect(glyphFor(foreign, digest('s', { phase: 'waiting' }), [item('s', 'question', at)]).label).toBe('Question');
    expect(glyphFor(foreign, digest('s', { phase: 'working' }), [])).toEqual({ char: '●', tone: 'accent', label: 'Working', pulse: true });
    expect(glyphFor(foreign, digest('s', { phase: 'idle' }), []).label).toBe('Idle');
    expect(glyphFor(foreign, digest('s', { phase: 'foreign' }), []).char).toBe('⌁');
    expect(glyphFor(foreign, null, []).char).toBe('⌁');
    expect(glyphFor(record('s', { holder: { kind: 'background_job', pid: 8, jobId: 'abcd' } }), digest('s', { phase: 'working' }), []).label).toBe('Working');
  });

  it('ignores a held peer message and closed items when choosing the glyph', () => {
    expect(glyphFor(record('s'), digest('s'), [item('s', 'held_peer_message', at)]).label).toBe('Idle');
    expect(glyphFor(record('s'), digest('s'), [item('s', 'question', at, { state: 'confirmed' })]).label).toBe('Idle');
  });

  // E11 F2b (plan 2.4; owner decision 1): out of Needs you once seen or dismissed, the session still says it ended with
  // an error, and when, until its next turn; a working, failed or waiting session says that first
  it('an error seen or dismissed leaves "Ended with an error" with its time', () => {
    const now = Date.parse('2026-10-08T10:00:00Z');
    const ended = item('s', 'error', '2026-09-24T10:00:00Z', { state: 'confirmed' });
    expect(glyphFor(record('s'), digest('s'), [], ended, now)).toEqual({ char: '✕', tone: 'danger', label: `Ended with an error ${REL.ago(2, 'week')}`, pulse: false });
    expect(glyphFor(record('s'), digest('s', { phase: 'exited' }), [], { ...ended, state: 'retired' }, now).label).toBe(`Ended with an error ${REL.ago(2, 'week')}`);
    expect(glyphFor(record('s'), digest('s', { phase: 'working' }), [], ended, now).label).toBe('Working');
    expect(glyphFor(record('s'), digest('s'), [item('s', 'question', at)], ended, now).label).toBe('Question');
  });
});
