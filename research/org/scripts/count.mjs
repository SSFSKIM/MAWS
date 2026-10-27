import * as S from 'ENTRY';
import * as N from 'NAMES';
const cmds = S.commands, evts = S.events;
const byNs = {};
const ownerTotals = {};
const mainOnly = new Set(N.MAIN_ONLY_COMMANDS);
for (const [name, spec] of Object.entries(cmds)) {
  const ns = name.split('.')[0];
  byNs[ns] ??= { cmds: 0, owners: {}, mainOnly: 0, events: 0, hostEvents: 0 };
  byNs[ns].cmds++;
  byNs[ns].owners[spec.owner] = (byNs[ns].owners[spec.owner] ?? 0) + 1;
  ownerTotals[spec.owner] = (ownerTotals[spec.owner] ?? 0) + 1;
  if (mainOnly.has(name)) byNs[ns].mainOnly++;
}
const hostEv = new Set(S.HOST_EVENTS);
for (const name of Object.keys(evts)) {
  const ns = name.split('.')[0];
  byNs[ns] ??= { cmds: 0, owners: {}, mainOnly: 0, events: 0, hostEvents: 0 };
  byNs[ns].events++;
  if (hostEv.has(name)) byNs[ns].hostEvents++;
}
console.log(JSON.stringify({ totalCmds: Object.keys(cmds).length, totalEvents: Object.keys(evts).length, hostEvents: S.HOST_EVENTS.length, mainOnly: mainOnly.size, ownerTotals, byNs, allCmds: Object.fromEntries(Object.entries(cmds).map(([k,v])=>[k,v.owner])), allEvents: Object.keys(evts) }, null, 0));
