// A clock time as the app writes it, on whatever locale the app runs (L129: every time the renderer shows goes through
// `formatClock`, Intl's hour and minute for the system locale). Electron's ICU is not the runner's Node's (ko-KR draws
// 오후 2:02 under one and PM 2:02 under the other), so the pattern claims no locale: it is the shape Intl's parts take in
// every locale, the hour's one or two digits and the minute's two in any numbering system, between them a separator
// holding no digit (14:02, 14.02, 14 h 02, ٢:٠٢), and a day period or label of up to three words before or after,
// spaced or not (2:02 PM, 오후 2:02, 下午2:02, 2:02 p.m.). Its `\p{Nd}` needs a RegExp built with the `u` flag.
const WORDS = String.raw`[^\p{Nd}\s]+(?:\s[^\p{Nd}\s]+){0,2}`;
export const CLOCK = String.raw`(?:${WORDS}\s?)?\p{Nd}{1,2}[^\p{Nd}]{1,8}\p{Nd}{2}(?:\s?${WORDS})?`;
