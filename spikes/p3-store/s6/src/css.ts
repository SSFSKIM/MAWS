// The inline-style half of the dialect: Claude's closed property list (T/slides/artifact-type/reference/format.md:9-67)
// plus Decision Log 12's var(--ds-*) superset, parsed into a property map and normalized to one canonical form.
// Pure; no DOM, no Yjs.

import type { Diagnostic, Style } from './ir.ts'

/** How a property's value normalizes. `len*` kinds turn bare numbers into px; `num` kinds keep them bare. */
type Kind =
  | 'len' // one LEN | PCT | keyword | calc() | var(--ds-space-*)
  | 'lens' // 1-4 LENs (padding, border-radius), compressed to the shortest equal form
  | 'num' // a bare number
  | 'weight' // 100-900 | normal | bold
  | 'color'
  | 'family'
  | 'lineheight' // N stays bare, PCT, LEN
  | 'kw' // one keyword from a closed set
  | 'border' // [LEN] style [COLOR], defaults filled per Claude's grammar
  | 'lenvalue' // a generic value whose bare numbers are lengths (shadows, text-stroke)
  | 'value' // a generic value whose bare numbers stay numbers (flex, transform, filter, background, tracks)

interface Prop { kind: Kind; kw?: readonly string[] }

const ALIGN = ['start', 'center', 'end', 'stretch', 'baseline', 'flex-start', 'flex-end']

/**
 * Claude's table in its own order. The canonical serializer writes properties in this order, which also puts every
 * shorthand before its longhands (border before border-top, background before background-clip, flex before flex-grow),
 * so the exploded map serializes back with the cascade meaning it was parsed with.
 */
export const PROPS: ReadonlyMap<string, Prop> = new Map<string, Prop>([
  ['position', { kind: 'kw', kw: ['absolute', 'relative'] }],
  ['left', { kind: 'len' }], ['top', { kind: 'len' }], ['right', { kind: 'len' }], ['bottom', { kind: 'len' }],
  ['width', { kind: 'len' }], ['height', { kind: 'len' }],
  ['min-width', { kind: 'len' }], ['min-height', { kind: 'len' }], ['max-width', { kind: 'len' }], ['max-height', { kind: 'len' }],
  ['display', { kind: 'kw', kw: ['flex', 'grid', 'none'] }],
  ['flex-direction', { kind: 'kw', kw: ['row', 'column', 'row-reverse', 'column-reverse'] }],
  ['flex-wrap', { kind: 'kw', kw: ['wrap', 'nowrap'] }],
  ['gap', { kind: 'len' }],
  ['align-items', { kind: 'kw', kw: ALIGN }],
  ['justify-content', { kind: 'kw', kw: ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'flex-start', 'flex-end'] }],
  ['justify-items', { kind: 'kw', kw: ALIGN.filter((a) => a !== 'baseline') }],
  ['align-self', { kind: 'kw', kw: [...ALIGN, 'auto'] }],
  ['justify-self', { kind: 'kw', kw: [...ALIGN.filter((a) => a !== 'baseline'), 'auto'] }],
  ['flex', { kind: 'value' }], ['flex-grow', { kind: 'num' }], ['flex-shrink', { kind: 'num' }], ['flex-basis', { kind: 'len' }],
  ['grid-template-columns', { kind: 'value' }], ['grid-template-rows', { kind: 'value' }],
  ['grid-column', { kind: 'value' }], ['grid-row', { kind: 'value' }],
  ['aspect-ratio', { kind: 'value' }],
  ['padding', { kind: 'lens' }],
  ['overflow', { kind: 'kw', kw: ['hidden', 'visible'] }],
  ['font-family', { kind: 'family' }],
  ['font-size', { kind: 'len' }],
  ['font-weight', { kind: 'weight' }],
  ['font-style', { kind: 'kw', kw: ['normal', 'italic'] }],
  ['line-height', { kind: 'lineheight' }],
  ['letter-spacing', { kind: 'len' }],
  ['text-align', { kind: 'kw', kw: ['left', 'center', 'right', 'justify'] }],
  ['text-transform', { kind: 'kw', kw: ['none', 'uppercase', 'lowercase', 'capitalize'] }],
  ['white-space', { kind: 'kw', kw: ['normal', 'nowrap'] }],
  ['text-decoration', { kind: 'value' }],
  ['font-variant-numeric', { kind: 'kw', kw: ['normal', 'tabular-nums'] }],
  ['-webkit-text-stroke', { kind: 'lenvalue' }],
  ['color', { kind: 'color' }],
  ['background', { kind: 'value' }],
  ['background-clip', { kind: 'value' }],
  ['-webkit-text-fill-color', { kind: 'color' }],
  ['border', { kind: 'border' }],
  ['border-top', { kind: 'border' }], ['border-right', { kind: 'border' }], ['border-bottom', { kind: 'border' }], ['border-left', { kind: 'border' }],
  // not lines of the table, but format.md's connector paragraph styles x-connector with them ("border-width (2px default, ≤32); border-style:dashed|dotted")
  ['border-width', { kind: 'len' }], ['border-style', { kind: 'kw', kw: ['solid', 'dashed', 'dotted', 'double', 'none'] }],
  ['border-radius', { kind: 'lens' }],
  ['box-shadow', { kind: 'lenvalue' }], ['text-shadow', { kind: 'lenvalue' }],
  ['opacity', { kind: 'num' }],
  ['transform', { kind: 'value' }],
  ['filter', { kind: 'value' }], ['backdrop-filter', { kind: 'value' }],
  ['mix-blend-mode', { kind: 'kw', kw: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] }],
  ['object-fit', { kind: 'kw', kw: ['cover', 'contain'] }],
])
const PROP_RANK = new Map([...PROPS.keys()].map((k, i) => [k, i]))

