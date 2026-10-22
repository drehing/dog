'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { TaskService } = require('../src/main/tasks');
const { AgentService } = require('../src/main/agents');
const { AgentApiServer } = require('../src/main/server');

test('本地接口：鉴权、上报与完成', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-server-'));
  const store = new Store({ file: path.join(dir, 'data.json'), backupDir: path.join(dir, 'backups') });
  store.load();
  store.mutate((s) => {
    s.settings.agentApi.port = 48991;
    s.settings.agentApi.enabled = true;
  });
  const tasks = new TaskService({ store });
  const agents = new AgentService({ store, tasks, dataDir: dir, getLLM: () => null, getApiInfo: () => null });
  const server = new AgentApiServer({ store, agents });
  t.after(async () => {
    await server.stop();
    agents.shutdown();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const started = await server.start();
  assert.equal(started.ok, true, started.error);
  const info = server.info();
  assert.ok(info.url);

  const health = await fetch(`${info.url}/health`);
  assert.equal(health.status, 200);

  const agent = agents.create({ name: '外部助理', kind: 'http' });
  const run = agents.startRun({ agentId: agent.id, prompt: '测试上报' });
  await new Promise((r) => setTimeout(r, 60));

  const unauthorized = await fetch(`${info.url}/v1/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: run.id, status: 'running' }),
  });
  assert.equal(unauthorized.status, 401);

  const report = await fetch(`${info.url}/v1/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` },
    body: JSON.stringify({ runId: run.id, status: 'running', progress: 60, message: '做了一半' }),
  });
  assert.equal(report.status, 200);
  assert.equal(agents.data.runs.find((r) => r.id === run.id).progress, 60);

  const done = await fetch(`${info.url}/v1/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` },
    body: JSON.stringify({ runId: run.id, status: 'done', summary: '全部完成' }),
  });
  assert.equal(done.status, 200);
  const final = agents.data.runs.find((r) => r.id === run.id);
  assert.equal(final.status, 'done');
  assert.equal(final.summary, '全部完成');
});
