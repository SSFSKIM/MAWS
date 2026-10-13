// S7a (P3-0): one artifact's retained store on `node:sqlite` (WAL, synchronous=FULL, auto_vacuum=INCREMENTAL), the S2
// layout (spikes/p3-store/s2/v14/host/storage.ts: `updates` V1 rows, `versions` V2, ContentMap provenance rows, actors)
// extended with the §4.2 version record (kind, label, summary, the design-system pin, asset refs) and the policy under
// test: version encodings (`full`: every version a full V2 state, the spec as written; `delta`: a version is a V2 delta
// from the previous retained version, with keyframes, plus one `head` checkpoint for loading), version thinning by age,
// log compaction, provenance floored at write and merged into hour and day rows, and reference-counted assets and
// design-system states (stubbed as sizes: their bytes live as files under artifacts/<id>/).
// Throwaway spike code; the copy target for P3-A is the policy, not this file.
import { DatabaseSync } from 'node:sqlite'
import { statSync, existsSync, rmSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import * as Y from '@y/y'

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY
const MONDAY0 = Date.UTC(2026, 0, 5) // a Monday: ISO-week buckets start here
const floor = (t, g) => t - (((t % g) + g) % g)
const weekOf = t => MONDAY0 + floor(t - MONDAY0, WEEK)

const attr = (n, v) => Y.createContentAttribute(n, v)
/** One update's provenance (S1/S3's attribution build) from its content ids, time already floored by the caller. */
export const contentMapOfIds = (ids, actor, at) => Y.createContentMapFromContentIds(ids, [attr('insert', actor), attr('insertAt', at)], [attr('delete', actor), attr('deleteAt', at)])

/** Rebucket a ContentMap's times to `g` (s2/v14/yjs.ts `bucketAttribution`, copied). */
export const coarsen = (map, g) => {
  const re = idmap => {
    const out = Y.createIdMap()
    idmap.forEach((range, client) => out.add(client, range.clock, range.len, (range.attrs ?? []).map(a => (a.name.endsWith('At') && typeof a.val === 'number' ? attr(a.name, floor(a.val, g)) : a))))
    return out
  }
  return Y.createContentMap(re(map.inserts), re(map.deletes))
}

export const POLICY = {
  encoding: 'delta', // 'full' | 'delta'
  provGrain: MIN, // provenance times floored at write
  provHourAfter: DAY, // per-update rows merged into hour rows after this age (lossless at provGrain)
  provDayAfter: 30 * DAY, // hour rows merged into day rows after this age (lossless at provGrain)
  provDayGrain: MIN, // the time granularity kept in day rows (MIN = lossless; HOUR or DAY coarsen)
  logKeep: 7 * DAY, // update rows covered by a version are kept this long
  thin: [[DAY, 0], [7 * DAY, HOUR], [30 * DAY, DAY], [Infinity, WEEK]], // [age below, bucket] for auto and turn rows (0 = keep all)
  thinKinds: ['auto', 'turn'],
  headTailRows: 1000, // delta mode: rewrite the head checkpoint when the log tail behind it reaches this many rows …
  headTailBytes: 256 * 1024, // … or this many bytes
  keyframeRatio: 1.0 // delta mode: a version is stored full when the deltas since the last keyframe would exceed this × its size
}

export class Store {
  constructor (path, policy = {}, { truthPath = null, fresh = true } = {}) {
    this.policy = { ...POLICY, ...policy }
    this.path = path
    if (fresh) for (const p of [path, path + '-wal', path + '-shm']) if (existsSync(p)) rmSync(p)
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
        label TEXT, summary TEXT, ds_ref TEXT, asset_refs TEXT, enc TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS head (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS provenance (from_seq INTEGER PRIMARY KEY, to_seq INTEGER NOT NULL, from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL, tier TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS provenance_to ON provenance (to_seq);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ds_states (ref TEXT PRIMARY KEY, size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actors (key TEXT PRIMARY KEY);
    `)
    this.st = new Map()
    this.open = false
    this.seq = 0
    this.pendingRows = 0
    this.sinceIds = [] // content ids of updates since the last version (delta mode)
    this.sinceActors = new Set()
    this.prevSV = null // state vector at the last version (delta mode)
    this.chainBytes = 0 // delta bytes since the last keyframe
    this.lastFullSize = 0
    this.head = { seq: 0, tailRows: 0, tailBytes: 0 }
    this.counters = { versionMs: 0, versions: 0, headWrites: 0, headBytesWritten: 0, versionBytesWritten: 0, landMs: 0, lands: 0, keyframes: 0 }
    this.truth = null
    if (truthPath) {
      for (const p of [truthPath, truthPath + '-wal', truthPath + '-shm']) if (existsSync(p)) rmSync(p)
      this.truth = new DatabaseSync(truthPath)
      this.truth.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; CREATE TABLE t (seq INTEGER PRIMARY KEY, at INTEGER, actor TEXT, bytes BLOB);')
      this.truthIns = this.truth.prepare('INSERT INTO t (seq, at, actor, bytes) VALUES (?, ?, ?, ?)')
    }
  }

  sql (text) { let s = this.st.get(text); if (!s) this.st.set(text, (s = this.db.prepare(text))); return s }
  begin () { if (!this.open) { this.db.exec('BEGIN IMMEDIATE'); this.open = true; this.truth?.exec('BEGIN') } }
  commit () { if (this.open) { this.db.exec('COMMIT'); this.open = false; this.pendingRows = 0; this.truth?.exec('COMMIT') } }

  /** An integrated update (V1, as the wire and S2's log carry it): its log row and its provenance row, in one batch. */
  land (v1, actor, at) {
    const t0 = performance.now()
    this.begin()
    const seq = ++this.seq
    this.sql('INSERT INTO updates (seq, at, actor, bytes) VALUES (?, ?, ?, ?)').run(seq, at, actor, v1)
    const ids = Y.createContentIdsFromUpdate(v1)
    const fat = floor(at, this.policy.provGrain)
    this.sql('INSERT INTO provenance (from_seq, to_seq, from_at, to_at, tier, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(seq, seq, fat, fat, 'update', Y.encodeContentMap(contentMapOfIds(ids, actor, fat)))
    if (this.truth) this.truthIns.run(seq, at, actor, Y.encodeContentMap(contentMapOfIds(ids, actor, at)))
    if (!this.actorsSeen?.has(actor)) { (this.actorsSeen ??= new Set()).add(actor); this.sql('INSERT OR IGNORE INTO actors (key) VALUES (?)').run(actor) }
    if (this.policy.encoding === 'delta') this.sinceIds.push(ids)
    this.sinceActors.add(actor)
    this.head.tailRows++; this.head.tailBytes += v1.length
    if (++this.pendingRows >= 2000) this.commit()
    this.counters.landMs += performance.now() - t0; this.counters.lands++
    return seq
  }

  /** A version of the live doc at the current seq. Returns the row's facts or null when nothing changed since the last. */
  version (doc, { at, actor, kind, label = null, dsRef = null, assetRefs = [] }) {
    const last = this.sql('SELECT seq FROM versions ORDER BY seq DESC LIMIT 1').get()
    if (label === null && kind === 'named') label = 'Named'
    if (last && last.seq === this.seq) {
      // nothing changed since the last row: naming it (or marking it the restore) relabels that row
      if (kind !== 'named' && kind !== 'restore') return null
      this.begin(); this.sql('UPDATE versions SET kind = ?, label = ?, actor = ? WHERE seq = ?').run(kind, label, actor, this.seq); this.commit()
      return { seq: this.seq, enc: 'relabel', bytes: 0 }
    }
    const t0 = performance.now()
    this.begin()
    const summary = JSON.stringify([...this.sinceActors])
    let enc = 'full'; let bytes
    if (this.policy.encoding === 'full' || !this.prevSV) {
      bytes = Y.encodeStateAsUpdateV2(doc)
    } else {
      // the structs since the last version (gc'd: content inserted and deleted since is ContentDeleted) and only the
      // deletions made since, so the delta does not repeat the whole delete set every time
      const u = Y.encodeStateAsUpdateV2(doc, this.prevSV)
      const since = Y.mergeContentIds(this.sinceIds)
      bytes = Y.intersectUpdateWithContentIdsV2(u, Y.createContentIds(Y.createContentIdsFromUpdateV2(u).inserts, since.deletes))
      enc = 'delta'
      if (this.chainBytes + bytes.length > this.policy.keyframeRatio * this.lastFullSize) { bytes = Y.encodeStateAsUpdateV2(doc); enc = 'full' }
    }
    if (enc === 'full') { this.chainBytes = 0; this.lastFullSize = bytes.length; this.counters.keyframes++ } else this.chainBytes += bytes.length
    this.sql('INSERT INTO versions (seq, at, actor, kind, label, summary, ds_ref, asset_refs, enc, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.seq, at, actor, kind, label, summary, dsRef, JSON.stringify(assetRefs), enc, bytes)
    this.counters.versionBytesWritten += bytes.length
    if (this.policy.encoding === 'delta') {
      this.prevSV = Y.encodeStateVector(doc)
      this.sinceIds = []
      if (this.head.tailRows >= this.policy.headTailRows || this.head.tailBytes >= this.policy.headTailBytes || this.head.seq === 0) {
        const state = enc === 'full' ? bytes : Y.encodeStateAsUpdateV2(doc)
        this.sql('INSERT INTO head (id, seq, bytes) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET seq = excluded.seq, bytes = excluded.bytes').run(this.seq, state)
        this.head = { seq: this.seq, tailRows: 0, tailBytes: 0 }
        this.counters.headWrites++; this.counters.headBytesWritten += state.length
      }
    } else {
      this.head = { seq: this.seq, tailRows: 0, tailBytes: 0 }
    }
    this.sinceActors = new Set()
    this.commit()
    this.counters.versionMs += performance.now() - t0; this.counters.versions++
    return { seq: this.seq, enc, bytes: bytes.length }
  }

  /** Open the doc from the store: the head (delta) or newest version (full) plus the log tail. */
  load () {
    this.commit()
    const base = this.policy.encoding === 'delta'
      ? this.sql('SELECT seq, bytes FROM head WHERE id = 1').get()
      : this.sql("SELECT seq, bytes FROM versions WHERE enc = 'full' ORDER BY seq DESC LIMIT 1").get()
    const tail = this.sql('SELECT bytes FROM updates WHERE seq > ? ORDER BY seq').all(base.seq)
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, base.bytes)
    for (const r of tail) Y.applyUpdate(doc, r.bytes)
    return { doc, baseBytes: base.bytes.length, tailRows: tail.length }
  }

  versions () { this.commit(); return this.sql('SELECT seq, at, actor, kind, label, enc, length(bytes) AS size, ds_ref, asset_refs FROM versions ORDER BY seq').all() }

  /** A retained version's full state (V2): its own bytes, or its keyframe merged with the deltas after it. */
  stateAt (seq) {
    this.commit()
    const kf = this.sql("SELECT seq, bytes FROM versions WHERE enc = 'full' AND seq <= ? ORDER BY seq DESC LIMIT 1").get(seq)
    if (kf.seq === seq) return { state: kf.bytes, chain: 0 }
    const deltas = this.sql('SELECT bytes FROM versions WHERE seq > ? AND seq <= ? ORDER BY seq').all(kf.seq, seq).map(r => r.bytes)
    return { state: Y.mergeUpdatesV2([kf.bytes, ...deltas]), chain: deltas.length }
  }

  /** Provenance rows touching the seq window (from, to], merged; `all` merges every row. */
  attributions (fromSeqExcl = 0) {
    this.commit()
    const rows = this.sql('SELECT bytes FROM provenance WHERE to_seq > ? ORDER BY from_seq').all(fromSeqExcl)
    return { map: Y.mergeContentMaps(rows.map(r => Y.decodeContentMap(r.bytes))), rows: rows.length }
  }

  // ── the maintenance pass ──

  /** Thin `auto` and `turn` rows by age; keep named, restore, import, the newest row and `pinned` seqs. */
  thin (now, pinned = new Set()) {
    const rows = this.versions()
    if (!rows.length) return { dropped: 0, rebased: 0 }
    const newest = rows[rows.length - 1].seq
    const keep = new Set()
    const bucketWinner = new Map()
    for (const r of rows) {
      if (!this.policy.thinKinds.includes(r.kind) || r.seq === newest || pinned.has(r.seq)) { keep.add(r.seq); continue }
      const age = now - r.at
      const [, g] = this.policy.thin.find(([lim]) => age < lim)
      if (g === 0) { keep.add(r.seq); continue }
      const key = g === WEEK ? 'w' + weekOf(r.at) : g + ':' + floor(r.at, g)
      bucketWinner.set(key, r.seq) // rows ascend, so the last is the bucket's newest
    }
    for (const s of bucketWinner.values()) keep.add(s)
    const drop = rows.filter(r => !keep.has(r.seq))
    if (!drop.length) return { dropped: 0, rebased: 0 }
    this.begin()
    let rebased = 0
    if (this.policy.encoding === 'delta') {
      // fold each dropped row into the next retained one (a dropped keyframe makes the next row a keyframe)
      let carry = []; let carryFull = false
      for (const r of rows) {
        if (!keep.has(r.seq)) {
          const b = this.sql('SELECT bytes FROM versions WHERE seq = ?').get(r.seq).bytes
          if (r.enc === 'full') { carry = [b]; carryFull = true } else carry.push(b)
          continue
        }
        if (!carry.length) continue
        const own = this.sql('SELECT bytes FROM versions WHERE seq = ?').get(r.seq).bytes
        if (r.enc === 'full') { carry = []; carryFull = false; continue }
        let merged = Y.mergeUpdatesV2([...carry, own]); let enc = 'delta'
        if (carryFull) { const d = new Y.Doc(); Y.applyUpdateV2(d, merged); merged = Y.encodeStateAsUpdateV2(d); d.destroy(); enc = 'full' }
        this.sql('UPDATE versions SET bytes = ?, enc = ? WHERE seq = ?').run(merged, enc, r.seq)
        rebased++; carry = []; carryFull = false
      }
    }
    const del = this.sql('DELETE FROM versions WHERE seq = ?')
    for (const r of drop) del.run(r.seq)
    this.commit()
    return { dropped: drop.length, rebased }
  }

  /** Delete update rows older than `logKeep` that a retained state covers (the head in delta mode, the newest version in full). */
  compactLog (now) {
    this.commit()
    const covered = this.policy.encoding === 'delta' ? this.sql('SELECT seq FROM head WHERE id = 1').get()?.seq ?? 0 : this.sql('SELECT MAX(seq) AS s FROM versions').get().s ?? 0
    const r = this.sql('DELETE FROM updates WHERE seq <= ? AND at < ?').run(covered, now - this.policy.logKeep)
    return { deleted: Number(r.changes) }
  }

  /** Merge provenance rows: per-update rows into hour rows after `provHourAfter`, hour rows into day rows after `provDayAfter`. */
  bucketProvenance (now) {
    this.commit()
    let merged = 0; let written = 0
    const pass = (tier, before, g, nextTier, grain) => {
      const rows = this.sql('SELECT from_seq, to_seq, from_at, to_at, bytes FROM provenance WHERE tier = ? AND to_at < ? ORDER BY from_seq').all(tier, before)
      if (!rows.length) return
      const groups = new Map()
      for (const r of rows) { const k = floor(r.from_at, g); let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(r) }
      this.begin()
      const del = this.sql('DELETE FROM provenance WHERE from_seq = ?')
      const ins = this.sql('INSERT INTO provenance (from_seq, to_seq, from_at, to_at, tier, bytes) VALUES (?, ?, ?, ?, ?, ?)')
      for (const rs of groups.values()) {
        let map = Y.mergeContentMaps(rs.map(r => Y.decodeContentMap(r.bytes)))
        if (grain > this.policy.provGrain) map = coarsen(map, grain)
        for (const r of rs) del.run(r.from_seq)
        ins.run(rs[0].from_seq, Math.max(...rs.map(r => r.to_seq)), Math.min(...rs.map(r => r.from_at)), Math.max(...rs.map(r => r.to_at)), nextTier, Y.encodeContentMap(map))
        merged += rs.length; written++
      }
      this.commit()
    }
    pass('update', now - this.policy.provHourAfter, HOUR, 'hour', this.policy.provGrain)
    pass('hour', now - this.policy.provDayAfter, DAY, 'day', this.policy.provDayGrain)
    return { merged, written }
  }

  /** Assets and design-system states kept while the live artifact or a retained version references them. */
  gcRefs (liveAssets, liveDs) {
    this.commit()
    const assets = new Set(liveAssets); const ds = new Set([liveDs])
    for (const r of this.sql('SELECT ds_ref, asset_refs FROM versions').all()) { ds.add(r.ds_ref); for (const a of JSON.parse(r.asset_refs)) assets.add(a) }
    this.begin()
    let dropped = 0
    for (const r of this.sql('SELECT id FROM assets').all()) if (!assets.has(r.id)) { this.sql('DELETE FROM assets WHERE id = ?').run(r.id); dropped++ }
    for (const r of this.sql('SELECT ref FROM ds_states').all()) if (!ds.has(r.ref)) { this.sql('DELETE FROM ds_states WHERE ref = ?').run(r.ref); dropped++ }
    this.commit()
    return { dropped }
  }
  addAsset (id, size) { this.begin(); this.sql('INSERT OR IGNORE INTO assets (id, size) VALUES (?, ?)').run(id, size) }
  addDs (ref, size) { this.begin(); this.sql('INSERT OR IGNORE INTO ds_states (ref, size) VALUES (?, ?)').run(ref, size) }

  /** WAL checkpoint and incremental vacuum (returns freed pages to the file system). */
  checkpoint () {
    this.commit()
    this.db.exec('PRAGMA incremental_vacuum;')
    this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
  }

  /** The whole nightly pass, each step timed. */
  maintain (now, { pinned, liveAssets, liveDs }) {
    const steps = {}
    const time = (name, fn) => { const t0 = performance.now(); const r = fn(); steps[name] = { ms: +(performance.now() - t0).toFixed(1), ...r }; return r }
    time('thin', () => this.thin(now, pinned))
    time('compactLog', () => this.compactLog(now))
    time('bucketProvenance', () => this.bucketProvenance(now))
    time('gcRefs', () => this.gcRefs(liveAssets, liveDs))
    time('checkpoint', () => { this.checkpoint(); return {} })
    return steps
  }

  // ── measurement ──
  sizes () {
    this.commit()
    const one = (q) => this.sql(q).get()
    const t = {
      log: one('SELECT COUNT(*) AS rows, COALESCE(SUM(length(bytes)), 0) AS bytes FROM updates'),
      versions: one('SELECT COUNT(*) AS rows, COALESCE(SUM(length(bytes)), 0) AS bytes FROM versions'),
      head: one('SELECT COUNT(*) AS rows, COALESCE(SUM(length(bytes)), 0) AS bytes FROM head'),
      provenance: one('SELECT COUNT(*) AS rows, COALESCE(SUM(length(bytes)), 0) AS bytes FROM provenance'),
      assets: one('SELECT COUNT(*) AS rows, COALESCE(SUM(size), 0) AS bytes FROM assets'),
      ds: one('SELECT COUNT(*) AS rows, COALESCE(SUM(size), 0) AS bytes FROM ds_states')
    }
    const pages = Object.fromEntries(this.sql('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all().map(r => [r.name, r.bytes]))
    const kinds = Object.fromEntries(this.sql('SELECT kind, COUNT(*) AS n FROM versions GROUP BY kind').all().map(r => [r.kind, r.n]))
    const encs = Object.fromEntries(this.sql('SELECT enc, COUNT(*) AS n, SUM(length(bytes)) AS b FROM versions GROUP BY enc').all().map(r => [r.enc, { n: r.n, bytes: r.b }]))
    const tiers = Object.fromEntries(this.sql('SELECT tier, COUNT(*) AS n, SUM(length(bytes)) AS b FROM provenance GROUP BY tier').all().map(r => [r.tier, { n: r.n, bytes: r.b }]))
    const freelist = this.sql('PRAGMA freelist_count').get().freelist_count
    this.checkpoint()
    const file = statSync(this.path).size
    const wal = existsSync(this.path + '-wal') ? statSync(this.path + '-wal').size : 0
    return { tables: t, pages, kinds, encs, tiers, file, wal, freelistPages: freelist }
  }

  /** Every exact (unfloored) provenance row that touches `ids`, merged: the truth "Show editors" is checked against. */
  truthFor (ids) {
    this.commit()
    const hits = []
    for (const r of this.truth.prepare('SELECT bytes FROM t').iterate()) {
      const m = Y.intersectContentMap(Y.decodeContentMap(r.bytes), ids)
      if (!m.inserts.isEmpty() || !m.deletes.isEmpty()) hits.push(m)
    }
    return Y.mergeContentMaps(hits)
  }

  close () { this.commit(); this.db.close(); this.truth?.close() }
}
