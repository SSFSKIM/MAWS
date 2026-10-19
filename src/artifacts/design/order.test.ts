// P3-E1 M1: the manifest's order merged board by board (order.ts), so unrelated re-orders land together and a clash
// names the board.
import { describe, expect, it } from 'vitest';
import { mergeBoardOrder, movableIn } from './order';

const base = ['a', 'b', 'c', 'd'];

describe('mergeBoardOrder', () => {
  it('keeps the live order when the agent sent none, appending what the publish creates by id', () => {
    expect(mergeBoardOrder(base, null, ['b', 'a', 'c', 'd'], ['z', 'y'], false)).toEqual({ desired: ['b', 'a', 'c', 'd', 'y', 'z'], clashes: [] });
  });

  it('applies the agent’s move of one board beside the owner’s move of another', () => {
    // the agent moves d first; the owner moved a last
    expect(mergeBoardOrder(base, ['d', 'a', 'b', 'c'], ['b', 'c', 'd', 'a'], [], false)).toEqual({ desired: ['d', 'b', 'c', 'a'], clashes: [] });
  });

  it('accepts both sides moving one board to the same place', () => {
    expect(mergeBoardOrder(base, ['c', 'a', 'b', 'd'], ['c', 'a', 'b', 'd'], [], false)).toEqual({ desired: ['c', 'a', 'b', 'd'], clashes: [] });
  });

  it('names a board both sides moved to different places; forced, the agent’s place wins', () => {
    const sent = ['a', 'b', 'd', 'c']; // the agent: c last
    const live = ['c', 'a', 'b', 'd']; // the owner: c first
    expect(mergeBoardOrder(base, sent, live, [], false).clashes).toEqual(['c']);
    expect(mergeBoardOrder(base, sent, live, [], true)).toEqual({ desired: ['a', 'b', 'd', 'c'], clashes: [] });
  });

  it('places a created board right after its predecessor in the sent order (first when it has none), and keeps a board the sent order leaves out where it is', () => {
    expect(mergeBoardOrder(base, ['a', 'n', 'b', 'c', 'd'], base, ['n'], false).desired).toEqual(['a', 'n', 'b', 'c', 'd']);
    expect(mergeBoardOrder(base, ['n', 'a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'], ['n'], false).desired).toEqual(['n', 'b', 'a', 'c', 'd']);
    expect(mergeBoardOrder(base, ['b', 'a', 'd'], base, [], false)).toEqual({ desired: ['b', 'a', 'c', 'd'], clashes: [] });
  });

  it('forced, settles a pair the agent re-ordered by its sent order, where placing its moved board after its predecessor would not (design-workbench sweep#1)', () => {
    // the agent moved a last; the owner put c first: a, after its sent predecessor c, would land before b
    const [read, sent, live] = [['a', 'b', 'c'], ['b', 'c', 'a'], ['c', 'b', 'a']];
    expect(mergeBoardOrder(read, sent, live, [], false).clashes).toEqual(['a', 'b']);
    // a after both, as the agent sent it; the owner's c before b, which the agent did not re-order, kept
    expect(mergeBoardOrder(read, sent, live, [], true)).toEqual({ desired: ['c', 'b', 'a'], clashes: [] });
  });

  it('forced, keeps every pair the agent re-ordered and every pair all three orders agree on whatever the owner did, and the owner’s own re-orders at least as well as the settles before (every order of three, four and five boards on each side; design-workbench review, L251)', () => {
    const orders = (ids: string[]): string[][] => (ids.length <= 1 ? [ids] : ids.flatMap((id) => orders(ids.filter((x) => x !== id)).map((rest) => [id, ...rest])));
    // the agent swapped b and c; the owner swapped a with b and c with d: a before c, as all three have it, stays
    const agreed = mergeBoardOrder(base, ['a', 'c', 'b', 'd'], ['b', 'a', 'd', 'c'], [], true).desired;
    expect(agreed.indexOf('a')).toBeLessThan(agreed.indexOf('c'));
    expect(agreed.indexOf('c')).toBeLessThan(agreed.indexOf('b'));
    for (const read of [['a', 'b', 'c'], base, ['a', 'b', 'c', 'd', 'e']]) {
      const all = orders(read);
      const broken: string[] = [];
      for (const sent of all)
        for (const live of all) {
          const { desired } = mergeBoardOrder(read, sent, live, [], true);
          const at = `${sent} / ${live} -> ${desired}`;
          if ([...desired].sort().join() !== [...read].sort().join()) broken.push(`${at}: not the boards read`);
          const now = pairsOf(read, sent, live, desired);
          broken.push(...[...now.lost, ...now.inverted].map((pair) => `${at}: ${pair}`));
          // the owner's own re-orders: kept as often as the settle before kept them, and as the one before that did
          // wherever it kept both rules
          const settled = forcedBefore(read, sent, live, true);
          if (now.owner < pairsOf(read, sent, live, settled).owner) broken.push(`${at}: fewer of the owner’s pairs kept than ${settled}`);
          const agentOnly = forcedBefore(read, sent, live, false);
          const first = pairsOf(read, sent, live, agentOnly);
          if (first.lost.length + first.inverted.length === 0 && now.owner < first.owner) broken.push(`${at}: fewer of the owner’s pairs kept than ${agentOnly}, which keeps both rules`);
        }
      expect(broken.slice(0, 5), `${read.length} boards: ${broken.length} broken`).toEqual([]);
    }
  });

  it('forced, settles the pairs the agent re-ordered before the pairs all three orders agree on, so the first placement’s slip does not take every board into the sent order (L251)', () => {
    // the agent turned b, c and d around; the owner put c and e first, and d before a
    const [read, sent, live] = [['a', 'b', 'c', 'd', 'e'], ['a', 'd', 'c', 'b', 'e'], ['c', 'e', 'd', 'a', 'b']];
    // b, placed right after its sent predecessor c, lands before a (c, b, e, a, d): settling the agent's own pairs (b, c
    // and d, in their places) puts it after a again, so a and e keep the owner's places; counting a before b from the
    // first round settled a too, which then jumped e, until all five took the sent order
    expect(mergeBoardOrder(read, sent, live, [], true)).toEqual({ desired: ['d', 'c', 'e', 'a', 'b'], clashes: [] });
    expect(forcedBefore(read, sent, live, true)).toEqual(sent); // the settle before: every pair only the owner re-ordered reverted
  });

  it('forced, takes the settle that counts both kinds from the first round where it keeps more of the owner’s re-orders (L251)', () => {
    // the agent moved a after d and c after a; the owner moved b and c last. The first placement (d, a, c, e, b) loses the
    // agent's b before a and inverts b before c: settling a and b alone sends a last, past c and e, and settling those
    // then puts c before e; settling a, b and c together keeps the owner's e before c
    expect(mergeBoardOrder(['a', 'b', 'c', 'd', 'e'], ['b', 'd', 'a', 'c', 'e'], ['a', 'd', 'e', 'b', 'c'], [], true).desired).toEqual(['d', 'b', 'a', 'e', 'c']);
  });
});

