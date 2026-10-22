'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { TaskService } = require('../src/main/tasks');
const { AgentService } = require('../src/main/agents');
const { ToolRunner } = require('../src/main/tools');
const { LLM } = require('../src/main/llm');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-tools-'));
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
  const notes = [];
  const tools = new ToolRunner({
    store,
    tasks,
    agents,
    notify: (opts) => {
      notes.push(opts);
      return { id: 'n1', ...opts };
    },
  });
  return { dir, store, tasks, agents, tools, notes };
}

test('工具：创建事项与今日概览', async (t) => {
  const { dir, store, agents, tools } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const created = await tools.execute('create_task', { title: '交周报', dueAt: '明天下午3点', priority: 2 });
  assert.equal(created.ok, true);
  assert.equal(created.data.title, '交周报');
  assert.equal(new Date(created.data.dueAt).getHours(), 15);

  const overview = await tools.execute('today_overview', {});
  assert.equal(overview.ok, true);
  const list = await tools.execute('list_tasks', { scope: 'active' });
  assert.ok(list.data.some((x) => x.title === '交周报'));
});

test('工具：ISO 时间不会被当成本地时间重复转换', async (t) => {
  const { dir, store, agents, tools } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const iso = '2026-11-01T03:00:00.000Z';
  const created = await tools.execute('create_task', { title: '跨时区', dueAt: iso });
  assert.equal(created.data.dueAt, Date.parse(iso));
});

test('工具：派活与搜索', async (t) => {
  const { dir, store, agents, tools } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const agent = agents.create({ name: '研究助理', kind: 'internal' });
  const run = await tools.execute('start_agent_run', { agentId: agent.id, prompt: '查点资料' });
  assert.equal(run.ok, true);
  const found = await tools.execute('search_everything', { query: '研究' });
  assert.equal(found.data.agents.length, 1);
  assert.ok(found.data.agents[0].name.includes('研究'));
});

test('工具：已完成、未安排和删除', async (t) => {
  const { dir, store, tasks, agents, tools } = setup();
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const done = tasks.create({ title: '给妈妈打个电话', dueAt: Date.now() - 3600000 });
  tasks.complete(done.id);
  tasks.create({ title: '买牛奶' });

  const overview = await tools.execute('today_overview', {});
  assert.equal(overview.ok, true);
  assert.ok(overview.data.completedToday.some((x) => x.title === '给妈妈打个电话'));
  assert.ok(overview.data.undated.some((x) => x.title === '买牛奶'));

  const found = await tools.execute('search_everything', { query: '给妈妈打电话' });
  assert.equal(found.data.tasks.length, 1);
  assert.equal(found.data.tasks[0].id, done.id);

  const deleted = await tools.execute('delete_task', { query: '给妈妈打电话' });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.data.id, done.id);
  assert.equal(tasks.get(done.id), null);

  const now = await tools.execute('get_now', {});
  assert.equal(now.ok, true);
  assert.match(now.data.date, /^\d{4}-\d{2}-\d{2}$/);
});
