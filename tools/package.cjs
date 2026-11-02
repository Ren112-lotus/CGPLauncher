const fs=require('node:fs/promises');
const path=require('node:path');
async function run(){
  const {packager}=await import('@electron/packager');
  const root=path.join(__dirname,'..');
  const {version}=require('../package.json');
  const output=path.join(root,'..','CGP-Launcher-Windows',version);
  const catalog=path.join(root,'games.json');
  if(await fs.stat(catalog).catch(()=>null)){
    const data=JSON.parse(await fs.readFile(catalog,'utf8'));
    require('../src/core.cjs').normalizeCatalog(data);
    await fs.writeFile(path.join(root,'assets','games.json'),(await fs.readFile(catalog,'utf8')).trimEnd()+'\n','utf8');
  }
  await fs.mkdir(output,{recursive:true});
  const result=await packager({dir:root,out:output,name:'CGP Launcher Rebuilt',platform:'win32',arch:'x64',icon:path.join(root,'assets/logo.ico'),overwrite:true,asar:true,prune:true,ignore:[/^\/test(?:\/|$)/,/^\/tools(?:\/|$)/,/^\/\.git(?:\/|$)/],win32metadata:{CompanyName:'CGP',FileDescription:'CGP Launcher Rebuilt',ProductName:'CGP Launcher Rebuilt'}});
  console.log(result.join('\n'));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
