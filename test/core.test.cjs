const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const AdmZip=require('adm-zip');
const {LauncherService,normalizeCatalog,extractZipSafe,repoOf,DEFAULT_URL}=require('../src/core.cjs');
const sample=[{name:'テスト',authors:['作者'],tags:['#パズル'],githuburl:'https://github.com/sample/game',description:'説明'}];
async function fixture(t,opts={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cgp-tests-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bundled=path.join(root,'games.json');await fs.writeFile(bundled,JSON.stringify(sample));
  const service=new LauncherService({dataDir:path.join(root,'data'),bundledCatalog:bundled,...opts});
  await service.init();return {root,service,id:service.games[0].id};
}
test('既存のgames.json形式を正規化し、不正なURLや重複を拒否する',()=>{
  const [g]=normalizeCatalog(sample);assert.deepEqual(g.tags,['パズル']);assert.equal(g.authors[0],'作者');
  assert.equal(normalizeCatalog([{name:'a',image:'file:///secret'}])[0].image,'');
  assert.throws(()=>normalizeCatalog([...sample,...sample]));assert.throws(()=>repoOf('https://github.com.evil.test/a/b'));
});
test('旧ランチャーのメタデータを読み込み、ゲームファイルを移動しない',async t=>{
  const {root,service,id}=await fixture(t);
  const legacy=path.join(root,'legacy'),gameDir=path.join(legacy,'Games','テスト');
  await fs.mkdir(gameDir,{recursive:true});await fs.writeFile(path.join(gameDir,'Game.exe'),'fake game');
  await fs.writeFile(path.join(legacy,'game-metadata.json'),JSON.stringify({'テスト':{buildFile:'Game.exe'}}));
  service.legacyResources=legacy;assert.equal(await service.importLegacy(),1);assert.equal(await service.importLegacy(),0);
  assert.equal(service.settings.installed[id].dir,gameDir);assert.equal(await fs.readFile(path.join(gameDir,'Game.exe'),'utf8'),'fake game');
});
test('設定とお気に入りを保存し、再起動後も保持する',async t=>{
  const {root,service,id}=await fixture(t);assert.equal(service.settings.autoUpdate,true);await service.favorite(id);await service.updateSettings({theme:'light',view:'list',autoSync:false,autoUpdate:false});
  const second=new LauncherService({dataDir:service.dataDir,bundledCatalog:path.join(root,'games.json')});await second.init();
  assert.equal(second.settings.theme,'light');assert.equal(second.settings.view,'list');assert.equal(second.settings.autoUpdate,false);assert.deepEqual(second.settings.favorites,[id]);
  await assert.rejects(()=>second.updateSettings({autoUpdate:'false'}));
  await assert.rejects(()=>second.updateSettings({catalogUrl:'file:///bad'}));
});
test('ZIPからゲームを展開し、Unityの補助実行ファイルを選択肢から除外する',async t=>{
  const {root,service,id}=await fixture(t);const zip=new AdmZip();zip.addFile('Build/MyGame.exe',Buffer.from('game'));zip.addFile('Build/UnityCrashHandler64.exe',Buffer.from('helper'));
  const buf=zip.toBuffer();service.cache[id]={timestamp:Date.now(),release:{tag_name:'v2',assets:[{id:1,name:'Windows.zip',size:buf.length,url:'https://github.com/a/b/releases/download/v2/Windows.zip'}]}};
  const original=global.fetch;global.fetch=async()=>({ok:true,url:'https://github.com/download',headers:new Headers({'content-length':String(buf.length)}),body:new ReadableStream({start(c){c.enqueue(buf);c.close();}})});t.after(()=>global.fetch=original);
  const item=await service.install(id,1);assert.equal(item.exe,path.join('Build','MyGame.exe'));assert.equal(item.version,'v2');assert.equal(service.jobs.size,0);
  assert.equal(await fs.readFile(path.join(item.dir,item.exe),'utf8'),'game');assert.ok(item.dir.startsWith(path.join(root,'data','Games')));
});
test('失敗した更新は既存ゲームの登録とファイルを保持する',async t=>{
  const {root,service,id}=await fixture(t);const dir=path.join(root,'old');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'old.exe'),'original');
  const old={dir,exe:'old.exe',version:'v1'};service.settings.installed[id]=old;
  service.cache[id]={timestamp:Date.now(),release:{tag_name:'v2',assets:[{id:1,name:'bad.zip',url:'https://github.com/a/b',size:1}]}};
  const original=global.fetch;global.fetch=async()=>{throw Error('network failed');};t.after(()=>global.fetch=original);
  await assert.rejects(()=>service.install(id,1),/network/);assert.deepEqual(service.settings.installed[id],old);assert.equal(await fs.readFile(path.join(dir,'old.exe'),'utf8'),'original');assert.equal(service.jobs.size,0);
});
test('ZIPのパストラバーサルを拒否する',async t=>{
  const {root}=await fixture(t);const zip=new AdmZip();zip.addFile('unsafe/file.txt',Buffer.from('payload'));
  const entry=zip.getEntries()[0];entry.entryName='../escape.txt';const file=path.join(root,'bad.zip');await fs.writeFile(file,zip.toBuffer());
  await assert.rejects(()=>extractZipSafe(file,path.join(root,'out')),/不正なパス/);assert.equal(await fs.stat(path.join(root,'escape.txt')).catch(()=>null),null);
});
test('ゲームをシェルを介さず起動し、終了イベントで実行中状態を解除する',async t=>{
  let child,call;const {root,service,id}=await fixture(t,{spawnGame:(...args)=>{call=args;child=new EventEmitter();setImmediate(()=>child.emit('spawn'));return child;}});
  await fs.writeFile(path.join(root,'game.exe'),'fixture');service.settings.installed[id]={dir:root,exe:'game.exe'};
  await service.launch(id);assert.equal(call[2].shell,false);assert.equal(call[2].cwd,root);assert.equal(service.running.has(id),true);assert.equal(service.settings.history[id].plays,1);
  await assert.rejects(()=>service.launch(id),/実行中/);child.emit('exit',0);assert.equal(service.running.has(id),false);
});
test('不正な同期データは保存済みカタログを破壊しない',async t=>{
  const {service}=await fixture(t);const original=global.fetch;global.fetch=async()=>({ok:true,arrayBuffer:async()=>Buffer.from('{"bad":true}')});t.after(()=>global.fetch=original);
  await assert.rejects(()=>service.sync());assert.equal(service.games[0].name,'テスト');
});

