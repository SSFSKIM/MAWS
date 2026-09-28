// Pass-2 runner (child C2 of docs/charter.md). Usage: node run-pass2.mjs <scenario...>
const names=process.argv.slice(2);for(const name of names){if(!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid scenario');const {default:scenario}=await import('./scenarios/pass2/'+name+'.mjs');await scenario();}
