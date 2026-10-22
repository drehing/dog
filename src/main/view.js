'use strict';

const { PROVIDER_PRESETS } = require('./llm');
const { publicProvider } = require('./providers');

function buildView({ store, agents, scheduler, server, appVersion, isPackaged, dataDir, dataDirSource = 'appdata', encryptionAvailable, loginAtStartup }) {
  const s = store.data;
  const settings = s.settings;
  const active = settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0];
  const activeTasks = s.tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  const doneTasks = s.tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
    .slice(0, 100);
  const tasks = [...activeTasks, ...doneTasks];
  const runs = s.runs
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 80)
    .map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentName: r.agentName,
      title: r.title,
      status: r.status,
      progress: r.progress,
      needsAttention: r.needsAttention,
      attentionReason: r.attentionReason,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      summary: r.summary ? String(r.summary).slice(0, 1000) : '',
    }));
  return {
    version: 1,
    settings: {
      ...settings,
      providers: settings.providers.map(publicProvider),
    },
    tasks,
    agents: agents.list(),
    runs,
    inbox: s.inbox.slice(0, 200),
    chat: s.chat.slice(-120),
    meta: {
      onboarded: Boolean(s.meta.onboarded),
      mutedUntil: s.meta.mutedUntil || null,
      lastBriefingDate: s.meta.lastBriefingDate || null,
      lastReviewDate: s.meta.lastReviewDate || null,
      lastSupervisionAt: s.meta.lastSupervisionAt || null,
      createdAt: s.createdAt,
    },
    overview: {
      stats: scheduler ? tasksStats(s) : null,
      agentsActive: agents.activeRuns().length,
      unread: s.inbox.filter((i) => !i.read).length,
    },
    runtime: {
      appVersion,
      isPackaged,
      dataDir,
      dataDirSource,
      dataDirFallback: dataDirSource !== 'appdata' && dataDirSource !== 'explicit',
      platform: process.platform,
      encryptionAvailable,
      isMock: !active || active.kind === 'mock',
      providerName: active?.name || '',
      modelName: active?.model || '',
      presets: PROVIDER_PRESETS,
      hotkey: settings.hotkey,
      loginAtStartup: Boolean(loginAtStartup),
      scheduler: scheduler ? scheduler.status() : null,
      agentApi: server ? server.info() : null,
    },
  };
}

function tasksStats(s) {
  const now = Date.now();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const active = s.tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  const today = active.filter((t) => t.dueAt && t.dueAt >= start.getTime() && t.dueAt <= end.getTime());
  const overdue = active.filter((t) => t.dueAt && t.dueAt < now);
  const doneToday = s.tasks.filter(
    (t) => t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= start.getTime() && Date.parse(t.completedAt) <= end.getTime()
  );
  return {
    activeCount: active.length,
    todayCount: today.length,
    overdueCount: overdue.length,
    doneTodayCount: doneToday.length,
  };
}

module.exports = { buildView, tasksStats };
