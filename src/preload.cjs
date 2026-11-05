const {contextBridge,ipcRenderer}=require('electron');
const invoke=channel=>(...args)=>ipcRenderer.invoke(channel,...args);
contextBridge.exposeInMainWorld('launcher',{
  updateState:invoke('update-state'),updateCheck:invoke('update-check'),updateInstall:invoke('update-install'),onAppUpdate:fn=>{const cb=(_e,state)=>fn(state);ipcRenderer.on('app-update',cb);return()=>ipcRenderer.removeListener('app-update',cb);},
  snapshot:invoke('snapshot'),sync:invoke('sync'),settings:invoke('settings'),favorite:invoke('favorite'),details:invoke('details'),install:invoke('install'),cancel:invoke('cancel'),launch:invoke('launch'),selectExe:invoke('select-exe'),importLegacy:invoke('import-legacy'),folder:invoke('folder'),showFolder:invoke('show-folder'),external:invoke('external'),window:invoke('window'),systemTheme:invoke('system-theme'),webOpen:invoke('web-open'),webBounds:invoke('web-bounds'),webControl:invoke('web-control'),onWebState:fn=>{ipcRenderer.on('web-state',(_e,s)=>fn(s));},onState:fn=>{const cb=(_e,s)=>fn(s);ipcRenderer.on('state',cb);return()=>ipcRenderer.removeListener('state',cb);}
});
