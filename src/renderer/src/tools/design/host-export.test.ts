// P3-E1 M5 (X23; the parent's Decision Log 26): the window's ArtifactHost carries a design export's `board`, `boards`
// and `scale` to main's `artifacts.export` as given, and a refusal main names (`exportTooLarge`) reaches its caller with
// its data, so nothing between the editor and main strips the design's fields or flattens the refusal.
import { describe, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf } from '@shared/ipc/schema/artifacts';
import { ArtifactCommandError, createArtifactHost } from '../../artifacts/host';

const ARTIFACT = '00000000-0000-4000-8000-0000000000d6';

function hostOver(answer: (input: Record<string, unknown>) => unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  const ipc = {
    invoke: async (name: string, input: Record<string, unknown>) => {
      calls.push([name, input]);
      return answer(input);
    },
    on: () => () => {},
  };
  return { calls, host: createArtifactHost({ ipc: ipc as unknown as Pick<MawsBridge, 'invoke' | 'on'>, ports: { take: () => new Promise(() => {}) }, log: () => {} }) };
}

describe('the window’s host and a design export', () => {
  it('passes board, boards and scale through to artifacts.export', async () => {
    const { calls, host } = hostOver(() => ({ ok: true, value: { path: '/u/x/exports/3-png.png', revision: 3 } }));
    await host.export(ARTIFACT, 'png', 2, { board: 'poster', scale: 0.9102 });
    await host.export(ARTIFACT, 'pdf', undefined, { boards: ['poster', 'phone'] });
    expect(calls).toEqual([
      ['artifacts.export', { artifactId: ARTIFACT, format: 'png', versionId: 2, board: 'poster', scale: 0.9102 }],
      ['artifacts.export', { artifactId: ARTIFACT, format: 'pdf', boards: ['poster', 'phone'] }],
    ]);
  });

  it('rejects with main’s named refusal, its data whole', async () => {
    const issues = { reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 } };
    const { host } = hostOver(() => ({ ok: false, error: { code: 'invalid_input', message: 'board poster is 1080×9000 px …', issues } }));
    const failure = await host.export(ARTIFACT, 'png', undefined, { board: 'poster' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ArtifactCommandError);
    expect(artifactRefusalOf((failure as ArtifactCommandError).error)).toEqual(issues);
  });
});
