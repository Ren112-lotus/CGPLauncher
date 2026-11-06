const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');

const DEFAULT_URL = 'https://cgp-catalog.renren112.chatgpt.site/api/games';
function legacyCatalogUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.search && !url.hash &&
      /^\/(?:Ren112-lotus|Rofutok112)\/CGPLauncher\/(?:refs\/heads\/)?main\/games\.json$/i.test(url.pathname);
  } catch { return false; }
}
const defaults = () => ({catalogUrl: DEFAULT_URL, autoSync: true, autoUpdate: true, downloadDir: '', theme: 'dark', view: 'list', favorites: [], installed: {}, history: {}});
const exists = async p => !!(await fs.stat(p).catch(() => null));
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
function httpsUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('https:// のURLを指定してください。');
  return u.href;
}
function repoOf(url) {
  const u = new URL(httpsUrl(url));
  const m = u.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (u.hostname !== 'github.com' || !m) throw Error('GitHubリポジトリのURLが正しくありません。');
  return `${m[1]}/${m[2]}`;
}
function normalizeCatalog(data) {
  if (!Array.isArray(data) || data.length > 5000) throw Error('ゲームリストは配列形式で指定してください。');
  const seen = new Set();
  return data.map(g => {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) throw Error('ゲーム名がない項目があります。');
    const name = g.name.trim().slice(0, 200);
    if (g.id !== undefined && (typeof g.id !== 'string' || !/^[a-f0-9]{16}$/.test(g.id))) throw Error('ゲームIDが正しくありません。');
    const id = g.id || hash(name + '|' + (g.githuburl || g.unityroomurl || ''));
    if (seen.has(id)) throw Error('同じゲームが重複しています。');
    seen.add(id);
    const list = v => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.slice(0, 200)).slice(0, 50) : [];
    const url = v => {try {return v ? httpsUrl(v) : '';} catch {return '';}};
    return {id, name, authors: list(g.authors), tags: list(g.tags).map(t => t.replace(/^#+/, '')), description: String(g.description || '').slice(0, 20000), githuburl: url(g.githuburl), unityroomurl: url(g.unityroomurl), image: url(g.image)};
  });
}
function inside(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}
async function readJson(file, fallback) {try {return JSON.parse(await fs.readFile(file, 'utf8'));} catch {return fallback;}}
async function findExecutables(dir, root = dir, depth = 0) {
  if (depth > 8) return [];
  const found = [];
  for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !/^(?:.*_Data|MonoBleedingEdge|D3D\d+|__MACOSX|\.git)$/i.test(entry.name)) found.push(...await findExecutables(p, root, depth + 1));
    if (entry.isFile() && /\.exe$/i.test(entry.name) && !/(?:crashhandler|unins\d*|setup|installer|vcredist|redist)/i.test(entry.name)) found.push(path.relative(root, p));
  }
  return found.sort((a,b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
}
async function extractZipSafe(zipFile, dest) {
  const zip = new AdmZip(zipFile);
  const entries = zip.getEntries();
  let total = 0;
  if (entries.length > 100000) throw Error('ZIP内のファイルが多すぎます。');
  for (const entry of entries) {
    const name = entry.entryName.replaceAll('\\', '/');
    const target = path.resolve(dest, name);
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(x => x === '..' || x.includes(':')) || !inside(dest,target)) throw Error('ZIPに不正なパスが含まれています。');
    if (((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw Error('ZIP内のシンボリックリンクには対応していません。');
    total += entry.header.size;
    if (total > 12 * 1024 ** 3) throw Error('展開後のサイズが上限を超えています。');
  }
  await fs.mkdir(dest, {recursive:true});
  for (const entry of entries) {
    const target = path.resolve(dest, entry.entryName.replaceAll('\\', '/'));
    if (entry.isDirectory) await fs.mkdir(target, {recursive:true});
    else {await fs.mkdir(path.dirname(target), {recursive:true}); await fs.writeFile(target, entry.getData());}
  }
}
async function request(url, accept = 'application/vnd.github+json') {
  const response = await fetch(httpsUrl(url), {headers:{'User-Agent':'CGP-Launcher-Rebuilt', Accept:accept}, signal:AbortSignal.timeout(25000)});
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) throw Error('アクセスが制限されています。時間をおいて再試行してください。');
    if (response.status === 404) throw Error('公開情報が見つかりませんでした。');
    throw Error(`通信に失敗しました (HTTP ${response.status})。`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 ** 2) throw Error('応答サイズが大きすぎます。');
  const text = Buffer.from(bytes).toString('utf8');
  return accept.includes('raw') ? text : JSON.parse(text);
}
class LauncherService {
  constructor({dataDir, bundledCatalog, legacyResources, onChange = () => {}, spawnGame = spawn}) {
    Object.assign(this, {dataDir, bundledCatalog, legacyResources, onChange, spawnGame});
    this.settings = defaults(); this.games = []; this.jobs = new Map(); this.running = new Map(); this.detailsInFlight = new Map(); this.cache = {}; this.diskQueue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.dataDir, {recursive:true});
    this.settings = {...defaults(), ...await readJson(path.join(this.dataDir, 'settings.json'), {})};
    // Move only the old built-in feed. Preserve explicitly configured feeds.
    if (legacyCatalogUrl(this.settings.catalogUrl)) { this.settings.catalogUrl = DEFAULT_URL; await this.save(); }
    this.games = normalizeCatalog(await readJson(path.join(this.dataDir,'catalog.json'), await readJson(this.bundledCatalog, [])));
    this.cache = await readJson(path.join(this.dataDir,'details.json'), {});
    await this.importLegacy();
    await this.checkInstalled();
    return this.snapshot();
  }
  save() {
    const value = structuredClone(this.settings);
    const task = this.diskQueue.catch(() => {}).then(() => atomicJson(path.join(this.dataDir,'settings.json'),value));
    this.diskQueue = task; return task;
  }
  async checkInstalled() {
    let changed = false;
    for (const [id, item] of Object.entries(this.settings.installed)) {
      if (!inside(item.dir,path.join(item.dir,item.exe)) || !await exists(path.join(item.dir,item.exe))) {delete this.settings.installed[id]; changed=true;}
    }
    if (changed) await this.save();
  }
  async importLegacy() {
    if (!this.legacyResources) return 0;
    const metadata = await readJson(path.join(this.legacyResources,'game-metadata.json'),{});
    let count=0;
    for (const g of this.games) {
      if (this.settings.installed[g.id] || !g.githuburl || !metadata[g.name]) continue;
      const dir = path.join(this.legacyResources,'Games',g.name), exe=metadata[g.name].buildFile;
      if (typeof exe==='string' && inside(path.join(this.legacyResources,'Games'),dir) && inside(dir,path.join(dir,exe)) && await exists(path.join(dir,exe))) {
        this.settings.installed[g.id]={dir,exe,version:'',imported:true}; count++;
      }
    }
    if (count) await this.save();
    return count;
  }
  snapshot() {
    return {games:this.games, settings:this.settings, details:this.cache, running:[...this.running.keys()], jobs:Object.fromEntries([...this.jobs].map(([id,j])=>[id,{percent:j.percent,stage:j.stage}]))};
  }
  emit() {this.onChange(this.snapshot());}
  game(id) {const g=this.games.find(g=>g.id===id); if (!g) throw Error('ゲームが見つかりません。'); return g;}
  async updateSettings(patch) {
    const allowed = ['catalogUrl','autoSync','autoUpdate','downloadDir','theme','view'];
    for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw Error('不明な設定です。');
    if (patch.catalogUrl !== undefined) httpsUrl(patch.catalogUrl);
    if (patch.theme && !['dark','light','system'].includes(patch.theme)) throw Error('不明なテーマです。');
    if (patch.view && !['grid','list'].includes(patch.view)) throw Error('不明な表示形式です。');
    if (patch.downloadDir && !path.isAbsolute(patch.downloadDir)) throw Error('保存先は絶対パスで指定してください。');
    if (patch.autoSync !== undefined && typeof patch.autoSync !== 'boolean') throw Error('自動同期の値が正しくありません。');
    if (patch.autoUpdate !== undefined && typeof patch.autoUpdate !== 'boolean') throw Error('自動アップデートの値が正しくありません。');
    Object.assign(this.settings,patch); await this.save(); this.emit(); return this.snapshot();
  }
  async sync() {
    const raw = await request(this.settings.catalogUrl, 'application/json');
    const games = normalizeCatalog(raw);
    if (!games.length && this.settings.catalogUrl !== DEFAULT_URL) throw Error('ゲームリストが空です。現在のリストを保持しました。');
    await atomicJson(path.join(this.dataDir,'catalog.json'),raw);
    this.games=games; await this.importLegacy(); await this.checkInstalled(); this.emit(); return this.snapshot();
  }
  async favorite(id) {
    this.game(id);
    const set=new Set(this.settings.favorites); set.has(id)?set.delete(id):set.add(id);
    this.settings.favorites=[...set]; await this.save(); this.emit();
  }
  async details(id, force=false) {
    const g=this.game(id); if (!g.githuburl) return {};
    if (!force && this.cache[id]?.timestamp > Date.now()-30*60*1000) return this.cache[id];
    if (this.detailsInFlight.has(id)) return this.detailsInFlight.get(id);
    const task=this.fetchDetails(g).finally(()=>this.detailsInFlight.delete(id));
    this.detailsInFlight.set(id,task); return task;
  }
  async fetchDetails(g) {
    const repo=repoOf(g.githuburl), old=this.cache[g.id] || {};
    const [release, readme]=await Promise.allSettled([
      request(`https://api.github.com/repos/${repo}/releases/latest`),
      request(`https://api.github.com/repos/${repo}/readme`)
    ]);
    let md=old.readme || '', base=old.base || '';
    if (readme.status==='fulfilled') {md=Buffer.from(readme.value.content || '', 'base64').toString('utf8'); base=readme.value.download_url || '';}
    if (!md) {
      // GitHubのAPIが制限中でも、公開READMEを直接取得する。
      for (const branch of ['main','master']) {
        try {base=`https://raw.githubusercontent.com/${repo}/${branch}/README.md`; md=await request(base,'application/vnd.github.raw+json'); break;} catch {}
      }
    }
    const rel=release.status==='fulfilled'?release.value:old.release;
    const assets=(rel?.assets || []).filter(a=>/\.zip$/i.test(a.name)).map(a=>({id:a.id,name:a.name,size:a.size,url:a.browser_download_url,digest:a.digest || ''}));
    assets.sort((a,b)=>(/win|windows|x64/i.test(b.name)?1:0)-(/win|windows|x64/i.test(a.name)?1:0));
    const result={timestamp:Date.now(),readme:md,base,release:rel?{tag_name:rel.tag_name,body:rel.body,assets}:null, error:release.status==='rejected'?release.reason.message:'', readmeError:md?'':'READMEは公開されていません。GitHubで詳細を確認できます。'};
    // キャッシュ内のリリースは正規化済みなので、URLフィールドも維持する。
    if (release.status==='rejected' && old.release) result.release=old.release;
    this.cache[g.id]=result;
    await atomicJson(path.join(this.dataDir,'details.json'),this.cache);
    this.emit(); return result;
  }
  async install(id,assetId) {
    const g=this.game(id); if (this.jobs.has(id)) throw Error('ダウンロード中です。');
    if (this.running.has(id)) throw Error('ゲームを終了してから更新してください。');
    const detail=await this.details(id);
    const assets=detail.release?.assets || [];
    const asset=assetId?assets.find(a=>String(a.id)===String(assetId)):assets[0];
    if (!asset) throw Error('ダウンロード可能なZIPがありません。GitHubの配布ページを確認してください。');
    const root=this.settings.downloadDir || path.join(this.dataDir,'Games');
    await fs.mkdir(root,{recursive:true});
    const stage=await fs.mkdtemp(path.join(root,`.cgp-${id}-`));
    const archive=path.join(stage,'download.zip'), unpacked=path.join(stage,'game');
    const controller=new AbortController();
    const job={controller,stage:'ダウンロード中',percent:0}; this.jobs.set(id,job); this.emit();
    try {
      const response=await fetch(httpsUrl(asset.url),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30*60*1000)]),headers:{'User-Agent':'CGP-Launcher-Rebuilt'}});
      if (!response.ok) throw Error(`ダウンロード失敗 (HTTP ${response.status})。`);
      if (new URL(response.url).protocol!=='https:') throw Error('ダウンロードURLが安全ではありません。');
      const file=await fs.open(archive,'wx'); let received=0,last=0; const digest=crypto.createHash('sha256');
      const total=Number(response.headers.get('content-length')) || asset.size;
      try {
        for await (const chunk of response.body) {
          controller.signal.throwIfAborted(); received+=chunk.length;
          if (received > 6*1024**3) throw Error('ダウンロードサイズが上限を超えています。');
          await file.write(chunk); digest.update(chunk);
          if (Date.now()-last>200) {job.percent=total?Math.min(99,Math.round(received/total*100)):0;this.emit();last=Date.now();}
        }
      } finally {await file.close();}
      if (asset.size && received!==asset.size) throw Error('ダウンロードが途中で終了しました。再試行してください。');
      const actual=digest.digest('hex');
      if (asset.digest?.startsWith('sha256:') && actual!==asset.digest.slice(7)) throw Error('ファイルの検証に失敗しました。');
      controller.signal.throwIfAborted(); job.stage='展開中'; job.percent=100;this.emit();
      await extractZipSafe(archive,unpacked); controller.signal.throwIfAborted();
      const exes=await findExecutables(unpacked);
      if (!exes.length) throw Error('Windows用の実行ファイルが見つかりません。');
      const dir=path.join(root,`${id}-${Date.now()}`);
      await fs.rename(unpacked,dir);
      this.settings.installed[id]={dir,exe:exes.length===1?exes[0]:'',candidates:exes,version:detail.release.tag_name,imported:false};
      await this.save(); return this.settings.installed[id];
    } finally {
      this.jobs.delete(id); await fs.rm(stage,{recursive:true,force:true}).catch(()=>{}); this.emit();
    }
  }
  cancel(id) {this.jobs.get(id)?.controller.abort();}
  async selectExe(id,exe) {
    const item=this.settings.installed[id];
    if (!item || !(item.candidates || []).includes(exe) || !inside(item.dir,path.join(item.dir,exe))) throw Error('実行ファイルが正しくありません。');
    item.exe=exe; await this.save();this.emit();
  }
  async launch(id) {
    this.game(id);const item=this.settings.installed[id];
    if (!item) throw Error('先にゲームをダウンロードしてください。');
    if (this.running.has(id)) throw Error('このゲームは実行中です。');
    if (!item.exe) return {choose:item.candidates};
    const exe=path.join(item.dir,item.exe);
    if (!inside(item.dir,exe) || !await exists(exe)) throw Error('実行ファイルが見つかりません。再ダウンロードしてください。');
    const child=this.spawnGame(exe,[],{cwd:path.dirname(exe),shell:false,stdio:'ignore'});
    this.running.set(id,child);this.emit();
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}).catch(error=>{this.running.delete(id);this.emit();throw error;});
    child.once('exit',()=>{this.running.delete(id);this.emit();});
    child.once('error',()=>{this.running.delete(id);this.emit();});
    this.settings.history[id]={lastPlayed:Date.now(),plays:(this.settings.history[id]?.plays || 0)+1};
    await this.save();this.emit();return {ok:true};
  }
}
module.exports={LauncherService,normalizeCatalog,extractZipSafe,findExecutables,inside,repoOf,defaults,DEFAULT_URL};
