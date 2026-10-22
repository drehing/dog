'use strict';

const { BrowserWindow, Notification, shell, screen } = require('electron');
const { uid, truncate, nowIso, inQuietHours } = require('./util');

const TOAST_W = 372;
const TOAST_H = 112;
const GAP = 10;
const MAX_VISIBLE = 3;

class NotifyService {
  constructor({ store, mainWindow, toastHtml, toastPreload, onClick }) {
    this.store = store;
    this.mainWindow = mainWindow;
    this.toastHtml = toastHtml;
    this.toastPreload = toastPreload;
    this.onClick = onClick || (() => {});
    this.toasts = [];
    this.queue = [];
    this.byWebContents = new Map();
    this._closing = false;
  }

  get data() {
    return this.store.data;
  }

  unreadCount() {
    return this.data.inbox.filter((i) => !i.read).length;
  }

  markRead(id) {
    const item = this.data.inbox.find((i) => i.id === id);
    if (!item || item.read) return;
    this.store.mutate(() => {
      item.read = true;
      item.readAt = nowIso();
    });
  }

  markAllRead() {
    const unread = this.data.inbox.filter((i) => !i.read);
    if (!unread.length) return 0;
    this.store.mutate(() => {
      for (const i of unread) {
        i.read = true;
        i.readAt = nowIso();
      }
    });
    return unread.length;
  }

  clearRead() {
    this.store.mutate((s) => {
      s.inbox = s.inbox.filter((i) => !i.read);
    });
  }

  notify({
    kind = 'system',
    title = 'Dog 秘书',
    body = '',
    short = '',
    meta = {},
    dedupeKey = '',
    force = false,
    silent = false,
    preview = false,
  } = {}) {
    const settings = this.data.settings;
    if (dedupeKey && !force) {
      const existing = this.data.inbox.find(
        (i) => i.dedupeKey === dedupeKey && Date.now() - i.at < 30 * 60 * 1000
      );
      if (existing) return existing;
    }
    const item = {
      id: uid('msg'),
      at: Date.now(),
      kind,
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 6000),
      short: truncate(short || body.replace(/\n+/g, ' · '), 160),
      read: false,
      meta: meta && typeof meta === 'object' ? meta : {},
      dedupeKey: dedupeKey || '',
    };
    if (!preview) {
      this.store.mutate((s) => {
        s.inbox.unshift(item);
        if (s.inbox.length > 600) s.inbox.length = 600;
      });
    }

    const quiet = inQuietHours(settings);
    const muted = this.data.meta.mutedUntil && Date.now() < this.data.meta.mutedUntil;
    const canShow = !silent && !quiet && !muted;
    if (canShow) {
      if (settings.notify.floating !== false) {
        this._showToast(item);
      }
      if (settings.notify.native) {
        this._showNative(item);
      }
      if (settings.notify.sound && (kind === 'attention' || kind === 'briefing' || force)) {
        try {
          shell.beep();
        } catch {}
      }
    }
    return item;
  }

  _showNative(item) {
    if (!Notification.isSupported()) return;
    try {
      const n = new Notification({
        title: item.title,
        body: item.short,
        silent: true,
      });
      n.on('click', () => {
        this.markRead(item.id);
        this.onClick(item);
      });
      n.show();
    } catch (err) {
      console.warn('[notify] 系统通知失败', err.message);
    }
  }

  _showToast(item) {
    if (this._closing) return;
    if (this.toasts.length >= MAX_VISIBLE) {
      this.queue.push(item);
      if (this.queue.length > 10) this.queue.shift();
      return;
    }
    let win;
    try {
      win = new BrowserWindow({
        width: TOAST_W,
        height: TOAST_H,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        closable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        show: false,
        webPreferences: {
          preload: this.toastPreload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
    } catch (err) {
      console.warn('[notify] 悬浮通知窗口创建失败，退回系统通知', err.message);
      this._showNative(item);
      return;
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
    const duration = Math.min(30, Math.max(4, Number(this.data.settings.notify.durationSec) || 9));
    const entry = {
      id: item.id,
      win,
      item,
      duration,
      timer: null,
      remaining: duration * 1000,
      startedAt: 0,
      paused: false,
      closing: false,
    };
    this.toasts.push(entry);
    this.byWebContents.set(win.webContents.id, entry);
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('toast:data', {
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.short,
        time: new Date(item.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        duration,
      });
      this._layout();
      win.showInactive();
      this._startTimer(entry);
    });
    win.loadFile(this.toastHtml).catch((err) => {
      console.warn('[notify] 加载通知页面失败', err.message);
      this._destroyEntry(entry, false);
    });
  }

  _startTimer(entry) {
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => this._dismiss(entry), entry.remaining);
  }

  _pause(entry) {
    if (entry.paused || entry.closing) return;
    entry.paused = true;
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.remaining = Math.max(1000, entry.remaining - (Date.now() - entry.startedAt));
  }

  _resume(entry) {
    if (!entry.paused || entry.closing) return;
    entry.paused = false;
    this._startTimer(entry);
  }

  _dismiss(entry) {
    if (!entry || entry.closing) return;
    entry.closing = true;
    clearTimeout(entry.timer);
    try {
      entry.win.webContents.send('toast:hide');
    } catch {}
    const finish = () => this._destroyEntry(entry, true);
    setTimeout(finish, 170);
  }

  _destroyEntry(entry, refill) {
    if (!entry) return;
    const idx = this.toasts.indexOf(entry);
    if (idx >= 0) this.toasts.splice(idx, 1);
    this.byWebContents.delete(entry.win.webContents.id);
    if (!entry.win.isDestroyed()) entry.win.destroy();
    if (refill) {
      this._layout();
      this._fill();
    }
  }

  _fill() {
    while (this.toasts.length < MAX_VISIBLE && this.queue.length) {
      const item = this.queue.shift();
      this._showToast(item);
    }
  }

  _layout() {
    const display = this._targetDisplay();
    const area = display.workArea;
    const startX = area.x + area.width - TOAST_W - 16;
    const startY = area.y + 16;
    this.toasts.forEach((entry, i) => {
      if (!entry.win || entry.win.isDestroyed()) return;
      const x = startX;
      const y = startY + i * (TOAST_H + GAP);
      try {
        entry.win.setBounds({ x: Math.round(x), y: Math.round(y), width: TOAST_W, height: TOAST_H });
      } catch {}
    });
  }

  _targetDisplay() {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        return screen.getDisplayMatching(this.mainWindow.getBounds());
      }
    } catch {}
    return screen.getPrimaryDisplay();
  }

  handleWindowEvent(wcId, channel, payload) {
    const entry = this.byWebContents.get(wcId);
    if (!entry) return;
    if (channel === 'dismiss') {
      this._dismiss(entry);
    } else if (channel === 'open') {
      this.markRead(entry.item.id);
      this._dismiss(entry);
      this.onClick(entry.item);
    } else if (channel === 'hover') {
      if (payload) this._pause(entry);
      else this._resume(entry);
    }
  }

  dismissAll() {
    for (const entry of [...this.toasts]) this._dismiss(entry);
    this.queue = [];
  }

  close() {
    this._closing = true;
    for (const entry of this.toasts) {
      clearTimeout(entry.timer);
      try {
        entry.win.destroy();
      } catch {}
    }
    this.toasts = [];
    this.byWebContents.clear();
  }
}

module.exports = { NotifyService, TOAST_W, TOAST_H };
