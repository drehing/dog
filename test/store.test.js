'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');

test('存储：落盘与重新加载', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-store-'));
  const file = path.join(dir, 'data.json');
  const s1 = new Store({ file, backupDir: path.join(dir, 'backups') });
  s1.load();
  s1.mutate((s) => {
    s.settings.userName = '测试';
    s.tasks.push({ id: 't1', title: '测试事项', status: 'todo', createdAt: new Date().toISOString() });
  });
  s1.close();
  assert.ok(fs.existsSync(file));

  const s2 = new Store({ file, backupDir: path.join(dir, 'backups') });
  s2.load();
  assert.equal(s2.data.settings.userName, '测试');
  assert.equal(s2.data.tasks.length, 1);
  assert.equal(s2.data.settings.providers.length >= 1, true);
  s2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('存储：损坏文件会保留备份并重建', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dog-store-bad-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, '{bad json', 'utf8');
  const store = new Store({ file, backupDir: path.join(dir, 'backups') });
  store.load();
  assert.equal(store.data.meta.onboarded, false);
  const corrupt = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupt.length, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
