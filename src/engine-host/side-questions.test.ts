// The host's side-question log (E3 execution document, Interfaces "The host's side-question log", Design §7): the
// history it sends, how a completion settles an entry (a late success too), what clear keeps, and an exit.
import { describe, expect, it } from 'vitest';
import type { OperationEvent } from '@shared/engine/operations';
import { SideQuestionLog } from './side-questions';

const ok = (response: string | null, synthetic = false): OperationEvent['outcome'] => ({ ok: true, value: { response, synthetic } });
const failed = (message: string, code: 'timeout' | 'engine_error' = 'engine_error'): OperationEvent['outcome'] => ({ ok: false, error: { code, message, engineCode: null } });

function asked(log: SideQuestionLog, id: string, question: string, at = 't0') {
  const ask = log.ask(question, at);
  ask.bind(id);
  return ask;
}

describe('SideQuestionLog', () => {
  it('lists an asked question as pending under its operation id, then answered', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'What word?', 't0');
    expect(log.list()).toEqual([{ id: 'r1', question: 'What word?', state: 'pending', response: null, synthetic: false, error: null, askedAt: 't0', answeredAt: null }]);
    log.settle('r1', ok('ZEBRA'), 't1');
    expect(log.list()).toEqual([{ id: 'r1', question: 'What word?', state: 'answered', response: 'ZEBRA', synthetic: false, error: null, askedAt: 't0', answeredAt: 't1' }]);
  });

  it('omits history while nothing is answered, then sends the answered non-synthetic exchanges, oldest first', () => {
    const log = new SideQuestionLog();
    expect(log.ask('first', 't0').history).toBeUndefined();
    asked(log, 'r1', 'What word?');
    asked(log, 'r2', 'Use a tool?');
    asked(log, 'r3', 'Fail?');
    asked(log, 'r4', 'Lowercase?');
    log.settle('r1', ok('ZEBRA'), 't1');
    log.settle('r2', ok('I cannot use tools here.', true), 't2');
    log.settle('r3', failed('Side question cancelled'), 't3');
    log.settle('r4', ok('zebra'), 't4');
    expect(log.ask('next', 't5').history).toEqual([
      { question: 'What word?', response: 'ZEBRA' },
      { question: 'Lowercase?', response: 'zebra' },
    ]);
  });

  it('leaves an answer with no text out of the history', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'q');
    log.settle('r1', ok(null), 't1');
    expect(log.list()[0]).toMatchObject({ state: 'answered', response: null });
    expect(log.ask('next', 't2').history).toBeUndefined();
  });

  it('fails an entry with the engine’s message, and a late success after the timeout answers it', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'q');
    log.settle('r1', failed('side_question unanswered after 120 s', 'timeout'), 't1');
    expect(log.list()[0]).toMatchObject({ state: 'failed', error: 'side_question unanswered after 120 s', answeredAt: 't1' });
    log.settle('r1', ok('late'), 't2');
    expect(log.list()[0]).toMatchObject({ state: 'answered', response: 'late', error: null, answeredAt: 't2' });
  });

  it('keeps the first settlement against a later failure, and ignores an unknown id', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'q');
    log.settle('r1', ok('yes'), 't1');
    log.settle('r1', failed('too late'), 't2');
    log.settle('nope', ok('x'), 't3');
    expect(log.list()).toEqual([{ id: 'r1', question: 'q', state: 'answered', response: 'yes', synthetic: false, error: null, askedAt: 't0', answeredAt: 't1' }]);
  });

  it('lists nothing for a question whose request was never written', () => {
    const log = new SideQuestionLog();
    log.ask('q', 't0'); // the write threw before an id was minted: never bound
    expect(log.list()).toEqual([]);
  });

  it('clears answered and failed entries and keeps pending ones, so a completion still finds its entry', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'a');
    asked(log, 'r2', 'b');
    asked(log, 'r3', 'c');
    log.settle('r1', ok('A'), 't1');
    log.settle('r2', failed('no'), 't2');
    log.clear();
    expect(log.list().map((e) => e.id)).toEqual(['r3']);
    log.settle('r3', ok('C'), 't3');
    expect(log.list()[0]).toMatchObject({ id: 'r3', state: 'answered', response: 'C' });
  });

  // E11 (tracker row E3 "side-question `retried` set renderer-only"): a Retry is marked in the host's log, not hidden by
  // the renderer, so a reload never shows a retried failure again
  it('drops the failed entry a retry asked again once the retry is entered, and keeps it while the retry was never written', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'q');
    asked(log, 'r2', 'other');
    log.settle('r1', failed('Side question cancelled'), 't1');
    log.ask('q', 't2', 'r1'); // the retry's write threw: never bound
    expect(log.list().map((e) => [e.id, e.state])).toEqual([['r1', 'failed'], ['r2', 'pending']]);
    log.ask('q', 't3', 'r1').bind('r3');
    expect(log.list().map((e) => [e.id, e.question, e.state])).toEqual([['r2', 'other', 'pending'], ['r3', 'q', 'pending']]);
  });

  it('keeps an entry a retry named once it is no longer failed (a late success answered it), and ignores an unknown one', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'q');
    log.settle('r1', failed('timed out', 'timeout'), 't1');
    log.settle('r1', ok('late'), 't2');
    log.ask('q', 't3', 'r1').bind('r2');
    log.ask('q', 't4', 'nope').bind('r3');
    expect(log.list().map((e) => [e.id, e.state])).toEqual([['r1', 'answered'], ['r2', 'pending'], ['r3', 'pending']]);
  });

  it('fails pending entries when the process exits, and a late completion after it changes nothing but a success', () => {
    const log = new SideQuestionLog();
    asked(log, 'r1', 'a');
    asked(log, 'r2', 'b');
    log.settle('r1', ok('A'), 't1');
    log.processExited('t2');
    expect(log.list().map((e) => [e.id, e.state, e.error, e.answeredAt])).toEqual([
      ['r1', 'answered', null, 't1'],
      ['r2', 'failed', 'The session ended', 't2'],
    ]);
    log.settle('r2', failed('the process exited'), 't3'); // the control client's own rejection, a macrotask later
    expect(log.list()[1]).toMatchObject({ state: 'failed', error: 'The session ended' });
  });
});
