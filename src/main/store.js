'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { defaultState, mockProvider, MOCK_ID } = require('./state');
const { atomicWrite, deepMerge, ensureDir, readJson, nowIso, localDateKey } = require('./util');

class Store extends EventEmitter {
  constructor({ file, backupDir }) {
    super();
    this.file = file;
    this.backupDir = backupDir || path.join(path.dirname(file), 'backups');
    this.state = defaultState();
    this._timer = null;
    this._dirty = false;
  }

  load() {
    ensureDir(path.dirname(this.file));
    const raw = fs.existsSync(this.file) ? readJson(this.file, null) : null;
    if (raw && typeof raw === 'object') {
      this.state = this._normalize(deepMerge(defaultState(), raw));
    } else {
      if (fs.existsSync(this.file)) {
        try {
          fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {}
      }
      this.state = defaultState();
      this._dirty = true;
      this.save(true);
    }
    this._maybeBackup();
    return this.state;
  }

  _normalize(state) {
    if (!Array.isArray(state.settings.providers) || state.settings.providers.length === 0) {
      state.settings.providers = [mockProvider()];
      state.settings.activeProviderId = MOCK_ID;
    }
    if (!state.settings.providers.some((p) => p.id === state.settings.activeProviderId)) {
      state.settings.activeProviderId = state.settings.providers[0].id;
    }
    for (const key of ['tasks', 'notes', 'agents', 'runs', 'reports', 'inbox', 'chat']) {
      if (!Array.isArray(state[key])) state[key] = [];
    }
    state.meta = state.meta || {};
    if (!state.meta.agentApiToken) state.meta.agentApiToken = '';
    return state;
  }

  get data() {
    return this.state;
  }

  mutate(fn, { immediate = false } = {}) {
    const result = fn(this.state);
    this._dirty = true;
    this.emit('changed');
    this.save(immediate);
    return result;
  }

  save(immediate = false, force = false) {
    if (!this._dirty && !force && fs.existsSync(this.file)) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!immediate) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._flush();
      }, 150);
      return;
    }
    this._flush();
  }

  _flush() {
    try {
      atomicWrite(this.file, JSON.stringify(this.state, null, 2));
      this._dirty = false;
    } catch (err) {
      console.error('[store] 保存失败', err);
    }
  }

  flush() {
    this.save(true);
  }

  _maybeBackup() {
    try {
      const today = localDateKey();
      if (this.state.meta.lastBackupDate === today) return;
      ensureDir(this.backupDir);
      const file = path.join(this.backupDir, `dog-${today}.json`);
      atomicWrite(file, JSON.stringify(this.state, null, 2));
      this.state.meta.lastBackupDate = today;
      this.save(true, true);
      const files = fs
        .readdirSync(this.backupDir)
        .filter((f) => /^dog-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      while (files.length > 7) {
        const old = files.shift();
        try {
          fs.unlinkSync(path.join(this.backupDir, old));
        } catch {}
      }
    } catch (err) {
      console.warn('[store] 自动备份失败', err.message);
    }
  }

  backupNow() {
    ensureDir(this.backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.backupDir, `manual-${stamp}.json`);
    atomicWrite(file, JSON.stringify(this.state, null, 2));
    return file;
  }

  reset() {
    this.state = defaultState();
    this.state.meta.agentApiToken = '';
    this._dirty = true;
    this.emit('changed');
    this.save(true);
    return this.state;
  }

  close() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._dirty) this._flush();
  }
}

module.exports = { Store };
