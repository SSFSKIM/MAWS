import { describe, expect, it } from 'vitest';
import { digest, item, record } from '../../../../test/support/builders';
import { glyphFor } from './glyph';

const at = '2026-09-28T10:00:00Z';

describe('session glyphs', () => {
  it('follows the precedence table', () => {
    const r = record('s');
    const cases: [Parameters<typeof glyphFor>, { char: string; tone: string; label: string; pulse: boolean }][] = [
      [[record('s', { holder: { kind: 'terminal', pid: 7 } }), digest('s'), []], { char: '⌁', tone: 'info', label: 'Live in terminal', pulse: false }],
      [[record('s', { holder: { kind: 'background_job', pid: null, jobId: 'j' } }), null, []], { char: '⌁', tone: 'info', label: 'Live as background job', pulse: false }],
      [[r, digest('s'), [item('s', 'question', at), item('s', 'permission', at)]], { char: '?', tone: 'warning', label: 'Question', pulse: false }],
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

  it('returns ⌁ for a foreign-live session even with a pending item', () => {
    const foreign = record('s', { holder: { kind: 'terminal', pid: 7135 } });
    expect(glyphFor(foreign, digest('s', { phase: 'foreign' }), [item('s', 'permission', at)]).char).toBe('⌁');
  });

  it('ignores a held peer message and closed items when choosing the glyph', () => {
    expect(glyphFor(record('s'), digest('s'), [item('s', 'held_peer_message', at)]).label).toBe('Idle');
    expect(glyphFor(record('s'), digest('s'), [item('s', 'question', at, { state: 'confirmed' })]).label).toBe('Idle');
  });
});
