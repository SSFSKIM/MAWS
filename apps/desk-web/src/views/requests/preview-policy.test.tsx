// @vitest-environment happy-dom
// A question option's preview is model-written text: on the desk's web page, which has no app-wide policy for the frame
// to inherit, the frame carries its own, so nothing in it reaches the network.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SandboxedPreview, setPreviewPolicy } from '../../../../../src/renderer/src/request-card/preview/SandboxedPreview';
import { installPreviewPolicy } from './preview-policy';

afterEach(() => {
  cleanup();
  setPreviewPolicy(null);
});

it("gives a question preview's frame the desk's policy: nothing fetched, inline styles and data: images only", () => {
  installPreviewPolicy();
  render(<SandboxedPreview preview="<b>Red</b>" title="Preview" />);
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(screen.getByTitle('Preview').getAttribute('srcdoc')!)?.[1];
  expect(policy?.split('; ')).toEqual(["default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:']);
});
