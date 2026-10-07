// Explicit opt-in: uses configured API credits for command validation while
// exercising the same actual page/microphone fixture as the browser regression.
// Original speech is supplied; test expectations never enter model requests.
const path=require('node:path'),{spawnSync}=require('node:child_process');
if(!process.argv.includes('--run-live'))throw Error('Use --run-live only when API-credit use is authorized.');
const result=spawnSync(process.execPath,[path.join(__dirname,'browser-beam-spoken-edits.cjs'),'--live-commands'],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status===null?1:result.status;
