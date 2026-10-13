// COPY of spikes/p3-store/s6/exp/bench.ts at 4ab6b9b7 for S7a (edited as s7/soak/copy-sources.mjs describes).
import { claudeExamples } from './claude-examples.ts'
const words = 'pipeline revenue onboarding retention latency quarter forecast margin cohort launch hiring roadmap'.split(' ')
const w = (i: number, n = 3) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ')
const foot = (i: number) => `<p style="position:absolute; left:128px; bottom:64px; font-size:24px; color:#6a7179">Source: ${w(i, 2)} review, slide ${i}</p>`

export const shapes: ((id: string, i: number) => string)[] = [
  (id, i) => `<section id="${id}" data-transition="fade" style="background:linear-gradient(135deg, #0f2a3d, #2b7a78); color:#fbfbf8; padding:128px; display:flex; flex-direction:column; justify-content:center; gap:32px">
<img src="/_blob/logo${i}" alt="" style="position:absolute; right:128px; top:96px; width:160px; height:64px; object-fit:contain">
<h1 style="font-family:'Source Serif 4', Georgia, serif; font-size:120px; line-height:1.05; letter-spacing:-2px">The ${w(i)} plan</h1>
<p style="font-size:40px; color:#cfe3e2">${w(i + 1, 6)} for <b>Q${(i % 4) + 1}</b></p>
${foot(i)}<aside>Open with the ${w(i, 2)} story; ${w(i + 3, 8)}.</aside></section>`,
  (id, i) => claudeExamples['layout-kpis'].replace('id="kpis"', `id="${id}"`).replace('41%', `${20 + i}%`).replace('faster ramp', w(i, 2)),
  (id, i) => claudeExamples['skill-plan'].replace('id="plan"', `id="${id}"`).replace('Changes', `Changes in ${w(i, 1)}`),
  (id, i) => `<section id="${id}" style="background:#fbfbf8; color:#1a1a1a; padding:128px 128px 160px; display:flex; flex-direction:column; gap:40px">
<h2 style="font-size:72px; font-weight:600">${w(i)}</h2>
<ul style="font-size:36px; line-height:1.4">${Array.from({ length: 5 }, (_, k) => `<li><b>${w(i + k, 1)}:</b> ${w(i + k + 1, 6)} <span style="color:#2b7a78">${w(i + k + 2, 1)}</span></li>`).join('')}</ul>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:32px">
<h2 style="font-size:64px">${w(i)} by region</h2>
<table style="font-size:28px; color:#1a1a1a"><tr style="background:#eef2f1">${['Region', 'Q1', 'Q2', 'Q3'].map((h) => `<th style="width:25%">${h}</th>`).join('')}</tr>${Array.from({ length: 5 }, (_, k) => `<tr><td>${w(i + k, 1)}</td><td>${(i * k) % 97}</td><td>${(i + k * 13) % 89}</td><td>${(i * 3 + k) % 71}</td></tr>`).join('')}</table>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#fbfbf8; padding:128px; display:flex; flex-direction:column; gap:40px">
<h2 style="font-size:64px">${w(i)} flow</h2>
<div style="position:relative; width:1664px; height:700px">
<svg style="position:absolute; left:0; top:0" width="1664" height="700" viewBox="0 0 1664 700"><path d="M 320 60 Q 608 180 888 60" fill="none" stroke="#2b7a78" stroke-width="4"/></svg>
${Array.from({ length: 8 }, (_, k) => `<div style="position:absolute; left:${(k % 4) * 420}px; top:${Math.floor(k / 4) * 360}px; width:320px; height:120px; background:#ffffff; border:1px solid #e3e6e4; border-radius:16px; padding:24px"><p style="font-size:28px">${w(i + k, 2)}</p></div>`).join('\n')}
${Array.from({ length: 6 }, (_, k) => `<x-connector x1="${(k % 3) * 420 + 320}" y1="${Math.floor(k / 3) * 360 + 60}" x2="${(k % 3) * 420 + 420}" y2="${Math.floor(k / 3) * 360 + 60}"></x-connector>`).join('\n')}
</div>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:48px">
<h2 style="font-size:64px">${w(i)}</h2>
<div style="display:flex; gap:64px">${[0, 1].map((k) => `<div style="flex:1; display:flex; flex-direction:column; gap:16px"><h3 style="font-size:40px">${w(i + k, 2)}</h3><p style="font-size:30px; line-height:1.4">${w(i + k, 12)} <a href="https://example.com/${i}">${w(i, 1)}</a> <i>${w(i + 5, 3)}</i>.</p></div>`).join('')}</div>
${foot(i)}<aside>${w(i, 20)}</aside></section>`,
]
export { w, foot }
