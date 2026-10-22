'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LLM, testProvider } = require('../src/main/llm');

const provider = { kind: 'mock', model: 'dog-demo', name: '演示' };
const llm = () => new LLM({ provider, apiKey: '' });

test('Mock 模型：会把“今天”转成工具调用', async () => {
  const res = await llm().chat({
    system: 'test',
    messages: [{ role: 'user', content: '今天怎么安排？' }],
    tools: [
      { name: 'today_overview', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'create_task', description: '', parameters: { type: 'object', properties: {} } },
    ],
  });
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'today_overview');
});

test('Mock 模型：工具结果会转成人话', async () => {
  const res = await llm().chat({
    system: 'test',
    messages: [
      { role: 'user', content: '今天怎么安排？' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'today_overview', args: {} }] },
      {
        role: 'tool',
        toolCallId: 'c1',
        name: 'today_overview',
        content: JSON.stringify({
          ok: true,
          data: {
            stats: { todayCount: 2, overdueCount: 0, doneTodayCount: 1 },
            tasks: [{ title: '写周报', dueAt: Date.now() }],
          },
        }),
      },
    ],
    tools: [],
  });
  assert.match(res.text, /今天有 2 件事/);
  assert.match(res.text, /写周报/);
});

test('Mock 模型：日期问题直接回答，不查待办', async () => {
  const res = await llm().chat({
    system: 'test',
    messages: [{ role: 'user', content: '今天是星期几？' }],
    tools: [
      { name: 'today_overview', description: '', parameters: { type: 'object', properties: {} } },
    ],
  });
  assert.equal(res.toolCalls.length, 0);
  assert.match(res.text, /星期[日一二三四五六]/);
});

test('连接测试：演示模式直接成功', async () => {
  const r = await testProvider({ provider, apiKey: '' });
  assert.equal(r.ok, true);
  assert.ok(r.ms >= 0);
});
