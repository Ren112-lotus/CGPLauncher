const {app,BrowserWindow,session,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const os=require('node:os');
let window,server;
app.setPath('userData',path.join(os.tmpdir(),`cgp-audio-test-${process.pid}`));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const script=`
  window.fixtureReady = (async()=>{
    window.hasAudioControl=typeof window.__cgpSetVolume==='function';
    const createGain=AudioContext.prototype.createGain;
    const gains=[];
    AudioContext.prototype.createGain=function(){const gain=createGain.call(this);gains.push(gain);return gain;};
    const context=new AudioContext();
    const source=context.createGain();source.gain.value=.7;
    const destination=source.connect(context.destination);
    const master=gains[gains.length-1];
    window.audioFixture={context,source,master,returnedDestination:destination===context.destination,gainCount:gains.length};
    const audio=new Audio();audio.id='audio-fixture';audio.volume=.5;document.body.append(audio);
    await context.resume();return true;
  })();
`;
const html=child=>`<!doctype html><body>${child?'':'<iframe src="http://localhost:PORT/child"></iframe>'}<script>${script}</script></body>`;
app.whenReady().then(async()=>{
  server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end(html(request.url==='/child').replaceAll('PORT',String(server.address().port)));});
  await new Promise(resolve=>server.listen(0,resolve));
  const ses=session.fromPartition('cgp-audio-fixture');
  ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../src/web-audio-preload.cjs')});
  ipcMain.on('web-audio-settings',event=>{event.returnValue=40;});
  window=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true}});
  window.webContents.on('preload-error',(_event,file,error)=>{console.error(file,error);process.exitCode=1;});
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const frames=window.webContents.mainFrame.framesInSubtree.filter(frame=>/^http:/.test(frame.url));
  assert.equal(frames.length,2);
  for(const frame of frames){
    await frame.executeJavaScript('window.fixtureReady');
    assert.equal(await frame.executeJavaScript("typeof require + '/' + typeof process"),'undefined/undefined');
    const state=await frame.executeJavaScript('({installed:hasAudioControl,master:audioFixture.master.gain.value,source:audioFixture.source.gain.value,returnedDestination:audioFixture.returnedDestination,count:audioFixture.gainCount})');
    assert.equal(state.installed,true,frame.url);assert.equal(state.count,2);assert.ok(Math.abs(state.master-.4)<.001);assert.ok(Math.abs(state.source-.7)<.001);assert.equal(state.returnedDestination,true);
  }
  let effective=await window.webContents.executeJavaScriptInIsolatedWorld(987,[{code:`document.getElementById('audio-fixture').volume`}]);assert.ok(Math.abs(effective-.2)<.001);
  for(const frame of frames)frame.send('web-audio-volume',25);
  await new Promise(resolve=>setTimeout(resolve,200));
  for(const frame of frames){const value=await frame.executeJavaScript('audioFixture.master.gain.value');assert.ok(Math.abs(value-.25)<.002);}
  effective=await window.webContents.executeJavaScriptInIsolatedWorld(987,[{code:`document.getElementById('audio-fixture').volume`}]);assert.ok(Math.abs(effective-.125)<.001);
  // Media routed into WebAudio must not be attenuated twice.
  await window.webContents.executeJavaScript(`audioFixture.context.createMediaElementSource(document.getElementById('audio-fixture')).connect(audioFixture.context.destination);`);
  effective=await window.webContents.executeJavaScriptInIsolatedWorld(987,[{code:`document.getElementById('audio-fixture').volume`}]);assert.ok(Math.abs(effective-.5)<.001);
  await window.webContents.executeJavaScript('audioFixture.source.disconnect(audioFixture.context.destination);');
  console.log('Electron audio verified: sandboxed main/cross-origin frames, WebAudio gain, media volume, no double scaling, disconnect semantics.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();server?.close();app.exit(process.exitCode||0);});
