import type { Scheme } from '../../lab/types';
import type { GroundSpec, OrangeMode } from './paint';

// What the window stands on, and what each surface of glass lays over it. Everything here turns on two things:
// the scheme, and how much orange the ground keeps (the knob that matters most).
//
// One hue. The owner's orange is #FD780F: HSL hue 26.5, OKLCH hue 49.4. Its lighter steps are mixes with white on
// encoded values (HSL hue held at 26.5, OKLCH hue 59 to 63: toward apricot, away from red); its deeper steps hold
// the OKLCH hue (HSL 27). Nothing here is redder than the owner's orange, which is where terracotta and clay sit
// (HSL 15 to 17, OKLCH 39 to 41).

export const ORANGE = '#FD780F';
const ORANGE_RGB: [number, number, number] = [253, 120, 15];

/** The owner's ground candidates; a chip names a light and a dark value, the scheme picks. */
export const GROUNDS: Record<string, Record<Scheme, string>> = {
  a: { light: '#faf9f5', dark: '#191919' },
  b: { light: '#faf9f5', dark: '#191c19' },
  c: { light: '#ffffff', dark: '#1f1f1f' },
  d: { light: '#ffffff', dark: '#000000' },
};

export type Reading = 'glass' | 'veil' | 'opaque';

export interface World {
  spec: GroundSpec;
  vars: Record<string, string>;
}

const DARK_INK = '29 21 13';
const LIGHT_INK = '255 242 228';

export function world(scheme: Scheme, orange: OrangeMode, reading: Reading, groundKey: string): World {
  const dark = scheme === 'dark';
  const plain = (GROUNDS[groundKey] ?? GROUNDS.a!)[scheme];

  let spec: GroundSpec;
  let flat: string;
  let onGround: string; // ink for words that stand on the ground itself
  let cast: string; // what a shadow on this ground is made of
  if (orange === 'full') {
    flat = ORANGE;
    spec = {
      base: ORANGE,
      lift: [254, 172, 106], // the orange 38 % toward white
      shade: [214, 98, 4], // the orange, deeper (OKLCH L 0.63)
      liftGain: 0.82,
      shadeGain: 0.85,
      lineLift: 'rgba(255, 208, 166, 0.5)',
      lineShade: 'rgba(190, 84, 0, 0.5)',
    };
    onGround = DARK_INK;
    cast = '112 44 0';
  } else if (orange === 'deep') {
    flat = dark ? '#8f4003' : '#d96405';
    spec = dark
      ? {
          base: flat,
          lift: ORANGE_RGB,
          shade: [77, 30, 0],
          liftGain: 0.5,
          shadeGain: 0.8,
          lineLift: 'rgba(253, 120, 15, 0.42)',
          lineShade: 'rgba(60, 22, 0, 0.5)',
        }
      : {
          base: flat,
          lift: ORANGE_RGB,
          shade: [176, 80, 0],
          liftGain: 0.85,
          shadeGain: 0.5,
          lineLift: 'rgba(254, 160, 84, 0.5)',
          lineShade: 'rgba(150, 66, 0, 0.5)',
        };
    onGround = dark ? LIGHT_INK : DARK_INK;
    cast = dark ? '40 14 0' : '96 38 0';
  } else {
    flat = plain;
    spec = {
      base: plain,
      lift: ORANGE_RGB,
      shade: ORANGE_RGB,
      liftGain: dark ? 0.5 : 0.78,
      shadeGain: 0,
      lineLift: dark ? 'rgba(253, 120, 15, 0.26)' : 'rgba(253, 120, 15, 0.4)',
      lineShade: 'rgba(0, 0, 0, 0)',
    };
    onGround = dark ? LIGHT_INK : DARK_INK;
    cast = dark ? '0 0 0' : '70 40 12';
  }

  // The veil each surface lays over what it blurs. Light glass is white at the surface's strength; dark glass is
  // a warm near-black. A reading pane is stronger than a navigation pane; Veil and Opaque are the knob's other
  // two answers to reading on glass.
  const tone = dark ? '24 19 15' : '255 255 255';
  const a = dark
    ? { pane: 0.76, ctl: 0.74, read: 0.84, veil: 0.93, pop: 0.9 }
    : orange === 'light'
      ? { pane: 0.5, ctl: 0.56, read: 0.66, veil: 0.86, pop: 0.84 }
      : { pane: 0.54, ctl: 0.56, read: 0.76, veil: 0.9, pop: 0.86 };
  const veil = (alpha: number) => `rgb(${tone} / ${alpha.toFixed(3)})`;
  // Each surface's veil in two steps (see `.glass::before`): `edge` reaches the rim, `inner` is added inside the
  // bevel so that the two together make the surface's strength.
  const EDGE = dark ? 0.8 : 0.66;
  const pair = (name: string, alpha: number): Record<string, string> => {
    const edge = alpha * EDGE;
    return { [`--o-${name}`]: veil(edge), [`--o-${name}-in`]: veil((alpha - edge) / (1 - edge)) };
  };
  const read: Record<string, string> =
    reading === 'opaque' ? { '--o-read': plain, '--o-read-in': 'transparent' } : pair('read', reading === 'veil' ? a.veil : a.read);

  return {
    spec,
    vars: {
      '--o-ground-flat': flat,
      '--o-on-ground': `rgb(${onGround})`,
      '--o-on-ground-hover': `rgb(${onGround} / 10%)`,
      '--o-cast': cast,
      ...pair('pane', a.pane),
      ...pair('ctl', a.ctl),
      ...read,
      ...pair('popg', a.pop),
      '--o-opaque': plain,
    },
  };
}