/**
 * A forced result read pair by pair: the agent's re-orders it lost, the pairs all three orders agree on it inverted, and
 * how many of the pairs only the owner re-ordered it keeps as the owner has them.
 */
function pairsOf(read: string[], sent: string[], live: string[], desired: string[]): { lost: string[]; inverted: string[]; owner: number } {
  const out = { lost: [] as string[], inverted: [] as string[], owner: 0 };
  for (const [i, x] of read.entries())
    for (const y of read.slice(i + 1)) {
      const [s, b, l, d] = [sent, read, live, desired].map((seq) => seq.indexOf(x) < seq.indexOf(y));
      if (s !== b && d !== s) out.lost.push(`the agent's ${x} ${s ? 'before' : 'after'} ${y} lost`);
      if (s === b && l === b && d !== b) out.inverted.push(`${x} ${b ? 'before' : 'after'} ${y}, as all three have it, inverted`);
      if (s === b && l !== b && d === l) out.owner++;
    }
  return out;
}

/**
 * The reference: order.ts's forced merge as it stood before its settle ran in two phases (eadd6bb7d), over orders of the
 * same boards with none created. From the first round it settled every pair the agent re-ordered and every pair all three
 * orders agree on that came out otherwise; `agreed` false settles only the agent's, as it stood before that (b617903ea),
 * which could invert a pair all three agree on.
 */
function forcedBefore(read: string[], sent: string[], live: string[], agreed: boolean): string[] {
  const kept = (a: string[], b: string[], weight: (id: string) => number): Set<string> => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? weight(a[i]!) + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    const out = new Set<string>();
    let [i, j] = [0, 0];
    while (i < a.length && j < b.length) {
      if (a[i] === b[j] && dp[i]![j] === weight(a[i]!) + dp[i + 1]![j + 1]!) {
        out.add(a[i]!);
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
      else j++;
    }
    return out;
  };
  const desired = [...live];
  const big = read.length + 1;
  const liveKept = kept(read, live, () => big);
  const agentKept = kept(read, sent, (id) => big + (liveKept.has(id) ? 1 : 0));
  for (const id of sent) {
    if (agentKept.has(id)) continue;
    desired.splice(desired.indexOf(id), 1);
    const before = sent.slice(0, sent.indexOf(id)).reverse().find((p) => desired.includes(p));
    desired.splice(before === undefined ? 0 : desired.indexOf(before) + 1, 0, id);
  }
  const lost = (): [string, string][] =>
    read.flatMap((x, i) =>
      read.slice(i + 1).flatMap((y): [string, string][] => {
        const [s, b, l, d] = [sent, read, live, desired].map((seq) => seq.indexOf(x) < seq.indexOf(y));
        return (s !== b && d !== s) || (agreed && l === b && d !== s) ? [[x, y]] : [];
      }),
    );
  const settled = new Set<string>();
  for (let pairs = lost(); pairs.length > 0; pairs = lost()) {
    for (const [x, y] of pairs) settled.add(x).add(y);
    const sequence = sent.filter((id) => settled.has(id));
    let k = 0;
    for (let i = 0; i < desired.length; i++) if (settled.has(desired[i]!)) desired[i] = sequence[k++]!;
  }
  return desired;
}

describe('movableIn', () => {
  it('names the boards some longest common run of the two orders leaves out: a move, or a tie that cannot tell', () => {
    expect(movableIn(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])).toEqual(new Set(['a'])); // only a moved
    expect(movableIn(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual(new Set(['a', 'b'])); // a or b: a tie
    expect(movableIn(['a', 'b', 'c', 'd'], ['a', 'b', 'd', 'c'])).toEqual(new Set(['c', 'd']));
    expect(movableIn(['a', 'b'], ['a', 'x', 'b'])).toEqual(new Set());
  });
});
