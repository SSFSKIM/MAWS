export const meta = { name: 'maws-probe', description: 'Two echo agents in one phase', phases: [{ title: 'Echo' }] }
phase('Echo')
const out = await parallel([() => agent('Reply with exactly ALPHA and nothing else.', {label: 'alpha', effort: 'low'}), () => agent('Reply with exactly BETA and nothing else.', {label: 'beta', effort: 'low'})])
return out