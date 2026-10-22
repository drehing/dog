'use strict';

const { EventEmitter } = require('node:events');
const { truncate, nowIso, localDateKey, humanWhen } = require('./util');

class SupervisorService extends EventEmitter {
  constructor({ store, tasks, agents, getLLM, notify }) {
    super();
    this.store = store;
    this.tasks = tasks;
    this.agents = agents;
    this.getLLM = getLLM;
    this.notify = notify;
    this._busy = false;
  }

  get data() {
    return this.store.data;
  }

  _isMock() {
    const llm = this.getLLM();
    return !llm || llm.isMock;
  }

  async onRunDone({ run, agent }) {
    if (!run) return;
    const ok = run.status === 'done';
    const name = agent?.name || run.agentName || '智能体';
    let body = run.summary || (ok ? '任务已完成。' : '任务没有正常结束。');
    if (ok && !this._isMock() && body.length > 160) {
      body = await this._shortSummary(body, '把这份智能体成果压缩成两句中文结论，不超过 90 字，不要寒暄。');
    }
    const title = ok ? `${name} 完成了` : run.status === 'cancelled' ? `${name} 已取消` : `${name} 失败了`;
    this.notify({
      kind: ok ? 'completion' : 'failure',
      title,
      body: `${run.title}\n${truncate(body, 260)}`,
      short: `${run.title} · ${truncate(body, 90)}`,
      meta: { runId: run.id, agentId: run.agentId },
      dedupeKey: `run-done:${run.id}:${run.status}`,
    });
  }

  onRunAttention({ run, agent }) {
    if (!run) return;
    const name = agent?.name || run.agentName || '智能体';
    this.notify({
      kind: 'attention',
      title: `${name} 需要你`,
      body: `${run.title}\n${truncate(run.attentionReason || '它停下来等你的指示。', 240)}`,
      short: `${run.title} · ${truncate(run.attentionReason || '等待你的指示', 90)}`,
      meta: { runId: run.id, agentId: run.agentId },
      dedupeKey: `run-attn:${run.id}:${Math.floor(Date.now() / (15 * 60000))}`,
    });
  }

  async _shortSummary(text, instruction) {
    try {
      const llm = this.getLLM();
      if (!llm || llm.isMock) return truncate(text, 120);
      const res = await llm.chat({
        system: '你是秘书，只做简短中文摘要，不编造。',
        messages: [{ role: 'user', content: `${instruction}\n\n${text}` }],
        maxTokens: 160,
        temperature: 0.2,
      });
      return truncate(res.text || text, 160);
    } catch {
      return truncate(text, 140);
    }
  }

  async reviewRuns({ trigger = 'schedule', force = false } = {}) {
    const active = this.agents.activeRuns();
    if (!active.length) return null;
    if (this._busy) return null;
    const now = Date.now();
    const last = this.data.meta.lastSupervisionAt ? Date.parse(this.data.meta.lastSupervisionAt) : 0;
    if (!force && now - last < 5 * 60000) return null;
    this._busy = true;
    try {
      const snap = this.agents.snapshot();
      let result;
      if (this._isMock()) {
        result = this._heuristicSupervision(snap);
      } else {
        result = await this._llmSupervision(snap);
      }
      if (!result) result = this._heuristicSupervision(snap);
      const attention = Array.isArray(result.attention) ? result.attention.slice(0, 6) : [];
      const supervisorCfg = this.data.settings.supervisor || {};
      const silent =
        trigger !== 'manual' &&
        (!supervisorCfg.autoNotify || (supervisorCfg.onlyWhenAttention && attention.length === 0));
      const lines = [];
      lines.push(result.headline || `${snap.active.length} 个智能体在推进`);
      for (const r of snap.active.slice(0, 6)) {
        const statusText = { running: '进行中', waiting: '等待中', blocked: '被卡住', queued: '排队中' }[r.status] || r.status;
        const icon = r.needsAttention ? '⚠️' : r.status === 'running' ? '·' : '⏸';
        lines.push(`${icon} ${r.agent}：${statusText}${r.progress ? ` ${r.progress}%` : ''}，${truncate(r.title, 30)}`);
      }
      if (attention.length) {
        for (const a of attention.slice(0, 3)) {
          if (a.reason) lines.push(`👉 ${truncate(a.reason, 80)}`);
        }
      } else if (result.suggestion) {
        lines.push(`👉 ${truncate(result.suggestion, 80)}`);
      }
      const body = lines.join('\n');
      const short = `${result.headline || `${snap.active.length} 个任务在跑`}${attention.length ? ` · ${attention.length} 个需要你` : ''}`;
      const item = this.notify({
        kind: 'supervision',
        title: `监工汇报 · ${snap.active.length} 个进行中`,
        body,
        short,
        meta: { runIds: snap.active.map((r) => r.runId), trigger },
        dedupeKey: `supervision:${snap.active.map((r) => r.runId + r.status + r.progress).join('|')}:${Math.floor(now / (20 * 60000))}`,
        silent,
        force: trigger === 'manual',
      });
      this.store.mutate((s) => {
        s.meta.lastSupervisionAt = nowIso();
      });
      return item;
    } finally {
      this._busy = false;
    }
  }

