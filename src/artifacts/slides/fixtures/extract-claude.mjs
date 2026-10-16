#!/usr/bin/env node
/* global process, console -- a Node script (eslint.config.js gives Node's globals to .js files only) */
// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M1): extracts every slide example in Claude's Slides
// type files (U1's capture, kept outside the repository, read-only) into the corpus under ./claude/, one file per
// slide, each opening with its provenance line, plus ./claude/manifest.json listing what was taken and what was not
// and why. Run once per capture (a dev-time script, never imported by the app; plain JS so it may read files):
//
//   node src/artifacts/slides/fixtures/extract-claude.mjs [<capture root>]
//
// The capture root defaults to ~/claude-desktop-re/artifact-types/2026-10-12/slides. What counts as an example:
// - a fenced block of markup: a `<section>` is taken as written (a single-file deck.html's sections, one file each);
//   element markup is wrapped in a minimal `<section>`; head markup (a font `<link>` or `@font-face`), which deck.json's
//   `faces` stands in for, and templates (`x1="PC"`, `left:{X−23}px`, `…`) are not slides;
// - an inline code span holding one complete element with its closing tag and no placeholder (`…`, `{X}`, `a|b`).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURE = '2026-10-12';
const root = process.argv[2] ?? join(homedir(), 'claude-desktop-re/artifact-types', CAPTURE, 'slides');
const out = join(dirname(fileURLToPath(import.meta.url)), 'claude');
const cite = (rel) => `T/slides/${rel}`; // T = ~/claude-desktop-re/artifact-types/<capture>/ (research/p3-claude-type-formats.md)

const sources = ['SKILL.md', ...readdirSync(join(root, 'artifact-type/reference')).filter((f) => f.endsWith('.md')).sort().map((f) => `artifact-type/reference/${f}`)];
const HEAD = /^<(link|style|head|html|title|body|meta)\b/i;
const PLACEHOLDER = /[…{|]/;
const TEMPLATE = /\b(?:x1|y1|x2|y2|left|top|width|height)="(?![-\d.]+(?:px|%)?")[^"]*"/;
const INLINE = /`(<([a-z][a-z0-9-]*)\b[^`]*?>[^`]*?<\/\2>)`/g;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const manifest = { capture: `T/slides (T = ~/claude-desktop-re/artifact-types/${CAPTURE}/)`, extracted: [], skipped: [] };

for (const rel of sources) {
  const text = readFileSync(join(root, rel), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const lines = text.split('\n');
  const stem = rel === 'SKILL.md' ? 'skill' : basename(rel, '.md');
  const found = []; // {from, to, markup}
  // fenced blocks (a list item's fence is indented)
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```/.exec(lines[i]);
    if (!open) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*```/.test(lines[j])) j++;
    const body = lines.slice(i + 1, j).map((l) => l.slice(open[1].length)).join('\n').trim();
    found.push({ from: i + 2, to: j, markup: body });
    i = j;
  }
  // inline spans
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) return;
    for (const m of line.matchAll(INLINE)) found.push({ from: i + 1, to: i + 1, markup: m[1] });
  });
  found.sort((a, b) => a.from - b.from);

  let n = 0;
  for (const f of found) {
    const at = `${cite(rel)}:${f.from === f.to ? f.from : `${f.from}-${f.to}`}`;
    const skip = (reason) => manifest.skipped.push({ at, reason, snippet: f.markup.slice(0, 80) });
    if (!f.markup.startsWith('<')) continue; // not markup (JSON, prose): not a candidate at all
    if (HEAD.test(f.markup)) skip("head markup (fonts): deck.json's faces stand in for it");
    else if (PLACEHOLDER.test(f.markup)) skip('a snippet with placeholders (…, {X}, a|b), not an example');
    else if (TEMPLATE.test(f.markup)) skip('a template with letters in place of coordinates, not an example');
    else {
      const sections = f.markup.match(/<section\b[\s\S]*?<\/section>/g);
      const slides = sections ?? [null];
      for (const section of slides) {
        n++;
        const name = `${stem}-${n}`;
        const form = section ? 'as written' : `wrapped in a <section id="${name}">`;
        const slide = section ?? `<section id="${name}" style="background:#ffffff; padding:128px">\n${f.markup}\n</section>`;
        const provenance = `<!-- provenance: ${at} (sha256 ${sha}…), extracted by src/artifacts/slides/fixtures/extract-claude.mjs, ${form} -->`;
        writeFileSync(join(out, `${name}.html`), `${provenance}\n${slide}\n`);
        manifest.extracted.push({ file: `${name}.html`, at, form });
      }
    }
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`extracted ${manifest.extracted.length} slides, skipped ${manifest.skipped.length} snippets → ${out}`);
for (const s of manifest.skipped) console.log(`  skipped ${s.at}: ${s.reason}`);
