// MAWS's own folders (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B and
// decision 8), which no write of the files service reaches.

export function ownFolders(profile: string, execPath: string, told: () => readonly string[]): () => string[] {
  void profile;
  void execPath;
  void told;
  return () => [];
}
