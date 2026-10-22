'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LLM, LLMError } = require('../src/main/llm');

function startServer() {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        requests.push({ url: req.url, headers: req.headers, body: json });
        if (req.url.includes('/bad/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid key' } }));
          return;
        }
        if (req.url.includes('/v1/messages')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'text', text: '我查一下' },
                { type: 'tool_use', id: 'toolu_1', name: 'today_overview', input: {} },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl_1',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'today_overview', arguments: '{}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            model: 'test-model',
          })
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

test('模型接口：OpenAI 兼容的工具调用', async (t) => {
  const { server, port, requests } = await startServer();
  t.after(() => server.close());
  const llm = new LLM({
    provider: { kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', temperature: 0.2, maxTokens: 128 },
    apiKey: 'sk-test',
  });
  const res = await llm.chat({
    system: '你是秘书',
    messages: [{ role: 'user', content: '今天怎么安排' }],
    tools: [{ name: 'today_overview', description: '概览', parameters: { type: 'object', properties: {} } }],
  });
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'today_overview');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].headers.authorization, 'Bearer sk-test');
  assert.equal(requests[0].body.messages[0].role, 'system');
  assert.equal(requests[0].body.tools[0].function.name, 'today_overview');
});

test('模型接口：Anthropic Messages 与 tool_use', async (t) => {
  const { server, port, requests } = await startServer();
  t.after(() => server.close());
  const llm = new LLM({
    provider: { kind: 'anthropic', baseUrl: `http://127.0.0.1:${port}`, model: 'claude-test', maxTokens: 256 },
    apiKey: 'ak-test',
  });
  const res = await llm.chat({
    system: '你是秘书',
    messages: [{ role: 'user', content: '今天怎么安排' }],
    tools: [{ name: 'today_overview', description: '概览', parameters: { type: 'object', properties: {} } }],
  });
  assert.equal(res.text, '我查一下');
  assert.equal(res.toolCalls[0].name, 'today_overview');
  assert.equal(requests[0].url, '/v1/messages');
  assert.equal(requests[0].headers['x-api-key'], 'ak-test');
  assert.equal(requests[0].body.system, '你是秘书');
  assert.equal(requests[0].body.tools[0].input_schema.type, 'object');
});

test('模型接口：鉴权失败给出人话错误', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const llm = new LLM({
    provider: { kind: 'openai', baseUrl: `http://127.0.0.1:${port}/bad/v1`, model: 'test-model' },
    apiKey: 'wrong',
  });
  await assert.rejects(
    () => llm.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof LLMError && err.code === 'auth' && /Key 无效/.test(err.message)
  );
});
