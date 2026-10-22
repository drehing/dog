'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  shell,
  session,
  Notification,
} = require('electron');

const { Store } = require('./store');
const { TaskService } = require('./tasks');
const { AgentService } = require('./agents');
const { AgentApiServer } = require('./server');
const { NotifyService } = require('./notify');
const { SupervisorService } = require('./supervisor');
const { ToolRunner } = require('./tools');
const { SecretaryService } = require('./secretary');
const { Scheduler } = require('./scheduler');
const { LLM } = require('./llm');
const { decrypt, encryptionAvailable, initSecrets } = require('./secrets');
const { registerIpc } = require('./ipc');
const { buildView } = require('./view');
const { seedDemo } = require('./demo');
const { ensureDir } = require('./util');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const SMOKE = Boolean(process.env.DOG_SMOKE);
const HIDDEN_START = process.argv.includes('--hidden');

let dataDir;
let dataDirSource = 'appdata';
let dataDirFallback = false;
try {
  const candidates = [];
  if (process.env.DOG_DATA_DIR) {
    candidates.push({ dir: path.resolve(process.env.DOG_DATA_DIR), source: 'explicit' });
  }
  candidates.push(
    { dir: path.join(app.getPath('appData'), 'DogSecretary'), source: 'appdata' },
    { dir: path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'DogSecretary'), source: 'localappdata' },
    { dir: path.join(path.dirname(process.execPath), 'DogSecretary-data'), source: 'appdir' },
    { dir: path.join(app.getPath('temp'), 'DogSecretary'), source: 'temp' }
  );

  const seen = new Set();
  for (const candidate of candidates) {
    const dir = path.resolve(candidate.dir);
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      dataDir = dir;
      dataDirSource = candidate.source;
      dataDirFallback = candidate.source !== 'appdata' && candidate.source !== 'explicit';
      break;
    } catch (err) {
      console.warn(`[boot] 数据目录不可写：${dir} (${err.code || err.message})`);
    }
  }
  if (!dataDir) throw new Error('所有候选数据目录都不可写');
  app.setPath('userData', dataDir);
} catch (err) {
  try {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Dog 秘书无法启动',
      `创建数据目录失败：${dataDir || '(未知)'}\n${err.message}\n\n请检查该目录的写入权限，或把 DOG_DATA_DIR 指到一个可写目录。`
    );
  } catch {}
  process.exit(1);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let store = null;
let tasks = null;
let agents = null;
let server = null;
let notify = null;
let supervisor = null;
let tools = null;
let secretary = null;
let scheduler = null;
let quitting = false;
let pendingNav = null;
let broadcastTimer = null;
let trayTimer = null;
let trayHintShown = false;
let lastHotkey = '';
let ready = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 432,
    height: 728,
    minWidth: 392,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#101216',
    title: 'Dog 秘书',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    if (store?.data.settings.closeToTray !== false) {
      e.preventDefault();
      mainWindow.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        const tip = `已收起到后台，继续盯提醒和智能体。按 ${store.data.settings.hotkey || 'Ctrl+Alt+D'} 随时叫我；托盘图标右键可退出。`;
        try {
          if (mainWindow && Notification.isSupported()) {
            const n = new Notification({ title: 'Dog 秘书还在后台', body: tip, silent: true });
            n.show();
          } else if (tray) {
            tray.displayBalloon({ title: 'Dog 秘书还在后台', content: tip });
          }
        } catch {}
      }
    } else {
      quitting = true;
      app.quit();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.once('ready-to-show', () => {
    if (SMOKE || !HIDDEN_START) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    ready = true;
    if (pendingNav) {
      mainWindow.webContents.send('app:navigate', pendingNav);
      pendingNav = null;
    }
    if (SMOKE) runSmoke().catch((err) => finishSmoke({ ok: false, error: err.stack || String(err) }));
  });
}

