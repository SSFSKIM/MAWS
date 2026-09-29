// Pass-3 runner (child C10 of docs/charter.md). Usage: node run-pass3.mjs <scenario...>
const names=process.argv.slice(2);for(const name of names){if(!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid scenario');const {default:scenario}=await import('./scenarios/pass3/'+name+'.mjs');await scenario();}
