const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {LauncherUpdater, STARTUP_DELAY, CHECK_INTERVAL} = require('../src/updater.cjs');

class FakeUpdater extends EventEmitter {
  calls = 0;
  installs = [];
  async checkForUpdates() { this.calls++; this.emit('update-not-available', {version: '1.1.0'}); return {isUpdateAvailable: false}; }
  quitAndInstall(...args) { this.installs.push(args); }
}
function controller(options = {}) {
  const updater = options.updater || new FakeUpdater();
  return {updater, manager: new LauncherUpdater({updater, version:'1.1.0', supported:true, ...options})};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('自動確認は起動後10秒と6時間ごと。設定がオフのときは通信しない', async () => {
  const scheduled = [], cleared = []; let enabled = false;
  const timers = {setTimeout(fn,ms) { scheduled.push({fn,ms}); return 1; },setInterval(fn,ms) { scheduled.push({fn,ms}); return 2; },clearTimeout(id) { cleared.push(id); },clearInterval(id) { cleared.push(id); }};
  const {manager,updater} = controller({timers,enabled:()=>enabled});
  manager.start(); assert.deepEqual(scheduled.map(s=>s.ms), [STARTUP_DELAY,CHECK_INTERVAL]);
  scheduled[0].fn(); await tick(); assert.equal(updater.calls,0);
  enabled = true; scheduled[1].fn(); await tick(); assert.equal(updater.calls,1);
  manager.stop(); assert.deepEqual(cleared,[1,2]); scheduled[1].fn(); await tick(); assert.equal(updater.calls,1);
});
test('重複確認をまとめ、同じ版やダウングレードをインストールしない', async () => {
  const {manager,updater} = controller();
  await Promise.all([manager.check(),manager.check()]); assert.equal(updater.calls,1);
  assert.equal(manager.snapshot().status,'idle'); assert.equal(updater.allowDowngrade,false); assert.equal(updater.allowPrerelease,false);
  await assert.rejects(()=>manager.install(),/完了していません/); assert.deepEqual(updater.installs,[]);
});
test('キャッシュ済み更新が即座に完了しても、準備完了状態を維持する', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => { updater.emit('update-available',{version:'1.2.0'}); updater.emit('download-progress',{percent:45}); updater.emit('update-downloaded',{version:'1.2.0'}); return {downloadPromise:Promise.resolve(['setup.exe'])}; };
  const {manager} = controller({updater}); await manager.check();
  assert.equal(manager.snapshot().status,'downloaded'); assert.equal(manager.snapshot().percent,100);
  await manager.check(); assert.equal(manager.snapshot().status,'downloaded');
});
test('バックグラウンドのダウンロード失敗を捕捉し、再確認で回復できる', async () => {
  const updater = new FakeUpdater(); let rejectDownload;
  updater.checkForUpdates = async () => { updater.emit('update-available',{version:'1.2.0'}); return {downloadPromise:new Promise((_,reject)=>rejectDownload=reject)}; };
  const {manager} = controller({updater}); await manager.check(); rejectDownload(Error('network failure'));
  await tick(); assert.equal(manager.snapshot().status,'error'); assert.match(manager.snapshot().error,/通信環境/);
  updater.checkForUpdates = async () => { updater.emit('update-not-available',{version:'1.1.0'}); return {}; };
  await manager.check(); assert.equal(manager.snapshot().status,'idle'); assert.equal(manager.snapshot().error,'');
});
test('ゲーム実行・ダウンロード中は適用を拒否し、通常終了時にも勝手に更新しない', async () => {
  for (const reason of ['ゲームを終了してください','ダウンロード中です','Unity Roomを閉じてください']) {
    const {manager,updater} = controller({busyReason:()=>reason});
    updater.emit('update-downloaded',{version:'1.2.0'});
    await assert.rejects(()=>manager.install(),new RegExp(reason));
    assert.equal(manager.snapshot().status,'downloaded'); assert.deepEqual(updater.installs,[]); assert.equal(updater.autoInstallOnAppQuit,false);
  }
});
test('設定保存後に無人インストールと再起動を要求し、連続クリックをまとめる', async () => {
  let saved = false;
  const {manager,updater} = controller({prepareInstall:async()=>{await tick();saved=true;}});
  updater.quitAndInstall = (...args) => { assert.equal(saved,true); updater.installs.push(args); };
  updater.emit('update-downloaded',{version:'1.2.0'});
  const first = manager.install(), second = manager.install(); assert.equal(manager.isInstalling,true);
  await Promise.all([first,second]); assert.deepEqual(updater.installs,[[true,true]]);
});
test('保存失敗や適用直前の状態変化は更新を中止し、再試行できる状態へ戻す', async () => {
  let busy = '';
  const {manager,updater} = controller({busyReason:()=>busy,prepareInstall:async()=>{busy='ゲーム実行中';}});
  updater.emit('update-downloaded',{version:'1.2.0'});
  await assert.rejects(()=>manager.install(),/ゲーム実行中/); assert.equal(manager.snapshot().status,'downloaded'); assert.deepEqual(updater.installs,[]);
  const broken = controller({prepareInstall:async()=>{throw Error('save failed');}});
  broken.updater.emit('update-downloaded',{version:'1.2.0'});
  await assert.rejects(()=>broken.manager.install(),/save failed/); assert.equal(broken.manager.isInstalling,false);
});
test('開発版では更新を実行しない', async () => {
  const {manager,updater} = controller({supported:false}); manager.start(); await manager.check();
  assert.equal(manager.snapshot().status,'unsupported'); assert.equal(updater.calls,0);
});

