'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'app:bootstrap',
  'app:update-settings',
  'app:onboarding',
  'app:copy',
  'app:open-external',
  'app:open-data',
  'app:export',
  'app:reset',
  'app:set-login',
  'app:mute',
  'app:unmute',
  'app:quit',
  'window:minimize',
  'window:hide',
  'window:close',
  'window:show',
  'toast:test',
  'providers:save',
  'providers:delete',
  'providers:activate',
  'providers:test',
  'tasks:list',
  'tasks:create',
  'tasks:update',
  'tasks:complete',
  'tasks:reopen',
  'tasks:delete',
  'tasks:quick-add',
  'notes:add',
  'notes:list',
  'agents:list',
  'agents:create',
  'agents:update',
  'agents:delete',
  'agents:start',
  'agents:cancel',
  'agents:ack',
  'agents:instruct',
  'agents:run',
  'agents:log',
  'chat:send',
  'chat:clear',
  'inbox:list',
  'inbox:read',
  'inbox:read-all',
  'inbox:clear-read',
  'supervisor:run',
  'briefing:run',
  'review:run',
  'agentApi:restart',
  'agentApi:rotate',
  'agentApi:info',
]);

contextBridge.exposeInMainWorld('dog', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  async call(channel, payload) {
    if (!CHANNELS.has(channel)) throw new Error('不允许的通道：' + channel);
    const res = await ipcRenderer.invoke(channel, payload);
    if (!res?.ok) {
      const err = new Error(res?.error || '操作失败');
      err.channel = channel;
      throw err;
    }
    return res.data;
  },
  onState(cb) {
    ipcRenderer.on('app:state', (_e, payload) => cb(payload));
  },
  onNavigate(cb) {
    ipcRenderer.on('app:navigate', (_e, payload) => cb(payload));
  },
  onFocusQuick(cb) {
    ipcRenderer.on('app:focus-quick', () => cb());
  },
  onChatEvent(cb) {
    ipcRenderer.on('chat:event', (_e, payload) => cb(payload));
  },
});
