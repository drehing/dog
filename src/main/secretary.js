'use strict';

const { EventEmitter } = require('node:events');
const { uid, truncate, localDateKey } = require('./util');

const MAX_TOOL_ROUNDS = 6;

class SecretaryService extends EventEmitter {
  constructor({ store, tasks, agents, tools, getLLM }) {
    super();
    this.store = store;
    this.tasks = tasks;
    this.agents = agents;
    this.tools = tools;
    this.getLLM = getLLM;
  }

  get data() {
    return this.store.data;
  }

  history(limit = 120) {
    return this.data.chat.slice(-limit);
  }

  clear() {
    this.store.mutate((s) => {
      s.chat = [];
    });
  }

  _systemPrompt() {
    const s = this.data.settings;
    const stats = this.tasks.stats();
    const today = this.tasks.list({ scope: 'today', limit: 12 });
    const agents = this.agents.promptSummary();
    const now = new Date();
    const todayKey = localDateKey(now);
    const weekday = '日一二三四五六'[now.getDay()];
    const completedToday = this.data.tasks
      .filter((t) => t.status === 'done' && t.completedAt && localDateKey(new Date(t.completedAt)) === todayKey)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .slice(0, 12);
    const undated = this.data.tasks
      .filter((t) => t.status === 'todo' && !t.dueAt)
      .slice(0, 12);
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    return [
      `你是「${s.assistantName || '阿犬'}」，${s.userName || '用户'}的私人秘书，负责管理日常事务、盯智能体进度、做汇总提醒。`,
      `当前时间：${todayKey} 星期${weekday} ${time}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）。日期以此为准，不要根据任务的截止日期推断今天是几号。`,
      `你的风格：${s.persona}`,
      '',
      '工作规则：',
      '1. 涉及待办、时间、智能体的事实，必须先调用工具确认，不要凭空编造 id 或进度。',
      '2. 用户说“提醒我/记得”时，用 create_task 建事项并设置时间；支持“10秒后/5分钟后/明天下午3点”等说法，到点系统会自动发桌面通知。',
      '3. 用户问“今天几号/星期几/现在几点”时，直接根据上面的当前时间回答，或调用 get_now；不要调用 today_overview。',
      '4. 修改/完成/删除事项前先确认 id：用 search_everything 搜索关键词，或 list_tasks(scope=done) 查已完成；不要因为“未完成列表里没有”就说事项不存在。删除可用 delete_task 的 query 参数直接按关键词查找。',
      '5. 回答简短，先结论后细节；不要重复工具返回的原始 JSON。',
      '6. 不要主动承诺你做不到的事；需要用户拍板时直接说。',
      '',
      `今日统计：待办 ${stats.activeCount} 项，今天 ${stats.todayCount} 项，已过期 ${stats.overdueCount} 项，今天完成 ${stats.doneTodayCount} 项。`,
      today.length
        ? '今天/已过期的事项：\n' +
          today
            .map((t) => `- [${t.id}] ${t.title}${t.dueAt ? ` @ ${new Date(t.dueAt).toLocaleString('zh-CN', { hour12: false })}` : ''}（${t.status}）`)
            .join('\n')
        : '今天没有排定时间的事项。',
      undated.length
        ? '未安排时间的待办：\n' + undated.map((t) => `- [${t.id}] ${t.title}`).join('\n')
        : '',
      completedToday.length
        ? '今天已完成：\n' +
          completedToday
            .map((t) => `- [${t.id}] ${t.title}（完成于 ${new Date(t.completedAt).toLocaleTimeString('zh-CN', { hour12: false })}）`)
            .join('\n')
        : '',
      agents.length
        ? '纳管的智能体：\n' +
          agents
            .map((a) => `- [${a.id}] ${a.name}：${a.status}${a.progress != null ? ` ${a.progress}%` : ''}${a.title ? ` · ${a.title}` : ''}${a.needsAttention ? '（需要用户）' : ''}`)
            .join('\n')
        : '还没有纳管智能体。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async _directDelete(text) {
    const raw = String(text || '').trim();
    let query = '';
    let m = /^(?:请|帮我)?\s*把\s*(.+?)\s*(?:删除|删掉|删了|删了吧|删掉吧)\s*[。.!！]?$/.exec(raw);
    if (m) query = m[1].trim();
    if (!query) {
      m = /^(?:请|帮我)?\s*(?:删除|删掉)\s*(.+?)\s*[。.!！]?$/.exec(raw);
      if (m) query = m[1].trim();
    }
    if (!query || query.length < 1) return null;
    const result = await this.tools.execute('delete_task', { query });
    if (result.ok) {
      return {
        text: `已删除：${result.data.title}。`,
        trace: [{ name: 'delete_task', ok: true }],
      };
    }
    return {
      text: `没删成：${result.error}。你可以说得更具体一点。`,
      trace: [{ name: 'delete_task', ok: false }],
    };
  }

  _directAnswer(text) {
    const q = String(text || '').trim().replace(/^请问[，,\s]*/, '');
    if (!/^(今天|现在|当前).*(几号|几月几号|星期几|周几|什么日期|什么日子|几点|什么时间)/.test(q) && !/^现在几点/.test(q)) {
      return '';
    }
    const now = new Date();
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const weekday = '日一二三四五六'[now.getDay()];
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    return `今天是 ${date}，星期${weekday}，现在 ${time}。`;
  }

  _historyMessages() {
    return this.data.chat
      .slice(-24)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async send(text) {
    const content = String(text || '').trim();
    if (!content) throw new Error('说点什么吧');
    if (content.length > 6000) throw new Error('这条消息太长了，拆成几条说吧');
    const llm = this.getLLM();
    if (!llm) throw new Error('还没有可用的模型，请到设置里配置 API Key');
    this.store.mutate((s) => {
      s.chat.push({ id: uid('msg'), role: 'user', content, at: Date.now() });
      if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
    });

    const deleted = await this._directDelete(content);
    if (deleted) {
      const message = { id: uid('msg'), role: 'assistant', content: deleted.text, at: Date.now(), trace: deleted.trace };
      this.store.mutate((s) => {
        s.chat.push(message);
        if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
      });
      return { message, trace: deleted.trace };
    }

    const direct = this._directAnswer(content);
    if (direct) {
      const message = { id: uid('msg'), role: 'assistant', content: direct, at: Date.now(), trace: [] };
      this.store.mutate((s) => {
        s.chat.push(message);
        if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
      });
      return { message, trace: [] };
    }

    const messages = this._historyMessages();
    const trace = [];
    let finalText = '';
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      this.emit('thinking', { round: round + 1 });
      const res = await llm.chat({
        system: this._systemPrompt(),
        messages,
        tools: this.tools.definitions,
        maxTokens: 1800,
        temperature: this.data.settings.providers.find((p) => p.id === this.data.settings.activeProviderId)?.temperature ?? 0.4,
      });
      if (res.toolCalls?.length) {
        messages.push({ role: 'assistant', content: res.text || '', toolCalls: res.toolCalls });
        for (const call of res.toolCalls) {
          this.emit('tool', { name: call.name, status: 'running', args: call.args });
          const result = await this.tools.execute(call.name, call.args);
          trace.push({
            name: call.name,
            ok: result.ok,
            brief: result.ok ? this._briefResult(call.name, result.data) : result.error,
          });
          this.emit('tool', { name: call.name, status: result.ok ? 'done' : 'error' });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result),
          });
        }
        continue;
      }
      finalText = String(res.text || '').trim();
      if (finalText) break;
    }
    if (!finalText) finalText = '我处理了一下，但还没有得到最终结果。你可以再具体说一点。';

    const message = {
      id: uid('msg'),
      role: 'assistant',
      content: finalText,
      at: Date.now(),
      trace: trace.map((t) => ({ name: t.name, ok: t.ok })),
    };
    this.store.mutate((s) => {
      s.chat.push(message);
      if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
    });
    return { message, trace };
  }

  _briefResult(name, data) {
    if (!data) return '';
    if (name === 'today_overview') return `${data.stats?.todayCount ?? 0} 项今天 / ${data.stats?.overdueCount ?? 0} 项过期`;
    if (name === 'list_tasks') return `${Array.isArray(data) ? data.length : 0} 项`;
    if (name === 'list_agents') return `${Array.isArray(data) ? data.length : 0} 个智能体`;
    if (name === 'create_task') return data.title || '已创建';
    if (name === 'complete_task' || name === 'update_task') return data.title || '已更新';
    if (name === 'start_agent_run') return `${data.agentName || '智能体'} · 已派发`;
    if (name === 'get_agent_status') return data.status || '';
    if (name === 'notify_user') return '已通知';
    if (name === 'save_note') return '已记笔记';
    if (name === 'delete_task') return `已删除：${data.title || ''}`;
    if (name === 'get_now') return `${data.date} 星期${data.weekday || ''}`;
    if (name === 'search_everything') return `${(data.tasks?.length || 0) + (data.notes?.length || 0)} 条结果`;
    return truncate(JSON.stringify(data), 80);
  }
}

module.exports = { SecretaryService, MAX_TOOL_ROUNDS };
