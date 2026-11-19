// UX wave U6b-4c: the window's follow (stub; the red step of M4).
import type { AppSessionId } from '@shared/graph/ids';

export type LinkSource = { file: string } | { agent: string };

export function follow(_appSessionId: AppSessionId | null, _path: string, _from: LinkSource): void {}

export function following(_appSessionId: AppSessionId | null, _path: string): Promise<void> | null {
  return null;
}

export function linkedCount(_appSessionId: AppSessionId | null, _path: string): number {
  return 0;
}

export function resetFollows(): void {}
