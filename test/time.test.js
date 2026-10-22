'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWhen } = require('../src/main/time');

const NOW = new Date(2026, 9, 22, 10, 0, 0); // 2026-10-22 周四 10:00

function at(text) {
  const r = parseWhen(text, NOW);
  assert.ok(r.at, `未能解析：${text}`);
  return new Date(r.at);
}

test('中文时间：明天下午', () => {
  const r = parseWhen('明天下午3点开会', NOW);
  assert.equal(r.title, '开会');
  const d = new Date(r.at);
  assert.equal(d.getDate(), 23);
  assert.equal(d.getHours(), 15);
  assert.equal(d.getMinutes(), 0);
});

test('中文时间：本周与下周', () => {
  let d = at('周五交周报');
  assert.equal(d.getDate(), 23);
  d = at('下周一交材料');
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 26);
  d = at('下周五复盘');
  assert.equal(d.getDate(), 30);
  d = at('下下周一');
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 2);
});

test('中文时间：相对与今晚', () => {
  let d = at('半小时后喝水');
  assert.equal(d.getHours(), 10);
  assert.equal(d.getMinutes(), 30);
  d = at('3天后交报告');
  assert.equal(d.getDate(), 25);
  d = at('今晚8点开会');
  assert.equal(d.getHours(), 20);
  assert.equal(parseWhen('今晚8点开会', NOW).title, '开会');
});

test('中文时间：秒级提醒', () => {
  const r = parseWhen('10秒后提醒我喝水', NOW);
  assert.equal(r.title, '喝水');
  assert.equal(r.at, NOW.getTime() + 10000);
  const r2 = parseWhen('3s后提醒我干活', NOW);
  assert.equal(r2.title, '干活');
  assert.equal(r2.at, NOW.getTime() + 3000);
});

test('中文时间：无日期时未来才排今天', () => {
  assert.equal(at('9点开会').getDate(), 23);
  const d = at('下午2点开会');
  assert.equal(d.getDate(), 22);
  assert.equal(d.getHours(), 14);
});

test('中文时间：显式日期', () => {
  const d = at('10月25日晚上8点看电影');
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 25);
  assert.equal(d.getHours(), 20);
});

test('中文时间：无法解析时不硬猜', () => {
  const r = parseWhen('买牛奶', NOW);
  assert.equal(r.at, null);
  assert.equal(r.title, '买牛奶');
});
