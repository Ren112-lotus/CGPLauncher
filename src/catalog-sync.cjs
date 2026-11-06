const SYNC_INTERVAL = 60_000;
const FOCUS_INTERVAL = 15_000;

class CatalogSynchronizer {
  constructor({sync, enabled, now = Date.now, timers = globalThis}) {
    Object.assign(this, {syncAction:sync, enabled, now, timers});
    this.pending = null; this.lastAttempt = -Infinity; this.timer = null;
  }
  sync() {
    if (this.pending) return this.pending;
    this.lastAttempt = this.now();
    this.pending = Promise.resolve().then(() => this.syncAction()).finally(() => { this.pending = null; });
    return this.pending;
  }
  automatic(force = false) {
    if (!this.enabled() || !force && this.now() - this.lastAttempt < FOCUS_INTERVAL) return;
    // Offline background checks keep the saved catalog. Manual callers still
    // receive errors from sync() so the reload button can report them.
    void this.sync().catch(() => {});
  }
  start() {
    this.stop(); this.automatic(true);
    this.timer = this.timers.setInterval(() => this.automatic(true), SYNC_INTERVAL);
    this.timer?.unref?.();
  }
  stop() { if (this.timer !== null) this.timers.clearInterval(this.timer); this.timer = null; }
}
module.exports = {CatalogSynchronizer, SYNC_INTERVAL, FOCUS_INTERVAL};
