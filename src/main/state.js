'use strict';

const { uid, nowIso } = require('./util');

const MOCK_ID = 'mock';

function mockProvider() {
  return {
    id: MOCK_ID,
    name: '演示模式',
    kind: 'mock',
    baseUrl: '',
    model: 'dog-demo',
    apiKeyCipher: '',
    temperature: 0.4,
    maxTokens: 1200,
    builtin: true,
    createdAt: nowIso(),
  };
}

function defaultSettings() {
  return {
    userName: '',
    assistantName: '阿犬',
    persona:
      '你是用户的私人秘书，干练、可靠、有温度。说话简短直接，先给结论再给细节；主动替用户盯着待办与智能体进度，不邀功，不啰嗦。',
    providers: [mockProvider()],
    activeProviderId: MOCK_ID,
    notify: {
      floating: true,
      native: false,
      sound: false,
      durationSec: 9,
      quietHours: { enabled: false, start: '22:30', end: '07:30' },
      showPreview: true,
    },
    schedule: {
      briefing: { enabled: true, time: '08:30' },
      review: { enabled: true, time: '21:30' },
      supervision: { enabled: true, intervalMinutes: 60 },
      reminderLeadMinutes: 0,
    },
    supervisor: {
      autoNotify: true,
      onlyWhenAttention: false,
      staleMinutes: 45,
    },
    agentApi: {
      enabled: true,
      port: 47821,
      token: '',
    },
    launchAtLogin: false,
    closeToTray: true,
    theme: 'dark',
    hotkey: 'Control+Alt+D',
  };
}

function defaultState() {
  return {
    version: 1,
    createdAt: nowIso(),
    settings: defaultSettings(),
    tasks: [],
    notes: [],
    agents: [],
    runs: [],
    reports: [],
    inbox: [],
    chat: [],
    meta: {
      onboarded: false,
      lastBriefingDate: null,
      lastReviewDate: null,
      lastSupervisionAt: null,
      lastBackupDate: null,
      mutedUntil: null,
    },
  };
}

function makeTask(input = {}) {
  const now = nowIso();
  return {
    id: uid('task'),
    title: String(input.title || '未命名事项').trim().slice(0, 200),
    notes: String(input.notes || '').slice(0, 4000),
    status: 'todo',
    priority: Number.isInteger(input.priority) ? input.priority : 1,
    dueAt: Number.isFinite(input.dueAt) ? input.dueAt : null,
    remindAt: Number.isFinite(input.remindAt) ? input.remindAt : null,
    remindedAt: null,
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 6) : [],
    source: input.source || 'manual',
    agentId: input.agentId || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function makeAgent(input = {}) {
  const now = nowIso();
  return {
    id: uid('agent'),
    name: String(input.name || '新智能体').trim().slice(0, 60),
    kind: ['internal', 'cli', 'http'].includes(input.kind) ? input.kind : 'internal',
    description: String(input.description || '').slice(0, 500),
    color: input.color || 'amber',
    // internal
    systemPrompt: String(input.systemPrompt || '你是一名可靠的执行助理，独立完成任务并给出清晰成果。').slice(0, 4000),
    // cli
    command: String(input.command || '').slice(0, 500),
    argsTemplate: String(input.argsTemplate || '{prompt}').slice(0, 1000),
    cwd: String(input.cwd || '').slice(0, 500),
    promptVia: ['arg', 'stdin', 'env'].includes(input.promptVia) ? input.promptVia : 'arg',
    // http
    dispatchUrl: String(input.dispatchUrl || '').slice(0, 500),
    // shared
    checkInMinutes: Number(input.checkInMinutes) || 30,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRun(input = {}) {
  const now = nowIso();
  const nowMs = Date.now();
  return {
    id: uid('run'),
    agentId: input.agentId || null,
    agentName: input.agentName || '',
    taskId: input.taskId || null,
    title: String(input.title || '未命名任务').slice(0, 200),
    prompt: String(input.prompt || '').slice(0, 8000),
    status: 'queued',
    progress: 0,
    summary: '',
    needsAttention: false,
    attentionReason: '',
    startedAt: nowMs,
    updatedAt: nowMs,
    endedAt: null,
    lastReportAt: nowMs,
    pid: null,
    exitCode: null,
    logFile: '',
    notifiedStatus: '',
    checkInMinutes: Number(input.checkInMinutes) || 30,
  };
}

module.exports = {
  MOCK_ID,
  mockProvider,
  defaultSettings,
  defaultState,
  makeTask,
  makeAgent,
  makeRun,
};
