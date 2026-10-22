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
const { SecretaryService } = require('../src/main/secretary');
const { LLM } = require('../src/main/llm');

test('秘书：一句话记事项并落库', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-secretary-'));
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
  const tools = new ToolRunner({ store, tasks, agents, notify: () => ({ id: 'n' }) });
  const secretary = new SecretaryService({
    store,
    tasks,
    agents,
    tools,
    getLLM: () => new LLM({ provider: { kind: 'mock', model: 'dog-demo' }, apiKey: '' }),
  });
  t.after(() => {
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const res = await secretary.send('提醒我明天下午3点喝水');
  assert.match(res.message.content, /记下了/);
  assert.ok(res.trace.some((x) => x.name === 'create_task' && x.ok));
  const task = store.data.tasks.find((x) => x.title === '喝水');
  assert.ok(task);
  assert.equal(new Date(task.dueAt).getHours(), 15);
  assert.equal(store.data.chat.filter((m) => m.role === 'user').length, 1);
  assert.equal(store.data.chat.filter((m) => m.role === 'assistant').length, 1);

  const overview = await secretary.send('今天怎么安排？');
  assert.match(overview.message.content, /喝水|今天/);
  assert.ok(overview.trace.some((x) => x.name === 'today_overview'));

  const dateAnswer = await secretary.send('今天是星期几？');
  assert.match(dateAnswer.message.content, /星期[日一二三四五六]/);
  assert.equal(dateAnswer.trace.length, 0);

  const doneTask = tasks.create({ title: '给妈妈打个电话', dueAt: Date.now() - 3600000 });
  tasks.complete(doneTask.id);
  const del = await secretary.send('把给妈妈打电话 删了吧');
  assert.match(del.message.content, /已删除/);
  assert.equal(tasks.get(doneTask.id), null);
  assert.equal(del.trace[0].name, 'delete_task');
});
