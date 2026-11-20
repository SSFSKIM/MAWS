import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'essential',
  order: 70,
  name: 'Essential',
  thesis:
    'Less, but better: one body, one typeface, one mark (the circle), and one colour, which appears only where a session is waiting for you.',
  notes: [
    'The only colour in the window is orange, and it means one thing: your turn. Find the three dots; hover or click "Fix flaky upload test" to answer the request in place.',
    'Every state is a circle: hollow is not yet, turning is working, solid is done. Usage is one small dial in the sidebar foot (hover it); context moved into the model menu.',
    'Settings prints no help at rest. Move over a row and its note appears in the margin; nothing shifts.',
    'No glass and no blur: the persona bans simulated material. Flip Corners to see the same design with the 2 to 6 px radii the persona starts from.',
    'Words at rest: "What needs you" prints a second line only under sessions that wait for you; "Everything" is closer to the app today.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'light',
      label: 'Light ground',
      options: [
        { value: 'white', label: '#FFFFFF' },
        { value: 'paper', label: '#faf9f5' },
      ],
      default: 'white',
    },
    {
      id: 'dark',
      label: 'Dark ground',
      options: [
        { value: '191919', label: '#191919' },
        { value: '1f1f1f', label: '#1f1f1f' },
        { value: '000000', label: '#000000' },
        { value: '191c19', label: '#191c19' },
      ],
      default: '191919',
    },
    {
      id: 'words',
      label: 'Words at rest',
      options: [
        { value: 'none', label: 'Titles only' },
        { value: 'needs', label: 'What needs you' },
        { value: 'all', label: 'Everything' },
      ],
      default: 'needs',
    },
    {
      id: 'corners',
      label: 'Corners',
      options: [
        { value: 'round', label: 'Concentric' },
        { value: 'tight', label: '2 to 6 px' },
      ],
      default: 'round',
    },
  ],
  Component: lazy(() => import('./Essential')),
};
