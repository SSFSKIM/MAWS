// The desktop behind the window. In the app this layer does not exist: it is whatever the person's Mac shows.
// Here it is painted so the sidebar pane has something real to blur. Dunes and Tide have a day and a night
// picture, as the Mac's own dynamic wallpapers do; Poster is one fixed picture, as a person's own image is.
import type { Scheme } from '../../lab/types';
import s from './desktop.module.css';

const W = 1440;
const H = 900;

/** One ridge: everything below a two-sine line, closed along the bottom edge. */
function ridge(base: number, amp: number, len: number, phase: number): string {
  const pts: string[] = [];
  for (let x = -40; x <= W + 40; x += 12) {
    const a = (x / len) * Math.PI * 2 + phase;
    const y = base + amp * Math.sin(a) + amp * 0.38 * Math.sin(a * 2.3 + phase * 1.7);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M-40,${H + 40} L${pts.join(' L')} L${W + 40},${H + 40} Z`;
}

interface Scene {
  sky: [string, string, string];
  glow: string;
  /** Far to near; each ridge is lit at its crest and falls to its shade. */
  ridges: [crest: string, shade: string][];
}

const scenes: Record<'dunes' | 'tide', Record<Scheme, Scene>> = {
  dunes: {
    light: {
      sky: ['#f4ead9', '#f3dcbd', '#efc698'],
      glow: '#fff0d2',
      ridges: [
        ['#ecc999', '#e2b683'],
        ['#e4b47c', '#d49c62'],
        ['#d99f62', '#c5854b'],
        ['#cc8a4c', '#b4703a'],
        ['#bd7a3f', '#9c5c2c'],
      ],
    },
    dark: {
      sky: ['#120f1c', '#261a2c', '#4a2a33'],
      glow: '#8a4a34',
      ridges: [
        ['#5a3238', '#43262f'],
        ['#4a2930', '#341d28'],
        ['#3a2029', '#281721'],
        ['#2c1922', '#1d111a'],
        ['#21131b', '#140c13'],
      ],
    },
  },
  tide: {
    light: {
      sky: ['#eef3f4', '#dbe9ee', '#c3dde8'],
      glow: '#f4fbff',
      ridges: [
        ['#b4d5e2', '#9cc6d7'],
        ['#93c0d4', '#78aec7'],
        ['#72a8c2', '#5894b3'],
        ['#5390b0', '#3c7a9e'],
        ['#3a789c', '#2a6186'],
      ],
    },
    dark: {
      sky: ['#070c14', '#0c1826', '#12283a'],
      glow: '#1f4e63',
      ridges: [
        ['#183a50', '#122c40'],
        ['#143246', '#0f2536'],
        ['#102a3c', '#0b1e2d'],
        ['#0d2232', '#081724'],
        ['#0a1a28', '#06111b'],
      ],
    },
  },
};

const shape: Record<'dunes' | 'tide', [base: number, amp: number, len: number, phase: number][]> = {
  dunes: [
    [430, 34, 1180, 0.4],
    [520, 46, 940, 2.1],
    [610, 52, 1320, 4.0],
    [705, 44, 860, 5.3],
    [800, 38, 1100, 1.2],
  ],
  tide: [
    [300, 18, 520, 0.9],
    [420, 24, 640, 2.6],
    [540, 28, 460, 4.4],
    [660, 30, 700, 0.2],
    [780, 26, 540, 3.1],
  ],
};

function Layers({ name, scheme }: { name: 'dunes' | 'tide'; scheme: Scheme }) {
  const sc = scenes[name][scheme];
  const id = `xdw-${name}-${scheme}`;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sc.sky[0]} />
          <stop offset="0.55" stopColor={sc.sky[1]} />
          <stop offset="1" stopColor={sc.sky[2]} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.68" cy="0.46" r="0.5">
          <stop offset="0" stopColor={sc.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={sc.glow} stopOpacity="0" />
        </radialGradient>
        {sc.ridges.map(([crest, shade], i) => (
          <linearGradient key={i} id={`${id}-r${i}`} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0" stopColor={crest} />
            <stop offset="0.5" stopColor={shade} />
          </linearGradient>
        ))}
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      <rect width={W} height={H} fill={`url(#${id}-glow)`} />
      {shape[name].map(([base, amp, len, phase], i) => (
        <path key={i} d={ridge(base, amp, len, phase)} fill={`url(#${id}-r${i})`} />
      ))}
    </>
  );
}

/** A hard picture: black, white and one red, in shapes too large for any blur to average away. */
function Poster() {
  return (
    <>
      <rect width={W} height={H} fill="#0c0c0c" />
      <g transform={`rotate(-16 ${W / 2} ${H / 2})`}>
        <rect x={-400} y={70} width={W + 800} height={170} fill="#f7f4ec" />
        <rect x={-400} y={240} width={W + 800} height={96} fill="#e8261c" />
        <rect x={-400} y={560} width={W + 800} height={150} fill="#f7f4ec" />
      </g>
      <circle cx={1010} cy={470} r={210} fill="#e8261c" />
      <circle cx={170} cy={800} r={150} fill="#f7f4ec" />
    </>
  );
}

export function Wallpaper({ name, scheme }: { name: string; scheme: Scheme }) {
  return (
    <svg className={s.wall} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {name === 'poster' ? <Poster /> : <Layers name={name === 'tide' ? 'tide' : 'dunes'} scheme={scheme} />}
    </svg>
  );
}