// The following tests exercise the real, pinned electron-updater implementation
// and its SHA-512 stream validation against a local HTTP update server.
async function realUpdater(t, {corrupt = false, version = '1.2.0'} = {}) {
  const {NsisUpdater} = require('electron-updater');
  const {NodeHttpExecutor} = require('builder-util/out/nodeHttpExecutor');
  const {configureRequestOptionsFromUrl} = require('builder-util-runtime');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'cgp-update-'));
  await fs.mkdir(path.join(root,'user'));
  const config = path.join(root,'app-update.yml');
  await fs.writeFile(config,'updaterCacheDirName: test-updates\n');
  const payload = crypto.randomBytes(256*1024);
  const sha = crypto.createHash('sha512').update(payload).digest('base64');
  const body = corrupt ? Buffer.alloc(payload.length,0) : payload;
  const filename = 'CGP-Launcher-Rebuilt-Setup-test-x64.exe';
  let downloads = 0;
  const server = http.createServer((req,res) => {
    if (req.url.startsWith('/latest.yml')) { res.end(`version: ${version}\nfiles:\n  - url: ${filename}\n    sha512: ${sha}\n    size: ${payload.length}\npath: ${filename}\nsha512: ${sha}\n`); }
    else if (req.url.startsWith('/'+filename)) { downloads++; res.setHeader('content-length',body.length); res.end(body); }
    else res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(path.join(os.tmpdir(),'cgp-update-')));await fs.rm(root,{recursive:true,force:true});});
  const app = {version:'1.1.0',name:'CGP Update Test',isPackaged:true,appUpdateConfigPath:config,userDataPath:path.join(root,'user'),baseCachePath:root,whenReady:async()=>{},onQuit:()=>{},quit:()=>{},relaunch:()=>{}};
  const updater = new NsisUpdater(null,app);
  updater.logger = {info(){},warn(){},error(){},debug(){}};
  const executor = new NodeHttpExecutor();
  executor.download = function(url,destination,options) {
    return options.cancellationToken.createPromise((resolve,reject,onCancel)=>{
      this.doDownload(configureRequestOptionsFromUrl(url,{headers:options.headers}), {destination,options,onCancel,callback:error=>error?reject(error):resolve(destination)},0);
    });
  };
  updater.httpExecutor = executor;
  updater.disableDifferentialDownload = true;
  updater.setFeedURL({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`});
  const manager = new LauncherUpdater({updater,version:'1.1.0',supported:true});
  return {root,updater,manager,payload,downloads:()=>downloads};
}
test('実際の更新ライブラリで新しい版を検出・取得し、検証済みインストーラーへ引き渡す', async t => {
  const {updater,manager,payload,downloads} = await realUpdater(t);
  const completed = once(updater,'update-downloaded');
  await manager.check(); const [result] = await completed;
  assert.equal(manager.snapshot().status,'downloaded'); assert.equal(result.version,'1.2.0'); assert.equal(downloads(),1);
  assert.deepEqual(await fs.readFile(result.downloadedFile),payload);
  let spawned;
  updater.spawnLog = async (file,args) => { spawned={file,args}; return true; };
  assert.equal(updater.install(true,true),true);
  assert.equal(spawned.file,result.downloadedFile); assert.deepEqual(spawned.args,['--updated','/S','--force-run']);
});
test('SHA-512が一致しない更新ファイルを拒否し、適用可能状態にしない', async t => {
  const {updater,manager} = await realUpdater(t,{corrupt:true});
  const failed = once(updater,'error'); await manager.check(); const [error] = await failed; await tick();
  assert.equal(error.code,'ERR_CHECKSUM_MISMATCH'); assert.equal(manager.snapshot().status,'error'); assert.match(manager.snapshot().error,/検証に失敗/);
  await assert.rejects(()=>manager.install(),/完了していません/);
});
test('同じ版・古い版は実際の更新ライブラリでもダウンロードしない', async t => {
  for (const version of ['1.1.0','1.0.3']) {
    const {manager,downloads} = await realUpdater(t,{version}); await manager.check();
    assert.equal(manager.snapshot().status,'idle'); assert.equal(downloads(),0);
  }
});
