'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { TaskService } = require('../src/main/tasks');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-tasks-'));
  const store = new Store({ file: path.join(dir, 'data.json'), backupDir: path.join(dir, 'backups') });
  store.load();
  return { dir, store, tasks: new TaskService({ store }) };
}

test('事项：创建、提醒与完成', (t) => {
  const { dir, store, tasks } = setup();
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const due = Date.now() + 3600000;
  const task = tasks.create({ title: '写周报', dueAt: due, priority: 2, remind: true });
  assert.equal(task.title, '写周报');
  assert.equal(task.dueAt, due);
  assert.equal(task.remindAt, due);
  assert.equal(tasks.stats().activeCount, 1);

  tasks.complete(task.id);
  assert.equal(tasks.get(task.id).status, 'done');
  assert.ok(tasks.get(task.id).completedAt);
  assert.equal(tasks.stats().doneTodayCount, 1);
  assert.equal(tasks.list({ scope: 'active' }).length, 0);
  assert.equal(tasks.list({ scope: 'done' }).length, 1);
});

test('事项：自然语言快速添加', (t) => {
  const { dir, store, tasks } = setup();
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const task = tasks.quickAdd('提醒我明天下午3点交周报');
  assert.equal(task.title, '交周报');
  const d = new Date(task.dueAt);
  assert.equal(d.getHours(), 15);
  assert.ok(task.remindAt);
  assert.equal(task.source, 'quick');
});

test('事项：到点提醒只取一次', (t) => {
  const { dir, store, tasks } = setup();
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const task = tasks.create({ title: '吃药', dueAt: Date.now() - 60000, remindAt: Date.now() - 60000 });
  const due = tasks.dueReminders(Date.now());
  assert.equal(due.length, 1);
  tasks.markReminded(task.id);
  assert.equal(tasks.dueReminders(Date.now()).length, 0);
});

test('事项：更新截止时间会重置提醒状态', (t) => {
  const { dir, store, tasks } = setup();
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const task = tasks.create({ title: '开会', dueAt: Date.now() + 3600000 });
  const firstRemind = tasks.get(task.id).remindAt;
  tasks.markReminded(task.id);
  assert.ok(tasks.get(task.id).remindedAt);
  tasks.update(task.id, { dueAt: Date.now() + 7200000 });
  assert.equal(tasks.get(task.id).remindedAt, null);
  assert.notEqual(tasks.get(task.id).remindAt, firstRemind);
});
