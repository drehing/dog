'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSettings } = require('../src/main/state');
const { SupervisorService } = require('../src/main/supervisor');

function makeCtx(active) {
  const settings = defaultSettings();
  settings.userName = '老板';
  settings.assistantName = '阿犬';
  const data = { settings, meta: {} };
  const store = {
    data,
    mutate(fn) {
      fn(data);
    },
  };
  const tasks = {
    stats: () => ({ activeCount: 0, todayCount: 0, overdueCount: 0, doneTodayCount: 0, next: null }),
    list: () => [],
  };
  const agents = {
    activeRuns: () => active,
    snapshot: () => ({ active, recentDone: [] }),
    promptSummary: () => [],
  };
  const notes = [];
  const notify = (opts) => {
    notes.push(opts);
    return { id: 'n' + notes.length, ...opts };
  };
  const getLLM = () => ({ isMock: true });
  const svc = new SupervisorService({ store, tasks, agents, getLLM, notify });
  return { svc, notes, data };
}

const activeRun = {
  runId: 'r1',
  agent: '研究助理',
  title: '整理竞品',
  status: 'waiting',
  progress: 55,
  needsAttention: true,
  attentionReason: '等待确认口吻',
  lastReportAt: new Date().toISOString(),
  checkInMinutes: 30,
  summary: '',
};

test('监工：生成汇总并标出需要确认的事项', async () => {
  const { svc, notes } = makeCtx([activeRun]);
  const item = await svc.reviewRuns({ trigger: 'manual', force: true });
  assert.equal(notes.length, 1);
  assert.equal(item.kind, 'supervision');
  assert.match(item.body, /需要你/);
  assert.match(item.body, /等待确认口吻/);
  assert.ok(notes[0].short.includes('需要你'));
});

test('监工：完成通知不再重复 emoji，且包含摘要', async () => {
  const { svc, notes } = makeCtx([]);
  await svc.onRunDone({
    run: { id: 'r2', title: '写稿', status: 'done', summary: '稿子写完了，放在文档里。', agentId: 'a1' },
    agent: { name: '写作助理' },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '写作助理 完成了');
  assert.match(notes[0].body, /稿子写完了/);
});

test('监工：注意力通知去重键存在', () => {
  const { svc, notes } = makeCtx([]);
  svc.onRunAttention({
    run: { id: 'r3', title: '等你', needsAttention: true, attentionReason: '需要授权', agentId: 'a2' },
    agent: { name: '外部助理' },
  });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].dedupeKey.startsWith('run-attn:r3'));
});