function initServices() {
  store = new Store({
    file: path.join(dataDir, 'data.json'),
    backupDir: path.join(dataDir, 'backups'),
  });
  store.load();

  // 上次退出时还在跑的任务，启动后标记为中断，避免变成“僵尸监工”
  const interrupted = store.data.runs.filter((r) => ['queued', 'running', 'waiting', 'blocked'].includes(r.status));
  if (interrupted.length) {
    store.mutate((s) => {
      for (const run of s.runs) {
        if (!['queued', 'running', 'waiting', 'blocked'].includes(run.status)) continue;
        run.status = 'failed';
        run.endedAt = Date.now();
        run.updatedAt = Date.now();
        run.needsAttention = false;
        run.summary = run.summary || 'Dog 退出时任务被中断。';
        run.notifiedStatus = 'failed';
      }
    });
  }

  tasks = new TaskService({ store });

  const getLLM = () => {
    const s = store.data.settings;
    const provider = s.providers.find((p) => p.id === s.activeProviderId) || s.providers[0];
    if (!provider) return null;
    return new LLM({
      provider,
      apiKey: decrypt(provider.apiKeyCipher),
      timeoutMs: provider.kind === 'mock' ? 5000 : 90000,
    });
  };

  agents = new AgentService({
    store,
    tasks,
    dataDir,
    getLLM,
    getApiInfo: () => (server ? server.info() : null),
  });

  server = new AgentApiServer({ store, agents });

  notify = new NotifyService({
    store,
    mainWindow,
    toastHtml: path.join(RENDERER, 'toast.html'),
    toastPreload: path.join(ROOT, 'src', 'preload-toast.js'),
    onClick: () => showWindow('inbox'),
  });

  supervisor = new SupervisorService({
    store,
    tasks,
    agents,
    getLLM,
    notify: (opts) => notify.notify(opts),
  });

  tools = new ToolRunner({
    store,
    tasks,
    agents,
    notify: (opts) => notify.notify(opts),
  });

  secretary = new SecretaryService({ store, tasks, agents, tools, getLLM });
  scheduler = new Scheduler({
    store,
    tasks,
    agents,
    supervisor,
    notify: (opts) => notify.notify(opts),
  });

  secretary.on('tool', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat:event', { type: 'tool', ...evt });
  });
  secretary.on('thinking', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat:event', { type: 'thinking', ...evt });
  });

  agents.on('run:done', ({ run, agent }) => {
    supervisor.onRunDone({ run, agent }).catch((err) => console.warn('[supervisor] 完成汇总失败', err.message));
    broadcast('run');
    updateTray();
  });
  agents.on('run:attention', ({ run, agent }) => {
    supervisor.onRunAttention({ run, agent });
    broadcast('run');
    updateTray();
  });

  store.on('changed', () => {
    scheduleBroadcast();
    scheduleTray();
  });

  if ((process.env.DOG_SEED_DEMO || SMOKE) && process.env.DOG_SMOKE_MODE !== 'onboarding') {
    if (!store.data.meta.onboarded) {
      store.mutate((s) => {
        s.meta.onboarded = true;
        s.settings.userName = s.settings.userName || '老板';
      });
    }
    seedDemo({ store, agents });
  }
}

function registerIpcHandlers() {
  registerIpc({
    store,
    tasks,
    agents,
    supervisor,
    secretary,
    scheduler,
    server,
    notify,
    getMainWindow: () => mainWindow,
    broadcast,
    dataDir,
    dataDirSource,
    onSettingsChanged: applySettingsSideEffects,
    notifyToastEvent: (wcId, channel, payload) => notify.handleWindowEvent(wcId, channel, payload),
  });
}

function applySettingsSideEffects(before, after) {
  try {
    if (before.hotkey !== after.hotkey) registerHotkey(after.hotkey);
    if (before.agentApi && (before.agentApi.enabled !== after.agentApi.enabled || Number(before.agentApi.port) !== Number(after.agentApi.port))) {
      server.restart().then(() => broadcast('server')).catch(() => {});
    }
    if (before.launchAtLogin !== after.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: Boolean(after.launchAtLogin), args: ['--hidden'] });
    }
    updateTray();
  } catch (err) {
    console.warn('[settings] 应用设置失败', err.message);
  }
}

function broadcast(reason = 'change') {
  if (!ready || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const view = buildView({
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
    mainWindow.webContents.send('app:state', { reason, state: view });
  } catch (err) {
    console.warn('[broadcast]', err.message);
  }
}

function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast('change');
  }, 120);
}

function scheduleTray() {
  if (trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = null;
    updateTray();
  }, 400);
}

function getLoginAtStartup() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(ASSETS, 'tray.ico'));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  tray = new Tray(img);
  tray.setToolTip('Dog 秘书');
  tray.on('click', () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showWindow();
  });
  updateTray();
}

