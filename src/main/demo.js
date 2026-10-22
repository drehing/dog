'use strict';

const { uid, nowIso } = require('./util');
const { makeRun } = require('./state');

function seedDemo({ store, agents }) {
  if (store.data.meta.demoSeeded) return;
  const now = new Date();
  const at = (h, m, dayOffset = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const mk = (title, dueAt, priority, tags = []) => ({
    id: uid('task'),
    title,
    notes: '',
    status: 'todo',
    priority,
    dueAt,
    remindAt: dueAt,
    remindedAt: null,
    tags,
    source: 'demo',
    agentId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  });
  const tasks = [
    mk('把本周工作整理成一页周报', at(17, 30), 2, ['工作']),
    mk('给妈妈打个电话', at(19, 30), 1, ['生活']),
    mk('预约下周三的牙医', at(10, 0, 1), 1, ['健康']),
  ];
  const doneTask = mk('回复客户邮件', at(10, 15), 1, ['工作']);
  doneTask.status = 'done';
  doneTask.completedAt = new Date(now.getTime() - 2 * 3600000).toISOString();
  tasks.push(doneTask);

  const research = agents.create({
    name: '研究助理',
    kind: 'internal',
    description: '查资料、做调研，把结论整理成一页纸。',
    systemPrompt:
      '你是一名严谨的研究助理。用户给你一个题目，你负责收集要点、对比信息、给出结论和下一步建议。中文输出，结构清楚。',
    checkInMinutes: 30,
    color: 'green',
  });
  const writer = agents.create({
    name: '写作助理',
    kind: 'internal',
    description: '把素材写成通顺的稿子，也能帮你润色。',
    systemPrompt: '你是一名中文写作助理，文风干净、具体，不堆砌形容词。按用户要求交付成稿。',
    checkInMinutes: 30,
    color: 'violet',
  });

  const run = makeRun({
    agentId: research.id,
    agentName: research.name,
    title: '整理 AI 秘书竞品的三条差异',
    prompt: '看看市面上 AI 秘书类产品的差异，给我三条对我们有用的结论。',
    checkInMinutes: 30,
  });
  run.status = 'done';
  run.progress = 100;
  run.startedAt = now.getTime() - 3 * 3600000;
  run.updatedAt = now.getTime() - 2 * 3600000;
  run.endedAt = now.getTime() - 2 * 3600000;
  run.lastReportAt = run.endedAt;
  run.summary =
    '结论：1）竞品大多强调“记”，但很少替用户盯结果；2）桌面通知比 App 内消息更容易被看见；3）智能体监工需要“异常才打扰”，否则会被静音。建议先把提醒与监工汇总做成默认能力。';
  const reports = [
    { id: uid('rep'), runId: run.id, at: run.startedAt + 60000, status: 'running', progress: 20, message: '开始拆解题目，先看三类竞品', level: 'info', source: 'system' },
    { id: uid('rep'), runId: run.id, at: run.startedAt + 45 * 60000, status: 'running', progress: 65, message: '已整理 5 个产品的通知与监工方式', level: 'info', source: 'agent' },
    { id: uid('rep'), runId: run.id, at: run.endedAt, status: 'done', progress: 100, message: '任务完成', level: 'success', source: 'system' },
  ];
  const inbox = [
    {
      id: uid('msg'),
      at: now.getTime() - 2 * 3600000,
      kind: 'completion',
      title: '研究助理 完成了',
      body: '整理 AI 秘书竞品的三条差异\n结论：竞品大多强调“记”，但很少替用户盯结果；桌面通知比 App 内消息更容易被看见。',
      short: '整理 AI 秘书竞品 · 3 条结论已出',
      read: false,
      meta: { runId: run.id, agentId: research.id },
      dedupeKey: 'demo-completion',
    },
  ];

  store.mutate((s) => {
    s.tasks.unshift(...tasks);
    s.runs.unshift(run);
    s.reports.push(...reports);
    s.inbox.unshift(...inbox);
    s.chat.push({
      id: uid('msg'),
      role: 'assistant',
      content:
        '早上好，我是阿犬。今天先替你盯着三件事：周报、给妈妈打电话、预约牙医。\n研究助理刚交了一份竞品小结，我放在收件箱了。\n你可以直接对我说“提醒我下午三点喝水”，或者问“今天怎么安排”。',
      at: now.getTime() - 30 * 60000,
      trace: [],
    });
    s.meta.demoSeeded = true;
  });
}

module.exports = { seedDemo };
