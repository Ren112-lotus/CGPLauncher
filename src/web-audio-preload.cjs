const {contextBridge, ipcRenderer} = require('electron');

// This session preload runs before page scripts, including cross-origin game
// frames. It exposes no filesystem, Electron or launcher APIs to those pages.
function installAudioControl(initialVolume) {
  let level = Math.max(0, Math.min(100, initialVolume)) / 100;
  const mediaLevels = new WeakMap();
  const mediaElements = new Set();
  const trackedMedia = new WeakSet();
  const mediaInWebAudio = new WeakSet();
  const masters = new Map();
  const media = globalThis.HTMLMediaElement?.prototype;
  const volume = media && Object.getOwnPropertyDescriptor(media, 'volume');
  const play = media?.play;

  function applyMedia(element) {
    if (!volume) return;
    if (!mediaLevels.has(element)) mediaLevels.set(element, volume.get.call(element));
    volume.set.call(element, mediaLevels.get(element) * (mediaInWebAudio.has(element) ? 1 : level));
  }
  function trackMedia(element) { if(!trackedMedia.has(element)){trackedMedia.add(element);mediaElements.add(new WeakRef(element));} applyMedia(element); }
  if (volume?.get && volume?.set) {
    Object.defineProperty(media, 'volume', {
      ...volume,
      get() { return mediaLevels.has(this) ? mediaLevels.get(this) : volume.get.call(this); },
      set(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 1) return volume.set.call(this, value);
        mediaLevels.set(this, number); trackMedia(this);
      }
    });
    media.play = function(...args) { trackMedia(this); return Reflect.apply(play, this, args); };
    if (globalThis.Audio) globalThis.Audio = new Proxy(globalThis.Audio, {
      construct(target, args, newTarget) { const element = Reflect.construct(target, args, newTarget); trackMedia(element); return element; }
    });
    const scan = node => {
      if (node instanceof HTMLMediaElement) trackMedia(node);
      for (const element of node.querySelectorAll?.('audio,video') || []) trackMedia(element);
    };
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) scan(node); }).observe(document, {childList:true, subtree:true});
    scan(document);
  }

  const node = globalThis.AudioNode?.prototype;
  const connect = node?.connect, disconnect = node?.disconnect;
  function destination(source, target) {
    const context = source.context;
    if (!context || target !== context.destination || globalThis.OfflineAudioContext && context instanceof OfflineAudioContext) return target;
    let gain = masters.get(context);
    if (!gain) {
      gain = context.createGain(); gain.gain.value = level;
      Reflect.apply(connect, gain, [context.destination]); masters.set(context, gain);
    }
    return gain;
  }
  if (connect && disconnect) {
    node.connect = function(target, ...args) {
      const adjusted = destination(this, target);
      const result = Reflect.apply(connect, this, [adjusted, ...args]);
      return adjusted === target ? result : target;
    };
    node.disconnect = function(...args) {
      if (args.length && args[0] === this.context?.destination && masters.has(this.context)) args[0] = masters.get(this.context);
      return Reflect.apply(disconnect, this, args);
    };
  }
  const context = (globalThis.AudioContext || globalThis.webkitAudioContext)?.prototype;
  const createMedia = context?.createMediaElementSource;
  if (createMedia) context.createMediaElementSource = function(element) {
    const result = Reflect.apply(createMedia, this, [element]);
    mediaInWebAudio.add(element); trackMedia(element); return result;
  };

  Object.defineProperty(globalThis, '__cgpSetVolume', {value(percent) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    level = percent / 100;
    for (const [context, gain] of masters) {
      if (context.state === 'closed') { masters.delete(context); continue; }
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(level, context.currentTime, 0.01);
    }
    for (const reference of mediaElements) { const element=reference.deref();if(element)applyMedia(element);else mediaElements.delete(reference); }
  }});
}

const initial = ipcRenderer.sendSync('web-audio-settings');
contextBridge.executeInMainWorld({func:installAudioControl, args:[initial]});
ipcRenderer.on('web-audio-volume', (_event, volume) => {
  contextBridge.executeInMainWorld({func:percent => globalThis.__cgpSetVolume?.(percent), args:[volume]});
});
