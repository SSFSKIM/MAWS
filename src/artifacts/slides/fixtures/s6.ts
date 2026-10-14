// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M1): S6's corpus, copied (never imported) from P3-0's
// spike: `spikes/p3-store/s6/fixtures/claude-examples.ts` verbatim below its first lines (the excerpts of Claude's
// examples S6 round-tripped, as an earlier capture had them, and the messy slide), then the inputs of
// `spikes/p3-store/s6/exp/roundtrip.ts` S6 loaded or held: the token slide, the held cases, the dropped-property slide
// and the id-less slide. The corpus's current Claude examples are ./claude/ (extract-claude.mjs).

export const claudeExamples: Record<string, string> = {
  // T/slides/SKILL.md:103-113, the content-slide example (`/_blob/<id>` kept literally)
  'skill-plan': `<section id="plan" data-transition="fade" style="background:#fbfbf8;color:#1a1a1a;font-family:Georgia, serif;padding:128px 128px 160px;display:flex;flex-direction:column;justify-content:space-between;gap:48px">
<h2 style="font-family:'Source Serif 4', Georgia, serif;font-size:72px;font-weight:400;line-height:1.1">Changes</h2>
<div style="display:flex;gap:32px">
<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:#ffffff;padding:40px;border:1px solid #e3e6e4;border-radius:16px">
<h3 style="font-size:32px;font-weight:600">One path</h3>
</div>
<img src="/_blob/<id>" alt="HQ" style="width:480px;height:360px;object-fit:cover;border-radius:16px">
</div>
<p style="position:absolute;left:128px;bottom:64px;font-size:24px;color:#6a7179">Source: poll</p>
<aside>Say hi.</aside>
</section>`,

  // T/slides/artifact-type/reference/layout.md:85-99, "one slide, flow plus pin" (its HTML comment included)
  'layout-kpis': `<section id="kpis" style="background:#fbfbf8; padding:128px 128px 160px; display:flex; flex-direction:column; gap:40px">
  <p style="font-size:24px; font-weight:600; letter-spacing:2px; color:#2b7a78">Q3 IN NUMBERS</p>
  <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:32px">
    <div style="background:#fff; border:1px solid #e3e6e4; border-radius:16px; padding:40px; display:flex; flex-direction:column; gap:8px">
      <p style="font-size:120px; font-weight:600; line-height:1; color:#0f2a3d">41%</p>
      <p style="font-size:28px; color:#4a5568">faster ramp</p>
    </div>
    <div style="background:#fff; border:1px solid #e3e6e4; border-radius:16px; padding:40px; display:flex; flex-direction:column; gap:8px">
      <p style="font-size:120px; font-weight:600; line-height:1; color:#0f2a3d">6→1</p>
      <p style="font-size:28px; color:#4a5568">onboarding paths</p>
    </div>
    <!-- third tile alike -->
  </div>
  <p style="position:absolute; left:128px; bottom:64px; font-size:24px; color:#6a7179">Source: People Ops, Q3 survey (n=212)</p>
</section>`,

  // T/slides/artifact-type/reference/diagrams.md:54-58 (connectors) and :101-107 (an arc svg), in a section
  'diagrams-connectors': `<section id="flow" style="background:#ffffff; padding:128px">
<svg style="position:absolute; left:0; top:0" width="1664" height="700" viewBox="0 0 1664 700">
  <defs><marker id="h" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="#2b7a78" stroke="none"/></marker></defs>
  <path d="M 320 60 Q 608 180 888 60" fill="none" stroke="#2b7a78" stroke-width="4" marker-end="url(#h)"/>
</svg>
<x-connector x1="320" y1="100" x2="448" y2="100"></x-connector>
<x-connector x1="608" y1="160" x2="896" y2="320" route="vh" style="color:#2b7a78; border-width:3px"></x-connector>
<x-connector x1="1504" y1="160" x2="1504" y2="260" head="none" style="border-style:dashed; color:#8a9199"></x-connector>
</section>`,

  // T/slides/artifact-type/reference/diagram-recipes.md:17-21 and :33-37 (a rotated label), in a section
  'recipes-label': `<section id="map" style="background:#fbfbf8; padding:128px">
<p style="position:absolute; left:577px; top:286px; width:240px; height:34px; line-height:34px; font-size:24px; white-space:nowrap; transform:rotate(-45deg)">Station name</p>
<p style="font-size:24px; font-weight:600; letter-spacing:1px">YES</p>
</section>`,
}

