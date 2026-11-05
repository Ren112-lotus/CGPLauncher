// UI-independent update state machine. electron-updater owns download integrity
// checks, caching, and the NSIS replacement process.
const STARTUP_DELAY = 10_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function updateError(error) {
  const text = `${error?.code || ''} ${error?.message || error}`;
  if (/SHA|checksum|signature|ERR_UPDATER_INVALID/i.test(text)) return '更新ファイルの検証に失敗しました。もう一度お試しください。';
  if (/EACCES|EPERM|ENOSPC/i.test(text)) return '更新ファイルを保存できませんでした。保存先の空き容量とアクセス権を確認してください。';
  return '更新を確認・ダウンロードできませんでした。通信環境を確認して、もう一度お試しください。';
}

class LauncherUpdater {
  constructor({updater, version, supported, enabled = () => true, busyReason = () => '', prepareInstall = async () => {}, onChange = () => {}, now = Date.now, timers = globalThis}) {
    Object.assign(this, {updater, enabled, busyReason, prepareInstall, onChange, now, timers});
    this.state = {currentVersion: version, version: '', status: supported ? 'idle' : 'unsupported', percent: 0, lastChecked: null, error: ''};
    this.supported = supported;
    this.checkPromise = null;
    this.installPromise = null;
    this.timer = null;
    this.interval = null;
    this.stopped = false;
    updater.autoDownload = true;
    // Do not spawn an installer during shutdown, or while a game is running.
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.on('checking-for-update', () => this.set({status: 'checking', error: '', percent: 0}));
    updater.on('update-not-available', () => this.set({status: 'idle', version: '', percent: 0, lastChecked: this.now(), error: ''}));
    updater.on('update-available', info => this.set({status: 'downloading', version: info.version, percent: 0, error: ''}));
    updater.on('download-progress', info => this.set({status: 'downloading', percent: Math.max(0, Math.min(100, Number(info.percent) || 0))}));
    updater.on('update-downloaded', info => this.set({status: 'downloaded', version: info.version, percent: 100, error: ''}));
    updater.on('error', error => this.fail(error));
  }
  snapshot() { return {...this.state}; }
  set(patch) { Object.assign(this.state, patch); this.onChange(this.snapshot()); }
  fail(error) { this.set({status: 'error', error: updateError(error)}); }
  get isInstalling() { return this.state.status === 'installing'; }
  start() {
    if (!this.supported) return;
    this.stopped = false;
    const automatic = () => { if (!this.stopped && this.enabled()) void this.check(); };
    this.timer = this.timers.setTimeout(automatic, STARTUP_DELAY);
    this.interval = this.timers.setInterval(automatic, CHECK_INTERVAL);
    this.timer?.unref?.(); this.interval?.unref?.();
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    this.timer = this.interval = null;
  }
  check() {
    if (!this.supported || ['downloading', 'downloaded', 'installing'].includes(this.state.status)) return Promise.resolve(this.snapshot());
    if (this.checkPromise) return this.checkPromise;
    this.set({status: 'checking', error: '', percent: 0, lastChecked: this.now()});
    // Install listeners before invoking checkForUpdates: a cached update can
    // emit update-downloaded immediately, before checkForUpdates resolves.
    this.checkPromise = Promise.resolve().then(() => this.updater.checkForUpdates()).then(result => {
      if (result?.downloadPromise) void result.downloadPromise.catch(error => this.fail(error));
      if (result === null) this.set({status: 'unsupported'});
      return this.snapshot();
    }).catch(error => { this.fail(error); return this.snapshot(); }).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  install() {
    if (this.installPromise) return this.installPromise;
    if (this.state.status !== 'downloaded') return Promise.reject(Error('更新のダウンロードが完了していません。'));
    const busy = this.busyReason();
    if (busy) return Promise.reject(Error(busy));
    this.set({status: 'installing', error: ''});
    this.installPromise = Promise.resolve().then(() => this.prepareInstall()).then(() => {
      const reason = this.busyReason();
      if (reason) throw Error(reason);
      // Silent per-user NSIS installation; relaunch after applying the update.
      this.updater.quitAndInstall(true, true);
      return this.snapshot();
    }).catch(error => {
      this.set({status: 'downloaded', error: error.message});
      throw error;
    }).finally(() => { this.installPromise = null; });
    return this.installPromise;
  }
}
module.exports = {LauncherUpdater, updateError, STARTUP_DELAY, CHECK_INTERVAL};
