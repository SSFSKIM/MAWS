// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, "Execution constraints"): the manifest's
// `order` merged three-way board by board, so an agent's re-order and an owner's re-order of other boards both land and a
// clash names the board. Pure: board ids in, the wanted sequence out; the publish projects it onto C's fractional keys.
//
// A board the agent moved is one outside the longest run its sent order keeps of the base's (where two runs are equally
// long, the run that leaves the owner's moved boards to the agent's side, so a clash is found rather than settled
// silently); it goes right after its predecessor in the sent order (first when it has none), everything else keeping
// its live place. The result is then checked pair by pair among the boards all three orders hold: every pair the agent
// put in a new relative order, and every pair the live order did, must come out that way; a pair that does not names its
// boards, unless `force`, under which the agent's order wins.

export interface OrderMerge {
  /** The boards the design will hold in their wanted order. */
  desired: string[];
  /** Boards both sides placed differently (empty under force). */
  clashes: string[];
}

/** The ids of a longest common subsequence of `a` and `b` of greatest weight (each id counted `weight(id)`). */
function kept(a: string[], b: string[], weight: (id: string) => number): Set<string> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? weight(a[i]!) + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out = new Set<string>();
  let [i, j] = [0, 0];
  while (i < n && j < m) {
    if (a[i] === b[j] && dp[i]![j] === weight(a[i]!) + dp[i + 1]![j + 1]!) {
      out.add(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * `base` the order the agent read, `sent` its order (null when it sent no manifest or left the order as read), `live` the
 * order now (without the boards this publish removes), `created` the boards the publish adds (placed where `sent` lists
 * them, else appended by id).
 */
export function mergeBoardOrder(base: string[], sent: string[] | null, live: string[], created: Iterable<string>, force: boolean): OrderMerge {
  const desired = [...live];
  const fresh = [...created].filter((id) => !desired.includes(id));
  const clashes = new Set<string>();
  const A = sent ?? [];
  if (sent) {
    const inL = new Set(live);
    const inA = new Set(A);
    const shared = base.filter((id) => inL.has(id) && inA.has(id));
    const set = new Set(shared);
    const [b, a, l] = [shared, A.filter((id) => set.has(id)), live.filter((id) => set.has(id))];
    const big = shared.length + 1; // a kept board always outweighs every tie-break together
    const liveKept = kept(b, l, () => big);
    const liveMoved = new Set(shared.filter((id) => !liveKept.has(id)));
    const agentKept = kept(b, a, (id) => big + (liveMoved.has(id) ? 0 : 1));
    for (const id of a) {
      if (agentKept.has(id)) continue;
      desired.splice(desired.indexOf(id), 1);
      const before = A.slice(0, A.indexOf(id)).reverse().find((p) => desired.includes(p));
      desired.splice(before === undefined ? 0 : desired.indexOf(before) + 1, 0, id);
    }
    // the pairs each side put in a new relative order, as they come out
    const at = (seq: string[]) => new Map(seq.map((id, i) => [id, i]));
    const [pb, pa, pl, pd] = [at(b), at(a), at(l), at(desired.filter((id) => set.has(id)))];
    const before = (p: Map<string, number>, x: string, y: string) => p.get(x)! < p.get(y)!;
    for (let i = 0; i < shared.length; i++)
      for (let j = i + 1; j < shared.length; j++) {
        const [x, y] = [shared[i]!, shared[j]!];
        const agentLost = before(pa, x, y) !== before(pb, x, y) && before(pd, x, y) !== before(pa, x, y);
        const liveLost = !force && before(pl, x, y) !== before(pb, x, y) && before(pd, x, y) !== before(pl, x, y);
        if (!agentLost && !liveLost) continue;
        const named = [x, y].filter((id) => liveMoved.has(id) || !agentKept.has(id));
        for (const id of named.length ? named : [x, y]) clashes.add(id);
      }
  }
  // a board the publish adds, as a moved one: right after its nearest predecessor in the sent order, first when it has none
  const listed = fresh.filter((id) => A.includes(id)).sort((x, y) => A.indexOf(x) - A.indexOf(y));
  for (const id of listed) {
    const prev = A.slice(0, A.indexOf(id)).reverse().find((p) => desired.includes(p));
    desired.splice(prev === undefined ? 0 : desired.indexOf(prev) + 1, 0, id);
  }
  desired.push(...fresh.filter((id) => !A.includes(id)).sort());
  return { desired, clashes: force ? [] : [...clashes].sort() };
}
