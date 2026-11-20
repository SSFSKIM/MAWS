import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'desktop',
  order: 30,
  name: 'Desktop',
  thesis:
    'The app owns no colour field: the sidebar is a pane of the Mac’s own sidebar material showing your desktop, and everything else is one opaque, calm sheet.',
  notes: [
    'Flip the wallpaper. Dunes and Tide follow light and dark as a Mac’s own wallpapers do; Poster is a fixed, hard picture, and the sidebar’s grey text is what gives way first.',
    'Material: System imitates the Mac’s sidebar material. Thin is the prettier one that does not survive Poster. Dense paints the ground over it, which survives anything and is barely glass.',
    'View → On the desktop shows the window on the wallpaper, so you can see what feeds the pane. Click outside the browser window: the pane goes opaque, as a native sidebar does when its window is inactive.',
    'Live: the sidebar toggle beside the traffic lights, the orange capsule in the tab row (Approve works), a folded tool line, the usage rings and the model chip (menus), the “?” on a hovered setting.',
    'Drawn with a CSS backdrop blur over a painted wallpaper, not with vitrea: in the app this is the window’s vibrancy, which costs one line in the main process.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'ground',
      label: 'Ground (light · dark)',
      options: [
        { value: 'a', label: '#faf9f5 · #191919' },
        { value: 'b', label: '#FFFFFF · #000000' },
        { value: 'c', label: '#faf9f5 · #191c19' },
        { value: 'd', label: '#FFFFFF · #1f1f1f' },
      ],
      default: 'a',
    },
    {
      id: 'wallpaper',
      label: 'Wallpaper behind the window',
      options: [
        { value: 'dunes', label: 'Dunes' },
        { value: 'tide', label: 'Tide' },
        { value: 'poster', label: 'Poster (unhelpful)' },
      ],
      default: 'dunes',
    },
    {
      id: 'material',
      label: 'Sidebar material',
      options: [
        { value: 'thin', label: 'Thin' },
        { value: 'system', label: 'System' },
        { value: 'dense', label: 'Dense' },
      ],
      default: 'system',
    },
    {
      id: 'view',
      label: 'View',
      options: [
        { value: 'window', label: 'Window' },
        { value: 'desk', label: 'On the desktop' },
      ],
      default: 'window',
    },
  ],
  Component: lazy(() => import('./Desktop')),
};
