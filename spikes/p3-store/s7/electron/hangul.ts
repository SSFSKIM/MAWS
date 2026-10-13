// S7b: a copy of S4's Korean 2-set keystroke model (spikes/p3-store/s4/electron/hangul.ts, read 2026-10-12), unchanged
// below this header, so the IME-under-load run drives the same event shape as S4.
// S4: a Korean 2-set (Dubeolsik) keystroke model producing the IME event shape of the owner's capture
// (docs/doperpowers/evidence/p2-finish/owner-ime-capture-2026-10-12-events.txt): keydown 229 per jamo, composition
// updates through jamo to syllables, a commit (compositionend) and an immediate restart when the next keystroke
// cannot join the syllable (한 + ㄱ → commit 한, start ㄱ), the final consonant migrating to the next syllable on a
// vowel (한 + ㅏ → commit 하, start 나), Backspace inside a composition removing one jamo. No compound jamo.
// Throwaway spike code.

const L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const T = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'
// the key each jamo sits on in 2-set (for code / keyCode in the key events)
const KEY: Record<string, string> = { ㄱ: 'r', ㄴ: 's', ㄷ: 'e', ㄹ: 'f', ㅁ: 'a', ㅂ: 'q', ㅅ: 't', ㅇ: 'd', ㅈ: 'w', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g', ㅏ: 'k', ㅑ: 'i', ㅓ: 'j', ㅕ: 'u', ㅗ: 'h', ㅛ: 'y', ㅜ: 'n', ㅠ: 'b', ㅡ: 'm', ㅣ: 'l', ㅐ: 'o', ㅔ: 'p' }

const syl = (l: string, v: string, t = ' ') => String.fromCharCode(0xac00 + (L.indexOf(l) * 21 + V.indexOf(v)) * 28 + T.indexOf(t))

/** Decompose a precomposed syllable into its jamo keystrokes. */
const jamo = (ch: string): string[] => {
  const c = ch.charCodeAt(0) - 0xac00
  if (c < 0 || c > 11171) return [ch]
  const l = L[Math.floor(c / 588)]; const v = V[Math.floor((c % 588) / 28)]; const t = T[c % 28]
  return t === ' ' ? [l, v] : [l, v, t]
}

export type Step =
  | { kind: 'key', key: string, code: string, keyCode: number } // keydown 229 (+ keyup after the effect)
  | { kind: 'compose', text: string } // Input.imeSetComposition (start or update)
  | { kind: 'commit', text: string } // Input.insertText while composing → compositionend
  | { kind: 'plain', text: string } // a non-IME character (space)
  | { kind: 'backspace' }

/** The steps for typing `text` (Hangul syllables and spaces), with optional Backspace points: index → after jamo. */
export const keystrokes = (text: string, { backspaceAfter = [] as string[] } = {}): Step[] => {
  const steps: Step[] = []
  let st: { l?: string, v?: string, t?: string } = {}
  const comp = () => (st.l && st.v ? syl(st.l, st.v, st.t) : st.l ?? '')
  const key = (j: string) => { const k = KEY[j] ?? 'x'; steps.push({ kind: 'key', key: j, code: 'Key' + k.toUpperCase(), keyCode: k.toUpperCase().charCodeAt(0) }) }
  for (const ch of text) {
    if (ch === ' ') {
      if (comp()) steps.push({ kind: 'commit', text: comp() }); st = {}
      steps.push({ kind: 'plain', text: ' ' }); continue
    }
    for (const j of jamo(ch)) {
      key(j)
      const isV = V.includes(j)
      if (!isV) {
        if (!st.l) { st = { l: j } } else if (st.l && st.v && !st.t && T.includes(j)) { st.t = j } else { steps.push({ kind: 'commit', text: comp() }); st = { l: j } }
      } else {
        if (st.l && !st.v) st.v = j
        else if (st.l && st.v && st.t) { const carry = st.t; st.t = undefined; steps.push({ kind: 'commit', text: comp() }); st = { l: carry, v: j } } else throw new Error('compound vowel not modelled: ' + ch)
      }
      steps.push({ kind: 'compose', text: comp() })
      if (backspaceAfter.includes(comp())) {
        steps.push({ kind: 'backspace' })
        if (st.t) st.t = undefined; else if (st.v) st.v = undefined; else st = {}
        steps.push({ kind: 'compose', text: comp() })
        // retype the removed jamo
        key(j)
        if (isV) st.v = j; else if (st.l && st.v) st.t = j; else st.l = j
        steps.push({ kind: 'compose', text: comp() })
      }
    }
  }
  if (comp()) steps.push({ kind: 'commit', text: comp() })
  return steps
}