  _heuristicSupervision(snap) {
    const attention = snap.active
      .filter((r) => r.needsAttention)
      .map((r) => ({ runId: r.runId, reason: `${r.agent}：${r.attentionReason || '在等待你的指示'}` }));
    const stale = snap.active.filter((r) => Date.now() - Date.parse(r.lastReportAt) > r.checkInMinutes * 60000);
    for (const r of stale.slice(0, 2)) {
      if (!attention.some((a) => a.runId === r.runId)) {
        attention.push({ runId: r.runId, reason: `${r.agent} 已 ${Math.round((Date.now() - Date.parse(r.lastReportAt)) / 60000)} 分钟没汇报` });
      }
    }
    const done = snap.active.filter((r) => r.progress >= 80).length;
    const headline = attention.length
      ? `${snap.active.length} 个在跑，${attention.length} 个需要你`
      : `${snap.active.length} 个在跑，${done ? `${done} 个接近完成` : '暂时都正常'}`;
    return {
      headline,
      attention,
      suggestion: attention.length ? '先处理需要确认的事项，其余的继续盯着。' : '暂时不用你介入，我会继续盯。',
    };
  }

  async _llmSupervision(snap) {
    const llm = this.getLLM();
    if (!llm) return null;
    const now = new Date();
    const prompt = [
      `现在是 ${now.toLocaleString('zh-CN', { hour12: false })}。你是用户的监工秘书。`,
      '下面是正在运行的智能体任务快照。请判断每个任务是否正常推进、是否卡住、是否需要用户决策。',
      '不要编造快照里没有的信息。只输出 JSON，不要 markdown 代码块。格式：',
      '{"headline":"一句话总体判断，30字内","summary":"两三句细节","attention":[{"runId":"原样","reason":"需要用户做什么，40字内"}],"suggestion":"给用户的一条行动建议，40字内"}',
      JSON.stringify(snap, null, 2),
    ].join('\n');
    try {
      const res = await llm.chat({
        system: '你是严格、简短的中文监工。只输出 JSON。',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 700,
        temperature: 0.2,
      });
      const text = String(res.text || '').replace(/```json|```/g, '').trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const obj = JSON.parse(text.slice(start, end + 1));
      if (!obj || typeof obj !== 'object') return null;
      const validIds = new Set(snap.active.map((r) => r.runId));
      obj.attention = (Array.isArray(obj.attention) ? obj.attention : []).filter((a) => validIds.has(a.runId));
      return obj;
    } catch (err) {
      console.warn('[supervisor] LLM 监工失败，使用本地判断', err.message);
      return null;
    }
  }

