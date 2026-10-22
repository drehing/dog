'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { TaskService } = require('../src/main/tasks');
const { Scheduler } = require('../src/main/scheduler');
const { localDateKey } = require('../src/main/util');

test('调度器：到点提醒只发一次', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-scheduler-'));
  const store = new Store({ file: path.join(dir, 'data.json'), backupDir: path.join(dir, 'backups') });
  store.load();
  const tasks = new TaskService({ store });
  const sent = [];
  const scheduler = new Scheduler({
    store,
    tasks,
    agents: { activeRuns: () => [] },
    supervisor: {},
    notify: (opts) => sent.push(opts),
  });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  tasks.create({ title: '喝水', dueAt: Date.now() - 60000, remindAt: Date.now() - 60000 });
  scheduler.checkReminders();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'reminder');
  assert.match(sent[0].body, /今天|分钟|到点/);
  scheduler.checkReminders();
  assert.equal(sent.length, 1);
});

test('调度器：早报每天只触发一次', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-scheduler-'));
  const store = new Store({ file: path.join(dir, 'data.json'), backupDir: path.join(dir, 'backups') });
  store.load();
  store.mutate((s) => {
    s.meta.onboarded = true;
    s.settings.schedule.briefing.enabled = true;
    const d = new Date(Date.now() - 60000);
    s.settings.schedule.briefing.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const tasks = new TaskService({ store });
  let calls = 0;
  const supervisor = {
    async briefing() {
      calls++;
      store.mutate((s) => (s.meta.lastBriefingDate = localDateKey()));
    },
  };
  const scheduler = new Scheduler({ store, tasks, agents: { activeRuns: () => [] }, supervisor, notify: () => {} });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await scheduler.checkBriefing();
  await scheduler.checkBriefing();
  assert.equal(calls, 1);
});
