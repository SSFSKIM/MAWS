// Why a bridge that answered can't be driven, in the words both lane A halves say (P5 O9 M2, "State"; M9): a sminos
// older than 1.11.0 (MW1) names no `capabilities.controls`, so nothing it would do can be drawn from its capabilities.
export function controlsMissingReason(sminos: unknown): string {
  const version = typeof sminos === 'string' ? ` (${sminos})` : '';
  return `this session’s sminos${version} predates MAWS’s controls: update sminos, then run /reload-plugins in the terminal`;
}
