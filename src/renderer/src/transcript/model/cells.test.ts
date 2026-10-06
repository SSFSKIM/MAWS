// E2 (M5, Design §9): `firstJsonBlock` reads a `maws` result's JSON from the first text block that is a JSON object.
// The engine puts its own pointer text beside an image block (M0: `[image, "[Image: source: …]", server JSON]`), so
// joining every text block, as E1's `resultJson` does, would not parse.
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@shared/graph/events';
import { ArtifactScreenshotResultSchema } from '@shared/maws/tools';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { firstJsonBlock } from './cells';

const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
const RESULT = { status: 'captured', id: 'dash', title: 'Dashboard', version: 1 };
const text = (value: string): ContentBlock => ({ type: 'text', text: value });

describe('firstJsonBlock', () => {
  it('over [image, json, text]: the JSON block', () => {
    expect(firstJsonBlock([IMAGE, text(JSON.stringify(RESULT, null, 2)), text('[Image: source: /tmp/x.png]')])).toEqual(RESULT);
  });

  it('over the engine’s order [image, pointer text, json]: the JSON block', () => {
    expect(firstJsonBlock([IMAGE, text('[Image: source: /tmp/config/projects/p/s/tool-results/mcp-maws-blob-1.png]'), text(JSON.stringify(RESULT))])).toEqual(RESULT);
  });

  it('over text alone: a string result or one text block', () => {
    expect(firstJsonBlock(JSON.stringify(RESULT))).toEqual(RESULT);
    expect(firstJsonBlock([text(JSON.stringify(RESULT))])).toEqual(RESULT);
  });

  it('over no JSON object: null (prose, a bare value, an image alone, nothing)', () => {
    expect(firstJsonBlock('artifact_screenshot: no artifact "x" in this session')).toBeNull();
    expect(firstJsonBlock([text('the picture'), text('42'), text('"a string"'), text('null')])).toBeNull();
    expect(firstJsonBlock([IMAGE])).toBeNull();
    expect(firstJsonBlock([])).toBeNull();
  });

  it('p1-maws-artifacts: the recorded screenshot result parses as the tool’s result', () => {
    const results = journalToEvents(loadJournal('pass3', 'p1-maws-artifacts')).filter((event) => event.kind === 'tool.result');
    const screenshot = results.find((event) => typeof event.content !== 'string' && event.content.some((block) => block.type === 'image'));
    expect(screenshot && typeof screenshot.content !== 'string' && screenshot.content.map((block) => block.type)).toEqual(['image', 'text', 'text']);
    expect(ArtifactScreenshotResultSchema.parse(firstJsonBlock(screenshot!.content))).toMatchObject({ status: 'captured', id: 'dash', title: 'Dashboard', version: 1, width: 64, height: 64 });
  });
});