function updateTray() {
  if (!tray || !store) return;
  const data = store.data;
  const active = data.tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length;
  const unread = data.inbox.filter((i) => !i.read).length;
  const running = agents.activeRuns().length;
  tray.setToolTip(`Dog 秘书 · ${active} 项待办 · ${running} 个智能体在跑${unread ? ` · ${unread} 条未读` : ''}`);
  const muted = data.meta.mutedUntil && data.meta.mutedUntil > Date.now();
  const menu = Menu.buildFromTemplate([
    { label: `🐕 Dog 秘书  ·  ${active} 项待办`, enabled: false },
    {
      label: running ? `👀 ${running} 个智能体在跑` : '👀 暂无智能体任务',
      enabled: false,
    },
    { type: 'separator' },
    { label: '打开控制台', click: () => showWindow() },
    {
      label: '快速记一笔',
      accelerator: 'CmdOrCtrl+Alt+D',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('app:focus-quick');
      },
    },
    { type: 'separator' },
    {
      label: '现在监工一次',
      click: () => {
        supervisor
          .reviewRuns({ trigger: 'tray', force: true })
          .then((item) => {
            if (!item) notify.notify({ kind: 'supervision', title: '暂时没有在跑的任务', body: '等智能体开始干活，我会盯着。', short: '暂时没有在跑的任务' });
          })
          .catch(() => {});
      },
    },
    {
      label: '生成今日简报',
      click: () => supervisor.briefing({ force: true }).catch(() => {}),
    },
    {
      label: muted ? '取消静音' : '静音 1 小时',
      click: () => {
        if (muted) scheduler.unmute();
        else scheduler.mute(60);
        updateTray();
        broadcast('settings');
      },
    },
    { type: 'separator' },
    {
      label: '退出 Dog',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function registerHotkey(hotkey) {
  const next = hotkey || store?.data.settings.hotkey || 'Control+Alt+D';
  if (lastHotkey) {
    try {
      globalShortcut.unregister(lastHotkey);
    } catch {}
  }
  lastHotkey = '';
  try {
    const ok = globalShortcut.register(next, () => {
      if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else {
        showWindow();
        mainWindow?.webContents.send('app:focus-quick');
      }
    });
    if (ok) lastHotkey = next;
    else console.warn('[hotkey] 注册失败', next);
  } catch (err) {
    console.warn('[hotkey] 注册失败', err.message);
  }
}

function showWindow(view) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (view) {
    if (ready) mainWindow.webContents.send('app:navigate', { view });
    else pendingNav = { view };
  }
}

function loadRenderer() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(RENDERER, 'index.html')).catch((err) => {
    console.error('[window] 页面加载失败', err);
  });
}

function setupSession() {
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  } catch {}
}

