// The local-hub suites' cleanup: revoke every machine a run enrolled (DX7 `DELETE /api/machines/<name>`), so a run
// leaves nothing enrolled even where the hub's state is kept. Each name the hub did not revoke is returned with why — its answer, or that it was
// unreachable — so the suite can fail its teardown naming what it left enrolled.
export async function revokeMachines(base: string, names: readonly string[], request: typeof fetch = fetch): Promise<string[]> {
  const left: string[] = [];
  for (const name of names) {
    try {
      const response = await request(`${base}/api/machines/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (response.status !== 200) left.push(`${name} (${response.status} ${await response.text()})`);
    } catch (error) {
      left.push(`${name} (unreachable: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return left;
}