/** Messy input: every normalization the canonical form owns, in one slide. */
export const messy = `
<SECTION  hidden data-transition="FADE"  ID="messy" class="deck" data-section="intro"
  style="padding-top:10px; PADDING:128px; background-color: #FFF; display:flex;flex-direction:column ; margin:0; box-sizing:border-box">
  <!-- a comment -->
  <p style="position:absolute;left:64;top:40.0px; font-size:24pt; color:RGB(255, 0, 0); z-index:3" data-x="1">Behind &amp; under</p>
  <h1 style="font: italic bold 96px/1.1 'Inter', Arial, sans-serif; letter-spacing:-.02em;color:#0F2A3D">  Hello
     <strong>bold</strong>   and <em>it</em><span style="color:hsl(210 50% 40%); font-size:30px">blue</span>
     <a href="http://example.com">insecure</a> <a href="https://example.com/a?b=1&amp;c=2"><b>link</b></a>&nbsp;x < y  </h1>
  <div style="display:grid;grid-template-columns:repeat(2,1FR);gap:8;border-top-left-radius:8px;border:SOLID 2px;border-top:none">
    <p style="font-weight:bold;opacity:.50;box-shadow:0 4 24 rgba(0,0,0,.06)">a<br> b <br>c</p>
    <ul style="font-size:28px"> <li>one</li> <li class="x"><b>two</b> <i>three</i></li> </ul>
  </div>
  <img alt='chart "q3"' src="https://cdn.example.com/x.png" style="width:480px;height:360px;object-fit:COVER;transform:translate(10, -50%) rotate(5deg) scale(1.0)">
  <x-icon name="lightbulb" style="color:var(--ds-color-accent);width:48px;height:48px;position:absolute;right:64px;top:64px"></x-icon>
  <p style="font-family:var(--ds-font-body);padding:var(--ds-space-4) 8px;color:var(--other-token);gap:var(--ds-space-2)">Tokens</p>
  <table style="font-size:24px"><tr style="background:#EEE"><th style="width:30%">A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
  <aside>
    Speaker notes &lt;here&gt; &amp; more.
  </aside>
</SECTION>
`

// spikes/p3-store/s6/exp/roundtrip.ts: the token slide (Decision Log 12's superset through the round trip)
export const tokenSlide = `<section id="tok" style="background:var(--ds-color-bg); font-family:var(--ds-font-body)">
<h2 style="color:var(--ds-color-accent, #C00); padding:var(--ds-space-4) var(--ds-space-6); font-size:var(--ds-type-h2-size)">T</h2>
<div style="gap:var(--ds-space-3); border:2px solid var(--ds-color-border); background:var(--x-other)"></div></section>`

// spikes/p3-store/s6/exp/roundtrip.ts: structural failures, each held with its reason (never trimmed)
export const heldCases: Record<string, string> = {
  'two sections': '<section id="a"></section><section id="b"></section>',
  'unknown tag': '<section id="a"><iframe src="x"></iframe></section>',
  'text directly in a div': '<section id="a"><div>loose text</div></section>',
  'aside not last': '<section id="a"><aside>n</aside><p>after</p></section>',
  'nested list': '<section id="a"><ul><li>a<ul><li>b</li></ul></li></ul></section>',
  'embed inside a div': '<section id="a"><div><x-embed style="position:absolute;left:0;top:0;width:10px;height:10px">x</x-embed></div></section>',
  'svg with script': '<section id="a"><svg><script>alert(1)</script></svg></section>',
  'colspan': '<section id="a"><table><tr><td colspan="2">x</td></tr></table></section>',
  '16 nested divs': `<section id="a">${'<div>'.repeat(16)}${'</div>'.repeat(16)}</section>`,
  '201 elements': `<section id="a">${'<p>x</p>'.repeat(201)}</section>`,
  'bad section id': '<section id="a b"></section>',
  'unknown inline tag': '<section id="a"><p>a <code>b</code></p></section>',
}

// spikes/p3-store/s6/exp/roundtrip.ts: unknown properties and attributes dropped with diagnostics, the slide loads
export const droppedSlide = '<section id="a" onclick="x()"><p style="float:left; z-index:2; color:red" title="t" data-foo="1">a</p></section>';
// spikes/p3-store/s6/exp/roundtrip.ts: ids minted when absent, kept when present
export const noIdsSlide = '<section id="s"><p>a</p><p id="keep">b</p><p>c</p></section>';
