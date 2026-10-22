'use strict';

const { parseWhen, formatDateTime } = require('./time');
const { truncate, localDateKey } = require('./util');

const TOOL_DEFS = [
  {
    name: 'get_now',
    description: '获取当前本地日期、星期和时间。用户问今天几号、星期几、现在几点时调用；不要用待办列表推断日期。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'today_overview',
    description: '获取今天的完整概览：日期、待办统计、今天的任务、今天已完成的事项、未安排时间的事项、进行中的智能体。用户问“今天怎么样/怎么安排/今天进展”时优先调用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_tasks',
    description: '列出事项。scope: today=今天的和已过期，active=所有未完成，overdue=已过期，done=已完成，upcoming=未来。已完成的事项用 scope=done 查询。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['today', 'active', 'overdue', 'done', 'upcoming'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: '新建一件待办或提醒。dueAt 可以是 ISO 时间，也可以直接传中文时间短语（如“明天下午3点”“10秒后”）。设置 remind=true 会在到点时通知用户。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '事项内容，简洁明确' },
        dueAt: { type: 'string', description: '截止/提醒时间，ISO 或中文短语' },
        notes: { type: 'string' },
        priority: { type: 'integer', minimum: 0, maximum: 3, description: '0低 1普通 2重要 3紧急' },
        remind: { type: 'boolean', description: '是否到点提醒，默认 true' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description: '修改事项，例如改标题、改时间、标记完成。id 来自 list_tasks/today_overview。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        dueAt: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'doing', 'done', 'cancelled'] },
        notes: { type: 'string' },
        priority: { type: 'integer', minimum: 0, maximum: 3 },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: '把某件事标记为完成。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_task',
    description: '删除一件事项（包括已完成的事项）。可传 id，或传 query（标题关键词）自动搜索；多个匹配时会返回候选。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        query: { type: 'string', description: '事项标题关键词，例如“妈妈”' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_agents',
    description: '查看纳管的智能体、当前任务、进度和是否需要用户介入。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'start_agent_run',
    description: '给智能体派活。优先用 agentId；不知道 id 时先调用 list_agents。',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        agentName: { type: 'string', description: '按名字匹配（可选）' },
        title: { type: 'string', description: '任务短标题' },
        prompt: { type: 'string', description: '完整任务说明，越具体越好' },
        taskId: { type: 'string', description: '可选，关联的待办 id' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_agent_status',
    description: '查看某个智能体任务的详细进度和最近汇报；不传参数则返回所有进行中的任务。',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string' }, agentId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'send_agent_instruction',
    description: '给正在运行的智能体补充指令或回答它的问题。',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string' }, message: { type: 'string' } },
      required: ['runId', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_agent_run',
    description: '取消一个正在运行的智能体任务。',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'notify_user',
    description: '立即给用户发一条桌面悬浮通知。只在确实需要提醒时使用，不要滥用。',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_note',
    description: '保存一条随手笔记。',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_everything',
    description: '在事项、笔记、智能体中做关键词搜索。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

function resolveDue(input) {
  if (input == null || input === '') return null;
  const text = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const t = Date.parse(text);
    if (Number.isFinite(t)) return t;
  }
  const parsed = parseWhen(text);
  if (parsed.at) return parsed.at;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
}

class ToolRunner {  constructor({ store, tasks, agents, notify }) {
    this.store = store;
    this.tasks = tasks;
    this.agents = agents;
    this.notify = notify;
  }

  get definitions() {
    return TOOL_DEFS;
  }

  async execute(name, args = {}) {
    try {
      const data = await this._run(name, args || {});
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: truncate(err.message || String(err), 300) };
    }
  }

  async _run(name, args) {
    switch (name) {
      case 'get_now': {
        const now = new Date();
        return {
          iso: now.toISOString(),
          local: now.toLocaleString('zh-CN', { hour12: false }),
          date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
          weekday: '日一二三四五六'[now.getDay()],
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }
      case 'today_overview':
        return this._overview();
      case 'list_tasks':
        return this.tasks.list({ scope: args.scope || 'active', limit: args.limit || 20 }).map((t) => this._task(t));
      case 'create_task': {
        const dueAt = resolveDue(args.dueAt ?? args.when);
        const task = this.tasks.create({
          title: args.title,
          notes: args.notes,
          dueAt,
          priority: args.priority ?? 1,
          remind: args.remind !== false,
          source: 'assistant',
        });
        return this._task(task);
      }
      case 'update_task': {
        const patch = {};
        for (const k of ['title', 'notes', 'priority', 'status']) if (args[k] !== undefined) patch[k] = args[k];
        if (args.dueAt !== undefined) patch.dueAt = resolveDue(args.dueAt);
        const task = this.tasks.update(args.id, patch);
        return this._task(task);
      }
      case 'complete_task':
        return this._task(this.tasks.complete(args.id));
      case 'delete_task': {
        let task = args.id ? this.tasks.get(args.id) : null;
        if (!task && args.query) {
          const found = this._search(args.query).tasks;
          if (found.length === 1) task = this.tasks.get(found[0].id);
          else if (found.length > 1) {
            throw new Error(
              `找到 ${found.length} 条，请先确认：` + found.slice(0, 5).map((t) => `${t.title}（${t.id}）`).join('；')
            );
          }
        }
        if (!task) throw new Error('找不到这个事项，请换一个关键词');
        this.tasks.remove(task.id);
        return { id: task.id, title: task.title, status: task.status, deleted: true };
      }
      case 'list_agents':
        return this.agents.list().map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          description: a.description,
          currentRun: a.currentRun
            ? {
                runId: a.currentRun.id,
                title: a.currentRun.title,
                status: a.currentRun.status,
                progress: a.currentRun.progress,
                needsAttention: a.currentRun.needsAttention,
              }
            : null,
          lastRun: a.lastRun
            ? { title: a.lastRun.title, status: a.lastRun.status, endedAt: a.lastRun.endedAt }
            : null,
        }));
      case 'start_agent_run': {
        let agent = args.agentId ? this.agents.get(args.agentId) : null;
        if (!agent && args.agentName) {
          const needle = String(args.agentName).trim();
          agent = this.store.data.agents.find((a) => a.name.includes(needle) || needle.includes(a.name));
        }
        if (!agent) throw new Error('找不到这个智能体，请先查看智能体列表');
        const run = this.agents.startRun({
          agentId: agent.id,
          prompt: args.prompt,
          title: args.title || args.prompt,
          taskId: args.taskId || null,
          source: 'assistant',
        });
        return { runId: run.id, agentName: agent.name, status: run.status };
      }
      case 'get_agent_status': {
        if (args.runId) {
          const run = this.agents.getRun(args.runId);
          if (!run) throw new Error('找不到这个任务');
          return this._compactRun(run);
        }
        if (args.agentId) {
          const agent = this.agents.list().find((a) => a.id === args.agentId);
          if (!agent) throw new Error('找不到这个智能体');
          return agent;
        }
        return this.agents.activeRuns().map((r) => this._compactRun(this.agents.getRun(r.id)));
      }
      case 'send_agent_instruction':
        return { ok: this.agents.instruct(args.runId, args.message) };
      case 'cancel_agent_run':
        return { ok: this.agents.cancel(args.runId) };
      case 'notify_user': {
        const item = this.notify({
          kind: 'system',
          title: args.title || 'Dog 秘书',
          body: args.body,
          short: args.body,
          meta: { source: 'assistant' },
        });
        return { id: item?.id, delivered: true };
      }
      case 'save_note': {
        const note = this.tasks.addNote(args.content, args.tags);
        return { id: note.id, content: note.content, createdAt: note.createdAt };
      }
      case 'search_everything':
        return this._search(args.query);
      default:
        throw new Error(`未知工具：${name}`);
    }
  }

  _task(t) {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      dueLabel: t.dueAt ? formatDateTime(t.dueAt) : '无时间',
      tags: t.tags,
      notes: t.notes ? truncate(t.notes, 200) : '',
    };
  }

  _compactRun(run) {
    return {
      runId: run.id,
      agent: run.agentName,
      title: run.title,
      status: run.status,
      progress: run.progress,
      needsAttention: run.needsAttention,
      attentionReason: run.attentionReason,
      summary: truncate(run.summary, 600),
      prompt: truncate(run.prompt, 600),
      reports: (run.reports || []).slice(-8).map((r) => ({
        at: r.at,
        status: r.status,
        progress: r.progress,
        message: truncate(r.message, 240),
      })),
    };
  }

  _overview() {
    const now = new Date();
    const stats = this.tasks.stats();
    const tasks = this.tasks.list({ scope: 'today', limit: 15 });
    const todayKey = localDateKey(now);
    const completedToday = this.store.data.tasks
      .filter((t) => t.status === 'done' && t.completedAt && localDateKey(new Date(t.completedAt)) === todayKey)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .slice(0, 20)
      .map((t) => this._task(t));
    const undated = this.store.data.tasks
      .filter((t) => t.status === 'todo' && !t.dueAt)
      .slice(0, 20)
      .map((t) => this._task(t));
    const overdue = this.tasks.list({ scope: 'overdue', limit: 10 }).map((t) => this._task(t));
    const agents = this.agents.promptSummary();
    return {
      now: now.toLocaleString('zh-CN', { hour12: false }),
      today: todayKey,
      weekday: '日一二三四五六'[now.getDay()],
      stats,
      tasks: tasks.map((t) => this._task(t)),
      completedToday,
      undated,
      overdue,
      agents,
      activeAgentCount: agents.filter((a) => a.status !== 'idle').length,
    };
  }

  _search(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) throw new Error('搜索词为空');
    const simplify = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[\s,，。.!！?？、:：;；]/g, '')
        .replace(/[给打个了吧了我你请帮把删掉删除这件那]/g, '');
    const q2 = simplify(q);
    const match = (text) => {
      const raw = String(text || '').toLowerCase();
      if (raw.includes(q)) return true;
      return Boolean(q2 && q2.length >= 2 && simplify(raw).includes(q2));
    };
    const tasks = this.store.data.tasks
      .filter((t) => match(t.title + ' ' + t.notes))
      .slice(0, 10)
      .map((t) => ({ type: 'task', id: t.id, title: t.title, status: t.status, dueAt: t.dueAt }));
    const notes = this.store.data.notes
      .filter((n) => match(n.content + ' ' + n.tags.join(' ')))
      .slice(0, 8)
      .map((n) => ({ type: 'note', id: n.id, content: truncate(n.content, 160), createdAt: n.createdAt }));
    const agents = this.store.data.agents
      .filter((a) => match(a.name + ' ' + a.description))
      .slice(0, 8)
      .map((a) => ({ type: 'agent', id: a.id, name: a.name, kind: a.kind }));
    return { tasks, notes, agents };
  }
}

module.exports = { ToolRunner, TOOL_DEFS };
