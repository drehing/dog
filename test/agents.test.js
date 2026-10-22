'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { TaskService } = require('../src/main/tasks');
const { AgentService } = require('../src/main/agents');
const { LLM } = require('../src/main/llm');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-agents-'));
  const store = new Store({ file: path.join(dir, 'data.json'), backupDir: path.join(dir, 'backups') });
  store.load();
  const tasks = new TaskService({ store });
  const agents = new AgentService({
    store,
    tasks,
    dataDir: dir,
    getLLM: () => new LLM({ provider: { kind: 'mock', model: 'dog-demo' }, apiKey: '' }),
    getApiInfo: () => null,
  });
  return { dir, store, tasks, agents };
}

function waitEvent(emitter, name, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待事件超时：' + name)), ms);
    emitter.once(name, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test('智能体：内部助理执行并完成', async (t) => {
  const { dir, store, agents } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const agent = agents.create({ name: '研究助理', kind: 'internal', systemPrompt: '测试' });
  const done = waitEvent(agents, 'run:done');
  const run = agents.startRun({ agentId: agent.id, prompt: '整理一份资料', title: '测试任务' });
  const evt = await done;
  assert.equal(evt.run.id, run.id);
  assert.equal(evt.run.status, 'done');
  assert.match(evt.run.summary, /演示成果/);
  assert.equal(agents.list()[0].currentRun, null);
  assert.equal(agents.getRun(run.id).reports.length >= 2, true);
});

test('智能体：命令行 Agent 能上报并完成', async (t) => {
  const { dir, store, agents } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const script = path.join(__dirname, '..', 'scripts', 'demo-agent.mjs');
  const agent = agents.create({
    name: '演示 CLI',
    kind: 'cli',
    command: process.execPath,
    argsTemplate: `"${script}" {prompt}`,
    promptVia: 'arg',
  });
  const done = waitEvent(agents, 'run:done', 8000);
  const run = agents.startRun({ agentId: agent.id, prompt: '跑通 CLI 链路', title: 'CLI 测试' });
  const evt = await done;
  assert.equal(evt.run.id, run.id);
  assert.equal(evt.run.status, 'done');
  assert.match(evt.run.summary, /CLI 接管链路正常/);
  const reports = agents.getRun(run.id).reports;
  assert.ok(reports.some((r) => r.message.includes('资料整理')));
  assert.ok(agents.getLog(run.id).includes('收到任务'));
});

test('智能体：上报需要确认会触发提醒，完成后收尾', async (t) => {
  const { dir, store, agents } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const agent = agents.create({ name: '外部助理', kind: 'http', description: '测试' });
  const run = agents.startRun({ agentId: agent.id, prompt: '等我的指令' });
  await new Promise((r) => setTimeout(r, 80));
  const attention = waitEvent(agents, 'run:attention');
  agents.report(run.id, { status: 'waiting', message: '等你确认口吻', needsAttention: true });
  const attn = await attention;
  assert.equal(attn.run.needsAttention, true);

  const done = waitEvent(agents, 'run:done');
  agents.report(run.id, { status: 'done', progress: 100, summary: '写好了' });
  const fin = await done;
  assert.equal(fin.run.status, 'done');
  assert.ok(fin.run.endedAt);
  assert.equal(agents.getRun(run.id).summary, '写好了');
});
