// The ground. Paper brings its own (a warm near-black at night, an ivory by day); the owner's candidates are painted
// beside it in one window, as bands of the same picture, so the same prose and the same glass can be read on each.
import { transcript } from '../../content/fixtures';
import { paintPaper } from '../layers/paper';
import { Block, useBoard } from './board';
import { GROUNDS, LETTERS } from './parts';

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Where in the picture each band is cut from, as a share of its height: the reading column's own ground, with the
 *  glass leaf at the right edge so there is something for glass to stand over. */
const CUT = 0.36;

/**
 * Paints the Paper field once per ground and keeps one horizontal band of each: every band is the same slice of the
 * same picture, so the grounds differ and nothing else does.
 */
export function paintBands(canvas: HTMLCanvasElement, night: boolean, grounds: readonly string[]) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  const band = canvas.height / grounds.length;
  const whole = document.createElement('canvas');
  whole.width = canvas.width;
  whole.height = canvas.height;
  const wg = whole.getContext('2d')!;
  grounds.forEach((hex, i) => {
    wg.save();
    wg.scale(dpr, dpr);
    wg.fillStyle = hex;
    wg.fillRect(0, 0, w, h);
    paintPaper(wg, w, h, night, 1, rgbOf(hex));
    wg.restore();
    wg.filter = 'none';
    wg.globalAlpha = 1;
    wg.globalCompositeOperation = 'source-over';
    g.drawImage(whole, 0, Math.round(CUT * canvas.height), canvas.width, band, 0, Math.round(i * band), canvas.width, Math.ceil(band));
  });
}

const reply = transcript.find((t) => t.kind === 'assistant');
const run = transcript.filter((t) => t.kind === 'tools')[1];
const said = transcript.filter((t) => t.kind === 'user')[1];

export function GroundPage() {
  const { scheme, picks, pick } = useBoard();
  const grounds = GROUNDS[scheme];
  // The two schemes have different candidates, so each keeps its own letter.
  const key = scheme === 'dark' ? 'ground' : 'ground-light';
  return (
    <>
      {grounds.map((g, n) => {
        const letter = LETTERS[n]!;
        const picked = picks[key] === letter;
        return (
          <section className="xc-band" key={g.id} aria-label={`${letter}: ${g.hex}`}>
            <button type="button" className="xc-tag" aria-pressed={picked} onClick={() => pick(key, letter)} title={picked ? 'Your pick' : 'Pick this one'}>
              <b>{letter}</b>
              <span className="xc-tag-name">
                <code>{g.hex}</code>
                <small>{g.name}</small>
              </span>
            </button>
            <div className="xc-band-read">
              <div className="xl-prose">
                <p>{reply?.kind === 'assistant' && reply.paragraphs[1]}</p>
              </div>
              <div className="xl-folded">
                <span className="xl-cap">{run?.kind === 'tools' && run.summary}</span>
              </div>
            </div>
            <div className="xl-user">
              <Block className="xl-bubble" radius={22}>
                {said?.kind === 'user' && said.text}
              </Block>
            </div>
          </section>
        );
      })}
    </>
  );
}