  async briefing({ force = false } = {}) {
    const today = localDateKey();
    if (!force && this.data.meta.lastBriefingDate === today) return null;
    const stats = this.tasks.stats();
    const todayTasks = this.tasks.list({ scope: 'today', limit: 8 });
    const overdue = this.tasks.list({ scope: 'overdue', limit: 5 });
    const runs = this.agents.activeRuns();
    const assistant = this.data.settings.assistantName || '阿犬';
    const name = this.data.settings.userName || '老板';
    const next = stats.next;
    let text;
    if (this._isMock()) {
      const parts = [];
      parts.push(`${name}，早上好。`);
      parts.push(
        stats.todayCount
          ? `今天有 ${stats.todayCount} 件事${stats.doneTodayCount ? `，已完成 ${stats.doneTodayCount} 件` : ''}。`
          : '今天暂时没有排定的事项。'
      );
      if (stats.overdueCount) parts.push(`有 ${stats.overdueCount} 件已经过期，建议先处理。`);
      if (next) parts.push(`下一件是「${truncate(next.title, 30)}」，${humanWhen(next.dueAt)}。`);
      if (runs.length) parts.push(`${runs.length} 个智能体正在干活，我会盯着。`);
      parts.push('需要我帮你排顺序就说一声。');
      text = parts.join('');
    } else {
      const data = {
        user: name,
        stats,
        tasks: todayTasks.map((t) => ({ title: t.title, dueAt: t.dueAt, status: t.status, priority: t.priority })),
        overdue: overdue.map((t) => t.title),
        agents: this.agents.promptSummary(),
      };
      text = await this._briefWithLLM(data, 'morning');
    }
    const body = [
      text,
      '',
      todayTasks.length ? '今日清单：' : '',
      ...todayTasks.slice(0, 5).map((t) => `· ${t.status === 'done' ? '✓' : '□'} ${truncate(t.title, 40)}${t.dueAt ? `（${humanWhen(t.dueAt)}）` : ''}`),
      runs.length ? `智能体：${runs.length} 个进行中` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const item = this.notify({
      kind: 'briefing',
      title: `${assistant}的早报 · ${today.slice(5)}`,
      body,
      short: truncate(text, 110),
      meta: { briefing: today },
      dedupeKey: `briefing:${today}`,
      force: true,
    });
    this.store.mutate((s) => {
      s.meta.lastBriefingDate = today;
    });
    return item;
  }

  async review({ force = false } = {}) {
    const today = localDateKey();
    if (!force && this.data.meta.lastReviewDate === today) return null;
    const stats = this.tasks.stats();
    const done = this.data.tasks.filter(
      (t) => t.status === 'done' && t.completedAt && localDateKey(new Date(t.completedAt)) === today
    );
    const active = this.tasks.list({ scope: 'active', limit: 8 });
    const runsDone = this.data.runs.filter((r) => r.endedAt && localDateKey(new Date(r.endedAt)) === today);
    const name = this.data.settings.userName || '老板';
    let text;
    if (this._isMock()) {
      text =
        `${name}，今天收了 ${done.length} 件事` +
        (active.length ? `，还有 ${active.length} 件没完成。` : '，清单清空了。') +
        (runsDone.length ? ` 智能体这边完成了 ${runsDone.filter((r) => r.status === 'done').length} 个任务。` : '') +
        (active.length ? ' 要我把没做完的顺延到明天吗？' : ' 早点休息。');
    } else {
      text = await this._briefWithLLM(
        {
          user: name,
          stats,
          done: done.map((t) => t.title),
          unfinished: active.map((t) => ({ title: t.title, dueAt: t.dueAt })),
          agents: runsDone.map((r) => ({ name: r.agentName, title: r.title, status: r.status })),
        },
        'evening'
      );
    }
    const item = this.notify({
      kind: 'review',
      title: `今日收尾 · ${today.slice(5)}`,
      body: `${text}\n\n完成 ${done.length} 件，未完成 ${stats.activeCount} 件。`,
      short: truncate(text, 110),
      meta: { review: today },
      dedupeKey: `review:${today}`,
      force: true,
    });
    this.store.mutate((s) => {
      s.meta.lastReviewDate = today;
    });
    return item;
  }

  async _briefWithLLM(data, mode) {
    const llm = this.getLLM();
    if (!llm || llm.isMock) return '';
    const instruction =
      mode === 'evening'
        ? '写一段 2-3 句的中文晚间收尾，语气像可靠秘书，先肯定完成的事，再提醒未完成事项。不要列清单，不要编造。'
        : '写一段 3-4 句的中文早间简报，语气像可靠秘书，先讲重点，再给一条排序建议。不要列清单，不要编造。';
    try {
      const res = await llm.chat({
        system: '你是用户的私人秘书，说话自然、简短、不客套。',
        messages: [{ role: 'user', content: `${instruction}\n\n数据：\n${JSON.stringify(data, null, 2)}` }],
        maxTokens: 300,
        temperature: 0.5,
      });
      return truncate(res.text || '', 500);
    } catch (err) {
      console.warn('[supervisor] 生成简报失败', err.message);
      return mode === 'evening' ? '今天辛苦了，剩下的事明天再排也不迟。' : '早上好，今天的安排我已经整理好了。';
    }
  }
}

module.exports = { SupervisorService };
