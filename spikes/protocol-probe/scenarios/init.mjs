import {run} from '../harness.mjs';
export default ()=>run('init',async p=>{await p.turn('Reply with exactly OK');await p.init();});
