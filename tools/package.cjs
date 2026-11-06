const fs=require('node:fs/promises');
const path=require('node:path');
async function run(){
  const {build}=require('electron-builder');
  const root=path.join(__dirname,'..');
  const {version}=require('../package.json');
  const output=path.join(root,'..','CGP-Launcher-Windows',version);
  // The live Sites database is authoritative. Ship a snapshot for offline use.
  const {DEFAULT_URL,normalizeCatalog}=require('../src/core.cjs');
  const response=await fetch(DEFAULT_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw Error(`カタログを取得できませんでした (HTTP ${response.status})。`);
  const text=await response.text();
  if(Buffer.byteLength(text)>15*1024**2) throw Error('カタログが大きすぎます。');
  const data=JSON.parse(text); normalizeCatalog(data);
  await fs.writeFile(path.join(root,'assets','games.json'),JSON.stringify(data,null,2)+'\n','utf8');
  await fs.mkdir(output,{recursive:true});
  const result=await build({projectDir:root,config:path.join(root,'electron-builder.json'),win:['nsis'],x64:true,publish:'never'});
  await require('./verify-release.cjs').verifyRelease(output);
  console.log(result.join('\n'));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
