'use strict';

const { parseWhen } = require('./time');
const { truncate } = require('./util');

const PROVIDER_PRESETS = [
  {
    key: 'mock',
    name: '演示模式（无需 Key）',
    kind: 'mock',
    baseUrl: '',
    model: 'dog-demo',
    keyUrl: '',
    note: '先体验完整流程',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '性价比高，中文好',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '通用能力强',
  },
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: '长文本与工具调用稳',
  },
  {
    key: 'moonshot',
    name: 'Kimi / Moonshot',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '国内直连',
  },
  {
    key: 'qwen',
    name: '通义千问',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '阿里云百炼',
  },
  {
    key: 'ollama',
    name: 'Ollama（本地）',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    keyUrl: '',
    note: '本地模型，Key 随便填',
  },
  {
    key: 'custom',
    name: '自定义 OpenAI 兼容接口',
    kind: 'openai',
    baseUrl: '',
    model: '',
    keyUrl: '',
    note: '中转站 / 自建服务',
  },
];

class LLMError extends Error {
  constructor(message, { code = 'llm_error', status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function openaiUrl(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new LLMError('还没有填写 Base URL', { code: 'config' });
  if (/\/chat\/completions$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

function anthropicUrl(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new LLMError('还没有填写 Base URL', { code: 'config' });
  if (/\/v1\/messages$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return b + '/messages';
  return b + '/v1/messages';
}

function friendlyHttpError(status, body) {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message || j?.message || j?.error || '';
  } catch {
    detail = String(body || '').slice(0, 200);
  }
  if (status === 401 || status === 403) {
    return new LLMError('API Key 无效或没有权限，请到设置里检查', { code: 'auth', status });
  }
  if (status === 404) {
    return new LLMError('接口地址或模型名不对，请检查 Base URL 与模型名', { code: 'not_found', status });
  }
  if (status === 429) {
    return new LLMError('模型服务限流了，稍等一分钟再试', { code: 'rate_limit', status, retryable: true });
  }
  if (status >= 500) {
    return new LLMError('模型服务暂时不可用，稍后会自动重试', { code: 'server', status, retryable: true });
  }
  return new LLMError(`模型调用失败（HTTP ${status}）${detail ? '：' + truncate(detail, 160) : ''}`, {
    code: 'http',
    status,
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new LLMError('模型响应超时了，请稍后再试', { code: 'timeout', retryable: true });
    }
    throw new LLMError('连不上模型服务，请检查网络或 Base URL', { code: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestJson(url, options, timeoutMs) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      const text = await res.text();
      if (!res.ok) {
        const err = friendlyHttpError(res.status, text);
        if (err.retryable && attempt === 0) {
          lastErr = err;
          await sleep(1200);
          continue;
        }
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new LLMError('模型返回的不是合法 JSON', { code: 'bad_json' });
      }
    } catch (err) {
      if (err instanceof LLMError && err.retryable && attempt === 0) {
        lastErr = err;
        await sleep(1200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new LLMError('模型调用失败');
}

function openaiMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages || []) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: String(m.content || '') });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: String(m.content || '') });
    }
  }
  return out;
}

function anthropicMessages(messages) {
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role && role === 'user') {
      last.content.push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };
  for (const m of messages || []) {
    if (m.role === 'user') {
      push('user', [{ type: 'text', text: String(m.content || '') }]);
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const c of m.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      }
      push('assistant', blocks);
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: String(m.content || '') }]);
    }
  }
  return out;
}

class LLM {
  constructor({ provider, apiKey, timeoutMs = 90000 }) {
    this.provider = provider;
    this.apiKey = apiKey || '';
    this.timeoutMs = timeoutMs;
  }

  get isMock() {
    return !this.provider || this.provider.kind === 'mock';
  }

  async chat({ system = '', messages = [], tools = [], maxTokens, temperature, jsonMode = false } = {}) {
    if (this.isMock) return mockChat({ messages, tools });
    if (this.provider.kind === 'anthropic') {
      return this._anthropic({ system, messages, tools, maxTokens, temperature });
    }
    return this._openai({ system, messages, tools, maxTokens, temperature, jsonMode });
  }

  async _openai({ system, messages, tools, maxTokens, temperature, jsonMode }) {
    const p = this.provider;
    const body = {
      model: p.model,
      messages: openaiMessages(system, messages),
      temperature: temperature ?? p.temperature ?? 0.4,
      max_tokens: maxTokens ?? p.maxTokens ?? 2048,
      stream: false,
    };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (jsonMode) body.response_format = { type: 'json_object' };
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const data = await requestJson(
      openaiUrl(p.baseUrl),
      { method: 'POST', headers, body: JSON.stringify(body) },
      this.timeoutMs
    );
    const choice = data?.choices?.[0];
    if (!choice) throw new LLMError('模型没有返回内容', { code: 'empty' });
    const msg = choice.message || {};
    const toolCalls = (msg.tool_calls || [])
      .filter((c) => c?.function?.name)
      .map((c) => ({
        id: c.id || 'call_' + Math.random().toString(36).slice(2, 10),
        name: c.function.name,
        args: safeArgs(c.function.arguments),
      }));
    return {
      text: Array.isArray(msg.content)
        ? msg.content.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('').trim()
        : String(msg.content || '').trim(),
      toolCalls,
      finishReason: choice.finish_reason || '',
      usage: data.usage || null,
      model: data.model || p.model,
    };
  }

