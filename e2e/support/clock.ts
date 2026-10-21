// A clock time as the app writes it, on whatever locale the app runs (L129: every time the renderer shows goes through
// `formatClock`, Intl's hour and minute for the system locale). Electron's ICU is not the runner's Node's (ko-KR draws
// 오후 2:02 under one and PM 2:02 under the other), so the pattern claims no locale: it is the shape Intl's parts take in
// every locale, the hour's one or two digits and the minute's two in any numbering system, between them one of the
// separators Intl draws (14:02, ٢:٠٢, 14.02, fr-CA's 14 h 02, and Dzongkha's under Node), and a day period or label of
// up to three words before, spaced or not (오후 2:02, 下午2:02), or after a space (2:02 PM, 2:02 p.m.).
// test/support/clock.test.ts holds it to every locale and to the app's own dates, which it rejects but for a month and
// day spelled as a dotted time (bg's 28.12), which no pattern that names no locale can tell from fi-FI's 14.02.
// Its `\p{Nd}` needs a RegExp built with the `u` flag.
const WORDS = String.raw`[^\p{Nd}\s]+(?:\s[^\p{Nd}\s]+){0,2}`;
const SEPARATOR = String.raw`(?::|\.|\sh\s|\sསྐར་མ་\s)`;
export const CLOCK = String.raw`(?:${WORDS}\s?)?\p{Nd}{1,2}${SEPARATOR}\p{Nd}{2}(?:\s${WORDS})?`;
