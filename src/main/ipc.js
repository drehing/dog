'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ipcMain,
  clipboard,
  dialog,
  shell,
  app,
} = require('electron');
const { deepMerge, truncate } = require('./util');
const { encrypt, decrypt, hint, encryptionAvailable } = require('./secrets');
const { sanitizeProviderInput } = require('./providers');
const { testProvider } = require('./llm');
const { buildView } = require('./view');
const { seedDemo } = require('./demo');

function registerIpc(ctx) {
  const {
    store,
    tasks,
    agents,
    supervisor,
    secretary,
    scheduler,
    server,
    notify,
    getMainWindow,
    broadcast,
    dataDir,
    dataDirSource,
    onSettingsChanged,
    notifyToastEvent,
  } = ctx;

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, data: await fn(payload || {}) };
      } catch (err) {
        return { ok: false, error: truncate(err?.message || String(err), 500) };
      }
    });
  };

  const view = () =>
    buildView({
      store,
      agents,
      scheduler,
      server,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      dataDir,
      dataDirSource,
      encryptionAvailable: encryptionAvailable(),
      loginAtStartup: getLoginAtStartup(),
    });

  handle('app:bootstrap', () => view());
  handle('app:state', () => view());

  handle('app:update-settings', (patch) => {
    const before = {
      agentApi: { ...store.data.settings.agentApi },
      launchAtLogin: store.data.settings.launchAtLogin,
      hotkey: store.data.settings.hotkey,
    };
    const clean = JSON.parse(JSON.stringify(patch || {}));
    delete clean.providers;
    delete clean.activeProviderId;
    if (clean.agentApi) delete clean.agentApi.token;
    store.mutate((s) => {
      s.settings = normalizeSettings(deepMerge(s.settings, clean));
    });
    onSettingsChanged?.(before, store.data.settings);
    broadcast('settings');
    return view();
  });

  handle('app:onboarding', (payload) => {
    const userName = String(payload.userName || '').trim().slice(0, 40);
    const assistantName = String(payload.assistantName || '阿犬').trim().slice(0, 20) || '阿犬';
    const briefingTime = /^\d{1,2}:\d{2}$/.test(payload.briefingTime || '') ? payload.briefingTime : '08:30';
    store.mutate((s) => {
      s.settings.userName = userName;
      s.settings.assistantName = assistantName;
      s.settings.schedule.briefing.time = briefingTime;
      s.meta.onboarded = true;
    });
    if (payload.provider && payload.provider.kind !== 'mock') {
      const provider = sanitizeProviderInput(payload.provider);
      if (payload.apiKey) {
        provider.apiKeyCipher = encrypt(payload.apiKey);
        provider.keyHint = hint(payload.apiKey);
      }
      provider.name = String(payload.provider.name || provider.name);
      store.mutate((s) => {
        const existing = s.settings.providers.findIndex((p) => p.id === provider.id);
        if (existing >= 0) s.settings.providers[existing] = provider;
        else s.settings.providers.push(provider);
        s.settings.activeProviderId = provider.id;
      });
    } else if (payload.provider?.kind === 'mock') {
      const mock = store.data.settings.providers.find((p) => p.kind === 'mock');
      if (mock) store.mutate((s) => (s.settings.activeProviderId = mock.id));
    }
    if (payload.demo) seedDemo({ store, agents });
    broadcast('onboarding');
    return view();
  });

  handle('providers:save', ({ provider, apiKey, activate } = {}) => {
    const existing = provider?.id ? store.data.settings.providers.find((p) => p.id === provider.id) : null;
    const next = sanitizeProviderInput(provider || {}, existing);
    if (typeof apiKey === 'string' && apiKey.trim()) {
      next.apiKeyCipher = encrypt(apiKey.trim());
      next.keyHint = hint(apiKey.trim());
      next.lastTestAt = null;
      next.lastTestOk = null;
    }
    store.mutate((s) => {
      const idx = s.settings.providers.findIndex((p) => p.id === next.id);
      if (idx >= 0) s.settings.providers[idx] = next;
      else s.settings.providers.push(next);
      if (activate || !s.settings.activeProviderId) s.settings.activeProviderId = next.id;
    });
    broadcast('providers');
    return view();
  });

  handle('providers:delete', ({ id } = {}) => {
    const target = store.data.settings.providers.find((p) => p.id === id);
    if (!target) throw new Error('模型不存在');
    store.mutate((s) => {
      s.settings.providers = s.settings.providers.filter((p) => p.id !== id);
      if (!s.settings.providers.length) {
        const { mockProvider } = require('./state');
        s.settings.providers = [mockProvider()];
      }
      if (!s.settings.providers.some((p) => p.id === s.settings.activeProviderId)) {
        s.settings.activeProviderId = s.settings.providers[0].id;
      }
    });
    broadcast('providers');
    return view();
  });

  handle('providers:activate', ({ id } = {}) => {
    if (!store.data.settings.providers.some((p) => p.id === id)) throw new Error('模型不存在');
    store.mutate((s) => (s.settings.activeProviderId = id));
    broadcast('providers');
    return view();
  });

  handle('providers:test', async ({ provider, apiKey } = {}) => {
    const existing = provider?.id ? store.data.settings.providers.find((p) => p.id === provider.id) : null;
    const probe = sanitizeProviderInput(
      {
        ...(existing || {}),
        ...(provider || {}),
        apiKeyCipher: existing?.apiKeyCipher || '',
      },
      existing
    );
    const key = apiKey && apiKey.trim() ? apiKey.trim() : decrypt(existing?.apiKeyCipher || '');
    let result;
    try {
      result = await testProvider({ provider: probe, apiKey: key });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (existing) {
      store.mutate(() => {
        existing.lastTestAt = Date.now();
        existing.lastTestOk = Boolean(result.ok);
      });
      broadcast('providers');
    }
    return result;
  });

  handle('tasks:list', ({ scope, limit } = {}) => tasks.list({ scope: scope || 'active', limit: limit || 200 }));
  handle('tasks:create', (payload) => tasks.create(payload));
  handle('tasks:update', ({ id, patch } = {}) => tasks.update(id, patch || {}));
  handle('tasks:complete', ({ id } = {}) => tasks.complete(id));
  handle('tasks:reopen', ({ id } = {}) => tasks.reopen(id));
  handle('tasks:delete', ({ id } = {}) => tasks.remove(id));
  handle('tasks:quick-add', ({ text } = {}) => tasks.quickAdd(text));
  handle('notes:add', ({ content, tags } = {}) => tasks.addNote(content, tags));
  handle('notes:list', () => tasks.listNotes());

  handle('agents:list', () => agents.list());
  handle('agents:create', (payload) => agents.create(payload));
  handle('agents:update', ({ id, patch } = {}) => agents.update(id, patch || {}));
  handle('agents:delete', ({ id } = {}) => agents.remove(id));
  handle('agents:start', (payload) => {
    const run = agents.startRun(payload);
    return agents.getRun(run.id);
  });
  handle('agents:cancel', ({ runId } = {}) => agents.cancel(runId));
  handle('agents:ack', ({ runId } = {}) => agents.acknowledge(runId));
  handle('agents:instruct', ({ runId, message } = {}) => agents.instruct(runId, message));
  handle('agents:run', ({ runId } = {}) => agents.getRun(runId));
  handle('agents:log', ({ runId } = {}) => agents.getLog(runId));

  handle('chat:send', ({ text } = {}) => secretary.send(text));
  handle('chat:clear', () => {
    secretary.clear();
    return true;
  });

  handle('inbox:list', () => store.data.inbox.slice(0, 200));
  handle('inbox:read', ({ id } = {}) => {
    notify.markRead(id);
    return true;
  });
  handle('inbox:read-all', () => notify.markAllRead());
  handle('inbox:clear-read', () => {
    notify.clearRead();
    return true;
  });

  handle('supervisor:run', async () => {
    const item = await supervisor.reviewRuns({ trigger: 'manual', force: true });
    if (!item) throw new Error('现在没有进行中的智能体任务');
    return item;
  });
  handle('briefing:run', async () => {
    const item = await supervisor.briefing({ force: true });
    return item;
  });
  handle('review:run', async () => {
    const item = await supervisor.review({ force: true });
    return item;
  });

  handle('agentApi:restart', async () => {
    const result = await server.restart();
    broadcast('server');
    return result;
  });
  handle('agentApi:rotate', () => {
    const token = server.rotateToken();
    broadcast('server');
    return { token, ...server.info() };
  });
  handle('agentApi:info', () => server.info());

  handle('app:copy', ({ text } = {}) => {
    clipboard.writeText(String(text ?? '').slice(0, 20000));
    return true;
  });

  handle('app:open-external', ({ url } = {}) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) throw new Error('只支持打开 http/https 链接');
    shell.openExternal(u);
    return true;
  });

  handle('app:open-data', () => {
    shell.openPath(dataDir);
    return dataDir;
  });

  handle('app:export', async () => {
    const win = getMainWindow();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await dialog.showSaveDialog(win, {
      title: '导出 Dog 秘书数据',
      defaultPath: path.join(app.getPath('documents'), `dog-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    store.flush();
    fs.copyFileSync(store.file, result.filePath);
    return { canceled: false, path: result.filePath };
  });

  handle('app:reset', async () => {
    store.backupNow();
    store.reset();
    await server.restart();
    onSettingsChanged?.({}, store.data.settings);
    broadcast('reset');
    return view();
  });

  handle('app:set-login', ({ enabled } = {}) => {
    if (!app.isPackaged) return { packaged: false, enabled: false };
    setLoginAtStartup(Boolean(enabled));
    store.mutate((s) => (s.settings.launchAtLogin = Boolean(enabled)));
    broadcast('settings');
    return { packaged: true, enabled: getLoginAtStartup() };
  });

  handle('app:mute', ({ minutes } = {}) => {
    const until = scheduler.mute(Math.min(1440, Math.max(5, Number(minutes) || 60)));
    broadcast('settings');
    return until;
  });
  handle('app:unmute', () => {
    scheduler.unmute();
    broadcast('settings');
    return true;
  });

  handle('app:quit', () => {
    app.quit();
    return true;
  });

  handle('window:minimize', () => {
    getMainWindow()?.minimize();
    return true;
  });
  handle('window:hide', () => {
    getMainWindow()?.hide();
    return true;
  });
  handle('window:close', () => {
    getMainWindow()?.close();
    return true;
  });
  handle('window:show', () => {
    showMainWindow();
    return true;
  });
  handle('toast:test', ({ kind, title, body } = {}) => {
    return notify.notify({
      kind: kind || 'system',
      title: title || 'Dog 秘书 · 通知预览',
      body: body || '这就是桌面悬浮通知的样子。点一下可以打开收件箱。',
      short: body || '这就是桌面悬浮通知的样子。',
      force: true,
      preview: true,
    });
  });

  // 供通知窗口使用的通道（非 invoke）
  ipcMain.on('toast:event', (event, channel, payload) => {
    notifyToastEvent?.(event.sender.id, channel, payload);
  });

  function showMainWindow() {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function normalizeSettings(settings) {
  const n = settings.notify;
  n.durationSec = Math.min(30, Math.max(4, Number(n.durationSec) || 9));
  n.quietHours.start = n.quietHours.start || '22:30';
  n.quietHours.end = n.quietHours.end || '07:30';
  const sch = settings.schedule;
  sch.supervision.intervalMinutes = Math.min(240, Math.max(10, Number(sch.supervision.intervalMinutes) || 60));
  sch.reminderLeadMinutes = Math.min(1440, Math.max(0, Number(sch.reminderLeadMinutes) || 0));
  settings.agentApi.port = Math.min(65535, Math.max(1024, Number(settings.agentApi.port) || 47821));
  settings.agentApi.enabled = Boolean(settings.agentApi.enabled);
  settings.launchAtLogin = Boolean(settings.launchAtLogin);
  settings.closeToTray = settings.closeToTray !== false;
  if (!['dark', 'light'].includes(settings.theme)) settings.theme = 'dark';
  return settings;
}

function getLoginAtStartup() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function setLoginAtStartup(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (err) {
    console.warn('[app] 设置开机自启失败', err.message);
  }
}

module.exports = { registerIpc };