test('Sitesの固定IDは名前・配布URLを編集しても保持し、重複・不正IDを拒否する',()=>{
  const id=normalizeCatalog(sample)[0].id;
  const changed=normalizeCatalog([{...sample[0],id,name:'変更後',githuburl:'https://github.com/another/project'}]);
  assert.equal(changed[0].id,id);
  assert.throws(()=>normalizeCatalog([{...sample[0],id:'../bad'}]));
  assert.throws(()=>normalizeCatalog([{...sample[0],id},{name:'別ゲーム',id}]));
});

test('旧既定URLだけSitesに移行し、設定・お気に入りと独自URLを保持する',async t=>{
  const {root,service,id}=await fixture(t);
  await service.favorite(id);
  for(const owner of ['Ren112-lotus','Rofutok112']){
    service.settings.catalogUrl=`https://raw.githubusercontent.com/${owner}/CGPLauncher/refs/heads/main/games.json`;await service.save();
    const next=new LauncherService({dataDir:service.dataDir,bundledCatalog:path.join(root,'games.json')});await next.init();
    assert.equal(next.settings.catalogUrl,DEFAULT_URL);assert.deepEqual(next.settings.favorites,[id]);
    assert.equal(JSON.parse(await fs.readFile(path.join(service.dataDir,'settings.json'),'utf8')).catalogUrl,DEFAULT_URL);
  }
  service.settings.catalogUrl='https://example.org/games.json';await service.save();
  const custom=new LauncherService({dataDir:service.dataDir,bundledCatalog:path.join(root,'games.json')});await custom.init();
  assert.equal(custom.settings.catalogUrl,'https://example.org/games.json');
});

test('Sitesの同期後もお気に入り・インストール情報・履歴を維持する',async t=>{
  const {root,service,id}=await fixture(t);
  const dir=path.join(root,'existing');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'game.exe'),'game');
  service.settings.installed[id]={dir,exe:'game.exe',version:'v1'};service.settings.history[id]={plays:3,lastPlayed:123};await service.favorite(id);
  const original=global.fetch;global.fetch=async()=>({ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify([{...sample[0],id,name:'改名後',githuburl:'https://github.com/new/repo'}]))});t.after(()=>global.fetch=original);
  await service.sync();assert.equal(service.games[0].id,id);assert.equal(service.games[0].name,'改名後');
  assert.deepEqual(service.settings.favorites,[id]);assert.equal(service.settings.installed[id].dir,dir);assert.equal(service.settings.history[id].plays,3);
});

test('Sitesで全作品を非公開にした場合は空の公開一覧を反映する',async t=>{
  const {service}=await fixture(t);const original=global.fetch;global.fetch=async()=>({ok:true,arrayBuffer:async()=>Buffer.from('[]')});t.after(()=>global.fetch=original);
  await service.sync();assert.deepEqual(service.games,[]);
  service.settings.catalogUrl='https://example.org/games.json';await assert.rejects(()=>service.sync(),/空/);
});