/** A shorthand declared after its longhands resets them (the CSS cascade inside one style attribute). */
const RESETS: Record<string, readonly string[]> = {
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style'],
  background: ['background-clip'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
}
const SIDES = ['top', 'right', 'bottom', 'left'] as const
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

/** Accepted as no-ops only (Claude): dropped silently at these values, with a warning otherwise. */
const NOOPS: Record<string, (v: string) => boolean> = {
  margin: (v) => v.split(/\s+/).every((p) => /^0(px)?$/.test(p)),
  'margin-top': (v) => /^0(px)?$/.test(v), 'margin-right': (v) => /^0(px)?$/.test(v),
  'margin-bottom': (v) => /^0(px)?$/.test(v), 'margin-left': (v) => /^0(px)?$/.test(v),
  'box-sizing': (v) => v === 'border-box',
  'grid-template': (v) => v === 'none',
}

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
  'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise ' +
  'darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod ' +
  'gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral ' +
  'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
  'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
  'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '))
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui'])

// ---------------------------------------------------------------- tokens

type Tok =
  | { t: 'word'; v: string } // identifiers, numbers with units, hashes, operators like + -
  | { t: 'str'; v: string } // a quoted string, unquoted content
  | { t: 'fn'; name: string; args: Tok[] }
  | { t: 'comma' } | { t: 'slash' }