async function runSmoke() {
  const outDir = process.env.DOG_SMOKE_DIR || path.join(dataDir, 'smoke');
  ensureDir(outDir);
  const errors = [];
  const shots = [];
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') errors.push(details.message);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(900);

  const click = (sel) =>
    mainWindow.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return !!el; })()`
    );

  const capture = async (name) => {
    const img = await mainWindow.webContents.capturePage();
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    shots.push(file);
  };

  if (process.env.DOG_SMOKE_MODE === 'onboarding') {
    await capture('10-onboarding');
    const clicked = await click('[data-action="onboarding:skip"]');
    if (!clicked) errors.push('onboarding skip button not found');
    await sleep(2600);
    await capture('11-after-onboarding');
    finishSmoke({ ok: errors.length === 0, shots, errors });
    return;
  }

  for (const view of ['home', 'tasks', 'agents', 'inbox', 'chat', 'settings']) {
    mainWindow.webContents.send('app:navigate', { view });
    await sleep(450);
    await capture('0-' + view);
  }

  mainWindow.webContents.executeJavaScript("document.querySelector('#view').scrollTop = 760");
  await sleep(350);
  await capture('06-settings-mid');
  mainWindow.webContents.executeJavaScript("document.querySelector('#view').scrollTop = 99999");
  await sleep(350);
  await capture('06-settings-bottom');

  mainWindow.webContents.send('app:navigate', { view: 'tasks' });
  await sleep(300);
  await click('[data-action="task:new"]');
  await sleep(400);
  await capture('09-task-sheet');
  await click('[data-action="modal:close"]');

  mainWindow.webContents.send('app:navigate', { view: 'agents' });
  await sleep(300);
  await click('[data-action="agent:start"]');
  await sleep(400);
  await capture('09-agent-sheet');
  await click('[data-action="modal:close"]');

  mainWindow.webContents.send('app:navigate', { view: 'settings' });
  await sleep(300);
  await click('[data-action="settings:add-provider"]');
  await sleep(400);
  await capture('09-provider-sheet');
  await click('[data-action="modal:close"]');

  let quickAdd = null;
  try {
    mainWindow.webContents.send('app:navigate', { view: 'home' });
    await sleep(300);
    const submitQuick = (text) =>
      mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#quick-input');
        if (!input) return false;
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#quick-form').requestSubmit();
        return true;
      })()`);

    await submitQuick('提醒我明天下午3点喝水');
    await sleep(900);
    quickAdd = store.data.tasks.find((t) => t.title === '喝水') || null;
    if (!quickAdd) errors.push('quick add did not create task');
    else if (new Date(quickAdd.dueAt).getHours() !== 15) errors.push('quick add due hour wrong');

    await submitQuick('买牛奶');
    await sleep(900);
    if (!store.data.tasks.some((t) => t.title === '买牛奶' && !t.dueAt)) errors.push('undated quick add failed');
    const undatedShown = await mainWindow.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.section-title')).some(e => e.textContent.includes('待办'))`
    );
    if (!undatedShown) errors.push('undated section not shown on home');

    await submitQuick('10秒后提醒我站起来');
    await sleep(12000);
    if (!store.data.inbox.some((i) => i.kind === 'reminder' && i.title === '站起来')) errors.push('10s reminder not delivered');

    mainWindow.webContents.send('app:navigate', { view: 'tasks' });
    await sleep(350);
    await click('[data-action="task:filter"][data-filter="done"]');
    await sleep(450);
    const doneCount = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.task').length`);
    if (!doneCount) errors.push('completed filter shows no tasks');
    await capture('12-tasks-done');
  } catch (err) {
    errors.push('quick add: ' + err.message);
  }

  let chatReply = '';
  try {
    mainWindow.webContents.send('app:navigate', { view: 'chat' });
    await sleep(350);
    await mainWindow.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#chat-input');
      if (!input) return false;
      input.value = '今天怎么安排？';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#chat-form').requestSubmit();
      return true;
    })()`);
    await sleep(2200);
    const last = [...store.data.chat].reverse().find((m) => m.role === 'assistant');
    chatReply = last?.content || '';
    await capture('07-chat-after-reply');
  } catch (err) {
    errors.push('chat: ' + err.message);
  }

  try {
    notify.dismissAll();
    await sleep(350);
    notify.notify({
      kind: 'reminder',
      title: '给妈妈打个电话',
      body: '今天 19:30 · 生活',
      short: '今天 19:30 · 生活 · 别忘了',
      force: true,
    });
    await sleep(900);
    const entry = notify.toasts[0];
    if (entry && !entry.win.isDestroyed()) {
      const img = await entry.win.webContents.capturePage();
      const file = path.join(outDir, '08-toast.png');
      fs.writeFileSync(file, img.toPNG());
      shots.push(file);
      entry.win.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 50, button: 'left', clickCount: 1 });
      entry.win.webContents.sendInputEvent({ type: 'mouseUp', x: 120, y: 50, button: 'left', clickCount: 1 });
      await sleep(500);
      if (notify.toasts.length >= 1) errors.push('toast click did not dismiss');
    } else {
      errors.push('toast window not found');
    }
  } catch (err) {
    errors.push('toast: ' + err.message);
  }

  finishSmoke({ ok: errors.length === 0, shots, chatReply, quickAdd, errors });
}

function finishSmoke(result) {
  const outDir = process.env.DOG_SMOKE_DIR || path.join(dataDir, 'smoke');
  ensureDir(outDir);
  try {
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  } catch {}
  console.log('[smoke]', JSON.stringify(result, null, 2));
  quitting = true;
  setTimeout(() => app.quit(), 300);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  await initSecrets();
  app.setAppUserModelId('com.dog.secretary');
  app.setAboutPanelOptions({ applicationName: 'Dog 秘书', applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(null);
  setupSession();
  createWindow();
  initServices();
  registerIpcHandlers();

  const startResult = await server.start();
  if (!startResult.ok && !startResult.disabled) console.warn('[server]', startResult.error);

  createTray();
  registerHotkey(store.data.settings.hotkey);
  scheduler.start();
  updateTray();
  loadRenderer();
});

app.on('second-instance', () => showWindow());

app.on('activate', () => {
  if (mainWindow) showWindow();
});

app.on('window-all-closed', () => {
  // 常驻托盘
});

app.on('before-quit', () => {
  quitting = true;
  try {
    scheduler?.stop();
  } catch {}
  try {
    server?.stop();
  } catch {}
  try {
    agents?.shutdown();
  } catch {}
  try {
    store?.flush();
  } catch {}
  try {
    notify?.close();
  } catch {}
  try {
    globalShortcut.unregisterAll();
  } catch {}
});

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandled]', err);
});
