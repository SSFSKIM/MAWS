// COPY of spikes/p3-store/s6/src/order.ts at 4ab6b9b7 for S7a (unchanged below this line).
// Fractional order keys: sorting with the id tie-break, minimal re-keying toward a desired sequence, and the
// deterministic collision repair. Pure; no Yjs.

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * The flow layer's place in a container's z axis. Pinned children with z below it paint under the flow content
 * (they precede the first flow child in the file), above it over. No element ever holds this key.
 */
export const FLOW_LAYER = 'a0'
export type Bounds = { lo: string | null; hi: string | null }
export const UNDER: Bounds = { lo: null, hi: FLOW_LAYER }
export const OVER: Bounds = { lo: FLOW_LAYER, hi: null }
export const ANY: Bounds = { lo: null, hi: null }

/** Sort by key, then id: two replicas that minted the same key between the same neighbours still agree on the order. */
export function byKey<T extends { id: string }>(key: (t: T) => string | undefined): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a) ?? '￿', kb = key(b) ?? '￿' // a missing key sorts last
    return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
}

export function within(k: string | undefined, b: Bounds): k is string {
  return k !== undefined && (b.lo === null || k > b.lo) && (b.hi === null || k < b.hi)
}

/** Indices of a longest strictly increasing subsequence of the defined keys (patience sorting, O(n log n)). */
function lis(keys: (string | undefined)[]): Set<number> {
  const tails: number[] = [], prev = new Array<number>(keys.length).fill(-1)
  keys.forEach((k, i) => {
    if (k === undefined) return
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[tails[mid]]! < k) lo = mid + 1; else hi = mid }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  })
  const out = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) out.add(i)
  return out
}

/**
 * New keys that make `desired` (ids in their wanted order) sort that way, changing as few keys as possible:
 * the longest run of ids whose current keys already increase keeps its keys; every other id gets a key between
 * its kept neighbours (or the bounds). `current` holds an id's key only if it is valid in this list.
 */
export function rekey(desired: string[], current: Map<string, string>, b: Bounds): Map<string, string> {
  const keys = desired.map((id) => { const k = current.get(id); return within(k, b) ? k : undefined })
  const keep = lis(keys)
  const out = new Map<string, string>()
  let i = 0
  while (i < desired.length) {
    if (keep.has(i)) { i++; continue }
    let j = i
    while (j < desired.length && !keep.has(j)) j++
    const lo = i > 0 ? (out.get(desired[i - 1]) ?? keys[i - 1]!) : b.lo
    const hi = j < desired.length ? keys[j]! : b.hi
    generateNKeysBetween(lo, hi, j - i).forEach((k, n) => out.set(desired[i + n], k))
    i = j
  }
  return out
}

/** A key after every key in `keys` (within bounds): "bring to front", "append". */
export function keyAfter(keys: (string | undefined)[], b: Bounds): string {
  const max = keys.filter((k): k is string => within(k, b)).sort().pop() ?? b.lo
  return generateKeyBetween(max, b.hi)
}
/** A key before every key in `keys` (within bounds): "send to back". */
export function keyBefore(keys: (string | undefined)[], b: Bounds): string {
  const min = keys.filter((k): k is string => within(k, b)).sort()[0] ?? b.hi
  return generateKeyBetween(b.lo, min)
}

/**
 * The repair for equal keys (two replicas minted the same key between the same neighbours). Deterministic in the
 * state alone, so replicas that repair the same state write the same values and converge; the first id of a run of
 * equal keys keeps its key, the others take keys between it and the next distinct key.
 */
export function repairCollisions<T extends { id: string }>(items: T[], key: (t: T) => string | undefined, b: Bounds): Map<string, string> {
  const sorted = items.filter((t) => within(key(t), b)).sort(byKey(key))
  const out = new Map<string, string>()
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && key(sorted[j]) === key(sorted[i])) j++
    if (j - i > 1) {
      const hi = j < sorted.length ? key(sorted[j])! : b.hi
      generateNKeysBetween(key(sorted[i])!, hi, j - i - 1).forEach((k, n) => out.set(sorted[i + 1 + n].id, k))
    }
    i = j
  }
  return out
}