  async _anthropic({ system, messages, tools, maxTokens, temperature }) {
    const p = this.provider;
    const body = {
      model: p.model,
      max_tokens: maxTokens ?? p.maxTokens ?? 2048,
      temperature: temperature ?? p.temperature ?? 0.4,
      messages: anthropicMessages(messages),
    };
    if (system) body.system = system;
    if (tools.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const data = await requestJson(
      anthropicUrl(p.baseUrl),
      { method: 'POST', headers, body: JSON.stringify(body) },
      this.timeoutMs
    );
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
    if (!text && !toolCalls.length) throw new LLMError('模型没有返回内容', { code: 'empty' });
    return {
      text,
      toolCalls,
      finishReason: data.stop_reason || '',
      usage: data.usage || null,
      model: data.model || p.model,
    };
  }
}

function safeArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { _raw: String(raw || '') };
  }
}

function mockChat({ messages, tools }) {
  const toolNames = new Set((tools || []).map((t) => t.name));
  const last = messages[messages.length - 1];
  const state = (mockChat._state ||= {});
  const call = (name, args) => ({
    text: '',
    toolCalls: [{ id: 'mock_call_' + Math.random().toString(36).slice(2, 8), name, args }],
  });

  if (last?.role === 'tool') {
    let payload = {};
    try {
      payload = JSON.parse(last.content || '{}');
    } catch {}
    const data = payload.data ?? payload;
    const ok = payload.ok !== false;
    const name = last.name;

    if (!ok) {
      return { text: `这一步没办成：${payload.error || '未知错误'}。你可以稍后再试。`, toolCalls: [] };
    }
    if (name === 'today_overview') {
      const s = data?.stats || {};
      const items = data?.tasks || data?.items || [];
      const completed = data?.completedToday || [];
      const undated = data?.undated || [];
      const lines = items.slice(0, 4).map((t) => `· ${t.title}${t.dueAt ? '（' + fmtClock(t.dueAt) + '）' : ''}`);
      const doneLines = completed.slice(0, 4).map((t) => `· ${t.title}`);
      const undatedLines = undated.slice(0, 3).map((t) => `· ${t.title}`);
      return {
        text:
          `今天有 ${s.todayCount ?? items.length} 件事，${s.overdueCount ? `其中 ${s.overdueCount} 件已过期；` : ''}` +
          `${s.doneTodayCount ? `已完成 ${s.doneTodayCount} 件。` : ''}\n` +
          (lines.length ? lines.join('\n') : '暂时没有排定时间的事项。') +
          (doneLines.length ? `\n已完成：\n${doneLines.join('\n')}` : '') +
          (undatedLines.length ? `\n未安排时间：\n${undatedLines.join('\n')}` : '') +
          '\n需要我帮你排个顺序吗？',
        toolCalls: [],
      };
    }
    if (name === 'get_now') {
      return { text: `今天是 ${data.date || ''}，星期${data.weekday || ''}，现在 ${data.local || ''}。`, toolCalls: [] };
    }
    if (name === 'delete_task') {
      return { text: `删掉了：${data?.title || '这件事'}。`, toolCalls: [] };
    }
    if (name === 'search_everything') {
      const tasks = data?.tasks || [];
      if (state.pendingDelete && tasks.length) {
        state.pendingDelete = false;
        return call('delete_task', { id: tasks[0].id });
      }
      return {
        text: tasks.length ? `找到 ${tasks.length} 条相关事项：\n` + tasks.slice(0, 5).map((t) => `· ${t.title}（${t.status}）`).join('\n') : '没有搜到相关事项。',
        toolCalls: [],
      };
    }
    if (name === 'create_task') {
      const due = data?.dueAt ? `，${fmtWhen(data.dueAt)}` : '';
      return { text: `记下了：${data?.title || '这件事'}${due}。到点我会提醒你。`, toolCalls: [] };
    }
    if (name === 'list_tasks') {
      const items = Array.isArray(data) ? data : data?.items || [];
      if (!items.length) return { text: '待办是空的，今天可以轻松一点。', toolCalls: [] };
      return {
        text: `现在有 ${items.length} 项待办：\n` + items.slice(0, 6).map((t) => `· ${t.title}`).join('\n'),
        toolCalls: [],
      };
    }
    if (name === 'list_agents') {
      const items = Array.isArray(data) ? data : data?.agents || [];
      if (state.pendingDispatch && items.length) {
        const agent = items.find((a) => a.archived !== true) || items[0];
        state.pendingDispatch = false;
        const prompt = state.pendingPrompt || '请完成这项任务并汇报结果';
        return {
          text: '',
          toolCalls: [
            {
              id: 'mock_call_' + Math.random().toString(36).slice(2, 8),
              name: 'start_agent_run',
              args: { agentId: agent.id, title: truncate(prompt, 36), prompt },
            },
          ],
        };
      }
      if (!items.length) return { text: '还没有纳管智能体。去「监工」页添加一个，或者让我帮你建一个内部助理。', toolCalls: [] };
      return {
        text:
          '目前纳管的智能体：\n' +
          items
            .slice(0, 6)
            .map((a) => `· ${a.name}：${agentStatusText(a)}`)
            .join('\n'),
        toolCalls: [],
      };
    }
    if (name === 'start_agent_run') {
      return { text: `已经派给「${data?.agentName || '智能体'}」了，我会盯着进度，有结果第一时间通知你。`, toolCalls: [] };
    }
    if (name === 'get_agent_status') {
      return { text: `进度：${data?.status || '进行中'}${data?.progress != null ? `（${data.progress}%）` : ''}。${data?.summary || ''}`, toolCalls: [] };
    }
    if (name === 'save_note') {
      return { text: '记到笔记里了。', toolCalls: [] };
    }
    if (name === 'notify_user') {
      return { text: '好，已经提醒你了。', toolCalls: [] };
    }
    return { text: '办好了。', toolCalls: [] };
  }

  const text = String(last?.content || '').trim();
  if (!text) return { text: '我在，说吧。', toolCalls: [] };
  if (!/派|让.+做|安排.+做|交给/.test(text)) state.pendingDispatch = false;
  if (!/删除|删掉|删了/.test(text)) state.pendingDelete = false;
  const can = (name) => toolNames.has(name);

  if (/(今天|现在).*(几号|星期几|周几|日期|几点)|现在几点/.test(text)) {
    const now = new Date();
    const weekday = '日一二三四五六'[now.getDay()];
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    return {
      text: `今天是 ${date}，星期${weekday}，现在 ${now.toLocaleTimeString('zh-CN', { hour12: false })}。`,
      toolCalls: [],
    };
  }
  if (/删除|删掉|删了/.test(text) && can('search_everything')) {
    state.pendingDelete = true;
    const q = text
      .replace(/^.*?(?:把|删除|删掉|删了)/, '')
      .replace(/[吧。！!？?\s]+$/, '')
      .trim();
    return call('search_everything', { query: q || text });
  }

  if (/^(你好|嗨|hi|hello|在吗|早|早上好|晚上好)/i.test(text)) {
    return { text: '我在。今天想先安排事情，还是看看智能体的进度？', toolCalls: [] };
  }
  if (/配置|api\s*key|apikey|模型|密钥/i.test(text)) {
    return {
      text: '在「设置 → 模型」里填入 Base URL、模型名和 API Key，保存后点「测试连接」就行。现在用的是演示模式，不会真的调用模型。',
      toolCalls: [],
    };
  }
  if (/派|让.+做|安排.+做|交给/.test(text) && can('list_agents')) {
    state.pendingDispatch = true;
    state.pendingPrompt = text.replace(/^.*?(?:派给|让|交给)\s*/, '') || text;
    return call('list_agents', {});
  }
  if (/提醒我|记得|别忘了|叫我/.test(text) && can('create_task')) {
    const when = parseWhen(text);
    const title = when.title || text;
    return call('create_task', {
      title: title.slice(0, 120),
      dueAt: when.at ? new Date(when.at).toISOString() : undefined,
      remind: Boolean(when.at),
    });
  }
  if (/待办|任务|清单/.test(text) && can('list_tasks')) {
    return call('list_tasks', { scope: 'active' });
  }
  if (/智能体|agent|监工|进度|跑到哪|干得怎么样/i.test(text) && can('list_agents')) {
    return call('list_agents', {});
  }
  if (/今天|今日|安排|概览|日程|忙不忙|有什么/.test(text) && can('today_overview')) {
    return call('today_overview', {});
  }
  if (/记一下|记下|笔记|备忘/.test(text) && can('save_note')) {
    return call('save_note', { content: text });
  }
  return {
    text:
      '收到。' +
      (text.length > 30 ? '我先记在心里了。' : '') +
      '现在是演示模式，我可以帮你记事项、查待办、看智能体；配置真实模型后还能做更细的汇总和判断。',
    toolCalls: [],
  };
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtWhen(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay) return `今天 ${t}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${t}`;
}

function agentStatusText(a) {
  const map = { running: '进行中', waiting: '等待中', blocked: '被卡住', done: '已完成', failed: '失败', queued: '排队中' };
  const run = a.currentRun;
  if (!run) return '空闲';
  return `${map[run.status] || run.status}${run.progress ? ` ${run.progress}%` : ''}`;
}

async function testProvider({ provider, apiKey }) {
  const started = Date.now();
  const llm = new LLM({ provider, apiKey, timeoutMs: 30000 });
  const res = await llm.chat({
    system: '你是连接测试助手。',
    messages: [{ role: 'user', content: '只回复两个字：正常' }],
    maxTokens: 20,
    temperature: 0,
  });
  return { ok: true, ms: Date.now() - started, reply: truncate(res.text || '(空回复)', 80), model: res.model };
}

module.exports = { LLM, LLMError, PROVIDER_PRESETS, testProvider, mockChat };
