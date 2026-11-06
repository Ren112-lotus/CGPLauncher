const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CatalogSynchronizer,SYNC_INTERVAL,FOCUS_INTERVAL}=require('../src/catalog-sync.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('カタログは起動時と1分ごとに同期し、設定オフでは自動通信しない',async()=>{
  let calls=0,enabled=true,interval,cleared;
  const sync=new CatalogSynchronizer({sync:async()=>{calls++;},enabled:()=>enabled,timers:{setInterval(fn,ms){assert.equal(ms,SYNC_INTERVAL);interval=fn;return 42;},clearInterval(id){cleared=id;}}});
  sync.start();await tick();assert.equal(calls,1);
  interval();await tick();assert.equal(calls,2);
  enabled=false;interval();await tick();assert.equal(calls,2);
  sync.stop();assert.equal(cleared,42);
});

test('フォーカス同期を15秒以内は抑制し、手動同期と同時でも1リクエストにまとめる',async()=>{
  let now=0,calls=0,finish;
  const sync=new CatalogSynchronizer({enabled:()=>true,now:()=>now,sync:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  sync.automatic();const a=sync.sync(),b=sync.sync();assert.equal(a,b);await tick();assert.equal(calls,1);
  finish('done');assert.equal(await a,'done');
  now=FOCUS_INTERVAL-1;sync.automatic();await tick();assert.equal(calls,1);
  now=FOCUS_INTERVAL;sync.automatic();await tick();assert.equal(calls,2);finish();await sync.pending;
});

test('バックグラウンドの通信失敗後も再試行し、手動更新には失敗理由を返す',async()=>{
  let calls=0;const sync=new CatalogSynchronizer({enabled:()=>true,sync:async()=>{calls++;throw Error('offline');}});
  sync.automatic(true);await tick();assert.equal(sync.pending,null);
  await assert.rejects(()=>sync.sync(),/offline/);assert.equal(calls,2);
});
