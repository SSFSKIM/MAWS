// P3-E2 M1 spike: candidate B as it would ship, the bundle-size entry (renderer, in-house Kit, theme reader).
import { houseKit } from './kit-house';
import { makeRenderer } from './render';

export const renderView = makeRenderer(houseKit);
export { themeFrom } from './svg';
