// The ListAgents listing parsed (SPEC 38 §38.26.3), over E7 M0's recorded results (pass3/e7-peer-a seq 29, e7-team
// seq 98) and the SPEC's literals for what no fixture holds (Teammates, the overflow line, the notes, the empty states).
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../../test/support/fixtures';
import { parseListing } from './agent-listing';

const resultText = (name: string, seq: number) => {
  const frame = loadJournal('pass3', name).find((row) => row.seq === seq)!.frame as { message: { content: { type: string; content: string }[] } };
  return frame.message.content[0]!.content;
};
const SELF = 'This session is lead-07 [aa11bb] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).';

describe('parseListing', () => {
  it('reads the self line and a Peer sessions section (M0, e7-peer-a)', () => {
    expect(parseListing(resultText('e7-peer-a', 29))).toEqual({
      self: 'repo-h6xooi-51 [804260]',
      sections: [{ title: 'Peer sessions', count: 1, rows: [{ name: 'repo-b-gen1il-79', ref: '61303a', extras: ['interactive', 'idle', 'started 2s ago'] }] }],
      notes: [],
    });
  });

  it('reads name [ref] rows under Subagents: a named agent lists there under the teams gate (M0, e7-team)', () => {
    expect(parseListing(resultText('e7-team', 98)).sections).toEqual([
      { title: 'Subagents', count: 1, rows: [{ name: 'scout', ref: '15083b', extras: ['general-purpose', 'running', 'started 1s ago'] }] },
    ]);
  });

  it('reads all three sections in order, a raw agent id row, the overflow line and the notes after them', () => {
    const text = [
      SELF, '',
      'Subagents (2):', '  scout [15083b]  ·  general-purpose  ·  running  ·  started 3s ago', '  a1ba7eb1ffe9f0ffa  ·  Explore  ·  completed  ·  started 1m ago', '',
      'Teammates (102):', '  researcher [9c1f00]  ·  general-purpose  ·  in-process  ·  joined 4m ago  ·  not messageable by name while a subagent in this session is registered under that name (the name reaches the subagent)', '  (unnamed)  ·  general-purpose  ·  idle  ·  joined 9m ago', '  (… 100 more not shown)', '',
      'Peer sessions (1):', '  repo-b [61303a]  ·  says it was repo-old until 2m ago  ·  interactive  ·  busy  ·  tmux main  ·  started 2h ago', '',
      '(the session list on this machine could not be read just now — other local sessions may be missing from this listing; a later listing retries)',
    ].join('\n');
    expect(parseListing(text)).toEqual({
      self: 'lead-07 [aa11bb]',
      sections: [
        { title: 'Subagents', count: 2, rows: [
          { name: 'scout', ref: '15083b', extras: ['general-purpose', 'running', 'started 3s ago'] },
          { name: 'a1ba7eb1ffe9f0ffa', ref: null, extras: ['Explore', 'completed', 'started 1m ago'] },
        ] },
        { title: 'Teammates', count: 102, rows: [
          { name: 'researcher', ref: '9c1f00', extras: ['general-purpose', 'in-process', 'joined 4m ago', 'not messageable by name while a subagent in this session is registered under that name (the name reaches the subagent)'] },
          { name: '(unnamed)', ref: null, extras: ['general-purpose', 'idle', 'joined 9m ago'] },
        ] },
        { title: 'Peer sessions', count: 1, rows: [{ name: 'repo-b', ref: '61303a', extras: ['says it was repo-old until 2m ago', 'interactive', 'busy', 'tmux main', 'started 2h ago'] }] },
      ],
      notes: ['(… 100 more not shown)', '(the session list on this machine could not be read just now — other local sessions may be missing from this listing; a later listing retries)'],
    });
  });

  it("reads a subagent caller's self line, naming the main session", () => {
    const text = 'This process\'s main session is lead-07 [aa11bb] — the name OTHER sessions use to message it (it is not listed below; from inside this process, address the main conversation as "main").\n\nNo reachable agents.';
    expect(parseListing(text)).toEqual({ self: 'lead-07 [aa11bb]', sections: [], notes: ['No reachable agents.'] });
  });

  it('reads an empty or degraded listing, and a text of no known shape, as notes', () => {
    expect(parseListing('No reachable agents.')).toEqual({ self: null, sections: [], notes: ['No reachable agents.'] });
    const off = 'Cross-session messaging is switched off in this session right now — no sessions were listed, and this session is not reachable by name until it is switched back on.';
    expect(parseListing(off)).toEqual({ self: null, sections: [], notes: [off] });
    expect(parseListing('')).toEqual({ self: null, sections: [], notes: [] });
  });
});
