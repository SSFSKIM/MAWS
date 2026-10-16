// P3-E2 M1 spike: candidate A as it would ship, the bundle-size entry (renderer, d3 Kit, theme reader).
import { d3Kit } from './kit-d3';
import { makeRenderer } from './render';

export const renderView = makeRenderer(d3Kit);
export { themeFrom } from './svg';
