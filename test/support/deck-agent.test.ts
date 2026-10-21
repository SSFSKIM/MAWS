// P4-B2 M0 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D17; the tracker's seam row of 2026-10-18): the
// deck's agent through the host's scale seam (e2e/support/deck-agent.ts), shared by the scale gate's row 2 and the drag
// spec. Its reads and publishes go to the seam as A's real tools, each publish stepping a slide's first font size; its
// republishing paces one slide at a time until the drag ends; the fidelity check says whether a drag's publishes were
// the host's (rising revisions), reached the tab as remote applies, and are what the deck reads back.
import { describe, expect, it } from 'vitest';
import { DECK_AGENT, DeckAgent, fidelityProblems, firstFontSize, republishing, type DeckCall, type PublishResult } from '../../e2e/support/deck-agent';

const DECK: Record<string, string> = {
  'project/deck.json': '{"v":4}',
  'project/slides/a.html': '<section id="a"><h1 id="t" style="font-size:96px">A</h1></section>',
  'project/slides/b.html': '<section id="b"><p id="p" style="color:red; font-size:64px">B</p></section>',
  'project/slides/c.html': '<section id="c"><p id="q" style="font-size:40px">C</p><p style="font-size:12px">c</p></section>',
};

const loop = { max: 1, p99: 1, mean: 0.5 };

/** The host's seam as the agent sees it: every command kept, each answered as the host's tools answer. */
class FakeSeam {
  readonly sent: Record<string, unknown>[] = [];
  revision = 7;
  refuse: string | null = null;
  changedOverride: string[] | null = null;
  async send<T>(command: Record<string, unknown>): Promise<T> {
    this.sent.push(command);
    if (command.cmd === 'release') return { ok: true } as T;
    const { tool, args } = command as { tool: string; args: { files?: Record<string, string> } };
    if (this.refuse) return { ok: true, isError: true, text: this.refuse, wallMs: 1, loop, busyMs: 1 } as T;
    if (tool === 'artifact_read') return { ok: true, isError: false, result: { revision: this.revision, files: { ...DECK } }, text: '', wallMs: 1, loop, busyMs: 1 } as T;
    this.revision += 2;
    return { ok: true, isError: false, result: { revision: this.revision, changed: this.changedOverride ?? Object.keys(args.files ?? {}) }, text: '', wallMs: 2, loop, busyMs: 3 } as T;
  }
}

const published = (revision: number, changed: string[]): DeckCall<PublishResult> => ({ ok: true, isError: false, result: { revision, changed }, text: '', wallMs: 1, loop, busyMs: 1 });

