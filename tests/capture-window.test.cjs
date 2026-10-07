const {test}=require('node:test'),assert=require('node:assert/strict');
const {CaptureWindow}=require('../speech-windows.js');
function fixture(){let time=0,sequence=0;const timers=new Map(),calls=[];const window=new CaptureWindow({now:()=>time,schedule:(fn,delay)=>{timers.set(++sequence,{fn,at:time+delay});return sequence;},cancel:id=>timers.delete(id),onBoundary:reason=>calls.push({reason,at:time})});return {window,calls,timers,tick(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};}
test('continuous recognition is never stopped on a timer while phrases keep being confirmed',()=>{
 const f=fixture();f.window.start();
 // Five minutes of speech: each phrase is interim for ~4 s, then the browser confirms it at a pause.
 for(let i=0;i<75;i++){f.window.activity(true);f.tick(3000);f.window.activity(true);f.tick(1000);f.window.activity(false);}
 assert.deepEqual(f.calls,[],'no restart gap: the microphone keeps listening');assert.equal(f.timers.size,0);
});
test('silence alone never stops the recognizer',()=>{const f=fixture();f.window.start();f.tick(120000);assert.deepEqual(f.calls,[]);});
test('speech left unconfirmed for fifteen seconds is finalized exactly once',()=>{
 const f=fixture();f.window.start();f.window.activity(true);f.tick(10000);f.window.activity(true);f.tick(4999);assert.equal(f.calls.length,0,'the pending clock starts at the first unconfirmed result');
 f.tick(1);assert.deepEqual(f.calls,[{reason:'limit',at:15000}]);f.window.activity(true);f.tick(30000);assert.equal(f.calls.length,1);assert.equal(f.window.request('manual'),false);
});
test('a confirmation restarts the pending clock for the next phrase',()=>{const f=fixture();f.window.start();f.window.activity(true);f.tick(14000);f.window.activity(false);f.window.activity(true);f.tick(14000);assert.equal(f.calls.length,0);f.tick(1000);assert.deepEqual(f.calls,[{reason:'limit',at:29000}]);});
test('onend cancels the old deadline and a fresh recognizer starts clean',()=>{const f=fixture();f.window.start();f.window.activity(true);f.tick(2000);f.window.end();f.tick(20000);assert.equal(f.calls.length,0);f.window.start();f.window.activity(true);f.tick(15000);assert.deepEqual(f.calls,[{reason:'limit',at:37000}]);});
test('a manual stop finalizes the tail exactly once',()=>{const f=fixture();f.window.start();f.window.activity(true);f.tick(900);assert.equal(f.window.request('manual'),true);assert.equal(f.window.request('manual'),false);f.window.end();f.tick(60000);assert.deepEqual(f.calls,[{reason:'manual',at:900}]);assert.equal(f.timers.size,0);});
test('invalid limits are rejected',()=>{for(const maxPendingMs of [1000,4999,30001,NaN])assert.throws(()=>new CaptureWindow({onBoundary(){},maxPendingMs}));});
