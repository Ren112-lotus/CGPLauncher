const {app,BrowserWindow,WebContentsView,ipcMain,dialog,shell,nativeTheme} = require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {LauncherService}=require('./core.cjs');
let window,service,gameView,webGameId;
const localPage=pathToFileURL(path.join(__dirname,'index.html')).href;
if(process.env.CGP_TEST_DATA) app.setPath('userData',process.env.CGP_TEST_DATA);
else app.setPath('userData',path.join(app.getPath('appData'),'CGP Launcher Rebuilt'));
const acquired=app.requestSingleInstanceLock();
if(!acquired) app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
  service=new LauncherService({dataDir:app.getPath('userData'),bundledCatalog:path.join(__dirname,'../assets/games.json'),legacyResources:path.join(app.getPath('home'),'AppData/Local/Programs/CGP Modern Launcher/CGP Launcher/resources'),onChange:s=>window&&!window.isDestroyed()&&window.webContents.send('state',s)});
  await service.init();
  window=new BrowserWindow({width:1400,height:900,minWidth:1000,minHeight:700,frame:false,show:false,title:'CGP Launcher Rebuilt',backgroundColor:'#0f172a',icon:path.join(__dirname,'../assets/logo.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==localPage)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
  const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==window.webContents || event.senderFrame.url!==localPage)throw Error('不明な呼び出しです。');
    return fn(...args);
  });
  handle('snapshot',()=>service.snapshot());
  handle('sync',()=>service.sync());
  handle('settings',p=>service.updateSettings(p));
  handle('favorite',id=>service.favorite(id));
  handle('details',(id,force)=>service.details(id,force));
  handle('install',(id,asset)=>service.install(id,asset));
  handle('cancel',id=>service.cancel(id));
  handle('launch',id=>service.launch(id));
  handle('select-exe',(id,exe)=>service.selectExe(id,exe));
  handle('import-legacy',async()=>{const n=await service.importLegacy();service.emit();return n;});
  handle('folder',async()=>{const r=await dialog.showOpenDialog(window,{title:'ゲームの保存先',properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
  handle('show-folder',id=>{const item=service.settings.installed[id];if(item)shell.showItemInFolder(path.join(item.dir,item.exe || ''));});
  handle('external',async url=>{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('このリンクは開けません。');await shell.openExternal(u.href);});
  handle('window',action=>{if(action==='close')window.close();if(action==='minimize')window.minimize();if(action==='maximize')window.isMaximized()?window.unmaximize():window.maximize();});
  handle('system-theme',()=>nativeTheme.shouldUseDarkColors?'dark':'light');
  const webState=()=>{
    if(!gameView || gameView.webContents.isDestroyed())return;
    window.webContents.send('web-state',{id:webGameId,url:gameView.webContents.getURL(),loading:gameView.webContents.isLoading(),back:gameView.webContents.navigationHistory.canGoBack(),forward:gameView.webContents.navigationHistory.canGoForward()});
  };
  const closeWeb=()=>{if(gameView){window.contentView.removeChildView(gameView);gameView.webContents.close();gameView=null;webGameId=null;}};
  const positionWeb=bounds=>{
    if(!gameView)return;
    if(!bounds || !['x','y','width','height'].every(key=>Number.isFinite(bounds[key])))throw Error('WebViewの表示領域が正しくありません。');
    const content=window.getContentBounds();
    const x=Math.max(0,Math.min(content.width,Math.round(bounds.x)));
    const y=Math.max(40,Math.min(content.height,Math.round(bounds.y)));
    const width=Math.max(0,Math.min(content.width-x,Math.round(bounds.width)));
    gameView.setBounds({x,y,width,height:Math.max(0,Math.min(content.height-y,Math.round(bounds.height)))});
    // Unity Roomの960px幅のゲームがモーダル内に収まる倍率。
    gameView.webContents.setZoomFactor(Math.max(0.4,Math.min(0.7,width/1400)));
  };
  handle('web-open',async (id,bounds)=>{
    const g=service.game(id);if(!g.unityroomurl)throw Error('Web版のURLがありません。');
    closeWeb();webGameId=id;
    gameView=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'persist:cgp-games'}});
    gameView.setBackgroundColor('#10151d');
    gameView.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
    gameView.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    gameView.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('https://'))e.preventDefault();});
    gameView.webContents.on('will-redirect',(e,url)=>{if(!url.startsWith('https://'))e.preventDefault();});
    gameView.webContents.on('did-finish-load',()=>window.webContents.send('web-state',{id}));
    gameView.webContents.on('before-input-event',(event,input)=>{
      if(input.type==='keyDown' && input.control && input.key.toLowerCase()==='w'){
        event.preventDefault();window.webContents.send('web-state',{id,closeRequested:true});
      }
    });
    for(const event of ['did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page'])gameView.webContents.on(event,webState);
    gameView.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)window.webContents.send('web-state',{id,failed:`ページを読み込めませんでした (${code})。`,url});});
    window.contentView.addChildView(gameView);positionWeb(bounds);
    gameView.webContents.loadURL(g.unityroomurl).catch(()=>{});
    service.settings.history[id]={lastPlayed:Date.now(),plays:(service.settings.history[id]?.plays || 0)+1};
    await service.save();service.emit();return {id};
  });
  handle('web-bounds',positionWeb);
  handle('web-control',action=>{if(action==='close'){closeWeb();return;}if(!gameView)return;const wc=gameView.webContents;if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();if(action==='reload')wc.reload();if(action==='hide')gameView.setVisible(false);if(action==='show')gameView.setVisible(true);});
  window.on('closed',()=>{if(gameView&&!gameView.webContents.isDestroyed())gameView.webContents.close();gameView=null;});
  window.on('close',event=>{
    if(service.jobs.size){const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['ダウンロードを続ける','中止して終了'],defaultId:0,cancelId:0,message:'ダウンロード中です。終了しますか？'});if(choice===0)event.preventDefault();else for(const id of service.jobs.keys())service.cancel(id);}
  });
  await window.loadFile(path.join(__dirname,'index.html'));window.show();
}).catch(e=>{dialog.showErrorBox('CGP Launcher',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
