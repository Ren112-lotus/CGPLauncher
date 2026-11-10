const {app,BrowserWindow,WebContentsView,ipcMain,dialog,shell,nativeTheme,session} = require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {LauncherService}=require('./core.cjs');
const {LauncherUpdater}=require('./updater.cjs');
const {CatalogSynchronizer}=require('./catalog-sync.cjs');
const {isUnityRoomPage,isUnityRoomGame,resolveWebGame}=require('./web-game.cjs');
const {autoUpdater}=require('electron-updater');
const {existsSync}=require('node:fs');
let window,service,gameView,webGameId,launcherUpdater,catalogSync;
let pendingGameActions=0;
let webLoadController,webGameOnly=false,webSourceUrl='';
let systemEnding=false,skipAutoExitUpdate=false;
const localPage=pathToFileURL(path.join(__dirname,'index.html')).href;
if(process.env.CGP_TEST_DATA) app.setPath('userData',process.env.CGP_TEST_DATA);
else app.setPath('userData',path.join(app.getPath('appData'),'CGP Launcher Rebuilt'));
const acquired=app.requestSingleInstanceLock();
if(!acquired) app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
  app.setAppUserModelId('com.cgpstudios.launcher.rebuilt');
  service=new LauncherService({dataDir:app.getPath('userData'),bundledCatalog:path.join(__dirname,'../assets/games.json'),legacyResources:path.join(app.getPath('home'),'AppData/Local/Programs/CGP Modern Launcher/CGP Launcher/resources'),onChange:s=>window&&!window.isDestroyed()&&window.webContents.send('state',s)});
  await service.init();
  catalogSync=new CatalogSynchronizer({sync:()=>service.sync(),enabled:()=>service.settings.autoSync});
  const gameSession=session.fromPartition('persist:cgp-games');
  gameSession.registerPreloadScript({type:'frame',id:'cgp-web-audio',filePath:path.join(__dirname,'web-audio-preload.cjs')});
  const setWebVolume=value=>{
    if(!Number.isFinite(value)||value<0||value>100)throw Error('音量は0〜100で指定してください。');
    service.settings.webVolume=value;
    if(gameView&&!gameView.webContents.isDestroyed()){
      gameView.webContents.setAudioMuted(value===0);
      for(const frame of gameView.webContents.mainFrame.framesInSubtree){try{frame.send('web-audio-volume',value);}catch{}}
    }
    return value;
  };
  ipcMain.on('web-audio-settings',event=>{event.returnValue=gameView&&event.sender===gameView.webContents?service.settings.webVolume:100;});
  launcherUpdater=new LauncherUpdater({
    updater:autoUpdater,version:app.getVersion(),
    supported:process.platform==='win32' && app.isPackaged && existsSync(path.join(process.resourcesPath,'app-update.yml')),
    enabled:()=>service.settings.autoUpdate,
    busyReason:()=>service.jobs.size?'ゲームのダウンロードが完了してから更新してください。':service.running.size?'実行中のゲームを終了してから更新してください。':webGameId?'Unity Roomを閉じてから更新してください。':pendingGameActions?'ゲームの起動・ダウンロード準備が完了してから更新してください。':'',
    prepareInstall:()=>service.save(),
    onChange:state=>window&&!window.isDestroyed()&&window.webContents.send('app-update',state)
  });
  window=new BrowserWindow({width:1400,height:900,minWidth:1000,minHeight:700,frame:false,roundedCorners:false,show:false,title:'CGP Launcher Rebuilt',backgroundColor:'#151617',icon:path.join(__dirname,'../assets/logo.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==localPage)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
  const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==window.webContents || event.senderFrame.url!==localPage)throw Error('不明な呼び出しです。');
    return fn(...args);
  });
  handle('snapshot',()=>service.snapshot());
  handle('sync',()=>catalogSync.sync());
  handle('settings',async p=>{const result=await service.updateSettings(p);if(p.webVolume!==undefined)setWebVolume(p.webVolume);if(p.autoSync===true)catalogSync.automatic(true);return result;});
  handle('web-volume',setWebVolume);
  handle('favorite',id=>service.favorite(id));
  handle('details',(id,force)=>service.details(id,force));
  const requireNotUpdating=()=>{if(launcherUpdater.isInstalling)throw Error('ランチャーの更新を適用中です。');};
  const gameAction=async action=>{requireNotUpdating();pendingGameActions++;try{return await action();}finally{pendingGameActions--;}};
  handle('install',(id,asset)=>gameAction(()=>service.install(id,asset)));
  handle('cancel',id=>service.cancel(id));
  handle('launch',id=>gameAction(()=>service.launch(id)));
  handle('select-exe',(id,exe)=>service.selectExe(id,exe));
  handle('import-legacy',async()=>{const n=await service.importLegacy();service.emit();return n;});
  handle('folder',async()=>{const r=await dialog.showOpenDialog(window,{title:'ゲームの保存先',properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
  handle('show-folder',id=>{const item=service.settings.installed[id];if(item)shell.showItemInFolder(path.join(item.dir,item.exe || ''));});
  handle('external',async url=>{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('このリンクは開けません。');await shell.openExternal(u.href);});
  handle('window',action=>{if(action==='close')window.close();if(action==='minimize')window.minimize();if(action==='maximize')window.isMaximized()?window.unmaximize():window.maximize();});
  handle('system-theme',()=>nativeTheme.shouldUseDarkColors?'dark':'light');
  handle('update-state',()=>launcherUpdater.snapshot());
  handle('update-check',()=>launcherUpdater.check());
  handle('update-install',()=>launcherUpdater.install());
  const webState=()=>{
    if(!gameView || gameView.webContents.isDestroyed())return;
    window.webContents.send('web-state',{id:webGameId,url:gameView.webContents.getURL(),loading:gameView.webContents.isLoading(),back:gameView.webContents.navigationHistory.canGoBack(),forward:gameView.webContents.navigationHistory.canGoForward()});
  };
  const closeWeb=()=>{webLoadController?.abort();webLoadController=null;if(gameView){window.contentView.removeChildView(gameView);gameView.webContents.close();gameView=null;webGameId=null;}};
  const loadWebGame=()=>{
    if(!gameView)return;
    webLoadController?.abort();
    const controller=new AbortController(),view=gameView,id=webGameId;
    webLoadController=controller;
    window.webContents.send('web-state',{id,loading:true});
    void resolveWebGame(webSourceUrl,{signal:controller.signal}).then(url=>{
      if(controller.signal.aborted||gameView!==view)return;
      return view.webContents.loadURL(url);
    }).catch(error=>{
      if(!controller.signal.aborted&&gameView===view&&!window.isDestroyed())window.webContents.send('web-state',{id,loading:false,failed:error.message});
    });
  };
  const positionWeb=bounds=>{
    if(!gameView)return;
    if(!bounds || !['x','y','width','height'].every(key=>Number.isFinite(bounds[key])))throw Error('WebViewの表示領域が正しくありません。');
    const content=window.getContentBounds();
    const x=Math.max(0,Math.min(content.width,Math.round(bounds.x)));
    const y=Math.max(40,Math.min(content.height,Math.round(bounds.y)));
    const width=Math.max(0,Math.min(content.width-x,Math.round(bounds.width)));
    gameView.setBounds({x,y,width,height:Math.max(0,Math.min(content.height-y,Math.round(bounds.height)))});
    // The dedicated play page contains/resizes its canvas to the viewport.
    gameView.webContents.setZoomFactor(webGameOnly?1:Math.max(0.4,Math.min(0.7,width/1400)));
  };
  handle('web-open',async (id,bounds)=>{
    requireNotUpdating();
    const g=service.game(id);if(!g.unityroomurl)throw Error('Web版のURLがありません。');
    closeWeb();webGameId=id;
    webSourceUrl=g.unityroomurl;
    webGameOnly=isUnityRoomPage(webSourceUrl)||isUnityRoomGame(webSourceUrl);
    // Subframe preloads are required for Unity Room's cross-origin game frame.
    // The sandbox remains enabled and Node is never exposed to page scripts.
    gameView=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:true,session:gameSession}});
    gameView.webContents.setAudioMuted(service.settings.webVolume===0);
    gameView.setBackgroundColor('#101112');
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
    loadWebGame();
    service.settings.history[id]={lastPlayed:Date.now(),plays:(service.settings.history[id]?.plays || 0)+1};
    await service.save();service.emit();return {id};
  });
  handle('web-bounds',positionWeb);
  handle('web-control',action=>{if(action==='close'){closeWeb();return;}if(!gameView)return;const wc=gameView.webContents;if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();if(action==='reload'){if(webGameOnly)loadWebGame();else wc.reload();}if(action==='hide')gameView.setVisible(false);if(action==='show')gameView.setVisible(true);});
  window.on('closed',()=>{webLoadController?.abort();if(gameView&&!gameView.webContents.isDestroyed())gameView.webContents.close();gameView=null;});
  window.on('focus',()=>catalogSync.automatic());
  for(const event of ['query-session-end','session-end'])window.on(event,()=>{systemEnding=true;launcherUpdater.stop();});
  window.on('close',event=>{
    if(service.jobs.size){const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['ダウンロードを続ける','中止して終了'],defaultId:0,cancelId:0,message:'ダウンロード中です。終了しますか？'});if(choice===0)event.preventDefault();else for(const id of service.jobs.keys())service.cancel(id);}
    if(event.defaultPrevented||systemEnding||skipAutoExitUpdate||launcherUpdater.isInstalling)return;
    // Closing this window also ends its web game. Never replace files while a
    // separate Windows game, download or launch preparation is still active.
    if(!service.running.size&&!service.jobs.size&&!pendingGameActions)closeWeb();
    const installing=launcherUpdater.installOnExit();
    if(installing){event.preventDefault();void installing.catch(()=>{skipAutoExitUpdate=true;});}
  });
  await window.loadFile(path.join(__dirname,'index.html'));window.show();
  launcherUpdater.start();
  catalogSync.start();
}).catch(e=>{dialog.showErrorBox('CGP Launcher',e.message);app.quit();});
app.on('before-quit',()=>{launcherUpdater?.stop();catalogSync?.stop();});
app.on('window-all-closed',()=>app.quit());