function tokenize(src: string): Tok[] {
  let i = 0
  const read = (stopAtParen: boolean): Tok[] => {
    const out: Tok[] = []
    while (i < src.length) {
      const c = src[i]
      if (/\s/.test(c)) { i++; continue }
      if (c === ')') { if (stopAtParen) { i++; return out } i++; continue }
      if (c === ',') { out.push({ t: 'comma' }); i++; continue }
      if (c === '/') { out.push({ t: 'slash' }); i++; continue }
      if (c === '"' || c === "'") {
        let j = i + 1, v = ''
        while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) j++; v += src[j]; j++ }
        out.push({ t: 'str', v }); i = j + 1; continue
      }
      let j = i
      while (j < src.length && !/[\s,/()"']/.test(src[j])) j++
      const word = src.slice(i, j)
      if (src[j] === '(') {
        i = j + 1
        const name = word.toLowerCase()
        if (name === 'url') { // keep url() content verbatim
          let k = i; while (k < src.length && src[k] !== ')') k++
          out.push({ t: 'fn', name, args: [{ t: 'str', v: src.slice(i, k).trim().replace(/^['"]|['"]$/g, '') }] }); i = k + 1; continue
        }
        out.push({ t: 'fn', name, args: read(true) }); continue
      }
      if (word === '') { i++; continue }
      out.push({ t: 'word', v: word }); i = j
    }
    return out
  }
  return read(false)
}

// ---------------------------------------------------------------- scalar normalizers

const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i
export function fmtNum(n: number): string { const s = String(n); return s === '-0' ? '0' : s }

/** A number with an optional unit; bare numbers become px when `bareIsPx`; pt converts at the slide scale (1px = 0.5pt). */
function normNumber(w: string, bareIsPx: boolean): string | null {
  const m = NUM_RE.exec(w)
  if (!m) return null
  let n = Number(m[1]); let unit = m[2].toLowerCase()
  if (unit === 'pt') { n = n * 2; unit = 'px' }
  if (unit === '' && bareIsPx) unit = 'px'
  return fmtNum(n) + unit
}

function hex2(n: number): string { return Math.round(n).toString(16).padStart(2, '0') }

/** Canonical colour: lowercase 6/8-digit hex for exact sRGB values, normalized rgba()/hsl[a]() otherwise, lowercase names. */
export function normColor(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (v === 'transparent') return v
  if (NAMED.has(v)) return v
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6)
    return '#' + h
  }
  m = /^(rgba?|hsla?)\((.*)\)$/.exec(v)
  if (!m) return null
  const parts = m[2].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) return null
  const alphaRaw = parts[3]
  let alpha = 1
  if (alphaRaw !== undefined) {
    const am = NUM_RE.exec(alphaRaw); if (!am) return null
    alpha = am[2] === '%' ? Number(am[1]) / 100 : Number(am[1])
  }
  if (m[1].startsWith('rgb')) {
    const ch = parts.slice(0, 3).map((p) => { const pm = NUM_RE.exec(p); if (!pm) return NaN; return pm[2] === '%' ? Number(pm[1]) * 2.55 : Number(pm[1]) })
    if (ch.some((c) => Number.isNaN(c))) return null
    const exact = ch.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
    if (exact && alpha === 1) return '#' + ch.map(hex2).join('')
    return `rgba(${ch.map(fmtNum).join(', ')}, ${fmtNum(alpha)})`
  }
  const [h, s, l] = parts
  const hn = normNumber(h, false); const sn = normNumber(s, false); const ln = normNumber(l, false)
  if (!hn || !sn || !ln) return null
  return alpha === 1 ? `hsl(${hn.replace(/deg$/, '')}, ${sn}, ${ln})` : `hsla(${hn.replace(/deg$/, '')}, ${sn}, ${ln}, ${fmtNum(alpha)})`
}

/** var(--ds-*) is the one var() the dialect allows (Decision Log 12), optionally with a fallback. */
function normVar(fn: Extract<Tok, { t: 'fn' }>, bareIsPx: boolean): string | null {
  const [name, ...rest] = fn.args
  if (!name || name.t !== 'word' || !/^--ds-[a-z0-9-]+$/.test(name.v)) return null
  if (rest.length === 0) return `var(${name.v})`
  if (rest[0].t !== 'comma') return null
  return `var(${name.v}, ${serTokens(rest.slice(1), bareIsPx)})`
}

// ---------------------------------------------------------------- generic value serialization

/** Functions whose bare numeric arguments are lengths; every other function keeps bare numbers bare. */
const LEN_FNS = new Set(['translate', 'translatex', 'translatey', 'blur', 'calc'])
const COLOR_FNS = new Set(['rgb', 'rgba', 'hsl', 'hsla'])

function serTok(t: Tok, bareIsPx: boolean): string {
  switch (t.t) {
    case 'comma': return ','
    case 'slash': return '/'
    case 'str': return `'${t.v.replace(/'/g, "\\'")}'`
    case 'fn': {
      if (COLOR_FNS.has(t.name)) return normColor(`${t.name}(${serTokens(t.args, false)})`) ?? `${t.name}(${serTokens(t.args, false)})`
      if (t.name === 'var') return normVar(t, bareIsPx) ?? 'var(INVALID)'
      if (t.name === 'url') return `url(${(t.args[0] as { v: string }).v})`
      const inner = t.name === 'calc' ? serCalc(t.args) : serTokens(t.args, LEN_FNS.has(t.name))
      return `${t.name}(${inner})`
    }
    case 'word': {
      const v = t.v
      if (v.startsWith('#')) return normColor(v) ?? v.toLowerCase()
      const n = normNumber(v, bareIsPx)
      if (n !== null) return n
      return v.toLowerCase()
    }
  }
}
function serTokens(ts: Tok[], bareIsPx: boolean): string {
  let s = ''
  ts.forEach((t, i) => {
    const part = serTok(t, bareIsPx)
    if (t.t === 'comma') s += ', '
    else if (t.t === 'slash') s += ' / '
    else s += (i === 0 || ts[i - 1].t === 'comma' || ts[i - 1].t === 'slash' ? '' : ' ') + part
  })
  return s.replace(/ {2,}/g, ' ').replace(/ ,/g, ',')
}
function serCalc(ts: Tok[]): string { return ts.map((t) => serTok(t, true)).join(' ') }

function hasInvalidVar(ts: Tok[]): boolean {
  return ts.some((t) => t.t === 'fn' && ((t.name === 'var' && normVar(t, false) === null) || hasInvalidVar(t.args)))
}
function hasCurrentColor(ts: Tok[]): boolean {
  return ts.some((t) => (t.t === 'word' && t.v.toLowerCase() === 'currentcolor') || (t.t === 'fn' && hasCurrentColor(t.args)))
}

// ---------------------------------------------------------------- per-kind normalizers

function normLen(ts: Tok[]): string | null {
  if (ts.length !== 1) return null
  const t = ts[0]
  if (t.t === 'fn' && (t.name === 'var' || t.name === 'calc')) return serTok(t, true)
  if (t.t !== 'word') return null
  const n = normNumber(t.v, true)
  if (n !== null) return /^-?[\d.e+-]+(px|%|em)$/.test(n) ? n : null
  const k = t.v.toLowerCase()
  return ['auto', 'normal', 'min-content', 'max-content'].includes(k) ? k : null
}

function compress4(v: string[]): string[] {
  const [a, b = a, c = a, d = b] = v
  if (d === b) { if (c === a) { if (b === a) return [a]; return [a, b] } return [a, b, c] }
  return [a, b, c, d]
}
function expand4(v: string): string[] { const p = v.split(' '); const [a, b = a, c = a, d = b] = p; return [a, b, c, d] }

function normLens(ts: Tok[]): string | null {
  const parts: string[] = []
  for (const t of ts) { const n = normLen([t]); if (n === null) return null; parts.push(n) }
  if (parts.length < 1 || parts.length > 4) return null
  return compress4(parts).join(' ')
}

function normFamily(ts: Tok[]): string | null {
  const names: string[] = []; let cur: Tok[] = []
  const flush = () => {
    if (cur.length === 0) return
    if (cur.length === 1 && cur[0].t === 'fn' && cur[0].name === 'var') { names.push(serTok(cur[0], false)); cur = []; return }
    const name = cur.map((t) => (t.t === 'str' || t.t === 'word' ? t.v : '')).join(' ').trim()
    const lower = name.toLowerCase()
    if (cur.length === 1 && cur[0].t === 'word' && GENERIC_FAMILIES.has(lower)) names.push(lower)
    else names.push(/^[A-Za-z][A-Za-z-]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`)
    cur = []
  }
  for (const t of ts) { if (t.t === 'comma') flush(); else cur.push(t) }
  flush()
  return names.length ? names.join(', ') : null
}

function normWeight(ts: Tok[]): string | null {
  if (ts.length !== 1 || ts[0].t !== 'word') return null
  const v = ts[0].v.toLowerCase()
  if (v === 'normal') return '400'
  if (v === 'bold') return '700'
  return /^[1-9]00$/.test(v) ? v : null
}

const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none']
/** `[LEN] style [COLOR]` with Claude's defaults (1px, black) made explicit, so the file means the same in any CSS engine. */
function normBorder(ts: Tok[]): string | null {
  let width: string | null = null, style: string | null = null, color: string | null = null
  for (const t of ts) {
    if (t.t === 'word' && BORDER_STYLES.includes(t.v.toLowerCase())) { style = t.v.toLowerCase(); continue }
    const len = normLen([t]); if (len !== null && width === null && !/^(auto|normal)/.test(len)) { width = len; continue }
    const col = t.t === 'fn' && t.name === 'var' ? serTok(t, false) : t.t === 'word' || t.t === 'fn' ? normColor(t.t === 'word' ? t.v : serTok(t, false)) : null
    if (col !== null && color === null) { color = col; continue }
    return null
  }
  if (style === 'none') return 'none'
  if (style === null) return null
  return `${width ?? '1px'} ${style} ${color ?? 'black'}`
}

function normLineHeight(ts: Tok[]): string | null {
  if (ts.length !== 1 || ts[0].t !== 'word') return ts.length === 1 && ts[0].t === 'fn' && ts[0].name === 'var' ? serTok(ts[0], false) : null
  const n = normNumber(ts[0].v, false) // bare stays a multiplier
  return n !== null && /^[\d.-]+(px|%)?$/.test(n) ? n : null
}

// ---------------------------------------------------------------- the style attribute

/** Split a style attribute into declarations, respecting parentheses and quotes (`url(a;b)`, `'a;b'`). */
export function splitDecls(style: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0, quote = '', start = 0
  const push = (end: number) => {
    const d = style.slice(start, end); const i = d.indexOf(':')
    if (i > 0) out.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()])
    start = end + 1
  }
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth === 0) push(i)
  }
  push(style.length)
  return out
}

/** Normalize one value for a property in the table; null = not in the grammar. */
export function normValue(prop: string, value: string): string | null {
  const spec = PROPS.get(prop)
  if (!spec) return null
  const v = value.replace(/\s*!important\s*$/i, '')
  const ts = tokenize(v)
  if (ts.length === 0 || hasInvalidVar(ts)) return null
  if (hasCurrentColor(ts) && prop !== '-webkit-text-fill-color') return null
  switch (spec.kind) {
    case 'len': { const n = normLen(ts); return n !== null && n.endsWith('em') && prop !== 'letter-spacing' ? null : n }
    case 'lens': return normLens(ts)
    case 'num': { if (ts.length !== 1 || ts[0].t !== 'word') return null; const n = normNumber(ts[0].v, false); return n !== null && /^[\d.e+-]+$/.test(n) ? n : null }
    case 'weight': return normWeight(ts)
    case 'color': return ts.length === 1 ? (ts[0].t === 'fn' && ts[0].name === 'var' ? serTok(ts[0], false) : normColor(v)) : null
    case 'family': return normFamily(ts)
    case 'lineheight': return normLineHeight(ts)
    case 'kw': { if (ts.length !== 1 || ts[0].t !== 'word') return null; const k = ts[0].v.toLowerCase(); return spec.kw!.includes(k) ? k : null }
    case 'border': return normBorder(ts)
    case 'lenvalue': return serTokens(ts, true)
    case 'value': return serTokens(ts, false)
  }
}

/**
 * Parse a style attribute into the canonical property map. Applies the cascade inside the attribute (a later
 * declaration wins; a shorthand resets its earlier longhands), folds longhands Claude's list lacks into the
 * shorthands it has (padding-*, border-*-radius, background-color, font), drops no-ops silently and everything
 * else outside the list with a warning.
 */
export function parseStyle(style: string, where: string, diags: Diagnostic[]): Style {
  const out: Style = {}
  const warn = (message: string) => diags.push({ severity: 'warning', where, message })
  const note = (message: string) => diags.push({ severity: 'note', where, message })
  const set = (prop: string, val: string) => {
    for (const lh of RESETS[prop] ?? []) delete out[lh]
    delete out[prop]; out[prop] = val // re-insert so the cascade's last writer is last
  }
  for (const [prop, raw] of splitDecls(style)) {
    if (prop in NOOPS) {
      if (NOOPS[prop](raw.trim().toLowerCase())) note(`${prop}:${raw} dropped (a no-op)`)
      else warn(`${prop}:${raw} dropped (only accepted as a no-op)`)
      continue
    }
    if (prop === 'background-color') {
      const c = normValue('background', raw)
      if (c === null) warn(`background-color:${raw} dropped`)
      else if (out.background === undefined) { set('background', c); note('background-color folded into background') }
      else warn('background-color dropped (background already set)')
      continue
    }
    const side = /^padding-(top|right|bottom|left)$/.exec(prop)
    const corner = /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.exec(prop)
    if (side || corner) {
      const target = side ? 'padding' : 'border-radius'
      const idx = side ? SIDES.indexOf(side[1] as never) : CORNERS.indexOf(corner![1] as never)
      const len = normLen(tokenize(raw))
      if (len === null) { warn(`${prop}:${raw} dropped`); continue }
      const four = expand4(out[target] ?? '0px'); four[idx] = len
      set(target, compress4(four).join(' ')); note(`${prop} folded into ${target}`)
      continue
    }
    if (prop === 'font') { expandFont(raw, set, warn); note('font shorthand expanded into longhands'); continue }
    if (!PROPS.has(prop)) { warn(`unsupported property ${prop} dropped`); continue }
    const val = normValue(prop, raw)
    if (val === null) { warn(`${prop}:${raw} dropped (outside the grammar)`); continue }
    if (prop === 'position' && raw.trim().toLowerCase() === 'static') continue
    set(prop, val)
  }
  return out
}

/** `font: [italic] [weight] LEN[/N] FAMILY` into longhands (only the parts given; see findings on inheritance). */
function expandFont(raw: string, set: (p: string, v: string) => void, warn: (m: string) => void): void {
  const ts = tokenize(raw)
  let i = 0
  while (i < ts.length) {
    const t = ts[i]
    if (t.t !== 'word') break
    const w = t.v.toLowerCase()
    if (w === 'italic' || w === 'normal') { if (w === 'italic') set('font-style', 'italic'); i++; continue }
    const wt = normWeight([t]); if (wt !== null && !/px|pt/.test(w)) { set('font-weight', wt); i++; continue }
    break
  }
  const size = ts[i] ? normLen([ts[i]]) : null
  if (size === null) { warn(`font:${raw} dropped`); return }
  set('font-size', size); i++
  if (ts[i]?.t === 'slash') { const lh = normLineHeight([ts[i + 1]]); if (lh) set('line-height', lh); i += 2 }
  const fam = normFamily(ts.slice(i)); if (fam) set('font-family', fam)
}

/** Canonical style attribute: Claude's table order, `prop:value` joined by `; `. */
export function serializeStyle(style: Style, resolveVar?: (name: string) => string | undefined): string {
  return Object.keys(style)
    .sort((a, b) => (PROP_RANK.get(a) ?? 999) - (PROP_RANK.get(b) ?? 999) || (a < b ? -1 : 1))
    .map((k) => [k, resolveVar ? resolveVars(style[k], resolveVar) : style[k]] as const)
    .filter(([, v]) => v !== null) // a token the resolver lacks, with no fallback: the property is left out
    .map(([k, v]) => `${k}:${v}`)
    .join('; ')
}

/** For the mirror and the Claude-compatible export (Decision Log 21): var(--ds-x[, fb]) to its literal value. */
export function resolveVars(value: string, resolveVar: (name: string) => string | undefined): string | null {
  let missing = false
  const out = value.replace(/var\((--ds-[a-z0-9-]+)(?:,\s*([^)]*))?\)/g, (_, name: string, fb?: string) => {
    const v = resolveVar(name) ?? fb; if (v === undefined) missing = true; return v ?? ''
  })
  return missing ? null : out
}

/** Inline colour on a `span` mark: the colour alone (Claude: "no sizes or fonts on spans"). */
export function spanStyle(style: string, where: string, diags: Diagnostic[]): { color?: string; bold: boolean; italic: boolean; underline: boolean } {
  const out = { bold: false, italic: false, underline: false } as { color?: string; bold: boolean; italic: boolean; underline: boolean }
  for (const [prop, raw] of splitDecls(style)) {
    const v = raw.trim().toLowerCase()
    if (prop === 'color') { const c = normValue('color', raw); if (c) out.color = c; else diags.push({ severity: 'warning', where, message: `span color:${raw} dropped` }) }
    else if (prop === 'font-weight' && (v === 'bold' || Number(v) >= 600)) { out.bold = true; diags.push({ severity: 'note', where, message: 'span font-weight became <b>' }) }
    else if (prop === 'font-style' && v === 'italic') { out.italic = true; diags.push({ severity: 'note', where, message: 'span font-style became <i>' }) }
    else if (prop === 'text-decoration' && v.startsWith('underline')) { out.underline = true; diags.push({ severity: 'note', where, message: 'span underline became <u>' }) }
    else diags.push({ severity: 'warning', where, message: `span ${prop} dropped (spans carry colour only)` })
  }
  return out
}