describe('the deck agent', () => {
  it('reads the deck through artifact_read as its session, keeping the files and the revision', async () => {
    const seam = new FakeSeam();
    const agent = new DeckAgent(seam, 'art-1');
    await agent.read();
    expect(seam.sent).toEqual([{ cmd: 'call', session: DECK_AGENT, tool: 'artifact_read', args: { artifact: 'art-1' } }]);
    expect(agent.files).toEqual(DECK);
    expect(agent.revision).toBe(7);
    expect(agent.slidePaths()).toEqual(['project/slides/a.html', 'project/slides/b.html', 'project/slides/c.html']);
  });

  it('publishes each slide’s first font size stepped, up on its odd turns and down on its even, from the revision it last saw', async () => {
    const seam = new FakeSeam();
    const agent = new DeckAgent(seam, 'art-1');
    await agent.read();
    await agent.publish(['project/slides/b.html', 'project/slides/c.html']);
    expect(seam.sent[1]).toEqual({
      cmd: 'call',
      session: DECK_AGENT,
      tool: 'artifact_publish',
      args: { artifact: 'art-1', baseRevision: 'last', files: { 'project/slides/b.html': DECK['project/slides/b.html']!.replace('64px', '65px'), 'project/slides/c.html': DECK['project/slides/c.html']!.replace('40px', '41px') } },
    });
    expect(agent.revision).toBe(9);
    await agent.publish(['project/slides/b.html']);
    expect(firstFontSize(agent.files['project/slides/b.html']!)).toBe(64);
    expect(firstFontSize(agent.files['project/slides/c.html']!)).toBe(41);
    expect(agent.files['project/slides/c.html']).toContain('font-size:12px'); // only the first size steps
    expect(agent.revision).toBe(11);
  });

  it('throws on a refused call, a publish the host answered for other paths, and a slide with no font size', async () => {
    const seam = new FakeSeam();
    const agent = new DeckAgent(seam, 'art-1');
    await agent.read();
    seam.changedOverride = ['project/slides/a.html'];
    await expect(agent.publish(['project/slides/b.html'])).rejects.toThrow(/changed project\/slides\/a\.html, not project\/slides\/b\.html/);
    seam.changedOverride = null;
    await expect(agent.publish(['project/deck.json'])).rejects.toThrow(/project\/deck\.json has no font size to step/);
    seam.refuse = 'stale base';
    await expect(agent.publish(['project/slides/b.html'])).rejects.toThrow(/the agent's publish was refused: stale base/);
    await expect(agent.read()).rejects.toThrow(/the agent's read was refused: stale base/);
  });

  it('releases its session', async () => {
    const seam = new FakeSeam();
    await new DeckAgent(seam, 'art-1', 'other-agent').release();
    expect(seam.sent).toEqual([{ cmd: 'release', session: 'other-agent' }]);
  });
});

describe('republishing', () => {
  it('publishes one slide after each pause, the second slide on in turn, until the drag settles', async () => {
    const seam = new FakeSeam();
    const agent = new DeckAgent(seam, 'art-1');
    await agent.read();
    let end!: () => void;
    const until = new Promise<void>((resolve) => (end = resolve));
    const pauses: number[] = [];
    const answers = await republishing(agent, until, 700, async (ms) => {
      pauses.push(ms);
      if (pauses.length === 4) end();
      await Promise.resolve(); // the drag's settling is seen once the pause ends
      await Promise.resolve();
    });
    expect(pauses).toEqual([700, 700, 700, 700]);
    const paths = seam.sent.slice(1).map((c) => Object.keys((c as { args: { files: Record<string, string> } }).args.files));
    expect(paths).toEqual([['project/slides/b.html'], ['project/slides/c.html'], ['project/slides/b.html']]);
    expect(answers.map((a) => a.result!.revision)).toEqual([9, 11, 13]);
  });

  it('publishes nothing when the drag settles before the first pause ends', async () => {
    const seam = new FakeSeam();
    const agent = new DeckAgent(seam, 'art-1');
    await agent.read();
    expect(await republishing(agent, Promise.resolve(), 700, () => new Promise((resolve) => setTimeout(resolve, 0)))).toEqual([]);
    expect(seam.sent).toHaveLength(1);
  });
});

describe('fidelityProblems', () => {
  const agentFiles = { 'project/slides/b.html': '<p style="font-size:65px">B</p>', 'project/slides/c.html': '<p style="font-size:41px">C</p>' };
  const readBack = { 'project/slides/b.html': '<section id="b"><p id="p" style="color:red; font-size:65px">B</p></section>', 'project/slides/c.html': '<p style="font-size:41px">C</p>' };
  const faithful = { revisionBefore: 7, published: [published(9, ['project/slides/b.html']), published(11, ['project/slides/c.html'])], remoteApplies: 2, integrated: 11, agentFiles, readBack };

  it('finds none when every publish rose in revision, the tab integrated the last one’s row as a remote apply, and each reads back with its font size', () => {
    expect(fidelityProblems(faithful)).toEqual([]);
    expect(fidelityProblems({ ...faithful, remoteApplies: 5 })).toEqual([]); // a publish may reach the tab as more than one update
    // P4-B2 M6: the gesture hold applies the publishes it held at the drop, merged into one update
    expect(fidelityProblems({ ...faithful, remoteApplies: 1 })).toEqual([]);
    expect(fidelityProblems({ ...faithful, integrated: 14 })).toEqual([]); // rows written after the drag's last publish
  });

  it('names a revision that did not rise, from the one the agent saw before the drag', () => {
    expect(fidelityProblems({ ...faithful, revisionBefore: 9 })).toEqual(['publish 1 answered revision 9, not above 9']);
    expect(fidelityProblems({ ...faithful, published: [published(9, ['project/slides/b.html']), published(9, ['project/slides/c.html'])] })).toEqual(['publish 2 answered revision 9, not above 9']);
  });

  it('names a tab whose replica has not integrated the last publish’s row, or applied no remote update', () => {
    expect(fidelityProblems({ ...faithful, integrated: 10 })).toEqual(['the tab’s replica integrated rows through 10, not the last publish’s 11']);
    expect(fidelityProblems({ ...faithful, remoteApplies: 0 })).toEqual(['the tab’s replica applied no remote update']);
  });

  it('names a slide whose read-back font size is not the agent’s last', () => {
    expect(fidelityProblems({ ...faithful, readBack: { ...readBack, 'project/slides/c.html': '<p style="font-size:40px">C</p>' } })).toEqual(['project/slides/c.html reads back font size 40, the agent last published 41']);
    expect(fidelityProblems({ ...faithful, readBack: { 'project/slides/b.html': readBack['project/slides/b.html'] } })).toEqual(['project/slides/c.html reads back font size none, the agent last published 41']);
  });

  it('names a drag the agent published nothing in', () => {
    expect(fidelityProblems({ ...faithful, published: [], remoteApplies: 0, integrated: 7 })).toEqual(['the agent published nothing during the drag']);
  });
});
