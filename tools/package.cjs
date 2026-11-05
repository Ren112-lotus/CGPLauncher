const fs=require('node:fs/promises');
const path=require('node:path');
async function run(){
  const {build}=require('electron-builder');
  const root=path.join(__dirname,'..');
  const {version}=require('../package.json');
  const output=path.join(root,'..','CGP-Launcher-Windows',version);
  const catalog=path.join(root,'games.json');
  if(await fs.stat(catalog).catch(()=>null)){
    const data=JSON.parse(await fs.readFile(catalog,'utf8'));
    require('../src/core.cjs').normalizeCatalog(data);
    await fs.writeFile(path.join(root,'assets','games.json'),(await fs.readFile(catalog,'utf8')).replace(/\r\n/g,'\n').trimEnd()+'\n','utf8');
  }
  await fs.mkdir(output,{recursive:true});
  const result=await build({projectDir:root,config:path.join(root,'electron-builder.json'),win:['nsis'],x64:true,publish:'never'});
  await require('./verify-release.cjs').verifyRelease(output);
  console.log(result.join('\n'));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
